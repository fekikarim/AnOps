import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";

type XlsxInput = Parameters<ExcelJS.Xlsx["load"]>[0];
import { ObjectId } from "mongodb";
import { createHarness, parsed, type TestHarness } from "../helpers/workspace";
import { productInputSchema, stockMoveInputSchema, warehouseInputSchema } from "@/features/inventory/schemas/inventory.schema";
import { purchaseOrderInputSchema, receiptInputSchema, supplierInputSchema } from "@/features/purchasing/schemas/purchasing.schema";
import { createProduct, createWarehouse } from "@/server/inventory/catalog.service";
import { getOnHandMicro } from "@/server/inventory/stock-ledger";
import { issueStock, receiveStock } from "@/server/inventory/stock.service";
import { createSupplier } from "@/server/purchasing/supplier.service";
import { approvePurchaseOrder, createPurchaseOrder } from "@/server/purchasing/purchase-order.service";
import { createReceipt, postReceipt } from "@/server/purchasing/receipt.service";
import {
  exportGoodsReceipts,
  exportProducts,
  exportPurchaseOrders,
  exportStockMovements,
  exportStockOnHand,
  exportSuppliers,
  type ExportFile,
} from "@/server/exports/reports";
import { AppError } from "@/shared/lib/errors";
import { COLLECTIONS } from "@/server/db/documents";
import { productExportQuerySchema, purchaseOrderExportQuerySchema } from "@/features/exports/schemas/export.schema";

/** Resolves the tenant the route handler uses. Each test sets it, so no test depends on another. */
const { resolveMock, appGuardMock } = vi.hoisted(() => ({ resolveMock: vi.fn(), appGuardMock: vi.fn() }));
vi.mock("@/server/tenancy/workspace", () => ({ resolveWorkspace: resolveMock }));
/** The plan/app guard is covered by platform-lifecycle.test.ts; here it only needs to be switchable per test. */
vi.mock("@/server/platform/access", () => ({ assertWorkspaceAppAccess: appGuardMock }));

import { GET as productsRoute } from "@/app/api/v1/exports/products/route";
import { GET as movementsRoute } from "@/app/api/v1/exports/stock-movements/route";

const NOW = new Date();

let h: TestHarness;
let warehouseId: string;
let supplierId: string;
let productA: { id: string };
let productF: { id: string };

async function sheet(file: ExportFile, name: string): Promise<ExcelJS.Worksheet> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(file.body as unknown as XlsxInput);
  const ws = workbook.getWorksheet(name);
  if (!ws) throw new Error(`missing sheet ${name}`);
  return ws;
}

/** Data rows only (header excluded), with values as the cell reads them. */
function dataRows(ws: ExcelJS.Worksheet): ExcelJS.CellValue[][] {
  const rows: ExcelJS.CellValue[][] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber > 1) rows.push((row.values as ExcelJS.CellValue[]).slice(1));
  });
  return rows;
}

function findRow(ws: ExcelJS.Worksheet, column: number, value: string): ExcelJS.Row | undefined {
  let found: ExcelJS.Row | undefined;
  ws.eachRow((row, rowNumber) => {
    if (rowNumber > 1 && row.getCell(column).text === value) found = row;
  });
  return found;
}

beforeAll(async () => {
  h = await createHarness();
  warehouseId = (await createWarehouse(h.ctx(), parsed(warehouseInputSchema, { name: "Main", code: "MAIN", address: "", isActive: true }))).id;
  supplierId = (
    await createSupplier(
      h.ctx(),
      parsed(supplierInputSchema, { name: "Export Supply", email: "sales@example.test", phone: "", taxIdentifier: "", address: "1 Dock Road", isActive: true })
    )
  ).id;
  productA = await createProduct(
    h.ctx(),
    parsed(productInputSchema, {
      sku: "EXP-A", name: "Widget A", description: "Standard widget", categoryId: "", unitOfMeasure: "unit",
      isStorable: true, isActive: true, cost: "2.000", salePrice: "5.000", reorderPoint: "5",
    })
  );
  productF = await createProduct(
    h.ctx(),
    parsed(productInputSchema, {
      sku: "EXP-F", name: "=cmd|' /C calc'!A0", description: "", categoryId: "", unitOfMeasure: "unit",
      isStorable: true, isActive: true, cost: "1.000", salePrice: "0.000", reorderPoint: "0",
    })
  );
  await createProduct(
    h.ctx(),
    parsed(productInputSchema, {
      sku: "EXP-OLD", name: "Retired item", description: "", categoryId: "", unitOfMeasure: "unit",
      isStorable: true, isActive: false, cost: "1.000", salePrice: "0.000", reorderPoint: "0",
    })
  );

  // Facts: 40 units of A received, 30 issued, so 10 on hand.
  await receiveStock(h.ctx(), parsed(stockMoveInputSchema, { productId: productA.id, warehouseId, quantity: "40", reason: "" }));
  await issueStock(h.ctx(), parsed(stockMoveInputSchema, { productId: productA.id, warehouseId, quantity: "30", reason: "Sales" }));

  // PO 1: two lines, approved, 4 of 10 A received and posted. Line A has 10% tax.
  const order = await createPurchaseOrder(
    h.ctx(),
    parsed(purchaseOrderInputSchema, {
      supplierId, expectedDate: "2026-12-01", notes: "Spring restock",
      lines: [
        { productId: productA.id, quantity: "10", unitCost: "2.000", taxRate: "10" },
        { productId: productF.id, quantity: "5", unitCost: "1.000", taxRate: "0" },
      ],
    })
  );
  await approvePurchaseOrder(h.ctx(), order.id, order.version);
  const receipt = await createReceipt(
    h.ctx(),
    parsed(receiptInputSchema, {
      purchaseOrderId: order.id,
      warehouseId,
      lines: [{ purchaseOrderLineId: order.lines[0].id, quantity: "4" }],
    })
  );
  await postReceipt(h.ctx(), receipt.id);

  // PO 2: a draft that must not change stock or appear as received.
  await createPurchaseOrder(
    h.ctx(),
    parsed(purchaseOrderInputSchema, { supplierId, expectedDate: "", notes: "", lines: [{ productId: productA.id, quantity: "3", unitCost: "2.000", taxRate: "0" }] })
  );
});

afterAll(async () => {
  await h.cleanup();
});

beforeEach(() => {
  resolveMock.mockReset();
  appGuardMock.mockReset();
  appGuardMock.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("products export", () => {
  it("exports only the filtered result and keeps authoritative stock", async () => {
    const active = await exportProducts(h.ctx(), parsed(productExportQuerySchema, {}), NOW);
    expect(active.rowCount).toBe(2);
    const all = await exportProducts(h.ctx(), parsed(productExportQuerySchema, { status: "all" }), NOW);
    expect(all.rowCount).toBe(3);

    const ws = await sheet(active, "Products");
    expect(ws.getRow(1).getCell(1).value).toBe("SKU");
    const row = findRow(ws, 1, "EXP-A")!;
    expect(row.getCell(8).value).toBe(2); // cost, numeric
    expect(row.getCell(8).type).toBe(ExcelJS.ValueType.Number);
    expect(row.getCell(11).value).toBe(14); // on hand, numeric: 40 received - 30 issued + 4 posted from the PO receipt
    expect(row.getCell(12).text).toBe("In stock");
  });

  it("stores spreadsheet-formula text from a product name as literal text", async () => {
    const ws = await sheet(await exportProducts(h.ctx(), parsed(productExportQuerySchema, {}), NOW), "Products");
    const cell = findRow(ws, 1, "EXP-F")!.getCell(2);
    expect(cell.type).not.toBe(ExcelJS.ValueType.Formula);
    expect(cell.text).toBe("=cmd|' /C calc'!A0");
  });

  it("filters by search text the same way as the list", async () => {
    const result = await exportProducts(h.ctx(), parsed(productExportQuerySchema, { q: "widget" }), NOW);
    expect(result.rowCount).toBe(1);
    expect(dataRows(await sheet(result, "Products"))[0][0]).toBe("EXP-A");
  });
});

describe("stock on hand export", () => {
  it("reports balances with no reservation columns", async () => {
    const result = await exportStockOnHand(h.ctx(), {}, NOW);
    const ws = await sheet(result, "Stock on hand");
    const headers = ws.getRow(1).values as unknown[];
    expect(headers).not.toContain("Reserved");
    expect(headers).not.toContain("Available");
    expect(findRow(ws, 1, "EXP-A")!.getCell(6).value).toBe(14);
  });

  it("returns no rows to another company", async () => {
    const result = await exportStockOnHand(h.otherTenant(), {}, NOW);
    expect(result.rowCount).toBe(0);
  });
});

describe("stock movements export", () => {
  it("signs quantities and includes both receipt and issue in the default window", async () => {
    const result = await exportStockMovements(h.ctx(), {}, NOW);
    const ws = await sheet(result, "Movements");
    const rows = dataRows(ws);
    const quantities = rows.filter((r) => r[2] === "EXP-A").map((r) => r[7]);
    expect(quantities).toEqual(expect.arrayContaining([40, -30]));
    expect(ws.getRow(1).getCell(1).value).toBe("Movement ID");
  });

  it("returns a clear empty result for a window with no movements", async () => {
    const result = await exportStockMovements(h.ctx(), { from: "2000-01-01", to: "2000-01-02" }, NOW);
    expect(result.rowCount).toBe(0);
    const summary = await sheet(result, "Summary");
    const text: string[] = [];
    summary.eachRow((row) => text.push((row.values as unknown[]).slice(1).join(" ")));
    expect(text.join("\n")).toContain("No records match the selected filters.");
  });

  it("does not show another company's movements", async () => {
    const result = await exportStockMovements(h.otherTenant(), {}, NOW);
    expect(result.rowCount).toBe(0);
  });
});

describe("suppliers export", () => {
  it("filters by name and never exposes another company's suppliers", async () => {
    expect((await exportSuppliers(h.ctx(), { q: "" }, NOW)).rowCount).toBe(1);
    expect((await exportSuppliers(h.ctx(), { q: "zzz" }, NOW)).rowCount).toBe(0);
    expect((await exportSuppliers(h.otherTenant(), { q: "" }, NOW)).rowCount).toBe(0);
    const ws = await sheet(await exportSuppliers(h.ctx(), { q: "" }, NOW), "Suppliers");
    expect(findRow(ws, 2, "Export Supply")!.getCell(3).text).toBe("sales@example.test");
  });
});

describe("goods receipts export", () => {
  it("lists the posted receipt with one row per line and no receipt totals on the line sheet", async () => {
    const result = await exportGoodsReceipts(h.ctx(), {}, NOW);
    expect(result.rowCount).toBe(1);
    const receipts = await sheet(result, "Receipts");
    expect(dataRows(receipts)[0][4]).toBe("Posted");
    const lines = dataRows(await sheet(result, "Receipt lines"));
    expect(lines).toHaveLength(1);
    expect(lines[0][5]).toBe("EXP-A");
    expect(lines[0][8]).toBe(4);
  });

  it("applies the status filter and returns nothing for drafts", async () => {
    expect((await exportGoodsReceipts(h.ctx(), { status: "draft" }, NOW)).rowCount).toBe(0);
    expect((await exportGoodsReceipts(h.otherTenant(), {}, NOW)).rowCount).toBe(0);
  });
});

describe("purchase orders export", () => {
  it("shows partial receipt, outstanding quantity and line totals without counting drafts as received", async () => {
    const result = await exportPurchaseOrders(h.ctx(), parsed(purchaseOrderExportQuerySchema, {}), NOW);
    expect(result.rowCount).toBe(2);

    const orders = await sheet(result, "Purchase orders");
    const partial = findRow(orders, 1, "PO-000001");
    expect(partial?.getCell(3).text).toBe("Partially received");
    expect(partial?.getCell(8).value).toBe(2);
    expect(partial?.getCell(9).value).toBe(25);
    expect(partial?.getCell(11).value).toBe(27);

    const lines = await sheet(result, "Order lines");
    const lineA = dataRows(lines).find((r) => r[0] === "PO-000001" && r[3] === "EXP-A")!;
    expect(lineA[6]).toBe(10); // ordered
    expect(lineA[7]).toBe(4); // received
    expect(lineA[8]).toBe(6); // outstanding
    expect(lineA[13]).toBe(22); // line total = subtotal 20 + tax 2

    const draftLines = dataRows(lines).filter((r) => r[2] === "Draft");
    expect(draftLines.every((r) => r[7] === 0)).toBe(true);
  });

  it("filters by status and search", async () => {
    expect((await exportPurchaseOrders(h.ctx(), parsed(purchaseOrderExportQuerySchema, { status: "draft" }), NOW)).rowCount).toBe(1);
    expect((await exportPurchaseOrders(h.ctx(), parsed(purchaseOrderExportQuerySchema, { status: "approved" }), NOW)).rowCount).toBe(0);
    expect((await exportPurchaseOrders(h.ctx(), parsed(purchaseOrderExportQuerySchema, { q: "PO-000001" }), NOW)).rowCount).toBe(1);
    expect((await exportPurchaseOrders(h.otherTenant(), parsed(purchaseOrderExportQuerySchema, {}), NOW)).rowCount).toBe(0);
  });

  it("does not change stock", async () => {
    const ctx = h.ctx();
    const before = await getOnHandMicro(h.db, { companyId: ctx.companyId }, new ObjectId(productA.id), new ObjectId(warehouseId));
    await exportPurchaseOrders(ctx, parsed(purchaseOrderExportQuerySchema, {}), NOW);
    await exportGoodsReceipts(ctx, {}, NOW);
    await exportStockOnHand(ctx, {}, NOW);
    expect(await getOnHandMicro(h.db, { companyId: ctx.companyId }, new ObjectId(productA.id), new ObjectId(warehouseId))).toBe(before);
  });
});

describe("permissions", () => {
  it("refuses every report to a context without read permission", async () => {
    const denied = { ...h.ctx(), permissions: new Set<never>() };
    await expect(exportProducts(denied, parsed(productExportQuerySchema, {}), NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(exportStockOnHand(denied, {}, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(exportStockMovements(denied, {}, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(exportSuppliers(denied, { q: "" }, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(exportGoodsReceipts(denied, {}, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(exportPurchaseOrders(denied, parsed(purchaseOrderExportQuerySchema, {}), NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("HTTP route handlers", () => {
  it("returns an xlsx attachment with a dated filename, row count, and no-store caching", async () => {
    resolveMock.mockResolvedValueOnce(h.ctx());
    const response = await productsRoute(new Request("http://localhost/api/v1/exports/products?status=all"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(response.headers.get("Content-Disposition")).toMatch(/^attachment; filename="products-\d{4}-\d{2}-\d{2}\.xlsx"$/);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Export-Row-Count")).toBe("3");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()) as unknown as XlsxInput);
    expect(workbook.getWorksheet("Products")!.rowCount).toBe(4);
  });

  it("records an audit event for each generated export", async () => {
    resolveMock.mockResolvedValueOnce(h.ctx());
    await movementsRoute(new Request("http://localhost/api/v1/exports/stock-movements"));
    const event = await h.db.collection(COLLECTIONS.auditEvents).findOne({ action: "export.excel_generated", entityId: "stock-movements" });
    expect(event).toMatchObject({ entityType: "export", metadata: { report: "stock-movements" } });
  });

  it("returns 401 without a session and exposes no internals", async () => {
    resolveMock.mockRejectedValueOnce(new AppError("UNAUTHENTICATED", "Please sign in to continue."));
    const response = await productsRoute(new Request("http://localhost/api/v1/exports/products"));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("UNAUTHENTICATED");
    expect(JSON.stringify(body)).not.toMatch(/stack|mongodb|at /i);
  });

  it("refuses an export when the organization's plan or the member's access does not include the application", async () => {
    resolveMock.mockResolvedValueOnce(h.ctx());
    appGuardMock.mockRejectedValueOnce(new AppError("FORBIDDEN", "This application is not included in your organization's plan or your access."));
    const response = await productsRoute(new Request("http://localhost/api/v1/exports/products"));
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("FORBIDDEN");
    expect(appGuardMock).toHaveBeenCalledWith(expect.anything(), "inventory");
  });

  it("rejects unknown or invalid filters with 400", async () => {
    resolveMock.mockResolvedValueOnce(h.ctx());
    const unknown = await productsRoute(new Request("http://localhost/api/v1/exports/products?collection=users"));
    expect(unknown.status).toBe(400);
    expect((await unknown.json()).error.code).toBe("VALIDATION_ERROR");

    resolveMock.mockResolvedValueOnce(h.ctx());
    const badRange = await movementsRoute(new Request("http://localhost/api/v1/exports/stock-movements?from=2026-10-05&to=2026-10-01"));
    expect(badRange.status).toBe(400);
  });

  it("hides internal error details from unexpected failures", async () => {
    resolveMock.mockRejectedValueOnce(new Error("connect ECONNREFUSED 127.0.0.1:27018 secret-host"));
    const response = await productsRoute(new Request("http://localhost/api/v1/exports/products"));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("INTERNAL");
    expect(JSON.stringify(body)).not.toContain("ECONNREFUSED");
    expect(JSON.stringify(body)).not.toContain("secret-host");
  });
});

