import { z } from "zod";
import { objectIdSchema, optionalText } from "@/shared/lib/schema-primitives";
import { productListQuerySchema } from "@/features/inventory/schemas/inventory.schema";
import { purchaseOrderListQuerySchema } from "@/features/purchasing/schemas/purchasing.schema";

/**
 * Query parameters accepted by each Excel export. They mirror the filters on the matching page,
 * minus pagination: an export always covers the full filtered result. Unknown keys are rejected.
 */

/** Movement window is UTC calendar days, inclusive. */
export const MOVEMENT_DEFAULT_WINDOW_DAYS = 90;
export const MOVEMENT_MAX_WINDOW_DAYS = 366;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date such as 2026-10-27")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Enter a real calendar date");

export const productExportQuerySchema = productListQuerySchema.omit({ page: true });

export const stockOnHandExportQuerySchema = z
  .object({
    productId: objectIdSchema.optional(),
    warehouseId: objectIdSchema.optional(),
  })
  .strict();

export const stockMovementExportQuerySchema = z
  .object({
    productId: objectIdSchema.optional(),
    warehouseId: objectIdSchema.optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.from && value.to && value.from > value.to) {
      ctx.addIssue({ code: "custom", path: ["from"], message: "The start date must be on or before the end date" });
      return;
    }
    const span = value.from && value.to ? daysBetween(value.from, value.to) + 1 : 0;
    if (span > MOVEMENT_MAX_WINDOW_DAYS) {
      ctx.addIssue({ code: "custom", path: ["to"], message: `Choose a range of at most ${MOVEMENT_MAX_WINDOW_DAYS} days` });
    }
  });

export const supplierExportQuerySchema = z.object({ q: optionalText(80).default("") }).strict();

export const goodsReceiptExportQuerySchema = z
  .object({ status: z.enum(["draft", "posted", "cancelled"]).optional() })
  .strict();

export const purchaseOrderExportQuerySchema = purchaseOrderListQuerySchema.omit({ page: true });

export type ProductExportQuery = z.infer<typeof productExportQuerySchema>;
export type StockOnHandExportQuery = z.infer<typeof stockOnHandExportQuerySchema>;
export type StockMovementExportQuery = z.infer<typeof stockMovementExportQuerySchema>;
export type SupplierExportQuery = z.infer<typeof supplierExportQuerySchema>;
export type GoodsReceiptExportQuery = z.infer<typeof goodsReceiptExportQuerySchema>;
export type PurchaseOrderExportQuery = z.infer<typeof purchaseOrderExportQuerySchema>;

function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);
  return Math.round((end - start) / 86_400_000);
}

/** Resolves the movement window: explicit dates, or the last 90 UTC days ending today. */
export function movementWindow(query: StockMovementExportQuery, now: Date): { from: Date; toExclusive: Date; fromLabel: string; toLabel: string } {
  const today = now.toISOString().slice(0, 10);
  const toLabel = query.to ?? today;
  const fromLabel = query.from ?? shiftDays(toLabel, -(MOVEMENT_DEFAULT_WINDOW_DAYS - 1));
  return {
    from: new Date(`${fromLabel}T00:00:00.000Z`),
    toExclusive: new Date(`${shiftDays(toLabel, 1)}T00:00:00.000Z`),
    fromLabel,
    toLabel,
  };
}

function shiftDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
