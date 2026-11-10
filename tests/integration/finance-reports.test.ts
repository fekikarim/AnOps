import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { createHarness, type TestHarness } from "../helpers/workspace";

const shared = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/server/db/client", () => ({ default: Promise.resolve({ db: () => shared.db }) }));
vi.mock("@/server/tenant/context", () => ({ getActiveTenant: async () => null }));

const { getFinanceReports, exportFinanceReports } = await import("@/server/finance/reports.service");
const { fin } = await import("@/server/ai/tools/finance.tools");

let h: TestHarness;
const year = 2026;
beforeAll(async () => {
  h = await createHarness();
  shared.db = h.db;
  const svc = fin(h.ctx());
  const c = await svc.createCustomer({ name: "Aging Co" }, "u");
  const mk = async (due: string, amount: number, currency = "TND") => {
    const id = await svc.createInvoiceDraft({ customerId: c, currency, issueDate: "2026-01-01", dueDate: due, lines: [{ description: "W", quantity: 1, unitPrice: amount }] }, "u");
    await svc.postInvoice(id, "u");
    return id;
  };
  await mk("2099-01-01", 10); // not yet due
  await mk("2020-01-01", 30); // over 90 days
  await mk("2099-01-01", 999, "EUR"); // other currency: never in the TND report
  const cats = await svc.listExpenseCategories();
  const travel = cats.find((x) => x.name === "Travel & Transport")!.id;
  for (const [date, amount, cat] of [["2026-02-10", 30, travel], ["2026-02-11", 10, undefined], ["2026-03-01", 60, travel]] as const) {
    const e = await svc.createExpense({ expenseDate: date, description: "Trip", amount, categoryId: cat, currency: "TND" }, "u");
    await svc.submitExpense(e, "u");
    await svc.approveExpense(e, "u");
  }
  await svc.createExpense({ expenseDate: "2026-02-12", description: "Still a draft", amount: 500, currency: "TND" }, "u"); // drafts are not counted
  await svc.recordPayment({ paymentDate: "2026-02-20", amount: 70, currency: "TND", method: "cash" }, "u");
});
afterAll(async () => h.cleanup());

describe("finance reports", () => {
  it("ages receivables, splits expenses by category and builds a cash P&L in one currency", async () => {
    const r = await getFinanceReports(h.ctx(), { currency: "TND", year });
    expect(r.aging.buckets).toEqual([10, 0, 0, 0, 30]);
    expect(r.aging.rows).toEqual([{ customer: "Aging Co", buckets: [10, 0, 0, 0, 30], total: 40 }]);
    expect(r.expensesByCategory).toEqual([
      { category: "Travel & Transport", count: 2, total: 90, share: 90 },
      { category: "Uncategorized", count: 1, total: 10, share: 10 },
    ]);
    expect(r.pnl.find((m) => m.month === "2026-02")).toEqual({ month: "2026-02", income: 70, expenses: 40, net: 30 });
    expect(r.totals).toEqual({ income: 70, expenses: 100, net: -30 });
    expect(JSON.stringify(r)).not.toContain("999");
    expect((await getFinanceReports(h.otherTenant(), { currency: "TND", year })).aging.total).toBe(0);
  });

  it("exports the same figures to Excel", async () => {
    const file = await exportFinanceReports(h.ctx(), { currency: "TND", year }, new Date("2026-11-07T10:00:00Z"));
    expect(file.fileName).toBe("finance-reports-2026-tnd-2026-11-07.xlsx");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.body as unknown as ArrayBuffer);
    expect(wb.worksheets.map((s) => s.name)).toEqual(["Summary", "Aging", "Expenses by category", "Monthly P&L"]);
    const pnl = wb.getWorksheet("Monthly P&L")!;
    const feb = pnl.getRows(1, pnl.rowCount)!.find((row) => row.getCell(1).value === "2026-02")!;
    expect([feb.getCell(2).value, feb.getCell(3).value, feb.getCell(4).value]).toEqual([70, 40, 30]);
  });
});
