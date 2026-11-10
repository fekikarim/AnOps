import "server-only";
import { ObjectId } from "mongodb";
import {
  COLLECTIONS,
  type GoodsReceiptDoc,
  type ProductDoc,
  type PurchaseOrderDoc,
  type StockBalanceDoc,
  type WorkOrderDoc,
} from "@/server/db/documents";
import { tenantFilter } from "@/server/db/scope";
import { PERMISSIONS } from "@/server/security/permissions";
import type { WorkspaceContext } from "@/server/tenancy/workspace";
import { idKey } from "@/server/inventory/mappers";
import { getInventorySetupData } from "@/server/inventory/onboarding.service";
import { buildShortagePurchaseHref } from "@/features/purchasing/shortage-link";
import { MAX_ATTENTION_ITEMS, rankAttention, type AttentionItem } from "@/features/inventory/attention";

const OPEN_WORK_ORDER_SCAN = 50;
const LOW_STOCK_SCAN = 500;

const micro = (value: number) => value / 1_000_000;
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/**
 * "What needs my attention?" across Inventory, Purchasing and Manufacturing.
 *
 * Every item is derived from persisted records for the caller's company and only for modules the caller may
 * read. Each item names a concrete next action or explains why work is blocked; nothing is decorative.
 * Definitions are deliberately conservative so the list stays short:
 * - Replenishment: active stored product with a reorder point > 0 and on hand <= reorder point.
 *   Products whose open purchase orders already cover the gap are counted as "on order", not as problems.
 * - Waiting for materials: draft or in-progress work order where a component's remaining need exceeds
 *   the on-hand quantity in the order's warehouse.
 */
export async function getAttentionItems(ctx: WorkspaceContext): Promise<AttentionItem[]> {
  const canInventory = ctx.permissions.has(PERMISSIONS.INVENTORY_READ);
  const canPurchasing = ctx.permissions.has(PERMISSIONS.PURCHASING_READ);
  const canManufacturing = ctx.permissions.has(PERMISSIONS.MANUFACTURING_READ);
  const base = tenantFilter({ companyId: ctx.companyId });
  const items: AttentionItem[] = [];

  const tasks: Promise<void>[] = [];

  if (canInventory) {
    tasks.push(
      (async () => {
        const setup = await getInventorySetupData(ctx);
        if (!setup.progress.isComplete) {
          const next = setup.progress.steps.find((step) => step.id === setup.progress.nextStepId);
          items.push({
            id: "setup",
            module: "inventory",
            severity: setup.progress.isUsable ? "info" : "warning",
            title: setup.progress.isUsable ? "Finish setting up inventory" : "Set up your inventory",
            detail: `${setup.progress.percent}% done. Next: ${next?.title.toLowerCase() ?? "review"}.`,
            actionLabel: "Continue setup",
            href: `/inventory/setup?step=${setup.progress.nextStepId}`,
          });
        }
      })()
    );

    tasks.push(
      (async () => {
        const rows = await ctx.db
          .collection<ProductDoc>(COLLECTIONS.inventoryProducts)
          .aggregate<{ _id: ObjectId; sku: string; reorderPointMicro: number; onHand: number }>([
            { $match: { ...base, isActive: true, isStorable: true, reorderPointMicro: { $gt: 0 } } },
            { $limit: LOW_STOCK_SCAN },
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
            { $project: { sku: 1, reorderPointMicro: 1, onHand: { $ifNull: [{ $arrayElemAt: ["$stock.onHand", 0] }, 0] } } },
            { $match: { $expr: { $lte: ["$onHand", "$reorderPointMicro"] } } },
          ])
          .toArray();
        if (rows.length === 0) return;

        const onOrder = new Map<string, number>();
        if (canPurchasing) {
          const orders = await ctx.db
            .collection<PurchaseOrderDoc>(COLLECTIONS.purchaseOrders)
            .find({ ...base, status: { $in: ["approved", "partially_received"] }, "lines.productId": { $in: rows.map((r) => r._id) } }, { projection: { lines: 1 } })
            .toArray();
          for (const order of orders) {
            for (const line of order.lines) {
              const key = idKey(line.productId);
              onOrder.set(key, (onOrder.get(key) ?? 0) + Math.max(0, line.orderedMicro - line.receivedMicro));
            }
          }
        }
        const uncovered = rows.filter((row) => row.onHand + (onOrder.get(idKey(row._id)) ?? 0) <= row.reorderPointMicro);
        const covered = rows.length - uncovered.length;
        if (uncovered.length > 0) {
          const outOfStock = uncovered.filter((row) => row.onHand <= 0).length;
          const sample = uncovered.slice(0, 3).map((row) => row.sku).join(", ");
          const canOrder = ctx.permissions.has(PERMISSIONS.PURCHASING_ORDER_MANAGE);
          items.push({
            id: "replenish",
            module: "inventory",
            severity: outOfStock > 0 ? "critical" : "warning",
            title: `${plural(uncovered.length, "product")} below the reorder point`,
            detail:
              `${sample}${uncovered.length > 3 ? " and more" : ""}.` +
              (outOfStock > 0 ? ` ${outOfStock} out of stock.` : "") +
              (covered > 0 ? ` ${covered} more already covered by open orders.` : ""),
            actionLabel: canOrder ? "Plan replenishment" : "View stock",
            href: canOrder ? "/purchasing/replenishment" : "/inventory/stock",
          });
        } else if (covered > 0) {
          items.push({
            id: "replenish-covered",
            module: "inventory",
            severity: "info",
            title: `${plural(covered, "low product")} already on order`,
            detail: "Open purchase orders cover the gap. Receive them when they arrive.",
            actionLabel: "View orders",
            href: "/purchasing/orders?status=approved",
          });
        }
      })()
    );
  }

  if (canPurchasing) {
    tasks.push(
      (async () => {
        const orders = ctx.db.collection<PurchaseOrderDoc>(COLLECTIONS.purchaseOrders);
        const receipts = ctx.db.collection<GoodsReceiptDoc>(COLLECTIONS.goodsReceipts);
        const now = new Date();
        const [drafts, awaiting, overdue, draftReceipts] = await Promise.all([
          orders.countDocuments({ ...base, status: "draft" }),
          orders.countDocuments({ ...base, status: { $in: ["approved", "partially_received"] } }),
          orders.countDocuments({ ...base, status: { $in: ["approved", "partially_received"] }, expectedDate: { $ne: null, $lt: now } }),
          receipts.countDocuments({ ...base, status: "draft" }),
        ]);
        const canApprove = ctx.permissions.has(PERMISSIONS.PURCHASING_ORDER_APPROVE);
        if (drafts > 0) {
          items.push({
            id: "po-drafts",
            module: "purchasing",
            severity: "info",
            title: `${plural(drafts, "draft purchase order")} to approve`,
            detail: canApprove ? "Approve them once the supplier and quantities are confirmed." : "Waiting for someone with approval rights.",
            actionLabel: "Review drafts",
            href: "/purchasing/orders?status=draft",
          });
        }
        if (overdue > 0) {
          items.push({
            id: "po-overdue",
            module: "purchasing",
            severity: "warning",
            title: `${plural(overdue, "purchase order")} past the expected date`,
            detail: "Goods were promised but have not been received yet. Contact the supplier or receive what arrived.",
            actionLabel: "Open orders",
            href: "/purchasing/orders?status=approved",
          });
        } else if (awaiting > 0) {
          items.push({
            id: "po-awaiting",
            module: "purchasing",
            severity: "info",
            title: `${plural(awaiting, "purchase order")} awaiting goods`,
            detail: "Record a goods receipt when the delivery arrives so stock is updated.",
            actionLabel: "Open orders",
            href: "/purchasing/orders?status=approved",
          });
        }
        if (draftReceipts > 0) {
          items.push({
            id: "receipts-draft",
            module: "purchasing",
            severity: "warning",
            title: `${plural(draftReceipts, "goods receipt")} not posted`,
            detail: "Stock does not change until a receipt is posted.",
            actionLabel: "Post receipts",
            href: "/purchasing/receipts",
          });
        }
      })()
    );
  }

  if (canManufacturing) {
    tasks.push(
      (async () => {
        const orders = await ctx.db
          .collection<WorkOrderDoc>(COLLECTIONS.manufacturingWorkOrders)
          .find({ ...base, status: { $in: ["draft", "in_progress"] } })
          .sort({ createdAt: 1, _id: 1 })
          .limit(OPEN_WORK_ORDER_SCAN)
          .toArray();
        if (orders.length === 0) return;
        const balances = await ctx.db
          .collection<StockBalanceDoc>(COLLECTIONS.inventoryStockBalances)
          .find({
            ...base,
            warehouseId: { $in: [...new Set(orders.map((o) => idKey(o.warehouseId)))].map((id) => new ObjectId(id)) },
            productId: { $in: [...new Set(orders.flatMap((o) => o.components.map((c) => idKey(c.productId))))].map((id) => new ObjectId(id)) },
          })
          .toArray();
        const onHand = new Map(balances.map((b) => [`${idKey(b.warehouseId)}:${idKey(b.productId)}`, b.onHandMicro]));

        const blocked: { order: WorkOrderDoc; short: { sku: string; productId: string; shortMicro: number }[] }[] = [];
        for (const order of orders) {
          const short = order.components
            .map((component) => {
              const need = Math.max(0, component.plannedMicro - component.consumedMicro);
              const have = onHand.get(`${idKey(order.warehouseId)}:${idKey(component.productId)}`) ?? 0;
              return { sku: component.sku, productId: idKey(component.productId), shortMicro: Math.max(0, need - have) };
            })
            .filter((row) => row.shortMicro > 0);
          if (short.length > 0) blocked.push({ order, short });
        }
        const canOrder = ctx.permissions.has(PERMISSIONS.PURCHASING_ORDER_MANAGE);
        for (const { order, short } of blocked.slice(0, 3)) {
          items.push({
            id: `wo-${idKey(order._id)}`,
            module: "manufacturing",
            severity: order.status === "in_progress" ? "critical" : "warning",
            title: `${order.orderNumber} is waiting for materials`,
            detail: `${plural(short.length, "material")} short: ${short.slice(0, 3).map((row) => row.sku).join(", ")}${short.length > 3 ? " and more" : ""}.`,
            actionLabel: canOrder ? "Order the shortfall" : "See materials",
            href: canOrder
              ? buildShortagePurchaseHref(
                  short.map((row) => ({ productId: row.productId, quantity: String(micro(row.shortMicro)) })),
                  { workOrderId: idKey(order._id) }
                )
              : `/manufacturing/work-orders/${idKey(order._id)}`,
          });
        }
        if (blocked.length > 3) {
          items.push({
            id: "wo-more",
            module: "manufacturing",
            severity: "warning",
            title: `${blocked.length - 3} more work orders are waiting for materials`,
            detail: "Open the list to see which materials are missing.",
            actionLabel: "Open work orders",
            href: "/manufacturing/work-orders",
          });
        }
      })()
    );
  }

  await Promise.all(tasks);
  return rankAttention(items).slice(0, MAX_ATTENTION_ITEMS);
}
