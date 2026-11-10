/**
 * Deterministic finance insights: pure functions, no database and no model.
 * "Numbers come from code, the AI explains": everything the screens flag or suggest is computed here,
 * so it is the same every time, testable, and never invented. Money is compared in whole cents.
 */

const cents = (n: number) => Math.round((Number(n) || 0) * 100);
const fromCents = (c: number) => c / 100;

// ─── Expense flags ────────────────────────────────────────────────────────────

export type ExpenseLike = {
  id: string;
  expenseDate: string;
  vendor?: string;
  categoryId?: string;
  categoryName?: string;
  total: number;
  currency: string;
  status: string;
  receiptDocumentId?: string;
};

export type ExpenseFlag = { code: "duplicate" | "unusual_amount" | "weekend" | "no_receipt"; label: string; detail: string };

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Flags that help an approver: a likely duplicate (same vendor, date and total), an amount far above what
 * this category usually costs, weekend spending, and a large expense without a receipt.
 */
export function computeExpenseFlags(expenses: ExpenseLike[], opts: { receiptRequiredAbove?: number } = {}): Record<string, ExpenseFlag[]> {
  const receiptAbove = cents(opts.receiptRequiredAbove ?? 200);
  const live = expenses.filter((e) => e.status !== "voided");
  const out: Record<string, ExpenseFlag[]> = {};
  const add = (id: string, f: ExpenseFlag) => (out[id] ??= []).push(f);

  const dupKey = (e: ExpenseLike) => `${(e.vendor ?? "").trim().toLowerCase()}|${e.expenseDate}|${cents(e.total)}|${e.currency}`;
  const groups = new Map<string, ExpenseLike[]>();
  for (const e of live) if (e.vendor?.trim()) groups.set(dupKey(e), [...(groups.get(dupKey(e)) ?? []), e]);
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    for (const e of g) add(e.id, { code: "duplicate", label: "Possible duplicate", detail: `${g.length} expenses from ${e.vendor} on ${e.expenseDate} for the same amount.` });
  }

  // Typical cost per category and currency, from at least 5 other expenses.
  for (const e of live) {
    const peers = live.filter((p) => p.id !== e.id && p.currency === e.currency && (p.categoryId ?? "") === (e.categoryId ?? ""));
    if (peers.length < 5) continue;
    const typical = median(peers.map((p) => cents(p.total)));
    if (typical > 0 && cents(e.total) > typical * 3) {
      add(e.id, {
        code: "unusual_amount",
        label: "Unusually high",
        detail: `About ${Math.round(cents(e.total) / typical)}× the usual ${e.categoryName ?? "uncategorized"} expense (typically ${fromCents(Math.round(typical)).toFixed(2)} ${e.currency}).`,
      });
    }
  }

  for (const e of live) {
    const day = new Date(`${e.expenseDate}T12:00:00Z`).getUTCDay();
    if (day === 0 || day === 6) add(e.id, { code: "weekend", label: "Weekend", detail: "Spent on a Saturday or Sunday." });
    if (!e.receiptDocumentId && cents(e.total) > receiptAbove) {
      add(e.id, { code: "no_receipt", label: "No receipt", detail: `Over ${fromCents(receiptAbove).toFixed(2)} ${e.currency} with no receipt attached.` });
    }
  }
  return out;
}

// ─── Payment matching ─────────────────────────────────────────────────────────

export type OpenInvoice = { id: string; invoiceNumber: string; customerName?: string; balance: number; currency: string; dueDate?: string };
export type PaymentLike = { amount: number; unallocatedAmount: number; currency: string; reference?: string; notes?: string };
export type MatchSuggestion = { allocations: Array<{ invoiceId: string; amount: number }>; confidence: "high" | "medium" | "low"; reason: string };

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Suggests where an unallocated payment belongs, best first. Signals: an invoice number written in the
 * reference, an open balance equal to the money left, a customer's name in the reference, and a set of one
 * customer's invoices that adds up exactly. Only invoices in the payment's currency are considered.
 */
export function suggestPaymentMatches(payment: PaymentLike, invoices: OpenInvoice[], limit = 3): MatchSuggestion[] {
  const left = cents(payment.unallocatedAmount);
  if (left <= 0) return [];
  const pool = invoices.filter((i) => i.currency === payment.currency && cents(i.balance) > 0);
  const text = norm(`${payment.reference ?? ""} ${payment.notes ?? ""}`);
  const textCompact = text.replace(/ /g, "");
  const out: Array<MatchSuggestion & { score: number }> = [];
  const take = (inv: OpenInvoice) => ({ invoiceId: inv.id, amount: fromCents(Math.min(left, cents(inv.balance))) });

  for (const inv of pool) {
    const numberHit = textCompact.length > 0 && textCompact.includes(norm(inv.invoiceNumber).replace(/ /g, ""));
    const exact = cents(inv.balance) === left;
    const nameHit = !!inv.customerName && norm(inv.customerName).split(" ").filter((w) => w.length > 2).some((w) => text.split(" ").includes(w));
    const score = (numberHit ? 6 : 0) + (exact ? 4 : 0) + (nameHit ? 2 : 0);
    if (!score) continue;
    const why = [numberHit && `the reference mentions ${inv.invoiceNumber}`, exact && "the amount equals its open balance", nameHit && `the reference names ${inv.customerName}`].filter(Boolean).join(", ");
    out.push({ allocations: [take(inv)], score, confidence: score >= 6 ? "high" : score >= 4 ? "medium" : "low", reason: `${inv.invoiceNumber}: ${why}.` });
  }

  // Several invoices of one customer that add up to exactly the money left (up to 4 invoices).
  const byCustomer = new Map<string, OpenInvoice[]>();
  for (const inv of pool) if (inv.customerName) byCustomer.set(inv.customerName, [...(byCustomer.get(inv.customerName) ?? []), inv]);
  for (const [customer, list] of byCustomer) {
    const items = list.slice(0, 12);
    const found = subsetSum(items.map((i) => cents(i.balance)), left, 4);
    if (found && found.length > 1) {
      const chosen = found.map((k) => items[k]);
      out.push({
        allocations: chosen.map((i) => ({ invoiceId: i.id, amount: i.balance })),
        score: 5,
        confidence: "medium",
        reason: `${chosen.map((i) => i.invoiceNumber).join(" + ")} from ${customer} add up exactly to the amount.`,
      });
    }
  }

  return out
    .sort((a, b) => b.score - a.score)
    .filter((s, i, all) => all.findIndex((t) => t.allocations.map((x) => x.invoiceId).join() === s.allocations.map((x) => x.invoiceId).join()) === i)
    .slice(0, limit)
    .map(({ allocations, confidence, reason }) => ({ allocations, confidence, reason }));
}

function subsetSum(values: number[], target: number, maxItems: number): number[] | null {
  let best: number[] | null = null;
  const walk = (start: number, sum: number, picked: number[]) => {
    if (best) return;
    if (sum === target && picked.length) return void (best = [...picked]);
    if (sum > target || picked.length === maxItems) return;
    for (let i = start; i < values.length; i++) {
      picked.push(i);
      walk(i + 1, sum + values[i], picked);
      picked.pop();
    }
  };
  walk(0, 0, []);
  return best;
}

// ─── Customer payment behaviour ───────────────────────────────────────────────

export type InvoiceHistory = { status: string; currency: string; issueDate: string; dueDate?: string; total: number; balance: number; paidAt?: string };
export type CustomerInsight = {
  openBalance: Array<{ currency: string; amount: number }>;
  overdueCount: number;
  paidCount: number;
  /** Average days from issue to full payment, over paid invoices. */
  avgDaysToPay: number | null;
  /** Share of paid invoices settled by their due date. */
  onTimeRate: number | null;
  risk: "low" | "medium" | "high" | "new";
  summary: string;
};

const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

export function computeCustomerInsight(invoices: InvoiceHistory[], today: string): CustomerInsight {
  const live = invoices.filter((i) => ["posted", "partially_paid", "paid"].includes(i.status));
  const open = new Map<string, number>();
  let overdueCount = 0;
  for (const i of live) {
    if (cents(i.balance) > 0) open.set(i.currency, (open.get(i.currency) ?? 0) + cents(i.balance));
    if (i.status !== "paid" && i.dueDate && i.dueDate < today && cents(i.balance) > 0) overdueCount++;
  }
  const paid = live.filter((i) => i.status === "paid" && i.paidAt);
  const avgDaysToPay = paid.length ? Math.round(paid.reduce((n, i) => n + Math.max(0, days(i.issueDate, i.paidAt!.slice(0, 10))), 0) / paid.length) : null;
  const withDue = paid.filter((i) => i.dueDate);
  const onTimeRate = withDue.length ? withDue.filter((i) => i.paidAt!.slice(0, 10) <= i.dueDate!).length / withDue.length : null;

  let risk: CustomerInsight["risk"] = "low";
  // "Reliable" has to be earned: with nothing paid yet and nothing overdue, there is no record either way.
  if (!live.length || (paid.length === 0 && overdueCount === 0)) risk = "new";
  else if (overdueCount >= 2 || (onTimeRate !== null && onTimeRate < 0.5)) risk = "high";
  else if (overdueCount === 1 || (onTimeRate !== null && onTimeRate < 0.8) || (avgDaysToPay !== null && avgDaysToPay > 45)) risk = "medium";

  const parts: string[] = [];
  if (!live.length) parts.push("No posted invoices yet.");
  else if (risk === "new") parts.push("No invoice paid yet");
  if (avgDaysToPay !== null) parts.push(`Pays in ${avgDaysToPay} days on average`);
  if (onTimeRate !== null) parts.push(`${Math.round(onTimeRate * 100)}% on time`);
  if (overdueCount) parts.push(`${overdueCount} overdue now`);
  return {
    openBalance: [...open].map(([currency, c]) => ({ currency, amount: fromCents(c) })),
    overdueCount,
    paidCount: paid.length,
    avgDaysToPay,
    onTimeRate,
    risk,
    summary: parts.join(" · ") || "No payment history yet.",
  };
}

// ─── Cash-flow forecast ───────────────────────────────────────────────────────

export type ForecastWindow = { days: 30 | 60 | 90; expectedIn: number; expectedOut: number; net: number };

/**
 * A simple, explainable projection for one currency: money in = open balances due within the window
 * (overdue ones counted in the first 30 days), money out = the average monthly approved and paid
 * expenses of the last three months, spread over the window.
 */
export function forecastCashFlow(input: {
  today: string;
  openInvoices: Array<{ balance: number; dueDate?: string }>;
  monthlyExpenses: number[];
}): { windows: ForecastWindow[]; overdueIncluded: number; avgMonthlyExpenses: number } {
  const recent = input.monthlyExpenses.slice(-3);
  const avgMonthly = recent.length ? Math.round(recent.reduce((n, m) => n + cents(m), 0) / recent.length) : 0;
  const addDays = (d: number) => new Date(Date.parse(`${input.today}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
  let overdue = 0;
  for (const i of input.openInvoices) if (!i.dueDate || i.dueDate < input.today) overdue += cents(i.balance);
  const windows = ([30, 60, 90] as const).map((d) => {
    const until = addDays(d);
    const dueIn = input.openInvoices.filter((i) => i.dueDate && i.dueDate >= input.today && i.dueDate <= until).reduce((n, i) => n + cents(i.balance), 0);
    const inC = dueIn + overdue;
    const outC = Math.round((avgMonthly * d) / 30);
    return { days: d, expectedIn: fromCents(inC), expectedOut: fromCents(outC), net: fromCents(inC - outC) };
  });
  return { windows, overdueIncluded: fromCents(overdue), avgMonthlyExpenses: fromCents(avgMonthly) };
}
