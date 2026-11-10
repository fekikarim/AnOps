import "server-only";
import { z } from "zod";
import { defineTool } from "@/server/ai/tools/define-tool";
import { modelRows } from "@/server/ai/tools/inventory.parts";
import { ordersTable, orderCard, proposalCard, proposalsTable, receiptCard, receiptsTable, suppliersTable } from "@/server/ai/tools/purchasing.parts";
import { getProduct, listWarehouses } from "@/server/inventory/catalog.service";
import { createPurchaseOrder, getPurchaseOrder, listPurchaseOrders, approvePurchaseOrder, cancelPurchaseOrder, updatePurchaseOrder } from "@/server/purchasing/purchase-order.service";
import { cancelReceipt, createReceipt, getReceipt, listReceipts, postReceipt } from "@/server/purchasing/receipt.service";
import { convertReplenishmentProposal, generateReplenishmentProposal, getReplenishmentProposal, listReplenishmentProposals } from "@/server/purchasing/replenishment.service";
import { createSupplier, getSupplier, listSuppliers, updateSupplier } from "@/server/purchasing/supplier.service";
import {
  purchaseOrderInputSchema,
  purchaseOrderListQuerySchema,
  receiptInputSchema,
  replenishmentGenerateSchema,
  supplierInputSchema,
  type PurchaseOrderInput,
} from "@/features/purchasing/schemas/purchasing.schema";
import type { PurchaseOrderDetailDto } from "@/features/purchasing/types";
import { PERMISSIONS } from "@/server/security/permissions";
import type { WorkspaceContext } from "@/server/tenancy/workspace";
import { applyBasisPoints, formatMoneyAmount, multiplyQuantityByPrice, parseMoney, parsePercentToBasisPoints, parseQuantity } from "@/shared/lib/fixed-point";
import { AppError } from "@/shared/lib/errors";
import { objectIdSchema } from "@/shared/lib/schema-primitives";
import { toFieldErrors } from "@/shared/lib/validation";
import type { AiDiffRow } from "@/server/db/documents";

/**
 * Purchasing tools: thin wrappers over the existing services and schemas. Cells: view = reads,
 * create = suppliers, orders, receipts and proposals, edit = changes and receipt posting, delete =
 * cancellations, approve = order approval and turning a proposal into an order.
 * Writes only propose. prepare() reads the current record through the module's own services, validates
 * the complete change with the module's own schema, and builds the diff the person reviews.
 */
const R = PERMISSIONS.PURCHASING_READ;
const decimal = z.union([z.string(), z.number()]).transform((v) => String(v));
const optText = (max: number) => z.string().max(max).optional();
const pageNo = z.number().int().min(1).max(1000).optional();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new AppError("VALIDATION_ERROR", result.error.issues[0]?.message ?? "The request is invalid.", toFieldErrors(result.error));
}

const label = (l: { sku: string; productName: string }) => `${l.sku} · ${l.productName}`;

/** Line totals use the same fixed-point rules as the service, so the preview matches what is stored. */
function totals(lines: { quantity: string; unitCost: string; taxRate: string }[]) {
  let subtotal = 0;
  let tax = 0;
  for (const l of lines) {
    const sub = multiplyQuantityByPrice(parseQuantity(l.quantity), parseMoney(l.unitCost));
    subtotal += sub;
    tax += applyBasisPoints(sub, parsePercentToBasisPoints(l.taxRate));
  }
  return { subtotal, tax, total: subtotal + tax };
}

async function resolveOrderInput(
  ctx: WorkspaceContext,
  raw: {
    supplierId: string;
    expectedDate?: string;
    notes?: string;
    lines: { productId: string; quantity: string; unitCost?: string; taxRate?: string }[];
  }
): Promise<{ input: PurchaseOrderInput; supplierName: string; names: Map<string, string> }> {
  const supplier = await getSupplier(ctx, raw.supplierId);
  if (!supplier.isActive) throw new AppError("VALIDATION_ERROR", `${supplier.name} is inactive.`);
  const names = new Map<string, string>();
  const lines = [];
  for (const line of raw.lines) {
    const product = await getProduct(ctx, line.productId); // real, in this company, or NOT_FOUND
    if (!product.isActive) throw new AppError("VALIDATION_ERROR", `${product.sku} is archived.`);
    names.set(product.id, `${product.sku} · ${product.name}`);
    // A missing cost falls back to the product's own standard cost, a value from the company's records.
    lines.push({ productId: line.productId, quantity: line.quantity, unitCost: line.unitCost ?? product.cost, taxRate: line.taxRate ?? "0" });
  }
  const input = parse(purchaseOrderInputSchema, { supplierId: raw.supplierId, expectedDate: raw.expectedDate ?? "", notes: raw.notes ?? "", lines });
  return { input, supplierName: supplier.name, names };
}

function orderDetails(ctx: WorkspaceContext, input: PurchaseOrderInput, supplierName: string, names: Map<string, string>): AiDiffRow[] {
  const t = totals(input.lines);
  return [
    { label: "Supplier", after: supplierName },
    ...(input.expectedDate ? [{ label: "Expected", after: input.expectedDate }] : []),
    ...input.lines.map((l) => ({ label: names.get(l.productId) ?? "Item", after: `${l.quantity} × ${l.unitCost}${Number(l.taxRate) ? ` (+${l.taxRate}% tax)` : ""}` })),
    { label: "Total", after: `${formatMoneyAmount(t.total, 3)} ${ctx.currencyCode}` },
  ];
}

// ─── Reads ────────────────────────────────────────────────────────────────────

export const listSuppliersTool = defineTool({
  name: "purchasing_list_suppliers",
  module: "purchasing",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "Search or list suppliers (q matches the start of the name). Returns ids for later calls.",
  input: z.object({ q: optText(80), page: pageNo }).strict(),
  async run(ctx, args, { access }) {
    const page = await listSuppliers(ctx, { q: args.q ?? "", page: args.page ?? 1 });
    return {
      summary: `${page.total} supplier${page.total === 1 ? "" : "s"}`,
      parts: [suppliersTable(page, access, { q: args.q ?? "" })],
      data: { total: page.total, suppliers: modelRows(page.items, (s) => ({ id: s.id, name: s.name, active: s.isActive })) },
    };
  },
});

export const listOrdersTool = defineTool({
  name: "purchasing_list_orders",
  module: "purchasing",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "List purchase orders, newest first. status: all, draft, approved, partially_received, received, cancelled. q matches order number or supplier.",
  input: z.object({ status: z.enum(["all", "draft", "approved", "partially_received", "received", "cancelled"]).optional(), q: optText(80), page: pageNo }).strict(),
  async run(ctx, args) {
    const query = parse(purchaseOrderListQuerySchema, { status: args.status, q: args.q ?? "", page: args.page });
    const page = await listPurchaseOrders(ctx, query);
    return {
      summary: `${page.total} order${page.total === 1 ? "" : "s"}`,
      parts: [ordersTable(page, { status: query.status, q: query.q })],
      data: { total: page.total, orders: modelRows(page.items, (o) => ({ id: o.id, number: o.orderNumber, supplier: o.supplierName, status: o.status, total: o.total })) },
    };
  },
});

export const getOrderTool = defineTool({
  name: "purchasing_get_order",
  module: "purchasing",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "Show one purchase order with its lines, received and remaining quantities.",
  input: z.object({ orderId: objectIdSchema }).strict(),
  async run(ctx, args, { access }) {
    const o = await getPurchaseOrder(ctx, args.orderId);
    return {
      summary: `${o.orderNumber} (${o.status})`,
      parts: [orderCard(o, access)],
      data: { id: o.id, number: o.orderNumber, status: o.status, version: o.version, supplierId: o.supplierId, lines: o.lines.map((l) => ({ lineId: l.id, productId: l.productId, sku: l.sku, ordered: l.ordered, received: l.received, remaining: l.remaining })) },
    };
  },
});

export const listReceiptsTool = defineTool({
  name: "purchasing_list_receipts",
  module: "purchasing",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "List goods receipts, newest first. status: draft, posted, cancelled.",
  input: z.object({ status: z.enum(["draft", "posted", "cancelled"]).optional(), page: pageNo }).strict(),
  async run(ctx, args) {
    const page = await listReceipts(ctx, { status: args.status, page: args.page ?? 1 });
    return {
      summary: `${page.total} receipt${page.total === 1 ? "" : "s"}`,
      parts: [receiptsTable(page, args.status ? { status: args.status } : {})],
      data: { total: page.total, receipts: modelRows(page.items, (r) => ({ id: r.id, number: r.receiptNumber, order: r.orderNumber, status: r.status })) },
    };
  },
});

export const getReceiptTool = defineTool({
  name: "purchasing_get_receipt",
  module: "purchasing",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "Show one goods receipt.",
  input: z.object({ receiptId: objectIdSchema }).strict(),
  async run(ctx, args, { access }) {
    const r = await getReceipt(ctx, args.receiptId);
    return { summary: `${r.receiptNumber} (${r.status})`, parts: [receiptCard(r, access)], data: { id: r.id, number: r.receiptNumber, status: r.status, orderId: r.purchaseOrderId } };
  },
});

export const listReplenishmentTool = defineTool({
  name: "purchasing_list_replenishment",
  module: "purchasing",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "List replenishment proposals (what to reorder), newest first.",
  input: z.object({ page: pageNo }).strict(),
  async run(ctx, args) {
    const page = await listReplenishmentProposals(ctx, { page: args.page ?? 1 });
    return {
      summary: `${page.total} proposal${page.total === 1 ? "" : "s"}`,
      parts: [proposalsTable(page, {})],
      data: { total: page.total, proposals: modelRows(page.items, (p) => ({ id: p.id, warehouse: p.warehouseCode, status: p.status, items: p.lineCount })) },
    };
  },
});

export const getReplenishmentTool = defineTool({
  name: "purchasing_get_replenishment",
  module: "purchasing",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "Show one replenishment proposal with suggested quantities per product.",
  input: z.object({ proposalId: objectIdSchema }).strict(),
  async run(ctx, args, { access }) {
    const p = await getReplenishmentProposal(ctx, args.proposalId);
    return { summary: `Replenishment for ${p.warehouseCode} (${p.status})`, parts: [proposalCard(p, access)], data: { id: p.id, status: p.status, version: p.version, lines: p.lines.map((l) => ({ sku: l.sku, suggested: l.suggested })) } };
  },
});

// ─── Writes: suppliers ────────────────────────────────────────────────────────

const supplierFields = {
  name: z.string().max(120),
  email: z.string().max(160).default(""),
  phone: z.string().max(40).default(""),
  taxIdentifier: z.string().max(60).default(""),
  address: z.string().max(300).default(""),
  isActive: z.boolean().default(true),
};

export const createSupplierTool = defineTool({
  name: "purchasing_create_supplier",
  module: "purchasing",
  operation: "create",
  kind: "write",
  risk: "low",
  permission: PERMISSIONS.PURCHASING_SUPPLIER_MANAGE,
  description: "Propose a new supplier. name is required; email, phone, taxIdentifier and address are optional.",
  input: z.object(supplierFields).strict().pipe(supplierInputSchema),
  async prepare(ctx, args) {
    const dup = (await listSuppliers(ctx, { q: args.name, page: 1 })).items.find((s) => s.name.toLowerCase() === args.name.toLowerCase());
    if (dup) throw new AppError("CONFLICT", `A supplier named "${dup.name}" already exists.`);
    return {
      context: {},
      summary: `Create supplier "${args.name}".`,
      details: [{ label: "Name", after: args.name }, ...(args.email ? [{ label: "Email", after: args.email }] : []), ...(args.phone ? [{ label: "Phone", after: args.phone }] : []), ...(args.taxIdentifier ? [{ label: "Tax ID", after: args.taxIdentifier }] : []), ...(args.address ? [{ label: "Address", after: args.address }] : [])],
    };
  },
  async run(ctx, args) {
    const s = await createSupplier(ctx, args);
    return { summary: `Created supplier ${s.name}.` };
  },
});

export const updateSupplierTool = defineTool({
  name: "purchasing_update_supplier",
  module: "purchasing",
  operation: "edit",
  kind: "write",
  risk: "low",
  permission: PERMISSIONS.PURCHASING_SUPPLIER_MANAGE,
  description: "Propose changes to a supplier. Send supplierId and only the fields that change (name, email, phone, taxIdentifier, address, isActive).",
  input: z.object({ supplierId: objectIdSchema, name: optText(120), email: optText(160), phone: optText(40), taxIdentifier: optText(60), address: optText(300), isActive: z.boolean().optional() }).strict(),
  async prepare(ctx, args) {
    const cur = await getSupplier(ctx, args.supplierId);
    const next = parse(supplierInputSchema, {
      name: args.name ?? cur.name,
      email: args.email ?? cur.email,
      phone: args.phone ?? cur.phone,
      taxIdentifier: args.taxIdentifier ?? cur.taxIdentifier,
      address: args.address ?? cur.address,
      isActive: args.isActive ?? cur.isActive,
    });
    const rows: AiDiffRow[] = [];
    const add = (l: string, b: string, a: string) => b !== a && rows.push({ label: l, before: b, after: a });
    add("Name", cur.name, next.name);
    add("Email", cur.email, next.email);
    add("Phone", cur.phone, next.phone);
    add("Tax ID", cur.taxIdentifier, next.taxIdentifier);
    add("Address", cur.address, next.address);
    add("Active", cur.isActive ? "Yes" : "No", next.isActive ? "Yes" : "No");
    if (rows.length === 0) throw new AppError("VALIDATION_ERROR", "That would not change anything.");
    return { context: { input: next, name: cur.name }, summary: `Update supplier "${cur.name}".`, details: rows };
  },
  async run(ctx, args, _env, context) {
    const s = await updateSupplier(ctx, args.supplierId, context.input as Parameters<typeof updateSupplier>[2]);
    return { summary: `Updated supplier ${s.name}.` };
  },
});

// ─── Writes: purchase orders ──────────────────────────────────────────────────

const lineInput = z.object({ productId: objectIdSchema, quantity: decimal, unitCost: decimal.optional(), taxRate: decimal.optional() }).strict();

export const createOrderTool = defineTool({
  name: "purchasing_create_order",
  module: "purchasing",
  operation: "create",
  kind: "write",
  risk: "low",
  permission: PERMISSIONS.PURCHASING_ORDER_MANAGE,
  description:
    "Propose a new DRAFT purchase order. supplierId and lines are required; each line needs productId and quantity. A line without unitCost uses the product's standard cost; without taxRate it is 0. expectedDate is YYYY-MM-DD. The order still has to be approved separately.",
  input: z.object({ supplierId: objectIdSchema, expectedDate: optText(10), notes: optText(1000), lines: z.array(lineInput).min(1).max(100) }).strict(),
  async prepare(ctx, args) {
    const { input, supplierName, names } = await resolveOrderInput(ctx, args as Parameters<typeof resolveOrderInput>[1]);
    return { context: { input }, summary: `Create a draft purchase order for ${supplierName} with ${input.lines.length} line${input.lines.length === 1 ? "" : "s"}.`, details: orderDetails(ctx, input, supplierName, names) };
  },
  async run(ctx, _args, { access }, context) {
    const o = await createPurchaseOrder(ctx, context.input as PurchaseOrderInput);
    return { summary: `Created draft order ${o.orderNumber}.`, parts: [orderCard(o, access)] };
  },
});

function lineRows(o: PurchaseOrderDetailDto) {
  return o.lines.map((l) => ({ productId: l.productId, quantity: l.ordered, unitCost: l.unitCost, taxRate: l.taxRate }));
}

export const updateOrderTool = defineTool({
  name: "purchasing_update_order",
  module: "purchasing",
  operation: "edit",
  kind: "write",
  risk: "low",
  permission: PERMISSIONS.PURCHASING_ORDER_MANAGE,
  description:
    "Propose changes to a DRAFT purchase order. Send orderId and only what changes: supplierId, expectedDate, notes, or lines (the COMPLETE new list of lines, which replaces the old one). Approved orders cannot be edited.",
  input: z.object({ orderId: objectIdSchema, supplierId: objectIdSchema.optional(), expectedDate: optText(10), notes: optText(1000), lines: z.array(lineInput).min(1).max(100).optional(), expectedVersion: z.number().int().min(1).optional() }).strict(),
  async prepare(ctx, args) {
    const cur = await getPurchaseOrder(ctx, args.orderId);
    if (cur.status !== "draft") throw new AppError("INVALID_TRANSITION", `${cur.orderNumber} is ${cur.status}. Only draft orders can be edited.`);
    if (args.expectedVersion !== undefined && args.expectedVersion !== cur.version) throw new AppError("CONFLICT", `${cur.orderNumber} changed since you opened it. Open it again to see the latest.`);
    const { input, supplierName, names } = await resolveOrderInput(ctx, {
      supplierId: args.supplierId ?? cur.supplierId,
      expectedDate: args.expectedDate ?? cur.expectedDate?.slice(0, 10) ?? "",
      notes: args.notes ?? cur.notes,
      lines: (args.lines as Parameters<typeof resolveOrderInput>[1]["lines"] | undefined) ?? lineRows(cur),
    });
    const rows: AiDiffRow[] = [];
    if (input.supplierId !== cur.supplierId) rows.push({ label: "Supplier", before: cur.supplierName, after: supplierName });
    if (input.expectedDate !== (cur.expectedDate?.slice(0, 10) ?? "")) rows.push({ label: "Expected", before: cur.expectedDate?.slice(0, 10) ?? "none", after: input.expectedDate || "none" });
    if (input.notes !== cur.notes) rows.push({ label: "Notes", before: cur.notes || "none", after: input.notes || "none" });
    const before = new Map(cur.lines.map((l) => [l.productId, `${l.ordered} × ${l.unitCost} (+${l.taxRate}%)`]));
    const afterMap = new Map(input.lines.map((l) => [l.productId, `${l.quantity} × ${l.unitCost} (+${l.taxRate}%)`]));
    for (const [id, text] of afterMap) {
      const b = before.get(id);
      const norm = (s: string) => s.replace(/(\d+\.\d*?)0+(?=\D|$)/g, "$1");
      if (b === undefined) rows.push({ label: `Add ${names.get(id) ?? "item"}`, after: text });
      else if (norm(b) !== norm(text)) rows.push({ label: names.get(id) ?? "Item", before: b, after: text });
    }
    for (const l of cur.lines) if (!afterMap.has(l.productId)) rows.push({ label: `Remove ${label(l)}`, before: `${l.ordered} × ${l.unitCost}`, after: "removed" });
    if (rows.length === 0) throw new AppError("VALIDATION_ERROR", "That would not change anything.");
    const t = totals(input.lines);
    rows.push({ label: "New total", after: `${formatMoneyAmount(t.total, 3)} ${ctx.currencyCode}` });
    return { context: { input, version: cur.version, number: cur.orderNumber }, summary: `Update draft order ${cur.orderNumber}.`, details: rows };
  },
  async run(ctx, args, { access }, context) {
    const o = await updatePurchaseOrder(ctx, args.orderId, Number(context.version), context.input as PurchaseOrderInput);
    return { summary: `Updated order ${o.orderNumber}.`, parts: [orderCard(o, access)] };
  },
});

export const approveOrderTool = defineTool({
  name: "purchasing_approve_order",
  module: "purchasing",
  operation: "approve",
  kind: "write",
  risk: "financial",
  permission: PERMISSIONS.PURCHASING_ORDER_APPROVE,
  description: "Propose approving a DRAFT purchase order. Approval commits the order to the supplier. Needs the approve permission.",
  input: z.object({ orderId: objectIdSchema }).strict(),
  async prepare(ctx, args) {
    const o = await getPurchaseOrder(ctx, args.orderId);
    if (o.status !== "draft") throw new AppError("INVALID_TRANSITION", `${o.orderNumber} is ${o.status}. Only draft orders can be approved.`);
    return {
      context: { version: o.version, number: o.orderNumber },
      summary: `Approve ${o.orderNumber} for ${o.supplierName}, total ${o.total} ${o.currencyCode}.`,
      details: [{ label: "Order", after: o.orderNumber }, { label: "Supplier", after: o.supplierName }, { label: "Lines", after: String(o.lineCount) }, { label: "Total", after: `${o.total} ${o.currencyCode}` }],
      typedPhrase: o.orderNumber,
    };
  },
  async run(ctx, args, { access }, context) {
    await approvePurchaseOrder(ctx, args.orderId, Number(context.version));
    const o = await getPurchaseOrder(ctx, args.orderId);
    return { summary: `Approved ${String(context.number)}.`, parts: [orderCard(o, access)] };
  },
});

export const cancelOrderTool = defineTool({
  name: "purchasing_cancel_order",
  module: "purchasing",
  operation: "delete",
  kind: "write",
  risk: "destructive",
  permission: PERMISSIONS.PURCHASING_ORDER_MANAGE,
  description: "Propose cancelling a purchase order (draft, or approved with nothing received). Cancelling cannot be undone.",
  input: z.object({ orderId: objectIdSchema }).strict(),
  async prepare(ctx, args) {
    const o = await getPurchaseOrder(ctx, args.orderId);
    if (!o.permissions.canCancel) throw new AppError("INVALID_TRANSITION", `${o.orderNumber} is ${o.status} and cannot be cancelled by you.`);
    return {
      context: { version: o.version, number: o.orderNumber },
      summary: `Cancel ${o.orderNumber} (${o.supplierName}, ${o.total} ${o.currencyCode}). This cannot be undone.`,
      details: [{ label: "Order", after: `${o.orderNumber} · ${o.status}` }],
      typedPhrase: o.orderNumber,
    };
  },
  async run(ctx, args, _env, context) {
    await cancelPurchaseOrder(ctx, args.orderId, Number(context.version));
    return { summary: `Cancelled ${String(context.number)}.` };
  },
});

// ─── Writes: goods receipts ───────────────────────────────────────────────────

export const createReceiptTool = defineTool({
  name: "purchasing_create_receipt",
  module: "purchasing",
  operation: "create",
  kind: "write",
  risk: "sensitive",
  permission: PERMISSIONS.PURCHASING_RECEIPT_POST,
  description:
    "Propose a DRAFT goods receipt against an APPROVED purchase order. lines use purchaseOrderLineId (from purchasing_get_order) and the received quantity (never more than remaining). Nothing enters stock until the receipt is posted.",
  input: z.object({ purchaseOrderId: objectIdSchema, warehouseId: objectIdSchema, lines: z.array(z.object({ purchaseOrderLineId: objectIdSchema, quantity: decimal }).strict()).min(1).max(100) }).strict().pipe(receiptInputSchema),
  async prepare(ctx, args) {
    const o = await getPurchaseOrder(ctx, args.purchaseOrderId);
    if (o.status !== "approved" && o.status !== "partially_received") throw new AppError("INVALID_TRANSITION", `${o.orderNumber} is ${o.status}. Receipts need an approved order.`);
    const warehouse = (await listWarehouses(ctx)).find((w) => w.id === args.warehouseId);
    if (!warehouse) throw new AppError("NOT_FOUND", "Warehouse not found");
    if (!warehouse.isActive) throw new AppError("VALIDATION_ERROR", `${warehouse.code} is inactive.`);
    const rows: AiDiffRow[] = [{ label: "Order", after: `${o.orderNumber} · ${o.supplierName}` }, { label: "Warehouse", after: `${warehouse.code} · ${warehouse.name}` }];
    for (const l of args.lines) {
      const line = o.lines.find((x) => x.id === l.purchaseOrderLineId);
      if (!line) throw new AppError("VALIDATION_ERROR", "A line does not belong to this order.");
      if (parseQuantity(l.quantity) > line.remainingMicro) throw new AppError("VALIDATION_ERROR", `Only ${line.remaining} ${line.unitOfMeasure} of ${line.sku} remain on this order.`);
      if (parseQuantity(l.quantity) > 0) rows.push({ label: label(line), after: `${l.quantity} ${line.unitOfMeasure} (remaining ${line.remaining})` });
    }
    return { context: { number: o.orderNumber }, summary: `Record a goods receipt for ${o.orderNumber} into ${warehouse.code}. Nothing is added to stock until it is posted.`, details: rows };
  },
  async run(ctx, args, { access }, context) {
    const r = await createReceipt(ctx, args);
    return { summary: `Recorded draft receipt ${r.receiptNumber} for ${String(context.number)}.`, parts: [receiptCard(r, access)] };
  },
});

export const postReceiptTool = defineTool({
  name: "purchasing_post_receipt",
  module: "purchasing",
  operation: "edit",
  kind: "write",
  risk: "sensitive",
  permission: PERMISSIONS.PURCHASING_RECEIPT_POST,
  description: "Propose posting a DRAFT goods receipt. Posting adds the received quantities to stock and updates the order.",
  input: z.object({ receiptId: objectIdSchema }).strict(),
  async prepare(ctx, args) {
    const r = await getReceipt(ctx, args.receiptId);
    if (r.status !== "draft") throw new AppError("INVALID_TRANSITION", `${r.receiptNumber} is ${r.status}. Only draft receipts can be posted.`);
    return {
      context: { number: r.receiptNumber },
      summary: `Post ${r.receiptNumber} into ${r.warehouseCode}. Stock increases as shown.`,
      details: [{ label: "Order", after: r.orderNumber }, ...r.lines.filter((l) => Number(l.quantity) > 0).map((l) => ({ label: l.productName, after: `+${l.quantity} ${l.unitOfMeasure}` }))],
    };
  },
  async run(ctx, args, { access }, context) {
    const r = await postReceipt(ctx, args.receiptId);
    return { summary: `Posted ${String(context.number)}. Stock updated.`, parts: [receiptCard(r, access)] };
  },
});

export const cancelReceiptTool = defineTool({
  name: "purchasing_cancel_receipt",
  module: "purchasing",
  operation: "delete",
  kind: "write",
  risk: "destructive",
  permission: PERMISSIONS.PURCHASING_RECEIPT_POST,
  description: "Propose cancelling a DRAFT goods receipt (nothing was added to stock).",
  input: z.object({ receiptId: objectIdSchema }).strict(),
  async prepare(ctx, args) {
    const r = await getReceipt(ctx, args.receiptId);
    if (!r.permissions.canCancel) throw new AppError("INVALID_TRANSITION", `${r.receiptNumber} is ${r.status} and cannot be cancelled.`);
    return { context: { number: r.receiptNumber }, summary: `Cancel draft receipt ${r.receiptNumber} for ${r.orderNumber}.`, details: [{ label: "Receipt", after: r.receiptNumber }], typedPhrase: r.receiptNumber };
  },
  async run(ctx, args, _env, context) {
    await cancelReceipt(ctx, args.receiptId);
    return { summary: `Cancelled ${String(context.number)}.` };
  },
});

// ─── Writes: replenishment ────────────────────────────────────────────────────

export const generateReplenishmentTool = defineTool({
  name: "purchasing_generate_replenishment",
  module: "purchasing",
  operation: "create",
  kind: "write",
  risk: "low",
  permission: PERMISSIONS.PURCHASING_ORDER_MANAGE,
  description: "Propose generating a replenishment proposal for one warehouse, covering horizonDays (1 to 90). It only calculates suggestions from recent usage; no stock or order changes.",
  input: z.object({ warehouseId: objectIdSchema, horizonDays: z.union([z.string(), z.number()]) }).strict(),
  async prepare(ctx, rawArgs) {
    const args = parse(replenishmentGenerateSchema, rawArgs);
    const w = (await listWarehouses(ctx)).find((x) => x.id === args.warehouseId);
    if (!w) throw new AppError("NOT_FOUND", "Warehouse not found");
    if (!w.isActive) throw new AppError("VALIDATION_ERROR", `${w.code} is inactive.`);
    return { context: { input: args }, summary: `Generate a replenishment proposal for ${w.code} covering ${args.horizonDays} days.`, details: [{ label: "Warehouse", after: `${w.code} · ${w.name}` }, { label: "Covers", after: `${args.horizonDays} days` }] };
  },
  async run(ctx, _args, { access }, context) {
    const p = await generateReplenishmentProposal(ctx, context.input as { warehouseId: string; horizonDays: number });
    return { summary: `Generated a proposal with ${p.lineCount} item${p.lineCount === 1 ? "" : "s"}.`, parts: [proposalCard(p, access)] };
  },
});

export const convertReplenishmentTool = defineTool({
  name: "purchasing_convert_replenishment",
  module: "purchasing",
  operation: "approve",
  kind: "write",
  risk: "sensitive",
  permission: PERMISSIONS.PURCHASING_ORDER_APPROVE,
  description: "Propose turning a replenishment proposal into a DRAFT purchase order for one supplier. Needs the approve permission. The order still has to be approved separately.",
  input: z.object({ proposalId: objectIdSchema, supplierId: objectIdSchema, expectedVersion: z.number().int().min(1).optional() }).strict(),
  async prepare(ctx, args) {
    const p = await getReplenishmentProposal(ctx, args.proposalId);
    if (p.status !== "proposed" || !p.canConvert) throw new AppError("INVALID_TRANSITION", "This proposal was already converted or cannot be converted by you.");
    if (args.expectedVersion !== undefined && args.expectedVersion !== p.version) throw new AppError("CONFLICT", "This proposal changed since you opened it. Open it again.");
    const supplier = await getSupplier(ctx, args.supplierId);
    if (!supplier.isActive) throw new AppError("VALIDATION_ERROR", `${supplier.name} is inactive.`);
    return {
      context: { version: p.version, supplier: supplier.name },
      summary: `Turn the ${p.warehouseCode} replenishment proposal into a draft purchase order for ${supplier.name}.`,
      details: [{ label: "Supplier", after: supplier.name }, ...p.lines.map((l) => ({ label: `${l.sku} · ${l.productName}`, after: `${l.suggested} ${l.unitOfMeasure}` }))],
    };
  },
  async run(ctx, args, { access }, context) {
    const o = await convertReplenishmentProposal(ctx, args.proposalId, { supplierId: args.supplierId, expectedVersion: Number(context.version) });
    return { summary: `Created draft order ${o.orderNumber} from the proposal.`, parts: [orderCard(o, access)] };
  },
});

export const PURCHASING_TOOLS = [
  listSuppliersTool,
  listOrdersTool,
  getOrderTool,
  listReceiptsTool,
  getReceiptTool,
  listReplenishmentTool,
  getReplenishmentTool,
  createSupplierTool,
  updateSupplierTool,
  createOrderTool,
  updateOrderTool,
  approveOrderTool,
  cancelOrderTool,
  createReceiptTool,
  postReceiptTool,
  cancelReceiptTool,
  generateReplenishmentTool,
  convertReplenishmentTool,
];
