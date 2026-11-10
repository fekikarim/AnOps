import "server-only";
import { z } from "zod";
import { defineTool } from "@/server/ai/tools/define-tool";
import { fin } from "@/server/ai/tools/finance.tools";
import { todayTunis } from "@/server/ai/finance/money";
import { PERMISSIONS } from "@/server/security/permissions";
import { CURRENCIES } from "@/server/ai/finance/money";
import { computeExpenseFlags, forecastCashFlow, suggestPaymentMatches } from "@/features/finance/utils/insights";
import { AppError } from "@/shared/lib/errors";
import type { AiRecordCardPart, AiRecordTablePart } from "@/server/db/documents";

/**
 * Finance Copilot read tools. They reuse the exact functions behind the Finance screens
 * (src/features/finance/utils/insights.ts), so the Copilot and the pages never disagree about a figure.
 */

const R = PERMISSIONS.FINANCE_READ;
const money = (n: number, c: string) => `${n.toFixed(2)} ${c}`;
const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

export const cashflowForecastTool = defineTool({
  name: "finance_cashflow_forecast",
  module: "finance",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "Cash-flow forecast for the next 30, 60 and 90 days in one currency (default: company currency): expected money in from open invoices by due date (overdue counted in), money out from the average monthly expenses of the last 3 full months. Same figures as the Finance dashboard.",
  input: z.object({ currency: z.enum(CURRENCIES).optional() }).strict(),
  async run(ctx, input) {
    const svc = fin(ctx);
    const d = await svc.getDashboard(input.currency);
    const open = (await svc.listUnpaidInvoices()).filter((i) => i.currency === d.currency);
    const f = forecastCashFlow({ today: todayTunis(), openInvoices: open, monthlyExpenses: d.monthlySummary.slice(0, -1).map((m) => m.expenses) });
    const card: AiRecordCardPart = {
      type: "record_card",
      title: `Cash-flow forecast (${d.currency})`,
      subtitle: `In: open invoices by due date${f.overdueIncluded ? ` + ${money(f.overdueIncluded, d.currency)} overdue` : ""}. Out: ${money(f.avgMonthlyExpenses, d.currency)} a month on average.`,
      fields: f.windows.map((w) => ({ label: `Next ${w.days} days`, value: `${w.net >= 0 ? "+" : ""}${money(w.net, d.currency)}` })),
      sections: [{ title: "Detail", rows: f.windows.map((w) => ({ label: `${w.days} days`, value: `in ${w.expectedIn.toFixed(2)} · out ${w.expectedOut.toFixed(2)}` })) }],
    };
    return { summary: `Forecast in ${d.currency}`, parts: [card], data: { currency: d.currency, windows: f.windows, overdueIncluded: f.overdueIncluded, avgMonthlyExpenses: f.avgMonthlyExpenses } };
  },
});

export const agingReportTool = defineTool({
  name: "finance_aging_report",
  module: "finance",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "Accounts-receivable aging: open invoice balances grouped as not yet due, 1-30, 31-60, 61-90 and over 90 days overdue, per currency, with the customers who owe the most.",
  input: z.object({}).strict(),
  async run(ctx) {
    const today = todayTunis();
    const open = await fin(ctx).listUnpaidInvoices();
    const buckets = ["Not yet due", "1-30 days", "31-60 days", "61-90 days", "Over 90 days"] as const;
    const table = new Map<string, number[]>();
    const owed = new Map<string, number>();
    for (const i of open) {
      const late = i.dueDate ? days(i.dueDate, today) : 0;
      const b = late <= 0 ? 0 : late <= 30 ? 1 : late <= 60 ? 2 : late <= 90 ? 3 : 4;
      const row = table.get(i.currency) ?? [0, 0, 0, 0, 0];
      row[b] += Math.round(i.balance * 100);
      table.set(i.currency, row);
      const key = `${i.customerName ?? "Direct customer"}|${i.currency}`;
      owed.set(key, (owed.get(key) ?? 0) + Math.round(i.balance * 100));
    }
    const part: AiRecordTablePart = {
      type: "record_table",
      title: "Receivables aging",
      columns: [{ key: "currency", label: "Currency" }, ...buckets.map((b, k) => ({ key: `b${k}`, label: b, align: "right" as const }))],
      rows: [...table].map(([currency, row]) => ({ id: currency, cells: { currency, ...Object.fromEntries(row.map((c, k) => [`b${k}`, (c / 100).toFixed(2)])) } })),
      total: table.size,
      emptyMessage: "No open invoices: nothing is owed to you.",
    };
    const top = [...owed].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, c]) => ({ customer: k.split("|")[0], currency: k.split("|")[1], owes: (c / 100).toFixed(2) }));
    return { summary: "Receivables aging", parts: [part], data: { buckets, byCurrency: Object.fromEntries([...table].map(([c, r]) => [c, r.map((x) => (x / 100).toFixed(2))])), topDebtors: top } };
  },
});

export const matchPaymentTool = defineTool({
  name: "finance_match_payment",
  module: "finance",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "Suggests which open invoices an unallocated payment belongs to (invoice number in the reference, exact amount, customer name, invoices that add up exactly). Read-only: to apply a match, use the allocate tool with the suggested amounts.",
  input: z.object({ paymentId: z.string().regex(/^[0-9a-f]{24}$/i) }).strict(),
  async run(ctx, input) {
    const svc = fin(ctx);
    const payment = (await svc.listPayments()).find((p) => p.id === input.paymentId);
    if (!payment) throw new AppError("NOT_FOUND", "Payment not found.");
    const invoices = await svc.listUnpaidInvoices();
    const matches = suggestPaymentMatches(payment, invoices);
    const number = (id: string) => invoices.find((i) => i.id === id)?.invoiceNumber ?? id;
    const part: AiRecordTablePart = {
      type: "record_table",
      title: `Matches for ${money(payment.unallocatedAmount, payment.currency)} unallocated`,
      columns: [{ key: "invoices", label: "Invoices" }, { key: "confidence", label: "Confidence" }, { key: "reason", label: "Why" }],
      rows: matches.map((m, k) => ({ id: String(k), cells: { invoices: m.allocations.map((a) => `${number(a.invoiceId)} (${a.amount.toFixed(2)})`).join(", "), confidence: m.confidence, reason: m.reason } })),
      total: matches.length,
      emptyMessage: "No likely match. Check the reference with the customer.",
    };
    return { summary: `${matches.length} possible match(es)`, parts: [part], data: { paymentId: payment.id, matches: matches.map((m) => ({ ...m, allocations: m.allocations.map((a) => ({ ...a, invoiceNumber: number(a.invoiceId) })) })) } };
  },
});

export const expenseFlagsTool = defineTool({
  name: "finance_expense_flags",
  module: "finance",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "Expenses that need a second look: possible duplicates, unusually high amounts for their category, weekend spending and large expenses without a receipt. Optional status filter (for example submitted, to review before approving).",
  input: z.object({ status: z.enum(["draft", "submitted", "approved", "rejected", "paid", "all"]).optional() }).strict(),
  async run(ctx, input) {
    const all = await fin(ctx).listExpenses("all");
    const flags = computeExpenseFlags(all);
    const rows = all.filter((e) => flags[e.id]?.length && (!input.status || input.status === "all" || e.status === input.status)).slice(0, 30);
    const part: AiRecordTablePart = {
      type: "record_table",
      title: "Expenses to check",
      columns: [{ key: "date", label: "Date" }, { key: "vendor", label: "Vendor" }, { key: "total", label: "Total", align: "right" }, { key: "status", label: "Status" }, { key: "flags", label: "Flags" }],
      rows: rows.map((e) => ({ id: e.id, cells: { date: e.expenseDate, vendor: e.vendor ?? "—", total: money(e.total, e.currency), status: e.status, flags: flags[e.id].map((f) => f.label).join(", ") } })),
      total: rows.length,
      emptyMessage: "Nothing unusual found in these expenses.",
    };
    return { summary: `${rows.length} expense(s) flagged`, parts: [part], data: { expenses: rows.map((e) => ({ id: e.id, vendor: e.vendor, date: e.expenseDate, total: e.total, currency: e.currency, status: e.status, flags: flags[e.id].map((f) => f.detail) })) } };
  },
});

export const FINANCE_INSIGHT_TOOLS = [cashflowForecastTool, agingReportTool, matchPaymentTool, expenseFlagsTool];
