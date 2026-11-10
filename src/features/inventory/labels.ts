/** Human-readable labels for movement and status values. Shared by server pages and client components. */
export const MOVEMENT_LABELS: Record<string, string> = {
  receipt: "Receipt",
  issue: "Issue",
  adjustment: "Adjustment",
  transfer_out: "Transfer out",
  transfer_in: "Transfer in",
  production_consume: "Production (consumed)",
  production_output: "Production (output)",
};

export const STOCK_STATUS_LABELS: Record<string, string> = {
  in_stock: "In stock",
  low_stock: "Low stock",
  out_of_stock: "Out of stock",
  not_stored: "Not stored",
};

export const STOCK_STATUS_TONES: Record<string, "success" | "warning" | "error" | "neutral"> = {
  in_stock: "success",
  low_stock: "warning",
  out_of_stock: "error",
  not_stored: "neutral",
};
