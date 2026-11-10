import "server-only";
import { z } from "zod";
import { callTool, field, form, nonEmpty, proposeTool } from "@/server/ai/commands/helpers";
import type { CommandArgs, CommandDefinition, CommandEnv, CommandResult, DraftCandidate, DraftCurrent, DraftSpec } from "@/server/ai/commands/types";
import { withAssist } from "@/server/ai/draft/assist";
import { getProduct, getWarehouse, listCategories, listProducts, listWarehouses } from "@/server/inventory/catalog.service";
import { listBalancesForProduct } from "@/server/inventory/stock.service";
import type { AiFormField, AiMessagePart } from "@/server/db/documents";
import { PERMISSIONS } from "@/server/security/permissions";
import { UNIT_LABELS, UNITS_OF_MEASURE } from "@/shared/domain/units";
import { AppError } from "@/shared/lib/errors";
import { objectIdSchema } from "@/shared/lib/schema-primitives";

/**
 * Inventory slash commands. Reads reuse the read tools; writes build a form, then hand the values to
 * the write tool, which prepares a diff and stores a proposal. The person confirms it in the thread.
 */
const ARGS = z.record(z.string().max(40), z.union([z.string().max(600), z.number(), z.boolean()])).refine((v) => Object.keys(v).length <= 8, "Too many arguments");

const searchText = (rest: string) => ({ q: rest.trim().slice(0, 80) });
const noText = () => ({});

function need(args: CommandArgs, key: string): string {
  const parsed = objectIdSchema.safeParse(args[key]);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Select a record first.");
  return parsed.data;
}

function requireCell(env: CommandEnv, op: "view" | "create" | "edit" | "delete" | "approve"): void {
  if (!env.access.can("inventory", op)) throw new AppError("FORBIDDEN", "You do not have AI access for that.");
}

/** Converts a list table into a picker: every row gets one Select action that continues `command`. */
function asPicker(parts: AiMessagePart[] | undefined, command: string, key: string, title: string): AiMessagePart[] {
  return (parts ?? []).map((part) => {
    if (part.type !== "record_table") return part;
    return {
      ...part,
      title,
      rows: part.rows.map((r) => ({ ...r, actions: [{ label: "Select", command, args: { [key]: r.id.split(":")[0] }, step: "select" as const }] })),
      paging: part.paging ? { ...part.paging, command } : undefined,
    };
  });
}

function pickProduct(def: {
  name: string;
  description: string;
  example: string;
  operation: CommandDefinition["operation"];
  permission: CommandDefinition["permission"];
  title: string;
  status?: "active" | "archived";
  select: NonNullable<CommandDefinition["select"]>;
}): CommandDefinition {
  return {
    name: def.name,
    description: def.description,
    example: def.example,
    module: "inventory",
    operation: def.operation,
    permission: def.permission,
    args: ARGS,
    fromText: searchText,
    async start(env, args) {
      requireCell(env, "view");
      const result = await callTool(env, "inventory_list_products", { q: String(args.q ?? ""), status: def.status ?? "active", page: Number(args.page ?? 1) });
      return { parts: asPicker(result.parts, def.name, "productId", def.title) };
    },
    select: def.select,
  };
}

const money = (name: string, label: string, value = ""): AiFormField => field({ name, label, kind: "text", value, placeholder: "0.000", hint: "Up to 3 decimals" });

async function categoryOptions(env: CommandEnv): Promise<{ value: string; label: string }[]> {
  const active = (await listCategories(env.ctx)).filter((c) => c.isActive);
  return [{ value: "", label: "No category" }, ...active.map((c) => ({ value: c.id, label: c.name }))];
}

const unitOptions = UNITS_OF_MEASURE.map((u) => ({ value: u, label: `${UNIT_LABELS[u]} (${u})` }));

// ─── Reads ────────────────────────────────────────────────────────────────────

const products: CommandDefinition = {
  name: "products",
  description: "Browse and search products.",
  example: "/products bolt",
  module: "inventory",
  operation: "view",
  permission: PERMISSIONS.INVENTORY_READ,
  args: ARGS,
  fromText: searchText,
  async start(env, args) {
    const status = args.status === "archived" || args.status === "all" ? args.status : "active";
    const result = await callTool(env, "inventory_list_products", { q: String(args.q ?? ""), status, page: Number(args.page ?? 1), ...(args.categoryId ? { categoryId: String(args.categoryId) } : {}) });
    return { parts: result.parts ?? [] };
  },
};

const product: CommandDefinition = {
  name: "product",
  description: "Show one product.",
  example: "/product",
  module: "inventory",
  operation: "view",
  permission: PERMISSIONS.INVENTORY_READ,
  hidden: true,
  args: ARGS,
  fromText: noText,
  async start(env, args) {
    return { parts: (await callTool(env, "inventory_get_product", { productId: need(args, "productId") })).parts ?? [] };
  },
};

const readCommand = (name: string, description: string, tool: string, pick: (args: CommandArgs) => Record<string, unknown>, hidden = false): CommandDefinition => ({
  name,
  description,
  example: `/${name}`,
  module: "inventory",
  operation: "view",
  permission: PERMISSIONS.INVENTORY_READ,
  hidden,
  args: ARGS,
  fromText: noText,
  async start(env, args) {
    return { parts: (await callTool(env, tool, pick(args))).parts ?? [] };
  },
});

const ids = (args: CommandArgs) => ({
  ...(args.productId ? { productId: String(args.productId) } : {}),
  ...(args.warehouseId ? { warehouseId: String(args.warehouseId) } : {}),
  page: Number(args.page ?? 1),
});

const categories = readCommand("categories", "List product categories.", "inventory_list_categories", () => ({}));
const warehouses = readCommand("warehouses", "List warehouses and their stock.", "inventory_list_warehouses", () => ({}));
const stock = readCommand("stock", "Stock on hand by product and warehouse.", "inventory_stock_balances", ids);
const movements = readCommand("movements", "Recent stock movements.", "inventory_stock_movements", ids);

// ─── Field builders: ONE definition per form, used by the manual form and by AI-assisted drafts ──────────

type Values = Record<string, string | boolean> | null;
const v = (cur: Values, key: string, fallback: string | boolean): string | boolean => (cur && cur[key] !== undefined ? cur[key] : fallback);

async function productFields(env: CommandEnv, cur: Values, mode: "create" | "edit"): Promise<AiFormField[]> {
  const map: Record<string, AiFormField> = {
    sku: field({ name: "sku", label: "SKU", kind: "text", required: true, value: v(cur, "sku", ""), placeholder: mode === "create" ? "BOLT-M8" : undefined }),
    name: field({ name: "name", label: "Name", kind: "text", required: true, value: v(cur, "name", "") }),
    unitOfMeasure: field({ name: "unitOfMeasure", label: "Unit", kind: "select", required: mode === "create", value: v(cur, "unitOfMeasure", "unit"), options: unitOptions }),
    categoryId: field({ name: "categoryId", label: "Category", kind: "select", value: v(cur, "categoryId", ""), options: await categoryOptions(env) }),
    cost: money("cost", "Cost", String(v(cur, "cost", "0"))),
    salePrice: money("salePrice", "Sale price", String(v(cur, "salePrice", "0"))),
    reorderPoint: field({ name: "reorderPoint", label: "Reorder point", kind: "text", value: v(cur, "reorderPoint", "0"), hint: mode === "create" ? "Whole number for units and boxes" : undefined }),
    isStorable: field({ name: "isStorable", label: "Keep stock of this product", kind: "checkbox", value: v(cur, "isStorable", true) }),
    description: field({ name: "description", label: "Description", kind: "textarea", value: v(cur, "description", "") }),
  };
  const order =
    mode === "create"
      ? ["sku", "name", "unitOfMeasure", "categoryId", "cost", "salePrice", "reorderPoint", "isStorable", "description"]
      : ["name", "sku", "categoryId", "unitOfMeasure", "cost", "salePrice", "reorderPoint", "isStorable", "description"];
  return order.map((k) => map[k]);
}

const categoryFields = (cur: Values): AiFormField[] => [
  field({ name: "name", label: "Name", kind: "text", required: true, value: v(cur, "name", "") }),
  field({ name: "description", label: "Description", kind: "textarea", value: v(cur, "description", "") }),
];

const warehouseFields = (cur: Values, mode: "create" | "edit"): AiFormField[] => [
  field({ name: "name", label: "Name", kind: "text", required: true, value: v(cur, "name", "") }),
  field({ name: "code", label: "Code", kind: "text", required: true, value: v(cur, "code", ""), ...(mode === "create" ? { hint: "2 to 12 letters, digits or dashes", placeholder: "MAIN" } : {}) }),
  field({ name: "address", label: "Address", kind: "text", value: v(cur, "address", "") }),
  ...(mode === "edit" ? [field({ name: "isActive", label: "Active", kind: "checkbox", value: v(cur, "isActive", true), hint: "A warehouse that holds stock cannot be deactivated" })] : []),
];

// ─── Real-record lookups for AI-assisted edits ────────────────────────────────

async function searchProducts(env: CommandEnv, text: string): Promise<DraftCandidate[]> {
  const find = async (q: string) => (await listProducts(env.ctx, { q, status: "active", page: 1 })).items;
  let items = await find(text.slice(0, 80));
  if (items.length === 0) {
    // Product search is prefix-based, so fall back to the first meaningful word.
    const token = text.split(/\s+/).find((t) => t.length >= 3);
    if (token) items = await find(token);
  }
  return items.map((p) => ({ id: p.id, label: `${p.sku} · ${p.name}`, detail: p.isStorable ? `${p.onHand} ${p.unitOfMeasure} on hand` : "Not stocked" }));
}

async function loadProduct(env: CommandEnv, id: string): Promise<DraftCurrent> {
  const p = await getProduct(env.ctx, id);
  return {
    id: p.id,
    label: `${p.sku} ${p.name}`,
    version: p.version,
    values: { name: p.name, sku: p.sku, categoryId: p.categoryId ?? "", unitOfMeasure: p.unitOfMeasure, cost: p.cost, salePrice: p.salePrice, reorderPoint: p.reorderPoint, isStorable: p.isStorable, description: p.description },
  };
}

async function searchCategories(env: CommandEnv, text: string): Promise<DraftCandidate[]> {
  const t = text.toLowerCase();
  return (await listCategories(env.ctx)).filter((c) => c.name.toLowerCase().includes(t)).map((c) => ({ id: c.id, label: c.name, detail: `${c.productCount} products${c.isActive ? "" : " · archived"}` }));
}

async function loadCategory(env: CommandEnv, id: string): Promise<DraftCurrent> {
  const c = (await listCategories(env.ctx)).find((x) => x.id === id);
  if (!c) throw new AppError("NOT_FOUND", "Category not found");
  return { id: c.id, label: c.name, values: { name: c.name, description: c.description } };
}

async function searchWarehouses(env: CommandEnv, text: string): Promise<DraftCandidate[]> {
  const t = text.toLowerCase();
  return (await listWarehouses(env.ctx)).filter((w) => w.name.toLowerCase().includes(t) || w.code.toLowerCase().includes(t)).map((w) => ({ id: w.id, label: `${w.code} · ${w.name}`, detail: `${w.onHand} units${w.isActive ? "" : " · inactive"}` }));
}

async function loadWarehouse(env: CommandEnv, id: string): Promise<DraftCurrent> {
  const w = await getWarehouse(env.ctx, id);
  return { id: w.id, label: `${w.code} ${w.name}`, values: { name: w.name, code: w.code, address: w.address, isActive: w.isActive } };
}

const productTarget: NonNullable<DraftSpec["target"]> = { label: "product", key: "productId", search: searchProducts, load: loadProduct };

// ─── Create ───────────────────────────────────────────────────────────────────

const newcategory: CommandDefinition = withAssist(
  {
    name: "newcategory",
    description: "Create a product category.",
    example: "/newcategory",
    module: "inventory",
    operation: "create",
    permission: PERMISSIONS.INVENTORY_PRODUCT_MANAGE,
    args: ARGS,
    fromText: noText,
    async start() {
      return { parts: [form({ title: "New category", command: "newcategory", context: {}, submitLabel: "Review", fields: categoryFields(null) })] };
    },
    submit: (env, _args, values) => proposeTool(env, "inventory_create_category", nonEmpty(values)),
  },
  {
    kind: "create",
    noun: "category",
    examples: ["A category called Fasteners for bolts, nuts and washers"],
    tool: "inventory_create_category",
    criticalFields: [],
    fields: async () => categoryFields(null),
  }
);

const newwarehouse: CommandDefinition = withAssist(
  {
    name: "newwarehouse",
    description: "Create a warehouse.",
    example: "/newwarehouse",
    module: "inventory",
    operation: "create",
    permission: PERMISSIONS.INVENTORY_WAREHOUSE_MANAGE,
    args: ARGS,
    fromText: noText,
    async start() {
      return { parts: [form({ title: "New warehouse", command: "newwarehouse", context: {}, submitLabel: "Review", fields: warehouseFields(null, "create") })] };
    },
    submit: (env, _args, values) => proposeTool(env, "inventory_create_warehouse", nonEmpty(values)),
  },
  {
    kind: "create",
    noun: "warehouse",
    examples: ["A warehouse called North Depot, code NORTH, at 12 Industrial Road, Sfax"],
    tool: "inventory_create_warehouse",
    criticalFields: ["code"],
    fields: async () => warehouseFields(null, "create"),
  }
);

const newproduct: CommandDefinition = withAssist(
  {
    name: "newproduct",
    description: "Create a product.",
    example: "/newproduct",
    module: "inventory",
    operation: "create",
    permission: PERMISSIONS.INVENTORY_PRODUCT_MANAGE,
    args: ARGS,
    fromText: noText,
    async start(env) {
      requireCell(env, "view");
      return { parts: [form({ title: "New product", command: "newproduct", context: {}, submitLabel: "Review", fields: await productFields(env, null, "create") })] };
    },
    submit: (env, _args, values) => proposeTool(env, "inventory_create_product", nonEmpty(values, ["categoryId", "isStorable"])),
  },
  {
    kind: "create",
    noun: "product",
    examples: ["Organic olive oil, 1 litre bottle, SKU OIL-001, cost 12 TND, sale price 18 TND, reorder at 20 units"],
    tool: "inventory_create_product",
    criticalFields: ["sku", "cost", "salePrice", "reorderPoint"],
    fields: (env) => productFields(env, null, "create"),
  }
);

// ─── Edit ─────────────────────────────────────────────────────────────────────

const editproductBase = pickProduct({
  name: "editproduct",
  description: "Edit a product: pick it, change fields, review, confirm.",
  example: "/editproduct bolt",
  operation: "edit",
  permission: PERMISSIONS.INVENTORY_PRODUCT_MANAGE,
  title: "Choose a product to edit",
  async select(env, args) {
    requireCell(env, "view");
    const p = await getProduct(env.ctx, need(args, "productId"));
    const cur = await loadProduct(env, p.id);
    return {
      parts: [
        form({
          title: `Edit ${p.sku}`,
          description: "Change what you need. You will see exactly what changes before anything is saved.",
          command: "editproduct",
          context: { productId: p.id, version: p.version },
          submitLabel: "Review changes",
          fields: await productFields(env, cur.values, "edit"),
        }),
      ],
    };
  },
});
editproductBase.submit = (env, args, values) =>
  proposeTool(env, "inventory_update_product", { ...nonEmpty(values, ["categoryId", "description", "isStorable"]), productId: need(args, "productId"), expectedVersion: Number(args.version) });
const editproduct = withAssist(editproductBase, {
  kind: "edit",
  noun: "product",
  examples: ["Raise the sale price of the steel bolt to 3.5 and move it to the Fasteners category"],
  tool: "inventory_update_product",
  criticalFields: ["sku", "cost", "salePrice", "reorderPoint"],
  target: productTarget,
  fields: async (env, cur) => productFields(env, cur?.values ?? null, "edit"),
  context: (cur) => ({ productId: cur.id, version: cur.version ?? 0 }),
});

const editcategoryBase: CommandDefinition = {
  name: "editcategory",
  description: "Rename a category or change its description.",
  example: "/editcategory",
  module: "inventory",
  operation: "edit",
  permission: PERMISSIONS.INVENTORY_PRODUCT_MANAGE,
  args: ARGS,
  fromText: noText,
  async start(env) {
    requireCell(env, "view");
    return { parts: asPicker((await callTool(env, "inventory_list_categories", {})).parts, "editcategory", "categoryId", "Choose a category to edit") };
  },
  async select(env, args) {
    const c = await loadCategory(env, need(args, "categoryId"));
    return { parts: [form({ title: `Edit ${c.label}`, command: "editcategory", context: { categoryId: c.id }, submitLabel: "Review changes", fields: categoryFields(c.values) })] };
  },
  submit: (env, args, values) => proposeTool(env, "inventory_update_category", { ...nonEmpty(values, ["description"]), categoryId: need(args, "categoryId") }),
};
const editcategory = withAssist(editcategoryBase, {
  kind: "edit",
  noun: "category",
  examples: ["Rename the Fasteners category to Hardware"],
  tool: "inventory_update_category",
  criticalFields: [],
  target: { label: "category", key: "categoryId", search: searchCategories, load: loadCategory },
  fields: async (_env, cur) => categoryFields(cur?.values ?? null),
  context: (cur) => ({ categoryId: cur.id }),
});

const editwarehouseBase: CommandDefinition = {
  name: "editwarehouse",
  description: "Edit a warehouse.",
  example: "/editwarehouse",
  module: "inventory",
  operation: "edit",
  permission: PERMISSIONS.INVENTORY_WAREHOUSE_MANAGE,
  args: ARGS,
  fromText: noText,
  async start(env) {
    requireCell(env, "view");
    return { parts: asPicker((await callTool(env, "inventory_list_warehouses", {})).parts, "editwarehouse", "warehouseId", "Choose a warehouse to edit") };
  },
  async select(env, args) {
    const w = await loadWarehouse(env, need(args, "warehouseId"));
    return { parts: [form({ title: `Edit ${w.label.split(" ")[0]}`, command: "editwarehouse", context: { warehouseId: w.id }, submitLabel: "Review changes", fields: warehouseFields(w.values, "edit") })] };
  },
  submit: (env, args, values) => proposeTool(env, "inventory_update_warehouse", { ...nonEmpty(values, ["address", "isActive"]), warehouseId: need(args, "warehouseId") }),
};
const editwarehouse = withAssist(editwarehouseBase, {
  kind: "edit",
  noun: "warehouse",
  examples: ["Change the address of the Main Store warehouse to 5 Harbour Street"],
  tool: "inventory_update_warehouse",
  criticalFields: ["code"],
  target: { label: "warehouse", key: "warehouseId", search: searchWarehouses, load: loadWarehouse },
  fields: async (_env, cur) => warehouseFields(cur?.values ?? null, "edit"),
  context: (cur) => ({ warehouseId: cur.id }),
});

const archiveproduct = pickProduct({
  name: "archiveproduct",
  description: "Archive a product (keeps its history).",
  example: "/archiveproduct bolt",
  operation: "edit",
  permission: PERMISSIONS.INVENTORY_PRODUCT_MANAGE,
  title: "Choose a product to archive",
  select: (env, args) => proposeTool(env, "inventory_set_product_active", { productId: need(args, "productId"), isActive: false }),
});

const restoreproduct = pickProduct({
  name: "restoreproduct",
  description: "Restore an archived product.",
  example: "/restoreproduct",
  operation: "edit",
  permission: PERMISSIONS.INVENTORY_PRODUCT_MANAGE,
  title: "Choose an archived product to restore",
  status: "archived",
  select: (env, args) => proposeTool(env, "inventory_set_product_active", { productId: need(args, "productId"), isActive: true }),
});

const deleteproduct = pickProduct({
  name: "deleteproduct",
  description: "Permanently delete an unused product (typed confirmation).",
  example: "/deleteproduct spare",
  operation: "delete",
  permission: PERMISSIONS.INVENTORY_PRODUCT_MANAGE,
  title: "Choose a product to delete",
  select: (env, args) => proposeTool(env, "inventory_delete_product", { productId: need(args, "productId") }),
});

// ─── Stock ────────────────────────────────────────────────────────────────────

/** With a product, labels show what it holds in each warehouse. Without one (the AI is still working out which product), plain labels. */
async function warehouseChoices(env: CommandEnv, productId: string | null) {
  const [all, balances] = await Promise.all([listWarehouses(env.ctx), productId ? listBalancesForProduct(env.ctx, productId) : Promise.resolve([])]);
  const held = new Map(balances.map((b) => [b.warehouseId, b.onHand]));
  return all.filter((w) => w.isActive).map((w) => ({ value: w.id, label: productId ? `${w.code} · ${w.name} (${held.get(w.id) ?? "0"} on hand)` : `${w.code} · ${w.name}` }));
}

const qty = field({ name: "quantity", label: "Quantity", kind: "text", required: true, placeholder: "0" });
const reason = (required: boolean) => field({ name: "reason", label: "Reason", kind: "text", required });

type StockKind = "receive" | "issue" | "transfer" | "adjust";
const STOCK: Record<StockKind, { description: string; op: "edit" | "approve"; permission: CommandDefinition["permission"]; tool: string; title: (sku: string) => string; action: string; example: string; critical: string[] }> = {
  receive: { description: "Receive stock into a warehouse.", op: "edit", permission: PERMISSIONS.INVENTORY_STOCK_MOVE, tool: "inventory_receive_stock", title: (s) => `Receive ${s}`, action: "Receive stock", example: "Receive 12 steel bolts into the Main Store, found in aisle 3", critical: ["quantity", "warehouseId"] },
  issue: { description: "Issue stock out of a warehouse.", op: "edit", permission: PERMISSIONS.INVENTORY_STOCK_MOVE, tool: "inventory_issue_stock", title: (s) => `Issue ${s}`, action: "Issue stock", example: "Issue 5 steel bolts from the Main Store, damaged in transport", critical: ["quantity", "warehouseId"] },
  transfer: { description: "Move stock between warehouses.", op: "edit", permission: PERMISSIONS.INVENTORY_STOCK_MOVE, tool: "inventory_transfer_stock", title: (s) => `Transfer ${s}`, action: "Transfer stock", example: "Move 10 steel bolts from the Main Store to the Second Store", critical: ["quantity", "fromWarehouseId", "toWarehouseId"] },
  adjust: { description: "Correct a stock count (typed confirmation).", op: "approve", permission: PERMISSIONS.INVENTORY_STOCK_ADJUST, tool: "inventory_adjust_stock", title: (s) => `Adjust ${s}`, action: "Adjust stock count", example: "The Main Store counted 3 fewer steel bolts than expected, cycle count", critical: ["delta", "warehouseId"] },
};

function stockFieldList(kind: StockKind, c: { value: string; label: string }[]): AiFormField[] {
  const wh = (name: string, label: string, value: string) => field({ name, label, kind: "select", required: true, options: c, value });
  if (kind === "receive") return [wh("warehouseId", "Warehouse", c[0]?.value ?? ""), qty, reason(false)];
  if (kind === "issue") return [wh("warehouseId", "Warehouse", c[0]?.value ?? ""), qty, reason(true)];
  if (kind === "transfer") return [wh("fromWarehouseId", "From", c[0]?.value ?? ""), wh("toWarehouseId", "To", c[Math.min(1, c.length - 1)]?.value ?? ""), qty, reason(false)];
  return [wh("warehouseId", "Warehouse", c[0]?.value ?? ""), field({ name: "delta", label: "Change", kind: "text", required: true, placeholder: "-3 or 5", hint: "Use a minus sign to reduce stock" }), reason(true)];
}

function stockCommand(kind: StockKind): CommandDefinition {
  const cfg = STOCK[kind];
  const base = pickProduct({
    name: kind,
    description: cfg.description,
    example: `/${kind} bolt`,
    operation: cfg.op,
    permission: cfg.permission,
    title: `Choose a product: ${kind}`,
    async select(env, args) {
      requireCell(env, "view");
      const productId = need(args, "productId");
      const p = await getProduct(env.ctx, productId);
      if (!p.isStorable) throw new AppError("VALIDATION_ERROR", `${p.sku} is not a stocked product.`);
      const choices = await warehouseChoices(env, productId);
      if (choices.length === 0) throw new AppError("VALIDATION_ERROR", "Create an active warehouse first with /newwarehouse.");
      return { parts: [form({ title: cfg.title(p.sku), description: p.name, command: kind, context: { productId }, submitLabel: "Review", fields: stockFieldList(kind, choices) })] };
    },
  });
  base.submit = (env, args, values) => proposeTool(env, cfg.tool, { ...nonEmpty(values), productId: need(args, "productId") });
  return withAssist(base, {
    kind: "edit",
    noun: "product",
    action: cfg.action,
    examples: [cfg.example],
    tool: cfg.tool,
    criticalFields: cfg.critical,
    target: {
      ...productTarget,
      async load(env, id) {
        const p = await getProduct(env.ctx, id);
        if (!p.isStorable) throw new AppError("VALIDATION_ERROR", `${p.sku} is not a stocked product.`);
        return { id: p.id, label: p.sku, values: {} };
      },
    },
    fields: async (env, cur) => {
      const choices = await warehouseChoices(env, cur?.id ?? null);
      if (choices.length === 0) throw new AppError("VALIDATION_ERROR", "Create an active warehouse first with /newwarehouse.");
      return stockFieldList(kind, choices);
    },
    context: (cur) => ({ productId: cur.id }),
  });
}

const receive = stockCommand("receive");
const issue = stockCommand("issue");
const transfer = stockCommand("transfer");
const adjust = stockCommand("adjust");

export const INVENTORY_COMMANDS: CommandDefinition[] = [
  products,
  product,
  categories,
  warehouses,
  stock,
  movements,
  newproduct,
  newcategory,
  newwarehouse,
  editproduct,
  editcategory,
  editwarehouse,
  archiveproduct,
  restoreproduct,
  deleteproduct,
  receive,
  issue,
  transfer,
  adjust,
];

export type { CommandResult };
