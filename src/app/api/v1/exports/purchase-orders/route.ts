import { handleExport } from "@/server/exports/route-handler";
import { exportPurchaseOrders } from "@/server/exports/reports";
import { purchaseOrderExportQuerySchema } from "@/features/exports/schemas/export.schema";

/** GET /api/v1/exports/purchase-orders: Excel export of the filtered result for the signed-in company. */
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleExport(request, "purchasing", "purchase-orders", purchaseOrderExportQuerySchema, exportPurchaseOrders);
}
