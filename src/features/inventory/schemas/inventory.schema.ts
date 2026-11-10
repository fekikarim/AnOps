import { z } from "zod";
import { UNITS_OF_MEASURE, isCountableUnit } from "@/shared/domain/units";
import {
  moneySchema,
  objectIdSchema,
  optionalObjectIdSchema,
  optionalText,
  nonNegativeQuantitySchema,
  pageSchema,
  positiveQuantitySchema,
  requiredText,
  signedQuantitySchema,
} from "@/shared/lib/schema-primitives";
import { isWholeQuantity, parseQuantity } from "@/shared/lib/fixed-point";
import type { UnitOfMeasure } from "@/shared/domain/units";

export const PRODUCT_PAGE_SIZE = 25;

/** Base field validation reports malformed numbers, so a malformed value is not a whole-number error here. */
function isWholeQuantityString(value: string): boolean {
  try {
    return isWholeQuantity(parseQuantity(value));
  } catch {
    return true;
  }
}

export const categoryInputSchema = z
  .object({
    name: requiredText(80, "Category name"),
    description: optionalText(300),
  })
  .strict();

const skuSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(1, "SKU is required")
  .max(64, "SKU must be at most 64 characters")
  .regex(/^[A-Z0-9][A-Z0-9._-]*$/, "SKU may contain letters, digits, dots, dashes and underscores");

const productBaseSchema = z
  .object({
    sku: skuSchema,
    name: requiredText(120, "Product name"),
    description: optionalText(2000),
    categoryId: optionalObjectIdSchema,
    unitOfMeasure: z.enum(UNITS_OF_MEASURE),
    isStorable: z.boolean(),
    isActive: z.boolean(),
    cost: moneySchema,
    salePrice: moneySchema,
    reorderPoint: nonNegativeQuantitySchema,
  })
  .strict();

function checkCountableReorderPoint(
  value: { unitOfMeasure: UnitOfMeasure; reorderPoint: string },
  ctx: z.RefinementCtx
): void {
  if (isCountableUnit(value.unitOfMeasure) && !isWholeQuantityString(value.reorderPoint)) {
    ctx.addIssue({
      code: "custom",
      path: ["reorderPoint"],
      message: "Countable products need a whole-number reorder point",
    });
  }
}

export const productInputSchema = productBaseSchema.superRefine(checkCountableReorderPoint);

/**
 * Create a product and, optionally, record its opening stock in one step. The stock is posted through the
 * normal receipt ledger, so it is a real, auditable movement rather than a field on the product.
 */
export const productWithOpeningStockSchema = productBaseSchema
  .extend({
    openingWarehouseId: optionalObjectIdSchema,
    openingQuantity: nonNegativeQuantitySchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    checkCountableReorderPoint(value, ctx);
    const quantity = Number(value.openingQuantity);
    if (quantity <= 0) return;
    if (!value.isStorable) {
      ctx.addIssue({ code: "custom", path: ["openingQuantity"], message: "Only stored products can have opening stock" });
    }
    if (!value.openingWarehouseId) {
      ctx.addIssue({ code: "custom", path: ["openingWarehouseId"], message: "Choose the warehouse that holds this stock" });
    }
    if (isCountableUnit(value.unitOfMeasure) && !isWholeQuantityString(value.openingQuantity)) {
      ctx.addIssue({ code: "custom", path: ["openingQuantity"], message: "Countable products need a whole-number quantity" });
    }
  });

export type ProductWithOpeningStockInput = z.infer<typeof productWithOpeningStockSchema>;

/** Opening stock for products that already exist: one warehouse, many products, each with its own quantity. */
export const openingStockBatchSchema = z
  .object({
    warehouseId: objectIdSchema,
    entries: z
      .array(z.object({ productId: objectIdSchema, quantity: positiveQuantitySchema }).strict())
      .min(1, "Enter a quantity for at least one product")
      .max(50, "Record at most 50 products at a time"),
  })
  .strict()
  .refine((value) => new Set(value.entries.map((entry) => entry.productId)).size === value.entries.length, {
    message: "Each product can appear only once",
    path: ["entries"],
  });

export type OpeningStockBatchInput = z.infer<typeof openingStockBatchSchema>;

/** Edits carry the version the user saw, so a stale form cannot overwrite newer changes. */
export const productUpdateSchema = productBaseSchema
  .extend({ expectedVersion: z.number().int().min(1) })
  .strict()
  .superRefine(checkCountableReorderPoint);

export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;

export type ProductInput = z.infer<typeof productInputSchema>;

export const warehouseInputSchema = z
  .object({
    name: requiredText(120, "Warehouse name"),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9-]{2,12}$/, "Code must be 2 to 12 letters, digits or dashes"),
    address: optionalText(300),
    isActive: z.boolean(),
  })
  .strict();

export type WarehouseInput = z.infer<typeof warehouseInputSchema>;

/** Manual receipts, issues and transfers. Quantities are always positive; direction comes from the operation. */
export const stockMoveInputSchema = z
  .object({
    productId: objectIdSchema,
    warehouseId: objectIdSchema,
    quantity: positiveQuantitySchema,
    reason: optionalText(200),
  })
  .strict();

export const stockTransferInputSchema = z
  .object({
    productId: objectIdSchema,
    fromWarehouseId: objectIdSchema,
    toWarehouseId: objectIdSchema,
    quantity: positiveQuantitySchema,
    reason: optionalText(200),
  })
  .strict()
  .refine((value) => value.fromWarehouseId !== value.toWarehouseId, {
    message: "Source and destination warehouses must differ",
    path: ["toWarehouseId"],
  });

export const stockAdjustmentInputSchema = z
  .object({
    productId: objectIdSchema,
    warehouseId: objectIdSchema,
    delta: signedQuantitySchema,
    reason: requiredText(200, "Reason"),
  })
  .strict();

export const productListQuerySchema = z
  .object({
    q: optionalText(80).default(""),
    categoryId: optionalObjectIdSchema.optional(),
    status: z.enum(["active", "archived", "all"]).default("active"),
    page: pageSchema,
  })
  .strict();

export const movementListQuerySchema = z
  .object({
    productId: objectIdSchema.optional(),
    warehouseId: objectIdSchema.optional(),
    page: pageSchema,
  })
  .strict();

export type ProductListQuery = z.infer<typeof productListQuerySchema>;
export type StockMoveInput = z.infer<typeof stockMoveInputSchema>;
export type StockTransferInput = z.infer<typeof stockTransferInputSchema>;
export type StockAdjustmentInput = z.infer<typeof stockAdjustmentInputSchema>;

/** Countable units must move in whole numbers. Fractional units accept up to six decimals. */
export function quantityFitsUnit(unitOfMeasure: UnitOfMeasure, quantityMicro: number): boolean {
  return !isCountableUnit(unitOfMeasure) || isWholeQuantity(quantityMicro);
}
