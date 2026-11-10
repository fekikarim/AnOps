import "server-only";
import { AppError } from "@/shared/lib/errors";

/**
 * Largest workbook a single export may produce. Exports are generated in memory, so a bounded
 * row count keeps memory use predictable. Larger selections must be narrowed with filters.
 */
export const MAX_EXPORT_ROWS = 10_000;

/** Rejects a selection whose row count exceeds the limit. Call with the count before loading rows. */
export function assertExportWithinLimit(total: number): void {
  if (total > MAX_EXPORT_ROWS) {
    throw new AppError(
      "VALIDATION_ERROR",
      `This export would contain ${total.toLocaleString("en-US")} rows; the limit is ${MAX_EXPORT_ROWS.toLocaleString("en-US")}. Narrow the filters and try again.`
    );
  }
}
