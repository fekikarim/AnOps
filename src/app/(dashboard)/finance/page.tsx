import type { Metadata } from "next";
import { getFinanceService } from "@/server/services/finance.service";
import Link from "next/link";
import {
  IconUsers,
  IconReceipt,
  IconWallet,
  IconDocument,
  IconPackage,
  IconCheck,
  IconBarChart,
} from "@/shared/components/ui/brand-icons";
import { FinancialChart } from "@/features/finance/components/financial-chart";
import { FinanceInsightsPanel } from "@/features/finance/components/finance-insights-panel";
import { forecastCashFlow } from "@/features/finance/utils/insights";
import { todayTunis } from "@/server/ai/finance/money";

export const metadata: Metadata = {
  title: "Finance & Invoicing Dashboard | AnOps ERP",
  description: "Executive financial summary: income vs expenses, receivables balance, and overdue invoice tracking.",
};

export default async function FinancePage({ searchParams }: { searchParams: Promise<{ currency?: string }> }) {
  const { currency: requestedCurrency } = await searchParams;
  let currencies: string[] = [];
  let openInvoices: Array<{ balance: number; dueDate?: string; currency: string }> = [];
  let kpi = {
    totalInvoiced: 0,
    totalPaid: 0,
    outstanding: 0,
    overdue: 0,
    overdueCount: 0,
    topOverdueInvoices: [] as Array<{
      id: string;
      invoiceNumber: string;
      customerName: string;
      dueDate: string;
      balance: number;
      currency: string;
    }>,
    expensesDraft: 0,
    expensesSubmitted: 0,
    expensesApproved: 0,
    expensesPaid: 0,
    totalExpensesAmount: 0,
    totalExpensesPaidAmount: 0,
    netCashFlow: 0,
    monthlySummary: [] as Array<{
      monthKey: string;
      label: string;
      income: number;
      expenses: number;
      net: number;
    }>,
    currency: "TND",
  };

  try {
    const service = await getFinanceService();
    [kpi, currencies, openInvoices] = await Promise.all([service.getDashboard(requestedCurrency?.toUpperCase()), service.listActiveCurrencies(), service.listUnpaidInvoices()]);
  } catch (err) {
    if ((err as { digest?: string })?.digest !== "DYNAMIC_SERVER_USAGE") {
      console.error("[FinancePage] Dashboard error:", err);
    }
  }

  const fmt = (n: number) =>
    new Intl.NumberFormat("fr-TN", { style: "currency", currency: kpi.currency }).format(n || 0);

  const collectionRate =
    kpi.totalInvoiced > 0
      ? Math.min(100, Math.round((kpi.totalPaid / kpi.totalInvoiced) * 100))
      : 0;

  const quickLinks = [
    { name: "Customers", href: "/finance/customers", icon: IconUsers, desc: "Customer profiles & contact records" },
    { name: "Invoices", href: "/finance/invoices", icon: IconReceipt, desc: "Sales billing, vector PDF & posting" },
    { name: "Payments", href: "/finance/payments", icon: IconWallet, desc: "Reconciliation & invoice allocation" },
    { name: "Expenses", href: "/finance/expenses", icon: IconDocument, desc: "Operational spend & approval workflow" },
    { name: "Receipts (OCR)", href: "/finance/receipts", icon: IconPackage, desc: "AI document scanning & conversion" },
    { name: "Reports", href: "/finance/reports", icon: IconBarChart, desc: "Aging, expenses by category, monthly P&L, Excel" },
  ];

  return (
    <div className="space-y-8">
      {/* Top Header & Quick Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-text-primary)]">
            Finance & Invoicing Dashboard
          </h1>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Cash management, receivable aging, expense approvals, and real-time ledger health
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/finance/invoices/new"
            className="px-3.5 py-2 text-xs font-semibold rounded-[var(--radius-control)] bg-[var(--color-action-primary)] text-white hover:opacity-95 shadow-sm transition-all"
          >
            + Create Invoice
          </Link>
          <Link
            href="/finance/expenses/new"
            className="px-3.5 py-2 text-xs font-semibold rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] hover:bg-[var(--color-bg-subtle)] text-[var(--color-text-primary)] transition-all"
          >
            + Record Expense
          </Link>
          <Link
            href="/finance/receipts"
            className="px-3.5 py-2 text-xs font-semibold rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] hover:bg-[var(--color-bg-subtle)] text-[var(--color-text-primary)] transition-all"
          >
            Scan Receipt
          </Link>
          <Link
            href="/finance/payments"
            className="px-3.5 py-2 text-xs font-semibold rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] hover:bg-[var(--color-bg-subtle)] text-[var(--color-text-primary)] transition-all"
          >
            Record Payment
          </Link>
        </div>
      </div>

      {currencies.length > 1 && (
        <nav aria-label="Dashboard currency" className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-[var(--color-text-secondary)]">Currency:</span>
          {currencies.map((c) => (
            <Link
              key={c}
              href={`/finance?currency=${c}`}
              aria-current={c === kpi.currency ? "page" : undefined}
              className={
                c === kpi.currency
                  ? "px-2.5 py-1 rounded-[var(--radius-control)] font-semibold bg-[var(--color-action-primary)] text-white"
                  : "px-2.5 py-1 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-subtle)]"
              }
            >
              {c}
            </Link>
          ))}
          <span className="text-[var(--color-text-secondary)]">Amounts in different currencies are never added together.</span>
        </nav>
      )}

      {/* Primary KPI Balance Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Net Cash Flow */}
        <div className="p-5 bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-[var(--radius-card)] shadow-sm space-y-1">
          <div className="flex items-center justify-between text-xs font-medium text-[var(--color-text-secondary)]">
            <span>Net Cash Flow</span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                kpi.netCashFlow >= 0
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-rose-500/10 text-rose-600 dark:text-rose-400"
              }`}
            >
              {kpi.netCashFlow >= 0 ? "Surplus" : "Deficit"}
            </span>
          </div>
          <div
            className={`text-2xl font-bold tracking-tight ${
              kpi.netCashFlow >= 0
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-rose-600 dark:text-rose-400"
            }`}
          >
            {fmt(kpi.netCashFlow)}
          </div>
          <p className="text-[11px] text-[var(--color-text-secondary)] pt-1">
            Settled collections ({fmt(kpi.totalPaid)}) minus paid expenses ({fmt(kpi.totalExpensesPaidAmount)})
          </p>
        </div>

        {/* Total Invoiced & Collection Rate */}
        <div className="p-5 bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-[var(--radius-card)] shadow-sm space-y-1">
          <div className="flex items-center justify-between text-xs font-medium text-[var(--color-text-secondary)]">
            <span>Total Invoiced</span>
            <span className="text-[10px] font-semibold text-[var(--color-action-primary)]">
              {collectionRate}% collected
            </span>
          </div>
          <div className="text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">
            {fmt(kpi.totalInvoiced)}
          </div>
          <div className="w-full bg-[var(--color-bg-subtle)] h-1.5 rounded-full mt-2 overflow-hidden">
            <div
              style={{ width: `${collectionRate}%` }}
              className="bg-[var(--color-action-primary)] h-full rounded-full transition-all duration-500"
            />
          </div>
        </div>

        {/* Outstanding Receivables */}
        <div className="p-5 bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-[var(--radius-card)] shadow-sm space-y-1">
          <div className="text-xs font-medium text-[var(--color-text-secondary)]">
            Outstanding Receivables
          </div>
          <div className="text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">
            {fmt(kpi.outstanding)}
          </div>
          <p className="text-[11px] text-[var(--color-text-secondary)] pt-1">
            Open customer balances awaiting settlement
          </p>
        </div>

        {/* Overdue Invoices */}
        <div
          className={`p-5 rounded-[var(--radius-card)] border shadow-sm space-y-1 ${
            kpi.overdueCount > 0
              ? "bg-rose-500/5 border-rose-500/30 dark:bg-rose-500/10"
              : "bg-[var(--color-bg-surface)] border-[var(--color-border-subtle)]"
          }`}
        >
          <div className="flex items-center justify-between text-xs font-medium text-[var(--color-text-secondary)]">
            <span>Overdue Receivables</span>
            {kpi.overdueCount > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500 text-white">
                {kpi.overdueCount} Past Due
              </span>
            )}
          </div>
          <div
            className={`text-2xl font-bold tracking-tight ${
              kpi.overdueCount > 0 ? "text-rose-600 dark:text-rose-400" : "text-[var(--color-text-primary)]"
            }`}
          >
            {fmt(kpi.overdue)}
          </div>
          <p className="text-[11px] text-[var(--color-text-secondary)] pt-1">
            {kpi.overdueCount > 0
              ? "Invoices past their payment due date"
              : "All invoices are in good standing"}
          </p>
        </div>
      </div>

      {/* Visual Chart: Income vs Expenses over Time */}
      <FinancialChart monthlySummary={kpi.monthlySummary} currency={kpi.currency} />

      {(() => {
        // The current month is still running, so the expense average uses the months before it.
        const f = forecastCashFlow({ today: todayTunis(), openInvoices: openInvoices.filter((i) => i.currency === kpi.currency), monthlyExpenses: kpi.monthlySummary.slice(0, -1).map((m) => m.expenses) });
        return <FinanceInsightsPanel currency={kpi.currency} forecast={f.windows} overdueIncluded={f.overdueIncluded} avgMonthlyExpenses={f.avgMonthlyExpenses} />;
      })()}

      {/* Overdue Invoices Alert Table */}
      {kpi.overdueCount > 0 ? (
        <div className="rounded-[var(--radius-card)] border border-rose-500/30 bg-[var(--color-bg-surface)] overflow-hidden shadow-sm">
          <div className="p-4 bg-rose-500/5 border-b border-rose-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-rose-600 dark:text-rose-400">
                Action Required: {kpi.overdueCount} Overdue Invoices ({fmt(kpi.overdue)})
              </h3>
              <p className="text-xs text-[var(--color-text-secondary)]">
                The following customer invoices have surpassed their agreed payment terms
              </p>
            </div>
            <Link
              href="/finance/invoices?status=posted"
              className="text-xs font-medium text-rose-600 hover:underline"
            >
              View all open invoices →
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[var(--color-bg-subtle)]/50 text-[var(--color-text-secondary)] border-b border-[var(--color-border-subtle)]">
                <tr>
                  <th className="p-3 font-medium">Invoice #</th>
                  <th className="p-3 font-medium">Customer</th>
                  <th className="p-3 font-medium">Due Date</th>
                  <th className="p-3 font-medium text-right">Overdue Balance</th>
                  <th className="p-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border-subtle)]">
                {kpi.topOverdueInvoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-rose-500/5 transition-colors">
                    <td className="p-3 font-semibold text-[var(--color-text-primary)]">
                      <Link href={`/finance/invoices/${inv.id}`} className="hover:underline text-[var(--color-action-primary)]">
                        {inv.invoiceNumber}
                      </Link>
                    </td>
                    <td className="p-3 font-medium text-[var(--color-text-primary)]">
                      {inv.customerName}
                    </td>
                    <td className="p-3 text-rose-600 dark:text-rose-400 font-medium">
                      {inv.dueDate}
                    </td>
                    <td className="p-3 text-right font-bold text-rose-600 dark:text-rose-400">
                      {fmt(inv.balance)}
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/finance/invoices/${inv.id}`}
                          className="px-2.5 py-1 rounded bg-[var(--color-bg-subtle)] hover:bg-[var(--color-border-subtle)] text-[var(--color-text-primary)] font-medium"
                        >
                          View / Print
                        </Link>
                        <Link
                          href="/finance/payments"
                          className="px-2.5 py-1 rounded bg-[var(--color-action-primary)] text-white hover:opacity-90 font-medium"
                        >
                          Record Payment
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 flex items-center gap-3">
          <div className="p-2 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <IconCheck size={18} />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">
              No Overdue Invoices
            </h4>
            <p className="text-xs text-[var(--color-text-secondary)]">
              Great news! All customer invoices are either settled or within their scheduled payment terms.
            </p>
          </div>
        </div>
      )}

      {/* Expense Pipeline Lifecycle */}
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
              Expense Approval & Reimbursement Pipeline
            </h2>
            <p className="text-xs text-[var(--color-text-secondary)]">
              Real-time audit trail of operational expenditures across review stages
            </p>
          </div>
          <Link
            href="/finance/expenses"
            className="text-xs font-semibold text-[var(--color-action-primary)] hover:underline"
          >
            Manage Expenses →
          </Link>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Link
            href="/finance/expenses"
            className="p-4 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)]/30 hover:bg-[var(--color-bg-subtle)] transition-colors"
          >
            <div className="text-xs text-[var(--color-text-secondary)]">Draft (Unsubmitted)</div>
            <div className="text-xl font-bold text-[var(--color-text-primary)] mt-1">
              {kpi.expensesDraft}
            </div>
            <div className="text-[11px] text-[var(--color-text-secondary)] mt-1">Pending employee completion</div>
          </Link>

          <Link
            href="/finance/expenses"
            className="p-4 rounded-[var(--radius-control)] border border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10 transition-colors"
          >
            <div className="text-xs font-medium text-amber-600 dark:text-amber-400">
              Submitted (Needs Approval)
            </div>
            <div className="text-xl font-bold text-amber-600 dark:text-amber-400 mt-1">
              {kpi.expensesSubmitted}
            </div>
            <div className="text-[11px] text-[var(--color-text-secondary)] mt-1">Ready for manager sign-off</div>
          </Link>

          <Link
            href="/finance/expenses"
            className="p-4 rounded-[var(--radius-control)] border border-blue-500/30 bg-blue-500/5 hover:bg-blue-500/10 transition-colors"
          >
            <div className="text-xs font-medium text-blue-600 dark:text-blue-400">
              Approved (Awaiting Payout)
            </div>
            <div className="text-xl font-bold text-blue-600 dark:text-blue-400 mt-1">
              {kpi.expensesApproved}
            </div>
            <div className="text-[11px] text-[var(--color-text-secondary)] mt-1">Signed off by management</div>
          </Link>

          <Link
            href="/finance/expenses"
            className="p-4 rounded-[var(--radius-control)] border border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10 transition-colors"
          >
            <div className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
              Paid & Reconciled
            </div>
            <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
              {kpi.expensesPaid}
            </div>
            <div className="text-[11px] text-[var(--color-text-secondary)] mt-1">Disbursed to employees/vendors</div>
          </Link>
        </div>
      </div>

      {/* Quick Access to Module Sub-pages */}
      <div className="space-y-3">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
          Financial Management Modules
        </h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {quickLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="p-4 bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-[var(--radius-card)] hover:bg-[var(--color-bg-subtle)] hover:border-[var(--color-action-primary)]/40 transition-all group shadow-sm"
            >
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-[var(--color-action-primary)]/10 group-hover:bg-[var(--color-action-primary)] group-hover:text-white transition-colors text-[var(--color-action-primary)]">
                  <link.icon size={22} />
                </div>
                <div>
                  <div className="font-semibold text-sm text-[var(--color-text-primary)] group-hover:text-[var(--color-action-primary)] transition-colors">
                    {link.name}
                  </div>
                  <div className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                    {link.desc}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
