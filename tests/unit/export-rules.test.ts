import { describe, expect, it } from "vitest";
import { assertExportWithinLimit, MAX_EXPORT_ROWS } from "@/server/exports/limits";
import {
  goodsReceiptExportQuerySchema,
  movementWindow,
  productExportQuerySchema,
  purchaseOrderExportQuerySchema,
  stockMovementExportQuerySchema,
  stockOnHandExportQuerySchema,
  supplierExportQuerySchema,
} from "@/features/exports/schemas/export.schema";
import { exportUrl, fileNameFromDisposition } from "@/shared/lib/download";

const productId = "aaaaaaaaaaaaaaaaaaaaaaaa";

describe("export row limit", () => {
  it("allows exactly the limit and rejects one more", () => {
    expect(() => assertExportWithinLimit(MAX_EXPORT_ROWS)).not.toThrow();
    expect(() => assertExportWithinLimit(MAX_EXPORT_ROWS + 1)).toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
  });
});

describe("export query schemas", () => {
  it("rejects unknown fields so a client cannot widen the query", () => {
    expect(productExportQuerySchema.safeParse({ companyId: productId }).success).toBe(false);
    expect(stockOnHandExportQuerySchema.safeParse({ companyId: productId }).success).toBe(false);
    expect(supplierExportQuerySchema.safeParse({ collection: "users" }).success).toBe(false);
    expect(goodsReceiptExportQuerySchema.safeParse({ page: 2 }).success).toBe(false);
    expect(purchaseOrderExportQuerySchema.safeParse({ page: 2 }).success).toBe(false);
  });

  it("drops pagination from the product and purchase order exports", () => {
    expect(productExportQuerySchema.safeParse({ status: "all" }).success).toBe(true);
    expect(productExportQuerySchema.safeParse({ status: "all", page: "2" }).success).toBe(false);
    expect(purchaseOrderExportQuerySchema.safeParse({ status: "approved", q: "PO-1" }).success).toBe(true);
  });

  it("validates the movement date range", () => {
    expect(stockMovementExportQuerySchema.safeParse({ from: "2026-02-30" }).success).toBe(false);
    expect(stockMovementExportQuerySchema.safeParse({ from: "2026-10-02", to: "2026-10-01" }).success).toBe(false);
    expect(stockMovementExportQuerySchema.safeParse({ from: "2026-01-01", to: "2027-01-02" }).success).toBe(false);
    expect(stockMovementExportQuerySchema.safeParse({ from: "2026-01-01", to: "2026-12-31" }).success).toBe(true);
    expect(stockMovementExportQuerySchema.safeParse({ productId: "not-an-id" }).success).toBe(false);
  });

  it("defaults the movement window to the last 90 UTC days, including today", () => {
    const window = movementWindow({}, new Date("2026-10-27T15:00:00Z"));
    expect(window.toLabel).toBe("2026-10-27");
    expect(window.fromLabel).toBe("2026-07-30");
    expect(window.toExclusive.toISOString()).toBe("2026-10-28T00:00:00.000Z");
  });

  it("uses an explicit range when given", () => {
    const window = movementWindow({ from: "2026-10-01", to: "2026-10-05" }, new Date("2026-10-27T15:00:00Z"));
    expect(window.from.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(window.toExclusive.toISOString()).toBe("2026-10-06T00:00:00.000Z");
  });
});

describe("download helpers", () => {
  it("builds export URLs from filters, leaving out empty values", () => {
    expect(exportUrl("products", { q: "wid", status: "active", categoryId: undefined })).toBe("/api/v1/exports/products?q=wid&status=active");
    expect(exportUrl("stock-on-hand", {})).toBe("/api/v1/exports/stock-on-hand");
  });

  it("reads a safe filename from Content-Disposition", () => {
    expect(fileNameFromDisposition('attachment; filename="products-2026-10-27.xlsx"')).toBe("products-2026-10-27.xlsx");
    expect(fileNameFromDisposition('attachment; filename="../etc/passwd"')).toBeNull();
    expect(fileNameFromDisposition(null)).toBeNull();
  });
});
