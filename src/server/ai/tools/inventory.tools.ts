import "server-only";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { defineTool } from "@/server/ai/tools/define-tool";
import {
  balancesTable,
  categoriesTable,
  modelRows,
  movementsTable,
  productCard,
  productsTable,
  warehousesTable,
} from "@/server/ai/tools/inventory.parts";
import {
  createCategory,
  createProduct,
  createWarehouse,
  deleteProduct,
  getProduct,
  getWarehouse,
  listCategories,
  listProducts,
  listWarehouses,
  productReferenceCount,
  setCategoryActive,
  setProductActive,
  updateCategory,
  updateProduct,
  updateWarehouse,
} from "@/server/inventory/catalog.service";
import { adjustStock, issueStock, listBalancesForProduct, listStockBalances, listStockMovements, parseSignedQuantity, receiveStock, transferStock } from "@/server/inventory/stock.service";
import {
  categoryInputSchema,
  movementListQuerySchema,
  productInputSchema,
  productListQuerySchema,
  productUpdateSchema,
  stockAdjustmentInputSchema,
  stockMoveInputSchema,
  stockTransferInputSchema,
  warehouseInputSchema,
} from "@/features/inventory/schemas/inventory.schema";
import type { ProductDto, StockBalanceDto } from "@/features/inventory/types";
import { PERMISSIONS } from "@/server/security/permissions";
import type { WorkspaceContext } from "@/server/tenancy/workspace";
import { UNITS_OF_MEASURE } from "@/shared/domain/units";
import { formatQuantity, parseQuantity } from "@/shared/lib/fixed-point";
import { AppError } from "@/shared/lib/errors";
import { objectIdSchema } from "@/shared/lib/schema-primitives";
import { toFieldErrors } from "@/shared/lib/validation";

/**
 * Inventory tools. Each one is a thin wrapper over the existing Inventory services and schemas:
 * the same validation, the same permission assertion, the same company scope as the module's own
 * pages. Reads return structured parts. Writes only PROPOSE: prepare() reads the current record
 * through the same services and builds the diff, and the change runs after the person confirms.
 *
 * Grant cells: view = reads; create = new records; edit = changes and stock moves; delete = product
 * deletion; approve = manual stock adjustment (the role ceiling there is inventory.stock.adjust).
 */

const R = PERMISSIONS.INVENTORY_READ;
const MANAGE = PERMISSIONS.INVENTORY_PRODUCT_MANAGE;
const WAREHOUSE = PERMISSIONS.INVENTORY_WAREHOUSE_MANAGE;
const MOVE = PERMISSIONS.INVENTORY_STOCK_MOVE;
const ADJUST = PERMISSIONS.INVENTORY_STOCK_ADJUST;

/** Models often send 12.5 as a number. Accept both and hand the existing schemas a string. */
const decimal = z.union([z.string(), z.number()]).transform((v) => String(v));
const optText = (max: number) => z.string().max(max).optional();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new AppError("VALIDATION_ERROR", result.error.issues[0]?.message ?? "The request is invalid.", toFieldErrors(result.error));
}

const sameDecimal = (a: string, b: string) => Number(a) === Number(b);

type Row = { label: string; before?: string; after: string };
function diff(rows: { label: string; before: string; after: string }[]): Row[] {
  return rows.filter((r) => r.before !== r.after);
}

// ─── Reads ────────────────────────────────────────────────────────────────────

export const listProductsTool = defineTool({
  name: "inventory_list_products",
  module: "inventory",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "Search or list products. q matches the start of a name or SKU. Returns ids to use in later calls.",
  input: z
    .object({
      q: optText(80),
      status: z.enum(["active", "archived", "all"]).optional(),
      categoryId: objectIdSchema.optional(),
      page: z.number().int().min(1).max(1000).optional(),
    })
    .strict(),
  async run(ctx, args, { access }) {
    const query = parse(productListQuerySchema, { q: args.q ?? "", status: args.status, categoryId: args.categoryId, page: args.page });
    const page = await listProducts(ctx, query);
    const pagingArgs: Record<string, string | number | boolean> = { q: query.q, status: query.status, ...(query.categoryId ? { categoryId: query.categoryId } : {}) };
    return {
      summary: `${page.total} product${page.total === 1 ? "" : "s"}`,
      parts: [productsTable(page, ctx.currencyCode, access, { command: "products", args: pagingArgs })],
      data: {
        total: page.total,
        page: page.page,
        totalPages: page.totalPages,
        products: modelRows(page.items, (p) => ({ id: p.id, sku: p.sku, name: p.name, category: p.categoryName, unit: p.unitOfMeasure, onHand: p.onHand, status: p.stockStatus, price: p.salePrice, active: p.isActive })),
      },
    };
  },
});

export const getProductTool = defineTool({
  name: "inventory_get_product",
  module: "inventory",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "Show one product with its stock in every warehouse.",
  input: z.object({ productId: objectIdSchema }).strict(),
  async run(ctx, args, { access }) {
    const [product, balances] = await Promise.all([getProduct(ctx, args.productId), listBalancesForProduct(ctx, args.productId)]);
    return {
      summary: `${product.sku}: ${product.name}`,
      parts: [productCard(product, balances, ctx.currencyCode, access)],
      data: { product: { id: product.id, sku: product.sku, name: product.name, unit: product.unitOfMeasure, onHand: product.onHand, cost: product.cost, price: product.salePrice, reorderPoint: product.reorderPoint, status: product.stockStatus, version: product.version }, balances: balances.map((b) => ({ warehouseId: b.warehouseId, warehouse: b.warehouseCode, onHand: b.onHand })) },
    };
  },
});

export const listCategoriesTool = defineTool({
  name: "inventory_list_categories",
  module: "inventory",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "List product categories with their ids and product counts.",
  input: z.object({}).strict(),
  async run(ctx, _args, { access }) {
    const items = await listCategories(ctx);
    return {
      summary: `${items.length} categor${items.length === 1 ? "y" : "ies"}`,
      parts: [categoriesTable(items, access)],
      data: { categories: modelRows(items, (c) => ({ id: c.id, name: c.name, active: c.isActive, products: c.productCount }), 100) },
    };
  },
});

export const listWarehousesTool = defineTool({
  name: "inventory_list_warehouses",
  module: "inventory",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "List warehouses with their ids, codes and stock totals.",
  input: z.object({}).strict(),
  async run(ctx, _args, { access }) {
    const items = await listWarehouses(ctx);
    return {
      summary: `${items.length} warehouse${items.length === 1 ? "" : "s"}`,
      parts: [warehousesTable(items, access)],
      data: { warehouses: modelRows(items, (w) => ({ id: w.id, code: w.code, name: w.name, active: w.isActive, onHand: w.onHand }), 100) },
    };
  },
});

export const stockBalancesTool = defineTool({
  name: "inventory_stock_balances",
  module: "inventory",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "Stock on hand per product and warehouse, optionally for one product or one warehouse.",
  input: z.object({ productId: objectIdSchema.optional(), warehouseId: objectIdSchema.optional(), page: z.number().int().min(1).max(1000).optional() }).strict(),
  async run(ctx, args) {
    const query = parse(movementListQuerySchema, args);
    const page = await listStockBalances(ctx, { productId: query.productId, warehouseId: query.warehouseId, page: query.page });
    const paging: Record<string, string | number | boolean> = { ...(query.productId ? { productId: query.productId } : {}), ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}) };
    return {
      summary: `${page.total} balance${page.total === 1 ? "" : "s"}`,
      parts: [balancesTable(page, paging)],
      data: { total: page.total, page: page.page, balances: modelRows(page.items, (b: StockBalanceDto) => ({ productId: b.productId, sku: b.productSku, warehouseId: b.warehouseId, warehouse: b.warehouseCode, onHand: b.onHand, status: b.stockStatus })) },
    };
  },
});

export const stockMovementsTool = defineTool({
  name: "inventory_stock_movements",
  module: "inventory",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "Recent stock movements (newest first), optionally for one product or one warehouse.",
  input: z.object({ productId: objectIdSchema.optional(), warehouseId: objectIdSchema.optional(), page: z.number().int().min(1).max(1000).optional() }).strict(),
  async run(ctx, args) {
    const query = parse(movementListQuerySchema, args);
    const page = await listStockMovements(ctx, { productId: query.productId, warehouseId: query.warehouseId, page: query.page });
    const paging: Record<string, string | number | boolean> = { ...(query.productId ? { productId: query.productId } : {}), ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}) };
    return {
      summary: `${page.total} movement${page.total === 1 ? "" : "s"}`,
      parts: [movementsTable(page, paging)],
      data: { total: page.total, page: page.page, movements: modelRows(page.items, (m) => ({ when: m.createdAt, sku: m.productSku, warehouse: m.warehouseCode, type: m.movementType, change: m.quantity, reason: m.reason })) },
    };
  },
});

// ─── Writes: categories ───────────────────────────────────────────────────────

const categoryFields = { name: z.string().max(80), description: z.string().max(300).default("") };

async function findCategory(ctx: WorkspaceContext, categoryId: string) {
  const category = (await listCategories(ctx)).find((c) => c.id === categoryId);
  if (!category) throw new AppError("NOT_FOUND", "Category not found");
  return category;
}

export const createCategoryTool = defineTool({
  name: "inventory_create_category",
  module: "inventory",
  operation: "create",
  kind: "write",
  risk: "low",
  permission: MANAGE,
  description: "Propose a new product category.",
  input: z.object(categoryFields).strict().pipe(categoryInputSchema),
  async prepare(ctx, args) {
    const existing = (await listCategories(ctx)).find((c) => c.name.toLowerCase() === args.name.toLowerCase());
    if (existing) throw new AppError("CONFLICT", `A category named "${existing.name}" already exists.`);
    return { context: {}, summary: `Create category "${args.name}".`, details: [{ label: "Name", after: args.name }, ...(args.description ? [{ label: "Description", after: args.description }] : [])] };
  },
  async run(ctx, args) {
    const created = await createCategory(ctx, args);
    return { summary: `Created category "${created.name}".` };
  },
});

export const updateCategoryTool = defineTool({
  name: "inventory_update_category",
  module: "inventory",
  operation: "edit",
  kind: "write",
  risk: "low",
  permission: MANAGE,
  description: "Propose renaming a category or changing its description. Send only what changes.",
  input: z.object({ categoryId: objectIdSchema, name: optText(80), description: optText(300) }).strict(),
  async prepare(ctx, args) {
    const current = await findCategory(ctx, args.categoryId);
    const next = parse(categoryInputSchema, { name: args.name ?? current.name, description: args.description ?? current.description });
    const details = diff([
      { label: "Name", before: current.name, after: next.name },
      { label: "Description", before: current.description, after: next.description },
    ]);
    if (details.length === 0) throw new AppError("VALIDATION_ERROR", "That would not change anything.");
    return { context: { input: next }, summary: `Update category "${current.name}".`, details };
  },
  async run(ctx, args, _env, context) {
    const updated = await updateCategory(ctx, args.categoryId, context.input as { name: string; description: string });
    return { summary: `Updated category "${updated.name}".` };
  },
});

export const setCategoryActiveTool = defineTool({
  name: "inventory_set_category_active",
  module: "inventory",
  operation: "edit",
  kind: "write",
  risk: "low",
  permission: MANAGE,
  description: "Propose archiving (isActive false) or restoring (true) a category.",
  input: z.object({ categoryId: objectIdSchema, isActive: z.boolean() }).strict(),
  async prepare(ctx, args) {
    const current = await findCategory(ctx, args.categoryId);
    if (current.isActive === args.isActive) throw new AppError("VALIDATION_ERROR", `"${current.name}" is already ${args.isActive ? "active" : "archived"}.`);
    return { context: { name: current.name }, summary: `${args.isActive ? "Restore" : "Archive"} category "${current.name}".` };
  },
  async run(ctx, args, _env, context) {
    await setCategoryActive(ctx, args.categoryId, args.isActive);
    return { summary: `${args.isActive ? "Restored" : "Archived"} category "${String(context.name)}".` };
  },
});

// ─── Writes: products ─────────────────────────────────────────────────────────

const productFields = {
  sku: z.string().max(64),
  name: z.string().max(120),
  description: z.string().max(2000).default(""),
  categoryId: z.string().default(""),
  unitOfMeasure: z.enum(UNITS_OF_MEASURE),
  isStorable: z.boolean().default(true),
  isActive: z.boolean().default(true),
  cost: decimal.default("0"),
  salePrice: decimal.default("0"),
  reorderPoint: decimal.default("0"),
};

export const createProductTool = defineTool({
  name: "inventory_create_product",
  module: "inventory",
  operation: "create",
  kind: "write",
  risk: "low",
  permission: MANAGE,
  description:
    "Propose a new product. sku, name and unitOfMeasure are required. Money (cost, salePrice) has up to 3 decimals. Countable units (unit, box) need a whole-number reorderPoint. categoryId is optional (use inventory_list_categories).",
  input: z.object(productFields).strict().pipe(productInputSchema),
  async prepare(ctx, args) {
    const duplicate = (await listProducts(ctx, { q: args.sku, status: "all", page: 1 })).items.find((p) => p.sku === args.sku);
    if (duplicate) throw new AppError("CONFLICT", `The SKU ${args.sku} is already used by "${duplicate.name}".`);
    let categoryName = "None";
    if (args.categoryId) {
      const category = (await listCategories(ctx)).find((c) => c.id === args.categoryId && c.isActive);
      if (!category) throw new AppError("VALIDATION_ERROR", "Choose an active category.");
      categoryName = category.name;
    }
    const c = ctx.currencyCode;
    return {
      context: {},
      summary: `Create product "${args.name}" (${args.sku}).`,
      details: [
        { label: "SKU", after: args.sku },
        { label: "Name", after: args.name },
        { label: "Category", after: categoryName },
        { label: "Unit", after: args.unitOfMeasure },
        { label: "Stocked", after: args.isStorable ? "Yes" : "No" },
        { label: "Cost", after: `${args.cost} ${c}` },
        { label: "Sale price", after: `${args.salePrice} ${c}` },
        { label: "Reorder point", after: args.reorderPoint },
      ],
    };
  },
  async run(ctx, args) {
    const created = await createProduct(ctx, args);
    return { summary: `Created product ${created.sku}.` };
  },
});

export const updateProductTool = defineTool({
  name: "inventory_update_product",
  module: "inventory",
  operation: "edit",
  kind: "write",
  risk: "low",
  permission: MANAGE,
  description:
    "Propose changes to a product. Send productId and ONLY the fields that change (name, sku, description, categoryId (empty string clears it), unitOfMeasure, isStorable, cost, salePrice, reorderPoint).",
  input: z
    .object({
      productId: objectIdSchema,
      sku: optText(64),
      name: optText(120),
      description: optText(2000),
      categoryId: z.string().optional(),
      unitOfMeasure: z.enum(UNITS_OF_MEASURE).optional(),
      isStorable: z.boolean().optional(),
      cost: decimal.optional(),
      salePrice: decimal.optional(),
      reorderPoint: decimal.optional(),
      /** Sent by the guided edit form: the version the person was looking at. */
      expectedVersion: z.number().int().min(1).optional(),
    })
    .strict(),
  async prepare(ctx, args) {
    const current = await getProduct(ctx, args.productId);
    if (args.expectedVersion !== undefined && args.expectedVersion !== current.version) {
      throw new AppError("CONFLICT", `${current.sku} changed since you opened it. Open it again to see the latest.`);
    }
    const next = parse(productUpdateSchema, {
      sku: args.sku ?? current.sku,
      name: args.name ?? current.name,
      description: args.description ?? current.description,
      categoryId: args.categoryId ?? current.categoryId ?? "",
      unitOfMeasure: args.unitOfMeasure ?? current.unitOfMeasure,
      isStorable: args.isStorable ?? current.isStorable,
      isActive: current.isActive,
      cost: args.cost ?? current.cost,
      salePrice: args.salePrice ?? current.salePrice,
      reorderPoint: args.reorderPoint ?? current.reorderPoint,
      expectedVersion: current.version,
    });
    let categoryName = "None";
    if (next.categoryId) {
      const category = (await listCategories(ctx)).find((c) => c.id === next.categoryId && c.isActive);
      if (!category) throw new AppError("VALIDATION_ERROR", "Choose an active category.");
      categoryName = category.name;
    }
    const c = ctx.currencyCode;
    const rows: Row[] = [];
    const add = (label: string, before: string, after: string, same = before === after) => {
      if (!same) rows.push({ label, before, after });
    };
    add("SKU", current.sku, next.sku);
    add("Name", current.name, next.name);
    add("Description", current.description, next.description);
    add("Category", current.categoryName ?? "None", categoryName, (current.categoryId ?? null) === (next.categoryId ?? null));
    add("Unit", current.unitOfMeasure, next.unitOfMeasure);
    add("Stocked", current.isStorable ? "Yes" : "No", next.isStorable ? "Yes" : "No");
    add("Cost", `${current.cost} ${c}`, `${next.cost} ${c}`, sameDecimal(current.cost, next.cost));
    add("Sale price", `${current.salePrice} ${c}`, `${next.salePrice} ${c}`, sameDecimal(current.salePrice, next.salePrice));
    add("Reorder point", current.reorderPoint, next.reorderPoint, sameDecimal(current.reorderPoint, next.reorderPoint));
    if (rows.length === 0) throw new AppError("VALIDATION_ERROR", "That would not change anything.");
    return {
      context: { input: next, sku: current.sku, name: current.name },
      summary: `Update ${current.sku} "${current.name}": ${rows.map((r) => r.label.toLowerCase()).join(", ")}.`,
      details: rows,
    };
  },
  async run(ctx, args, _env, context) {
    const updated = await updateProduct(ctx, args.productId, context.input as Parameters<typeof updateProduct>[2]);
    return { summary: `Updated ${updated.sku}.` };
  },
});

export const setProductActiveTool = defineTool({
  name: "inventory_set_product_active",
  module: "inventory",
  operation: "edit",
  kind: "write",
  risk: "low",
  permission: MANAGE,
  description: "Propose archiving (isActive false) or restoring (true) a product. Prefer this over deleting.",
  input: z.object({ productId: objectIdSchema, isActive: z.boolean() }).strict(),
  async prepare(ctx, args) {
    const current = await getProduct(ctx, args.productId);
    if (current.isActive === args.isActive) throw new AppError("VALIDATION_ERROR", `${current.sku} is already ${args.isActive ? "active" : "archived"}.`);
    return { context: { sku: current.sku, name: current.name }, summary: `${args.isActive ? "Restore" : "Archive"} ${current.sku} "${current.name}".` };
  },
  async run(ctx, args, _env, context) {
    await setProductActive(ctx, args.productId, args.isActive);
    return { summary: `${args.isActive ? "Restored" : "Archived"} ${String(context.sku)}.` };
  },
});

export const deleteProductTool = defineTool({
  name: "inventory_delete_product",
  module: "inventory",
  operation: "delete",
  kind: "write",
  risk: "destructive",
  permission: MANAGE,
  description: "Propose permanently deleting a product. Only works when nothing references it; otherwise archive it instead.",
  input: z.object({ productId: objectIdSchema }).strict(),
  async prepare(ctx, args) {
    const current = await getProduct(ctx, args.productId);
    if ((await productReferenceCount(ctx, new ObjectId(args.productId))) > 0) {
      throw new AppError("CONFLICT", `${current.sku} is used by stock, orders or production, so it cannot be deleted. Archive it instead.`);
    }
    return {
      context: { sku: current.sku, name: current.name },
      summary: `Permanently delete ${current.sku} "${current.name}". This cannot be undone.`,
      details: [{ label: "Product", after: `${current.sku} ${current.name}` }],
      typedPhrase: current.sku,
    };
  },
  async run(ctx, args, _env, context) {
    await deleteProduct(ctx, args.productId);
    return { summary: `Deleted ${String(context.sku)}.` };
  },
});

// ─── Writes: warehouses ───────────────────────────────────────────────────────

const warehouseFields = { name: z.string().max(120), code: z.string().max(12), address: z.string().max(300).default(""), isActive: z.boolean().default(true) };

export const createWarehouseTool = defineTool({
  name: "inventory_create_warehouse",
  module: "inventory",
  operation: "create",
  kind: "write",
  risk: "low",
  permission: WAREHOUSE,
  description: "Propose a new warehouse. code is 2 to 12 letters, digits or dashes and must be unique.",
  input: z.object(warehouseFields).strict().pipe(warehouseInputSchema),
  async prepare(ctx, args) {
    const duplicate = (await listWarehouses(ctx)).find((w) => w.code === args.code);
    if (duplicate) throw new AppError("CONFLICT", `The code ${args.code} is already used by "${duplicate.name}".`);
    return { context: {}, summary: `Create warehouse "${args.name}" (${args.code}).`, details: [{ label: "Name", after: args.name }, { label: "Code", after: args.code }, ...(args.address ? [{ label: "Address", after: args.address }] : [])] };
  },
  async run(ctx, args) {
    const created = await createWarehouse(ctx, args);
    return { summary: `Created warehouse ${created.code}.` };
  },
});

export const updateWarehouseTool = defineTool({
  name: "inventory_update_warehouse",
  module: "inventory",
  operation: "edit",
  kind: "write",
  risk: "low",
  permission: WAREHOUSE,
  description: "Propose changes to a warehouse (name, code, address, isActive). Send only what changes. A warehouse that holds stock cannot be deactivated.",
  input: z.object({ warehouseId: objectIdSchema, name: optText(120), code: optText(12), address: optText(300), isActive: z.boolean().optional() }).strict(),
  async prepare(ctx, args) {
    const current = await getWarehouse(ctx, args.warehouseId);
    const next = parse(warehouseInputSchema, {
      name: args.name ?? current.name,
      code: args.code ?? current.code,
      address: args.address ?? current.address,
      isActive: args.isActive ?? current.isActive,
    });
    const details = diff([
      { label: "Name", before: current.name, after: next.name },
      { label: "Code", before: current.code, after: next.code },
      { label: "Address", before: current.address, after: next.address },
      { label: "Active", before: current.isActive ? "Yes" : "No", after: next.isActive ? "Yes" : "No" },
    ]);
    if (details.length === 0) throw new AppError("VALIDATION_ERROR", "That would not change anything.");
    return { context: { input: next, code: current.code }, summary: `Update warehouse ${current.code} "${current.name}".`, details };
  },
  async run(ctx, args, _env, context) {
    const updated = await updateWarehouse(ctx, args.warehouseId, context.input as Parameters<typeof updateWarehouse>[2]);
    return { summary: `Updated warehouse ${updated.code}.` };
  },
});

// ─── Writes: stock ────────────────────────────────────────────────────────────

type StockContext = { product: ProductDto; warehouse: { id: string; code: string; name: string; isActive: boolean }; onHandMicro: number; unit: string };

async function stockContext(ctx: WorkspaceContext, productId: string, warehouseId: string): Promise<StockContext> {
  const [product, warehouses, balances] = await Promise.all([getProduct(ctx, productId), listWarehouses(ctx), listBalancesForProduct(ctx, productId)]);
  if (!product.isStorable) throw new AppError("VALIDATION_ERROR", `${product.sku} is not a stocked product.`);
  const warehouse = warehouses.find((w) => w.id === warehouseId);
  if (!warehouse) throw new AppError("NOT_FOUND", "Warehouse not found");
  if (!warehouse.isActive) throw new AppError("VALIDATION_ERROR", `${warehouse.code} is inactive.`);
  const balance = balances.find((b) => b.warehouseId === warehouseId);
  return { product, warehouse, onHandMicro: balance?.onHandMicro ?? 0, unit: product.unitOfMeasure };
}

const stockRows = (s: StockContext, label: string, afterMicro: number): Row[] => [
  { label: `${label} (${s.warehouse.code})`, before: formatQuantity(s.onHandMicro), after: formatQuantity(afterMicro) },
];

export const receiveStockTool = defineTool({
  name: "inventory_receive_stock",
  module: "inventory",
  operation: "edit",
  kind: "write",
  risk: "sensitive",
  permission: MOVE,
  description: "Propose receiving stock into a warehouse without a purchase order. Quantity is positive.",
  input: z.object({ productId: objectIdSchema, warehouseId: objectIdSchema, quantity: decimal, reason: z.string().max(200).default("") }).strict().pipe(stockMoveInputSchema),
  async prepare(ctx, args) {
    const s = await stockContext(ctx, args.productId, args.warehouseId);
    const after = s.onHandMicro + parseQuantity(args.quantity);
    return {
      context: { sku: s.product.sku, warehouse: s.warehouse.code },
      summary: `Receive ${args.quantity} ${s.unit} of ${s.product.sku} "${s.product.name}" into ${s.warehouse.name} (${s.warehouse.code}).`,
      details: [...stockRows(s, "On hand", after), ...(args.reason ? [{ label: "Reason", after: args.reason }] : [])],
    };
  },
  async run(ctx, args, _env, context) {
    await receiveStock(ctx, args);
    return { summary: `Received ${args.quantity} of ${String(context.sku)} into ${String(context.warehouse)}.` };
  },
});

export const issueStockTool = defineTool({
  name: "inventory_issue_stock",
  module: "inventory",
  operation: "edit",
  kind: "write",
  risk: "sensitive",
  permission: MOVE,
  description: "Propose issuing stock out of a warehouse. A reason is required. Fails rather than going negative.",
  input: z.object({ productId: objectIdSchema, warehouseId: objectIdSchema, quantity: decimal, reason: z.string().min(1).max(200) }).strict().pipe(stockMoveInputSchema),
  async prepare(ctx, args) {
    const s = await stockContext(ctx, args.productId, args.warehouseId);
    const after = s.onHandMicro - parseQuantity(args.quantity);
    if (after < 0) throw new AppError("INSUFFICIENT_STOCK", `Only ${formatQuantity(s.onHandMicro)} ${s.unit} of ${s.product.sku} is in ${s.warehouse.code}.`);
    return {
      context: { sku: s.product.sku, warehouse: s.warehouse.code },
      summary: `Issue ${args.quantity} ${s.unit} of ${s.product.sku} "${s.product.name}" from ${s.warehouse.name} (${s.warehouse.code}).`,
      details: [...stockRows(s, "On hand", after), { label: "Reason", after: args.reason }],
    };
  },
  async run(ctx, args, _env, context) {
    await issueStock(ctx, args);
    return { summary: `Issued ${args.quantity} of ${String(context.sku)} from ${String(context.warehouse)}.` };
  },
});

export const transferStockTool = defineTool({
  name: "inventory_transfer_stock",
  module: "inventory",
  operation: "edit",
  kind: "write",
  risk: "sensitive",
  permission: MOVE,
  description: "Propose moving stock between two warehouses.",
  input: z.object({ productId: objectIdSchema, fromWarehouseId: objectIdSchema, toWarehouseId: objectIdSchema, quantity: decimal, reason: z.string().max(200).default("") }).strict().pipe(stockTransferInputSchema),
  async prepare(ctx, args) {
    const from = await stockContext(ctx, args.productId, args.fromWarehouseId);
    const to = await stockContext(ctx, args.productId, args.toWarehouseId);
    const qty = parseQuantity(args.quantity);
    if (from.onHandMicro - qty < 0) throw new AppError("INSUFFICIENT_STOCK", `Only ${formatQuantity(from.onHandMicro)} ${from.unit} of ${from.product.sku} is in ${from.warehouse.code}.`);
    return {
      context: { sku: from.product.sku, from: from.warehouse.code, to: to.warehouse.code },
      summary: `Transfer ${args.quantity} ${from.unit} of ${from.product.sku} "${from.product.name}" from ${from.warehouse.code} to ${to.warehouse.code}.`,
      details: [...stockRows(from, "Source on hand", from.onHandMicro - qty), ...stockRows(to, "Destination on hand", to.onHandMicro + qty), ...(args.reason ? [{ label: "Reason", after: args.reason }] : [])],
    };
  },
  async run(ctx, args, _env, context) {
    await transferStock(ctx, args);
    return { summary: `Transferred ${args.quantity} of ${String(context.sku)} from ${String(context.from)} to ${String(context.to)}.` };
  },
});

export const adjustStockTool = defineTool({
  name: "inventory_adjust_stock",
  module: "inventory",
  operation: "approve",
  kind: "write",
  risk: "financial",
  permission: ADJUST,
  description:
    "Propose a manual stock count correction. delta is signed (use a minus sign to reduce). A reason is required. Needs the stock-adjust permission, which only owners and administrators have.",
  input: z.object({ productId: objectIdSchema, warehouseId: objectIdSchema, delta: decimal, reason: z.string().min(1).max(200) }).strict().pipe(stockAdjustmentInputSchema),
  async prepare(ctx, args) {
    const s = await stockContext(ctx, args.productId, args.warehouseId);
    const delta = parseSignedQuantity(args.delta);
    const after = s.onHandMicro + delta;
    if (after < 0) throw new AppError("INSUFFICIENT_STOCK", `That would take ${s.product.sku} below zero in ${s.warehouse.code} (currently ${formatQuantity(s.onHandMicro)}).`);
    return {
      context: { sku: s.product.sku, warehouse: s.warehouse.code },
      summary: `Adjust ${s.product.sku} "${s.product.name}" in ${s.warehouse.code} by ${args.delta} ${s.unit}.`,
      details: [...stockRows(s, "On hand", after), { label: "Reason", after: args.reason }],
      typedPhrase: s.product.sku,
    };
  },
  async run(ctx, args, _env, context) {
    await adjustStock(ctx, args);
    return { summary: `Adjusted ${String(context.sku)} in ${String(context.warehouse)} by ${args.delta}.` };
  },
});

export const INVENTORY_TOOLS = [
  listProductsTool,
  getProductTool,
  listCategoriesTool,
  listWarehousesTool,
  stockBalancesTool,
  stockMovementsTool,
  createCategoryTool,
  updateCategoryTool,
  setCategoryActiveTool,
  createProductTool,
  updateProductTool,
  setProductActiveTool,
  deleteProductTool,
  createWarehouseTool,
  updateWarehouseTool,
  receiveStockTool,
  issueStockTool,
  transferStockTool,
  adjustStockTool,
];
