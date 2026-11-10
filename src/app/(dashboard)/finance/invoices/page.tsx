import type { Metadata } from "next";
import { getFinanceService } from "@/server/services/finance.service";
import Link from "next/link";
import { ButtonLink } from "@/shared/components/ui/button";
import { StatusBadge, type BadgeTone } from "@/shared/components/data-display/status-badge";
import { IconReceipt } from "@/shared/components/ui/brand-icons";
import { InvoiceExportButton } from "@/features/finance/components/invoice-export-button";

export const metadata: Metadata = {
  title: "Invoices | Finance | AnOps ERP",
  description: "Create, view, and track customer invoices.",
};

function statusTone(status: string): BadgeTone {
  switch (status) {
    case "paid":
      return "success";
    case "partially_paid":
      return "warning";
    case "overdue":
    case "voided":
      return "error";
    case "posted":
    case "credited":
      return "info";
    default:
      return "neutral";
  }
}

const FILTERS = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "overdue", label: "Overdue" },
  { key: "draft", label: "Drafts" },
  { key: "paid", label: "Paid" },
  { key: "credited", label: "Credited" },
  { key: "voided", label: "Voided" },
] as const;

export default async function FinanceInvoicesPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const params = await searchParams;
  const q = (params.q ?? "").slice(0, 80);
  const status = FILTERS.some((f) => f.key === params.status) ? (params.status as string) : "all";
  let result: Awaited<ReturnType<Awaited<ReturnType<typeof getFinanceService>>["searchInvoices"]>> = { rows: [], total: 0, page: 1, pageSize: 25, totalPages: 1 };
  try {
    const service = await getFinanceService();
    result = await service.searchInvoices({ q, status, page: Number(params.page) || 1 });
  } catch {
    // Keeps the empty result; the page still renders with its filters.
  }
  const invoices = result.rows;
  const filtered = q !== "" || status !== "all";
  const href = (over: Record<string, string | number | undefined>) => {
    const sp = new URLSearchParams();
    const merged = { q, status, page: result.page, ...over };
    if (merged.q) sp.set("q", String(merged.q));
    if (merged.status && merged.status !== "all") sp.set("status", String(merged.status));
    if (merged.page && Number(merged.page) > 1) sp.set("page", String(merged.page));
    const qs = sp.toString();
    return `/finance/invoices${qs ? `?${qs}` : ""}`;
  };

  const fmt = (n: number, c: string) =>
    new Intl.NumberFormat("fr-TN", { style: "currency", currency: c || "TND" }).format(n || 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-text-primary)]">
            Customer Invoices
          </h1>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Create, issue, and reconcile billing documents tied to customer accounts
          </p>
        </div>
        <div className="flex items-center gap-2">
          {result.total > 0 && <InvoiceExportButton />}
          <ButtonLink href="/finance/invoices/new" variant="primary">
            + New Invoice
          </ButtonLink>
        </div>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <form action="/finance/invoices" className="flex w-full max-w-md gap-2" role="search">
          {status !== "all" && <input type="hidden" name="status" value={status} />}
          <label htmlFor="invoice-search" className="sr-only">Search invoices</label>
          <input id="invoice-search" name="q" defaultValue={q} placeholder="Search by invoice number or customer" className="min-h-[44px] w-full rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3 text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-[3px] focus:ring-[var(--color-focus-ring)]" />
          <button type="submit" className="min-h-[44px] shrink-0 rounded-[var(--radius-control)] border border-[var(--color-border-control)] px-4 text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-bg-subtle)] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)]">Search</button>
        </form>
        <nav aria-label="Filter invoices by status" className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={href({ status: f.key, page: 1 })}
              aria-current={status === f.key ? "page" : undefined}
              className={status === f.key ? "rounded-full bg-[var(--color-action-primary)] px-3 py-1 text-xs font-semibold text-[var(--color-action-on-primary)]" : "rounded-full border border-[var(--color-border-subtle)] px-3 py-1 text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)]"}
            >
              {f.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)]/50 text-[var(--color-text-secondary)] font-medium">
                <th className="py-3 px-4">Invoice #</th>
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Issue Date</th>
                <th className="py-3 px-4">Due Date</th>
                <th className="py-3 px-4 text-right">Total</th>
                <th className="py-3 px-4 text-right">Paid</th>
                <th className="py-3 px-4 text-right">Balance</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border-subtle)]">
              {invoices.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-[var(--color-text-secondary)]">
                    {filtered ? (
                      <div className="space-y-3">
                        <div className="font-medium text-[var(--color-text-primary)]">No invoices match</div>
                        <p className="text-xs">Try another search or status.</p>
                        <ButtonLink href="/finance/invoices">Clear filters</ButtonLink>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <IconReceipt size={32} className="mx-auto text-[var(--color-text-secondary)] opacity-50" />
                        <div className="font-medium text-[var(--color-text-primary)]">No invoices issued yet</div>
                        <p className="text-xs">Create your first invoice to bill customers for products or services.</p>
                        <ButtonLink href="/finance/invoices/new" variant="primary">
                          Create Invoice
                        </ButtonLink>
                      </div>
                    )}
                  </td>
                </tr>
              ) : (
                invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-[var(--color-bg-subtle)]/40 transition-colors">
                    <td className="py-3 px-4 font-mono font-medium text-[var(--color-text-primary)]">
                      <Link
                        href={`/finance/invoices/${inv.id}`}
                        className="text-[var(--color-action-primary)] hover:underline font-semibold"
                      >
                        {inv.invoiceNumber}
                      </Link>
                    </td>
                    <td className="py-3 px-4 text-[var(--color-text-primary)]">
                      {inv.customer?.name ? (
                        <div>
                          <div className="font-medium">{inv.customer.name}</div>
                          {inv.customer.email && (
                            <div className="text-xs text-[var(--color-text-secondary)]">
                              {inv.customer.email}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-[var(--color-text-secondary)] text-xs">Direct Customer</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <StatusBadge label={inv.isOverdue ? "overdue" : inv.status.replace("_", " ")} tone={statusTone(inv.isOverdue ? "overdue" : inv.status)} />
                    </td>
                    <td className="py-3 px-4 text-[var(--color-text-primary)] text-xs">{inv.issueDate}</td>
                    <td className="py-3 px-4 text-[var(--color-text-secondary)] text-xs">
                      {inv.dueDate || "—"}
                    </td>
                    <td className="py-3 px-4 text-right font-medium text-[var(--color-text-primary)]">
                      {fmt(inv.total, inv.currency)}
                    </td>
                    <td className="py-3 px-4 text-right text-[var(--color-status-success)]">
                      {fmt(inv.amountPaid, inv.currency)}
                    </td>
                    <td className="py-3 px-4 text-right font-semibold text-[var(--color-text-primary)]">
                      {fmt(inv.balance, inv.currency)}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <Link
                        href={`/finance/invoices/${inv.id}`}
                        className="inline-flex items-center gap-1 text-xs text-[var(--color-action-primary)] hover:underline font-medium px-2 py-1 rounded hover:bg-[var(--color-action-primary)]/10"
                      >
                        View & PDF →
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {result.total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border-subtle)] px-4 py-3 text-xs text-[var(--color-text-secondary)]">
            <span>
              {(result.page - 1) * result.pageSize + 1}–{Math.min(result.page * result.pageSize, result.total)} of {result.total}
            </span>
            <div className="flex gap-2">
              {result.page > 1 && <Link href={href({ page: result.page - 1 })} className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] px-3 py-1.5 font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-bg-subtle)]">Previous</Link>}
              {result.page < result.totalPages && <Link href={href({ page: result.page + 1 })} className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] px-3 py-1.5 font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-bg-subtle)]">Next</Link>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
