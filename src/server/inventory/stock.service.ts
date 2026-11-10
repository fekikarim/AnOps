import "server-only";
import { ObjectId, type Db, type Filter } from "mongodb";
import {
  COLLECTIONS,
  type ProductDoc,
  type StockBalanceDoc,
  type StockMovementDoc,
  type TenantScope,
  type WarehouseDoc,
} from "@/server/db/documents";
import { tenantFilter, MAX_BOUNDED_LIST } from "@/server/db/scope";
import { assertExportWithinLimit, MAX_EXPORT_ROWS } from "@/server/exports/limits";
import { pageInfo, skipFor } from "@/server/db/pagination";
import { withTransaction } from "@/server/db/transactions";
import { recordAudit } from "@/server/audit/audit.service";
import { assertPermission, PERMISSIONS } from "@/server/security/permissions";
import type { WorkspaceContext } from "@/server/tenancy/workspace";
import { applyLedgerEntries, type LedgerEntry } from "@/server/inventory/stock-ledger";
import { computeStockStatus, idKey, toMovementDto } from "@/server/inventory/mappers";
import { AppError } from "@/shared/lib/errors";
import { formatQuantity, parseQuantity } from "@/shared/lib/fixed-point";
import type {
  StockAdjustmentInput,
  StockMoveInput,
  StockTransferInput,
} from "@/features/inventory/schemas/inventory.schema";
import type { Paged, StockBalanceDto, StockMovementDto } from "@/features/inventory/types";

export const MOVEMENT_PAGE_SIZE = 25;
export const BALANCE_PAGE_SIZE = 25;

function scope(ctx: WorkspaceContext): TenantScope {
  return { companyId: ctx.companyId };
}

/** Parses a signed user-entered quantity such as "-2.5" into signed micro-units. */
export function parseSignedQuantity(value: string): number {
  const negative = value.startsWith("-");
  const magnitude = parseQuantity(negative ? value.slice(1) : value);
  return negative ? -magnitude : magnitude;
}

type BalanceRow = {
  productId: ObjectId;
  warehouseId: ObjectId;
  onHandMicro: number;
  reorderPointMicro: number;
  productSku: string;
  productName: string;
  unitOfMeasure: string;
  isStorable: boolean;
  warehouseCode: string;
  warehouseName: string;
};

function toBalanceDto(row: BalanceRow): StockBalanceDto {
  return {
    productId: idKey(row.productId),
    productSku: row.productSku,
    productName: row.productName,
    unitOfMeasure: row.unitOfMeasure as StockBalanceDto["unitOfMeasure"],
    warehouseId: idKey(row.warehouseId),
    warehouseCode: row.warehouseCode,
    warehouseName: row.warehouseName,
    onHand: formatQuantity(row.onHandMicro, 3),
    onHandMicro: row.onHandMicro,
    reorderPoint: formatQuantity(row.reorderPointMicro, 3),
    reorderPointMicro: row.reorderPointMicro,
    stockStatus: computeStockStatus({ isStorable: row.isStorable, reorderPointMicro: row.reorderPointMicro }, row.onHandMicro),
  };
}

/**
 * Loads balances with product and warehouse labels in two batched queries (no N+1).
 * Returns the page of balances plus the total number of matching balances.
 */
async function loadBalances(
  db: Db,
  ctx: WorkspaceContext,
  filter: Filter<StockBalanceDoc>,
  page: number,
  pageSize: number
): Promise<Paged<StockBalanceDto>> {
  const balances = db.collection<StockBalanceDoc>(COLLECTIONS.inventoryStockBalances);
  const [total, docs] = await Promise.all([
    balances.countDocuments(filter),
    balances
      .find(filter)
      .sort({ _id: 1 })
      .skip(skipFor(page, pageSize))
      .limit(pageSize)
      .toArray(),
  ]);

  const productIds = [...new Set(docs.map((doc) => idKey(doc.productId)))].map((id) => new ObjectId(id));
  const warehouseIds = [...new Set(docs.map((doc) => idKey(doc.warehouseId)))].map((id) => new ObjectId(id));
  const [products, warehouses] = await Promise.all([
    db
      .collection<ProductDoc>(COLLECTIONS.inventoryProducts)
      .find({ ...tenantFilter(scope(ctx)), _id: { $in: productIds } }, { projection: { sku: 1, name: 1, unitOfMeasure: 1, isStorable: 1, reorderPointMicro: 1 } })
      .toArray(),
    db
      .collection<WarehouseDoc>(COLLECTIONS.inventoryWarehouses)
      .find({ ...tenantFilter(scope(ctx)), _id: { $in: warehouseIds } }, { projection: { code: 1, name: 1 } })
      .toArray(),
  ]);
  const productMap = new Map(products.map((p) => [idKey(p._id), p]));
  const warehouseMap = new Map(warehouses.map((w) => [idKey(w._id), w]));

  const items = docs.map((doc) => {
    const product = productMap.get(idKey(doc.productId));
    const warehouse = warehouseMap.get(idKey(doc.warehouseId));
    return toBalanceDto({
      productId: doc.productId,
      warehouseId: doc.warehouseId,
      onHandMicro: doc.onHandMicro,
      reorderPointMicro: product?.reorderPointMicro ?? 0,
      productSku: product?.sku ?? "",
      productName: product?.name ?? "",
      unitOfMeasure: product?.unitOfMeasure ?? "unit",
      isStorable: product?.isStorable ?? false,
      warehouseCode: warehouse?.code ?? "",
      warehouseName: warehouse?.name ?? "",
    });
  });

  return {
    items,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function listStockBalances(
  ctx: WorkspaceContext,
  query: { productId?: string; warehouseId?: string; page: number }
): Promise<Paged<StockBalanceDto>> {
  assertPermission(ctx.permissions, PERMISSIONS.INVENTORY_READ);
  const filter: Filter<StockBalanceDoc> = { ...tenantFilter(scope(ctx)) };
  if (query.productId) filter.productId = new ObjectId(query.productId);
  if (query.warehouseId) filter.warehouseId = new ObjectId(query.warehouseId);
  return loadBalances(ctx.db, ctx, filter, query.page, BALANCE_PAGE_SIZE);
}

/** All balances for one product, across warehouses. Bounded by the number of warehouses. */
export async function listBalancesForProduct(ctx: WorkspaceContext, productId: string): Promise<StockBalanceDto[]> {
  assertPermission(ctx.permissions, PERMISSIONS.INVENTORY_READ);
  const result = await loadBalances(
    ctx.db,
    ctx,
    { ...tenantFilter(scope(ctx)), productId: new ObjectId(productId) },
    1,
    MAX_BOUNDED_LIST
  );
  return result.items;
}

/**
 * Every balance matching the filters, sorted by product SKU and warehouse code. Reuses the list's
 * loader with the export cap, so counts and joins match the stock page exactly.
 */
export async function listStockBalancesForExport(
  ctx: WorkspaceContext,
  query: { productId?: string; warehouseId?: string }
): Promise<StockBalanceDto[]> {
  assertPermission(ctx.permissions, PERMISSIONS.INVENTORY_READ);
  const filter: Filter<StockBalanceDoc> = { ...tenantFilter(scope(ctx)) };
  if (query.productId) filter.productId = new ObjectId(query.productId);
  if (query.warehouseId) filter.warehouseId = new ObjectId(query.warehouseId);
  const result = await loadBalances(ctx.db, ctx, filter, 1, MAX_EXPORT_ROWS);
  assertExportWithinLimit(result.total);
  return result.items.sort(
    (a, b) => a.productSku.localeCompare(b.productSku) || a.warehouseCode.localeCompare(b.warehouseCode)
  );
}

/**
 * Movements in the half-open window [from, toExclusive), newest first. The window is required so
 * an export never reads the whole append-only ledger; the caller decides the default window.
 */
export async function listStockMovementsForExport(
  ctx: WorkspaceContext,
  query: { productId?: string; warehouseId?: string; from: Date; toExclusive: Date }
): Promise<Array<StockMovementDto & { productName: string; unitOfMeasure: string }>> {
  assertPermission(ctx.permissions, PERMISSIONS.INVENTORY_READ);
  const filter: Filter<StockMovementDoc> = {
    ...tenantFilter(scope(ctx)),
    createdAt: { $gte: query.from, $lt: query.toExclusive },
  };
  if (query.productId) filter.productId = new ObjectId(query.productId);
  if (query.warehouseId) filter.warehouseId = new ObjectId(query.warehouseId);

  const movements = ctx.db.collection<StockMovementDoc>(COLLECTIONS.inventoryStockMovements);
  assertExportWithinLimit(await movements.countDocuments(filter));
  const docs = await movements.find(filter).sort({ createdAt: -1, _id: -1 }).limit(MAX_EXPORT_ROWS).toArray();
  const [labels, products] = await Promise.all([
    movementLabels(ctx.db, ctx, docs),
    ctx.db
      .collection<ProductDoc>(COLLECTIONS.inventoryProducts)
      .find({ ...tenantFilter(scope(ctx)), _id: { $in: [...new Set(docs.map((doc) => doc.productId))] } }, { projection: { name: 1, unitOfMeasure: 1 } })
      .toArray(),
  ]);
  const productById = new Map(products.map((product) => [idKey(product._id), product]));
  return docs.map((doc) => {
    const label = labels.get(idKey(doc.productId) + ":" + idKey(doc.warehouseId));
    const product = productById.get(idKey(doc.productId));
    return {
      ...toMovementDto(doc, label?.sku ?? "", label?.warehouseCode ?? ""),
      productName: product?.name ?? "",
      unitOfMeasure: product?.unitOfMeasure ?? "",
    };
  });
}

export async function listStockMovements(
  ctx: WorkspaceContext,
  query: { productId?: string; warehouseId?: string; page: number }
): Promise<Paged<StockMovementDto>> {
  assertPermission(ctx.permissions, PERMISSIONS.INVENTORY_READ);
  const filter: Filter<StockMovementDoc> = { ...tenantFilter(scope(ctx)) };
  if (query.productId) filter.productId = new ObjectId(query.productId);
  if (query.warehouseId) filter.warehouseId = new ObjectId(query.warehouseId);

  const movements = ctx.db.collection<StockMovementDoc>(COLLECTIONS.inventoryStockMovements);
  const [total, docs] = await Promise.all([
    movements.countDocuments(filter),
    movements
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(skipFor(query.page, MOVEMENT_PAGE_SIZE))
      .limit(MOVEMENT_PAGE_SIZE)
      .toArray(),
  ]);
  const labels = await movementLabels(ctx.db, ctx, docs);
  return {
    items: docs.map((doc) => {
      const label = labels.get(idKey(doc.productId) + ":" + idKey(doc.warehouseId));
      return toMovementDto(doc, label?.sku ?? "", label?.warehouseCode ?? "");
    }),
    ...pageInfo(query.page, MOVEMENT_PAGE_SIZE, total),
  };
}

/** Batched product SKU and warehouse code labels for a set of movements. */
export async function movementLabels(
  db: Db,
  ctx: WorkspaceContext,
  movements: StockMovementDoc[]
): Promise<Map<string, { sku: string; warehouseCode: string }>> {
  if (movements.length === 0) return new Map();
  const productIds = [...new Set(movements.map((m) => idKey(m.productId)))].map((id) => new ObjectId(id));
  const warehouseIds = [...new Set(movements.map((m) => idKey(m.warehouseId)))].map((id) => new ObjectId(id));
  const [products, warehouses] = await Promise.all([
    db.collection<ProductDoc>(COLLECTIONS.inventoryProducts).find({ ...tenantFilter(scope(ctx)), _id: { $in: productIds } }, { projection: { sku: 1 } }).toArray(),
    db.collection<WarehouseDoc>(COLLECTIONS.inventoryWarehouses).find({ ...tenantFilter(scope(ctx)), _id: { $in: warehouseIds } }, { projection: { code: 1 } }).toArray(),
  ]);
  const skuById = new Map(products.map((p) => [idKey(p._id), p.sku]));
  const codeById = new Map(warehouses.map((w) => [idKey(w._id), w.code]));
  const result = new Map<string, { sku: string; warehouseCode: string }>();
  for (const movement of movements) {
    result.set(idKey(movement.productId) + ":" + idKey(movement.warehouseId), {
      sku: skuById.get(idKey(movement.productId)) ?? "",
      warehouseCode: codeById.get(idKey(movement.warehouseId)) ?? "",
    });
  }
  return result;
}

// ---------- Manual stock operations ----------

async function commitManualMovement(
  ctx: WorkspaceContext,
  entries: LedgerEntry[],
  audit: { action: string; entityId: ObjectId; metadata: Record<string, string | number | boolean> }
): Promise<void> {
  await withTransaction(ctx.db, async (tx) => {
    await applyLedgerEntries(ctx.db, scope(ctx), ctx.userId, entries, tx);
    await recordAudit(
      ctx.db,
      {
        companyId: ctx.companyId,
        actorUserId: ctx.userId,
        action: audit.action,
        entityType: "stock",
        entityId: idKey(audit.entityId),
        requestId: ctx.requestId,
        metadata: audit.metadata,
      },
      tx
    );
  });
}

/** Goods received without a purchase order (for example, a gift or a found stock count). */
export async function receiveStock(ctx: WorkspaceContext, input: StockMoveInput): Promise<void> {
  assertPermission(ctx.permissions, PERMISSIONS.INVENTORY_STOCK_MOVE);
  const productId = new ObjectId(input.productId);
  const warehouseId = new ObjectId(input.warehouseId);
  const quantity = parseQuantity(input.quantity);
  await commitManualMovement(
    ctx,
    [
      {
        productId,
        warehouseId,
        deltaMicro: quantity,
        movementType: "receipt",
        sourceType: "manual",
        sourceId: null,
        reason: input.reason || "Manual receipt",
      },
    ],
    { action: "inventory.stock.received", entityId: productId, metadata: { warehouseId: input.warehouseId, quantityMicro: quantity } }
  );
}

/** Issues stock out of a warehouse. Fails with INSUFFICIENT_STOCK instead of creating negative balances. */
export async function issueStock(ctx: WorkspaceContext, input: StockMoveInput): Promise<void> {
  assertPermission(ctx.permissions, PERMISSIONS.INVENTORY_STOCK_MOVE);
  if (!input.reason) throw new AppError("VALIDATION_ERROR", "A reason is required for stock issues", { reason: "Reason is required" });
  const productId = new ObjectId(input.productId);
  const warehouseId = new ObjectId(input.warehouseId);
  const quantity = parseQuantity(input.quantity);
  await commitManualMovement(
    ctx,
    [
      {
        productId,
        warehouseId,
        deltaMicro: -quantity,
        movementType: "issue",
        sourceType: "manual",
        sourceId: null,
        reason: input.reason,
      },
    ],
    { action: "inventory.stock.issued", entityId: productId, metadata: { warehouseId: input.warehouseId, quantityMicro: quantity } }
  );
}

/** Moves stock between two warehouses as a pair of linked movements sharing one transfer ID. */
export async function transferStock(ctx: WorkspaceContext, input: StockTransferInput): Promise<void> {
  assertPermission(ctx.permissions, PERMISSIONS.INVENTORY_STOCK_MOVE);
  const productId = new ObjectId(input.productId);
  const fromWarehouseId = new ObjectId(input.fromWarehouseId);
  const toWarehouseId = new ObjectId(input.toWarehouseId);
  const quantity = parseQuantity(input.quantity);
  const transferId = new ObjectId();
  const reason = input.reason || "Warehouse transfer";
  await commitManualMovement(
    ctx,
    [
      { productId, warehouseId: fromWarehouseId, deltaMicro: -quantity, movementType: "transfer_out", sourceType: "transfer", sourceId: transferId, reason },
      { productId, warehouseId: toWarehouseId, deltaMicro: quantity, movementType: "transfer_in", sourceType: "transfer", sourceId: transferId, reason },
    ],
    {
      action: "inventory.stock.transferred",
      entityId: productId,
      metadata: { transferId: idKey(transferId), fromWarehouseId: input.fromWarehouseId, toWarehouseId: input.toWarehouseId, quantityMicro: quantity },
    }
  );
}

/**
 * Corrects an on-hand count. Requires a reason. Adjustments are posted immediately
 * and are restricted to owner and admin roles; no second-person approval flow exists yet.
 */
export async function adjustStock(ctx: WorkspaceContext, input: StockAdjustmentInput): Promise<void> {
  assertPermission(ctx.permissions, PERMISSIONS.INVENTORY_STOCK_ADJUST);
  const productId = new ObjectId(input.productId);
  const warehouseId = new ObjectId(input.warehouseId);
  const delta = parseSignedQuantity(input.delta);
  await commitManualMovement(
    ctx,
    [
      { productId, warehouseId, deltaMicro: delta, movementType: "adjustment", sourceType: "manual", sourceId: null, reason: input.reason },
    ],
    { action: "inventory.stock.adjusted", entityId: productId, metadata: { warehouseId: input.warehouseId, deltaMicro: delta } }
  );
}
