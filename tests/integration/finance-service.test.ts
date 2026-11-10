import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createHarness, type TestHarness } from "../helpers/workspace";
import { FinanceService } from "@/server/services/finance.service";

const shared = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/server/db/client", () => ({ default: Promise.resolve({ db: () => shared.db }) }));
vi.mock("@/server/tenant/context", () => ({ getActiveTenant: async () => null }));

let h: TestHarness;
let a: FinanceService;
let b: FinanceService;
const userA = new ObjectId().toHexString();
const userB = new ObjectId().toHexString();
let customer: string;

const mk = (svc: FinanceService, cust: string, amount: number, user: string) =>
  svc.createInvoiceDraft({ customerId: cust, currency: "TND", issueDate: "2026-11-01", lines: [{ description: "Work", quantity: 1, unitPrice: amount }] }, user);

beforeAll(async () => {
  h = await createHarness();
  shared.db = h.db;
  a = new FinanceService({ companyId: h.ctx().companyId.toHexString(), companyRole: "owner", userId: userA });
  b = new FinanceService({ companyId: h.otherTenant().companyId.toHexString(), companyRole: "owner", userId: userB });
  customer = await a.createCustomer({ name: "Service Customer" }, userA);
});
afterAll(async () => {
  await h.cleanup();
});

describe("Finance service money arithmetic is exact to the cent", () => {
  it("a payment can be applied in awkward pieces without residue (0.30 = 0.10 + 0.20)", async () => {
    const inv = await mk(a, customer, 0.3, userA);
    await a.postInvoice(inv, userA);
    const pay = await a.recordPayment({ paymentDate: "2026-11-02", amount: 0.3, currency: "TND", method: "cash" }, userA);
    await a.allocatePayment(pay, [{ invoiceId: inv, amount: 0.1 }], userA);
    await a.allocatePayment(pay, [{ invoiceId: inv, amount: 0.2 }], userA);
    const after = await a.getInvoice(inv);
    expect(after).toMatchObject({ amountPaid: 0.3, balance: 0, status: "paid" });
    expect((await a.listPayments()).find((p) => p.id === pay)?.unallocatedAmount).toBe(0);
  });

  it("many small allocations leave exact balances", async () => {
    const inv = await mk(a, customer, 100.3, userA);
    await a.postInvoice(inv, userA);
    const pay = await a.recordPayment({ paymentDate: "2026-11-02", amount: 100.3, currency: "TND", method: "cash" }, userA);
    for (const amount of [10.1, 20.2, 30.3, 39.7]) await a.allocatePayment(pay, [{ invoiceId: inv, amount }], userA);
    expect(await a.getInvoice(inv)).toMatchObject({ amountPaid: 100.3, balance: 0, status: "paid" });
  });

  it("an expense total is amount plus tax in cents, and invoice line totals are rounded like the invoice totals", async () => {
    const e = await a.createExpense({ expenseDate: "2026-11-02", description: "Float probe", amount: 0.1, tax: 0.2, currency: "TND" }, userA);
    expect((await a.listExpenses("all")).find((x) => x.id === e)?.total).toBe(0.3);
    const inv = await a.createInvoiceDraft({ customerId: customer, currency: "TND", issueDate: "2026-11-01", lines: [{ description: "W", quantity: 3, unitPrice: 19.99, taxRate: 19 }] }, userA);
    const got = await a.getInvoice(inv);
    expect(got.lines[0].lineTotal).toBe(71.36);
    expect(got.total).toBe(71.36);
  });
});

describe("Finance service tenancy", () => {
  it("another company's invoice, payment and customer are not found, and cannot be allocated across companies", async () => {
    const theirCustomer = await b.createCustomer({ name: "Their Customer" }, userB);
    const theirInvoice = await mk(b, theirCustomer, 10, userB);
    await b.postInvoice(theirInvoice, userB);
    const mine = await a.recordPayment({ paymentDate: "2026-11-02", amount: 10, currency: "TND", method: "cash" }, userA);
    await expect(a.getInvoice(theirInvoice)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(a.getCustomer(theirCustomer)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(a.allocatePayment(mine, [{ invoiceId: theirInvoice, amount: 10 }], userA)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await a.listInvoices()).some((i) => i.id === theirInvoice)).toBe(false);
  });
});

const as = (role: "owner" | "admin" | "manager", user: string) => new FinanceService({ companyId: h.ctx().companyId.toHexString(), companyRole: role, userId: user });
const post = async (amount: number, currency = "TND", due = "2027-06-01") => {
  const id = await a.createInvoiceDraft({ customerId: customer, currency, issueDate: "2026-11-01", dueDate: due, lines: [{ description: "W", quantity: 1, unitPrice: amount }] }, userA);
  await a.postInvoice(id, userA);
  return id;
};
const pay = (amount: number, currency = "TND") => a.recordPayment({ paymentDate: "2026-11-02", amount, currency, method: "cash" }, userA);
const code = async (p: Promise<unknown>) => ((await p.then(() => ({ code: "OK" }), (e) => e)) as { code: string }).code;

describe("allocatePayment enforces its own rules, for every caller", () => {
  it("accepts posted and partially paid invoices in the payment's currency", async () => {
    const inv = await post(50);
    const p = await pay(50);
    await a.allocatePayment(p, [{ invoiceId: inv, amount: 20 }], userA);
    expect((await a.getInvoice(inv)).status).toBe("partially_paid");
    await a.allocatePayment(p, [{ invoiceId: inv, amount: 30 }], userA);
    expect((await a.getInvoice(inv)).status).toBe("paid");
  });

  it("rejects draft, voided, paid and cancelled-state invoices without changing anything", async () => {
    const draft = await a.createInvoiceDraft({ customerId: customer, currency: "TND", issueDate: "2026-11-01", lines: [{ description: "D", quantity: 1, unitPrice: 10 }] }, userA);
    const voided = await a.createInvoiceDraft({ customerId: customer, currency: "TND", issueDate: "2026-11-01", lines: [{ description: "V", quantity: 1, unitPrice: 10 }] }, userA);
    await a.voidInvoice(voided, "mistake", userA);
    const paid = await post(10);
    const p = await pay(100);
    await a.allocatePayment(p, [{ invoiceId: paid, amount: 10 }], userA);
    for (const invoiceId of [draft, voided, paid]) expect(await code(a.allocatePayment(p, [{ invoiceId, amount: 5 }], userA))).toMatch(/INVALID_TRANSITION|VALIDATION_ERROR/);
    expect(await code(a.allocatePayment(p, [{ invoiceId: draft, amount: 5 }], userA))).toBe("INVALID_TRANSITION");
    expect((await a.listPayments()).find((x) => x.id === p)?.unallocatedAmount).toBe(90);
    expect((await a.getInvoice(draft)).amountPaid).toBe(0);
  });

  it("rejects a currency mismatch, and a rejected multi-invoice request applies nothing at all", async () => {
    const eur = await post(40, "EUR");
    const tnd = await post(40);
    const p = await pay(100);
    expect(await code(a.allocatePayment(p, [{ invoiceId: eur, amount: 10 }], userA))).toBe("VALIDATION_ERROR");
    expect(await code(a.allocatePayment(p, [{ invoiceId: tnd, amount: 10 }, { invoiceId: eur, amount: 10 }], userA))).toBe("VALIDATION_ERROR");
    expect(await code(a.allocatePayment(p, [{ invoiceId: tnd, amount: 10 }, { invoiceId: tnd, amount: 10 }], userA))).toBe("VALIDATION_ERROR");
    expect((await a.getInvoice(tnd)).amountPaid).toBe(0);
    expect((await a.listPayments()).find((x) => x.id === p)?.unallocatedAmount).toBe(100);
  });
});

describe("allocatePayment is atomic under concurrency", () => {
  it("two payments racing for the same invoice balance never overpay it", async () => {
    const inv = await post(100);
    const [p1, p2] = [await pay(100), await pay(100)];
    const results = await Promise.all([p1, p2].map((p) => code(a.allocatePayment(p, [{ invoiceId: inv, amount: 80 }], userA))));
    expect(results.filter((r) => r === "OK")).toHaveLength(1);
    const after = await a.getInvoice(inv);
    expect(after).toMatchObject({ amountPaid: 80, balance: 20, status: "partially_paid" });
    expect(after.allocations).toHaveLength(1);
    const unallocated = (await a.listPayments()).filter((x) => x.id === p1 || x.id === p2).map((x) => x.unallocatedAmount).sort();
    expect(unallocated).toEqual([100, 20]); // the losing payment is untouched
  });

  it("one payment split concurrently across two invoices cannot exceed its amount", async () => {
    const [i1, i2] = [await post(60), await post(60)];
    const p = await pay(100);
    const results = await Promise.all([i1, i2].map((invoiceId) => code(a.allocatePayment(p, [{ invoiceId, amount: 60 }], userA))));
    expect(results.filter((r) => r === "OK")).toHaveLength(1);
    expect((await a.listPayments()).find((x) => x.id === p)?.unallocatedAmount).toBe(40);
    const paid = [(await a.getInvoice(i1)).amountPaid, (await a.getInvoice(i2)).amountPaid].sort();
    expect(paid).toEqual([0, 60]);
  });
});

describe("dashboard definitions", () => {
  it("counts only posted, partially paid and paid invoices: drafts and voided ones never inflate invoiced or outstanding", async () => {
    const c = await a.createCustomer({ name: "Dashboard Customer" }, userA);
    const before = await a.getDashboard();
    const mk = (amount: number, due: string) => a.createInvoiceDraft({ customerId: c, currency: "TND", issueDate: "2026-01-01", dueDate: due, lines: [{ description: "X", quantity: 1, unitPrice: amount }] }, userA);
    await mk(1000, "2026-01-31"); // stays draft
    const voided = await mk(2000, "2026-01-31");
    await a.postInvoice(voided, userA);
    await a.voidInvoice(voided, "mistake", userA);
    const open = await mk(300, "2026-01-31");
    await a.postInvoice(open, userA);
    const partial = await mk(200, "2099-01-01");
    await a.postInvoice(partial, userA);
    await a.allocatePayment(await pay(50), [{ invoiceId: partial, amount: 50 }], userA);
    const after = await a.getDashboard();
    expect(after.totalInvoiced - before.totalInvoiced).toBe(500); // 300 + 200
    expect(after.totalPaid - before.totalPaid).toBe(50);
    expect(after.outstanding - before.outstanding).toBe(450);
    expect(after.overdue - before.overdue).toBe(300); // only the open past-due one
    expect(after.overdueCount - before.overdueCount).toBe(1);
  });

  it("a fully paid invoice is not overdue and a draft past its due date is not overdue", async () => {
    const before = await a.getDashboard();
    const paid = await post(70, "TND", "2026-01-05");
    await a.allocatePayment(await pay(70), [{ invoiceId: paid, amount: 70 }], userA);
    await a.createInvoiceDraft({ customerId: customer, currency: "TND", issueDate: "2026-01-01", dueDate: "2026-01-05", lines: [{ description: "D", quantity: 1, unitPrice: 9 }] }, userA);
    const after = await a.getDashboard();
    expect(after.overdueCount).toBe(before.overdueCount);
    expect(after.overdue).toBe(before.overdue);
  });

  it("never adds currencies together: EUR activity shows only on the EUR dashboard", async () => {
    const tndBefore = await a.getDashboard("TND");
    const eurBefore = await a.getDashboard("EUR");
    const eur = await post(500, "EUR");
    await a.allocatePayment(await pay(200, "EUR"), [{ invoiceId: eur, amount: 200 }], userA);
    const tndAfter = await a.getDashboard("TND");
    const eurAfter = await a.getDashboard("EUR");
    expect(tndAfter.totalInvoiced).toBe(tndBefore.totalInvoiced);
    expect(eurAfter.currency).toBe("EUR");
    expect(eurAfter.totalInvoiced - eurBefore.totalInvoiced).toBe(500);
    expect(eurAfter.outstanding - eurBefore.outstanding).toBe(300);
    expect(await a.listActiveCurrencies()).toEqual(expect.arrayContaining(["TND", "EUR"]));
  });

  it("monthly income and expenses are exact to the cent", async () => {
    const month = new Date().toISOString().slice(0, 7);
    const before = (await a.getDashboard("TND")).monthlySummary.find((m) => m.monthKey === month)!;
    for (const amount of [0.1, 0.2, 0.7]) await a.recordPayment({ paymentDate: `${month}-01`, amount, currency: "TND", method: "cash" }, userA);
    const after = (await a.getDashboard("TND")).monthlySummary.find((m) => m.monthKey === month)!;
    expect(Math.round((after.income - before.income) * 100)).toBe(100);
    for (const m of [after.income, after.expenses, after.net]) expect(Math.round(m * 100) / 100).toBe(m);
  });

  it("totals carry no floating-point residue", async () => {
    const d = await a.getDashboard();
    for (const n of [d.totalInvoiced, d.totalPaid, d.outstanding, d.overdue]) expect(Math.round(n * 100) / 100).toBe(n);
  });
});

describe("expense approval separation of duties", () => {
  const admin1 = new ObjectId().toHexString();
  const admin2 = new ObjectId().toHexString();
  const clerk = new ObjectId().toHexString();
  const submitted = async (creator: string, submitter = creator) => {
    const id = await as("admin", creator).createExpense({ expenseDate: "2026-11-02", description: "SoD probe", amount: 10, tax: 0, currency: "TND" }, creator);
    await as("admin", submitter).submitExpense(id, submitter);
    return id;
  };

  it("a non-owner cannot approve an expense they created or submitted; another approver can", async () => {
    const own = await submitted(admin1);
    expect(await code(as("admin", admin1).approveExpense(own, admin1))).toBe("FORBIDDEN");
    expect((await a.listExpenses("submitted")).some((e) => e.id === own)).toBe(true); // still waiting
    await as("admin", admin2).approveExpense(own, admin2);
    expect((await a.listExpenses("approved")).some((e) => e.id === own)).toBe(true);
    const drafted = await as("manager", clerk).createExpense({ expenseDate: "2026-11-02", description: "Clerk draft", amount: 5, tax: 0, currency: "TND" }, clerk);
    await as("admin", admin1).submitExpense(drafted, admin1);
    expect(await code(as("admin", clerk).approveExpense(drafted, clerk))).toBe("FORBIDDEN"); // the creator, even though someone else submitted
  });

  it("the owner may approve their own, so a single-owner company is never locked out; rejection is not restricted", async () => {
    const mine = await submitted(userA);
    expect(await code(a.approveExpense(mine, userA))).toBe("OK");
    const theirs = await submitted(admin1);
    expect(await code(as("admin", admin1).rejectExpense(theirs, "withdrawn by me", admin1))).toBe("OK");
  });

  it("a manager cannot approve at all, as before", async () => {
    const id = await submitted(admin1);
    expect(await code(as("manager", clerk).approveExpense(id, clerk))).toBe("FORBIDDEN");
  });
});

describe("overdue is computed, not stored", () => {
  it("flags posted unpaid invoices past due on the list, detail and unpaid list; paid and future ones are not flagged", async () => {
    const late = await post(40, "TND", "2026-01-10");
    const future = await post(40, "TND", "2099-01-10");
    const settled = await post(40, "TND", "2026-01-10");
    await a.allocatePayment(await pay(40), [{ invoiceId: settled, amount: 40 }], userA);
    const list = await a.listInvoices();
    const flag = (id: string) => list.find((i) => i.id === id)?.isOverdue;
    expect([flag(late), flag(future), flag(settled)]).toEqual([true, false, false]);
    expect((await a.getInvoice(late)).isOverdue).toBe(true);
    expect((await a.getInvoice(late)).status).toBe("posted"); // the stored status machine is unchanged
    expect((await a.listUnpaidInvoices()).find((i) => i.id === late)?.isOverdue).toBe(true);
  });
});

describe("draft invoices can be edited and deleted; posted ones cannot", () => {
  const draftInput = (unitPrice: number) => ({ customerId: customer, currency: "TND", issueDate: "2026-11-01", lines: [{ description: "Edit me", quantity: 2, unitPrice, taxRate: 19 }] });

  it("editing a draft replaces its lines and recomputes totals", async () => {
    const id = await a.createInvoiceDraft(draftInput(10), userA);
    await a.updateInvoiceDraft(id, { ...draftInput(0), lines: [{ description: "New line", quantity: 3, unitPrice: 19.99, taxRate: 19 }], dueDate: "2026-12-01" }, userA);
    const got = await a.getInvoice(id);
    expect(got).toMatchObject({ status: "draft", total: 71.36, balance: 71.36, dueDate: "2026-12-01" });
    expect(got.lines.map((l: { description: string }) => l.description)).toEqual(["New line"]);
  });

  it("posted invoices cannot be edited or deleted, and another company's draft is not found", async () => {
    const posted = await post(30);
    expect(await code(a.updateInvoiceDraft(posted, draftInput(99), userA))).toBe("INVALID_TRANSITION");
    expect(await code(a.deleteInvoiceDraft(posted))).toBe("INVALID_TRANSITION");
    expect((await a.getInvoice(posted)).total).toBe(30);
    const theirCustomer = await b.createCustomer({ name: "B edit probe" }, userB);
    const theirs = await mk(b, theirCustomer, 5, userB);
    expect(await code(a.updateInvoiceDraft(theirs, draftInput(1), userA))).toBe("NOT_FOUND");
    expect(await code(a.deleteInvoiceDraft(theirs))).toBe("NOT_FOUND");
  });

  it("an edit cannot point the draft at another company's customer", async () => {
    const id = await a.createInvoiceDraft(draftInput(10), userA);
    const theirCustomer = await b.createCustomer({ name: "B customer probe" }, userB);
    expect(await code(a.updateInvoiceDraft(id, { ...draftInput(10), customerId: theirCustomer }, userA))).toBe("NOT_FOUND");
  });

  it("deleting a draft removes it", async () => {
    const id = await a.createInvoiceDraft(draftInput(10), userA);
    await a.deleteInvoiceDraft(id);
    expect(await code(a.getInvoice(id))).toBe("NOT_FOUND");
  });
});

describe("draft and rejected expenses can be edited and deleted; the rest are locked", () => {
  const base = { expenseDate: "2026-11-02", description: "Taxi", amount: 10, tax: 1.9, currency: "TND" };

  it("editing a rejected expense puts it back to draft and clears the rejection", async () => {
    const id = await a.createExpense(base, userA);
    await a.submitExpense(id, userA);
    await a.rejectExpense(id, "missing receipt", userA);
    await a.updateExpense(id, { ...base, amount: 12.5, tax: 2.38 }, userA);
    expect(await a.getExpense(id)).toMatchObject({ status: "draft", amount: 12.5, total: 14.88, rejectionReason: undefined });
  });

  it("submitted, approved and paid expenses cannot be edited or deleted", async () => {
    const id = await a.createExpense(base, userA);
    await a.submitExpense(id, userA);
    expect(await code(a.updateExpense(id, base, userA))).toBe("INVALID_TRANSITION");
    expect(await code(a.deleteExpense(id))).toBe("INVALID_TRANSITION");
    await a.approveExpense(id, userA);
    expect(await code(a.deleteExpense(id))).toBe("INVALID_TRANSITION");
  });

  it("another company's expense and category are not reachable", async () => {
    const theirs = await b.createExpense(base, userB);
    expect(await code(a.updateExpense(theirs, base, userA))).toBe("NOT_FOUND");
    expect(await code(a.deleteExpense(theirs))).toBe("NOT_FOUND");
    const theirCategory = await b.createExpenseCategory("B only");
    const mine = await a.createExpense(base, userA);
    expect(await code(a.updateExpense(mine, { ...base, categoryId: theirCategory }, userA))).toBe("NOT_FOUND");
  });

  it("deleting a draft removes it", async () => {
    const id = await a.createExpense(base, userA);
    await a.deleteExpense(id);
    expect(await code(a.getExpense(id))).toBe("NOT_FOUND");
  });
});

describe("timbre fiscal, duplicate and credit notes", () => {
  const lines = [{ description: "Service", quantity: 1, unitPrice: 100, taxRate: 19 }];

  it("the timbre fiscal adds 1.000 to TND invoices only, and is kept on edit", async () => {
    const tnd = await a.createInvoiceDraft({ customerId: customer, currency: "TND", issueDate: "2026-11-01", lines, stampDuty: true }, userA);
    expect(await a.getInvoice(tnd)).toMatchObject({ subtotal: 100, taxTotal: 19, stampDuty: 1, total: 120, balance: 120 });
    const eur = await a.createInvoiceDraft({ customerId: customer, currency: "EUR", issueDate: "2026-11-01", lines, stampDuty: true }, userA);
    expect(await a.getInvoice(eur)).toMatchObject({ stampDuty: 0, total: 119 });
    await a.updateInvoiceDraft(tnd, { customerId: customer, currency: "TND", issueDate: "2026-11-01", lines, stampDuty: false }, userA);
    expect(await a.getInvoice(tnd)).toMatchObject({ stampDuty: 0, total: 119 });
  });

  it("duplicate makes a new draft dated today with the same payment period", async () => {
    const src = await a.createInvoiceDraft({ customerId: customer, currency: "TND", issueDate: "2026-01-01", dueDate: "2026-01-31", lines, stampDuty: true }, userA);
    await a.postInvoice(src, userA);
    const copy = await a.getInvoice(await a.duplicateInvoice(src, userA));
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Tunis" }).format(new Date());
    expect(copy).toMatchObject({ status: "draft", issueDate: today, total: 120, stampDuty: 1 });
    expect((Date.parse(copy.dueDate!) - Date.parse(copy.issueDate)) / 86_400_000).toBe(30);
    expect(copy.invoiceNumber).not.toBe((await a.getInvoice(src)).invoiceNumber);
  });

  it("a credit note lowers the balance with its own number; full credit with no payment marks it credited", async () => {
    const inv = await post(200);
    const first = await a.createCreditNote(inv, { amount: 50, reason: "agreed discount" }, userA);
    expect(first.number).toMatch(/^CN-\d{4}-\d{5}$/);
    expect(await a.getInvoice(inv)).toMatchObject({ balance: 150, creditedAmount: 50, status: "posted" });
    await a.createCreditNote(inv, { amount: 150, reason: "order cancelled" }, userA);
    expect(await a.getInvoice(inv)).toMatchObject({ balance: 0, creditedAmount: 200, status: "credited" });
    expect((await a.listCreditNotes(inv)).map((n) => n.amount)).toEqual([50, 150]);
    expect((await a.listUnpaidInvoices()).some((i) => i.id === inv)).toBe(false);
  });

  it("a partly paid invoice credited to zero is paid; credits never exceed the balance, even when racing", async () => {
    const inv = await post(100);
    await a.allocatePayment(await pay(40), [{ invoiceId: inv, amount: 40 }], userA);
    expect(await code(a.createCreditNote(inv, { amount: 61, reason: "too much" }, userA))).toBe("VALIDATION_ERROR");
    const results = await Promise.all([1, 2].map(() => code(a.createCreditNote(inv, { amount: 60, reason: "race" }, userA))));
    expect(results.filter((r) => r === "OK")).toHaveLength(1);
    expect(await a.getInvoice(inv)).toMatchObject({ balance: 0, status: "paid", amountPaid: 40, creditedAmount: 60 });
    const draft = await a.createInvoiceDraft({ customerId: customer, currency: "TND", issueDate: "2026-11-01", lines }, userA);
    expect(await code(a.createCreditNote(draft, { amount: 1, reason: "draft" }, userA))).toBe("INVALID_TRANSITION");
    expect(await code(as("manager", userA).createCreditNote(inv, { amount: 1, reason: "no right" }, userA))).toBe("FORBIDDEN");
  });
});

describe("invoice search", () => {
  it("finds by number or customer name, filters overdue, pages, and stays inside the company", async () => {
    const zed = await a.createCustomer({ name: "Zebra Search SARL" }, userA);
    const late = await a.createInvoiceDraft({ customerId: zed, currency: "TND", issueDate: "2026-01-01", dueDate: "2026-01-15", lines: [{ description: "x", quantity: 1, unitPrice: 5 }] }, userA);
    await a.postInvoice(late, userA);
    await a.createInvoiceDraft({ customerId: zed, currency: "TND", issueDate: "2026-11-01", lines: [{ description: "y", quantity: 1, unitPrice: 5 }] }, userA);
    const byName = await a.searchInvoices({ q: "zebra" });
    expect(byName.total).toBe(2);
    const number = (await a.getInvoice(late)).invoiceNumber;
    expect((await a.searchInvoices({ q: number })).rows.map((r) => r.id)).toEqual([late]);
    expect((await a.searchInvoices({ q: "zebra", status: "overdue" })).rows.map((r) => r.id)).toEqual([late]);
    expect((await a.searchInvoices({ q: "zebra", status: "draft" })).total).toBe(1);
    expect((await a.searchInvoices({ q: "(.*" })).total).toBe(0); // regex characters are searched literally
    expect((await b.searchInvoices({ q: "zebra" })).total).toBe(0);
    const all = await a.searchInvoices({});
    expect(all.rows.length).toBeLessThanOrEqual(25);
    expect(all.totalPages).toBe(Math.max(1, Math.ceil(all.total / 25)));
  });
});

describe("reversing an allocation, and payments after a credit note", () => {
  it("a payment after a credit note lowers the balance from what is left, not from the total", async () => {
    const inv = await post(100);
    await a.createCreditNote(inv, { amount: 30, reason: "discount" }, userA);
    await a.allocatePayment(await pay(70), [{ invoiceId: inv, amount: 70 }], userA);
    expect(await a.getInvoice(inv)).toMatchObject({ amountPaid: 70, creditedAmount: 30, balance: 0, status: "paid" });
  });

  it("reversal puts the money back on the payment and the invoice, keeps a record, and happens once", async () => {
    const inv = await post(80);
    const p = await pay(80);
    await a.allocatePayment(p, [{ invoiceId: inv, amount: 80 }], userA);
    const alloc = (await a.getInvoice(inv)).allocations[0];
    expect(await code(a.reverseAllocation(alloc.id, "", userA))).toBe("VALIDATION_ERROR");
    const results = await Promise.all([1, 2].map(() => code(a.reverseAllocation(alloc.id, "wrong invoice", userA))));
    expect(results.filter((r) => r === "OK")).toHaveLength(1);
    const after = await a.getInvoice(inv);
    expect(after).toMatchObject({ amountPaid: 0, balance: 80, status: "posted" });
    expect(after.allocations[0]).toMatchObject({ reversalReason: "wrong invoice" });
    expect((await a.listPayments()).find((x) => x.id === p)?.unallocatedAmount).toBe(80);
    expect(await code(as("manager", userA).reverseAllocation(alloc.id, "no right", userA))).toBe("FORBIDDEN");
    expect(await code(b.reverseAllocation(alloc.id, "other company", userB))).toBe("NOT_FOUND");
  });
});

describe("audit trail", () => {
  it("records who did each finance write, with safe facts only", async () => {
    const auditor = new ObjectId().toHexString();
    const svc = new FinanceService({ companyId: h.ctx().companyId.toHexString(), companyRole: "owner", userId: auditor });
    const c = await svc.createCustomer({ name: "Audited Co", notes: "private note" }, auditor);
    const inv = await svc.createInvoiceDraft({ customerId: c, currency: "TND", issueDate: "2026-11-01", lines: [{ description: "Secret project", quantity: 1, unitPrice: 50 }] }, auditor);
    await svc.postInvoice(inv, auditor);
    const p = await svc.recordPayment({ paymentDate: "2026-11-02", amount: 50, currency: "TND", method: "cash" }, auditor);
    await svc.allocatePayment(p, [{ invoiceId: inv, amount: 50 }], auditor);
    const events = await h.db.collection("audit_events").find({ actorUserId: new ObjectId(auditor) }).sort({ occurredAt: 1 }).toArray();
    expect(events.map((e) => e.action)).toEqual(["finance.customer.created", "finance.invoice.created", "finance.invoice.posted", "finance.payment.recorded", "finance.payment.allocated"]);
    expect(events.every((e) => String(e.companyId) === String(h.ctx().companyId))).toBe(true);
    expect(JSON.stringify(events)).not.toMatch(/private note|Secret project/);
  });
});
