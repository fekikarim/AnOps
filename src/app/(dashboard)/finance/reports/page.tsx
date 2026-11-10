import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { getPageWorkspace } from "@/server/tenancy/workspace";
import { AGING_BUCKETS, getFinanceReports, reportQuerySchema } from "@/server/finance/reports.service";
import { fin } from "@/server/ai/tools/finance.tools";
import { buttonClass } from "@/shared/components/ui/button";
import { EmptyState } from "@/shared/components/data-display/empty-state";

export const metadata: Metadata = {
  title: "Finance Reports | AnOps ERP",
  description: "Receivables aging, expenses by category and monthly profit and loss.",
};

export default async function FinanceReportsPage({ searchParams }: { searchParams: Promise<{ currency?: string; year?: string }> }) {
  const ctx = await getPageWorkspace();
  const parsed = reportQuerySchema.safeParse(await searchParams);
  const query = parsed.success ? parsed.data : {};
  let report: Awaited<ReturnType<typeof getFinanceReports>> | null = null;
  let currencies: string[] = [];
  try {
    [report, currencies] = await Promise.all([getFinanceReports(ctx, query), fin(ctx).listActiveCurrencies()]);
  } catch {
    report = null;
  }
  if (!report) {
    return <EmptyState variant="error" title="Reports could not be loaded" description="Reload the page. If it keeps failing, check your access to Finance." actionHref="/finance/reports" actionLabel="Reload" />;
  }
  const r = report;
  const fmt = (n: number) => new Intl.NumberFormat("fr-TN", { style: "currency", currency: r.currency }).format(n || 0);
  const link = (over: { currency?: string; year?: number }) => `/finance/reports?currency=${over.currency ?? r.currency}&year=${over.year ?? r.year}`;
  const maxExpense = Math.max(...r.expensesByCategory.map((x) => x.total), 1);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-text-primary)]">Finance reports</h1>
          <p className="text-sm text-[var(--color-text-secondary)]">
            {r.year} · {r.currency} · cash basis (payments received vs approved or paid expenses)
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <nav aria-label="Year" className="flex items-center gap-1 text-sm">
            <Link className="rounded px-2 py-1 hover:bg-[var(--color-bg-subtle)]" href={link({ year: r.year - 1 })} aria-label="Previous year">‹ {r.year - 1}</Link>
            <span className="px-2 font-semibold text-[var(--color-text-primary)]">{r.year}</span>
            <Link className="rounded px-2 py-1 hover:bg-[var(--color-bg-subtle)]" href={link({ year: r.year + 1 })} aria-label="Next year">{r.year + 1} ›</Link>
          </nav>
          {currencies.length > 1 &&
            currencies.map((cur) => (
              <Link key={cur} href={link({ currency: cur })} aria-current={cur === r.currency ? "page" : undefined} className={cur === r.currency ? "rounded-full bg-[var(--color-action-primary)] px-3 py-1 text-xs font-semibold text-[var(--color-action-on-primary)]" : "rounded-full border border-[var(--color-border-subtle)] px-3 py-1 text-xs font-semibold text-[var(--color-text-secondary)]"}>
                {cur}
              </Link>
            ))}
          <a className={buttonClass("secondary")} href={`/api/v1/exports/finance-reports?currency=${r.currency}&year=${r.year}`}>
            <Download aria-hidden className="size-4 shrink-0" /> Excel
          </a>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["Income received", r.totals.income, "text-[var(--color-status-success)]"],
          ["Expenses", r.totals.expenses, "text-[var(--color-status-error)]"],
          ["Net", r.totals.net, r.totals.net >= 0 ? "text-[var(--color-status-success)]" : "text-[var(--color-status-error)]"],
          ["Open receivables", r.aging.total, "text-[var(--color-text-primary)]"],
        ].map(([label, value, cls]) => (
          <div key={label as string} className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4">
            <div className="text-xs font-semibold uppercase text-[var(--color-text-secondary)]">{label as string}</div>
            <div className={`mt-1 text-xl font-bold tabular-nums ${cls as string}`}>{fmt(value as number)}</div>
          </div>
        ))}
      </div>

      <section aria-labelledby="aging-h" className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
        <h2 id="aging-h" className="border-b border-[var(--color-border-subtle)] p-4 text-base font-semibold text-[var(--color-text-primary)]">Receivables aging (today)</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-[var(--color-bg-subtle)]/60 text-[var(--color-text-secondary)]">
              <tr>
                <th className="p-3 text-left font-medium">Customer</th>
                {AGING_BUCKETS.map((b) => <th key={b} className="p-3 text-right font-medium">{b}</th>)}
                <th className="p-3 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border-subtle)] tabular-nums">
              {r.aging.rows.length === 0 ? (
                <tr><td colSpan={7} className="p-6 text-center text-[var(--color-text-secondary)]">Nothing is owed to you in {r.currency}.</td></tr>
              ) : (
                [...r.aging.rows, { customer: "Total", buckets: r.aging.buckets, total: r.aging.total }].map((row) => (
                  <tr key={row.customer} className={row.customer === "Total" ? "font-semibold" : undefined}>
                    <td className="p-3 text-[var(--color-text-primary)]">{row.customer}</td>
                    {row.buckets.map((v, k) => <td key={k} className={`p-3 text-right ${k >= 2 && v > 0 ? "text-[var(--color-status-error)]" : "text-[var(--color-text-primary)]"}`}>{v ? fmt(v) : "—"}</td>)}
                    <td className="p-3 text-right text-[var(--color-text-primary)]">{fmt(row.total)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="cat-h" className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 space-y-3">
          <h2 id="cat-h" className="text-base font-semibold text-[var(--color-text-primary)]">Expenses by category</h2>
          {r.expensesByCategory.length === 0 ? (
            <p className="text-sm text-[var(--color-text-secondary)]">No approved or paid expenses in {r.year}.</p>
          ) : (
            <ul className="space-y-2.5">
              {r.expensesByCategory.map((x) => (
                <li key={x.category}>
                  <div className="flex justify-between gap-2 text-sm">
                    <span className="truncate text-[var(--color-text-primary)]">{x.category} <span className="text-xs text-[var(--color-text-secondary)]">· {x.count}</span></span>
                    <span className="shrink-0 tabular-nums text-[var(--color-text-primary)]">{fmt(x.total)} <span className="text-xs text-[var(--color-text-secondary)]">({x.share}%)</span></span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-[var(--color-bg-subtle)]">
                    <div className="h-1.5 rounded-full bg-[var(--color-action-primary)]" style={{ width: `${(x.total / maxExpense) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="pnl-h" className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
          <h2 id="pnl-h" className="border-b border-[var(--color-border-subtle)] p-4 text-base font-semibold text-[var(--color-text-primary)]">Monthly profit and loss</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead className="bg-[var(--color-bg-subtle)]/60 text-[var(--color-text-secondary)]">
                <tr><th className="p-2.5 text-left font-medium">Month</th><th className="p-2.5 text-right font-medium">Income</th><th className="p-2.5 text-right font-medium">Expenses</th><th className="p-2.5 text-right font-medium">Net</th></tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border-subtle)]">
                {r.pnl.map((m) => (
                  <tr key={m.month} className={m.income === 0 && m.expenses === 0 ? "text-[var(--color-text-secondary)]" : "text-[var(--color-text-primary)]"}>
                    <td className="p-2.5">{new Date(`${m.month}-01T12:00:00Z`).toLocaleString("en", { month: "short" })}</td>
                    <td className="p-2.5 text-right">{m.income ? fmt(m.income) : "—"}</td>
                    <td className="p-2.5 text-right">{m.expenses ? fmt(m.expenses) : "—"}</td>
                    <td className={`p-2.5 text-right ${m.net < 0 ? "text-[var(--color-status-error)]" : ""}`}>{m.net ? fmt(m.net) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
