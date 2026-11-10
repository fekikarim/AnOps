import "server-only";
import { callTool, field, form, nonEmpty, proposeTool } from "@/server/ai/commands/helpers";
import { ARGS, need, noText, pickCommand, requireCell } from "@/server/ai/commands/shared";
import type { CommandArgs, CommandDefinition, CommandEnv, DraftCandidate, DraftCurrent } from "@/server/ai/commands/types";
import { withAssist } from "@/server/ai/draft/assist";
import { parseRows, serializeRows } from "@/server/ai/draft/draft-lines";
import type { AiFormField, AiProvenance } from "@/server/db/documents";
import { getProduct, listProductOptions, listProducts, listWarehouses } from "@/server/inventory/catalog.service";
import { bomOptions, getBom, listBoms } from "@/server/manufacturing/bom.service";
import { PERMISSIONS } from "@/server/security/permissions";
import { AppError } from "@/shared/lib/errors";

/**
 * Manufacturing commands: BOM -> material availability -> work order -> start -> complete. The material
 * check and every work-order card hand real shortfalls to a prefilled purchase order.
 */
const MODULE = "manufacturing" as const;
type Values = Record<string, string | boolean> | null;
const v = (cur: Values, key: string, fallback: string | boolean): string | boolean => (cur && cur[key] !== undefined ? cur[key] : fallback);
const page = (a: CommandArgs) => ({ page: Number(a.page ?? 1) });

const read = (name: string, description: string, tool: string, pick: (a: CommandArgs) => Record<string, unknown>, hidden = false): CommandDefinition => ({
  name,
  description,
  example: `/${name}`,
  module: MODULE,
  operation: "view",
  permission: PERMISSIONS.MANUFACTURING_READ,
  hidden,
  args: ARGS,
  fromText: (rest) => ({ status: rest.trim().toLowerCase().replace(/\s+/g, "_").slice(0, 20) }),
  async start(env, args) {
    return { parts: (await callTool(env, tool, pick(args))).parts ?? [] };
  },
});

const BOM_STATUS = ["draft", "active", "archived"];
const WO_STATUS = ["draft", "in_progress", "completed", "cancelled"];
const boms = read("boms", "List bills of materials (try /boms active).", "manufacturing_list_boms", (a) => ({ ...(BOM_STATUS.includes(String(a.status)) ? { status: String(a.status) } : {}), ...page(a) }));
const bom = read("bom", "Show one bill of materials.", "manufacturing_get_bom", (a) => ({ bomId: need(a, "bomId") }), true);
const workorders = read("workorders", "List work orders (try /workorders in progress).", "manufacturing_list_work_orders", (a) => ({ ...(WO_STATUS.includes(String(a.status)) ? { status: String(a.status) } : {}), ...page(a) }));
const workorder = read("workorder", "Show one work order.", "manufacturing_get_work_order", (a) => ({ workOrderId: need(a, "workOrderId") }), true);

// ─── Options, lookups ─────────────────────────────────────────────────────────

const label = (p: { sku: string; name: string }) => `${p.sku} · ${p.name}`;
async function productChoices(env: CommandEnv) {
  return (await listProductOptions(env.ctx)).map((p) => ({ value: p.id, label: label(p) }));
}
async function warehouseChoices(env: CommandEnv) {
  return (await listWarehouses(env.ctx)).filter((w) => w.isActive).map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }));
}
async function bomChoices(env: CommandEnv) {
  return (await bomOptions(env.ctx)).map((b) => ({ value: b.id, label: `${b.label} (rev ${b.revision})` }));
}

async function findProducts(env: CommandEnv, ref: string): Promise<DraftCandidate[]> {
  const find = async (q: string) => (await listProducts(env.ctx, { q, status: "active", page: 1 })).items;
  let items = await find(ref.slice(0, 80));
  if (items.length === 0) {
    const token = ref.split(/\s+/).find((t) => t.length >= 3);
    if (token) items = await find(token);
  }
  return items.map((p) => ({ id: p.id, label: label(p), detail: p.unitOfMeasure }));
}
async function productById(env: CommandEnv, id: string): Promise<DraftCandidate | null> {
  try {
    const p = await getProduct(env.ctx, id);
    return p.isActive ? { id: p.id, label: label(p), detail: p.unitOfMeasure } : null;
  } catch {
    return null;
  }
}
const productRef = { find: (env: CommandEnv, words: string) => findProducts(env, words), byId: (env: CommandEnv, id: string) => productById(env, id) };

const bomRef = {
  async find(env: CommandEnv, words: string): Promise<DraftCandidate[]> {
    const t = words.toLowerCase();
    return (await bomOptions(env.ctx)).filter((b) => b.label.toLowerCase().includes(t)).map((b) => ({ id: b.id, label: `${b.label} (rev ${b.revision})`, detail: "" }));
  },
  async byId(env: CommandEnv, id: string): Promise<DraftCandidate | null> {
    const b = (await bomOptions(env.ctx)).find((x) => x.id === id);
    return b ? { id: b.id, label: `${b.label} (rev ${b.revision})`, detail: "" } : null;
  },
};

// ─── Bills of materials ───────────────────────────────────────────────────────

async function bomFields(env: CommandEnv, cur: Values, mode: "create" | "edit"): Promise<AiFormField[]> {
  return [
    ...(mode === "create" ? [field({ name: "finishedProductId", label: "Finished product", kind: "select", required: true, value: v(cur, "finishedProductId", ""), options: [{ value: "", label: "Choose a product" }, ...(await productChoices(env))] })] : []),
    field({ name: "notes", label: "Notes", kind: "textarea", value: v(cur, "notes", "") }),
    field({
      name: "components",
      label: "Components (per unit made)",
      kind: "lines",
      required: true,
      value: v(cur, "components", serializeRows([{ productId: "", quantityPerUnit: "" }])),
      lines: {
        maxRows: 100,
        addLabel: "Add component",
        columns: [
          { name: "productId", label: "Component", kind: "select", options: await productChoices(env) },
          { name: "quantityPerUnit", label: "Quantity per unit", kind: "text", placeholder: "0" },
        ],
      },
    }),
  ];
}

const componentLines = {
  field: "components",
  keyColumn: "productId",
  requiredColumns: ["quantityPerUnit"],
  criticalColumns: ["quantityPerUnit"],
  find: (env: CommandEnv, ref: string) => findProducts(env, ref),
  byId: (env: CommandEnv, id: string) => productById(env, id),
  async newRow(_e: CommandEnv, c: DraftCandidate) {
    return { row: { productId: c.id, label: c.label, quantityPerUnit: "" }, provenance: { productId: "found", quantityPerUnit: "default" } as Record<string, AiProvenance> };
  },
};

const toComponents = (json: string) =>
  parseRows(json)
    .filter((r) => (r.productId ?? "") !== "")
    .map((r) => ({ productId: r.productId, quantityPerUnit: r.quantityPerUnit ?? "" }));

async function loadBom(env: CommandEnv, id: string): Promise<DraftCurrent> {
  const b = await getBom(env.ctx, id);
  if (b.status !== "draft") throw new AppError("INVALID_TRANSITION", `Revision ${b.revision} of ${b.finishedSku} is ${b.status}. Only draft BOMs can be edited.`);
  return { id: b.id, label: `${b.finishedSku} rev ${b.revision}`, version: b.version, values: { notes: b.notes, components: serializeRows(b.components.map((c) => ({ productId: c.productId, label: label({ sku: c.sku, name: c.productName }), quantityPerUnit: c.quantityPerUnit }))) } };
}
async function searchDraftBoms(env: CommandEnv, text: string): Promise<DraftCandidate[]> {
  const t = text.toLowerCase();
  return (await listBoms(env.ctx, { status: "draft", page: 1 })).items.filter((b) => `${b.finishedSku} ${b.finishedName}`.toLowerCase().includes(t)).map((b) => ({ id: b.id, label: `${b.finishedSku} rev ${b.revision}`, detail: b.finishedName }));
}

const newbom = withAssist(
  {
    name: "newbom",
    description: "Create a draft bill of materials.",
    example: "/newbom",
    module: MODULE,
    operation: "create",
    permission: PERMISSIONS.MANUFACTURING_BOM_MANAGE,
    args: ARGS,
    fromText: noText,
    async start(env) {
      requireCell(env, MODULE, "view");
      return { parts: [form({ title: "New bill of materials", command: "newbom", context: {}, submitLabel: "Review", fields: await bomFields(env, null, "create") })] };
    },
    submit: (env, _a, values) => proposeTool(env, "manufacturing_create_bom", { finishedProductId: String(values.finishedProductId ?? ""), notes: String(values.notes ?? ""), components: toComponents(String(values.components ?? "[]")) }),
  },
  {
    kind: "create",
    noun: "bill of materials",
    examples: ["A bill of materials for the olive oil bottle: 1 litre of raw olive oil and 1 glass bottle per unit"],
    tool: "manufacturing_create_bom",
    criticalFields: ["finishedProductId"],
    refFields: { finishedProductId: productRef },
    lines: componentLines,
    fields: (env, cur) => bomFields(env, cur?.values ?? null, "create"),
  }
);

const editbomBase = pickCommand({
  name: "editbom",
  description: "Edit a draft bill of materials.",
  example: "/editbom",
  module: MODULE,
  operation: "edit",
  permission: PERMISSIONS.MANUFACTURING_BOM_MANAGE,
  title: "Choose a draft BOM to edit",
  key: "bomId",
  list: async (env, a) => (await callTool(env, "manufacturing_list_boms", { status: "draft", ...page(a) })).parts ?? [],
  async select(env, a) {
    const cur = await loadBom(env, need(a, "bomId"));
    return { parts: [form({ title: `Edit ${cur.label}`, command: "editbom", context: { bomId: cur.id, version: cur.version ?? 0 }, submitLabel: "Review changes", fields: await bomFields(env, cur.values, "edit") })] };
  },
});
editbomBase.submit = (env, a, values) => proposeTool(env, "manufacturing_update_bom", { bomId: need(a, "bomId"), notes: String(values.notes ?? ""), components: toComponents(String(values.components ?? "[]")), expectedVersion: Number(a.version) });
const editbom = withAssist(editbomBase, {
  kind: "edit",
  noun: "draft bill of materials",
  examples: ["On the olive oil BOM change the bottle quantity to 2 per unit and add 1 cap"],
  tool: "manufacturing_update_bom",
  criticalFields: [],
  lines: componentLines,
  target: { label: "draft BOM", key: "bomId", search: searchDraftBoms, load: loadBom },
  fields: (env, cur) => bomFields(env, cur?.values ?? null, "edit"),
  context: (cur) => ({ bomId: cur.id, version: cur.version ?? 0 }),
});

const bomPicker = (name: string, description: string, status: "draft" | "active", operation: CommandDefinition["operation"], tool: string) =>
  pickCommand({
    name,
    description,
    example: `/${name}`,
    module: MODULE,
    operation,
    permission: PERMISSIONS.MANUFACTURING_BOM_MANAGE,
    title: `Choose a BOM: ${name}`,
    key: "bomId",
    list: async (env, a) => (await callTool(env, "manufacturing_list_boms", { status, ...page(a) })).parts ?? [],
    select: (env, a) => proposeTool(env, tool, { bomId: need(a, "bomId") }),
  });
const activatebom = bomPicker("activatebom", "Activate a draft BOM so it can be produced.", "draft", "edit", "manufacturing_activate_bom");
const archivebom = pickCommand({
  name: "archivebom",
  description: "Archive a BOM (typed confirmation).",
  example: "/archivebom",
  module: MODULE,
  operation: "delete",
  permission: PERMISSIONS.MANUFACTURING_BOM_MANAGE,
  title: "Choose a BOM to archive",
  key: "bomId",
  list: async (env, a) => (await callTool(env, "manufacturing_list_boms", { ...page(a) })).parts ?? [],
  select: (env, a) => proposeTool(env, "manufacturing_archive_bom", { bomId: need(a, "bomId") }),
});

// ─── Material availability and work orders ────────────────────────────────────

const materialFields = async (env: CommandEnv, bomId: string): Promise<AiFormField[]> => [
  field({ name: "bomId", label: "Bill of materials", kind: "select", required: true, value: bomId, options: [{ value: "", label: "Choose a BOM" }, ...(await bomChoices(env))] }),
  field({ name: "warehouseId", label: "Warehouse", kind: "select", required: true, options: await warehouseChoices(env), value: (await warehouseChoices(env))[0]?.value ?? "" }),
  field({ name: "quantity", label: "Quantity to make", kind: "text", required: true, placeholder: "0" }),
];

/** A read-only check: its form submits straight to the availability result, no confirmation needed because nothing changes. */
const materials: CommandDefinition = {
  name: "materials",
  description: "Check whether a warehouse has the materials to make a quantity.",
  example: "/materials",
  module: MODULE,
  operation: "view",
  permission: PERMISSIONS.MANUFACTURING_READ,
  args: ARGS,
  fromText: noText,
  async start(env) {
    return { parts: [form({ title: "Check material availability", description: "Read-only. Nothing is reserved.", command: "materials", context: {}, submitLabel: "Check", fields: await materialFields(env, "") })] };
  },
  async select(env, a) {
    return { parts: [form({ title: "Check material availability", description: "Read-only. Nothing is reserved.", command: "materials", context: {}, submitLabel: "Check", fields: await materialFields(env, need(a, "bomId")) })] };
  },
  async submit(env, _a, values) {
    const result = await callTool(env, "manufacturing_check_materials", { bomId: String(values.bomId ?? ""), warehouseId: String(values.warehouseId ?? ""), quantity: String(values.quantity ?? "") });
    return { parts: result.parts ?? [] };
  },
};

const workOrderFields = async (env: CommandEnv, cur: Values): Promise<AiFormField[]> => {
  const warehouses = await warehouseChoices(env);
  return [
    field({ name: "bomId", label: "Bill of materials", kind: "select", required: true, value: v(cur, "bomId", ""), options: [{ value: "", label: "Choose an active BOM" }, ...(await bomChoices(env))] }),
    field({ name: "warehouseId", label: "Warehouse", kind: "select", required: true, value: v(cur, "warehouseId", warehouses[0]?.value ?? ""), options: warehouses }),
    field({ name: "quantity", label: "Quantity to make", kind: "text", required: true, value: v(cur, "quantity", ""), placeholder: "0" }),
    field({ name: "plannedStart", label: "Planned start", kind: "text", value: v(cur, "plannedStart", ""), placeholder: "YYYY-MM-DD" }),
  ];
};

const newworkorder = withAssist(
  {
    name: "newworkorder",
    description: "Create a draft work order from an active BOM.",
    example: "/newworkorder",
    module: MODULE,
    operation: "create",
    permission: PERMISSIONS.MANUFACTURING_WORK_ORDER_MANAGE,
    args: ARGS,
    fromText: noText,
    async start(env, args) {
      requireCell(env, MODULE, "view");
      return { parts: [form({ title: "New work order", command: "newworkorder", context: {}, submitLabel: "Review", fields: await workOrderFields(env, args.bomId ? { bomId: String(args.bomId) } : null) })] };
    },
    submit: (env, _a, values) => proposeTool(env, "manufacturing_create_work_order", { ...nonEmpty(values, []), bomId: String(values.bomId ?? ""), warehouseId: String(values.warehouseId ?? "") }),
  },
  {
    kind: "create",
    noun: "work order",
    examples: ["Produce 200 units of the olive oil bottle in the Main Store, starting 2026-12-01"],
    tool: "manufacturing_create_work_order",
    criticalFields: ["quantity", "bomId", "warehouseId"],
    refFields: { bomId: bomRef },
    fields: (env, cur) => workOrderFields(env, cur?.values ?? null),
  }
);

const woPicker = (name: string, description: string, status: string, operation: CommandDefinition["operation"], permission: CommandDefinition["permission"], tool: string) =>
  pickCommand({
    name,
    description,
    example: `/${name}`,
    module: MODULE,
    operation,
    permission,
    title: `Choose a work order: ${name}`,
    key: "workOrderId",
    list: async (env, a) => (await callTool(env, "manufacturing_list_work_orders", { status, ...page(a) })).parts ?? [],
    select: (env, a) => proposeTool(env, tool, { workOrderId: need(a, "workOrderId") }),
  });
const startworkorder = woPicker("startworkorder", "Start a draft work order.", "draft", "approve", PERMISSIONS.MANUFACTURING_WORK_ORDER_EXECUTE, "manufacturing_start_work_order");
const completeworkorder = woPicker("completeworkorder", "Complete a work order: consumes materials, receives goods (typed confirmation).", "in_progress", "approve", PERMISSIONS.MANUFACTURING_WORK_ORDER_EXECUTE, "manufacturing_complete_work_order");
const cancelworkorder = woPicker("cancelworkorder", "Cancel a work order (typed confirmation).", "all", "delete", PERMISSIONS.MANUFACTURING_WORK_ORDER_MANAGE, "manufacturing_cancel_work_order");

export const MANUFACTURING_COMMANDS: CommandDefinition[] = [
  boms,
  bom,
  workorders,
  workorder,
  materials,
  newbom,
  editbom,
  activatebom,
  archivebom,
  newworkorder,
  startworkorder,
  completeworkorder,
  cancelworkorder,
];
