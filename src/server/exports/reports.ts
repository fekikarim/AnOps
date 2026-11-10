import "server-only";
import type { WorkspaceContext } from "@/server/tenancy/workspace";
import { buildWorkbook, exportFileName, type CellValue, type Column, type WorkbookSpec } from "@/server/exports/workbook";
import { listProductsForExport } from "@/server/inventory/catalog.service";
import { listStockBalancesForExport, listStockMovementsForExport } from "@/server/inventory/stock.service";
import { listSuppliersForExport } from "@/server/purchasing/supplier.service";
import { listReceiptsForExport } from "@/server/purchasing/receipt.service";
import { listPurchaseOrdersForExport } from "@/server/purchasing/purchase-order.service";
import {
  movementWindow,
  type GoodsReceiptExportQuery,
  type ProductExportQuery,
  type PurchaseOrderExportQuery,
  type StockMovementExportQuery,
  type StockOnHandExportQuery,
  type SupplierExportQuery,
} from "@/features/exports/schemas/export.schema";
import { MOVEMENT_LABELS, STOCK_STATUS_LABELS } from "@/features/inventory/labels";
import { QTY_SCALE } from "@/shared/lib/fixed-point";

/**
 * The six Excel reports. Each function takes the authenticated workspace (never a client-supplied
 * company), the validated query, and the server clock. Data comes from the same services as the pages,
 * so an export matches the screen it was started from. Row limits are enforced by those services.
 */

export type ExportFile = {
  fileName: string;
  body: Buffer;
  rowCount: number;
};

const RECEIPT_STATUS_LABELS: Record<string, string> = { draft: "Draft", posted: "Posted", cancelled: "Cancelled" };
const PURCHASE_ORDER_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  approved: "Approved",
  partially_received: "Partially received",
  received: "Received",
  cancelled: "Cancelled",
};

/** Converts an authoritative micro-unit integer to the number shown in Excel. */
function fromMicro(micro: number): number {
  return micro / QTY_SCALE;
}

/** Decimal strings produced by the DTO mappers (three places) become numeric cells. */
function decimal(value: string): number {
  return Number(value);
}

function date(iso: string | null): Date | null {
  return iso ? new Date(iso) : null;
}

function yesNo(value: boolean): string {
  return value ? "Yes" : "No";
}

function filterValue(value: string | undefined | null, fallback = "All"): string {
  return value ? value : fallback;
}

/** Builds the workbook spec for one report and returns its bytes with a stable filename. */
async function render(report: string, spec: WorkbookSpec, rowCount: number, generatedAt: Date): Promise<ExportFile> {
  const notes = rowCount === 0 ? [...spec.notes, "No records match the selected filters."] : spec.notes;
  const body = await buildWorkbook({
    ...spec,
    notes,
    summary: [...spec.summary, ["Rows exported", rowCount.toLocaleString("en-US")]],
  });
  return { fileName: exportFileName(report, generatedAt), body, rowCount };
}

// ---------- Products ----------

const PRODUCT_COLUMNS = (currency: string): Column[] => [
  { header: "SKU", width: 14 },
  { header: "Name", width: 32 },
  { header: "Category", width: 20 },
  { header: "Description", width: 40 },
  { header: "Unit of measure", width: 12 },
  { header: "Stored item", width: 10 },
  { header: "Status", width: 11 },
  { header: `Cost (${currency})`, width: 14, format: "money", currency },
  { header: `Sale price (${currency})`, width: 16, format: "money", currency },
  { header: "Reorder point", width: 14, format: "quantity" },
  { header: "On hand", width: 14, format: "quantity" },
  { header: "Stock status", width: 14 },
  { header: "Last updated (UTC)", width: 18, format: "datetime" },
];

export async function exportProducts(ctx: WorkspaceContext, query: ProductExportQuery, now: Date): Promise<ExportFile> {
  const products = await listProductsForExport(ctx, query);
  const rows: CellValue[][] = products.map((p) => [
    p.sku,
    p.name,
    p.categoryName,
    p.description,
    p.unitOfMeasure,
    yesNo(p.isStorable),
    p.isActive ? "Active" : "Archived",
    decimal(p.cost),
    decimal(p.salePrice),
    fromMicro(p.reorderPointMicro),
    fromMicro(p.onHandMicro),
    STOCK_STATUS_LABELS[p.stockStatus] ?? p.stockStatus,
    date(p.updatedAt),
  ]);
  return render(
    "products",
    {
      title: "Products",
      generatedAt: now,
      summary: [
        ["Search", filterValue(query.q, "None")],
        ["Status", filterValue(query.status)],
        ["Category", query.categoryId ? "Filtered" : "All"],
      ],
      notes: [
        "On hand is the sum of posted stock balances across all warehouses, as on the Products page.",
        "Sale price is the list price stored on the product. It is informational and is not used for stock valuation.",
      ],
      sheets: [{ name: "Products", columns: PRODUCT_COLUMNS(currencyOf(ctx)), rows }],
    },
    rows.length,
    now
  );
}

// ---------- Stock on hand ----------

export async function exportStockOnHand(ctx: WorkspaceContext, query: StockOnHandExportQuery, now: Date): Promise<ExportFile> {
  const balances = await listStockBalancesForExport(ctx, query);
  const rows: CellValue[][] = balances.map((b) => [
    b.productSku,
    b.productName,
    b.unitOfMeasure,
    b.warehouseCode,
    b.warehouseName,
    fromMicro(b.onHandMicro),
    fromMicro(b.reorderPointMicro),
    STOCK_STATUS_LABELS[b.stockStatus] ?? b.stockStatus,
  ]);
  return render(
    "stock-on-hand",
    {
      title: "Stock on hand",
      generatedAt: now,
      summary: [
        ["Product", query.productId ? "Filtered" : "All"],
        ["Warehouse", query.warehouseId ? "Filtered" : "All"],
      ],
      notes: [
        "On hand is the posted balance for each product and warehouse. Receipts, issues, transfers, adjustments and completed work orders change it.",
        "Reserved and available quantities are not tracked in this version, so they are not exported.",
        "A reorder point of 0 means no reorder point is set. Stock status follows the same rules as the Stock page.",
      ],
      sheets: [
        {
          name: "Stock on hand",
          columns: [
            { header: "SKU", width: 14 },
            { header: "Product", width: 32 },
            { header: "Unit of measure", width: 12 },
            { header: "Warehouse", width: 12 },
            { header: "Warehouse name", width: 24 },
            { header: "On hand", width: 14, format: "quantity" },
            { header: "Reorder point", width: 14, format: "quantity" },
            { header: "Stock status", width: 14 },
          ],
          rows,
        },
      ],
    },
    rows.length,
    now
  );
}

// ---------- Stock movements ----------

export async function exportStockMovements(ctx: WorkspaceContext, query: StockMovementExportQuery, now: Date): Promise<ExportFile> {
  const window = movementWindow(query, now);
  const movements = await listStockMovementsForExport(ctx, {
    productId: query.productId,
    warehouseId: query.warehouseId,
    from: window.from,
    toExclusive: window.toExclusive,
  });
  const rows: CellValue[][] = movements.map((m) => [
    m.id,
    new Date(m.createdAt),
    m.productSku,
    m.productName,
    m.unitOfMeasure,
    m.warehouseCode,
    MOVEMENT_LABELS[m.movementType] ?? m.movementType,
    fromMicro(m.deltaMicro),
    m.sourceType,
    m.sourceId,
    m.reason,
  ]);
  return render(
    "stock-movements",
    {
      title: "Recent stock movements",
      generatedAt: now,
      summary: [
        ["Period (UTC)", `${window.fromLabel} to ${window.toLabel}`],
        ["Product", query.productId ? "Filtered" : "All"],
        ["Warehouse", query.warehouseId ? "Filtered" : "All"],
      ],
      notes: [
        "Recent means the selected dates. Without dates, the export covers the last 90 days, including today.",
        "Each row is a posted change. The ledger has no draft or reversed movements; corrections are new adjustment rows.",
        "Signed quantity is positive when stock is added and negative when it is removed.",
        "The acting user is not exported.",
      ],
      sheets: [
        {
          name: "Movements",
          columns: [
            { header: "Movement ID", width: 26 },
            { header: "Date and time (UTC)", width: 18, format: "datetime" },
            { header: "SKU", width: 14 },
            { header: "Product", width: 30 },
            { header: "Unit of measure", width: 12 },
            { header: "Warehouse", width: 12 },
            { header: "Movement type", width: 18 },
            { header: "Signed quantity", width: 14, format: "quantity" },
            { header: "Source type", width: 14 },
            { header: "Source document ID", width: 26 },
            { header: "Reason", width: 36 },
          ],
          rows,
        },
      ],
    },
    rows.length,
    now
  );
}

// ---------- Suppliers ----------

export async function exportSuppliers(ctx: WorkspaceContext, query: SupplierExportQuery, now: Date): Promise<ExportFile> {
  const suppliers = await listSuppliersForExport(ctx, query);
  const rows: CellValue[][] = suppliers.map((s) => [
    s.id,
    s.name,
    s.email,
    s.phone,
    s.taxIdentifier,
    s.address,
    s.isActive ? "Active" : "Inactive",
  ]);
  return render(
    "suppliers",
    {
      title: "Suppliers",
      generatedAt: now,
      summary: [["Search", filterValue(query.q, "None")]],
      notes: ["Contact person and payment terms are not stored for suppliers, so they are not exported."],
      sheets: [
        {
          name: "Suppliers",
          columns: [
            { header: "Supplier ID", width: 26 },
            { header: "Name", width: 30 },
            { header: "Email", width: 28 },
            { header: "Phone", width: 16 },
            { header: "Tax identifier", width: 18 },
            { header: "Address", width: 40 },
            { header: "Status", width: 10 },
          ],
          rows,
        },
      ],
    },
    rows.length,
    now
  );
}

// ---------- Goods receipts ----------

export async function exportGoodsReceipts(ctx: WorkspaceContext, query: GoodsReceiptExportQuery, now: Date): Promise<ExportFile> {
  const receipts = await listReceiptsForExport(ctx, query);
  const header: CellValue[][] = receipts.map((r) => [
    r.receiptNumber,
    r.orderNumber,
    r.supplierName,
    r.warehouseCode,
    RECEIPT_STATUS_LABELS[r.status] ?? r.status,
    new Date(r.createdAt),
    date(r.postedAt),
    r.lines.length,
  ]);
  const lines: CellValue[][] = receipts.flatMap((r) =>
    r.lines.map((line) => [
      r.receiptNumber,
      r.orderNumber,
      r.supplierName,
      r.warehouseCode,
      RECEIPT_STATUS_LABELS[r.status] ?? r.status,
      line.sku,
      line.productName,
      line.unitOfMeasure,
      decimal(line.quantity),
    ])
  );
  return render(
    "goods-receipts",
    {
      title: "Goods receipts",
      generatedAt: now,
      summary: [
        ["Status", filterValue(query.status ? RECEIPT_STATUS_LABELS[query.status] : undefined)],
        ["Receipts", receipts.length.toLocaleString("en-US")],
        ["Receipt lines", lines.length.toLocaleString("en-US")],
      ],
      notes: [
        "Only posted receipts change stock. Draft receipts show their status and are not received stock.",
        "Cancelled receipts are kept for audit and did not change stock.",
        "The Receipts sheet has one row per receipt. The Receipt lines sheet has one row per product line. Quantities are not totalled across sheets.",
      ],
      sheets: [
        {
          name: "Receipts",
          columns: [
            { header: "Receipt", width: 16 },
            { header: "Purchase order", width: 16 },
            { header: "Supplier", width: 28 },
            { header: "Warehouse", width: 12 },
            { header: "Status", width: 12 },
            { header: "Created (UTC)", width: 18, format: "datetime" },
            { header: "Posted (UTC)", width: 18, format: "datetime" },
            { header: "Line count", width: 11, format: "integer" },
          ],
          rows: header,
        },
        {
          name: "Receipt lines",
          columns: [
            { header: "Receipt", width: 16 },
            { header: "Purchase order", width: 16 },
            { header: "Supplier", width: 28 },
            { header: "Warehouse", width: 12 },
            { header: "Status", width: 12 },
            { header: "SKU", width: 14 },
            { header: "Product", width: 30 },
            { header: "Unit of measure", width: 12 },
            { header: "Received quantity", width: 16, format: "quantity" },
          ],
          rows: lines,
        },
      ],
    },
    receipts.length,
    now
  );
}

// ---------- Purchase orders ----------

export async function exportPurchaseOrders(ctx: WorkspaceContext, query: PurchaseOrderExportQuery, now: Date): Promise<ExportFile> {
  const orders = await listPurchaseOrdersForExport(ctx, query);
  const summaryRows: CellValue[][] = orders.map((o) => [
    o.orderNumber,
    o.supplierName,
    PURCHASE_ORDER_STATUS_LABELS[o.status] ?? o.status,
    o.currencyCode,
    new Date(o.createdAt),
    date(o.expectedDate),
    date(o.approvedAt),
    o.lines.length,
    decimal(o.subtotal),
    decimal(o.tax),
    decimal(o.total),
    o.notes,
  ]);
  const lineRows: CellValue[][] = orders.flatMap((o) =>
    o.lines.map((line) => [
      o.orderNumber,
      o.supplierName,
      PURCHASE_ORDER_STATUS_LABELS[o.status] ?? o.status,
      line.sku,
      line.productName,
      line.unitOfMeasure,
      decimal(line.ordered),
      decimal(line.received),
      decimal(line.remaining),
      decimal(line.unitCost),
      decimal(line.taxRate),
      decimal(line.lineSubtotal),
      decimal(line.lineTax),
      Math.round((decimal(line.lineSubtotal) + decimal(line.lineTax)) * 1000) / 1000,
    ])
  );
  const currency = orders[0]?.currencyCode ?? currencyOf(ctx);
  const money = (label: string): Column => ({ header: `${label} (${currency})`, width: 16, format: "money", currency });
  return render(
    "purchase-orders",
    {
      title: "Purchase orders",
      generatedAt: now,
      summary: [
        ["Status", filterValue(query.status === "all" ? undefined : PURCHASE_ORDER_STATUS_LABELS[query.status])],
        ["Search", filterValue(query.q, "None")],
        ["Orders", orders.length.toLocaleString("en-US")],
        ["Order lines", lineRows.length.toLocaleString("en-US")],
      ],
      notes: [
        "Draft and approved orders have received nothing yet. Received and outstanding quantities come from posted receipts only.",
        "Partially received means some lines are still outstanding. Received means every line has been received in full.",
        "Totals are the line sums stored on each order. Do not add totals from the Order lines sheet, which repeat the line amounts.",
        "Line total is line subtotal plus line tax. Tax rate is a percentage.",
      ],
      sheets: [
        {
          name: "Purchase orders",
          columns: [
            { header: "Order number", width: 16 },
            { header: "Supplier", width: 28 },
            { header: "Status", width: 18 },
            { header: "Currency", width: 10 },
            { header: "Created (UTC)", width: 18, format: "datetime" },
            { header: "Expected (UTC)", width: 14, format: "date" },
            { header: "Approved (UTC)", width: 18, format: "datetime" },
            { header: "Line count", width: 11, format: "integer" },
            money("Subtotal"),
            money("Tax"),
            money("Total"),
            { header: "Notes", width: 36 },
          ],
          rows: summaryRows,
        },
        {
          name: "Order lines",
          columns: [
            { header: "Order number", width: 16 },
            { header: "Supplier", width: 28 },
            { header: "Status", width: 18 },
            { header: "SKU", width: 14 },
            { header: "Product", width: 30 },
            { header: "Unit of measure", width: 12 },
            { header: "Ordered", width: 12, format: "quantity" },
            { header: "Received", width: 12, format: "quantity" },
            { header: "Outstanding", width: 12, format: "quantity" },
            money("Unit cost"),
            { header: "Tax rate (%)", width: 12 },
            money("Line subtotal"),
            money("Line tax"),
            money("Line total"),
          ],
          rows: lineRows,
        },
      ],
    },
    orders.length,
    now
  );
}

function currencyOf(ctx: WorkspaceContext): string {
  return ctx.currencyCode;
}

