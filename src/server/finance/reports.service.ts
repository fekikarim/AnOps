import "server-only";
import { z } from "zod";
import { todayTunis } from "@/server/ai/finance/money";
import { buildWorkbook, exportFileName } from "@/server/exports/workbook";
import type { ExportFile } from "@/server/exports/reports";
import type { WorkspaceContext } from "@/server/tenancy/workspace";
import { AppError } from "@/shared/lib/errors";

/**
 * Finance reports for one currency and one year: receivables aging (as of today), expenses by category,
 * and monthly profit and loss on a cash basis (payments received vs approved or paid expenses).
 * Every sum is done in cents; nothing is ever added across currencies.
 */

export const reportQuerySchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});
export type ReportQuery = z.infer<typeof reportQuerySchema>;

export const AGING_BUCKETS = ["Not yet due", "1–30 days", "31–60 days", "61–90 days", "Over 90 days"] as const;

export type FinanceReports = {
  currency: string;
  year: number;
  aging: { buckets: number[]; total: number; rows: Array<{ customer: string; buckets: number[]; total: number }> };
  expensesByCategory: Array<{ category: string; count: number; total: number; share: number }>;
  pnl: Array<{ month: string; income: number; expenses: number; net: number }>;
  totals: { income: number; expenses: number; net: number };
};

const c = (n: unknown) => Math.round((Number(n) || 0) * 100);
const f = (cents: number) => cents / 100;
const dayDiff = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

export async function getFinanceReports(ctx: WorkspaceContext, query: ReportQuery): Promise<FinanceReports> {
  if (!ctx.permissions.has("finance.report.view") && !ctx.permissions.has("finance.read")) throw new AppError("FORBIDDEN", "You cannot view finance reports.");
  const currency = query.currency ?? (ctx.currencyCode || "TND");
  const cur = currency === "TND" ? { $in: ["TND", null] } : currency;
  const today = todayTunis();
  const year = query.year ?? Number(today.slice(0, 4));
  const { db, companyId } = ctx;

  const [open, customers, categories, expenses, payments] = await Promise.all([
    db.collection("finance_invoices").find({ companyId, currency: cur, status: { $in: ["posted", "partially_paid"] }, balance: { $gt: 0 } }, { projection: { customerId: 1, dueDate: 1, balance: 1 } }).toArray(),
    db.collection("finance_customers").find({ companyId }, { projection: { name: 1 } }).toArray(),
    db.collection("finance_expense_categories").find({ companyId }, { projection: { name: 1 } }).toArray(),
    db.collection("finance_expenses").find({ companyId, currency: cur, status: { $in: ["approved", "paid"] }, expenseDate: { $gte: `${year}-01-01`, $lte: `${year}-12-31` } }, { projection: { categoryId: 1, total: 1, expenseDate: 1 } }).toArray(),
    db.collection("finance_payments").find({ companyId, currency: cur, paymentDate: { $gte: `${year}-01-01`, $lte: `${year}-12-31` } }, { projection: { amount: 1, paymentDate: 1 } }).toArray(),
  ]);

  // Aging, per customer.
  const name = new Map(customers.map((x) => [x._id.toHexString(), String(x.name)]));
  const byCustomer = new Map<string, number[]>();
  const totalBuckets = [0, 0, 0, 0, 0];
  for (const i of open) {
    const late = i.dueDate ? dayDiff(String(i.dueDate), today) : 0;
    const b = late <= 0 ? 0 : late <= 30 ? 1 : late <= 60 ? 2 : late <= 90 ? 3 : 4;
    const key = i.customerId ? (name.get(i.customerId.toHexString()) ?? "Unknown customer") : "Direct customer";
    const row = byCustomer.get(key) ?? [0, 0, 0, 0, 0];
    row[b] += c(i.balance);
    totalBuckets[b] += c(i.balance);
    byCustomer.set(key, row);
  }
  const agingRows = [...byCustomer]
    .map(([customer, row]) => ({ customer, buckets: row.map(f), total: f(row.reduce((a, b) => a + b, 0)) }))
    .sort((a, b) => b.total - a.total);

  // Expenses by category.
  const catName = new Map(categories.map((x) => [x._id.toHexString(), String(x.name)]));
  const byCat = new Map<string, { count: number; cents: number }>();
  let expenseCents = 0;
  for (const e of expenses) {
    const key = e.categoryId ? (catName.get(e.categoryId.toHexString()) ?? "Uncategorized") : "Uncategorized";
    const cur2 = byCat.get(key) ?? { count: 0, cents: 0 };
    cur2.count++;
    cur2.cents += c(e.total);
    expenseCents += c(e.total);
    byCat.set(key, cur2);
  }
  const expensesByCategory = [...byCat]
    .map(([category, v]) => ({ category, count: v.count, total: f(v.cents), share: expenseCents ? Math.round((v.cents / expenseCents) * 1000) / 10 : 0 }))
    .sort((a, b) => b.total - a.total);

  // Monthly cash P&L.
  const months = Array.from({ length: 12 }, (_, k) => `${year}-${String(k + 1).padStart(2, "0")}`);
  const inc = new Map<string, number>();
  const out = new Map<string, number>();
  for (const p of payments) inc.set(String(p.paymentDate).slice(0, 7), (inc.get(String(p.paymentDate).slice(0, 7)) ?? 0) + c(p.amount));
  for (const e of expenses) out.set(String(e.expenseDate).slice(0, 7), (out.get(String(e.expenseDate).slice(0, 7)) ?? 0) + c(e.total));
  const pnl = months.map((m) => ({ month: m, income: f(inc.get(m) ?? 0), expenses: f(out.get(m) ?? 0), net: f((inc.get(m) ?? 0) - (out.get(m) ?? 0)) }));
  const incomeCents = [...inc.values()].reduce((a, b) => a + b, 0);

  return {
    currency,
    year,
    aging: { buckets: totalBuckets.map(f), total: f(totalBuckets.reduce((a, b) => a + b, 0)), rows: agingRows },
    expensesByCategory,
    pnl,
    totals: { income: f(incomeCents), expenses: f(expenseCents), net: f(incomeCents - expenseCents) },
  };
}

export async function exportFinanceReports(ctx: WorkspaceContext, query: ReportQuery, now: Date): Promise<ExportFile> {
  const r = await getFinanceReports(ctx, query);
  const money = { format: "money" as const, currency: r.currency };
  const body = await buildWorkbook({
    title: `Finance reports ${r.year} (${r.currency})`,
    generatedAt: now,
    summary: [
      ["Currency", r.currency],
      ["Year", String(r.year)],
      ["Income received", r.totals.income.toFixed(2)],
      ["Expenses (approved and paid)", r.totals.expenses.toFixed(2)],
      ["Net (cash basis)", r.totals.net.toFixed(2)],
      ["Open receivables", r.aging.total.toFixed(2)],
    ],
    notes: ["Cash basis: income is payments received in the year; expenses are approved or paid expenses dated in the year.", "Aging is as of the day of the export.", "Amounts in other currencies are in their own export."],
    sheets: [
      {
        name: "Aging",
        columns: [{ header: "Customer", width: 32 }, ...AGING_BUCKETS.map((b) => ({ header: b, width: 14, ...money })), { header: "Total", width: 14, ...money }],
        rows: [...r.aging.rows.map((x) => [x.customer, ...x.buckets, x.total]), ["Total", ...r.aging.buckets, r.aging.total]],
      },
      {
        name: "Expenses by category",
        columns: [{ header: "Category", width: 30 }, { header: "Expenses", width: 12, format: "integer" }, { header: "Total", width: 16, ...money }, { header: "Share %", width: 10 }],
        rows: r.expensesByCategory.map((x) => [x.category, x.count, x.total, x.share]),
      },
      {
        name: "Monthly P&L",
        columns: [{ header: "Month", width: 12 }, { header: "Income", width: 16, ...money }, { header: "Expenses", width: 16, ...money }, { header: "Net", width: 16, ...money }],
        rows: [...r.pnl.map((x) => [x.month, x.income, x.expenses, x.net]), ["Total", r.totals.income, r.totals.expenses, r.totals.net]],
      },
    ],
  });
  return { fileName: exportFileName(`finance-reports-${r.year}-${r.currency.toLowerCase()}`, now), body, rowCount: r.aging.rows.length + r.expensesByCategory.length + 12 };
}
