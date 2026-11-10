import type { Metadata } from "next";
import { PaymentForm } from "@/features/finance/components/payment-form";

export const metadata: Metadata = { title: "Record payment | Finance | AnOps ERP" };

export default function NewPaymentPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-text-primary)]">Record payment</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">Record an incoming payment, then match it to the invoices it settles.</p>
      </div>
      <PaymentForm />
    </div>
  );
}
