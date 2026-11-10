import { handleExport } from "@/server/exports/route-handler";
import { exportProducts } from "@/server/exports/reports";
import { productExportQuerySchema } from "@/features/exports/schemas/export.schema";

/** GET /api/v1/exports/products: Excel export of the filtered result for the signed-in company. */
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleExport(request, "inventory", "products", productExportQuerySchema, exportProducts);
}
