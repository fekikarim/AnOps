import { FinanceCopilot } from "@/features/finance/components/finance-copilot";
import { requireAppAccess } from "@/server/platform/access";

/** Every Finance page gets the Finance Copilot button. */
export default async function FinanceLayout({ children }: { children: React.ReactNode }) {
  const access = await requireAppAccess("finance");
  return (
    <>
      {children}
      {/* The floating Copilot button covers the bottom-right corner, so give the page room to scroll clear of it. */}
      {access.entitlements.aiFeatures && <div aria-hidden="true" className="h-20 print:hidden" />}
      {access.entitlements.aiFeatures && <FinanceCopilot />}
    </>
  );
}
