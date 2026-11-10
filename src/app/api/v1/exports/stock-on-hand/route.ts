import { handleExport } from "@/server/exports/route-handler";
import { exportStockOnHand } from "@/server/exports/reports";
import { stockOnHandExportQuerySchema } from "@/features/exports/schemas/export.schema";

/** GET /api/v1/exports/stock-on-hand: Excel export of the filtered result for the signed-in company. */
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleExport(request, "inventory", "stock-on-hand", stockOnHandExportQuerySchema, exportStockOnHand);
}
