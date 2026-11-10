import "server-only";
import { ObjectId } from "mongodb";
import {
  COLLECTIONS,
  type ProductCategoryDoc,
  type ProductDoc,
  type PurchaseOrderDoc,
  type GoodsReceiptDoc,
  type StockMovementDoc,
  type WarehouseDoc,
  type WorkOrderDoc,
} from "@/server/db/documents";
import { tenantFilter } from "@/server/db/scope";
import { assertPermission, PERMISSIONS } from "@/server/security/permissions";
import type { WorkspaceContext } from "@/server/tenancy/workspace";
import { computeStockStatus, idKey, toMovementDto } from "@/server/inventory/mappers";
import { movementLabels } from "@/server/inventory/stock.service";
import { multiplyQuantityByPrice, sumSafe } from "@/shared/lib/fixed-point";
import type { InventoryOverviewDto } from "@/features/inventory/types";

const RECENT_MOVEMENT_LIMIT = 8;

/**
 * Inventory overview. Every figure is computed from persisted data for the caller's company.
 *
 * Definitions:
 * - Low stock: active storable product with a reorder point > 0 and 0 < on-hand <= reorder point.
 * - Out of stock: active storable product with total on-hand <= 0 across all warehouses.
 * - Stock value: sum over active storable products of on-hand x standard cost (valued at the
 *   current cost; no FIFO or average costing is implemented yet).
 * - Pending purchase orders: status approved or partially received.
 * - Goods receipts awaiting posting: receipts in draft status.
 * - Open work orders: status draft or in progress.
 */
export async function getInventoryOverview(ctx: WorkspaceContext): Promise<InventoryOverviewDto> {
  assertPermission(ctx.permissions, PERMISSIONS.INVENTORY_READ);
  const db = ctx.db;
  const base = tenantFilter({ companyId: ctx.companyId });

  const [
    activeProducts,
    categories,
    activeWarehouses,
    pendingPurchaseOrders,
    goodsReceiptsAwaitingPosting,
    openWorkOrders,
    stockRows,
    recent,
  ] = await Promise.all([
    db.collection<ProductDoc>(COLLECTIONS.inventoryProducts).countDocuments({ ...base, isActive: true }),
    db.collection<ProductCategoryDoc>(COLLECTIONS.inventoryCategories).countDocuments({ ...base, isActive: true }),
    db.collection<WarehouseDoc>(COLLECTIONS.inventoryWarehouses).countDocuments({ ...base, isActive: true }),
    db.collection<PurchaseOrderDoc>(COLLECTIONS.purchaseOrders).countDocuments({ ...base, status: { $in: ["approved", "partially_received"] } }),
    db.collection<GoodsReceiptDoc>(COLLECTIONS.goodsReceipts).countDocuments({ ...base, status: "draft" }),
    db.collection<WorkOrderDoc>(COLLECTIONS.manufacturingWorkOrders).countDocuments({ ...base, status: { $in: ["draft", "in_progress"] } }),
    // One pipeline: each active storable product with its total on-hand across warehouses.
    db
      .collection<ProductDoc>(COLLECTIONS.inventoryProducts)
      .aggregate<{ _id: ObjectId; costMilli: number; reorderPointMicro: number; onHand: number }>([
        { $match: { ...base, isActive: true, isStorable: true } },
        {
          $lookup: {
            from: COLLECTIONS.inventoryStockBalances,
            let: { productId: "$_id" },
            pipeline: [
              { $match: { $expr: { $and: [{ $eq: ["$productId", "$$productId"] }, { $eq: ["$companyId", ctx.companyId] }] } } },
              { $group: { _id: null, onHand: { $sum: "$onHandMicro" } } },
            ],
            as: "stock",
          },
        },
        {
          $project: {
            costMilli: 1,
            reorderPointMicro: 1,
            onHand: { $ifNull: [{ $arrayElemAt: ["$stock.onHand", 0] }, 0] },
          },
        },
      ])
      .toArray(),
    db
      .collection<StockMovementDoc>(COLLECTIONS.inventoryStockMovements)
      .find(base)
      .sort({ createdAt: -1, _id: -1 })
      .limit(RECENT_MOVEMENT_LIMIT)
      .toArray(),
  ]);

  let lowStockProducts = 0;
  let outOfStockProducts = 0;
  const valuationTerms: number[] = [];
  for (const row of stockRows) {
    const status = computeStockStatus({ isStorable: true, reorderPointMicro: row.reorderPointMicro }, row.onHand);
    if (status === "out_of_stock") outOfStockProducts += 1;
    if (status === "low_stock") lowStockProducts += 1;
    if (row.onHand > 0) valuationTerms.push(multiplyQuantityByPrice(row.onHand, row.costMilli));
  }

  const labels = await movementLabels(db, ctx, recent);

  return {
    activeProducts,
    categories,
    activeWarehouses,
    lowStockProducts,
    outOfStockProducts,
    stockValueMilli: sumSafe(valuationTerms, "Stock value"),
    pendingPurchaseOrders,
    goodsReceiptsAwaitingPosting,
    openWorkOrders,
    recentMovements: recent.map((doc) => {
      const label = labels.get(idKey(doc.productId) + ":" + idKey(doc.warehouseId));
      return toMovementDto(doc, label?.sku ?? "", label?.warehouseCode ?? "");
    }),
    currencyCode: ctx.currencyCode,
  };
}
