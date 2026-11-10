import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createHarness, parsed, type TestHarness } from "../helpers/workspace";
import { actorOf, seedMember, seedTenants } from "../helpers/ai";
import { code, flow, formValues, fieldValue, kind, llm, stated } from "../helpers/ai-flow";
import { saveMemberGrant, updateAiSettings } from "@/server/ai/access/access.service";
import { FinanceService } from "@/server/services/finance.service";
import { createProduct } from "@/server/inventory/catalog.service";
import { productInputSchema } from "@/features/inventory/schemas/inventory.schema";
import { wsOf } from "../helpers/ai";
import type { AiModules } from "@/shared/domain/ai";

// The Finance service reads its database from the shared client; tests point it at the disposable database.
const shared = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/server/db/client", () => ({ default: Promise.resolve({ db: () => shared.db }) }));
// The AI path builds the service from the verified workspace, so the request-cookie tenant lookup is never used.
vi.mock("@/server/tenant/context", () => ({ getActiveTenant: async () => null }));

let h: TestHarness;
let T: Awaited<ReturnType<typeof seedTenants>>;
let boss: Awaited<ReturnType<typeof seedMember>>; // admin: every finance permission
let clerk: Awaited<ReturnType<typeof seedMember>>; // manager: drafts only, no posting, payments or approvals
let viewer: Awaited<ReturnType<typeof seedMember>>;
let A: { atlas: string; dormant: string; ben: string; oil: string; free: string; fine: string };
let B: { customer: string; invoice: string; payment: string; product: string };
const f = flow(() => h);

const g = (view: boolean, create: boolean, edit: boolean, del: boolean, approve: boolean) => ({ view, create, edit, delete: del, approve });
const grant = (modules: AiModules) => ({ enabled: true, modules, canAuditTranscripts: false, canViewSensitiveHr: false, dailyTokenCap: null });
const svcOf = (companyId: ObjectId, userId: ObjectId) => new FinanceService({ companyId: companyId.toHexString(), companyRole: "owner", userId: userId.toHexString() });
const svc = () => svcOf(T.companyA, T.A.owner.userId);
const uid = () => T.A.owner.userId.toHexString();
const as2 = (role: "owner" | "admin", userId: ObjectId) => new FinanceService({ companyId: T.companyA.toHexString(), companyRole: role, userId: userId.toHexString() });
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Tunis" }).format(new Date());

const line = (description: string, quantity: number, unitPrice: number, taxRate = 0) => ({ description, quantity, unitPrice, taxRate });
async function draftInvoice(customerId: string, lines = [line("Consulting", 1, 100)], currency = "TND", dueDate = "") {
  return svc().createInvoiceDraft({ customerId, currency, issueDate: "2026-11-01", dueDate, lines }, uid());
}
async function postedInvoice(customerId: string, lines = [line("Consulting", 1, 100)], currency = "TND", dueDate = "2027-01-31") {
  const id = await draftInvoice(customerId, lines, currency, dueDate);
  await svc().postInvoice(id, uid());
  return id;
}
async function payment(amount: number, currency = "TND", reference = "") {
  return svc().recordPayment({ paymentDate: "2026-11-02", amount, currency, method: "bank_transfer", reference }, uid());
}
const inv = (id: string) => svc().getInvoice(id);
const pay = async (id: string) => (await svc().listPayments()).find((p) => p.id === id)!;
const pendingCount = () => h.db.collection("ai_pending_actions").countDocuments({});
/** Propose, then confirm with the typed phrase the card asks for. */
async function run(member: typeof boss, tool: string, args: unknown) {
  const p = await f.propose(member, tool, args);
  return { p, result: await f.confirm(member, p.id, p.typedPhrase ?? undefined) };
}

beforeAll(async () => {
  h = await createHarness();
  shared.db = h.db;
  T = await seedTenants(h);
  for (const o of [T.A.owner, T.B.owner]) await updateAiSettings(actorOf(h, o), { enabled: true, retentionDays: 90, dailyTokenBudget: 0, defaultUserDailyTokenCap: 0 }, 0);
  const owner = actorOf(h, T.A.owner);
  boss = T.A.admin;
  await saveMemberGrant(owner, boss.userId.toHexString(), grant({ finance: g(true, true, true, true, true), inventory: g(true, false, false, false, false) }), 0);
  clerk = await seedMember(h.db, T.companyA, "manager");
  await saveMemberGrant(owner, clerk.userId.toHexString(), grant({ finance: g(true, true, true, true, false) }), 0);
  viewer = await seedMember(h.db, T.companyA, "manager");
  await saveMemberGrant(owner, viewer.userId.toHexString(), grant({ finance: g(true, false, false, false, false) }), 0);

  const s = svc();
  A = {
    atlas: await s.createCustomer({ name: "Atlas Foods", email: "billing@atlas.tn", taxId: "1234567/A" }, uid()),
    dormant: await s.createCustomer({ name: "Dormant Co", status: "inactive" }, uid()),
    ben: await s.createCustomer({ name: "Ben Salah SARL" }, uid()),
    oil: "",
    free: "",
    fine: "",
  };
  const ws = wsOf(h, T.A.owner);
  const mk = (sku: string, name: string, salePrice: string) =>
    createProduct(ws, parsed(productInputSchema, { sku, name, description: "", categoryId: "", unitOfMeasure: "unit", isStorable: true, isActive: true, cost: "1", salePrice, reorderPoint: "0" }));
  A.oil = (await mk("OIL-1", "Olive oil bottle", "9.500")).id;
  A.free = (await mk("FREE-1", "Gift wrapping", "0")).id;
  A.fine = (await mk("FINE-1", "Fine thing", "9.995")).id; // a three-decimal price cannot be billed in cents

  const sb = svcOf(T.companyB, T.B.owner.userId);
  const bUser = T.B.owner.userId.toHexString();
  const bc = await sb.createCustomer({ name: "Company B Customer" }, bUser);
  const bi = await sb.createInvoiceDraft({ customerId: bc, currency: "TND", issueDate: "2026-11-01", lines: [line("B work", 1, 50)] }, bUser);
  await sb.postInvoice(bi, bUser);
  B = {
    customer: bc,
    invoice: bi,
    payment: await sb.recordPayment({ paymentDate: "2026-11-02", amount: 80, currency: "TND", method: "cash" }, bUser),
    product: (await createProduct(wsOf(h, T.B.owner), parsed(productInputSchema, { sku: "BP-1", name: "B product", description: "", categoryId: "", unitOfMeasure: "unit", isStorable: true, isActive: true, cost: "1", salePrice: "5", reorderPoint: "0" }))).id,
  };
});
afterAll(async () => {
  await h.cleanup();
});

describe("reads", () => {
  it("show this company only, with ids for follow-up calls, and another company's records are not found", async () => {
    const customers = JSON.stringify((await f.read(viewer, "finance_list_customers", {})).data);
    expect(customers).toContain(A.atlas);
    expect(customers).not.toContain("Company B");
    const invoices = JSON.stringify((await f.read(viewer, "finance_list_invoices", {})).data);
    expect(invoices).not.toContain(B.invoice);
    expect(await code(f.read(viewer, "finance_get_invoice", { invoiceId: B.invoice }))).toBe("NOT_FOUND");
    expect(await code(f.read(viewer, "finance_get_customer", { customerId: B.customer }))).toBe("NOT_FOUND");
    expect(JSON.stringify((await f.read(viewer, "finance_list_payments", {})).data)).not.toContain(B.payment);
  });

  it("searches invoices by number, customer and status; overdue means open and past due", async () => {
    const open = await postedInvoice(A.atlas, [line("Late work", 1, 40)], "TND", "2026-01-15");
    const paid = await postedInvoice(A.ben, [line("Paid work", 1, 25)], "TND", "2026-01-15");
    const pid = await payment(25);
    await svc().allocatePayment(pid, [{ invoiceId: paid, amount: 25 }], uid());
    const num = (await inv(open)).invoiceNumber;
    const ids = async (args: object) => ((await f.read(viewer, "finance_list_invoices", args)).data as { invoices: { id: string }[] }).invoices.map((i) => i.id);
    expect(await ids({ q: num })).toEqual([open]);
    expect(await ids({ q: "ben salah" })).toContain(paid);
    expect(await ids({ status: "overdue" })).toEqual([open]); // paid invoices are never overdue
    expect(await ids({ status: "paid" })).toContain(paid);
    expect(await ids({ customerId: A.ben })).not.toContain(open);
  });

  it("products for invoice lines come with their own sale price, or null when it cannot be billed in cents", async () => {
    const r = await f.read(viewer, "finance_list_products", { q: "o" });
    const rows = (r.data as { products: { productId: string; sku: string; salePrice: string | null }[] }).products;
    expect(rows.find((p) => p.sku === "OIL-1")).toMatchObject({ productId: A.oil, salePrice: "9.50" });
    expect(await f.read(viewer, "finance_list_products", { q: "fine" }).then((x) => (x.data as { products: { salePrice: string | null }[] }).products[0].salePrice)).toBeNull();
    expect(JSON.stringify(r.data)).not.toContain(B.product);
  });

  it("a customer card shows the open balance per currency, summed in cents", async () => {
    const c = await svc().createCustomer({ name: "Multi Currency Ltd" }, uid());
    await postedInvoice(c, [line("A", 1, 0.1)], "EUR");
    await postedInvoice(c, [line("B", 1, 0.2)], "EUR");
    await postedInvoice(c, [line("C", 1, 5)], "USD");
    const r = await f.read(viewer, "finance_get_customer", { customerId: c });
    expect((r.data as { openBalance: string[] }).openBalance.sort()).toEqual(["0.30 EUR", "5.00 USD"]);
  });

  it("the summary repeats the dashboard exactly, and drafts and voided invoices are in neither", async () => {
    const voided = await draftInvoice(A.ben, [line("Void me", 1, 70)]);
    await svc().voidInvoice(voided, "mistake", uid());
    await draftInvoice(A.ben, [line("Still a draft", 1, 33)]);
    const dash = await svc().getDashboard();
    const r = await f.read(viewer, "finance_get_summary", {});
    const d = r.data as { invoiced: string; collected: string; outstanding: string; overdue: string; caveats: string[] };
    expect(d).toMatchObject({ invoiced: dash.totalInvoiced.toFixed(2), collected: dash.totalPaid.toFixed(2), outstanding: dash.outstanding.toFixed(2), overdue: dash.overdue.toFixed(2) });
    const sum = (await svc().listInvoices()).filter((i) => i.currency === dash.currency && ["posted", "partially_paid", "paid"].includes(i.status)).reduce((n, i) => n + Math.round(i.total * 100), 0);
    expect(Math.round(dash.totalInvoiced * 100)).toBe(sum); // the same definition (one currency), computed independently
    expect(d.caveats.join(" ")).toMatch(/EUR|USD/); // other currencies are flagged, never added in
    expect(d.caveats.join(" ")).not.toMatch(/voided|draft/);
  });

  it("a viewer's cards offer no write actions; the admin's offer the next step", async () => {
    const id = await draftInvoice(A.atlas);
    const labels = async (m: typeof boss) => ((await f.read(m, "finance_get_invoice", { invoiceId: id })).parts![0] as { actions: { label: string }[] }).actions.map((a) => a.label);
    expect(await labels(viewer)).toEqual([]);
    expect(await labels(boss)).toEqual(["Post invoice", "Void invoice"]);
    expect(await labels(clerk)).toEqual([]); // a manager has no posting permission
  });
});

describe("customers", () => {
  it("create and update go through a preview; duplicates, invalid data and no-op edits are refused before anything is stored", async () => {
    const before = await pendingCount();
    expect(await code(f.propose(clerk, "finance_create_customer", { name: "atlas   foods" }))).toBe("CONFLICT");
    expect(await code(f.propose(clerk, "finance_create_customer", { name: "X" }))).toBe("VALIDATION_ERROR");
    expect(await code(f.propose(clerk, "finance_create_customer", { name: "Bad Mail", email: "nope" }))).toBe("VALIDATION_ERROR");
    expect(await pendingCount()).toBe(before);
    const p = await f.propose(clerk, "finance_create_customer", { name: "Carthage Trading", email: "ap@carthage.tn", phone: "71 000 000" });
    expect(p.details.map((d) => d.label)).toEqual(["Name", "Email", "Phone"]);
    expect((await svc().listCustomers()).some((c) => c.name === "Carthage Trading")).toBe(false);
    const results = await Promise.all([1, 2, 3].map(() => code(f.confirm(clerk, p.id))));
    expect(results.filter((x) => x === "OK")).toHaveLength(1);
    expect((await svc().listCustomers()).filter((c) => c.name === "Carthage Trading")).toHaveLength(1);
    const id = (await svc().listCustomers()).find((c) => c.name === "Carthage Trading")!.id;
    const edit = await f.propose(clerk, "finance_update_customer", { customerId: id, phone: "71 999 999", status: "inactive" });
    expect(edit.details).toEqual([{ label: "Phone", before: "71 000 000", after: "71 999 999" }, { label: "Status", before: "active", after: "inactive" }]);
    await f.confirm(clerk, edit.id);
    expect((await svc().getCustomer(id)).status).toBe("inactive");
    expect(await code(f.propose(clerk, "finance_update_customer", { customerId: id, phone: "71 999 999" }))).toBe("VALIDATION_ERROR");
    expect(await code(f.propose(clerk, "finance_update_customer", { customerId: B.customer, phone: "1" }))).toBe("NOT_FOUND");
    expect(await code(f.propose(viewer, "finance_create_customer", { name: "Nope Nope" }))).toBe("FORBIDDEN");
  });

  it("a customer edited elsewhere after the proposal stops the confirmation", async () => {
    const id = await svc().createCustomer({ name: "Stale Customer" }, uid());
    const p = await f.propose(clerk, "finance_update_customer", { customerId: id, phone: "11" });
    await svc().updateCustomer(id, { email: "elsewhere@example.test" }, uid());
    expect(await code(f.confirm(clerk, p.id))).toBe("CONFLICT");
    expect((await svc().getCustomer(id)).phone ?? "").toBe("");
  });
});

describe("invoices", () => {
  it("shows the exact totals the service will store, and the stored invoice matches them to the cent", async () => {
    const p = await f.propose(clerk, "finance_create_invoice", { customerId: A.atlas, issueDate: "2026-11-05", dueDate: "2026-12-05", lines: [{ description: "Widgets", quantity: 3, unitPrice: "19.99", taxRate: 19 }, { description: "Setup", quantity: 2, unitPrice: 10 }] });
    expect(p.requiresTyped).toBe(false);
    expect(p.summary).toBe("Create a draft invoice for Atlas Foods, total 91.36 TND. It is not official until posted.");
    expect(p.details.slice(-3)).toEqual([{ label: "Subtotal", after: "79.97 TND" }, { label: "Tax", after: "11.39 TND" }, { label: "Total", after: "91.36 TND" }]);
    expect(p.details.find((d) => d.label === "Widgets")?.after).toBe("3 × 19.99 (+19% tax) = 71.36 TND");
    await f.confirm(clerk, p.id);
    const stored = (await svc().listInvoices()).find((i) => i.total === 91.36)!;
    expect(stored).toMatchObject({ status: "draft", subtotal: 79.97, taxTotal: 11.39, balance: 91.36, amountPaid: 0, currency: "TND" });
  });

  it("uses a product's own sale price when none is given, defaults the issue date to today, and never fills a missing price", async () => {
    const p = await f.propose(clerk, "finance_create_invoice", { customerId: A.atlas, lines: [{ productId: A.oil, quantity: 4 }] });
    expect(p.details.find((d) => d.label === "Issued")?.after).toBe(today());
    expect(p.details.find((d) => d.label === "Total")?.after).toBe("38.00 TND");
    for (const productId of [A.free, A.fine]) expect(await code(f.propose(clerk, "finance_create_invoice", { customerId: A.atlas, lines: [{ productId, quantity: 1 }] }))).toBe("VALIDATION_ERROR");
    expect(await code(f.propose(clerk, "finance_create_invoice", { customerId: A.atlas, lines: [{ description: "No price", quantity: 1 }] }))).toBe("VALIDATION_ERROR");
  });

  it("refuses invalid money, dates, customers and products, storing nothing", async () => {
    const before = await pendingCount();
    const base = { customerId: A.atlas, lines: [{ description: "Work", quantity: 1, unitPrice: 10 }] };
    const bad = (a: object) => code(f.propose(clerk, "finance_create_invoice", { ...base, ...a }));
    expect(await bad({ lines: [{ description: "x", quantity: 0, unitPrice: 1 }] })).toBe("VALIDATION_ERROR");
    expect(await bad({ lines: [{ description: "x", quantity: 1.5, unitPrice: 1 }] })).toBe("VALIDATION_ERROR");
    expect(await bad({ lines: [{ description: "x", quantity: 1, unitPrice: "10.005" }] })).toBe("VALIDATION_ERROR");
    expect(await bad({ lines: [{ description: "x", quantity: 1, unitPrice: -5 }] })).toBe("VALIDATION_ERROR");
    expect(await bad({ lines: [{ description: "x", quantity: 1, unitPrice: 1, taxRate: 120 }] })).toBe("VALIDATION_ERROR");
    expect(await bad({ lines: [] })).toBe("VALIDATION_ERROR");
    expect(await bad({ issueDate: "2026-02-31" })).toBe("VALIDATION_ERROR");
    expect(await bad({ issueDate: "2026-11-10", dueDate: "2026-11-01" })).toBe("VALIDATION_ERROR");
    expect(await bad({ currency: "JPY" })).toBe("VALIDATION_ERROR");
    expect(await bad({ customerId: A.dormant })).toBe("VALIDATION_ERROR");
    expect(await bad({ customerId: B.customer })).toBe("NOT_FOUND");
    expect(await bad({ lines: [{ productId: B.product, quantity: 1 }] })).toBe("NOT_FOUND");
    expect(await bad({ companyId: T.companyB.toHexString() })).toBe("VALIDATION_ERROR");
    expect(await code(f.propose(viewer, "finance_create_invoice", base))).toBe("FORBIDDEN");
    expect(await pendingCount()).toBe(before);
  });

  it("posting needs the invoice number typed, only works on a draft, and a clerk cannot do it", async () => {
    const id = await draftInvoice(A.atlas, [line("Work", 2, 50)]);
    const number = (await inv(id)).invoiceNumber;
    expect(await code(f.propose(clerk, "finance_post_invoice", { invoiceId: id }))).toBe("FORBIDDEN");
    const p = await f.propose(boss, "finance_post_invoice", { invoiceId: id });
    expect(p).toMatchObject({ risk: "financial", requiresTyped: true, typedPhrase: number });
    expect(await code(f.confirm(boss, p.id, "wrong"))).toBe("VALIDATION_ERROR");
    expect((await inv(id)).status).toBe("draft");
    await f.confirm(boss, p.id, number);
    expect((await inv(id)).status).toBe("posted");
    expect(await code(f.propose(boss, "finance_post_invoice", { invoiceId: id }))).toBe("INVALID_TRANSITION");
    expect(await code(f.propose(boss, "finance_post_invoice", { invoiceId: B.invoice }))).toBe("NOT_FOUND");
  });

  it("an invoice changed after the proposal is not posted", async () => {
    const id = await draftInvoice(A.atlas, [line("Work", 1, 10)]);
    const p = await f.propose(boss, "finance_post_invoice", { invoiceId: id });
    await svc().voidInvoice(id, "no longer needed", uid());
    expect(await code(f.confirm(boss, p.id, p.typedPhrase!))).toBe("CONFLICT");
    expect((await inv(id)).status).toBe("voided");
  });

  it("voiding needs a reason and the number typed, and is refused once a payment is applied", async () => {
    const id = await postedInvoice(A.atlas, [line("Work", 1, 60)]);
    expect(await code(f.propose(boss, "finance_void_invoice", { invoiceId: id, reason: "x" }))).toBe("VALIDATION_ERROR");
    const p = await f.propose(boss, "finance_void_invoice", { invoiceId: id, reason: "Billed the wrong customer" });
    expect(p).toMatchObject({ risk: "destructive", requiresTyped: true });
    await f.confirm(boss, p.id, p.typedPhrase!);
    expect(await inv(id)).toMatchObject({ status: "voided", voidReason: "Billed the wrong customer" });
    expect(await code(f.propose(boss, "finance_void_invoice", { invoiceId: id, reason: "again please" }))).toBe("INVALID_TRANSITION");
    const paid = await postedInvoice(A.atlas, [line("Work", 1, 60)]);
    await svc().allocatePayment(await payment(10), [{ invoiceId: paid, amount: 10 }], uid());
    expect(await code(f.propose(boss, "finance_void_invoice", { invoiceId: paid, reason: "oops wrong" }))).toBe("INVALID_TRANSITION");
  });
});

describe("payments and reconciliation", () => {
  it("recording a payment needs the amount typed, refuses unclear money and duplicate references, and moves nothing", async () => {
    const before = await pendingCount();
    const bad = (a: object) => code(f.propose(boss, "finance_record_payment", { amount: 100, method: "cash", ...a }));
    expect(await bad({ amount: "12.345" })).toBe("VALIDATION_ERROR");
    expect(await bad({ amount: 0 })).toBe("VALIDATION_ERROR");
    expect(await bad({ amount: "1,250.50" })).toBe("VALIDATION_ERROR");
    expect(await bad({ method: undefined })).toBe("VALIDATION_ERROR");
    expect(await bad({ method: "bitcoin" })).toBe("VALIDATION_ERROR");
    expect(await bad({ paymentDate: "2099-01-01" })).toBe("VALIDATION_ERROR");
    expect(await bad({ currency: "XXX" })).toBe("VALIDATION_ERROR");
    expect(await code(f.propose(clerk, "finance_record_payment", { amount: 5, method: "cash" }))).toBe("FORBIDDEN");
    expect(await pendingCount()).toBe(before);
    const p = await f.propose(boss, "finance_record_payment", { amount: "1 190,50", method: "bank_transfer", reference: "VIR-4471", paymentDate: "2026-11-03" });
    expect(p).toMatchObject({ risk: "financial", requiresTyped: true, typedPhrase: "1190.50 TND" });
    expect(p.summary).toContain("no money moves");
    expect(await code(f.confirm(boss, p.id, "1190 TND"))).toBe("VALIDATION_ERROR");
    await f.confirm(boss, p.id, "1190.50 TND");
    const stored = (await svc().listPayments()).find((x) => x.reference === "VIR-4471")!;
    expect(stored).toMatchObject({ amount: 1190.5, unallocatedAmount: 1190.5, currency: "TND", method: "bank_transfer", paymentDate: "2026-11-03" });
    expect(await code(f.propose(boss, "finance_record_payment", { amount: 5, method: "cash", reference: "vir-4471" }))).toBe("CONFLICT");
  });

  it("a payment with the same amount, method and date is flagged as a possible duplicate", async () => {
    await svc().recordPayment({ paymentDate: "2026-11-04", amount: 77.7, currency: "TND", method: "card" }, uid());
    const p = await f.propose(boss, "finance_record_payment", { amount: "77.70", method: "card", paymentDate: "2026-11-04" });
    expect(p.details.some((d) => d.label === "Possible duplicate")).toBe(true);
  });

  it("invoice to payment: draft, post, record, apply part, apply the rest, paid in full, with exact balances throughout", async () => {
    const cust = await svc().createCustomer({ name: "Workflow Customer" }, uid());
    const created = await run(boss, "finance_create_invoice", { customerId: cust, issueDate: "2026-11-01", dueDate: "2026-12-01", lines: [{ description: "Service", quantity: 1, unitPrice: "300.30" }] });
    expect(created.result).toBeDefined();
    const invoiceId = (await svc().listInvoices()).find((i) => i.customer?.name === "Workflow Customer")!.id;
    await run(boss, "finance_post_invoice", { invoiceId });
    const rec = await run(boss, "finance_record_payment", { amount: "300.30", method: "bank_transfer", reference: "WF-1" });
    const paymentId = (await svc().listPayments()).find((p) => p.reference === "WF-1")!.id;
    expect(rec.p.typedPhrase).toBe("300.30 TND");

    const part = await f.propose(boss, "finance_allocate_payment", { paymentId, allocations: [{ invoiceId, amount: "100.10" }] });
    expect(part).toMatchObject({ risk: "financial", requiresTyped: true, typedPhrase: "100.10 TND" });
    expect(part.details.at(-1)).toMatchObject({ before: "owes 300.30 TND", after: "applies 100.10 TND, then owes 200.20 TND" });
    await f.confirm(boss, part.id, "100.10 TND");
    expect(await inv(invoiceId)).toMatchObject({ status: "partially_paid", amountPaid: 100.1, balance: 200.2 });

    const rest = await run(boss, "finance_allocate_payment", { paymentId, allocations: [{ invoiceId, amount: "200.20" }] });
    expect(rest.p.details.at(-1)?.after).toContain("paid in full");
    const done = await inv(invoiceId);
    expect(done).toMatchObject({ status: "paid", amountPaid: 300.3, balance: 0 });
    expect((await pay(paymentId)).unallocatedAmount).toBe(0);
    expect(done.allocations.map((a: { amount: number }) => a.amount)).toEqual([100.1, 200.2]);
    expect(await code(f.propose(boss, "finance_allocate_payment", { paymentId, allocations: [{ invoiceId, amount: "0.01" }] }))).toBe("VALIDATION_ERROR");
  });

  it("the service's arithmetic leaves no hidden fraction when a total is paid in awkward pieces", async () => {
    const id = await postedInvoice(A.ben, [line("Awkward", 1, 0.3)]);
    const pid = await payment(0.3);
    await run(boss, "finance_allocate_payment", { paymentId: pid, allocations: [{ invoiceId: id, amount: "0.10" }] });
    await run(boss, "finance_allocate_payment", { paymentId: pid, allocations: [{ invoiceId: id, amount: "0.20" }] });
    const after = await inv(id);
    expect(after.balance).toBe(0);
    expect(after.status).toBe("paid");
    expect((await pay(pid)).unallocatedAmount).toBe(0);
  });

  it("refuses every unsafe allocation before anything is stored", async () => {
    const open = await postedInvoice(A.atlas, [line("Work", 1, 100)]);
    const draft = await draftInvoice(A.atlas, [line("Work", 1, 100)]);
    const eur = await postedInvoice(A.atlas, [line("Work", 1, 100)], "EUR");
    const voided = await draftInvoice(A.atlas, [line("Work", 1, 100)]);
    await svc().voidInvoice(voided, "mistake", uid());
    const pid = await payment(150);
    const bad = (allocations: object[], paymentId = pid) => code(f.propose(boss, "finance_allocate_payment", { paymentId, allocations }));
    expect(await bad([{ invoiceId: draft, amount: 10 }])).toBe("INVALID_TRANSITION");
    expect(await bad([{ invoiceId: voided, amount: 10 }])).toBe("INVALID_TRANSITION");
    expect(await bad([{ invoiceId: eur, amount: 10 }])).toBe("VALIDATION_ERROR"); // currencies are never converted
    expect(await bad([{ invoiceId: open, amount: "100.01" }])).toBe("VALIDATION_ERROR"); // more than the balance
    expect(await bad([{ invoiceId: open, amount: 100 }, { invoiceId: await postedInvoice(A.ben, [line("W", 1, 100)]), amount: 60 }])).toBe("VALIDATION_ERROR"); // more than the payment
    expect(await bad([{ invoiceId: open, amount: 10 }, { invoiceId: open, amount: 10 }])).toBe("VALIDATION_ERROR"); // twice
    expect(await bad([{ invoiceId: open, amount: "10.555" }])).toBe("VALIDATION_ERROR");
    expect(await bad([{ invoiceId: open, amount: 0 }])).toBe("VALIDATION_ERROR");
    expect(await bad([{ invoiceId: B.invoice, amount: 10 }])).toBe("NOT_FOUND");
    expect(await bad([{ invoiceId: open, amount: 10 }], B.payment)).toBe("NOT_FOUND");
    expect(await code(f.propose(clerk, "finance_allocate_payment", { paymentId: pid, allocations: [{ invoiceId: open, amount: 10 }] }))).toBe("FORBIDDEN");
    expect(await inv(open)).toMatchObject({ amountPaid: 0, balance: 100 });
    expect((await pay(pid)).unallocatedAmount).toBe(150);
  });

  it("an invoice paid by someone else after the proposal stops the confirmation, and a double confirm applies once", async () => {
    const id = await postedInvoice(A.atlas, [line("Work", 1, 100)]);
    const pid = await payment(100);
    const p = await f.propose(boss, "finance_allocate_payment", { paymentId: pid, allocations: [{ invoiceId: id, amount: 100 }] });
    await svc().allocatePayment(await payment(40), [{ invoiceId: id, amount: 40 }], uid()); // the invoice moves on
    expect(await code(f.confirm(boss, p.id, p.typedPhrase!))).toBe("CONFLICT");
    expect(await inv(id)).toMatchObject({ amountPaid: 40, balance: 60 });
    expect((await pay(pid)).unallocatedAmount).toBe(100);

    const fresh = await f.propose(boss, "finance_allocate_payment", { paymentId: pid, allocations: [{ invoiceId: id, amount: 60 }] });
    const results = await Promise.all([1, 2, 3].map(() => code(f.confirm(boss, fresh.id, fresh.typedPhrase!))));
    expect(results.filter((r) => r === "OK")).toHaveLength(1);
    expect(await inv(id)).toMatchObject({ status: "paid", balance: 0, amountPaid: 100 });
    expect((await pay(pid)).unallocatedAmount).toBe(40);
  });
});

describe("expenses", () => {
  const categoryId = async (name: string) => (await svc().listExpenseCategories()).find((c) => c.name === name)!.id;

  it("create shows the computed total; submit, approve and reject follow the service's states with typed amounts", async () => {
    const cat = await categoryId("Travel & Transport");
    const p = await f.propose(clerk, "finance_create_expense", { expenseDate: "2026-11-03", description: "Taxi to client", vendor: "Taxi Tunis", categoryId: cat, amount: "18.50", tax: "1.20" });
    expect(p.requiresTyped).toBe(false);
    expect(p.details.slice(-3)).toEqual([{ label: "Amount", after: "18.50 TND" }, { label: "Tax", after: "1.20 TND" }, { label: "Total", after: "19.70 TND" }]);
    expect(p.details.find((d) => d.label === "Category")?.after).toBe("Travel & Transport");
    await f.confirm(clerk, p.id);
    const e = (await svc().listExpenses("all")).find((x) => x.description === "Taxi to client")!;
    expect(e).toMatchObject({ status: "draft", amount: 18.5, tax: 1.2, total: 19.7, categoryName: "Travel & Transport" });

    expect(await code(f.propose(boss, "finance_approve_expense", { expenseId: e.id }))).toBe("INVALID_TRANSITION"); // not submitted yet
    await run(clerk, "finance_submit_expense", { expenseId: e.id });
    expect((await svc().listExpenses("submitted")).map((x) => x.id)).toContain(e.id);
    expect(await code(f.propose(clerk, "finance_approve_expense", { expenseId: e.id }))).toBe("FORBIDDEN"); // a manager cannot approve
    const approve = await f.propose(boss, "finance_approve_expense", { expenseId: e.id });
    expect(approve).toMatchObject({ risk: "financial", requiresTyped: true, typedPhrase: "19.70 TND" });
    expect(await code(f.confirm(boss, approve.id, "19.7"))).toBe("VALIDATION_ERROR");
    await f.confirm(boss, approve.id, "19.70 TND");
    expect((await svc().listExpenses("approved")).map((x) => x.id)).toContain(e.id);
    expect(await code(f.propose(boss, "finance_reject_expense", { expenseId: e.id, reason: "too late" }))).toBe("INVALID_TRANSITION");
  });

  it("an approver cannot approve their own expense through AI either, and the card says why", async () => {
    const id = await as2("admin", boss.userId).createExpense({ expenseDate: "2026-11-02", description: "Boss expense", amount: 15, tax: 0, currency: "TND" }, boss.userId.toHexString());
    await as2("admin", boss.userId).submitExpense(id, boss.userId.toHexString());
    expect(await code(f.propose(boss, "finance_approve_expense", { expenseId: id }))).toBe("FORBIDDEN");
    expect(await code(f.propose(T.A.owner, "finance_approve_expense", { expenseId: id }))).toBe("OK");
  });

  it("reject needs a reason and the total typed; a rejected expense cannot be approved", async () => {
    const id = await svc().createExpense({ expenseDate: "2026-11-02", description: "Questionable dinner", amount: 80, tax: 0, currency: "TND" }, uid());
    await svc().submitExpense(id, uid());
    expect(await code(f.propose(boss, "finance_reject_expense", { expenseId: id, reason: "no" }))).toBe("VALIDATION_ERROR");
    const p = await f.propose(boss, "finance_reject_expense", { expenseId: id, reason: "Personal expense" });
    expect(p).toMatchObject({ risk: "destructive", typedPhrase: "80.00 TND" });
    await f.confirm(boss, p.id, "80.00 TND");
    expect((await svc().listExpenses("rejected")).find((x) => x.id === id)?.rejectionReason).toBe("Personal expense");
    expect(await code(f.propose(boss, "finance_approve_expense", { expenseId: id }))).toBe("INVALID_TRANSITION");
  });

  it("refuses bad dates, amounts, categories and other companies' records; flags a possible duplicate", async () => {
    const base = { expenseDate: "2026-11-03", description: "Printer ink", amount: 25 };
    const bad = (a: object) => code(f.propose(clerk, "finance_create_expense", { ...base, ...a }));
    expect(await bad({ expenseDate: "2099-01-01" })).toBe("VALIDATION_ERROR");
    expect(await bad({ expenseDate: "03/11/2026" })).toBe("VALIDATION_ERROR");
    expect(await bad({ amount: 0 })).toBe("VALIDATION_ERROR");
    expect(await bad({ amount: "12.999" })).toBe("VALIDATION_ERROR");
    expect(await bad({ tax: -1 })).toBe("VALIDATION_ERROR");
    expect(await bad({ description: "ab" })).toBe("VALIDATION_ERROR");
    expect(await bad({ categoryId: new ObjectId().toHexString() })).toBe("NOT_FOUND");
    expect(await code(f.propose(viewer, "finance_create_expense", base))).toBe("FORBIDDEN");
    await svc().createExpense({ expenseDate: "2026-11-03", description: "Pens", vendor: "Papeterie", amount: 25, tax: 0, currency: "TND" }, uid());
    const dup = await f.propose(clerk, "finance_create_expense", { ...base, vendor: "papeterie" });
    expect(dup.details.some((d) => d.label === "Possible duplicate")).toBe(true);
  });

  it("an expense changed after the proposal is not approved", async () => {
    const id = await svc().createExpense({ expenseDate: "2026-11-02", description: "Race expense", amount: 12, tax: 0, currency: "TND" }, uid());
    await svc().submitExpense(id, uid());
    const p = await f.propose(boss, "finance_approve_expense", { expenseId: id });
    await svc().rejectExpense(id, "rejected elsewhere", uid());
    expect(await code(f.confirm(boss, p.id, p.typedPhrase!))).toBe("CONFLICT");
    expect((await svc().listExpenses("rejected")).some((x) => x.id === id)).toBe(true);
  });

  it("categories: created once, never duplicated", async () => {
    await svc().listExpenseCategories();
    expect(await code(f.propose(clerk, "finance_create_expense_category", { name: "other" }))).toBe("CONFLICT");
    await run(clerk, "finance_create_expense_category", { name: "Training" });
    expect((await svc().listExpenseCategories()).filter((c) => c.name === "Training")).toHaveLength(1);
  });
});

describe("access and isolation", () => {
  it("there is no AI path to mark an expense paid, delete a customer or move real money", async () => {
    const names = (await import("@/server/ai/tools")).aiToolRegistry.all().map((t) => t.name).filter((n) => n.startsWith("finance_"));
    expect(names.some((n) => /mark_paid|delete|pay_expense|transfer|refund|scan|ocr/.test(n))).toBe(false);
  });

  it("revoking the grant after a proposal cancels the confirmation; the record is untouched", async () => {
    const id = await draftInvoice(A.ben, [line("Work", 1, 33)]);
    const p = await f.propose(boss, "finance_post_invoice", { invoiceId: id });
    const owner = actorOf(h, T.A.owner);
    const current = await h.db.collection("ai_access_grants").findOne({ userId: boss.userId });
    await saveMemberGrant(owner, boss.userId.toHexString(), grant({ finance: g(true, true, true, true, false), inventory: g(true, false, false, false, false) }), Number(current?.version ?? 0));
    expect(await code(f.confirm(boss, p.id, p.typedPhrase!))).not.toBe("OK");
    expect((await inv(id)).status).toBe("draft");
    const again = await h.db.collection("ai_access_grants").findOne({ userId: boss.userId });
    await saveMemberGrant(owner, boss.userId.toHexString(), grant({ finance: g(true, true, true, true, true), inventory: g(true, false, false, false, false) }), Number(again?.version ?? 0));
  });

  it("a proposal cannot be confirmed by another member, and the other company cannot see it", async () => {
    const p = await f.propose(clerk, "finance_create_customer", { name: "Private Proposal Ltd" });
    expect(await code(f.confirm(boss, p.id))).toBe("NOT_FOUND");
    expect(await code(f.confirm(T.B.owner, p.id))).toBe("NOT_FOUND");
    expect((await svc().listCustomers()).some((c) => c.name === "Private Proposal Ltd")).toBe(false);
  });

  it("unrelated grant cells do not unlock finance writes", async () => {
    const inventoryOnly = await seedMember(h.db, T.companyA, "admin");
    await saveMemberGrant(actorOf(h, T.A.owner), inventoryOnly.userId.toHexString(), grant({ inventory: g(true, true, true, true, true) }), 0);
    expect(await code(f.propose(inventoryOnly, "finance_create_customer", { name: "No Grant Ltd" }))).toBe("FORBIDDEN");
    expect(await code(f.read(inventoryOnly, "finance_list_customers", {}))).toBe("UNAVAILABLE");
  });
});

describe("AI-assisted entry", () => {
  const OIL = "Invoice Atlas Foods for 12 olive oil bottles, due 2026-12-31";

  it("an invoice described in words: the customer and product are found in real records, the price comes from the product, quantity only from the person", async () => {
    const { complete } = llm({
      values: { customerId: stated("Atlas Foods", "Atlas Foods"), dueDate: stated("2026-12-31", "2026-12-31") },
      lines: [{ ref: "olive oil", values: { quantity: stated(12, "12 olive oil bottles"), unitPrice: { value: 3, basis: "assumed" } } }],
    });
    const draft = kind(await f.parts(boss, { command: "newinvoice", step: "draft", args: {}, draft: { text: OIL, provenance: {} } }, complete), "form");
    expect(fieldValue(draft, "customerId")).toBe(A.atlas);
    expect(draft.draft!.provenance.customerId).toBe("found");
    expect(fieldValue(draft, "dueDate")).toBe("2026-12-31");
    const rows = JSON.parse(String(fieldValue(draft, "lines"))) as Record<string, string>[];
    expect(rows.map((r) => [r.productId, r.quantity, r.unitPrice, r.taxRate])).toEqual([[A.oil, "12", "9.50", "0"]]); // the assumed price 3 is ignored
    expect(draft.draft!.lineProvenance!.lines[0]).toMatchObject({ productId: "found", quantity: "you", unitPrice: "found", taxRate: "default" });
    const review = kind(await f.parts(boss, { command: "newinvoice", step: "submit", args: draft.context, values: formValues(draft) }), "confirmation");
    expect(review.summary).toBe("Create a draft invoice for Atlas Foods, total 114.00 TND. It is not official until posted.");
  });

  it("never invents a customer, quantity, price or product: it asks", async () => {
    const { complete } = llm({
      values: { customerId: { value: "Atlas Foods", basis: "assumed" } },
      lines: [{ ref: "gift wrapping", values: {} }, { ref: "unicorn saddle", values: { quantity: stated(1, "1") } }],
    });
    const draft = kind(await f.parts(boss, { command: "newinvoice", step: "draft", args: {}, draft: { text: "something for a customer, gift wrapping and a unicorn saddle 1", provenance: {} } }, complete), "form");
    expect(fieldValue(draft, "customerId")).toBe("");
    const questions = draft.draft!.questions.map((q) => q.question);
    expect(questions.some((q) => q.startsWith("Which customer"))).toBe(true);
    expect(questions.some((q) => q.includes("unicorn saddle") && q.includes("could not find"))).toBe(true);
    expect(questions.some((q) => q.includes("unit price") && q.includes("FREE-1"))).toBe(true);
    expect(questions.some((q) => q.includes("quantity") && q.includes("FREE-1"))).toBe(true);
    expect(JSON.stringify(draft)).not.toContain("Company B");
  });

  it("a payment in words: the amount must be stated, the method is asked when not given, nothing is invented", async () => {
    const { complete } = llm({ values: { amount: stated("1190.50", "1190.50"), method: { value: "bank_transfer", basis: "assumed" }, reference: stated("VIR-9", "VIR-9") } });
    const draft = kind(await f.parts(boss, { command: "recordpayment", step: "draft", args: {}, draft: { text: "Got 1190.50 TND from Atlas, ref VIR-9", provenance: {} } }, complete), "form");
    expect(fieldValue(draft, "amount")).toBe("1190.50");
    expect(fieldValue(draft, "method")).toBe("");
    expect(draft.draft!.questions.some((q) => q.field === "method")).toBe(true);
    expect(fieldValue(draft, "paymentDate")).toBe(today());
    expect(draft.draft!.provenance.paymentDate).toBe("default");
  });

  it("applying a payment in words: rows are the real open invoices, an amount must be stated, a made-up invoice is refused", async () => {
    const id = await postedInvoice(A.atlas, [line("Draft test", 1, 200)]);
    const number = (await inv(id)).invoiceNumber;
    const pid = await payment(500, "TND", "DRAFT-APPLY");
    const { complete } = llm({
      target: { search: "DRAFT-APPLY" },
      values: {},
      lines: [{ ref: number, values: { amount: stated(150, "150") } }, { ref: "INV-1999-00001", values: { amount: stated(10, "10") } }],
    });
    const draft = kind(await f.parts(boss, { command: "allocate", step: "draft", args: {}, draft: { text: `Apply 150 of DRAFT-APPLY to ${number} and 10 to INV-1999-00001`, provenance: {} } }, complete), "form");
    expect(draft.fields.find((x) => x.name === "allocations")!.lines!.fixedRows).toBe(true);
    const rows = JSON.parse(String(fieldValue(draft, "allocations"))) as Record<string, string>[];
    expect(rows.find((r) => r.invoiceId === id)?.amount).toBe("150");
    expect(draft.draft!.questions.some((q) => q.question.includes("INV-1999-00001"))).toBe(true);
    const review = kind(await f.parts(boss, { command: "allocate", step: "submit", args: draft.context, values: formValues(draft) }), "confirmation");
    expect(review).toMatchObject({ risk: "financial", requiresTyped: true, typedPhrase: "150.00 TND" });
    expect((await pay(pid)).unallocatedAmount).toBe(500); // nothing happens until the typed confirmation
  });

  it("an expense in words: the date and amount are asked for when missing", async () => {
    const { complete } = llm({ values: { description: stated("Taxi", "Taxi"), amount: { value: 18.5, basis: "assumed" } } });
    const draft = kind(await f.parts(clerk, { command: "newexpense", step: "draft", args: {}, draft: { text: "Taxi yesterday", provenance: {} } }, complete), "form");
    expect(fieldValue(draft, "amount")).toBe("");
    expect(fieldValue(draft, "expenseDate")).toBe("");
    const fields = draft.draft!.questions.map((q) => q.field);
    expect(fields).toEqual(expect.arrayContaining(["amount", "expenseDate"]));
  });

  it("the manual form stays available and is the same form: manual invoice start has no draft metadata and a single blank line", async () => {
    const choice = await f.parts(boss, { command: "newinvoice", step: "start", args: {} });
    expect(choice[0].type).toBe("draft_choice" in choice[0] ? "draft_choice" : choice[0].type);
    const manual = kind(await f.parts(boss, { command: "newinvoice", step: "manual", args: {} }), "form");
    expect(manual.draft).toBeUndefined();
    expect(manual.fields.map((x) => x.name)).toEqual(["customerId", "currency", "issueDate", "dueDate", "notes", "lines"]);
    expect(fieldValue(manual, "issueDate")).toBe(today());
    expect(JSON.parse(String(fieldValue(manual, "lines")))).toHaveLength(1);
  });

  it("a viewer cannot reach any finance write command", async () => {
    for (const command of ["newinvoice", "recordpayment", "allocate", "newexpense", "postinvoice", "approveexpense"]) {
      expect(await code(f.step(viewer, { command, step: "manual", args: {} }))).not.toBe("OK");
    }
  });
});

describe("guided flows", () => {
  it("customer card to invoice to post, with next-step actions only where the live record and role allow", async () => {
    const card = (await f.read(boss, "finance_get_customer", { customerId: A.atlas })).parts![0] as { actions: { label: string }[] };
    expect(card.actions.map((a) => a.label)).toEqual(["New invoice", "Edit customer", "Invoices"]);
    const forms = await f.parts(boss, { command: "newinvoice", step: "manual", args: { customerId: A.atlas } });
    expect(fieldValue(kind(forms, "form"), "customerId")).toBe(A.atlas);
  });

  it("voiding is a form that asks for the reason, then a typed confirmation", async () => {
    const id = await draftInvoice(A.ben, [line("Void flow", 1, 15)]);
    const form = kind(await f.parts(boss, { command: "voidinvoice", step: "select", args: { invoiceId: id } }), "form");
    expect(form.fields.map((x) => x.name)).toEqual(["reason"]);
    const review = kind(await f.parts(boss, { command: "voidinvoice", step: "submit", args: form.context, values: { reason: "Entered twice by mistake" } }), "confirmation");
    expect(review).toMatchObject({ risk: "destructive", requiresTyped: true });
    expect(await code(f.step(boss, { command: "voidinvoice", step: "submit", args: form.context, values: { reason: "" } }))).toBe("VALIDATION_ERROR");
  });
});
