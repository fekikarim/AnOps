import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHarness, type TestHarness } from "../helpers/workspace";

const shared = vi.hoisted(() => ({ db: null as unknown, sent: [] as Array<{ to: string; subject: string; html: string; text: string }> }));
vi.mock("@/server/db/client", () => ({ default: Promise.resolve({ db: () => shared.db }) }));
vi.mock("@/server/tenant/context", () => ({ getActiveTenant: async () => null }));
// Nothing leaves the test: the SMTP transport is replaced by a recorder.
vi.mock("@/server/email/client", () => ({ sendMail: async (m: (typeof shared.sent)[number]) => (shared.sent.push(m), { delivered: true }) }));

const { sendInvoiceEmail } = await import("@/server/finance/invoice-email");
const { fin } = await import("@/server/ai/tools/finance.tools");

let h: TestHarness;
beforeAll(async () => {
  h = await createHarness();
  shared.db = h.db;
  await h.db.collection("companies").insertOne({ _id: h.ctx().companyId, name: "Denshi <Tech>", currency: "TND" });
});
afterAll(async () => h.cleanup());

describe("send invoice by e-mail", () => {
  it("sends a posted invoice to the customer with escaped content, timbre and balance, and records it", async () => {
    const svc = fin(h.ctx());
    const c = await svc.createCustomer({ name: "Atlas <script>alert(1)</script>", email: "pay@atlas.test" }, "u");
    const id = await svc.createInvoiceDraft({ customerId: c, currency: "TND", issueDate: "2026-11-01", dueDate: "2026-12-01", stampDuty: true, lines: [{ description: "Design & <b>build</b>", quantity: 2, unitPrice: 50, taxRate: 19 }] }, "u");
    await svc.postInvoice(id, "u");
    const res = await sendInvoiceEmail(h.ctx(), id, { message: "Merci!" });
    expect(res.to).toBe("pay@atlas.test");
    const mail = shared.sent.at(-1)!;
    expect(mail.subject).toMatch(/^Invoice INV-\d{4}-\d{5} from Denshi <Tech>$/);
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
    expect(mail.html).toContain("Design &amp; &lt;b&gt;build&lt;/b&gt;");
    expect(mail.text).toContain("Timbre fiscal: 1.00 TND");
    expect(mail.text).toContain("Balance due: 120.00 TND");
    const inv = await svc.getInvoice(id);
    expect(inv.lastSentTo).toBe("pay@atlas.test");
    expect(await h.db.collection("audit_events").countDocuments({ action: "finance.invoice.emailed", entityId: id })).toBe(1);
  });

  it("refuses drafts, missing addresses and roles that cannot post", async () => {
    const svc = fin(h.ctx());
    const c = await svc.createCustomer({ name: "No Mail Co" }, "u");
    const draft = await svc.createInvoiceDraft({ customerId: c, currency: "TND", issueDate: "2026-11-01", lines: [{ description: "W", quantity: 1, unitPrice: 10 }] }, "u");
    await expect(sendInvoiceEmail(h.ctx(), draft, {})).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    await svc.postInvoice(draft, "u");
    await expect(sendInvoiceEmail(h.ctx(), draft, {})).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(sendInvoiceEmail(h.ctx(), draft, { to: "not-an-email" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(sendInvoiceEmail(h.ctx("operator"), draft, { to: "x@y.test" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(sendInvoiceEmail(h.otherTenant(), draft, { to: "x@y.test" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
