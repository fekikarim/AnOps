import "server-only";
import { ObjectId, type Db } from "mongodb";
import {
  COLLECTIONS,
  type ProductDoc,
  type StockBalanceDoc,
  type StockMovementDoc,
  type StockMovementSourceType,
  type StockMovementType,
  type TenantScope,
  type WarehouseDoc,
} from "@/server/db/documents";
import type { Tx } from "@/server/db/transactions";
import { quantityFitsUnit } from "@/features/inventory/schemas/inventory.schema";
import { AppError } from "@/shared/lib/errors";
import { formatQuantity } from "@/shared/lib/fixed-point";

/**
 * The stock ledger is the only code that changes inventory balances.
 *
 * Invariants enforced here:
 * 1. Every balance change is accompanied by an append-only movement document.
 * 2. Balances never go negative. Issues use a conditional update (`onHandMicro >= quantity`),
 *    so two concurrent issues cannot both take the last unit. This holds with or without transactions.
 * 3. Each entry is checked against tenant scope, product and warehouse state, and the unit of measure.
 *
 * Writes go through the caller's Tx: inside a replica-set transaction they commit together; on a
 * standalone server each write registers an undo step (see server/db/transactions.ts).
 */

export type LedgerEntry = {
  productId: ObjectId;
  warehouseId: ObjectId;
  /** Signed change in micro-units. Zero is rejected. */
  deltaMicro: number;
  movementType: StockMovementType;
  sourceType: StockMovementSourceType;
  sourceId: ObjectId | null;
  reason: string;
};

export async function applyLedgerEntries(
  db: Db,
  scope: TenantScope,
  actorUserId: ObjectId,
  entries: LedgerEntry[],
  tx: Tx
): Promise<void> {
  if (entries.length === 0) {
    throw new AppError("VALIDATION_ERROR", "No stock changes were provided");
  }

  const productCache = new Map<string, ProductDoc>();
  const warehouseCache = new Map<string, WarehouseDoc>();

  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.deltaMicro) || entry.deltaMicro === 0) {
      throw new AppError("VALIDATION_ERROR", "Stock quantity must be a non-zero whole number");
    }

    const product = await loadProduct(db, scope, entry.productId, tx, productCache);
    await loadWarehouse(db, scope, entry.warehouseId, tx, warehouseCache);

    if (!quantityFitsUnit(product.unitOfMeasure, Math.abs(entry.deltaMicro))) {
      throw new AppError(
        "VALIDATION_ERROR",
        `${product.sku} is counted in whole units; fractional quantities are not allowed`
      );
    }

    if (entry.deltaMicro < 0) {
      await decrementBalance(db, scope, entry, product, tx);
    } else {
      await incrementBalance(db, scope, entry, tx);
    }

    const movement: StockMovementDoc = {
      _id: new ObjectId(),
      companyId: scope.companyId,
      productId: entry.productId,
      warehouseId: entry.warehouseId,
      movementType: entry.movementType,
      deltaMicro: entry.deltaMicro,
      sourceType: entry.sourceType,
      sourceId: entry.sourceId,
      reason: entry.reason,
      actorUserId,
      createdAt: new Date(),
    };
    await db.collection<StockMovementDoc>(COLLECTIONS.inventoryStockMovements).insertOne(movement, { session: tx.session });
    tx.onRollback(() => db.collection(COLLECTIONS.inventoryStockMovements).deleteOne({ _id: movement._id }));
  }
}

async function loadProduct(
  db: Db,
  scope: TenantScope,
  productId: ObjectId,
  tx: Tx,
  cache: Map<string, ProductDoc>
): Promise<ProductDoc> {
  const key = productId.toHexString();
  const cached = cache.get(key);
  if (cached) return cached;
  const product = await db.collection<ProductDoc>(COLLECTIONS.inventoryProducts).findOne(
    { _id: productId, companyId: scope.companyId },
    { session: tx.session }
  );
  if (!product) throw new AppError("NOT_FOUND", "Product not found");
  if (!product.isActive) throw new AppError("VALIDATION_ERROR", `${product.sku} is archived`);
  if (!product.isStorable) throw new AppError("VALIDATION_ERROR", `${product.sku} is not a stored item`);
  cache.set(key, product);
  return product;
}

async function loadWarehouse(
  db: Db,
  scope: TenantScope,
  warehouseId: ObjectId,
  tx: Tx,
  cache: Map<string, WarehouseDoc>
): Promise<WarehouseDoc> {
  const key = warehouseId.toHexString();
  const cached = cache.get(key);
  if (cached) return cached;
  const warehouse = await db.collection<WarehouseDoc>(COLLECTIONS.inventoryWarehouses).findOne(
    { _id: warehouseId, companyId: scope.companyId },
    { session: tx.session }
  );
  if (!warehouse) throw new AppError("NOT_FOUND", "Warehouse not found");
  if (!warehouse.isActive) throw new AppError("VALIDATION_ERROR", `${warehouse.code} is inactive`);
  cache.set(key, warehouse);
  return warehouse;
}

async function decrementBalance(
  db: Db,
  scope: TenantScope,
  entry: LedgerEntry,
  product: ProductDoc,
  tx: Tx
): Promise<void> {
  const required = -entry.deltaMicro;
  const balanceFilter = {
    companyId: scope.companyId,
    productId: entry.productId,
    warehouseId: entry.warehouseId,
  };
  const balances = db.collection<StockBalanceDoc>(COLLECTIONS.inventoryStockBalances);
  const result = await balances.updateOne(
    { ...balanceFilter, onHandMicro: { $gte: required } },
    { $inc: { onHandMicro: entry.deltaMicro }, $set: { updatedAt: new Date() } },
    { session: tx.session }
  );
  if (result.matchedCount === 1) {
    tx.onRollback(() => balances.updateOne(balanceFilter, { $inc: { onHandMicro: required } }));
    return;
  }

  const current = await balances.findOne(balanceFilter, { session: tx.session });
  const available = current?.onHandMicro ?? 0;
  throw new AppError(
    "INSUFFICIENT_STOCK",
    `Insufficient stock for ${product.sku}: ${formatQuantity(available)} ${product.unitOfMeasure} available, ${formatQuantity(required)} required`,
    { sku: product.sku, available: formatQuantity(available), required: formatQuantity(required) }
  );
}

async function incrementBalance(db: Db, scope: TenantScope, entry: LedgerEntry, tx: Tx): Promise<void> {
  const balanceFilter = {
    companyId: scope.companyId,
    productId: entry.productId,
    warehouseId: entry.warehouseId,
  };
  const balances = db.collection<StockBalanceDoc>(COLLECTIONS.inventoryStockBalances);
  await balances.updateOne(
    balanceFilter,
    {
      $inc: { onHandMicro: entry.deltaMicro },
      $set: { updatedAt: new Date() },
      $setOnInsert: { _id: new ObjectId() },
    },
    { upsert: true, session: tx.session }
  );
  // The balance document may remain at zero after an undo. That is harmless and reconciles to zero.
  tx.onRollback(() => balances.updateOne(balanceFilter, { $inc: { onHandMicro: -entry.deltaMicro } }));
}

/** Reads the current on-hand quantity for one product in one warehouse. Zero when no balance exists. */
export async function getOnHandMicro(
  db: Db,
  scope: TenantScope,
  productId: ObjectId,
  warehouseId: ObjectId
): Promise<number> {
  const balance = await db.collection<StockBalanceDoc>(COLLECTIONS.inventoryStockBalances).findOne(
    {
      companyId: scope.companyId,
      productId,
      warehouseId,
    },
    { projection: { onHandMicro: 1 } }
  );
  return balance?.onHandMicro ?? 0;
}
