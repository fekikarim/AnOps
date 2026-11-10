import { handleExport } from "@/server/exports/route-handler";
import { exportFinanceReports, reportQuerySchema } from "@/server/finance/reports.service";

/** GET /api/v1/exports/finance-reports?currency=TND&year=2026: aging, expenses by category and monthly P&L as Excel. */
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleExport(request, "finance", "finance-reports", reportQuerySchema, exportFinanceReports);
}
