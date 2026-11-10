import "server-only";
import { z } from "zod";
import { defineTool } from "@/server/ai/tools/define-tool";
import { modelRows } from "@/server/ai/tools/inventory.parts";
import { availabilityCard, bomCard, bomsTable, workOrderCard, workOrdersTable } from "@/server/ai/tools/manufacturing.parts";
import { getProduct, listWarehouses } from "@/server/inventory/catalog.service";
import { activateBom, archiveBom, createBomDraft, getBom, listBoms, updateBomDraft } from "@/server/manufacturing/bom.service";
import { cancelWorkOrder, completeWorkOrder, createWorkOrder, getWorkOrder, listWorkOrders, previewMaterialAvailability, startWorkOrder } from "@/server/manufacturing/work-order.service";
import { bomInputSchema, bomListQuerySchema, quantityPerUnitValid, workOrderInputSchema, workOrderListQuerySchema, materialPreviewSchema } from "@/features/manufacturing/schemas/manufacturing.schema";
import type { BomInput } from "@/features/manufacturing/schemas/manufacturing.schema";
import type { UnitOfMeasure } from "@/shared/domain/units";
import { PERMISSIONS } from "@/server/security/permissions";
import type { AiDiffRow } from "@/server/db/documents";
import { AppError } from "@/shared/lib/errors";
import { objectIdSchema } from "@/shared/lib/schema-primitives";
import { toFieldErrors } from "@/shared/lib/validation";

/**
 * Manufacturing tools over the existing BOM and work-order services. Cells: view = reads and material
 * checks, create = BOM drafts and work orders, edit = BOM draft changes and activation, approve = start
 * and complete a work order (the execute permission), delete = archive a BOM or cancel a work order.
 * Completing a work order consumes components and receives finished goods atomically in the service; the
 * proposal shows exactly what will move and refuses up front when materials are short.
 */
const R = PERMISSIONS.MANUFACTURING_READ;
const decimal = z.union([z.string(), z.number()]).transform((v) => String(v));
const optText = (max: number) => z.string().max(max).optional();
const pageNo = z.number().int().min(1).max(1000).optional();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new AppError("VALIDATION_ERROR", result.error.issues[0]?.message ?? "The request is invalid.", toFieldErrors(result.error));
}

const componentInput = z.object({ productId: objectIdSchema, quantityPerUnit: decimal }).strict();

async function resolveBom(ctx: Parameters<typeof getProduct>[0], raw: { finishedProductId: string; notes?: string; components: { productId: string; quantityPerUnit: string }[] }) {
  const finished = await getProduct(ctx, raw.finishedProductId);
  if (!finished.isActive) throw new AppError("VALIDATION_ERROR", `${finished.sku} is archived.`);
  const names = new Map<string, string>([[finished.id, `${finished.sku} · ${finished.name}`]]);
  for (const c of raw.components) {
    const product = await getProduct(ctx, c.productId);
    if (!product.isActive) throw new AppError("VALIDATION_ERROR", `${product.sku} is archived.`);
    if (!quantityPerUnitValid(product.unitOfMeasure as UnitOfMeasure, c.quantityPerUnit)) throw new AppError("VALIDATION_ERROR", `${product.sku} is counted in whole units, so its quantity per unit must be a whole number.`);
    names.set(product.id, `${product.sku} · ${product.name}`);
  }
  const input = parse(bomInputSchema, { finishedProductId: raw.finishedProductId, notes: raw.notes ?? "", components: raw.components });
  return { input, finished, names };
}

// ─── Reads ────────────────────────────────────────────────────────────────────

export const listBomsTool = defineTool({
  name: "manufacturing_list_boms",
  module: "manufacturing",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "List bills of materials. status: all, draft, active, archived.",
  input: z.object({ status: z.enum(["all", "draft", "active", "archived"]).optional(), page: pageNo }).strict(),
  async run(ctx, args) {
    const q = parse(bomListQuerySchema, args);
    const page = await listBoms(ctx, q);
    return { summary: `${page.total} BOM${page.total === 1 ? "" : "s"}`, parts: [bomsTable(page, { status: q.status })], data: { total: page.total, boms: modelRows(page.items, (b) => ({ id: b.id, product: `${b.finishedSku} ${b.finishedName}`, revision: b.revision, status: b.status })) } };
  },
});

export const getBomTool = defineTool({
  name: "manufacturing_get_bom",
  module: "manufacturing",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "Show one bill of materials with its components.",
  input: z.object({ bomId: objectIdSchema }).strict(),
  async run(ctx, args, { access }) {
    const b = await getBom(ctx, args.bomId);
    return { summary: `${b.finishedSku} revision ${b.revision} (${b.status})`, parts: [bomCard(b, access)], data: { id: b.id, status: b.status, version: b.version, finishedProductId: b.finishedProductId, components: b.components.map((c) => ({ productId: c.productId, sku: c.sku, perUnit: c.quantityPerUnit })) } };
  },
});

export const listWorkOrdersTool = defineTool({
  name: "manufacturing_list_work_orders",
  module: "manufacturing",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "List work orders, newest first. status: all, draft, in_progress, completed, cancelled.",
  input: z.object({ status: z.enum(["all", "draft", "in_progress", "completed", "cancelled"]).optional(), page: pageNo }).strict(),
  async run(ctx, args) {
    const q = parse(workOrderListQuerySchema, args);
    const page = await listWorkOrders(ctx, q);
    return { summary: `${page.total} work order${page.total === 1 ? "" : "s"}`, parts: [workOrdersTable(page, { status: q.status })], data: { total: page.total, workOrders: modelRows(page.items, (w) => ({ id: w.id, number: w.orderNumber, product: w.finishedSku, status: w.status, planned: w.plannedQuantity })) } };
  },
});

export const getWorkOrderTool = defineTool({
  name: "manufacturing_get_work_order",
  module: "manufacturing",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "Show one work order with material needs against current stock.",
  input: z.object({ workOrderId: objectIdSchema }).strict(),
  async run(ctx, args, { access }) {
    const w = await getWorkOrder(ctx, args.workOrderId);
    return { summary: `${w.orderNumber} (${w.status})`, parts: [workOrderCard(w, access)], data: { id: w.id, number: w.orderNumber, status: w.status, version: w.version, bomId: w.bomId, shortages: w.materials.filter((m) => !m.sufficient).map((m) => ({ productId: m.productId, sku: m.sku, shortfall: m.shortfallExact })) } };
  },
});

export const checkMaterialsTool = defineTool({
  name: "manufacturing_check_materials",
  module: "manufacturing",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "Check whether a warehouse holds enough materials to produce a quantity from an ACTIVE bill of materials. Read-only; nothing is reserved.",
  input: z.object({ bomId: objectIdSchema, warehouseId: objectIdSchema, quantity: decimal }).strict(),
  async run(ctx, args, { access }) {
    const input = parse(materialPreviewSchema, args);
    // Look the BOM up first so an id from another company is always NOT_FOUND, never a race between two errors.
    const bom = await getBom(ctx, input.bomId);
    const a = await previewMaterialAvailability(ctx, input);
    return {
      summary: a.shortCount === 0 ? "All materials available" : `${a.shortCount} material${a.shortCount === 1 ? "" : "s"} short`,
      parts: [availabilityCard(a, { bomId: input.bomId, warehouseId: input.warehouseId, quantity: input.quantity, finished: bom.finishedSku }, access)],
      data: { shortCount: a.shortCount, materials: a.materials.map((m) => ({ productId: m.productId, sku: m.sku, needed: m.planned, onHand: m.onHand, shortfall: m.shortfallExact, sufficient: m.sufficient })) },
    };
  },
});

// ─── Writes: BOMs ─────────────────────────────────────────────────────────────

export const createBomTool = defineTool({
  name: "manufacturing_create_bom",
  module: "manufacturing",
  operation: "create",
  kind: "write",
  risk: "low",
  permission: PERMISSIONS.MANUFACTURING_BOM_MANAGE,
  description: "Propose a new DRAFT bill of materials: finishedProductId, and components [{productId, quantityPerUnit}] (the amount of each component needed to make ONE unit). It must be activated separately.",
  input: z.object({ finishedProductId: objectIdSchema, notes: optText(1000), components: z.array(componentInput).min(1).max(100) }).strict(),
  async prepare(ctx, args) {
    const { input, finished, names } = await resolveBom(ctx, args);
    return {
      context: { input },
      summary: `Create a draft bill of materials for ${finished.sku} with ${input.components.length} component${input.components.length === 1 ? "" : "s"}.`,
      details: [{ label: "Finished product", after: names.get(finished.id) ?? finished.sku }, ...input.components.map((c) => ({ label: names.get(c.productId) ?? "Component", after: `${c.quantityPerUnit} per unit` }))],
    };
  },
  async run(ctx, _args, { access }, context) {
    const b = await createBomDraft(ctx, context.input as BomInput);
    return { summary: `Created draft BOM revision ${b.revision} for ${b.finishedSku}.`, parts: [bomCard(b, access)] };
  },
});

export const updateBomTool = defineTool({
  name: "manufacturing_update_bom",
  module: "manufacturing",
  operation: "edit",
  kind: "write",
  risk: "low",
  permission: PERMISSIONS.MANUFACTURING_BOM_MANAGE,
  description: "Propose changes to a DRAFT bill of materials: notes and/or components (the COMPLETE new list, replacing the old one). Active BOMs cannot be edited.",
  input: z.object({ bomId: objectIdSchema, notes: optText(1000), components: z.array(componentInput).min(1).max(100).optional(), expectedVersion: z.number().int().min(1).optional() }).strict(),
  async prepare(ctx, args) {
    const cur = await getBom(ctx, args.bomId);
    if (cur.status !== "draft") throw new AppError("INVALID_TRANSITION", `Revision ${cur.revision} is ${cur.status}. Only draft BOMs can be edited.`);
    if (args.expectedVersion !== undefined && args.expectedVersion !== cur.version) throw new AppError("CONFLICT", "This BOM changed since you opened it. Open it again.");
    const { input, names } = await resolveBom(ctx, { finishedProductId: cur.finishedProductId, notes: args.notes ?? cur.notes, components: (args.components as { productId: string; quantityPerUnit: string }[] | undefined) ?? cur.components.map((c) => ({ productId: c.productId, quantityPerUnit: c.quantityPerUnit })) });
    const rows: AiDiffRow[] = [];
    if (input.notes !== cur.notes) rows.push({ label: "Notes", before: cur.notes || "none", after: input.notes || "none" });
    const before = new Map(cur.components.map((c) => [c.productId, c.quantityPerUnit]));
    const after = new Map(input.components.map((c) => [c.productId, c.quantityPerUnit]));
    for (const [id, q] of after) {
      const b = before.get(id);
      if (b === undefined) rows.push({ label: `Add ${names.get(id) ?? "component"}`, after: `${q} per unit` });
      else if (Number(b) !== Number(q)) rows.push({ label: names.get(id) ?? "Component", before: `${b} per unit`, after: `${q} per unit` });
    }
    for (const c of cur.components) if (!after.has(c.productId)) rows.push({ label: `Remove ${c.sku} · ${c.productName}`, before: `${c.quantityPerUnit} per unit`, after: "removed" });
    if (rows.length === 0) throw new AppError("VALIDATION_ERROR", "That would not change anything.");
    return { context: { input, version: cur.version }, summary: `Update draft BOM revision ${cur.revision} for ${cur.finishedSku}.`, details: rows };
  },
  async run(ctx, args, { access }, context) {
    const b = await updateBomDraft(ctx, args.bomId, { ...(context.input as BomInput), expectedVersion: Number(context.version) });
    return { summary: `Updated BOM revision ${b.revision}.`, parts: [bomCard(b, access)] };
  },
});

export const activateBomTool = defineTool({
  name: "manufacturing_activate_bom",
  module: "manufacturing",
  operation: "edit",
  kind: "write",
  risk: "sensitive",
  permission: PERMISSIONS.MANUFACTURING_BOM_MANAGE,
  description: "Propose activating a DRAFT bill of materials so it can be produced. The product's previously active revision is archived.",
  input: z.object({ bomId: objectIdSchema }).strict(),
  async prepare(ctx, args) {
    const cur = await getBom(ctx, args.bomId);
    if (cur.status !== "draft") throw new AppError("INVALID_TRANSITION", `Revision ${cur.revision} is ${cur.status}. Only draft BOMs can be activated.`);
    const active = (await listBoms(ctx, { status: "active", page: 1 })).items.find((b) => b.finishedSku === cur.finishedSku);
    return {
      context: { version: cur.version, sku: cur.finishedSku, revision: cur.revision },
      summary: `Activate revision ${cur.revision} of ${cur.finishedSku}.`,
      details: [{ label: "BOM", after: `${cur.finishedSku} revision ${cur.revision}` }, { label: "Components", after: String(cur.componentCount) }, ...(active ? [{ label: "Archives", after: `revision ${active.revision} (currently active)` }] : [])],
    };
  },
  async run(ctx, args, { access }, context) {
    await activateBom(ctx, args.bomId, Number(context.version));
    return { summary: `Activated ${String(context.sku)} revision ${String(context.revision)}.`, parts: [bomCard(await getBom(ctx, args.bomId), access)] };
  },
});

export const archiveBomTool = defineTool({
  name: "manufacturing_archive_bom",
  module: "manufacturing",
  operation: "delete",
  kind: "write",
  risk: "destructive",
  permission: PERMISSIONS.MANUFACTURING_BOM_MANAGE,
  description: "Propose archiving a bill of materials so it can no longer be produced.",
  input: z.object({ bomId: objectIdSchema }).strict(),
  async prepare(ctx, args) {
    const cur = await getBom(ctx, args.bomId);
    if (!cur.permissions.canArchive) throw new AppError("INVALID_TRANSITION", `Revision ${cur.revision} is ${cur.status} and cannot be archived.`);
    return { context: { sku: cur.finishedSku, revision: cur.revision }, summary: `Archive ${cur.finishedSku} revision ${cur.revision}.`, details: [{ label: "BOM", after: `${cur.finishedSku} revision ${cur.revision} (${cur.status})` }], typedPhrase: cur.finishedSku };
  },
  async run(ctx, args, _env, context) {
    await archiveBom(ctx, args.bomId);
    return { summary: `Archived ${String(context.sku)} revision ${String(context.revision)}.` };
  },
});

// ─── Writes: work orders ──────────────────────────────────────────────────────

export const createWorkOrderTool = defineTool({
  name: "manufacturing_create_work_order",
  module: "manufacturing",
  operation: "create",
  kind: "write",
  risk: "low",
  permission: PERMISSIONS.MANUFACTURING_WORK_ORDER_MANAGE,
  description: "Propose a DRAFT work order to produce quantity units from an ACTIVE bill of materials in a warehouse. plannedStart is YYYY-MM-DD (optional). The proposal shows material shortages; stock is only consumed when the order is completed.",
  input: z.object({ bomId: objectIdSchema, warehouseId: objectIdSchema, quantity: decimal, plannedStart: optText(10) }).strict(),
  async prepare(ctx, args) {
    const input = parse(workOrderInputSchema, { bomId: args.bomId, warehouseId: args.warehouseId, quantity: args.quantity, plannedStart: args.plannedStart ?? "" });
    const bom = await getBom(ctx, input.bomId);
    if (bom.status !== "active") throw new AppError("VALIDATION_ERROR", `Revision ${bom.revision} of ${bom.finishedSku} is ${bom.status}. Only active BOMs can be produced.`);
    const wh = (await listWarehouses(ctx)).find((w) => w.id === input.warehouseId);
    if (!wh) throw new AppError("NOT_FOUND", "Warehouse not found");
    if (!wh.isActive) throw new AppError("VALIDATION_ERROR", `${wh.code} is inactive.`);
    const a = await previewMaterialAvailability(ctx, { bomId: input.bomId, warehouseId: input.warehouseId, quantity: input.quantity });
    return {
      context: { input },
      summary: `Create a draft work order for ${input.quantity} × ${bom.finishedSku} in ${wh.code}${a.shortCount > 0 ? `. ${a.shortCount} material${a.shortCount === 1 ? " is" : "s are"} short right now.` : ". All materials are available."}`,
      details: [
        { label: "Product", after: `${bom.finishedSku} · ${bom.finishedName} (revision ${bom.revision})` },
        { label: "Quantity", after: input.quantity },
        { label: "Warehouse", after: wh.code },
        ...(input.plannedStart ? [{ label: "Planned start", after: input.plannedStart }] : []),
        ...a.materials.map((m) => ({ label: `${m.sku} · ${m.productName}`, after: m.sufficient ? `needs ${m.planned}, ${m.onHand} on hand` : `needs ${m.planned}, ${m.onHand} on hand, SHORT ${m.shortfall}` })),
      ],
    };
  },
  async run(ctx, _args, { access }, context) {
    const w = await createWorkOrder(ctx, context.input as Parameters<typeof createWorkOrder>[1]);
    return { summary: `Created draft work order ${w.orderNumber}.`, parts: [workOrderCard(w, access)] };
  },
});

export const startWorkOrderTool = defineTool({
  name: "manufacturing_start_work_order",
  module: "manufacturing",
  operation: "approve",
  kind: "write",
  risk: "sensitive",
  permission: PERMISSIONS.MANUFACTURING_WORK_ORDER_EXECUTE,
  description: "Propose starting a DRAFT work order. Starting does not move stock.",
  input: z.object({ workOrderId: objectIdSchema }).strict(),
  async prepare(ctx, args) {
    const w = await getWorkOrder(ctx, args.workOrderId);
    if (w.status !== "draft") throw new AppError("INVALID_TRANSITION", `${w.orderNumber} is ${w.status}. Only draft work orders can be started.`);
    const short = w.materials.filter((m) => !m.sufficient);
    return {
      context: { version: w.version, number: w.orderNumber },
      summary: `Start ${w.orderNumber}: ${w.plannedQuantity} × ${w.finishedSku}.${short.length ? ` ${short.length} material${short.length === 1 ? " is" : "s are"} short; completion will fail until they are stocked.` : ""}`,
      details: w.materials.map((m) => ({ label: `${m.sku} · ${m.productName}`, after: m.sufficient ? `${m.planned} needed, ${m.onHand} on hand` : `${m.planned} needed, ${m.onHand} on hand, SHORT ${m.shortfall}` })),
    };
  },
  async run(ctx, args, { access }, context) {
    await startWorkOrder(ctx, args.workOrderId, Number(context.version));
    return { summary: `Started ${String(context.number)}.`, parts: [workOrderCard(await getWorkOrder(ctx, args.workOrderId), access)] };
  },
});

export const completeWorkOrderTool = defineTool({
  name: "manufacturing_complete_work_order",
  module: "manufacturing",
  operation: "approve",
  kind: "write",
  risk: "financial",
  permission: PERMISSIONS.MANUFACTURING_WORK_ORDER_EXECUTE,
  description: "Propose completing an IN-PROGRESS work order. This consumes the components from the warehouse and receives the finished goods, atomically. Refused when any material is short.",
  input: z.object({ workOrderId: objectIdSchema }).strict(),
  async prepare(ctx, args) {
    const w = await getWorkOrder(ctx, args.workOrderId);
    if (w.status !== "in_progress") throw new AppError("INVALID_TRANSITION", `${w.orderNumber} is ${w.status}. Only in-progress work orders can be completed.`);
    const short = w.materials.filter((m) => !m.sufficient);
    if (short.length > 0) throw new AppError("INSUFFICIENT_STOCK", `Not enough stock in ${w.warehouseCode}: ${short.map((m) => `${m.sku} short by ${m.shortfall}`).join(", ")}.`);
    return {
      context: { version: w.version, number: w.orderNumber },
      summary: `Complete ${w.orderNumber}: consume the materials below and receive ${w.plannedQuantity} × ${w.finishedSku} into ${w.warehouseCode}.`,
      details: [...w.materials.map((m) => ({ label: `Consume ${m.sku}`, before: m.onHand, after: `${m.onHand} − ${m.planned}` })), { label: `Receive ${w.finishedSku}`, after: `+${w.plannedQuantity}` }],
      typedPhrase: w.orderNumber,
    };
  },
  async run(ctx, args, { access }, context) {
    await completeWorkOrder(ctx, args.workOrderId, Number(context.version));
    return { summary: `Completed ${String(context.number)}. Stock updated.`, parts: [workOrderCard(await getWorkOrder(ctx, args.workOrderId), access)] };
  },
});

export const cancelWorkOrderTool = defineTool({
  name: "manufacturing_cancel_work_order",
  module: "manufacturing",
  operation: "delete",
  kind: "write",
  risk: "destructive",
  permission: PERMISSIONS.MANUFACTURING_WORK_ORDER_MANAGE,
  description: "Propose cancelling a draft or in-progress work order. No stock moves.",
  input: z.object({ workOrderId: objectIdSchema }).strict(),
  async prepare(ctx, args) {
    const w = await getWorkOrder(ctx, args.workOrderId);
    if (!w.permissions.canCancel) throw new AppError("INVALID_TRANSITION", `${w.orderNumber} is ${w.status} and cannot be cancelled by you.`);
    return { context: { version: w.version, number: w.orderNumber }, summary: `Cancel ${w.orderNumber} (${w.finishedSku}). No stock moves.`, details: [{ label: "Work order", after: `${w.orderNumber} · ${w.status}` }], typedPhrase: w.orderNumber };
  },
  async run(ctx, args, _env, context) {
    await cancelWorkOrder(ctx, args.workOrderId, Number(context.version));
    return { summary: `Cancelled ${String(context.number)}.` };
  },
});

export const MANUFACTURING_TOOLS = [
  listBomsTool,
  getBomTool,
  listWorkOrdersTool,
  getWorkOrderTool,
  checkMaterialsTool,
  createBomTool,
  updateBomTool,
  activateBomTool,
  archiveBomTool,
  createWorkOrderTool,
  startWorkOrderTool,
  completeWorkOrderTool,
  cancelWorkOrderTool,
];
