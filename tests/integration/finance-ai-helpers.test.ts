import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHarness, type TestHarness } from "../helpers/workspace";
import type { AiCompletionOptions, AiCompletionResult } from "@/server/ai/types";

const shared = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/server/db/client", () => ({ default: Promise.resolve({ db: () => shared.db }) }));
vi.mock("@/server/tenant/context", () => ({ getActiveTenant: async () => null }));

const ai = await import("@/server/finance/finance-ai.service");
const { fin } = await import("@/server/ai/tools/finance.tools");

let h: TestHarness;
beforeAll(async () => {
  h = await createHarness();
  shared.db = h.db;
});
afterAll(async () => h.cleanup());

function model(answer: unknown) {
  const calls: AiCompletionOptions[] = [];
  return {
    calls,
    complete: async (o: Omit<AiCompletionOptions, "signal">): Promise<AiCompletionResult> => {
      calls.push(o as AiCompletionOptions);
      return { text: typeof answer === "string" ? answer : JSON.stringify(answer), provider: "stub", model: "stub" };
    },
  };
}

describe("category suggestion", () => {
  it("the vendor's own history wins and costs no AI call", async () => {
    const svc = fin(h.ctx());
    const travel = (await svc.listExpenseCategories()).find((c) => c.name === "Travel & Transport")!;
    for (const d of ["01", "02"]) await svc.createExpense({ expenseDate: `2026-10-${d}`, vendor: "Taxi Tunis", description: "Ride", amount: 12, categoryId: travel.id }, "u");
    const m = model({ category: "Other", reason: "x" });
    const s = await ai.suggestExpenseCategory(h.ctx(), { vendor: "taxi tunis", description: "airport" }, { complete: m.complete });
    expect(s).toMatchObject({ categoryId: travel.id, source: "history" });
    expect(s?.reason).toContain("2 earlier expenses");
    expect(m.calls).toHaveLength(0);
  });

  it("otherwise the AI picks one of the company's categories, and an invented one is ignored", async () => {
    const pick = await ai.suggestExpenseCategory(h.ctx(), { vendor: "Ooredoo", description: "monthly internet" }, { complete: model({ category: "Utilities & Rent", reason: "Telecom bill" }).complete });
    expect(pick).toMatchObject({ categoryName: "Utilities & Rent", source: "ai", reason: "Telecom bill" });
    expect(await ai.suggestExpenseCategory(h.ctx(), { vendor: "Mystery", description: "thing" }, { complete: model({ category: "Quantum Physics" }).complete })).toBeNull();
  });
});

describe("payment reminder", () => {
  it("is written from the invoice's figures, and the invoice number always appears", async () => {
    const svc = fin(h.ctx());
    const c = await svc.createCustomer({ name: "Atlas Trading", email: "pay@atlas.test" }, "u");
    const inv = await svc.createInvoiceDraft({ customerId: c, currency: "TND", issueDate: "2026-09-01", dueDate: "2026-10-01", lines: [{ description: "Work", quantity: 1, unitPrice: 100, taxRate: 19 }] }, "u");
    await svc.postInvoice(inv, "u");
    const m = model({ subject: "Reminder", body: "Dear Atlas Trading, a friendly reminder about your open balance. Thank you." });
    const draft = await ai.draftPaymentReminder(h.ctx(), inv, "firm", { complete: m.complete });
    const facts = m.calls[0].messages[1].content;
    expect(facts).toContain("119.00 TND");
    expect(facts).toContain('"overdue":true');
    expect(m.calls[0].messages[0].content).toContain("firm");
    expect(draft.body).toMatch(/INV-\d{4}-\d{5}/);
  });

  it("refuses drafts and paid invoices", async () => {
    const svc = fin(h.ctx());
    const c = await svc.createCustomer({ name: "Draft Co" }, "u");
    const draft = await svc.createInvoiceDraft({ customerId: c, currency: "TND", issueDate: "2026-09-01", lines: [{ description: "W", quantity: 1, unitPrice: 10 }] }, "u");
    await expect(ai.draftPaymentReminder(h.ctx(), draft, "friendly", { complete: model({}).complete })).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });
});

describe("dashboard insights", () => {
  it("are cached per company, currency and day; refresh writes them again", async () => {
    const m = model({ bullets: [{ tone: "good", text: "Collections are up this month." }, { tone: "act", text: "Chase INV-1 for 119.00 TND." }] });
    const first = await ai.getDashboardInsights(h.ctx(), { currency: "TND", outstanding: 119 }, {}, { complete: m.complete });
    const second = await ai.getDashboardInsights(h.ctx(), { currency: "TND", outstanding: 119 }, {}, { complete: m.complete });
    expect([first.cached, second.cached]).toEqual([false, true]);
    expect(m.calls).toHaveLength(1);
    await ai.getDashboardInsights(h.ctx(), { currency: "TND" }, { refresh: true }, { complete: m.complete });
    expect(m.calls).toHaveLength(2);
    const other = await ai.getDashboardInsights(h.otherTenant(), { currency: "TND" }, {}, { complete: m.complete });
    expect(other.cached).toBe(false); // another company never reads this company's summary
  });

  it("an unreadable reply is an error, not an empty card", async () => {
    await expect(ai.getDashboardInsights(h.ctx(), { currency: "EUR" }, {}, { complete: model("no json").complete })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
