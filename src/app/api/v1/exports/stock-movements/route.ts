import { handleExport } from "@/server/exports/route-handler";
import { exportStockMovements } from "@/server/exports/reports";
import { stockMovementExportQuerySchema } from "@/features/exports/schemas/export.schema";

/** GET /api/v1/exports/stock-movements: Excel export of the filtered result for the signed-in company. */
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleExport(request, "inventory", "stock-movements", stockMovementExportQuerySchema, exportStockMovements);
}
