import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getFinanceService } from "@/server/services/finance.service";
import { InvoiceBuilderForm, type InvoiceDraftValues } from "@/features/finance/components/invoice-builder-form";

export const metadata: Metadata = {
  title: "Edit Invoice | Finance | AnOps ERP",
  description: "Edit a draft customer invoice before posting it.",
};

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = await getFinanceService().catch(() => null);
  if (!service) notFound();

  const invoice = await service.getInvoice(id).catch(() => null);
  if (!invoice) notFound();
  // Posted invoices are immutable; send people back to the read-only view.
  if (invoice.status !== "draft" || !service.hasPermission("finance.invoice.manage")) redirect(`/finance/invoices/${id}`);

  const [customers, products] = await Promise.all([service.listCustomers(), service.listInvoiceableProducts()]);
  const initialInvoice: InvoiceDraftValues = {
    id: invoice.id,
    customerId: invoice.customerId ?? "",
    currency: invoice.currency,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    notes: invoice.notes,
    terms: invoice.terms,
    stampDuty: invoice.stampDuty > 0,
    lines: invoice.lines.map((l: { productId?: string; description: string; quantity: number; unitPrice: number; taxRate: number }) => ({
      productId: l.productId,
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      taxRate: l.taxRate,
    })),
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs text-[var(--color-text-secondary)] mb-1">
          <Link href={`/finance/invoices/${id}`} className="hover:underline">
            ← Back to {invoice.invoiceNumber}
          </Link>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-text-primary)]">Edit Draft {invoice.invoiceNumber}</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">Drafts can be changed freely until they are posted.</p>
      </div>
      <InvoiceBuilderForm customers={customers} products={products} initialInvoice={initialInvoice} />
    </div>
  );
}
