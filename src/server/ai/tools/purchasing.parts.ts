import "server-only";
import type { AiAccess } from "@/server/ai/access/access.service";
import type { AiAction, AiBadge, AiRecordCardPart, AiRecordTablePart } from "@/server/db/documents";
import { PO_STATUS, RECEIPT_STATUS } from "@/features/purchasing/labels";
import type { Paged, PurchaseOrderDetailDto, PurchaseOrderSummaryDto, ReceiptDetailDto, ReceiptSummaryDto, SupplierDto } from "@/features/purchasing/types";
import type { ReplenishmentProposalDto, ReplenishmentSummaryDto } from "@/server/purchasing/replenishment.service";
import type { AiOperation } from "@/shared/domain/ai";

/**
 * Purchasing results as structured parts. Every card ends with the next step of the workflow
 * (replenishment -> order -> approval -> receipt -> posting), offered only when the member's live access
 * and the record's own permissions allow it. Each action goes back through the command runner, which
 * authorises it again.
 */
const can = (access: AiAccess, op: AiOperation) => access.can("purchasing", op);
const badge = (map: Record<string, { label: string; tone: AiBadge["tone"] }>, status: string): AiBadge => map[status] ?? { label: status, tone: "neutral" };

export function suppliersTable(page: Paged<SupplierDto>, access: AiAccess, args: Record<string, string | number | boolean>): AiRecordTablePart {
  return {
    type: "record_table",
    title: "Suppliers",
    columns: [
      { key: "name", label: "Supplier" },
      { key: "email", label: "Email" },
      { key: "phone", label: "Phone" },
    ],
    rows: page.items.map((s) => ({
      id: s.id,
      cells: { name: s.name, email: s.email || "None", phone: s.phone || "None" },
      badge: s.isActive ? { label: "Active", tone: "success" } : { label: "Inactive", tone: "neutral" },
      actions: [
        ...(can(access, "edit") ? [{ label: "Edit", command: "editsupplier", args: { supplierId: s.id }, step: "select" as const }] : []),
        ...(can(access, "create") && s.isActive ? [{ label: "New order", command: "neworder", args: { supplierId: s.id }, step: "manual" as const }] : []),
      ],
    })),
    total: page.total,
    emptyMessage: "No suppliers match. Add one with /newsupplier.",
    paging: { page: page.page, totalPages: page.totalPages, command: "suppliers", args },
  };
}

export function ordersTable(page: Paged<PurchaseOrderSummaryDto>, args: Record<string, string | number | boolean>, rowCommand = "order", select = false): AiRecordTablePart {
  return {
    type: "record_table",
    title: "Purchase orders",
    columns: [
      { key: "number", label: "Order" },
      { key: "supplier", label: "Supplier" },
      { key: "lines", label: "Lines", align: "right" },
      { key: "total", label: "Total", align: "right" },
      { key: "expected", label: "Expected" },
    ],
    rows: page.items.map((o) => ({
      id: o.id,
      cells: { number: o.orderNumber, supplier: o.supplierName, lines: String(o.lineCount), total: `${o.total} ${o.currencyCode}`, expected: o.expectedDate?.slice(0, 10) ?? "None" },
      badge: badge(PO_STATUS, o.status),
      actions: [{ label: select ? "Select" : "Open", command: rowCommand, args: { orderId: o.id }, step: select ? ("select" as const) : ("start" as const) }],
    })),
    total: page.total,
    emptyMessage: "No purchase orders match. Create one with /neworder.",
    paging: { page: page.page, totalPages: page.totalPages, command: select ? rowCommand : "orders", args },
  };
}

export function orderCard(o: PurchaseOrderDetailDto, access: AiAccess): AiRecordCardPart {
  const args = { orderId: o.id };
  const actions: AiAction[] = [];
  if (o.permissions.canEdit && can(access, "edit")) actions.push({ label: "Edit order", command: "editorder", args, step: "select" });
  if (o.permissions.canApprove && can(access, "approve")) actions.push({ label: "Approve", command: "approveorder", args, step: "select" });
  if (o.permissions.canReceive && can(access, "create")) actions.push({ label: "Receive goods", command: "receivegoods", args, step: "select" });
  if (o.permissions.canCancel && can(access, "delete")) actions.push({ label: "Cancel order", command: "cancelorder", args, step: "select" });
  return {
    type: "record_card",
    title: o.orderNumber,
    subtitle: o.supplierName,
    badges: [badge(PO_STATUS, o.status)],
    fields: [
      { label: "Expected", value: o.expectedDate?.slice(0, 10) ?? "None" },
      { label: "Subtotal", value: `${o.subtotal} ${o.currencyCode}` },
      { label: "Tax", value: `${o.tax} ${o.currencyCode}` },
      { label: "Total", value: `${o.total} ${o.currencyCode}` },
      ...(o.notes ? [{ label: "Notes", value: o.notes }] : []),
    ],
    sections: [
      {
        title: "Lines (ordered, received, remaining)",
        rows: o.lines.map((l) => ({ label: `${l.sku} · ${l.productName}`, value: `${l.ordered} / ${l.received} / ${l.remaining} ${l.unitOfMeasure} @ ${l.unitCost}` })),
      },
    ],
    actions,
  };
}

export function receiptsTable(page: Paged<ReceiptSummaryDto>, args: Record<string, string | number | boolean>, select = false, command = "receipt"): AiRecordTablePart {
  return {
    type: "record_table",
    title: "Goods receipts",
    columns: [
      { key: "number", label: "Receipt" },
      { key: "order", label: "Order" },
      { key: "supplier", label: "Supplier" },
      { key: "warehouse", label: "Warehouse" },
      { key: "lines", label: "Lines", align: "right" },
    ],
    rows: page.items.map((r) => ({
      id: r.id,
      cells: { number: r.receiptNumber, order: r.orderNumber, supplier: r.supplierName, warehouse: r.warehouseCode, lines: String(r.lineCount) },
      badge: badge(RECEIPT_STATUS, r.status),
      actions: [{ label: select ? "Select" : "Open", command, args: { receiptId: r.id }, step: select ? ("select" as const) : ("start" as const) }],
    })),
    total: page.total,
    emptyMessage: "No goods receipts match.",
    paging: { page: page.page, totalPages: page.totalPages, command: select ? command : "receipts", args },
  };
}

export function receiptCard(r: ReceiptDetailDto, access: AiAccess): AiRecordCardPart {
  const args = { receiptId: r.id };
  const actions: AiAction[] = [];
  if (r.permissions.canPost && can(access, "edit")) actions.push({ label: "Post receipt", command: "postreceipt", args, step: "select" });
  if (r.permissions.canCancel && can(access, "delete")) actions.push({ label: "Cancel receipt", command: "cancelreceipt", args, step: "select" });
  if (can(access, "view")) actions.push({ label: "Open order", command: "order", args: { orderId: r.purchaseOrderId } });
  return {
    type: "record_card",
    title: r.receiptNumber,
    subtitle: `${r.orderNumber} · ${r.supplierName}`,
    badges: [badge(RECEIPT_STATUS, r.status)],
    fields: [
      { label: "Warehouse", value: r.warehouseCode },
      { label: "Posted", value: r.postedAt ? r.postedAt.slice(0, 10) : "Not yet" },
    ],
    sections: [{ title: "Lines", rows: r.lines.map((l) => ({ label: l.productName, value: `${l.quantity} ${l.unitOfMeasure}` })) }],
    actions,
  };
}

export function proposalsTable(page: Paged<ReplenishmentSummaryDto>, args: Record<string, string | number | boolean>, select = false): AiRecordTablePart {
  return {
    type: "record_table",
    title: "Replenishment proposals",
    columns: [
      { key: "when", label: "Generated" },
      { key: "warehouse", label: "Warehouse" },
      { key: "horizon", label: "Covers", align: "right" },
      { key: "lines", label: "Items", align: "right" },
    ],
    rows: page.items.map((p) => ({
      id: p.id,
      cells: { when: p.generatedAt.slice(0, 10), warehouse: p.warehouseCode, horizon: `${p.horizonDays} days`, lines: String(p.lineCount) },
      badge: p.status === "converted" ? { label: "Converted", tone: "success" } : p.status === "converting" ? { label: "Converting", tone: "warning" } : { label: "Proposed", tone: "info" },
      actions: [{ label: select ? "Select" : "Open", command: select ? "convertproposal" : "proposal", args: { proposalId: p.id }, step: select ? ("select" as const) : ("start" as const) }],
    })),
    total: page.total,
    emptyMessage: "No replenishment proposals yet. Generate one with /genreplenishment.",
    paging: { page: page.page, totalPages: page.totalPages, command: select ? "convertproposal" : "proposals", args },
  };
}

export function proposalCard(p: ReplenishmentProposalDto, access: AiAccess): AiRecordCardPart {
  const actions: AiAction[] = [];
  if (p.canConvert && p.status === "proposed" && can(access, "approve")) actions.push({ label: "Convert to purchase order", command: "convertproposal", args: { proposalId: p.id }, step: "select" });
  if (p.convertedOrderId) actions.push({ label: "Open the order", command: "order", args: { orderId: p.convertedOrderId } });
  return {
    type: "record_card",
    title: `Replenishment for ${p.warehouseCode}`,
    subtitle: `Covers ${p.horizonDays} days, based on the last ${p.lookbackDays} days of usage`,
    badges: [p.status === "converted" ? { label: "Converted", tone: "success" } : { label: p.status === "converting" ? "Converting" : "Proposed", tone: "info" }],
    fields: [
      { label: "Items to order", value: String(p.lineCount) },
      { label: "Method", value: p.method },
      ...(p.truncated ? [{ label: "Note", value: "More candidate products existed than the limit, so this list is partial" }] : []),
    ],
    sections: [
      {
        title: "Suggested quantities (on hand / reorder point / suggested)",
        rows: p.lines.map((l) => ({ label: `${l.sku} · ${l.productName}`, value: `${l.onHand} / ${l.reorderPoint} / ${l.suggested} ${l.unitOfMeasure}` })),
      },
    ],
    actions,
  };
}
