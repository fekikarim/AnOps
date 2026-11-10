import "server-only";
import { ObjectId, type Db, type Filter } from "mongodb";
import {
  COLLECTIONS,
  type BomDoc,
  type GoodsReceiptDoc,
  type ProductCategoryDoc,
  type ProductDoc,
  type PurchaseOrderDoc,
  type StockBalanceDoc,
  type StockMovementDoc,
  type TenantScope,
  type WarehouseDoc,
  type WorkOrderDoc,
} from "@/server/db/documents";
import { tenantFilter, escapeRegex, MAX_BOUNDED_LIST } from "@/server/db/scope";
import { pageInfo, skipFor } from "@/server/db/pagination";
import { assertPermission, PERMISSIONS } from "@/server/security/permissions";
import type { WorkspaceContext } from "@/server/tenancy/workspace";
import { AppError } from "@/shared/lib/errors";
import { formatMoneyAmount, parseMoney, parseQuantity } from "@/shared/lib/fixed-point";
import {
  PRODUCT_PAGE_SIZE,
  type ProductInput,
  type ProductListQuery,
  type ProductUpdateInput,
  type WarehouseInput,
} from "@/features/inventory/schemas/inventory.schema";
import type { CategoryDto, Paged, ProductDto, WarehouseDto } from "@/features/inventory/types";
import { idKey, toProductDto, toWarehouseDto } from "@/server/inventory/mappers";
import { assertExportWithinLimit, MAX_EXPORT_ROWS } from "@/server/exports/limits";

const DUPLICATE_KEY = 11000;

function isDuplicateKey(error: unknown): boolean {
  return (error as { code?: number } | null)?.code === DUPLICATE_KEY;
}

function scope(ctx: WorkspaceContext): TenantScope {
  return { companyId: ctx.companyId };
}

async function sumOnHandByProduct(db: Db, ctx: WorkspaceContext, productIds: ObjectId[]): Promise<Map<string, number>> {
  const rows = await db
    .collection<StockBalanceDoc>(COLLECTIONS.inventoryStockBalances)
    .aggregate<{ _id: ObjectId; onHand: number }>([
      { $match: { ...tenantFilter(scope(ctx)), productId: { $in: productIds } } },
      { $group: { _id: "$productId", onHand: { $sum: "$onHandMicro" } } },
    ])
    .toArray();
  return new Map(rows.map((row) => [idKey(row._id), row.onHand]));
}

async function categoryNames(db: Db, ctx: WorkspaceContext, ids: ObjectId[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .collection<ProductCategoryDoc>(COLLECTIONS.inventoryCategories)
    .find({ ...tenantFilter(scope(ctx)), _id: { $in: ids } }, { projection: { name: 1 } })
    .toArray();
  return new Map(rows.map((row) => [idKey(row._id), row.name]));
}

// ---------- Categories ----------

export async function listCategories(ctx: WorkspaceContext): Promise<CategoryDto[]> {
  assertPermission(ctx.permissions, PERMISSIONS.INVENTORY_READ);
  const categories = await ctx.db
    .collection<ProductCategoryDoc>(COLLECTIONS.inventoryCategories)
    .find(tenantFilter(scope(ctx)))
    .sort({ normalizedName: 1 })
    .limit(MAX_BOUNDED_LIST)
    .toArray();

  const counts = await ctx.db
    .collection<ProductDoc>(COLLECTIONS.inventoryProducts)
    .aggregate<{ _id: ObjectId; count: number }>([
      { $match: { ...tenantFilter(scope(ctx)), isActive: true, categoryId: { $ne: null } } },
      { $group: { _id: "$categoryId", count: { $sum: 1 } } },
    ])
    .toArray();
  const countByCategory = new Map(counts.map((row) => [idKey(row._id), row.count]));

  return categories.map((category) => ({
    id: idKey(category._id),
    name: category.name,
    description: category.description,
    isActive: category.isActive,
    productCount: countByCategory.get(idKey(category._id)) ?? 0,
  }));
}

export async function createCategory(
  ctx: WorkspaceContext,
  input: { name: string; description: string }
): Promise<CategoryDto> {
  assertPermission(ctx.permissions, PERMISSIONS.INVENTORY_PRODUCT_MANAGE);
  const now = new Date();
  const doc: ProductCategoryDoc = {
    _id: new ObjectId(),
    ...tenantFilter(scope(ctx)),
    name: input.name,
    normalizedName: input.name.toLowerCase(),
    description: input.description,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await ctx.db.collection<ProductCategoryDoc>(COLLECTIONS.inventoryCategories).insertOne(doc);
  } catch (error) {
    if (isDuplicateKey(error)) throw new AppError("CONFLICT", "A category with this name already exists");
    throw error;
  }
  return { id: idKey(doc._id), name: doc.name, description: doc.description, isActive: true, productCount: 0 };
}

export async function updateCategory(
  ctx: WorkspaceContext,
  categoryId: string,
  input: { name: string; description: string }
): Promise<CategoryDto> {
  assertPermission(ctx.permissions, PERMISSIONS.INVENTORY_PRODUCT_MANAGE);
  try {
    const result = await ctx.db.collection<ProductCategoryDoc>(COLLECTIONS.inventoryCategories).updateOne(
      { _id: new ObjectId(categoryId), ...tenantFilter(scope(ctx)) },
      {
        $set: {
          name: input.name,
          normalizedName: input.name.toLowerCase(),
          description: input.description,
          updatedAt: new Date(),
        },
      }
    );
    if (result.matchedCount === 0) throw new AppError("NOT_FOUND", "Category not found");
  } catch (error) {
    if (isDuplicateKey(error)) throw new AppError("CONFLICT", "A category with this name already exists");
    throw error;
  }
  const updated = (await listCategories(ctx)).find((category) => category.id === categoryId);
  if (!updated) throw new AppError("NOT_FOUND", "Category not found");
  return updated;
}

/**
 * Archives or restores a category. Categories are never hard-deleted once products
 * have referenced them; archived categories stay visible on those products.
 */
export async function setCategoryActive(ctx: WorkspaceContext, categoryId: string, isActive: boolean): Promise<void> {
  assertPermission(ctx.permissions, PERMISSIONS.INVENTORY_PRODUCT_MANAGE);
  const result = await ctx.db.collection<ProductCategoryDoc>(COLLECTIONS.inventoryCategories).updateOne(
    { _id: new ObjectId(categoryId), ...tenantFilter(scope(ctx)) },
    { $set: { isActive, updatedAt: new Date() } }
  );
  if (result.matchedCount === 0) throw new AppError("NOT_FOUND", "Category not found");
}

// ---------- Products ----------

/** Shared by the product list and the product export, so both show the same rows for the same filters. */
export function productListFilter(ctx: WorkspaceContext, query: Pick<ProductListQuery, "q" | "status" | "categoryId">): Filter<ProductDoc> {
  const filter: Filter<ProductDoc> = { ...tenantFilter(scope(ctx)) };
  if (query.status === "active") filter.isActive = true;
  if (query.status === "archived") filter.isActive = false;
  if (query.categoryId) filter.categoryId = new ObjectId(query.categoryId);
  if (query.q) {
    const name = escapeRegex(query.q.toLowerCase());
    const sku = escapeRegex(query.q.toUpperCase());
    filter.$or = [{ normalizedName: { $regex: `^${name}` } }, { normalizedSku: { $regex: `^${sku}` } }];
  }
  return filter;
}

async function toProductDtos(ctx: WorkspaceContext, docs: ProductDoc[]): Promise<ProductDto[]> {
  const ids = docs.map((doc) => doc._id);
  const categoryIds = docs.flatMap((doc) => (doc.categoryId ? [doc.categoryId] : []));
  const [onHand, names] = await Promise.all([
    sumOnHandByProduct(ctx.db, ctx, ids),
    categoryNames(ctx.db, ctx, categoryIds),
  ]);
  return docs.map((doc) =>
    toProductDto(doc, onHand.get(idKey(doc._id)) ?? 0, doc.categoryId ? names.get(idKey(doc.categoryId)) ?? null : null)
  );
}

export async function listProducts(ctx: WorkspaceContext, query: ProductListQuery): Promise<Paged<ProductDto>> {
  assertPermission(ctx.permissions, PERMISSIONS.INVENTORY_READ);
  const filter = productListFilter(ctx, query);

  const products = ctx.db.collection<ProductDoc>(COLLECTIONS.inventoryProducts);
  const [total, docs] = await Promise.all([
    products.countDocuments(filter),
    products
      .find(filter)
      .sort({ normalizedName: 1, _id: 1 })
      .skip(skipFor(query.page, PRODUCT_PAGE_SIZE))
      .limit(PRODUCT_PAGE_SIZE)
      .toArray(),
  ]);

  return { items: await toProductDtos(ctx, docs), ...pageInfo(query.page, PRODUCT_PAGE_SIZE, total) };
}

/** Every product matching the filters, sorted like the list. Bounded by MAX_EXPORT_ROWS. */
export async function listProductsForExport(ctx: WorkspaceContext, query: Pick<ProductListQuery, "q" | "status" | "categoryId">): Promise<ProductDto[]> {
  assertPermission(ctx.permissions, PERMISSIONS.INVENTORY_READ);
  const filter = productListFilter(ctx, query);
  const products = ctx.db.collection<ProductDoc>(COLLECTIONS.inventoryProducts);
  assertExportWithinLimit(await products.countDocuments(filter));
  const docs = await products.find(filter).sort({ normalizedName: 1, _id: 1 }).limit(MAX_EXPORT_ROWS).toArray();
  return toProductDtos(ctx, docs);
}

export async function getProduct(ctx: WorkspaceContext, productId: string): Promise<ProductDto> {
  assertPermission(ctx.permissions, PERMISSIONS.INVENTORY_READ);
  const doc = await ctx.db
    .collection<ProductDoc>(COLLECTIONS.inventoryProducts)
    .findOne({ _id: new ObjectId(productId), ...tenantFilter(scope(ctx)) });
  if (!doc) throw new AppError("NOT_FOUND", "Product not found");
  const onHand = await sumOnHandByProduct(ctx.db, ctx, [doc._id]);
  const names = await categoryNames(ctx.db, ctx, doc.categoryId ? [doc.categoryId] : []);
  return toProductDto(doc, onHand.get(idKey(doc._id)) ?? 0, doc.categoryId ? names.get(idKey(doc.categoryId)) ?? null : null);
}

/** A client-supplied categoryId is only a selector and must resolve to an active category in this company. */
async function assertActiveCategory(ctx: WorkspaceContext, categoryId: string | null): Promise<ObjectId | null> {
  if (!categoryId) return null;
  const category = await ctx.db
    .collection<ProductCategoryDoc>(COLLECTIONS.inventoryCategories)
    .findOne({ _id: new ObjectId(categoryId), ...tenantFilter(scope(ctx)), isActive: true }, { projection: { _id: 1 } });
  if (!category) throw new AppError("VALIDATION_ERROR", "Choose an active category", { categoryId: "Unknown category" });
  return category._id;
}

export async function createProduct(ctx: WorkspaceContext, input: ProductInput): Promise<ProductDto> {
  assertPermission(ctx.permissions, PERMISSIONS.INVENTORY_PRODUCT_MANAGE);
  const categoryId = await assertActiveCategory(ctx, input.categoryId);
  const now = new Date();
  const doc: ProductDoc = {
    _id: new ObjectId(),
    ...tenantFilter(scope(ctx)),
    categoryId,
    sku: input.sku,
    normalizedSku: input.sku,
    name: input.name,
    normalizedName: input.name.toLowerCase(),
    description: input.description,
    unitOfMeasure: input.unitOfMeasure,
    isStorable: input.isStorable,
    isActive: input.isActive,
    costMilli: parseMoney(input.cost),
    salePriceMilli: parseMoney(input.salePrice),
    reorderPointMicro: parseQuantity(input.reorderPoint),
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
  try {
    await ctx.db.collection<ProductDoc>(COLLECTIONS.inventoryProducts).insertOne(doc);
  } catch (error) {
    if (isDuplicateKey(error)) throw new AppError("CONFLICT", "This SKU is already used by another product", { sku: "SKU already in use" });
    throw error;
  }
  return toProductDto(doc, 0, null);
}

export async function updateProduct(ctx: WorkspaceContext, productId: string, input: ProductUpdateInput): Promise<ProductDto> {
  assertPermission(ctx.permissions, PERMISSIONS.INVENTORY_PRODUCT_MANAGE);
  const productObjectId = new ObjectId(productId);
  const existing = await ctx.db
    .collection<ProductDoc>(COLLECTIONS.inventoryProducts)
    .findOne({ _id: productObjectId, ...tenantFilter(scope(ctx)) });
  if (!existing) throw new AppError("NOT_FOUND", "Product not found");

  if (input.unitOfMeasure !== existing.unitOfMeasure) {
    const hasHistory = await productHasStockHistory(ctx, productObjectId);
    if (hasHistory) {
      throw new AppError("VALIDATION_ERROR", "The unit of measure cannot change after stock has moved", {
        unitOfMeasure: "Locked after stock movements",
      });
    }
  }

  const categoryId = await assertActiveCategory(ctx, input.categoryId);
  const set = {
    sku: input.sku,
    normalizedSku: input.sku,
    name: input.name,
    normalizedName: input.name.toLowerCase(),
    description: input.description,
    categoryId,
    unitOfMeasure: input.unitOfMeasure,
    isStorable: input.isStorable,
    isActive: input.isActive,
    costMilli: parseMoney(input.cost),
    salePriceMilli: parseMoney(input.salePrice),
    reorderPointMicro: parseQuantity(input.reorderPoint),
    updatedAt: new Date(),
  };

  let result;
  try {
    result = await ctx.db.collection<ProductDoc>(COLLECTIONS.inventoryProducts).updateOne(
      { _id: productObjectId, ...tenantFilter(scope(ctx)), version: input.expectedVersion },
      { $set: set, $inc: { version: 1 } }
    );
  } catch (error) {
    if (isDuplicateKey(error)) throw new AppError("CONFLICT", "This SKU is already used by another product", { sku: "SKU already in use" });
    throw error;
  }
  if (result.matchedCount === 0) {
    throw new AppError("CONFLICT", "This product was changed by someone else. Reload and try again.");
  }
  return getProduct(ctx, productId);
}

/** Counts stock movements, order lines, receipts, BOMs and work orders that reference the product. */
export async function productReferenceCount(ctx: WorkspaceContext, productId: ObjectId): Promise<number> {
  const base = tenantFilter(scope(ctx));
  const checks = await Promise.all([
    ctx.db.collection<StockMovementDoc>(COLLECTIONS.inventoryStockMovements).countDocuments({ ...base, productId }, { limit: 1 }),
    ctx.db.collection<PurchaseOrderDoc>(COLLECTIONS.purchaseOrders).countDocuments({ ...base, "lines.productId": productId }, { limit: 1 }),
    ctx.db.collection<GoodsReceiptDoc>(COLLECTIONS.goodsReceipts).countDocuments({ ...base, "lines.productId": productId }, { limit: 1 }),
    ctx.db.collection<BomDoc>(COLLECTIONS.manufacturingBoms).countDocuments({ ...base, $or: [{ finishedProductId: productId }, { "components.productId": productId }] }, { limit: 1 }),
    ctx.db.collection<WorkOrderDoc>(COLLECTIONS.manufacturingWorkOrders).countDocuments({ ...base, $or: [{ finishedProductId: productId }, { "components.productId": productId }] }, { limit: 1 }),
  ]);
  return checks.reduce((sum, count) => sum + count, 0);
}

async function productHasStockHistory(ctx: WorkspaceContext, productId: ObjectId): Promise<boolean> {
  const count = await ctx.db
    .collection<StockMovementDoc>(COLLECTIONS.inventoryStockMovements)
    .countDocuments({ ...tenantFilter(scope(ctx)), productId }, { limit: 1 });
  return count > 0;
}

/**
 * Permanently removes a product only when nothing references it. Referenced products
 * must be archived instead, so historical movements and orders stay traceable.
 */
export async function deleteProduct(ctx: WorkspaceContext, productId: string): Promise<void> {
  assertPermission(ctx.permissions, PERMISSIONS.INVENTORY_PRODUCT_MANAGE);
  const objectId = new ObjectId(productId);
  const existing = await ctx.db
    .collection<ProductDoc>(COLLECTIONS.inventoryProducts)
    .findOne({ _id: objectId, ...tenantFilter(scope(ctx)) }, { projection: { _id: 1 } });
  if (!existing) throw new AppError("NOT_FOUND", "Product not found");

  if ((await productReferenceCount(ctx, objectId)) > 0) {
    throw new AppError("CONFLICT", "This product is referenced by stock, orders or production. Archive it instead.");
  }
  await ctx.db.collection<ProductDoc>(COLLECTIONS.inventoryProducts).deleteOne({ _id: objectId, ...tenantFilter(scope(ctx)) });
}

export async function setProductActive(ctx: WorkspaceContext, productId: string, isActive: boolean): Promise<void> {
  assertPermission(ctx.permissions, PERMISSIONS.INVENTORY_PRODUCT_MANAGE);
  const result = await ctx.db.collection<ProductDoc>(COLLECTIONS.inventoryProducts).updateOne(
    { _id: new ObjectId(productId), ...tenantFilter(scope(ctx)) },
    { $set: { isActive, updatedAt: new Date() }, $inc: { version: 1 } }
  );
  if (result.matchedCount === 0) throw new AppError("NOT_FOUND", "Product not found");
}

/** Minimal active-product list for pickers, bounded to keep the payload small. */
export async function listProductOptions(ctx: WorkspaceContext): Promise<{ id: string; sku: string; name: string; unitOfMeasure: string; isStorable: boolean; cost: string }[]> {
  assertPermission(ctx.permissions, PERMISSIONS.INVENTORY_READ);
  const docs = await ctx.db
    .collection<ProductDoc>(COLLECTIONS.inventoryProducts)
    .find({ ...tenantFilter(scope(ctx)), isActive: true }, { projection: { sku: 1, name: 1, unitOfMeasure: 1, isStorable: 1, costMilli: 1 } })
    .sort({ normalizedName: 1 })
    .limit(MAX_BOUNDED_LIST)
    .toArray();
  return docs.map((doc) => ({
    id: idKey(doc._id),
    sku: doc.sku,
    name: doc.name,
    unitOfMeasure: doc.unitOfMeasure,
    isStorable: doc.isStorable,
    cost: formatMoneyAmount(doc.costMilli, 3),
  }));
}

// ---------- Warehouses ----------

export async function listWarehouses(ctx: WorkspaceContext): Promise<WarehouseDto[]> {
  assertPermission(ctx.permissions, PERMISSIONS.INVENTORY_READ);
  const warehouses = await ctx.db
    .collection<WarehouseDoc>(COLLECTIONS.inventoryWarehouses)
    .find(tenantFilter(scope(ctx)))
    .sort({ name: 1, _id: 1 })
    .limit(MAX_BOUNDED_LIST)
    .toArray();
  const rows = await ctx.db
    .collection<StockBalanceDoc>(COLLECTIONS.inventoryStockBalances)
    .aggregate<{ _id: ObjectId; onHand: number }>([
      { $match: { ...tenantFilter(scope(ctx)), warehouseId: { $in: warehouses.map((w) => w._id) } } },
      { $group: { _id: "$warehouseId", onHand: { $sum: "$onHandMicro" } } },
    ])
    .toArray();
  const totals = new Map(rows.map((row) => [idKey(row._id), row.onHand]));
  return warehouses.map((warehouse) => toWarehouseDto(warehouse, totals.get(idKey(warehouse._id)) ?? 0));
}

export async function getWarehouse(ctx: WorkspaceContext, warehouseId: string): Promise<WarehouseDto> {
  assertPermission(ctx.permissions, PERMISSIONS.INVENTORY_READ);
  const warehouse = await ctx.db
    .collection<WarehouseDoc>(COLLECTIONS.inventoryWarehouses)
    .findOne({ _id: new ObjectId(warehouseId), ...tenantFilter(scope(ctx)) });
  if (!warehouse) throw new AppError("NOT_FOUND", "Warehouse not found");
  const rows = await ctx.db
    .collection<StockBalanceDoc>(COLLECTIONS.inventoryStockBalances)
    .aggregate<{ onHand: number }>([
      { $match: { ...tenantFilter(scope(ctx)), warehouseId: warehouse._id } },
      { $group: { _id: null, onHand: { $sum: "$onHandMicro" } } },
    ])
    .toArray();
  return toWarehouseDto(warehouse, rows[0]?.onHand ?? 0);
}

export async function createWarehouse(ctx: WorkspaceContext, input: WarehouseInput): Promise<WarehouseDto> {
  assertPermission(ctx.permissions, PERMISSIONS.INVENTORY_WAREHOUSE_MANAGE);
  const now = new Date();
  const doc: WarehouseDoc = {
    _id: new ObjectId(),
    ...tenantFilter(scope(ctx)),
    name: input.name,
    code: input.code,
    normalizedCode: input.code,
    address: input.address,
    isActive: input.isActive,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await ctx.db.collection<WarehouseDoc>(COLLECTIONS.inventoryWarehouses).insertOne(doc);
  } catch (error) {
    if (isDuplicateKey(error)) throw new AppError("CONFLICT", "A warehouse with this code already exists", { code: "Code already in use" });
    throw error;
  }
  return toWarehouseDto(doc, 0);
}

export async function updateWarehouse(ctx: WorkspaceContext, warehouseId: string, input: WarehouseInput): Promise<WarehouseDto> {
  assertPermission(ctx.permissions, PERMISSIONS.INVENTORY_WAREHOUSE_MANAGE);
  const objectId = new ObjectId(warehouseId);
  if (!input.isActive) await assertWarehouseEmpty(ctx, objectId);
  try {
    const result = await ctx.db.collection<WarehouseDoc>(COLLECTIONS.inventoryWarehouses).updateOne(
      { _id: objectId, ...tenantFilter(scope(ctx)) },
      {
        $set: {
          name: input.name,
          code: input.code,
          normalizedCode: input.code,
          address: input.address,
          isActive: input.isActive,
          updatedAt: new Date(),
        },
      }
    );
    if (result.matchedCount === 0) throw new AppError("NOT_FOUND", "Warehouse not found");
  } catch (error) {
    if (isDuplicateKey(error)) throw new AppError("CONFLICT", "A warehouse with this code already exists", { code: "Code already in use" });
    throw error;
  }
  return getWarehouse(ctx, warehouseId);
}

/** A warehouse holding stock cannot be deactivated; move the stock out first. */
async function assertWarehouseEmpty(ctx: WorkspaceContext, warehouseId: ObjectId): Promise<void> {
  const rows = await ctx.db
    .collection<StockBalanceDoc>(COLLECTIONS.inventoryStockBalances)
    .aggregate<{ onHand: number }>([
      { $match: { ...tenantFilter(scope(ctx)), warehouseId } },
      { $group: { _id: null, onHand: { $sum: "$onHandMicro" } } },
    ])
    .toArray();
  if ((rows[0]?.onHand ?? 0) > 0) {
    throw new AppError("CONFLICT", "Move all stock out of this warehouse before deactivating it");
  }
}

export async function warehouseOptions(ctx: WorkspaceContext): Promise<{ id: string; code: string; name: string }[]> {
  assertPermission(ctx.permissions, PERMISSIONS.INVENTORY_READ);
  const docs = await ctx.db
    .collection<WarehouseDoc>(COLLECTIONS.inventoryWarehouses)
    .find({ ...tenantFilter(scope(ctx)), isActive: true }, { projection: { code: 1, name: 1 } })
    .sort({ name: 1 })
    .limit(MAX_BOUNDED_LIST)
    .toArray();
  return docs.map((doc) => ({ id: idKey(doc._id), code: doc.code, name: doc.name }));
}
