import type { Metadata } from "next";
import { getFinanceService } from "@/server/services/finance.service";
import { PaymentManager } from "@/features/finance/components/payment-manager";
import { suggestPaymentMatches } from "@/features/finance/utils/insights";
import type { FinanceService } from "@/server/services/finance.service";

export const metadata: Metadata = {
  title: "Payments | Finance | AnOps ERP",
  description: "Track received payments and allocate funds to customer invoices.",
};

export default async function FinancePaymentsPage() {
  let payments: Awaited<ReturnType<FinanceService["listPayments"]>> = [];
  let unpaidInvoices: Awaited<ReturnType<FinanceService["listUnpaidInvoices"]>> = [];
  let canAllocate = false;

  try {
    const service = await getFinanceService();
    [payments, unpaidInvoices] = await Promise.all([
      service.listPayments(),
      service.listUnpaidInvoices(),
    ]);
    canAllocate = service.hasPermission("finance.payment.allocate");
  } catch {
    payments = [];
    unpaidInvoices = [];
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-text-primary)]">
          Payment Transactions
        </h1>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Record customer remittances and allocate funds against open receivables
        </p>
      </div>

      <PaymentManager
        payments={payments}
        unpaidInvoices={unpaidInvoices}
        canAllocate={canAllocate}
        suggestions={Object.fromEntries(payments.map((p) => [p.id, suggestPaymentMatches(p, unpaidInvoices)]))}
      />
    </div>
  );
}
