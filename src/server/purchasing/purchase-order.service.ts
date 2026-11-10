import "server-only";
import { ObjectId, type ClientSession, type Filter } from "mongodb";
import {
  COLLECTIONS,
  type ProductDoc,
  type PurchaseOrderDoc,
  type PurchaseOrderLineSub,
  type PurchaseOrderStatus,
  type SupplierDoc,
  type TenantScope,
} from "@/server/db/documents";
import { escapeRegex, tenantFilter } from "@/server/db/scope";
import { pageInfo, skipFor } from "@/server/db/pagination";
import { nextSequenceNumber } from "@/server/db/counters";
import { withTransaction } from "@/server/db/transactions";
import { recordAudit } from "@/server/audit/audit.service";
import { assertPermission, PERMISSIONS } from "@/server/security/permissions";
import type { WorkspaceContext } from "@/server/tenancy/workspace";
import { assertPurchaseOrderTransition } from "@/server/purchasing/order-state";
import { idKey } from "@/server/inventory/mappers";
import { assertExportWithinLimit, MAX_EXPORT_ROWS } from "@/server/exports/limits";
import { isCountableUnit } from "@/shared/domain/units";
import { AppError } from "@/shared/lib/errors";
import {
  applyBasisPoints,
  formatBasisPoints,
  formatMoneyAmount,
  formatQuantity,
  multiplyQuantityByPrice,
  parseMoney,
  parsePercentToBasisPoints,
  parseQuantity,
  sumSafe,
  isWholeQuantity,
} from "@/shared/lib/fixed-point";
import type { PurchaseOrderInput, PurchaseOrderListQuery } from "@/features/purchasing/schemas/purchasing.schema";
import type {
  OrderOptionDto,
  Paged,
  PurchaseOrderDetailDto,
  PurchaseOrderLineDto,
  PurchaseOrderSummaryDto,
} from "@/features/purchasing/types";
import { PURCHASE_ORDER_PAGE_SIZE } from "@/features/purchasing/schemas/purchasing.schema";

function scope(ctx: WorkspaceContext): TenantScope {
  return { companyId: ctx.companyId };
}

export function toSummaryDto(doc: PurchaseOrderDoc): PurchaseOrderSummaryDto {
  return {
    id: idKey(doc._id),
    orderNumber: doc.orderNumber,
    supplierName: doc.supplierName,
    status: doc.status,
    currencyCode: doc.currencyCode,
    total: formatMoneyAmount(doc.totalMilli, 3),
    lineCount: doc.lines.length,
    expectedDate: doc.expectedDate ? doc.expectedDate.toISOString() : null,
    createdAt: doc.createdAt.toISOString(),
  };
}

function toLineDto(line: PurchaseOrderLineSub): PurchaseOrderLineDto {
  const remainingMicro = Math.max(0, line.orderedMicro - line.receivedMicro);
  return {
    id: idKey(line._id),
    productId: idKey(line.productId),
    sku: line.sku,
    productName: line.productName,
    unitOfMeasure: line.unitOfMeasure,
    ordered: formatQuantity(line.orderedMicro, 3),
    received: formatQuantity(line.receivedMicro, 3),
    remaining: formatQuantity(remainingMicro, 3),
    orderedMicro: line.orderedMicro,
    receivedMicro: line.receivedMicro,
    remainingMicro,
    unitCost: formatMoneyAmount(line.unitCostMilli, 3),
    taxRate: formatBasisPoints(line.taxRateBps),
    lineSubtotal: formatMoneyAmount(line.lineSubtotalMilli, 3),
    lineTax: formatMoneyAmount(line.lineTaxMilli, 3),
  };
}

function hasReceipts(doc: PurchaseOrderDoc): boolean {
  return doc.lines.some((line) => line.receivedMicro > 0);
}

/**
 * Builds the authoritative line totals on the server. Client-supplied prices and totals
 * are never trusted; product names and SKUs are copied as a snapshot.
 */
async function buildLines(
  ctx: WorkspaceContext,
  input: PurchaseOrderInput,
  session?: ClientSession
): Promise<{ lines: PurchaseOrderLineSub[]; subtotalMilli: number; taxMilli: number; totalMilli: number }> {
  const productIds = input.lines.map((line) => new ObjectId(line.productId));
  const products = await ctx.db
    .collection<ProductDoc>(COLLECTIONS.inventoryProducts)
    .find({ ...tenantFilter(scope(ctx)), _id: { $in: productIds } }, { session })
    .toArray();
  const byId = new Map(products.map((product) => [idKey(product._id), product]));

  const lines: PurchaseOrderLineSub[] = input.lines.map((line) => {
    const product = byId.get(line.productId);
    if (!product) throw new AppError("VALIDATION_ERROR", "A selected product no longer exists");
    if (!product.isActive) {
      throw new AppError("VALIDATION_ERROR", `${product.sku} is archived and cannot be ordered`);
    }
    const orderedMicro = parseQuantity(line.quantity);
    if (isCountableUnit(product.unitOfMeasure) && !isWholeQuantity(orderedMicro)) {
      throw new AppError("VALIDATION_ERROR", `${product.sku} is counted in whole units`);
    }
    const unitCostMilli = parseMoney(line.unitCost);
    const taxRateBps = parsePercentToBasisPoints(line.taxRate);
    const lineSubtotalMilli = multiplyQuantityByPrice(orderedMicro, unitCostMilli);
    const lineTaxMilli = applyBasisPoints(lineSubtotalMilli, taxRateBps);
    return {
      _id: new ObjectId(),
      productId: product._id,
      sku: product.sku,
      productName: product.name,
      unitOfMeasure: product.unitOfMeasure,
      orderedMicro,
      receivedMicro: 0,
      unitCostMilli,
      taxRateBps,
      lineSubtotalMilli,
      lineTaxMilli,
    };
  });

  const subtotalMilli = sumSafe(lines.map((line) => line.lineSubtotalMilli), "Subtotal");
  const taxMilli = sumSafe(lines.map((line) => line.lineTaxMilli), "Tax");
  return { lines, subtotalMilli, taxMilli, totalMilli: subtotalMilli + taxMilli };
}

async function loadActiveSupplier(ctx: WorkspaceContext, supplierId: string): Promise<SupplierDoc> {
  const supplier = await ctx.db
    .collection<SupplierDoc>(COLLECTIONS.purchaseSuppliers)
    .findOne({ _id: new ObjectId(supplierId), ...tenantFilter(scope(ctx)) });
  if (!supplier) throw new AppError("VALIDATION_ERROR", "Choose a supplier", { supplierId: "Unknown supplier" });
  if (!supplier.isActive) throw new AppError("VALIDATION_ERROR", "This supplier is inactive", { supplierId: "Inactive supplier" });
  return supplier;
}

function expectedDateOrNull(value: string): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

/** Shared by the purchase-order list and the purchase-order export. */
function purchaseOrderListFilter(ctx: WorkspaceContext, query: Pick<PurchaseOrderListQuery, "status" | "q">): Filter<PurchaseOrderDoc> {
  const filter: Filter<PurchaseOrderDoc> = { ...tenantFilter(scope(ctx)) };
  if (query.status !== "all") filter.status = query.status as PurchaseOrderStatus;
  if (query.q) filter.orderNumber = { $regex: `^${escapeRegex(query.q.toUpperCase())}` };
  return filter;
}

export async function listPurchaseOrders(
  ctx: WorkspaceContext,
  query: PurchaseOrderListQuery
): Promise<Paged<PurchaseOrderSummaryDto>> {
  assertPermission(ctx.permissions, PERMISSIONS.PURCHASING_READ);
  const filter = purchaseOrderListFilter(ctx, query);

  const orders = ctx.db.collection<PurchaseOrderDoc>(COLLECTIONS.purchaseOrders);
  const [total, docs] = await Promise.all([
    orders.countDocuments(filter),
    orders
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(skipFor(query.page, PURCHASE_ORDER_PAGE_SIZE))
      .limit(PURCHASE_ORDER_PAGE_SIZE)
      .toArray(),
  ]);
  return { items: docs.map(toSummaryDto), ...pageInfo(query.page, PURCHASE_ORDER_PAGE_SIZE, total) };
}

export async function getPurchaseOrder(ctx: WorkspaceContext, orderId: string): Promise<PurchaseOrderDetailDto> {
  assertPermission(ctx.permissions, PERMISSIONS.PURCHASING_READ);
  const doc = await ctx.db
    .collection<PurchaseOrderDoc>(COLLECTIONS.purchaseOrders)
    .findOne({ _id: new ObjectId(orderId), ...tenantFilter(scope(ctx)) });
  if (!doc) throw new AppError("NOT_FOUND", "Purchase order not found");
  return toDetailDto(doc, ctx);
}

/** Every purchase order matching the filters, newest first, with all lines. Bounded by MAX_EXPORT_ROWS. */
export async function listPurchaseOrdersForExport(
  ctx: WorkspaceContext,
  query: Pick<PurchaseOrderListQuery, "status" | "q">
): Promise<PurchaseOrderDetailDto[]> {
  assertPermission(ctx.permissions, PERMISSIONS.PURCHASING_READ);
  const filter = purchaseOrderListFilter(ctx, query);
  const orders = ctx.db.collection<PurchaseOrderDoc>(COLLECTIONS.purchaseOrders);
  assertExportWithinLimit(await orders.countDocuments(filter));
  const docs = await orders.find(filter).sort({ createdAt: -1, _id: -1 }).limit(MAX_EXPORT_ROWS).toArray();
  return docs.map((doc) => toDetailDto(doc, ctx));
}

function toDetailDto(doc: PurchaseOrderDoc, ctx: WorkspaceContext): PurchaseOrderDetailDto {
  const isOpenForReceipt = doc.status === "approved" || doc.status === "partially_received";
  return {
    ...toSummaryDto(doc),
    supplierId: idKey(doc.supplierId),
    notes: doc.notes,
    subtotal: formatMoneyAmount(doc.subtotalMilli, 3),
    tax: formatMoneyAmount(doc.taxMilli, 3),
    approvedAt: doc.approvedAt ? doc.approvedAt.toISOString() : null,
    version: doc.version,
    lines: doc.lines.map(toLineDto),
    permissions: {
      canEdit: doc.status === "draft" && ctx.permissions.has(PERMISSIONS.PURCHASING_ORDER_MANAGE),
      canApprove: doc.status === "draft" && ctx.permissions.has(PERMISSIONS.PURCHASING_ORDER_APPROVE),
      canCancel:
        (doc.status === "draft" && ctx.permissions.has(PERMISSIONS.PURCHASING_ORDER_MANAGE)) ||
        (doc.status === "approved" && !hasReceipts(doc) && ctx.permissions.has(PERMISSIONS.PURCHASING_ORDER_APPROVE)),
      canReceive: isOpenForReceipt && ctx.permissions.has(PERMISSIONS.PURCHASING_RECEIPT_POST),
    },
  };
}

/**
 * `origin` is set only by replenishment conversion. The order takes a reserved ID and records its
 * proposal, so a retry or recovery can find the order and the database refuses a second one.
 */
export async function createPurchaseOrder(
  ctx: WorkspaceContext,
  input: PurchaseOrderInput,
  origin?: { orderId: ObjectId; proposalId: ObjectId }
): Promise<PurchaseOrderDetailDto> {
  assertPermission(ctx.permissions, PERMISSIONS.PURCHASING_ORDER_MANAGE);
  const supplier = await loadActiveSupplier(ctx, input.supplierId);
  const { lines, subtotalMilli, taxMilli, totalMilli } = await buildLines(ctx, input);
  const now = new Date();
  const orderNumber = await nextSequenceNumber(ctx.db, `po:${idKey(ctx.companyId)}`, "PO");

  const doc: PurchaseOrderDoc = {
    _id: origin?.orderId ?? new ObjectId(),
    ...tenantFilter(scope(ctx)),
    supplierId: supplier._id,
    supplierName: supplier.name,
    orderNumber,
    status: "draft",
    currencyCode: ctx.currencyCode,
    expectedDate: expectedDateOrNull(input.expectedDate),
    notes: input.notes,
    lines,
    // Written only when an origin is given, so the partial unique index ignores ordinary orders.
    ...(origin ? { sourceReplenishmentProposalId: origin.proposalId } : {}),
    subtotalMilli,
    taxMilli,
    totalMilli,
    createdBy: ctx.userId,
    approvedBy: null,
    approvedAt: null,
    cancelledAt: null,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
  await ctx.db.collection<PurchaseOrderDoc>(COLLECTIONS.purchaseOrders).insertOne(doc);
  return getPurchaseOrder(ctx, idKey(doc._id));
}

/** Only drafts are editable. Approved orders are immutable; corrections use cancel and reissue. */
export async function updatePurchaseOrder(
  ctx: WorkspaceContext,
  orderId: string,
  expectedVersion: number,
  input: PurchaseOrderInput
): Promise<PurchaseOrderDetailDto> {
  assertPermission(ctx.permissions, PERMISSIONS.PURCHASING_ORDER_MANAGE);
  const objectId = new ObjectId(orderId);
  const existing = await ctx.db
    .collection<PurchaseOrderDoc>(COLLECTIONS.purchaseOrders)
    .findOne({ _id: objectId, ...tenantFilter(scope(ctx)) }, { projection: { status: 1, version: 1 } });
  if (!existing) throw new AppError("NOT_FOUND", "Purchase order not found");
  if (existing.status !== "draft") {
    throw new AppError("INVALID_TRANSITION", "Only draft orders can be edited");
  }

  const supplier = await loadActiveSupplier(ctx, input.supplierId);
  const { lines, subtotalMilli, taxMilli, totalMilli } = await buildLines(ctx, input);
  const result = await ctx.db.collection<PurchaseOrderDoc>(COLLECTIONS.purchaseOrders).updateOne(
    { _id: objectId, ...tenantFilter(scope(ctx)), status: "draft", version: expectedVersion },
    {
      $set: {
        supplierId: supplier._id,
        supplierName: supplier.name,
        expectedDate: expectedDateOrNull(input.expectedDate),
        notes: input.notes,
        lines,
        subtotalMilli,
        taxMilli,
        totalMilli,
        updatedAt: new Date(),
      },
      $inc: { version: 1 },
    }
  );
  if (result.matchedCount === 0) {
    throw new AppError("CONFLICT", "This order was changed by someone else. Reload and try again.");
  }
  return getPurchaseOrder(ctx, orderId);
}

/**
 * Approval confirms the order to the supplier. It does NOT increase stock; stock changes
 * only when a goods receipt is posted.
 */
export async function approvePurchaseOrder(ctx: WorkspaceContext, orderId: string, expectedVersion: number): Promise<void> {
  assertPermission(ctx.permissions, PERMISSIONS.PURCHASING_ORDER_APPROVE);
  const objectId = new ObjectId(orderId);
  await withTransaction(ctx.db, async (tx) => {
    const session = tx.session;
    const order = await loadOrderForTransition(ctx, objectId, session);
    assertPurchaseOrderTransition(order.status, "approved");
    if (order.version !== expectedVersion) {
      throw new AppError("CONFLICT", "This order was changed by someone else. Reload and try again.");
    }
    const now = new Date();
    const result = await ctx.db.collection<PurchaseOrderDoc>(COLLECTIONS.purchaseOrders).updateOne(
      { _id: objectId, ...tenantFilter(scope(ctx)), status: "draft", version: expectedVersion },
      { $set: { status: "approved", approvedBy: ctx.userId, approvedAt: now, updatedAt: now }, $inc: { version: 1 } },
      { session }
    );
    if (result.matchedCount === 0) {
      throw new AppError("CONFLICT", "This order was changed by someone else. Reload and try again.");
    }
    tx.onRollback(() =>
      ctx.db.collection<PurchaseOrderDoc>(COLLECTIONS.purchaseOrders).updateOne(
        { _id: objectId },
        { $set: { status: order.status, approvedBy: order.approvedBy, approvedAt: order.approvedAt, updatedAt: order.updatedAt, version: order.version } }
      )
    );
    await recordAudit(
      ctx.db,
      {
        companyId: ctx.companyId,
        actorUserId: ctx.userId,
        action: "purchasing.order.approved",
        entityType: "purchase_order",
        entityId: orderId,
        requestId: ctx.requestId,
        metadata: { totalMilli: order.totalMilli },
      },
      tx
    );
  });
}

/** Cancels a draft, or an approved order that has received nothing. Partially received orders cannot be cancelled. */
export async function cancelPurchaseOrder(ctx: WorkspaceContext, orderId: string, expectedVersion: number): Promise<void> {
  const objectId = new ObjectId(orderId);
  await withTransaction(ctx.db, async (tx) => {
    const session = tx.session;
    const order = await loadOrderForTransition(ctx, objectId, session);
    assertPurchaseOrderTransition(order.status, "cancelled");
    if (order.status === "draft") {
      assertPermission(ctx.permissions, PERMISSIONS.PURCHASING_ORDER_MANAGE);
    } else {
      assertPermission(ctx.permissions, PERMISSIONS.PURCHASING_ORDER_APPROVE);
      if (hasReceipts(order)) {
        throw new AppError("INVALID_TRANSITION", "An order with posted receipts cannot be cancelled");
      }
    }
    if (order.version !== expectedVersion) {
      throw new AppError("CONFLICT", "This order was changed by someone else. Reload and try again.");
    }
    const now = new Date();
    const result = await ctx.db.collection<PurchaseOrderDoc>(COLLECTIONS.purchaseOrders).updateOne(
      {
        _id: objectId,
        ...tenantFilter(scope(ctx)),
        status: order.status,
        version: expectedVersion,
      },
      { $set: { status: "cancelled", cancelledAt: now, updatedAt: now }, $inc: { version: 1 } },
      { session }
    );
    if (result.matchedCount === 0) {
      throw new AppError("CONFLICT", "This order was changed by someone else. Reload and try again.");
    }
    tx.onRollback(() =>
      ctx.db.collection<PurchaseOrderDoc>(COLLECTIONS.purchaseOrders).updateOne(
        { _id: objectId },
        { $set: { status: order.status, cancelledAt: order.cancelledAt, updatedAt: order.updatedAt, version: order.version } }
      )
    );
    await recordAudit(
      ctx.db,
      {
        companyId: ctx.companyId,
        actorUserId: ctx.userId,
        action: "purchasing.order.cancelled",
        entityType: "purchase_order",
        entityId: orderId,
        requestId: ctx.requestId,
        metadata: { previousStatus: order.status },
      },
      tx
    );
  });
}

export async function loadOrderForTransition(
  ctx: WorkspaceContext,
  objectId: ObjectId,
  session?: ClientSession
): Promise<PurchaseOrderDoc> {
  const order = await ctx.db
    .collection<PurchaseOrderDoc>(COLLECTIONS.purchaseOrders)
    .findOne({ _id: objectId, ...tenantFilter(scope(ctx)) }, { session });
  if (!order) throw new AppError("NOT_FOUND", "Purchase order not found");
  return order;
}

/** Open purchase orders for the receipt form picker. */
export async function listOpenOrderOptions(ctx: WorkspaceContext): Promise<OrderOptionDto[]> {
  assertPermission(ctx.permissions, PERMISSIONS.PURCHASING_READ);
  const docs = await ctx.db
    .collection<PurchaseOrderDoc>(COLLECTIONS.purchaseOrders)
    .find(
      { ...tenantFilter(scope(ctx)), status: { $in: ["approved", "partially_received"] } },
      { projection: { orderNumber: 1, supplierName: 1, status: 1 } }
    )
    .sort({ createdAt: -1 })
    .limit(100)
    .toArray();
  return docs.map((doc) => ({
    id: idKey(doc._id),
    orderNumber: doc.orderNumber,
    supplierName: doc.supplierName,
    status: doc.status,
  }));
}

