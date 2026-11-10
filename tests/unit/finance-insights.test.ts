import { describe, expect, it } from "vitest";
import { computeCustomerInsight, computeExpenseFlags, forecastCashFlow, suggestPaymentMatches, type ExpenseLike } from "@/features/finance/utils/insights";

const exp = (id: string, o: Partial<ExpenseLike> = {}): ExpenseLike => ({ id, expenseDate: "2026-10-14", vendor: "Shell", categoryId: "fuel", categoryName: "Fuel", total: 50, currency: "TND", status: "approved", receiptDocumentId: "r", ...o });
const codes = (flags: ReturnType<typeof computeExpenseFlags>, id: string) => (flags[id] ?? []).map((f) => f.code);

describe("expense flags", () => {
  it("flags same vendor + date + total as possible duplicates, case-insensitively", () => {
    const f = computeExpenseFlags([exp("a"), exp("b", { vendor: "SHELL " }), exp("c", { total: 51 })]);
    expect(codes(f, "a")).toContain("duplicate");
    expect(codes(f, "b")).toContain("duplicate");
    expect(codes(f, "c")).not.toContain("duplicate");
  });

  it("flags an amount far above the category's usual cost only with enough history", () => {
    const history = ["1", "2", "3", "4", "5"].map((d) => exp(`h${d}`, { expenseDate: `2026-10-0${d}`, total: 40 + Number(d) }));
    expect(codes(computeExpenseFlags([...history, exp("big", { total: 400 })]), "big")).toContain("unusual_amount");
    expect(codes(computeExpenseFlags([...history.slice(0, 4), exp("big", { total: 400 })]), "big")).not.toContain("unusual_amount");
  });

  it("flags weekends and large expenses without a receipt", () => {
    const f = computeExpenseFlags([exp("sat", { expenseDate: "2026-11-07" }), exp("big", { expenseDate: "2026-11-05", total: 900, receiptDocumentId: undefined, vendor: "X" })]);
    expect(codes(f, "sat")).toContain("weekend");
    expect(codes(f, "big")).toEqual(["no_receipt"]);
  });
});

describe("payment matching", () => {
  const inv = [
    { id: "i1", invoiceNumber: "INV-2026-00012", customerName: "Atlas Trading", balance: 119, currency: "TND" },
    { id: "i2", invoiceNumber: "INV-2026-00013", customerName: "Atlas Trading", balance: 81, currency: "TND" },
    { id: "i3", invoiceNumber: "INV-2026-00014", customerName: "Ben Ali SARL", balance: 200, currency: "TND" },
    { id: "eur", invoiceNumber: "INV-2026-00015", customerName: "Euro Co", balance: 200, currency: "EUR" },
  ];
  it("an invoice number in the reference is the strongest signal, even with spaces or no dashes", () => {
    const s = suggestPaymentMatches({ amount: 119, unallocatedAmount: 119, currency: "TND", reference: "virement inv 2026 00012" }, inv);
    expect(s[0]).toMatchObject({ confidence: "high", allocations: [{ invoiceId: "i1", amount: 119 }] });
  });
  it("finds a set of one customer's invoices that adds up exactly", () => {
    const s = suggestPaymentMatches({ amount: 200, unallocatedAmount: 200, currency: "TND", reference: "ATLAS" }, inv);
    expect(s.some((m) => m.allocations.map((a) => a.invoiceId).sort().join() === "i1,i2")).toBe(true);
    expect(s.flatMap((m) => m.allocations).some((a) => a.invoiceId === "eur")).toBe(false);
  });
  it("never suggests allocating more than the payment has left", () => {
    const s = suggestPaymentMatches({ amount: 500, unallocatedAmount: 50, currency: "TND", reference: "INV-2026-00014" }, inv);
    expect(s[0].allocations).toEqual([{ invoiceId: "i3", amount: 50 }]);
    expect(suggestPaymentMatches({ amount: 5, unallocatedAmount: 0, currency: "TND" }, inv)).toEqual([]);
  });
});

describe("customer insight", () => {
  it("measures days to pay and on-time rate, and rates risk", () => {
    const good = computeCustomerInsight(
      [
        { status: "paid", currency: "TND", issueDate: "2026-09-01", dueDate: "2026-10-01", total: 100, balance: 0, paidAt: "2026-09-21T10:00:00Z" },
        { status: "paid", currency: "TND", issueDate: "2026-09-10", dueDate: "2026-10-10", total: 100, balance: 0, paidAt: "2026-10-05T10:00:00Z" },
      ],
      "2026-11-07"
    );
    expect(good).toMatchObject({ avgDaysToPay: 23, onTimeRate: 1, risk: "low", overdueCount: 0 });
    const bad = computeCustomerInsight(
      [
        { status: "posted", currency: "TND", issueDate: "2026-08-01", dueDate: "2026-09-01", total: 100, balance: 100 },
        { status: "partially_paid", currency: "TND", issueDate: "2026-08-15", dueDate: "2026-09-15", total: 100, balance: 30.1 },
      ],
      "2026-11-07"
    );
    expect(bad).toMatchObject({ overdueCount: 2, risk: "high", openBalance: [{ currency: "TND", amount: 130.1 }] });
    expect(computeCustomerInsight([], "2026-11-07").risk).toBe("new");
    // One open invoice that is not due yet proves nothing: not "reliable".
    const fresh = computeCustomerInsight([{ status: "posted", currency: "TND", issueDate: "2026-11-01", dueDate: "2026-12-01", total: 119, balance: 119 }], "2026-11-07");
    expect(fresh).toMatchObject({ risk: "new", summary: "No invoice paid yet" });
  });
});

describe("cash-flow forecast", () => {
  it("counts overdue money in every window, adds balances by due date, and spreads average expenses", () => {
    const f = forecastCashFlow({
      today: "2026-11-07",
      openInvoices: [{ balance: 100, dueDate: "2026-10-01" }, { balance: 300, dueDate: "2026-11-20" }, { balance: 500, dueDate: "2026-12-30" }],
      monthlyExpenses: [999, 300, 300, 300],
    });
    expect(f.overdueIncluded).toBe(100);
    expect(f.avgMonthlyExpenses).toBe(300);
    expect(f.windows).toEqual([
      { days: 30, expectedIn: 400, expectedOut: 300, net: 100 },
      { days: 60, expectedIn: 900, expectedOut: 600, net: 300 },
      { days: 90, expectedIn: 900, expectedOut: 900, net: 0 },
    ]);
  });
});
