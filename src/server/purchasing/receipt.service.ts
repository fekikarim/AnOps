import "server-only";
import { ObjectId, type ClientSession, type Filter } from "mongodb";
import {
  COLLECTIONS,
  type GoodsReceiptDoc,
  type GoodsReceiptLineSub,
  type ProductDoc,
  type PurchaseOrderDoc,
  type TenantScope,
  type WarehouseDoc,
} from "@/server/db/documents";
import { tenantFilter } from "@/server/db/scope";
import { pageInfo, skipFor } from "@/server/db/pagination";
import { nextSequenceNumber } from "@/server/db/counters";
import { withTransaction } from "@/server/db/transactions";
import { recordAudit } from "@/server/audit/audit.service";
import { applyLedgerEntries, type LedgerEntry } from "@/server/inventory/stock-ledger";
import { assertPermission, PERMISSIONS } from "@/server/security/permissions";
import type { WorkspaceContext } from "@/server/tenancy/workspace";
import { assertPurchaseOrderTransition, statusAfterReceipt } from "@/server/purchasing/order-state";
import { idKey } from "@/server/inventory/mappers";
import { assertExportWithinLimit, MAX_EXPORT_ROWS } from "@/server/exports/limits";
import { AppError } from "@/shared/lib/errors";
import { isCountableUnit } from "@/shared/domain/units";
import { formatQuantity, isWholeQuantity, parseQuantity } from "@/shared/lib/fixed-point";
import type { ReceiptInput } from "@/features/purchasing/schemas/purchasing.schema";
import type { Paged, ReceiptDetailDto, ReceiptSummaryDto } from "@/features/purchasing/types";

export const RECEIPT_PAGE_SIZE = 25;

function scope(ctx: WorkspaceContext): TenantScope {
  return { companyId: ctx.companyId };
}

async function warehouseCodes(ctx: WorkspaceContext, ids: ObjectId[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const docs = await ctx.db
    .collection<WarehouseDoc>(COLLECTIONS.inventoryWarehouses)
    .find({ ...tenantFilter(scope(ctx)), _id: { $in: ids } }, { projection: { code: 1 } })
    .toArray();
  return new Map(docs.map((doc) => [idKey(doc._id), doc.code]));
}

function toSummary(doc: GoodsReceiptDoc, warehouseCode: string): ReceiptSummaryDto {
  return {
    id: idKey(doc._id),
    receiptNumber: doc.receiptNumber,
    orderNumber: doc.orderNumber,
    supplierName: doc.supplierName,
    warehouseCode,
    status: doc.status,
    lineCount: doc.lines.length,
    postedAt: doc.postedAt ? doc.postedAt.toISOString() : null,
    createdAt: doc.createdAt.toISOString(),
  };
}

function toDetail(doc: GoodsReceiptDoc, warehouseCode: string, canPost: boolean, canCancel: boolean): ReceiptDetailDto {
  return {
    ...toSummary(doc, warehouseCode),
    purchaseOrderId: idKey(doc.purchaseOrderId),
    warehouseId: idKey(doc.warehouseId),
    version: doc.version,
    lines: doc.lines.map((line) => ({
      purchaseOrderLineId: idKey(line.purchaseOrderLineId),
      sku: line.sku,
      productName: line.productName,
      unitOfMeasure: line.unitOfMeasure,
      quantity: formatQuantity(line.quantityMicro, 3),
    })),
    permissions: { canPost: canPost && doc.status === "draft", canCancel: canCancel && doc.status === "draft" },
  };
}

export async function listReceipts(
  ctx: WorkspaceContext,
  query: { status?: "draft" | "posted" | "cancelled"; page: number }
): Promise<Paged<ReceiptSummaryDto>> {
  assertPermission(ctx.permissions, PERMISSIONS.PURCHASING_READ);
  const filter: Filter<GoodsReceiptDoc> = { ...tenantFilter(scope(ctx)) };
  if (query.status) filter.status = query.status;

  const receipts = ctx.db.collection<GoodsReceiptDoc>(COLLECTIONS.goodsReceipts);
  const [total, docs] = await Promise.all([
    receipts.countDocuments(filter),
    receipts.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skipFor(query.page, RECEIPT_PAGE_SIZE)).limit(RECEIPT_PAGE_SIZE).toArray(),
  ]);
  const codes = await warehouseCodes(ctx, [...new Set(docs.map((d) => idKey(d.warehouseId)))].map((id) => new ObjectId(id)));
  return {
    items: docs.map((doc) => toSummary(doc, codes.get(idKey(doc.warehouseId)) ?? "")),
    ...pageInfo(query.page, RECEIPT_PAGE_SIZE, total),
  };
}

/**
 * Every receipt matching the status filter, newest first, with its lines. Bounded by MAX_EXPORT_ROWS.
 * Only posted receipts are physical stock; drafts and cancelled receipts are exported with their status.
 */
export async function listReceiptsForExport(
  ctx: WorkspaceContext,
  query: { status?: "draft" | "posted" | "cancelled" }
): Promise<ReceiptDetailDto[]> {
  assertPermission(ctx.permissions, PERMISSIONS.PURCHASING_READ);
  const filter: Filter<GoodsReceiptDoc> = { ...tenantFilter(scope(ctx)) };
  if (query.status) filter.status = query.status;

  const receipts = ctx.db.collection<GoodsReceiptDoc>(COLLECTIONS.goodsReceipts);
  assertExportWithinLimit(await receipts.countDocuments(filter));
  const docs = await receipts.find(filter).sort({ createdAt: -1, _id: -1 }).limit(MAX_EXPORT_ROWS).toArray();
  const codes = await warehouseCodes(ctx, [...new Set(docs.map((d) => idKey(d.warehouseId)))].map((id) => new ObjectId(id)));
  return docs.map((doc) => toDetail(doc, codes.get(idKey(doc.warehouseId)) ?? "", false, false));
}

export async function listReceiptsForOrder(ctx: WorkspaceContext, orderId: string): Promise<ReceiptSummaryDto[]> {
  assertPermission(ctx.permissions, PERMISSIONS.PURCHASING_READ);
  const docs = await ctx.db
    .collection<GoodsReceiptDoc>(COLLECTIONS.goodsReceipts)
    .find({ ...tenantFilter(scope(ctx)), purchaseOrderId: new ObjectId(orderId) })
    .sort({ createdAt: 1 })
    .limit(50)
    .toArray();
  const codes = await warehouseCodes(ctx, [...new Set(docs.map((d) => idKey(d.warehouseId)))].map((id) => new ObjectId(id)));
  return docs.map((doc) => toSummary(doc, codes.get(idKey(doc.warehouseId)) ?? ""));
}

export async function getReceipt(ctx: WorkspaceContext, receiptId: string): Promise<ReceiptDetailDto> {
  assertPermission(ctx.permissions, PERMISSIONS.PURCHASING_READ);
  const doc = await ctx.db
    .collection<GoodsReceiptDoc>(COLLECTIONS.goodsReceipts)
    .findOne({ _id: new ObjectId(receiptId), ...tenantFilter(scope(ctx)) });
  if (!doc) throw new AppError("NOT_FOUND", "Goods receipt not found");
  const codes = await warehouseCodes(ctx, [doc.warehouseId]);
  const canPost = ctx.permissions.has(PERMISSIONS.PURCHASING_RECEIPT_POST);
  return toDetail(doc, codes.get(idKey(doc.warehouseId)) ?? "", canPost, canPost);
}

/**
 * Creates a draft receipt. Drafts reserve nothing and change no stock; quantities are
 * validated again at posting time because other receipts may be posted in between.
 */
export async function createReceipt(ctx: WorkspaceContext, input: ReceiptInput): Promise<ReceiptDetailDto> {
  assertPermission(ctx.permissions, PERMISSIONS.PURCHASING_RECEIPT_POST);
  const orderId = new ObjectId(input.purchaseOrderId);
  const order = await ctx.db
    .collection<PurchaseOrderDoc>(COLLECTIONS.purchaseOrders)
    .findOne({ _id: orderId, ...tenantFilter(scope(ctx)) });
  if (!order) throw new AppError("NOT_FOUND", "Purchase order not found");
  if (order.status !== "approved" && order.status !== "partially_received") {
    throw new AppError("INVALID_TRANSITION", "Receipts can only be recorded for approved orders");
  }

  const warehouse = await ctx.db
    .collection<WarehouseDoc>(COLLECTIONS.inventoryWarehouses)
    .findOne({ _id: new ObjectId(input.warehouseId), ...tenantFilter(scope(ctx)) });
  if (!warehouse) throw new AppError("VALIDATION_ERROR", "Choose a warehouse", { warehouseId: "Unknown warehouse" });
  if (!warehouse.isActive) throw new AppError("VALIDATION_ERROR", "This warehouse is inactive", { warehouseId: "Inactive warehouse" });

  const lines = buildReceiptLines(order, input);
  const now = new Date();
  const receiptNumber = await nextSequenceNumber(ctx.db, `gr:${idKey(ctx.companyId)}`, "GR");
  const doc: GoodsReceiptDoc = {
    _id: new ObjectId(),
    ...tenantFilter(scope(ctx)),
    purchaseOrderId: order._id,
    orderNumber: order.orderNumber,
    supplierId: order.supplierId,
    supplierName: order.supplierName,
    warehouseId: warehouse._id,
    receiptNumber,
    status: "draft",
    lines,
    createdBy: ctx.userId,
    postedBy: null,
    postedAt: null,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
  await ctx.db.collection<GoodsReceiptDoc>(COLLECTIONS.goodsReceipts).insertOne(doc);
  return toDetail(doc, warehouse.code, true, true);
}

/** Validates receipt lines against the order's remaining quantities. Zero-quantity lines are skipped. */
function buildReceiptLines(order: PurchaseOrderDoc, input: ReceiptInput): GoodsReceiptLineSub[] {
  const lines: GoodsReceiptLineSub[] = [];
  for (const requested of input.lines) {
    const quantityMicro = parseQuantity(requested.quantity);
    if (quantityMicro === 0) continue;
    const orderLine = order.lines.find((line) => idKey(line._id) === requested.purchaseOrderLineId);
    if (!orderLine) throw new AppError("VALIDATION_ERROR", "A line does not belong to this order");
    if (isCountableUnit(orderLine.unitOfMeasure) && !isWholeQuantity(quantityMicro)) {
      throw new AppError("VALIDATION_ERROR", `${orderLine.sku} is counted in whole units`);
    }
    const remaining = orderLine.orderedMicro - orderLine.receivedMicro;
    if (quantityMicro > remaining) {
      throw new AppError(
        "VALIDATION_ERROR",
        `${orderLine.sku}: only ${formatQuantity(remaining, 3)} ${orderLine.unitOfMeasure} remaining on this order`,
        { quantity: "Exceeds remaining quantity" }
      );
    }
    lines.push({
      purchaseOrderLineId: orderLine._id,
      productId: orderLine.productId,
      sku: orderLine.sku,
      productName: orderLine.productName,
      unitOfMeasure: orderLine.unitOfMeasure,
      quantityMicro,
    });
  }
  if (lines.length === 0) throw new AppError("VALIDATION_ERROR", "Enter a quantity for at least one line");
  return lines;
}

/**
 * Posts a receipt. In one transaction this:
 * - checks the receipt is still a draft (duplicate posting becomes a CONFLICT),
 * - re-validates remaining quantities against the current order version,
 * - advances the order's received quantities and status,
 * - writes receipt movements to the stock ledger, and
 * - records the audit event.
 * Any failure aborts all of it, so stock and order progress never diverge.
 */
export async function postReceipt(ctx: WorkspaceContext, receiptId: string): Promise<ReceiptDetailDto> {
  assertPermission(ctx.permissions, PERMISSIONS.PURCHASING_RECEIPT_POST);
  const receiptObjectId = new ObjectId(receiptId);

  await withTransaction(ctx.db, async (tx) => {
    const session = tx.session;
    const receipt = await loadReceipt(ctx, receiptObjectId, session);
    if (receipt.status !== "draft") {
      throw new AppError("CONFLICT", "This receipt has already been posted or cancelled");
    }

    const order = await ctx.db
      .collection<PurchaseOrderDoc>(COLLECTIONS.purchaseOrders)
      .findOne({ _id: receipt.purchaseOrderId, ...tenantFilter(scope(ctx)) }, { session });
    if (!order) throw new AppError("NOT_FOUND", "Purchase order not found");
    if (order.status !== "approved" && order.status !== "partially_received") {
      throw new AppError("INVALID_TRANSITION", "The purchase order is no longer open for receipts");
    }

    const nextLines = order.lines.map((line) => ({ ...line }));
    for (const receiptLine of receipt.lines) {
      const index = nextLines.findIndex((line) => line._id.equals(receiptLine.purchaseOrderLineId));
      if (index < 0) throw new AppError("VALIDATION_ERROR", "A receipt line no longer matches the order");
      const line = nextLines[index];
      const remaining = line.orderedMicro - line.receivedMicro;
      if (receiptLine.quantityMicro > remaining) {
        throw new AppError("CONFLICT", `${line.sku} no longer has ${formatQuantity(remaining, 3)} remaining on this order`);
      }
      line.receivedMicro += receiptLine.quantityMicro;
    }

    const nextStatus = statusAfterReceipt(nextLines);
    assertPurchaseOrderTransition(order.status, nextStatus);

    const now = new Date();
    const orderUpdate = await ctx.db.collection<PurchaseOrderDoc>(COLLECTIONS.purchaseOrders).updateOne(
      { _id: order._id, ...tenantFilter(scope(ctx)), version: order.version, status: order.status },
      { $set: { lines: nextLines, status: nextStatus, updatedAt: now }, $inc: { version: 1 } },
      { session }
    );
    if (orderUpdate.matchedCount === 0) {
      throw new AppError("CONFLICT", "The purchase order changed while this receipt was posted. Try again.");
    }

    tx.onRollback(() =>
      ctx.db.collection<PurchaseOrderDoc>(COLLECTIONS.purchaseOrders).updateOne(
        { _id: order._id },
        { $set: { lines: order.lines, status: order.status, updatedAt: order.updatedAt, version: order.version } }
      )
    );

    const receiptUpdate = await ctx.db.collection<GoodsReceiptDoc>(COLLECTIONS.goodsReceipts).updateOne(
      { _id: receiptObjectId, ...tenantFilter(scope(ctx)), status: "draft" },
      { $set: { status: "posted", postedBy: ctx.userId, postedAt: now, updatedAt: now }, $inc: { version: 1 } },
      { session }
    );
    if (receiptUpdate.matchedCount === 0) {
      throw new AppError("CONFLICT", "This receipt has already been posted or cancelled");
    }

    tx.onRollback(() =>
      ctx.db.collection<GoodsReceiptDoc>(COLLECTIONS.goodsReceipts).updateOne(
        { _id: receiptObjectId },
        { $set: { status: receipt.status, postedBy: receipt.postedBy, postedAt: receipt.postedAt, updatedAt: receipt.updatedAt, version: receipt.version } }
      )
    );

    const products = await ctx.db
      .collection<ProductDoc>(COLLECTIONS.inventoryProducts)
      .find({ ...tenantFilter(scope(ctx)), _id: { $in: receipt.lines.map((line) => line.productId) } }, { session })
      .toArray();
    const storable = new Map(products.filter((p) => p.isStorable).map((p) => [idKey(p._id), true]));
    const entries: LedgerEntry[] = receipt.lines
      .filter((line) => storable.has(idKey(line.productId)))
      .map((line): LedgerEntry => ({
        productId: line.productId,
        warehouseId: receipt.warehouseId,
        deltaMicro: line.quantityMicro,
        movementType: "receipt",
        sourceType: "goods_receipt",
        sourceId: receipt._id,
        reason: `Receipt ${receipt.receiptNumber} for ${order.orderNumber}`,
      }));
    if (entries.length > 0) {
      await applyLedgerEntries(ctx.db, scope(ctx), ctx.userId, entries, tx);
    }

    await recordAudit(
      ctx.db,
      {
        companyId: ctx.companyId,
        actorUserId: ctx.userId,
        action: "purchasing.receipt.posted",
        entityType: "goods_receipt",
        entityId: receiptId,
        requestId: ctx.requestId,
        metadata: { orderNumber: order.orderNumber, lineCount: receipt.lines.length, orderStatus: nextStatus },
      },
      tx
    );
  });

  return getReceipt(ctx, receiptId);
}

async function loadReceipt(ctx: WorkspaceContext, receiptId: ObjectId, session?: ClientSession): Promise<GoodsReceiptDoc> {
  const receipt = await ctx.db
    .collection<GoodsReceiptDoc>(COLLECTIONS.goodsReceipts)
    .findOne({ _id: receiptId, ...tenantFilter(scope(ctx)) }, { session });
  if (!receipt) throw new AppError("NOT_FOUND", "Goods receipt not found");
  return receipt;
}

/** Cancels a draft receipt. Posted receipts are immutable; corrections need a separate adjustment. */
export async function cancelReceipt(ctx: WorkspaceContext, receiptId: string): Promise<void> {
  assertPermission(ctx.permissions, PERMISSIONS.PURCHASING_RECEIPT_POST);
  const result = await ctx.db.collection<GoodsReceiptDoc>(COLLECTIONS.goodsReceipts).updateOne(
    { _id: new ObjectId(receiptId), ...tenantFilter(scope(ctx)), status: "draft" },
    { $set: { status: "cancelled", updatedAt: new Date() }, $inc: { version: 1 } }
  );
  if (result.matchedCount === 0) {
    throw new AppError("CONFLICT", "Only draft receipts can be cancelled");
  }
}

