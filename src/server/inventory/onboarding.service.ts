import "server-only";
import { ObjectId } from "mongodb";
import {
  COLLECTIONS,
  type ProductDoc,
  type PurchaseOrderDoc,
  type StockBalanceDoc,
  type SupplierDoc,
  type WarehouseDoc,
} from "@/server/db/documents";
import { tenantFilter } from "@/server/db/scope";
import { assertPermission, PERMISSIONS } from "@/server/security/permissions";
import type { WorkspaceContext } from "@/server/tenancy/workspace";
import { createProduct, getWarehouse, listCategories, listWarehouses } from "@/server/inventory/catalog.service";
import { receiveStock } from "@/server/inventory/stock.service";
import { idKey } from "@/server/inventory/mappers";
import { AppError, isAppError } from "@/shared/lib/errors";
import { parseQuantity } from "@/shared/lib/fixed-point";
import { buildSetupProgress, type SetupCounts, type SetupProgress } from "@/features/inventory/setup-progress";
import type { OpeningStockBatchInput, ProductWithOpeningStockInput } from "@/features/inventory/schemas/inventory.schema";
import type { CategoryDto, OpeningStockBatchResult, ProductCreatedResult, WarehouseDto } from "@/features/inventory/types";

const SETUP_LIST_LIMIT = 50;
const OPENING_STOCK_REASON = "Opening stock";

/**
 * Creates a product and, when asked, posts its opening stock through the stock ledger.
 *
 * Everything that can be checked first is checked before the product is written (permission, warehouse,
 * quantity), so the common failures create nothing. If the stock posting still fails afterwards, the product
 * is kept and the outcome says so plainly: the caller must never report a stock quantity that was not posted.
 */
export async function createProductWithOpeningStock(
  ctx: WorkspaceContext,
  input: ProductWithOpeningStockInput
): Promise<ProductCreatedResult> {
  const { openingWarehouseId, openingQuantity, ...productInput } = input;
  const quantity = parseQuantity(openingQuantity);

  if (quantity > 0) {
    assertPermission(ctx.permissions, PERMISSIONS.INVENTORY_PRODUCT_MANAGE);
    assertPermission(ctx.permissions, PERMISSIONS.INVENTORY_STOCK_MOVE);
    if (!openingWarehouseId) {
      throw new AppError("VALIDATION_ERROR", "Choose the warehouse that holds this stock", { openingWarehouseId: "Required" });
    }
    const warehouse = await getWarehouse(ctx, openingWarehouseId);
    if (!warehouse.isActive) {
      throw new AppError("VALIDATION_ERROR", "Choose an active warehouse", { openingWarehouseId: "Warehouse is archived" });
    }
  }

  const product = await createProduct(ctx, productInput);
  if (quantity <= 0 || !openingWarehouseId) return { product, openingStock: { status: "none" } };

  try {
    await receiveStock(ctx, {
      productId: product.id,
      warehouseId: openingWarehouseId,
      quantity: openingQuantity,
      reason: OPENING_STOCK_REASON,
    });
    return { product, openingStock: { status: "posted" } };
  } catch (error) {
    const message = isAppError(error) ? error.message : "The stock movement could not be recorded.";
    return { product, openingStock: { status: "failed", message } };
  }
}

/**
 * Records opening stock for existing products. Each product is its own ledger transaction, so one rejected
 * entry (for example a fractional quantity for a countable product) never blocks or rolls back the others.
 */
export async function recordOpeningStockBatch(
  ctx: WorkspaceContext,
  input: OpeningStockBatchInput
): Promise<OpeningStockBatchResult> {
  assertPermission(ctx.permissions, PERMISSIONS.INVENTORY_STOCK_MOVE);
  const warehouse = await getWarehouse(ctx, input.warehouseId);
  if (!warehouse.isActive) {
    throw new AppError("VALIDATION_ERROR", "Choose an active warehouse", { warehouseId: "Warehouse is archived" });
  }
  const result: OpeningStockBatchResult = { posted: [], failed: [] };
  for (const entry of input.entries) {
    try {
      await receiveStock(ctx, {
        productId: entry.productId,
        warehouseId: input.warehouseId,
        quantity: entry.quantity,
        reason: OPENING_STOCK_REASON,
      });
      result.posted.push({ productId: entry.productId });
    } catch (error) {
      result.failed.push({
        productId: entry.productId,
        message: isAppError(error) ? error.message : "The stock movement could not be recorded.",
      });
    }
  }
  return result;
}

export type SetupProductRow = {
  id: string;
  sku: string;
  name: string;
  unitOfMeasure: string;
  /** Standard cost, three decimals. */
  cost: string;
  /** True when the product is a stored item with nothing on hand yet. */
  needsOpeningStock: boolean;
};

export type SetupSupplierRow = { id: string; name: string };

export type InventorySetupData = {
  progress: SetupProgress;
  counts: SetupCounts;
  warehouses: WarehouseDto[];
  categories: CategoryDto[];
  products: SetupProductRow[];
  suppliers: SetupSupplierRow[];
  currencyCode: string;
  can: {
    manageWarehouses: boolean;
    manageProducts: boolean;
    moveStock: boolean;
    manageSuppliers: boolean;
    readSuppliers: boolean;
    createOrders: boolean;
    manageBoms: boolean;
  };
};

/** Real counts and the records the guided setup shows, all scoped to the caller's company. */
export async function getInventorySetupData(ctx: WorkspaceContext): Promise<InventorySetupData> {
  assertPermission(ctx.permissions, PERMISSIONS.INVENTORY_READ);
  const base = tenantFilter({ companyId: ctx.companyId });
  const readSuppliers = ctx.permissions.has(PERMISSIONS.PURCHASING_READ);

  const [warehouses, categories, productDocs, stockedIds, supplierDocs] = await Promise.all([
    listWarehouses(ctx),
    listCategories(ctx),
    ctx.db
      .collection<ProductDoc>(COLLECTIONS.inventoryProducts)
      .find({ ...base, isActive: true })
      .sort({ createdAt: -1, _id: -1 })
      .limit(500)
      .toArray(),
    ctx.db
      .collection<StockBalanceDoc>(COLLECTIONS.inventoryStockBalances)
      .distinct("productId", { ...base, onHandMicro: { $gt: 0 } }),
    readSuppliers
      ? ctx.db
          .collection<SupplierDoc>(COLLECTIONS.purchaseSuppliers)
          .find({ ...base, isActive: true }, { projection: { name: 1 } })
          .sort({ normalizedName: 1 })
          .limit(SETUP_LIST_LIMIT)
          .toArray()
      : Promise.resolve([] as SupplierDoc[]),
  ]);

  const supplierCount = readSuppliers
    ? await ctx.db.collection<SupplierDoc>(COLLECTIONS.purchaseSuppliers).countDocuments({ ...base, isActive: true })
    : 0;

  const stocked = new Set((stockedIds as ObjectId[]).map(idKey));
  const storable = productDocs.filter((doc) => doc.isStorable);
  const counts: SetupCounts = {
    warehouses: warehouses.filter((w) => w.isActive).length,
    categories: categories.filter((c) => c.isActive).length,
    products: productDocs.length,
    storableProducts: storable.length,
    productsWithStock: storable.filter((doc) => stocked.has(idKey(doc._id))).length,
    suppliers: supplierCount,
  };

  const products: SetupProductRow[] = productDocs.slice(0, SETUP_LIST_LIMIT).map((doc) => ({
    id: idKey(doc._id),
    sku: doc.sku,
    name: doc.name,
    unitOfMeasure: doc.unitOfMeasure,
    cost: (doc.costMilli / 1000).toFixed(3),
    needsOpeningStock: doc.isStorable && !stocked.has(idKey(doc._id)),
  }));

  return {
    progress: buildSetupProgress(counts),
    counts,
    warehouses: warehouses.filter((w) => w.isActive),
    categories: categories.filter((c) => c.isActive),
    products,
    suppliers: supplierDocs.map((doc) => ({ id: idKey(doc._id), name: doc.name })),
    currencyCode: ctx.currencyCode,
    can: {
      manageWarehouses: ctx.permissions.has(PERMISSIONS.INVENTORY_WAREHOUSE_MANAGE),
      manageProducts: ctx.permissions.has(PERMISSIONS.INVENTORY_PRODUCT_MANAGE),
      moveStock: ctx.permissions.has(PERMISSIONS.INVENTORY_STOCK_MOVE),
      manageSuppliers: ctx.permissions.has(PERMISSIONS.PURCHASING_SUPPLIER_MANAGE),
      readSuppliers,
      createOrders: ctx.permissions.has(PERMISSIONS.PURCHASING_ORDER_MANAGE),
      manageBoms: ctx.permissions.has(PERMISSIONS.MANUFACTURING_BOM_MANAGE),
    },
  };
}

export type ProductStockContext = {
  productId: string;
  onHand: string;
  reorderPoint: string;
  /** Ordered minus received on approved or partially received purchase orders. */
  onOrder: string;
};

/**
 * Stock, reorder level and quantity already on order for a few products, so a purchasing form can show
 * "you have 4, you reorder at 20, 50 are already coming" next to the line the user is typing.
 */
export async function getProductStockContext(ctx: WorkspaceContext, productIds: string[]): Promise<ProductStockContext[]> {
  assertPermission(ctx.permissions, PERMISSIONS.INVENTORY_READ);
  const ids = [...new Set(productIds)].filter((id) => ObjectId.isValid(id)).slice(0, 100).map((id) => new ObjectId(id));
  if (ids.length === 0) return [];
  const base = tenantFilter({ companyId: ctx.companyId });
  const canSeeOrders = ctx.permissions.has(PERMISSIONS.PURCHASING_READ);

  const [products, balances, orders] = await Promise.all([
    ctx.db
      .collection<ProductDoc>(COLLECTIONS.inventoryProducts)
      .find({ ...base, _id: { $in: ids } }, { projection: { reorderPointMicro: 1 } })
      .toArray(),
    ctx.db
      .collection<StockBalanceDoc>(COLLECTIONS.inventoryStockBalances)
      .aggregate<{ _id: ObjectId; onHand: number }>([
        { $match: { ...base, productId: { $in: ids } } },
        { $group: { _id: "$productId", onHand: { $sum: "$onHandMicro" } } },
      ])
      .toArray(),
    canSeeOrders
      ? ctx.db
          .collection<PurchaseOrderDoc>(COLLECTIONS.purchaseOrders)
          .find({ ...base, status: { $in: ["approved", "partially_received"] }, "lines.productId": { $in: ids } }, { projection: { lines: 1 } })
          .toArray()
      : Promise.resolve([] as PurchaseOrderDoc[]),
  ]);

  const onHand = new Map(balances.map((row) => [idKey(row._id), row.onHand]));
  const reorder = new Map(products.map((row) => [idKey(row._id), row.reorderPointMicro]));
  const onOrder = new Map<string, number>();
  for (const order of orders) {
    for (const line of order.lines) {
      const key = idKey(line.productId);
      onOrder.set(key, (onOrder.get(key) ?? 0) + Math.max(0, line.orderedMicro - line.receivedMicro));
    }
  }

  const format = (micro: number) => (micro / 1_000_000).toString();
  return ids
    .map(idKey)
    .filter((key) => reorder.has(key))
    .map((key) => ({
      productId: key,
      onHand: format(onHand.get(key) ?? 0),
      reorderPoint: format(reorder.get(key) ?? 0),
      onOrder: format(onOrder.get(key) ?? 0),
    }));
}

/** Warehouses that can hold stock, for pickers. Archived warehouses are excluded. */
export async function activeWarehouseChoices(ctx: WorkspaceContext): Promise<{ id: string; code: string; name: string }[]> {
  assertPermission(ctx.permissions, PERMISSIONS.INVENTORY_READ);
  const docs = await ctx.db
    .collection<WarehouseDoc>(COLLECTIONS.inventoryWarehouses)
    .find({ ...tenantFilter({ companyId: ctx.companyId }), isActive: true }, { projection: { code: 1, name: 1 } })
    .sort({ name: 1 })
    .limit(200)
    .toArray();
  return docs.map((doc) => ({ id: idKey(doc._id), code: doc.code, name: doc.name }));
}
