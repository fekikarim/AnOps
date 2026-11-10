import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHarness, type TestHarness } from "../helpers/workspace";
import { enableAi, seedMember, wsOf, type SeededMember } from "../helpers/ai";
import type { AiCompletionOptions, AiCompletionResult } from "@/server/ai/types";

const shared = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/server/db/client", () => ({ default: Promise.resolve({ db: () => shared.db }) }));
vi.mock("@/server/tenant/context", () => ({ getActiveTenant: async () => null }));

const { runTurn, scopedRegistry } = await import("@/server/ai/orchestrator");
const { aiToolRegistry } = await import("@/server/ai/tools");
const { fin } = await import("@/server/ai/tools/finance.tools");
type TurnEvent = Awaited<ReturnType<ReturnType<typeof runTurn>["next"]>>["value"];

let h: TestHarness;
let boss: SeededMember;
let viewer: SeededMember;
let other: SeededMember;

const FULL = { view: true, create: true, edit: true, delete: true, approve: true };

/** A scripted model: replies in order, and records every prompt it was shown. */
function scripted(...replies: object[]) {
  const seen: AiCompletionOptions[] = [];
  const queue = replies.map((r) => JSON.stringify(r));
  return {
    seen,
    complete: async (o: AiCompletionOptions): Promise<AiCompletionResult> => {
      seen.push(o);
      return { text: queue.shift() ?? JSON.stringify({ type: "final", text: "Done." }), provider: "stub", model: "stub", usage: { totalTokens: 30 } };
    },
  };
}
const drain = async (gen: AsyncGenerator<TurnEvent>) => {
  const out: TurnEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
};
const text = (events: TurnEvent[]) => JSON.stringify(events);

beforeAll(async () => {
  h = await createHarness();
  shared.db = h.db;
  boss = await seedMember(h.db, h.ctx().companyId, "owner");
  viewer = await seedMember(h.db, h.ctx().companyId, "employee");
  other = await seedMember(h.db, h.otherTenant().companyId, "owner");
  const all = { finance: FULL, inventory: FULL, hr: FULL, marketing: FULL, purchasing: FULL, manufacturing: FULL, community: FULL };
  await enableAi(h, wsOf(h, boss), all);
  await enableAi(h, wsOf(h, viewer), { finance: { view: true } });
  await enableAi(h, wsOf(h, other), all);
  await h.db.collection("companies").insertMany([{ _id: h.ctx().companyId, name: "A", currency: "TND" }, { _id: h.otherTenant().companyId, name: "B", currency: "TND" }]);
});
afterAll(async () => h.cleanup());

describe("Finance Copilot scope", () => {
  it("offers only finance and core tools to the model", async () => {
    const m = scripted({ type: "final", text: "Hello" });
    await drain(runTurn(wsOf(h, boss), { text: "hi", scope: "finance", page: "Invoices list" }, { complete: m.complete }));
    const prompt = m.seen[0].messages[0].content;
    expect(prompt).toContain("Finance Copilot");
    expect(prompt).toContain('"Invoices list"');
    expect(prompt).toContain("finance_cashflow_forecast");
    expect(prompt).not.toMatch(/inventory_|hr_|marketing_|purchasing_/);
  });

  it("refuses a tool from another module even if the model asks for it", async () => {
    const scoped = scopedRegistry(aiToolRegistry, "finance");
    expect(scoped.get("inventory_list_products")).toBeUndefined();
    expect(scoped.get("finance_list_invoices")).toBeDefined();
    const m = scripted({ type: "tool", tool: "inventory_list_products", args: {} }, { type: "final", text: "ok" });
    const events = await drain(runTurn(wsOf(h, boss), { text: "list products", scope: "finance" }, { complete: m.complete }));
    expect(text(events)).not.toContain('"tool":"inventory_list_products","status":"done"');
  });

  it("refuses another module's slash command, but keeps it in the full AI workspace", async () => {
    const scopedRun = await drain(runTurn(wsOf(h, boss), { text: "/products", scope: "finance" }, { complete: scripted().complete }));
    expect(text(scopedRun)).toContain("does not exist or is not available");
    const fullRun = await drain(runTurn(wsOf(h, boss), { text: "/products" }, { complete: scripted().complete }));
    expect(text(fullRun)).not.toContain("does not exist or is not available");
  });
});

describe("Finance Copilot tools", () => {
  it("the forecast and aging tools answer from this company's books only", async () => {
    const svc = fin(wsOf(h, boss));
    const c = await svc.createCustomer({ name: "Late Payer" }, "u");
    const inv = await svc.createInvoiceDraft({ customerId: c, currency: "TND", issueDate: "2026-08-01", dueDate: "2026-08-15", lines: [{ description: "W", quantity: 1, unitPrice: 250 }] }, "u");
    await svc.postInvoice(inv, "u");
    const theirs = fin(wsOf(h, other));
    const tc = await theirs.createCustomer({ name: "Other Co Customer" }, "u");
    const ti = await theirs.createInvoiceDraft({ customerId: tc, currency: "TND", issueDate: "2026-08-01", dueDate: "2026-08-15", lines: [{ description: "W", quantity: 1, unitPrice: 999 }] }, "u");
    await theirs.postInvoice(ti, "u");

    const m = scripted({ type: "tool", tool: "finance_aging_report", args: {} }, { type: "final", text: "Late Payer owes 250." });
    const events = await drain(runTurn(wsOf(h, boss), { text: "show aging", scope: "finance" }, { complete: m.complete }));
    const all = text(events);
    expect(all).toContain("Receivables aging");
    expect(all).toContain("250.00");
    expect(all).not.toContain("999.00");
    // What the model was shown after the tool ran is this company's data, too.
    expect(JSON.stringify(m.seen.at(-1)!.messages)).toContain("Late Payer");
    expect(JSON.stringify(m.seen.at(-1)!.messages)).not.toContain("Other Co Customer");
  });

  it("a viewer can read but every write only becomes a proposal, never a change", async () => {
    const before = (await fin(wsOf(h, boss)).listCustomers()).length;
    const m = scripted({ type: "tool", tool: "finance_create_customer", args: { name: "Sneaky Ltd" } }, { type: "final", text: "Customer created." });
    const asViewer = await drain(runTurn(wsOf(h, viewer), { text: "create customer Sneaky Ltd", scope: "finance" }, { complete: m.complete }));
    expect((await fin(wsOf(h, boss)).listCustomers()).length).toBe(before);
    expect(text(asViewer)).not.toContain("Customer created.");

    const m2 = scripted({ type: "tool", tool: "finance_create_customer", args: { name: "Proposed Ltd" } }, { type: "final", text: "Please confirm." });
    const asBoss = await drain(runTurn(wsOf(h, boss), { text: "create customer Proposed Ltd", scope: "finance" }, { complete: m2.complete }));
    // A write is offered as a review form or a confirmation card; either way nothing is saved yet.
    expect(asBoss.some((e) => e.type === "part" && (e.part.type === "confirmation" || e.part.type === "form"))).toBe(true);
    expect((await fin(wsOf(h, boss)).listCustomers()).some((c) => c.name === "Proposed Ltd")).toBe(false);
  });

  it("the expense-flags tool explains duplicates found by code", async () => {
    const svc = fin(wsOf(h, boss));
    for (let k = 0; k < 2; k++) await svc.createExpense({ expenseDate: "2026-10-14", vendor: "Twin Shop", description: "Same thing", amount: 30, currency: "TND" }, "u");
    const m = scripted({ type: "tool", tool: "finance_expense_flags", args: {} }, { type: "final", text: "Two look duplicated." });
    const events = await drain(runTurn(wsOf(h, boss), { text: "anything odd in expenses?", scope: "finance" }, { complete: m.complete }));
    expect(text(events)).toContain("Possible duplicate");
  });
});
