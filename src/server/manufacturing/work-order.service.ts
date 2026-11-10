import "server-only";
import { ObjectId, type Filter } from "mongodb";
import {
  COLLECTIONS,
  type BomDoc,
  type ProductDoc,
  type StockBalanceDoc,
  type TenantScope,
  type WarehouseDoc,
  type WorkOrderComponentSub,
  type WorkOrderDoc,
  type WorkOrderStatus,
} from "@/server/db/documents";
import { tenantFilter } from "@/server/db/scope";
import { pageInfo, skipFor } from "@/server/db/pagination";
import { nextSequenceNumber } from "@/server/db/counters";
import { withTransaction } from "@/server/db/transactions";
import { recordAudit } from "@/server/audit/audit.service";
import { applyLedgerEntries, type LedgerEntry } from "@/server/inventory/stock-ledger";
import { computeStockStatus, idKey, trimDecimal } from "@/server/inventory/mappers";
import { assertPermission, PERMISSIONS } from "@/server/security/permissions";
import type { WorkspaceContext } from "@/server/tenancy/workspace";
import { assertWorkOrderTransition } from "@/server/manufacturing/work-order-state";
import { quantityFitsUnit } from "@/features/inventory/schemas/inventory.schema";
import { isCountableUnit } from "@/shared/domain/units";
import { AppError } from "@/shared/lib/errors";
import { formatQuantity, isWholeQuantity, parseQuantity, scaleQuantity } from "@/shared/lib/fixed-point";
import type { MaterialPreviewInput, WorkOrderInput } from "@/features/manufacturing/schemas/manufacturing.schema";
import type { ManufacturingPage, MaterialAvailabilityDto, WorkOrderDetailDto, WorkOrderSummaryDto } from "@/features/manufacturing/types";

export const WORK_ORDER_PAGE_SIZE = 25;

function scope(ctx: WorkspaceContext): TenantScope {
  return { companyId: ctx.companyId };
}

function toSummary(doc: WorkOrderDoc): WorkOrderSummaryDto {
  return {
    id: idKey(doc._id),
    orderNumber: doc.orderNumber,
    finishedSku: doc.finishedSku,
    finishedName: doc.finishedName,
    plannedQuantity: formatQuantity(doc.plannedQuantityMicro, 3),
    producedQuantity: formatQuantity(doc.producedQuantityMicro, 3),
    status: doc.status,
    plannedStart: doc.plannedStart ? doc.plannedStart.toISOString() : null,
    createdAt: doc.createdAt.toISOString(),
  };
}

/**
 * Planned component requirement for a quantity of finished goods, from the snapshot.
 * Countable components must come out whole; otherwise the order is rejected.
 */
export function plannedComponentMicro(quantityPerUnitMicro: number, finishedQuantityMicro: number): number {
  return scaleQuantity(quantityPerUnitMicro, finishedQuantityMicro);
}

export async function listWorkOrders(
  ctx: WorkspaceContext,
  query: { status: "all" | WorkOrderStatus; page: number }
): Promise<ManufacturingPage<WorkOrderSummaryDto>> {
  assertPermission(ctx.permissions, PERMISSIONS.MANUFACTURING_READ);
  const filter: Filter<WorkOrderDoc> = { ...tenantFilter(scope(ctx)) };
  if (query.status !== "all") filter.status = query.status;
  const orders = ctx.db.collection<WorkOrderDoc>(COLLECTIONS.manufacturingWorkOrders);
  const [total, docs] = await Promise.all([
    orders.countDocuments(filter),
    orders
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(skipFor(query.page, WORK_ORDER_PAGE_SIZE))
      .limit(WORK_ORDER_PAGE_SIZE)
      .toArray(),
  ]);
  return { items: docs.map(toSummary), ...pageInfo(query.page, WORK_ORDER_PAGE_SIZE, total) };
}

/** Shows the planned requirements, the current on-hand per material, and whether each material is sufficient. */
export async function getWorkOrder(ctx: WorkspaceContext, orderId: string): Promise<WorkOrderDetailDto> {
  assertPermission(ctx.permissions, PERMISSIONS.MANUFACTURING_READ);
  const doc = await ctx.db
    .collection<WorkOrderDoc>(COLLECTIONS.manufacturingWorkOrders)
    .findOne({ _id: new ObjectId(orderId), ...tenantFilter(scope(ctx)) });
  if (!doc) throw new AppError("NOT_FOUND", "Work order not found");

  const warehouse = await ctx.db
    .collection<WarehouseDoc>(COLLECTIONS.inventoryWarehouses)
    .findOne({ _id: doc.warehouseId, ...tenantFilter(scope(ctx)) }, { projection: { code: 1 } });
  const balances = await ctx.db
    .collection<StockBalanceDoc>(COLLECTIONS.inventoryStockBalances)
    .find({ ...tenantFilter(scope(ctx)), warehouseId: doc.warehouseId, productId: { $in: doc.components.map((c) => c.productId) } })
    .toArray();
  const onHandByProduct = new Map(balances.map((b) => [idKey(b.productId), b.onHandMicro]));
  const productRows = await ctx.db
    .collection<ProductDoc>(COLLECTIONS.inventoryProducts)
    .find({ ...tenantFilter(scope(ctx)), _id: { $in: doc.components.map((c) => c.productId) } }, { projection: { reorderPointMicro: 1, isStorable: 1 } })
    .toArray();
  const reorder = new Map(productRows.map((p) => [idKey(p._id), p]));

  const canManage = ctx.permissions.has(PERMISSIONS.MANUFACTURING_WORK_ORDER_MANAGE);
  const canExecute = ctx.permissions.has(PERMISSIONS.MANUFACTURING_WORK_ORDER_EXECUTE);
  return {
    ...toSummary(doc),
    bomId: idKey(doc.bomId),
    bomRevision: doc.bomRevision,
    warehouseId: idKey(doc.warehouseId),
    warehouseCode: warehouse?.code ?? "",
    version: doc.version,
    startedAt: doc.startedAt ? doc.startedAt.toISOString() : null,
    completedAt: doc.completedAt ? doc.completedAt.toISOString() : null,
    materials: doc.components.map((component) => {
      const onHand = onHandByProduct.get(idKey(component.productId)) ?? 0;
      const shortfall = Math.max(0, component.plannedMicro - onHand);
      const product = reorder.get(idKey(component.productId));
      return {
        productId: idKey(component.productId),
        sku: component.sku,
        productName: component.productName,
        unitOfMeasure: component.unitOfMeasure,
        planned: formatQuantity(component.plannedMicro, 3),
        consumed: formatQuantity(component.consumedMicro, 3),
        onHand: formatQuantity(onHand, 3),
        shortfall: formatQuantity(shortfall, 3),
        shortfallExact: trimDecimal(formatQuantity(shortfall, 6)),
        stockStatus: computeStockStatus({ isStorable: product?.isStorable ?? false, reorderPointMicro: product?.reorderPointMicro ?? 0 }, onHand),
        sufficient: shortfall === 0,
      };
    }),
    permissions: {
      canStart: doc.status === "draft" && canExecute,
      canComplete: doc.status === "in_progress" && canExecute,
      canCancel:
        (doc.status === "draft" && canManage) || (doc.status === "in_progress" && canExecute),
    },
  };
}

/**
 * Shows what a production run would need against what the chosen warehouse holds right now, before any work
 * order exists. It reads the active BOM and the live balances and writes nothing: completion still re-checks
 * and consumes stock atomically, so this is guidance, never a reservation.
 */
export async function previewMaterialAvailability(ctx: WorkspaceContext, input: MaterialPreviewInput): Promise<MaterialAvailabilityDto> {
  assertPermission(ctx.permissions, PERMISSIONS.MANUFACTURING_READ);
  assertPermission(ctx.permissions, PERMISSIONS.INVENTORY_READ);
  const bom = await ctx.db
    .collection<BomDoc>(COLLECTIONS.manufacturingBoms)
    .findOne({ _id: new ObjectId(input.bomId), ...tenantFilter(scope(ctx)), status: "active" });
  if (!bom) throw new AppError("VALIDATION_ERROR", "Choose an active bill of materials", { bomId: "Unknown BOM" });
  const warehouse = await ctx.db
    .collection<WarehouseDoc>(COLLECTIONS.inventoryWarehouses)
    .findOne({ _id: new ObjectId(input.warehouseId), ...tenantFilter(scope(ctx)) }, { projection: { code: 1 } });
  if (!warehouse) throw new AppError("VALIDATION_ERROR", "Choose a warehouse", { warehouseId: "Unknown warehouse" });

  const quantityMicro = parseQuantity(input.quantity);
  const balances = await ctx.db
    .collection<StockBalanceDoc>(COLLECTIONS.inventoryStockBalances)
    .find({ ...tenantFilter(scope(ctx)), warehouseId: warehouse._id, productId: { $in: bom.components.map((c) => c.productId) } })
    .toArray();
  const onHandByProduct = new Map(balances.map((b) => [idKey(b.productId), b.onHandMicro]));

  const materials = bom.components.map((component) => {
    const plannedMicro = plannedComponentMicro(component.quantityPerUnitMicro, quantityMicro);
    const onHand = onHandByProduct.get(idKey(component.productId)) ?? 0;
    const shortfallMicro = Math.max(0, plannedMicro - onHand);
    return {
      productId: idKey(component.productId),
      sku: component.sku,
      productName: component.productName,
      unitOfMeasure: component.unitOfMeasure,
      planned: formatQuantity(plannedMicro, 3),
      onHand: formatQuantity(onHand, 3),
      shortfall: formatQuantity(shortfallMicro, 3),
      shortfallExact: trimDecimal(formatQuantity(shortfallMicro, 6)),
      sufficient: shortfallMicro === 0,
    };
  });
  return { materials, shortCount: materials.filter((m) => !m.sufficient).length, warehouseCode: warehouse.code };
}

/**
 * Creates a work order from the active BOM. Components are snapshotted from the BOM
 * at this point. Creating an order consumes nothing.
 */
export async function createWorkOrder(ctx: WorkspaceContext, input: WorkOrderInput): Promise<WorkOrderDetailDto> {
  assertPermission(ctx.permissions, PERMISSIONS.MANUFACTURING_WORK_ORDER_MANAGE);
  const bom = await ctx.db
    .collection<BomDoc>(COLLECTIONS.manufacturingBoms)
    .findOne({ _id: new ObjectId(input.bomId), ...tenantFilter(scope(ctx)) });
  if (!bom) throw new AppError("VALIDATION_ERROR", "Choose a bill of materials", { bomId: "Unknown BOM" });
  if (bom.status !== "active") throw new AppError("VALIDATION_ERROR", "Only active BOMs can be produced", { bomId: "BOM is not active" });

  const warehouse = await ctx.db
    .collection<WarehouseDoc>(COLLECTIONS.inventoryWarehouses)
    .findOne({ _id: new ObjectId(input.warehouseId), ...tenantFilter(scope(ctx)) });
  if (!warehouse) throw new AppError("VALIDATION_ERROR", "Choose a warehouse", { warehouseId: "Unknown warehouse" });
  if (!warehouse.isActive) throw new AppError("VALIDATION_ERROR", "This warehouse is inactive", { warehouseId: "Inactive warehouse" });

  const finished = await ctx.db
    .collection<ProductDoc>(COLLECTIONS.inventoryProducts)
    .findOne({ _id: bom.finishedProductId, ...tenantFilter(scope(ctx)) }, { projection: { unitOfMeasure: 1 } });
  if (!finished) throw new AppError("NOT_FOUND", "Finished product not found");

  const quantityMicro = parseQuantity(input.quantity);
  if (!quantityFitsUnit(finished.unitOfMeasure, quantityMicro)) {
    throw new AppError("VALIDATION_ERROR", "Produce whole units of this finished product", { quantity: "Use a whole number" });
  }

  const components: WorkOrderComponentSub[] = bom.components.map((component) => {
    const plannedMicro = plannedComponentMicro(component.quantityPerUnitMicro, quantityMicro);
    if (isCountableUnit(component.unitOfMeasure) && !isWholeQuantity(plannedMicro)) {
      throw new AppError("VALIDATION_ERROR", `${component.sku} requires a fractional count for this quantity`, { quantity: "Adjust the quantity" });
    }
    return {
      productId: component.productId,
      sku: component.sku,
      productName: component.productName,
      unitOfMeasure: component.unitOfMeasure,
      plannedMicro,
      consumedMicro: 0,
    };
  });

  const now = new Date();
  const orderNumber = await nextSequenceNumber(ctx.db, `wo:${idKey(ctx.companyId)}`, "WO");
  const doc: WorkOrderDoc = {
    _id: new ObjectId(),
    ...tenantFilter(scope(ctx)),
    orderNumber,
    bomId: bom._id,
    bomRevision: bom.revision,
    finishedProductId: bom.finishedProductId,
    finishedSku: bom.finishedSku,
    finishedName: bom.finishedName,
    warehouseId: warehouse._id,
    plannedQuantityMicro: quantityMicro,
    producedQuantityMicro: 0,
    status: "draft",
    components,
    plannedStart: input.plannedStart ? new Date(`${input.plannedStart}T00:00:00.000Z`) : null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    createdBy: ctx.userId,
    completedBy: null,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
  await ctx.db.collection<WorkOrderDoc>(COLLECTIONS.manufacturingWorkOrders).insertOne(doc);
  return getWorkOrder(ctx, idKey(doc._id));
}

async function transitionWorkOrder(
  ctx: WorkspaceContext,
  orderId: string,
  expectedVersion: number,
  to: WorkOrderStatus,
  update: (now: Date) => Record<string, unknown>
): Promise<WorkOrderDoc> {
  const objectId = new ObjectId(orderId);
  const existing = await ctx.db
    .collection<WorkOrderDoc>(COLLECTIONS.manufacturingWorkOrders)
    .findOne({ _id: objectId, ...tenantFilter(scope(ctx)) });
  if (!existing) throw new AppError("NOT_FOUND", "Work order not found");
  assertWorkOrderTransition(existing.status, to);
  if (existing.version !== expectedVersion) {
    throw new AppError("CONFLICT", "This work order was changed by someone else. Reload and try again.");
  }
  const now = new Date();
  const result = await ctx.db.collection<WorkOrderDoc>(COLLECTIONS.manufacturingWorkOrders).updateOne(
    { _id: objectId, ...tenantFilter(scope(ctx)), status: existing.status, version: expectedVersion },
    { $set: { ...update(now), status: to, updatedAt: now }, $inc: { version: 1 } }
  );
  if (result.matchedCount === 0) {
    throw new AppError("CONFLICT", "This work order was changed by someone else. Reload and try again.");
  }
  return existing;
}

export async function startWorkOrder(ctx: WorkspaceContext, orderId: string, expectedVersion: number): Promise<void> {
  assertPermission(ctx.permissions, PERMISSIONS.MANUFACTURING_WORK_ORDER_EXECUTE);
  await transitionWorkOrder(ctx, orderId, expectedVersion, "in_progress", (now) => ({ startedAt: now }));
}

/** Cancels a draft (management permission) or an in-progress order (execution permission). No stock moves. */
export async function cancelWorkOrder(ctx: WorkspaceContext, orderId: string, expectedVersion: number): Promise<void> {
  const existing = await ctx.db
    .collection<WorkOrderDoc>(COLLECTIONS.manufacturingWorkOrders)
    .findOne({ _id: new ObjectId(orderId), ...tenantFilter(scope(ctx)) }, { projection: { status: 1 } });
  if (!existing) throw new AppError("NOT_FOUND", "Work order not found");
  assertPermission(
    ctx.permissions,
    existing.status === "in_progress" ? PERMISSIONS.MANUFACTURING_WORK_ORDER_EXECUTE : PERMISSIONS.MANUFACTURING_WORK_ORDER_MANAGE
  );
  await transitionWorkOrder(ctx, orderId, expectedVersion, "cancelled", (now) => ({ cancelledAt: now }));
}

/**
 * Completes an in-progress order atomically:
 * - the status transition is conditional on in_progress and the expected version, so a duplicate request fails;
 * - each component is issued from the warehouse (the ledger rejects the whole transaction on any shortfall);
 * - finished goods are received into the same warehouse;
 * - the audit event commits with the change.
 */
export async function completeWorkOrder(ctx: WorkspaceContext, orderId: string, expectedVersion: number): Promise<void> {
  assertPermission(ctx.permissions, PERMISSIONS.MANUFACTURING_WORK_ORDER_EXECUTE);
  const objectId = new ObjectId(orderId);

  await withTransaction(ctx.db, async (tx) => {
    const session = tx.session;
    const order = await ctx.db
      .collection<WorkOrderDoc>(COLLECTIONS.manufacturingWorkOrders)
      .findOne({ _id: objectId, ...tenantFilter(scope(ctx)) }, { session });
    if (!order) throw new AppError("NOT_FOUND", "Work order not found");
    assertWorkOrderTransition(order.status, "completed");
    if (order.version !== expectedVersion) {
      throw new AppError("CONFLICT", "This work order was changed by someone else. Reload and try again.");
    }

    // Claim first: only one request can move the order from in_progress, so a duplicate
    // request fails here before any component is consumed.
    const now = new Date();
    const claim = await ctx.db.collection<WorkOrderDoc>(COLLECTIONS.manufacturingWorkOrders).updateOne(
      { _id: objectId, ...tenantFilter(scope(ctx)), status: "in_progress", version: expectedVersion },
      {
        $set: {
          status: "completed",
          producedQuantityMicro: order.plannedQuantityMicro,
          components: order.components.map((component) => ({ ...component, consumedMicro: component.plannedMicro })),
          completedAt: now,
          completedBy: ctx.userId,
          updatedAt: now,
        },
        $inc: { version: 1 },
      },
      { session }
    );
    if (claim.matchedCount === 0) {
      throw new AppError("CONFLICT", "This work order was already completed or changed. Reload and try again.");
    }
    tx.onRollback(() =>
      ctx.db.collection<WorkOrderDoc>(COLLECTIONS.manufacturingWorkOrders).updateOne(
        { _id: objectId },
        {
          $set: {
            status: "in_progress",
            producedQuantityMicro: order.producedQuantityMicro,
            components: order.components,
            completedAt: order.completedAt,
            completedBy: order.completedBy,
            updatedAt: order.updatedAt,
            version: order.version,
          },
        }
      )
    );

    const entries: LedgerEntry[] = [];
    for (const component of order.components) {
      if (component.plannedMicro === 0) continue;
      entries.push({
        productId: component.productId,
        warehouseId: order.warehouseId,
        deltaMicro: -component.plannedMicro,
        movementType: "production_consume",
        sourceType: "work_order",
        sourceId: order._id,
        reason: `Consumed for ${order.orderNumber}`,
      });
    }
    entries.push({
      productId: order.finishedProductId,
      warehouseId: order.warehouseId,
      deltaMicro: order.plannedQuantityMicro,
      movementType: "production_output",
      sourceType: "work_order",
      sourceId: order._id,
      reason: `Produced by ${order.orderNumber}`,
    });
    // The ledger rejects the whole operation on any shortfall; the claim above is then undone.
    await applyLedgerEntries(ctx.db, scope(ctx), ctx.userId, entries, tx);

    await recordAudit(
      ctx.db,
      {
        companyId: ctx.companyId,
        actorUserId: ctx.userId,
        action: "manufacturing.work_order.completed",
        entityType: "work_order",
        entityId: orderId,
        requestId: ctx.requestId,
        metadata: { orderNumber: order.orderNumber, producedMicro: order.plannedQuantityMicro },
      },
      tx
    );
  });
}
