import type { Metadata } from "next";
import { getFinanceService } from "@/server/services/finance.service";
import { InvoiceBuilderForm } from "@/features/finance/components/invoice-builder-form";
import Link from "next/link";
import type { FinanceService } from "@/server/services/finance.service";

export const metadata: Metadata = {
  title: "New Invoice | Finance | AnOps ERP",
  description: "Create customer invoice draft tied to products and customers.",
};

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>;
}) {
  const { customerId } = await searchParams;

  let customers: Awaited<ReturnType<FinanceService["listCustomers"]>> = [];
  let products: Awaited<ReturnType<FinanceService["listInvoiceableProducts"]>> = [];

  try {
    const service = await getFinanceService();
    [customers, products] = await Promise.all([
      service.listCustomers(),
      service.listInvoiceableProducts(),
    ]);
  } catch {
    customers = [];
    products = [];
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-[var(--color-text-secondary)] mb-1">
            <Link href="/finance/invoices" className="hover:underline">
              ← Back to Invoices
            </Link>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-text-primary)]">
            Create Customer Invoice
          </h1>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Draft a new customer invoice with product line items, VAT calculations, and terms
          </p>
        </div>
      </div>

      <InvoiceBuilderForm
        customers={customers}
        products={products}
        preselectedCustomerId={customerId}
      />
    </div>
  );
}
