import { getPageOrgAccess } from "@/server/platform/access";
import type { Metadata } from "next";
import { getFinanceService } from "@/server/services/finance.service";
import { ReceiptScanner, type ReceiptItem } from "@/features/finance/components/receipt-scanner";
import { EmptyState } from "@/shared/components/data-display/empty-state";
import { TelegramReceiptsCard } from "@/features/finance/components/telegram-receipts-card";
import { resolveWorkspace } from "@/server/tenancy/workspace";
import { getStaffTelegramStatus, type StaffTelegramStatus } from "@/server/finance/telegram-receipts.service";

export const metadata: Metadata = {
  title: "Receipt OCR & Extraction | Finance | AnOps ERP",
  description: "Scan receipts using AI, review extracted merchant/amounts, and convert into official expense claims.",
};

export default async function FinanceReceiptsPage() {
  let receipts: ReceiptItem[] = [];
  let categories: Array<{ id: string; name: string; active: boolean }> = [];
  let canScan = false;
  let canCreateExpense = false;
  let failed = false;
  let telegram: StaffTelegramStatus = { botConfigured: false, linked: false, username: null, linkedAt: null };
  try {
    const service = await getFinanceService();
    [receipts, categories] = await Promise.all([service.listReceiptExtractions(), service.listExpenseCategories()]);
    // Receipt scanning is an AI feature (vision model): only offered when the plan includes AI features.
    canScan = service.hasPermission("finance.receipt.ocr") && (await getPageOrgAccess()).entitlements.aiFeatures;
    canCreateExpense = service.hasPermission("finance.expense.manage");
    telegram = await getStaffTelegramStatus(await resolveWorkspace());
  } catch (e) {
    if ((e as { digest?: string })?.digest === "DYNAMIC_SERVER_USAGE") throw e;
    console.error("[FinanceReceiptsPage] load failed", e instanceof Error ? e.name : "unknown");
    failed = true;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-text-primary)]">Receipt Scanner</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">Photograph or upload a receipt; the AI fills in the expense for you to check.</p>
      </div>
      {failed ? (
        <EmptyState variant="error" title="Receipts could not be loaded" description="Reload the page. If it keeps failing, check your access to Finance." actionHref="/finance/receipts" actionLabel="Reload" />
      ) : (
        <>
          <TelegramReceiptsCard status={telegram} canCapture={canScan && canCreateExpense} />
          <ReceiptScanner initialReceipts={receipts} categories={categories.filter((c) => c.active)} canScan={canScan} canCreateExpense={canCreateExpense} />
        </>
      )}
    </div>
  );
}
