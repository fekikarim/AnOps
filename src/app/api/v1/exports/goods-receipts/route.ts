import { handleExport } from "@/server/exports/route-handler";
import { exportGoodsReceipts } from "@/server/exports/reports";
import { goodsReceiptExportQuerySchema } from "@/features/exports/schemas/export.schema";

/** GET /api/v1/exports/goods-receipts: Excel export of the filtered result for the signed-in company. */
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleExport(request, "purchasing", "goods-receipts", goodsReceiptExportQuerySchema, exportGoodsReceipts);
}
