import { z } from "zod";
import {
  objectIdSchema,
  optionalText,
  pageSchema,
  positiveQuantitySchema,
} from "@/shared/lib/schema-primitives";
import { parseQuantity, isWholeQuantity } from "@/shared/lib/fixed-point";
import { isCountableUnit } from "@/shared/domain/units";


export const MAX_BOM_COMPONENTS = 100;

const componentSchema = z
  .object({
    productId: objectIdSchema,
    quantityPerUnit: positiveQuantitySchema,
  })
  .strict();

const bomShape = z
  .object({
    finishedProductId: objectIdSchema,
    notes: optionalText(1000),
    components: z
      .array(componentSchema)
      .min(1, "Add at least one component")
      .max(MAX_BOM_COMPONENTS, `A BOM can contain at most ${MAX_BOM_COMPONENTS} components`),
  })
  .strict();

function checkComponents(
  value: { finishedProductId: string; components: { productId: string }[] },
  ctx: z.RefinementCtx
): void {
  const seen = new Set<string>();
  value.components.forEach((component, index) => {
    if (component.productId === value.finishedProductId) {
      ctx.addIssue({
        code: "custom",
        path: ["components", index, "productId"],
        message: "A product cannot be a component of itself",
      });
    }
    if (seen.has(component.productId)) {
      ctx.addIssue({
        code: "custom",
        path: ["components", index, "productId"],
        message: "Each component can appear only once",
      });
    }
    seen.add(component.productId);
  });
}

export const bomInputSchema = bomShape.superRefine(checkComponents);
export type BomInput = z.infer<typeof bomInputSchema>;

export const bomUpdateSchema = bomShape
  .extend({ expectedVersion: z.number().int().min(1) })
  .strict()
  .superRefine(checkComponents);
export type BomUpdateInput = z.infer<typeof bomUpdateSchema>;

export const workOrderInputSchema = z
  .object({
    bomId: objectIdSchema,
    warehouseId: objectIdSchema,
    quantity: positiveQuantitySchema,
    plannedStart: z
      .string()
      .trim()
      .regex(/^(\d{4}-\d{2}-\d{2})?$/, "Use a valid date")
      .refine((value) => value === "" || !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "Use a valid date"),
  })
  .strict();
export type WorkOrderInput = z.infer<typeof workOrderInputSchema>;

/** The fields that decide material needs. Used to preview availability before a work order exists. */
export const materialPreviewSchema = z
  .object({ bomId: objectIdSchema, warehouseId: objectIdSchema, quantity: positiveQuantitySchema })
  .strict();
export type MaterialPreviewInput = z.infer<typeof materialPreviewSchema>;

export const bomListQuerySchema = z
  .object({
    status: z.enum(["all", "draft", "active", "archived"]).default("all"),
    page: pageSchema,
  })
  .strict();

export const workOrderListQuerySchema = z
  .object({
    status: z.enum(["all", "draft", "in_progress", "completed", "cancelled"]).default("all"),
    page: pageSchema,
  })
  .strict();

/** Countable finished products and components must use whole quantities per unit. */
export function quantityPerUnitValid(unit: Parameters<typeof isCountableUnit>[0], quantity: string): boolean {
  return !isCountableUnit(unit) || isWholeQuantity(parseQuantity(quantity));
}
