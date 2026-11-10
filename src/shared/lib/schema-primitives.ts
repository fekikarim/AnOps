import { z } from "zod";

/** A MongoDB ObjectId in its 24-character hex form. Lower-cased after parsing. */
export const objectIdSchema = z
  .string()
  .trim()
  .regex(/^[a-f0-9]{24}$/i, "Invalid identifier")
  .transform((value) => value.toLowerCase());

/** Positive quantity typed by a user, for example "12" or "0.250". */
export const positiveQuantitySchema = z
  .string()
  .trim()
  .regex(/^\d{1,6}(\.\d{1,6})?$/, "Enter a quantity such as 12 or 12.5 (up to 6 decimals)")
  .refine((value) => Number(value) > 0, "Quantity must be greater than zero");

/** Signed quantity used for stock adjustments. */
export const signedQuantitySchema = z
  .string()
  .trim()
  .regex(/^-?\d{1,6}(\.\d{1,6})?$/, "Enter a quantity such as 12, -3 or 0.5")
  .refine((value) => Number(value) !== 0, "Adjustment cannot be zero");

/** Non-negative quantity, such as a reorder point or a planned amount that may be zero. */
export const nonNegativeQuantitySchema = z
  .string()
  .trim()
  .regex(/^\d{1,6}(\.\d{1,6})?$/, "Enter a quantity such as 0, 12 or 12.5");

/** Non-negative money amount with up to three decimals (milli-units). */
export const moneySchema = z
  .string()
  .trim()
  .regex(/^\d{1,6}(\.\d{1,3})?$/, "Enter an amount such as 12.500 (up to 3 decimals)");

export const optionalText = (max: number) => z.string().trim().max(max, `Maximum ${max} characters`);

export const requiredText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be at most ${max} characters`);

/** Accepts an empty string from a form select as "no value". */
export const optionalObjectIdSchema = z
  .union([z.literal(""), objectIdSchema])
  .transform((value) => (value === "" ? null : value));

export const pageSchema = z.coerce.number().int().min(1).max(1000).default(1);
