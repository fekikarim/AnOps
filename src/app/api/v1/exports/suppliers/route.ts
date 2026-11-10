import { handleExport } from "@/server/exports/route-handler";
import { exportSuppliers } from "@/server/exports/reports";
import { supplierExportQuerySchema } from "@/features/exports/schemas/export.schema";

/** GET /api/v1/exports/suppliers: Excel export of the filtered result for the signed-in company. */
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleExport(request, "purchasing", "suppliers", supplierExportQuerySchema, exportSuppliers);
}
