import "server-only";
import { callTool, field, form, nonEmpty, proposeTool } from "@/server/ai/commands/helpers";
import { ARGS, need, noText, pickCommand, requireCell, searchText } from "@/server/ai/commands/shared";
import type { CommandArgs, CommandDefinition, CommandEnv, DraftCandidate, DraftCurrent } from "@/server/ai/commands/types";
import { withAssist } from "@/server/ai/draft/assist";
import { parseRows, serializeRows, type LineRow } from "@/server/ai/draft/draft-lines";
import type { AiDraftMeta, AiFormField, AiMessagePart, AiProvenance } from "@/server/db/documents";
import { getProduct, listProductOptions, listProducts, listWarehouses } from "@/server/inventory/catalog.service";
import { getWorkOrder, previewMaterialAvailability } from "@/server/manufacturing/work-order.service";
import { getPurchaseOrder, listPurchaseOrders } from "@/server/purchasing/purchase-order.service";
import { getSupplier, listSuppliers, supplierOptions } from "@/server/purchasing/supplier.service";
import { getReplenishmentProposal } from "@/server/purchasing/replenishment.service";
import { PERMISSIONS } from "@/server/security/permissions";
import { AppError } from "@/shared/lib/errors";

/**
 * Purchasing commands. Reads reuse the read tools; writes build a form (manual or AI-drafted from the SAME
 * field builders), then hand the values to the write tool. Workflow: replenishment -> order -> approval ->
 * receipt -> posting, with each step offered as an action on the previous result.
 */
const MODULE = "purchasing" as const;
type Values = Record<string, string | boolean> | null;
const v = (cur: Values, key: string, fallback: string | boolean): string | boolean => (cur && cur[key] !== undefined ? cur[key] : fallback);

// ─── Reads ────────────────────────────────────────────────────────────────────

const read = (name: string, description: string, tool: string, pick: (args: CommandArgs) => Record<string, unknown>, hidden = false): CommandDefinition => ({
  name,
  description,
  example: `/${name}`,
  module: MODULE,
  operation: "view",
  permission: PERMISSIONS.PURCHASING_READ,
  hidden,
  args: ARGS,
  fromText: searchText,
  async start(env, args) {
    return { parts: (await callTool(env, tool, pick(args))).parts ?? [] };
  },
});

const page = (args: CommandArgs) => ({ page: Number(args.page ?? 1) });
const STATUS = ["draft", "approved", "partially_received", "received", "cancelled"];
const suppliers = read("suppliers", "Browse and search suppliers.", "purchasing_list_suppliers", (a) => ({ q: String(a.q ?? ""), ...page(a) }));
const orders = read("orders", "List purchase orders (try /orders draft).", "purchasing_list_orders", (a) => ({ ...(STATUS.includes(String(a.status ?? a.q ?? "").toLowerCase()) ? { status: String(a.status ?? a.q).toLowerCase() } : { q: String(a.q ?? "") }), ...page(a) }));
const order = read("order", "Show one purchase order.", "purchasing_get_order", (a) => ({ orderId: need(a, "orderId") }), true);
const receipts = read("receipts", "List goods receipts.", "purchasing_list_receipts", (a) => ({ ...(a.status ? { status: String(a.status) } : {}), ...page(a) }));
const receipt = read("receipt", "Show one goods receipt.", "purchasing_get_receipt", (a) => ({ receiptId: need(a, "receiptId") }), true);
const replenishment = read("proposals", "List replenishment proposals.", "purchasing_list_replenishment", page);
const proposal = read("proposal", "Show one replenishment proposal.", "purchasing_get_replenishment", (a) => ({ proposalId: need(a, "proposalId") }), true);

// ─── Option lists and field builders ──────────────────────────────────────────

async function productOptions(env: CommandEnv) {
  return (await listProductOptions(env.ctx)).map((p) => ({ value: p.id, label: `${p.sku} · ${p.name}` }));
}
async function supplierChoices(env: CommandEnv) {
  return [{ value: "", label: "Choose a supplier" }, ...(await supplierOptions(env.ctx)).map((s) => ({ value: s.id, label: s.name }))];
}
async function warehouseChoices(env: CommandEnv) {
  return (await listWarehouses(env.ctx)).filter((w) => w.isActive).map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }));
}

const BLANK_ROW: LineRow = { productId: "", quantity: "", unitCost: "0.000", taxRate: "0" };

async function orderFields(env: CommandEnv, cur: Values): Promise<AiFormField[]> {
  return [
    field({ name: "supplierId", label: "Supplier", kind: "select", required: true, value: v(cur, "supplierId", ""), options: await supplierChoices(env) }),
    field({ name: "expectedDate", label: "Expected date", kind: "text", value: v(cur, "expectedDate", ""), placeholder: "YYYY-MM-DD" }),
    field({ name: "notes", label: "Notes", kind: "textarea", value: v(cur, "notes", "") }),
    field({
      name: "lines",
      label: "Products",
      kind: "lines",
      required: true,
      value: v(cur, "lines", serializeRows([BLANK_ROW])),
      lines: {
        maxRows: 100,
        addLabel: "Add product",
        columns: [
          { name: "productId", label: "Product", kind: "select", options: await productOptions(env) },
          { name: "quantity", label: "Quantity", kind: "text", placeholder: "0" },
          { name: "unitCost", label: "Unit cost", kind: "text", placeholder: "0.000" },
          { name: "taxRate", label: "Tax %", kind: "text", placeholder: "0" },
        ],
      },
    }),
  ];
}

const productLabel = (p: { sku: string; name: string }) => `${p.sku} · ${p.name}`;

async function findProducts(env: CommandEnv, ref: string): Promise<DraftCandidate[]> {
  const find = async (q: string) => (await listProducts(env.ctx, { q, status: "active", page: 1 })).items;
  let items = await find(ref.slice(0, 80));
  if (items.length === 0) {
    const token = ref.split(/\s+/).find((t) => t.length >= 3);
    if (token) items = await find(token);
  }
  return items.map((p) => ({ id: p.id, label: productLabel(p), detail: p.cost }));
}
async function productById(env: CommandEnv, id: string): Promise<DraftCandidate | null> {
  try {
    const p = await getProduct(env.ctx, id);
    return p.isActive ? { id: p.id, label: productLabel(p), detail: p.cost } : null;
  } catch {
    return null;
  }
}

/** Order lines: a matched product brings its own standard cost (a value from the company's records); tax starts at the form's default. */
const orderLines = {
  field: "lines",
  keyColumn: "productId",
  requiredColumns: ["quantity"],
  criticalColumns: ["quantity", "unitCost", "taxRate"],
  find: (env: CommandEnv, ref: string) => findProducts(env, ref),
  byId: (env: CommandEnv, id: string) => productById(env, id),
  async newRow(_env: CommandEnv, c: DraftCandidate) {
    return { row: { productId: c.id, label: c.label, quantity: "", unitCost: c.detail, taxRate: "0" }, provenance: { productId: "found", unitCost: "found", taxRate: "default", quantity: "default" } as Record<string, AiProvenance> };
  },
};

const supplierRef = {
  async find(env: CommandEnv, words: string): Promise<DraftCandidate[]> {
    const first = (await listSuppliers(env.ctx, { q: words.slice(0, 80), page: 1 })).items.filter((s) => s.isActive);
    return first.map((s) => ({ id: s.id, label: s.name, detail: s.email }));
  },
  async byId(env: CommandEnv, id: string): Promise<DraftCandidate | null> {
    try {
      const s = await getSupplier(env.ctx, id);
      return s.isActive ? { id: s.id, label: s.name, detail: s.email } : null;
    } catch {
      return null;
    }
  },
};

const toToolLines = (json: string) =>
  parseRows(json)
    .filter((r) => (r.productId ?? "") !== "")
    .map((r) => ({ productId: r.productId, quantity: r.quantity ?? "", ...(r.unitCost ? { unitCost: r.unitCost } : {}), ...(r.taxRate ? { taxRate: r.taxRate } : {}) }));

// ─── Suppliers ────────────────────────────────────────────────────────────────

const supplierFields = (cur: Values, mode: "create" | "edit"): AiFormField[] => [
  field({ name: "name", label: "Name", kind: "text", required: true, value: v(cur, "name", "") }),
  field({ name: "email", label: "Email", kind: "text", value: v(cur, "email", "") }),
  field({ name: "phone", label: "Phone", kind: "text", value: v(cur, "phone", "") }),
  field({ name: "taxIdentifier", label: "Tax ID", kind: "text", value: v(cur, "taxIdentifier", "") }),
  field({ name: "address", label: "Address", kind: "text", value: v(cur, "address", "") }),
  ...(mode === "edit" ? [field({ name: "isActive", label: "Active", kind: "checkbox", value: v(cur, "isActive", true) })] : []),
];

async function loadSupplier(env: CommandEnv, id: string): Promise<DraftCurrent> {
  const s = await getSupplier(env.ctx, id);
  return { id: s.id, label: s.name, values: { name: s.name, email: s.email, phone: s.phone, taxIdentifier: s.taxIdentifier, address: s.address, isActive: s.isActive } };
}
async function searchSuppliers(env: CommandEnv, text: string): Promise<DraftCandidate[]> {
  return (await listSuppliers(env.ctx, { q: text.slice(0, 80), page: 1 })).items.map((s) => ({ id: s.id, label: s.name, detail: s.email || "No email" }));
}

const newsupplier = withAssist(
  {
    name: "newsupplier",
    description: "Create a supplier.",
    example: "/newsupplier",
    module: MODULE,
    operation: "create",
    permission: PERMISSIONS.PURCHASING_SUPPLIER_MANAGE,
    args: ARGS,
    fromText: noText,
    async start() {
      return { parts: [form({ title: "New supplier", command: "newsupplier", context: {}, submitLabel: "Review", fields: supplierFields(null, "create") })] };
    },
    submit: (env, _a, values) => proposeTool(env, "purchasing_create_supplier", nonEmpty(values)),
  },
  { kind: "create", noun: "supplier", examples: ["A supplier called Olive Grove SARL, email contact@olivegrove.tn, phone 71 000 000"], tool: "purchasing_create_supplier", criticalFields: [], fields: async () => supplierFields(null, "create") }
);

const editsupplierBase = pickCommand({
  name: "editsupplier",
  description: "Edit a supplier.",
  example: "/editsupplier olive",
  module: MODULE,
  operation: "edit",
  permission: PERMISSIONS.PURCHASING_SUPPLIER_MANAGE,
  title: "Choose a supplier to edit",
  key: "supplierId",
  list: async (env, a) => (await callTool(env, "purchasing_list_suppliers", { q: String(a.q ?? ""), page: Number(a.page ?? 1) })).parts ?? [],
  async select(env, a) {
    const c = await loadSupplier(env, need(a, "supplierId"));
    return { parts: [form({ title: `Edit ${c.label}`, command: "editsupplier", context: { supplierId: c.id }, submitLabel: "Review changes", fields: supplierFields(c.values, "edit") })] };
  },
});
editsupplierBase.submit = (env, a, values) => proposeTool(env, "purchasing_update_supplier", { ...nonEmpty(values, ["email", "phone", "taxIdentifier", "address", "isActive"]), supplierId: need(a, "supplierId") });
const editsupplier = withAssist(editsupplierBase, {
  kind: "edit",
  noun: "supplier",
  examples: ["Change the phone number of Olive Grove to 71 123 456"],
  tool: "purchasing_update_supplier",
  criticalFields: [],
  target: { label: "supplier", key: "supplierId", search: searchSuppliers, load: loadSupplier },
  fields: async (_e, cur) => supplierFields(cur?.values ?? null, "edit"),
  context: (cur) => ({ supplierId: cur.id }),
});

// ─── Purchase orders ──────────────────────────────────────────────────────────

/** Rows and provenance for a shortage hand-off: real shortfall quantities from a work order or a material check. */
async function shortageRows(env: CommandEnv, args: CommandArgs): Promise<{ rows: LineRow[]; source: string } | null> {
  let shortages: { productId: string; shortfall: string }[] = [];
  let source = "";
  if (args.workOrderId) {
    const w = await getWorkOrder(env.ctx, need(args, "workOrderId"));
    shortages = w.materials.filter((m) => !m.sufficient).map((m) => ({ productId: m.productId, shortfall: m.shortfallExact }));
    source = `material shortages of ${w.orderNumber}`;
  } else if (args.bomId) {
    const a = await previewMaterialAvailability(env.ctx, { bomId: need(args, "bomId"), warehouseId: need(args, "warehouseId"), quantity: String(args.quantity ?? "") });
    shortages = a.materials.filter((m) => !m.sufficient).map((m) => ({ productId: m.productId, shortfall: m.shortfallExact }));
    source = `material shortages for ${args.quantity}`;
  }
  if (!source) return null;
  const rows: LineRow[] = [];
  for (const s of shortages) {
    const p = await getProduct(env.ctx, s.productId);
    rows.push({ productId: p.id, label: productLabel(p), quantity: s.shortfall, unitCost: p.cost, taxRate: "0" });
  }
  return { rows, source };
}

async function loadOrder(env: CommandEnv, id: string): Promise<DraftCurrent> {
  const o = await getPurchaseOrder(env.ctx, id);
  if (o.status !== "draft") throw new AppError("INVALID_TRANSITION", `${o.orderNumber} is ${o.status}. Only draft orders can be edited.`);
  return {
    id: o.id,
    label: o.orderNumber,
    version: o.version,
    values: {
      supplierId: o.supplierId,
      expectedDate: o.expectedDate?.slice(0, 10) ?? "",
      notes: o.notes,
      lines: serializeRows(o.lines.map((l) => ({ productId: l.productId, label: productLabel({ sku: l.sku, name: l.productName }), quantity: l.ordered, unitCost: l.unitCost, taxRate: l.taxRate }))),
    },
  };
}
async function searchDraftOrders(env: CommandEnv, text: string): Promise<DraftCandidate[]> {
  const p = await listPurchaseOrders(env.ctx, { status: "draft", q: text.slice(0, 80), page: 1 });
  return p.items.map((o) => ({ id: o.id, label: o.orderNumber, detail: `${o.supplierName} · ${o.total} ${o.currencyCode}` }));
}

const neworderBase: CommandDefinition = {
  name: "neworder",
  description: "Create a draft purchase order.",
  example: "/neworder",
  module: MODULE,
  operation: "create",
  permission: PERMISSIONS.PURCHASING_ORDER_MANAGE,
  args: ARGS,
  fromText: noText,
  async start(env, args) {
    requireCell(env, MODULE, "view");
    const fields = await orderFields(env, args.supplierId ? { supplierId: String(args.supplierId) } : null);
    const shortage = await shortageRows(env, args);
    if (!shortage) return { parts: [form({ title: "New purchase order", command: "neworder", context: {}, submitLabel: "Review", fields })] };

    // A shortage hand-off: real shortfall quantities, each marked as found in the company's own records.
    const withRows = fields.map((f) => (f.name === "lines" ? { ...f, value: serializeRows(shortage.rows.length ? shortage.rows : [BLANK_ROW]) } : f.name === "notes" ? { ...f, value: `For ${shortage.source}` } : f));
    const meta: AiDraftMeta = {
      sourceText: shortage.source,
      provenance: { lines: "found", notes: "found" },
      lineProvenance: { lines: shortage.rows.map(() => ({ productId: "found", quantity: "found", unitCost: "found", taxRate: "default" }) as Record<string, AiProvenance>) },
      questions: [{ field: "supplierId", question: "Choose the supplier to order from." }, ...(shortage.rows.length === 0 ? [{ field: "lines", question: "Nothing is short right now, so there is nothing to order." }] : [])],
      changed: [],
    };
    return { parts: [form({ title: "Order the shortages", description: `Quantities are the exact shortfalls from the ${shortage.source}.`, command: "neworder", context: {}, submitLabel: "Review", fields: withRows, draft: meta })] };
  },
  submit: (env, _a, values) =>
    proposeTool(env, "purchasing_create_order", { supplierId: String(values.supplierId ?? ""), expectedDate: String(values.expectedDate ?? ""), notes: String(values.notes ?? ""), lines: toToolLines(String(values.lines ?? "[]")) }),
};
const neworder = withAssist(neworderBase, {
  kind: "create",
  noun: "purchase order",
  examples: ["Order 50 steel bolts and 20 hex nuts from Olive Grove, expected 2026-12-01"],
  tool: "purchasing_create_order",
  criticalFields: ["supplierId"],
  refFields: { supplierId: supplierRef },
  lines: orderLines,
  fields: (env, cur) => orderFields(env, cur?.values ?? null),
});

const editorderBase = pickCommand({
  name: "editorder",
  description: "Edit a draft purchase order (supplier, dates, lines).",
  example: "/editorder PO-0001",
  module: MODULE,
  operation: "edit",
  permission: PERMISSIONS.PURCHASING_ORDER_MANAGE,
  title: "Choose a draft order to edit",
  key: "orderId",
  list: async (env, a) => (await callTool(env, "purchasing_list_orders", { status: "draft", q: String(a.q ?? ""), page: Number(a.page ?? 1) })).parts ?? [],
  async select(env, a) {
    const cur = await loadOrder(env, need(a, "orderId"));
    return { parts: [form({ title: `Edit ${cur.label}`, description: "Change what you need. You will see exactly what changes before anything is saved.", command: "editorder", context: { orderId: cur.id, version: cur.version ?? 0 }, submitLabel: "Review changes", fields: await orderFields(env, cur.values) })] };
  },
});
editorderBase.submit = (env, a, values) =>
  proposeTool(env, "purchasing_update_order", { orderId: need(a, "orderId"), supplierId: String(values.supplierId ?? ""), expectedDate: String(values.expectedDate ?? ""), notes: String(values.notes ?? ""), lines: toToolLines(String(values.lines ?? "[]")), expectedVersion: Number(a.version) });
const editorder = withAssist(editorderBase, {
  kind: "edit",
  noun: "purchase order",
  examples: ["On PO-0001 change the quantity of the steel bolts to 80 and remove the hex nuts"],
  tool: "purchasing_update_order",
  criticalFields: ["supplierId"],
  refFields: { supplierId: supplierRef },
  lines: orderLines,
  target: { label: "draft purchase order", key: "orderId", search: searchDraftOrders, load: loadOrder },
  fields: (env, cur) => orderFields(env, cur?.values ?? null),
  context: (cur) => ({ orderId: cur.id, version: cur.version ?? 0 }),
});

const orderPicker = (name: string, description: string, example: string, status: "draft" | "approved", operation: CommandDefinition["operation"], permission: CommandDefinition["permission"], tool: string) =>
  pickCommand({
    name,
    description,
    example,
    module: MODULE,
    operation,
    permission,
    title: `Choose an order: ${name}`,
    key: "orderId",
    list: async (env, a) => (await callTool(env, "purchasing_list_orders", { status, q: String(a.q ?? ""), page: Number(a.page ?? 1) })).parts ?? [],
    select: (env, a) => proposeTool(env, tool, { orderId: need(a, "orderId") }),
  });
const approveorder = orderPicker("approveorder", "Approve a draft purchase order (typed confirmation).", "/approveorder", "draft", "approve", PERMISSIONS.PURCHASING_ORDER_APPROVE, "purchasing_approve_order");
const cancelorder = pickCommand({
  name: "cancelorder",
  description: "Cancel a purchase order (typed confirmation).",
  example: "/cancelorder",
  module: MODULE,
  operation: "delete",
  permission: PERMISSIONS.PURCHASING_ORDER_MANAGE,
  title: "Choose an order to cancel",
  key: "orderId",
  list: async (env, a) => (await callTool(env, "purchasing_list_orders", { q: String(a.q ?? ""), page: Number(a.page ?? 1) })).parts ?? [],
  select: (env, a) => proposeTool(env, "purchasing_cancel_order", { orderId: need(a, "orderId") }),
});

// ─── Goods receipts ───────────────────────────────────────────────────────────

async function receiptFields(env: CommandEnv, cur: Values): Promise<AiFormField[]> {
  return [
    field({ name: "warehouseId", label: "Warehouse", kind: "select", required: true, value: v(cur, "warehouseId", ""), options: [{ value: "", label: "Choose a warehouse" }, ...(await warehouseChoices(env))] }),
    field({
      name: "lines",
      label: "Quantities received",
      kind: "lines",
      value: v(cur, "lines", "[]"),
      hint: "Leave a line empty if nothing arrived for it.",
      lines: {
        maxRows: 100,
        fixedRows: true,
        fillRemaining: { from: "remaining", to: "quantity" },
        columns: [
          { name: "label", label: "Item", kind: "readonly" },
          { name: "remaining", label: "Remaining", kind: "readonly", align: "right" },
          { name: "quantity", label: "Received now", kind: "text", placeholder: "0" },
        ],
      },
    }),
  ];
}

async function loadReceivable(env: CommandEnv, id: string): Promise<DraftCurrent> {
  const o = await getPurchaseOrder(env.ctx, id);
  if (o.status !== "approved" && o.status !== "partially_received") throw new AppError("INVALID_TRANSITION", `${o.orderNumber} is ${o.status}. Receipts need an approved order.`);
  return {
    id: o.id,
    label: o.orderNumber,
    values: { warehouseId: "", lines: serializeRows(o.lines.filter((l) => l.remainingMicro > 0).map((l) => ({ purchaseOrderLineId: l.id, label: productLabel({ sku: l.sku, name: l.productName }), remaining: l.remaining, quantity: "" }))) },
  };
}
async function searchReceivable(env: CommandEnv, text: string): Promise<DraftCandidate[]> {
  const out: DraftCandidate[] = [];
  for (const status of ["approved", "partially_received"] as const) {
    for (const o of (await listPurchaseOrders(env.ctx, { status, q: text.slice(0, 80), page: 1 })).items) out.push({ id: o.id, label: o.orderNumber, detail: `${o.supplierName} · ${status.replace("_", " ")}` });
  }
  return out;
}

const receiptLines = {
  field: "lines",
  keyColumn: "purchaseOrderLineId",
  requiredColumns: [],
  criticalColumns: ["quantity"],
  fixedRows: true,
  async find(env: CommandEnv, ref: string, cur: DraftCurrent | null): Promise<DraftCandidate[]> {
    if (!cur) return [];
    const o = await getPurchaseOrder(env.ctx, cur.id);
    const t = ref.toLowerCase();
    return o.lines.filter((l) => l.sku.toLowerCase().includes(t) || l.productName.toLowerCase().includes(t)).map((l) => ({ id: l.id, label: productLabel({ sku: l.sku, name: l.productName }), detail: l.remaining }));
  },
  async byId(env: CommandEnv, id: string, cur: DraftCurrent | null): Promise<DraftCandidate | null> {
    if (!cur) return null;
    const l = (await getPurchaseOrder(env.ctx, cur.id)).lines.find((x) => x.id === id);
    return l ? { id: l.id, label: productLabel({ sku: l.sku, name: l.productName }), detail: l.remaining } : null;
  },
  async newRow(_e: CommandEnv, c: DraftCandidate) {
    return { row: { purchaseOrderLineId: c.id, label: c.label, remaining: c.detail, quantity: "" }, provenance: {} as Record<string, AiProvenance> };
  },
};

const receivegoodsBase = pickCommand({
  name: "receivegoods",
  description: "Record goods received against an approved order.",
  example: "/receivegoods PO-0001",
  module: MODULE,
  operation: "create",
  permission: PERMISSIONS.PURCHASING_RECEIPT_POST,
  title: "Choose an order to receive against",
  key: "orderId",
  list: async (env, a) => {
    // Orders that can still receive goods are "approved" and "partially received": show both in one list.
    const q = String(a.q ?? "");
    const [approved, partial] = await Promise.all([
      callTool(env, "purchasing_list_orders", { status: "approved", q, page: Number(a.page ?? 1) }),
      callTool(env, "purchasing_list_orders", { status: "partially_received", q, page: Number(a.page ?? 1) }),
    ]);
    const a1 = approved.parts?.find((p) => p.type === "record_table");
    const b1 = partial.parts?.find((p) => p.type === "record_table");
    if (a1?.type !== "record_table") return approved.parts ?? [];
    return [{ ...a1, rows: [...a1.rows, ...(b1?.type === "record_table" ? b1.rows : [])], total: a1.total + (b1?.type === "record_table" ? b1.total : 0), paging: a1.paging }];
  },
  async select(env, a) {
    const cur = await loadReceivable(env, need(a, "orderId"));
    return { parts: [form({ title: `Receive goods for ${cur.label}`, description: "Nothing is added to stock until the receipt is posted.", command: "receivegoods", context: { orderId: cur.id }, submitLabel: "Review", fields: await receiptFields(env, cur.values) })] };
  },
});
receivegoodsBase.submit = (env, a, values) =>
  proposeTool(env, "purchasing_create_receipt", {
    purchaseOrderId: need(a, "orderId"),
    warehouseId: String(values.warehouseId ?? ""),
    lines: parseRows(String(values.lines ?? "[]"))
      .filter((r) => (r.quantity ?? "").trim() !== "")
      .map((r) => ({ purchaseOrderLineId: r.purchaseOrderLineId, quantity: r.quantity })),
  });
const receivegoods = withAssist(receivegoodsBase, {
  kind: "create",
  action: "Receive goods",
  noun: "goods receipt",
  examples: ["Receive 20 steel bolts of PO-0001 into the Main Store"],
  tool: "purchasing_create_receipt",
  criticalFields: ["warehouseId"],
  lines: receiptLines,
  target: { label: "approved purchase order", key: "orderId", search: searchReceivable, load: loadReceivable },
  fields: (env, cur) => receiptFields(env, cur?.values ?? null),
  context: (cur) => ({ orderId: cur.id }),
  fromToolArgs: (a) => ({ targetId: String(a.purchaseOrderId ?? ""), values: a }),
});

const receiptPicker = (name: string, description: string, tool: string, operation: CommandDefinition["operation"]) =>
  pickCommand({
    name,
    description,
    example: `/${name}`,
    module: MODULE,
    operation,
    permission: PERMISSIONS.PURCHASING_RECEIPT_POST,
    title: `Choose a draft receipt: ${name}`,
    key: "receiptId",
    list: async (env, a) => (await callTool(env, "purchasing_list_receipts", { status: "draft", page: Number(a.page ?? 1) })).parts ?? [],
    select: (env, a) => proposeTool(env, tool, { receiptId: need(a, "receiptId") }),
  });
const postreceipt = receiptPicker("postreceipt", "Post a draft receipt into stock.", "purchasing_post_receipt", "edit");
const cancelreceipt = receiptPicker("cancelreceipt", "Cancel a draft receipt (typed confirmation).", "purchasing_cancel_receipt", "delete");

// ─── Replenishment ────────────────────────────────────────────────────────────

const replenishFields = async (env: CommandEnv, cur: Values): Promise<AiFormField[]> => [
  field({ name: "warehouseId", label: "Warehouse", kind: "select", required: true, value: v(cur, "warehouseId", ""), options: [{ value: "", label: "Choose a warehouse" }, ...(await warehouseChoices(env))] }),
  field({ name: "horizonDays", label: "Days to cover", kind: "text", required: true, value: v(cur, "horizonDays", ""), hint: "1 to 90. Suggestions use the last 30 days of usage." }),
];

const genreplenishment = withAssist(
  {
    name: "genreplenishment",
    description: "Generate a replenishment proposal for a warehouse.",
    example: "/genreplenishment",
    module: MODULE,
    operation: "create",
    permission: PERMISSIONS.PURCHASING_ORDER_MANAGE,
    args: ARGS,
    fromText: noText,
    async start(env) {
      requireCell(env, MODULE, "view");
      return { parts: [form({ title: "Generate a replenishment proposal", command: "genreplenishment", context: {}, submitLabel: "Review", fields: await replenishFields(env, null) })] };
    },
    submit: (env, _a, values) => proposeTool(env, "purchasing_generate_replenishment", { warehouseId: String(values.warehouseId ?? ""), horizonDays: String(values.horizonDays ?? "") }),
  },
  {
    kind: "create",
    noun: "replenishment proposal",
    action: "Generate replenishment",
    examples: ["What should we reorder for the Main Store to cover the next 3 weeks?"],
    tool: "purchasing_generate_replenishment",
    criticalFields: ["horizonDays", "warehouseId"],
    fields: (env, cur) => replenishFields(env, cur?.values ?? null),
  }
);

const convertproposal = pickCommand({
  name: "convertproposal",
  description: "Turn a replenishment proposal into a draft purchase order.",
  example: "/convertproposal",
  module: MODULE,
  operation: "approve",
  permission: PERMISSIONS.PURCHASING_ORDER_APPROVE,
  title: "Choose a proposal to convert",
  key: "proposalId",
  list: async (env, a) => {
    const result = await callTool(env, "purchasing_list_replenishment", { page: Number(a.page ?? 1) });
    return result.parts ?? [];
  },
  async select(env, a) {
    const p = await getReplenishmentProposal(env.ctx, need(a, "proposalId"));
    if (p.status !== "proposed") throw new AppError("INVALID_TRANSITION", "This proposal was already converted.");
    return {
      parts: [
        form({
          title: `Order the ${p.warehouseCode} proposal (${p.lineCount} items)`,
          description: "Choose the supplier. A draft purchase order is created with the suggested quantities; you approve it separately.",
          command: "convertproposal",
          context: { proposalId: p.id, version: p.version },
          submitLabel: "Review",
          fields: [field({ name: "supplierId", label: "Supplier", kind: "select", required: true, value: "", options: await supplierChoices(env) })],
        }),
      ],
    };
  },
});
convertproposal.submit = (env, a, values) => proposeTool(env, "purchasing_convert_replenishment", { proposalId: need(a, "proposalId"), supplierId: String(values.supplierId ?? ""), expectedVersion: Number(a.version) });

export const PURCHASING_COMMANDS: CommandDefinition[] = [
  suppliers,
  orders,
  order,
  receipts,
  receipt,
  replenishment,
  proposal,
  newsupplier,
  editsupplier,
  neworder,
  editorder,
  approveorder,
  cancelorder,
  receivegoods,
  postreceipt,
  cancelreceipt,
  genreplenishment,
  convertproposal,
];

export type { AiMessagePart };
