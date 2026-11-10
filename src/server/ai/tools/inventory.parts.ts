import "server-only";
import type { AiAccess } from "@/server/ai/access/access.service";
import type { AiAction, AiBadge, AiRecordCardPart, AiRecordTablePart } from "@/server/db/documents";
import { MOVEMENT_LABELS, STOCK_STATUS_LABELS, STOCK_STATUS_TONES } from "@/features/inventory/labels";
import type {
  CategoryDto,
  Paged,
  ProductDto,
  StockBalanceDto,
  StockMovementDto,
  WarehouseDto,
} from "@/features/inventory/types";
import type { AiOperation } from "@/shared/domain/ai";

/**
 * Turns the Inventory DTOs into the structured parts the AI workspace renders. Actions on a row or
 * card are offered only when the member's live access allows them, but that is a convenience: every
 * action is sent back to the server, which validates and authorises it again.
 */
const can = (access: AiAccess, op: AiOperation) => access.can("inventory", op);

export function stockBadge(status: string): AiBadge {
  return { label: STOCK_STATUS_LABELS[status] ?? status, tone: STOCK_STATUS_TONES[status] ?? "neutral" };
}

export function productActions(access: AiAccess, productId: string, include: "row" | "card"): AiAction[] {
  const args = { productId };
  const actions: AiAction[] = [];
  if (include === "row") actions.push({ label: "Open", command: "product", args });
  if (can(access, "edit")) {
    actions.push({ label: "Edit", command: "editproduct", args, step: "select" });
    if (include === "card") {
      actions.push({ label: "Receive", command: "receive", args, step: "select" });
      actions.push({ label: "Issue", command: "issue", args, step: "select" });
      actions.push({ label: "Transfer", command: "transfer", args, step: "select" });
    }
  }
  if (include === "card") {
    if (can(access, "approve")) actions.push({ label: "Adjust stock", command: "adjust", args, step: "select" });
    if (can(access, "view")) actions.push({ label: "Movements", command: "movements", args });
    if (can(access, "delete")) actions.push({ label: "Delete", command: "deleteproduct", args, step: "select" });
  }
  return actions;
}

export function productsTable(
  page: Paged<ProductDto>,
  currency: string,
  access: AiAccess,
  opts: { title?: string; command: string; args: Record<string, string | number | boolean>; rowActions?: "open" | "select" }
): AiRecordTablePart {
  const select = opts.rowActions === "select";
  return {
    type: "record_table",
    title: opts.title ?? "Products",
    columns: [
      { key: "sku", label: "SKU" },
      { key: "name", label: "Product" },
      { key: "category", label: "Category" },
      { key: "onHand", label: "On hand", align: "right" },
      { key: "price", label: "Price", align: "right" },
    ],
    rows: page.items.map((p) => ({
      id: p.id,
      cells: {
        sku: p.sku,
        name: p.name,
        category: p.categoryName ?? "None",
        onHand: p.isStorable ? `${p.onHand} ${p.unitOfMeasure}` : "Not stored",
        price: `${p.salePrice} ${currency}`,
      },
      badge: p.isActive ? stockBadge(p.stockStatus) : { label: "Archived", tone: "neutral" },
      actions: select ? [{ label: "Select", command: opts.command, args: { productId: p.id }, step: "select" }] : productActions(access, p.id, "row"),
    })),
    total: page.total,
    emptyMessage: "No products match. Try a different search, or create one with /newproduct.",
    paging: { page: page.page, totalPages: page.totalPages, command: opts.command, args: opts.args },
  };
}

export function productCard(product: ProductDto, balances: StockBalanceDto[], currency: string, access: AiAccess): AiRecordCardPart {
  return {
    type: "record_card",
    title: product.name,
    subtitle: product.sku,
    badges: [product.isActive ? stockBadge(product.stockStatus) : { label: "Archived", tone: "neutral" }],
    fields: [
      { label: "Category", value: product.categoryName ?? "None" },
      { label: "Unit", value: product.unitOfMeasure },
      { label: "Stocked", value: product.isStorable ? "Yes" : "No" },
      { label: "Cost", value: `${product.cost} ${currency}` },
      { label: "Sale price", value: `${product.salePrice} ${currency}` },
      { label: "Reorder point", value: product.reorderPoint },
      { label: "On hand (total)", value: product.isStorable ? product.onHand : "Not stored" },
    ],
    sections:
      balances.length > 0
        ? [{ title: "Stock by warehouse", rows: balances.map((b) => ({ label: `${b.warehouseName} (${b.warehouseCode})`, value: b.onHand })) }]
        : undefined,
    actions: productActions(access, product.id, "card"),
  };
}

export function categoriesTable(items: CategoryDto[], access: AiAccess, select = false): AiRecordTablePart {
  return {
    type: "record_table",
    title: "Categories",
    columns: [
      { key: "name", label: "Category" },
      { key: "description", label: "Description" },
      { key: "products", label: "Active products", align: "right" },
    ],
    rows: items.map((c) => ({
      id: c.id,
      cells: { name: c.name, description: c.description || "None", products: String(c.productCount) },
      badge: c.isActive ? { label: "Active", tone: "success" } : { label: "Archived", tone: "neutral" },
      actions: select ? [{ label: "Select", command: "editcategory", args: { categoryId: c.id }, step: "select" }] : can(access, "edit") ? [{ label: "Edit", command: "editcategory", args: { categoryId: c.id }, step: "select" }] : [],
    })),
    total: items.length,
    emptyMessage: "There are no categories yet. Create one with /newcategory.",
  };
}

export function warehousesTable(items: WarehouseDto[], access: AiAccess, select = false): AiRecordTablePart {
  return {
    type: "record_table",
    title: "Warehouses",
    columns: [
      { key: "code", label: "Code" },
      { key: "name", label: "Warehouse" },
      { key: "address", label: "Address" },
      { key: "onHand", label: "Units on hand", align: "right" },
    ],
    rows: items.map((w) => ({
      id: w.id,
      cells: { code: w.code, name: w.name, address: w.address || "None", onHand: w.onHand },
      badge: w.isActive ? { label: "Active", tone: "success" } : { label: "Inactive", tone: "neutral" },
      actions: select ? [{ label: "Select", command: "editwarehouse", args: { warehouseId: w.id }, step: "select" }] : can(access, "edit") ? [{ label: "Edit", command: "editwarehouse", args: { warehouseId: w.id }, step: "select" }] : [],
    })),
    total: items.length,
    emptyMessage: "There are no warehouses yet. Create one with /newwarehouse.",
  };
}

export function balancesTable(page: Paged<StockBalanceDto>, args: Record<string, string | number | boolean>): AiRecordTablePart {
  return {
    type: "record_table",
    title: "Stock on hand",
    columns: [
      { key: "sku", label: "SKU" },
      { key: "name", label: "Product" },
      { key: "warehouse", label: "Warehouse" },
      { key: "onHand", label: "On hand", align: "right" },
      { key: "reorder", label: "Reorder at", align: "right" },
    ],
    rows: page.items.map((b) => ({
      id: `${b.productId}:${b.warehouseId}`,
      cells: {
        sku: b.productSku,
        name: b.productName,
        warehouse: `${b.warehouseName} (${b.warehouseCode})`,
        onHand: `${b.onHand} ${b.unitOfMeasure}`,
        reorder: b.reorderPoint,
      },
      badge: stockBadge(b.stockStatus),
    })),
    total: page.total,
    emptyMessage: "No stock balances match.",
    paging: { page: page.page, totalPages: page.totalPages, command: "stock", args },
  };
}

export function movementsTable(page: Paged<StockMovementDto>, args: Record<string, string | number | boolean>): AiRecordTablePart {
  return {
    type: "record_table",
    title: "Stock movements",
    columns: [
      { key: "when", label: "When" },
      { key: "sku", label: "SKU" },
      { key: "warehouse", label: "Warehouse" },
      { key: "type", label: "Type" },
      { key: "qty", label: "Change", align: "right" },
      { key: "reason", label: "Reason" },
    ],
    rows: page.items.map((m) => ({
      id: m.id,
      cells: {
        when: new Date(m.createdAt).toISOString().slice(0, 16).replace("T", " "),
        sku: m.productSku,
        warehouse: m.warehouseCode,
        type: MOVEMENT_LABELS[m.movementType] ?? m.movementType,
        qty: m.deltaMicro > 0 ? `+${m.quantity}` : m.quantity,
        reason: m.reason || "None",
      },
    })),
    total: page.total,
    emptyMessage: "No stock movements match.",
    paging: { page: page.page, totalPages: page.totalPages, command: "movements", args },
  };
}

/** Compact, id-bearing rows given to the model so it can refer to records in a follow-up call. */
export function modelRows<T>(items: T[], pick: (item: T) => Record<string, unknown>, limit = 25): Record<string, unknown>[] {
  return items.slice(0, limit).map(pick);
}
