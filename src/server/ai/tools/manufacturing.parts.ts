import "server-only";
import type { AiAccess } from "@/server/ai/access/access.service";
import type { AiAction, AiBadge, AiRecordCardPart, AiRecordTablePart } from "@/server/db/documents";
import { BOM_STATUS, WORK_ORDER_STATUS } from "@/features/manufacturing/labels";
import type { BomDetailDto, BomSummaryDto, ManufacturingPage, MaterialAvailabilityDto, WorkOrderDetailDto, WorkOrderSummaryDto } from "@/features/manufacturing/types";
import type { AiOperation } from "@/shared/domain/ai";

/**
 * Manufacturing results. Cards end with the next step of BOM -> material availability -> work order ->
 * start -> complete, and with "Order the shortages" which hands real shortfall quantities to a prefilled
 * purchase order. Actions appear only when live access and the record's own permissions allow them.
 */
const can = (access: AiAccess, op: AiOperation) => access.can("manufacturing", op);
const badge = (map: Record<string, { label: string; tone: AiBadge["tone"] }>, status: string): AiBadge => map[status] ?? { label: status, tone: "neutral" };

export function bomsTable(page: ManufacturingPage<BomSummaryDto>, args: Record<string, string | number | boolean>, command = "bom", select = false): AiRecordTablePart {
  return {
    type: "record_table",
    title: "Bills of materials",
    columns: [
      { key: "product", label: "Finished product" },
      { key: "revision", label: "Rev", align: "right" },
      { key: "components", label: "Components", align: "right" },
    ],
    rows: page.items.map((b) => ({
      id: b.id,
      cells: { product: `${b.finishedSku} · ${b.finishedName}`, revision: String(b.revision), components: String(b.componentCount) },
      badge: badge(BOM_STATUS, b.status),
      actions: [{ label: select ? "Select" : "Open", command, args: { bomId: b.id }, step: select ? ("select" as const) : ("start" as const) }],
    })),
    total: page.total,
    emptyMessage: "No bills of materials match. Create one with /newbom.",
    paging: { page: page.page, totalPages: page.totalPages, command: select ? command : "boms", args },
  };
}

export function bomCard(b: BomDetailDto, access: AiAccess): AiRecordCardPart {
  const args = { bomId: b.id };
  const actions: AiAction[] = [];
  if (b.permissions.canEdit && can(access, "edit")) actions.push({ label: "Edit components", command: "editbom", args, step: "select" });
  if (b.permissions.canActivate && can(access, "edit")) actions.push({ label: "Activate", command: "activatebom", args, step: "select" });
  if (b.status === "active" && can(access, "view")) actions.push({ label: "Check materials", command: "materials", args, step: "select" });
  if (b.status === "active" && can(access, "create")) actions.push({ label: "Create work order", command: "newworkorder", args, step: "manual" });
  if (b.permissions.canArchive && can(access, "delete")) actions.push({ label: "Archive", command: "archivebom", args, step: "select" });
  return {
    type: "record_card",
    title: `${b.finishedSku} · ${b.finishedName}`,
    subtitle: `Revision ${b.revision}`,
    badges: [badge(BOM_STATUS, b.status)],
    fields: [{ label: "Components", value: String(b.componentCount) }, ...(b.notes ? [{ label: "Notes", value: b.notes }] : [])],
    sections: [{ title: "Components (per unit made)", rows: b.components.map((c) => ({ label: `${c.sku} · ${c.productName}`, value: `${c.quantityPerUnit} ${c.unitOfMeasure}` })) }],
    actions,
  };
}

export function workOrdersTable(page: ManufacturingPage<WorkOrderSummaryDto>, args: Record<string, string | number | boolean>, command = "workorder", select = false): AiRecordTablePart {
  return {
    type: "record_table",
    title: "Work orders",
    columns: [
      { key: "number", label: "Order" },
      { key: "product", label: "Product" },
      { key: "planned", label: "Planned", align: "right" },
      { key: "start", label: "Planned start" },
    ],
    rows: page.items.map((w) => ({
      id: w.id,
      cells: { number: w.orderNumber, product: `${w.finishedSku} · ${w.finishedName}`, planned: w.plannedQuantity, start: w.plannedStart?.slice(0, 10) ?? "None" },
      badge: badge(WORK_ORDER_STATUS, w.status),
      actions: [{ label: select ? "Select" : "Open", command, args: { workOrderId: w.id }, step: select ? ("select" as const) : ("start" as const) }],
    })),
    total: page.total,
    emptyMessage: "No work orders match. Create one with /newworkorder.",
    paging: { page: page.page, totalPages: page.totalPages, command: select ? command : "workorders", args },
  };
}

export function workOrderCard(w: WorkOrderDetailDto, access: AiAccess): AiRecordCardPart {
  const args = { workOrderId: w.id };
  const short = w.materials.filter((m) => !m.sufficient);
  const actions: AiAction[] = [];
  if (w.permissions.canStart && can(access, "approve")) actions.push({ label: "Start", command: "startworkorder", args, step: "select" });
  if (w.permissions.canComplete && can(access, "approve")) actions.push({ label: "Complete", command: "completeworkorder", args, step: "select" });
  if (short.length > 0 && (w.status === "draft" || w.status === "in_progress") && access.can("purchasing", "create")) actions.push({ label: "Order the shortages", command: "neworder", args, step: "manual" });
  if (w.permissions.canCancel && can(access, "delete")) actions.push({ label: "Cancel", command: "cancelworkorder", args, step: "select" });
  return {
    type: "record_card",
    title: w.orderNumber,
    subtitle: `${w.finishedSku} · ${w.finishedName}`,
    badges: [badge(WORK_ORDER_STATUS, w.status), ...(short.length > 0 && w.status !== "completed" && w.status !== "cancelled" ? [{ label: `${short.length} short`, tone: "warning" as const }] : [])],
    fields: [
      { label: "Planned", value: w.plannedQuantity },
      { label: "Produced", value: w.producedQuantity },
      { label: "Warehouse", value: w.warehouseCode },
      { label: "BOM revision", value: String(w.bomRevision) },
      { label: "Planned start", value: w.plannedStart?.slice(0, 10) ?? "None" },
    ],
    sections: [
      {
        title: "Materials (planned / on hand)",
        rows: w.materials.map((m) => ({ label: `${m.sku} · ${m.productName}`, value: m.sufficient ? `${m.planned} / ${m.onHand} ${m.unitOfMeasure}` : `${m.planned} / ${m.onHand} ${m.unitOfMeasure}, short ${m.shortfall}` })),
      },
    ],
    actions,
  };
}

export function availabilityCard(a: MaterialAvailabilityDto, ctx: { bomId: string; warehouseId: string; quantity: string; finished: string }, access: AiAccess): AiRecordCardPart {
  const actions: AiAction[] = [];
  if (can(access, "create")) actions.push({ label: "Create work order", command: "newworkorder", args: { bomId: ctx.bomId }, step: "manual" });
  if (a.shortCount > 0 && access.can("purchasing", "create")) actions.push({ label: "Order the shortages", command: "neworder", args: { bomId: ctx.bomId, warehouseId: ctx.warehouseId, quantity: ctx.quantity }, step: "manual" });
  return {
    type: "record_card",
    title: `Materials for ${ctx.quantity} × ${ctx.finished}`,
    subtitle: `Warehouse ${a.warehouseCode}. Nothing is reserved.`,
    badges: [a.shortCount === 0 ? { label: "All available", tone: "success" } : { label: `${a.shortCount} short`, tone: "warning" }],
    fields: [],
    sections: [{ title: "Needed / on hand", rows: a.materials.map((m) => ({ label: `${m.sku} · ${m.productName}`, value: m.sufficient ? `${m.planned} / ${m.onHand} ${m.unitOfMeasure}` : `${m.planned} / ${m.onHand} ${m.unitOfMeasure}, short ${m.shortfall}` })) }],
    actions,
  };
}
