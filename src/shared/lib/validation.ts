import type { ZodError, ZodType } from "zod";

export type FieldErrors = Record<string, string>;

export function toFieldErrors(error: ZodError): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "root";
    if (!errors[key]) errors[key] = issue.message;
  }
  return errors;
}

export type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; errors: FieldErrors; message: string };

export function parseWithSchema<T>(schema: ZodType<T>, value: unknown): ParseResult<T> {
  const result = schema.safeParse(value);
  if (result.success) return { success: true, data: result.data };
  const errors = toFieldErrors(result.error);
  const message = result.error.issues[0]?.message ?? "Invalid input";
  return { success: false, errors, message };
}
