import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createHarness, parsed, type TestHarness } from "../helpers/workspace";
import { actorOf, seedMember, seedTenants, wsOf, type SeededMember } from "../helpers/ai";
import { code, flow, formValues, fieldValue, kind, llm, stated } from "../helpers/ai-flow";
import { saveMemberGrant, updateAiSettings } from "@/server/ai/access/access.service";
import { getMyUsageToday } from "@/server/ai/usage.service";
import { commandRegistry } from "@/server/ai/commands";
import { aiToolRegistry } from "@/server/ai/tools";
import { parseSendTime } from "@/server/ai/tools/marketing.tools";
import { tunisLocalToIso } from "@/server/ai/commands/marketing.commands";
import { audienceInputSchema, campaignInputSchema, consentChangeSchema, contactCreateSchema, tagInputSchema } from "@/features/marketing/schemas/marketing.schema";
import { createContact, getContact } from "@/server/marketing/contact.service";
import { assignTags, createTag } from "@/server/marketing/tag.service";
import { changeConsent } from "@/server/marketing/consent.service";
import { createAudience } from "@/server/marketing/audience.service";
import { approveCampaign, createCampaign, getCampaign, submitCampaign } from "@/server/marketing/campaign.service";
import { MARKETING_COLLECTIONS } from "@/server/marketing/documents";
import type { MessageProvider } from "@/server/marketing/providers";
import type { AiModules } from "@/shared/domain/ai";

// A fake sending setup: no real provider, no environment, nothing can leave the process.
const mk = vi.hoisted(() => ({ allowlist: null as string[] | null, providers: {} as Record<string, unknown> }));
vi.mock("@/server/marketing/config", async (orig) => ({ ...(await orig<typeof import("@/server/marketing/config")>()), getSendAllowlist: () => mk.allowlist }));
vi.mock("@/server/marketing/providers", async (orig) => ({ ...(await orig<typeof import("@/server/marketing/providers")>()), getConfiguredProviders: () => mk.providers }));

let h: TestHarness;
let T: Awaited<ReturnType<typeof seedTenants>>;
let boss: SeededMember; // admin, every marketing cell
let mgr: SeededMember; // manager: drafts only
let viewer: SeededMember;
let other: { audience: string; campaign: string; contact: string };
const f = flow(() => h);
const g = (view: boolean, create: boolean, edit: boolean, del: boolean, approve: boolean) => ({ view, create, edit, delete: del, approve });
const grant = (modules: AiModules, cap: number | null = null) => ({ enabled: true, modules, canAuditTranscripts: false, canViewSensitiveHr: false, dailyTokenCap: cap });
const owner = () => wsOf(h, T.A.owner);
let seq = 0;
const unique = (label: string) => `${label}-${++seq}-${Date.now()}`;
const sent: string[] = [];
const fakeEmail: MessageProvider = { name: "fake-email", channel: "email", minIntervalMs: 0, send: async (m) => (sent.push(m.to), { providerMessageId: `fake-${sent.length}` }) };
const ALLOWED_LIST: string[] = ["base@example.test"];
const allowedEmail = () => {
  const e = `allowed.${++seq}.${Date.now()}@example.test`;
  ALLOWED_LIST.push(e);
  mk.allowlist = [...ALLOWED_LIST];
  return e;
};
const future = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString().replace(/\.\d{3}Z$/, "+00:00");
const jobs = () => h.db.collection(MARKETING_COLLECTIONS.jobs ?? "marketing_jobs");
const everything = (r: { data?: unknown; parts?: unknown }) => JSON.stringify([r.data, r.parts]);

async function audienceOf(emails: string[], consent = true) {
  const tag = await createTag(owner(), parsed(tagInputSchema, { name: unique("tag"), color: "#1f7a5c" }));
  const ids: string[] = [];
  for (const email of emails) {
    const c = await createContact(owner(), parsed(contactCreateSchema, { firstName: "Rec", lastName: unique("r"), email, phone: "", source: "manual", lifecycleStage: "lead", isActive: true, consent: { email: consent, sms: false } }));
    ids.push(c.id);
    await assignTags(owner(), [c.id], tag.id);
  }
  const audience = await createAudience(owner(), parsed(audienceInputSchema, { name: unique("aud"), description: "", isActive: true, rule: { match: "all", conditions: [{ type: "tags", tagIds: [tag.id], match: "any" }] } }));
  return { audience, ids };
}
async function draftCampaign(audienceId: string, extra: object = {}) {
  return createCampaign(owner(), parsed(campaignInputSchema, { name: unique("camp"), channel: "email", audienceId, templateId: null, subject: "Hello {{first_name}}", body: "Hi {{first_name}}, our news. {{unsubscribe_url}}", ...extra }));
}
async function pending(audienceId: string) {
  const c = await draftCampaign(audienceId);
  await submitCampaign(owner(), c.id, c.version);
  return getCampaign(owner(), c.id);
}
async function approved(emails: string[]) {
  const a = await audienceOf(emails);
  const c = await pending(a.audience.id);
  await approveCampaign(owner(), c.id, c.version);
  return { ...a, campaign: await getCampaign(owner(), c.id) };
}
/** Propose with the typed phrase, then confirm. */
async function run(member: SeededMember, tool: string, args: unknown) {
  const p = await f.propose(member, tool, args);
  return { p, result: await f.confirm(member, p.id, p.typedPhrase ?? undefined) };
}

beforeAll(async () => {
  h = await createHarness();
  T = await seedTenants(h);
  for (const o of [T.A.owner, T.B.owner]) await updateAiSettings(actorOf(h, o), { enabled: true, retentionDays: 90, dailyTokenBudget: 0, defaultUserDailyTokenCap: 0 }, 0);
  const ownerActor = actorOf(h, T.A.owner);
  boss = T.A.admin;
  await saveMemberGrant(ownerActor, boss.userId.toHexString(), grant({ marketing: g(true, true, true, true, true) }), 0);
  mgr = await seedMember(h.db, T.companyA, "manager");
  await saveMemberGrant(ownerActor, mgr.userId.toHexString(), grant({ marketing: g(true, true, true, false, false) }), 0);
  viewer = await seedMember(h.db, T.companyA, "manager");
  await saveMemberGrant(ownerActor, viewer.userId.toHexString(), grant({ marketing: g(true, false, false, false, false) }), 0);

  const wsB = wsOf(h, T.B.owner);
  const cB = await createContact(wsB, parsed(contactCreateSchema, { firstName: "Other", lastName: "Tenant", email: "tenant@other.test", phone: "", source: "manual", lifecycleStage: "lead", isActive: true, consent: { email: true, sms: false } }));
  const tagB = await createTag(wsB, parsed(tagInputSchema, { name: "b-tag", color: "#1f7a5c" }));
  await assignTags(wsB, [cB.id], tagB.id);
  const aB = await createAudience(wsB, parsed(audienceInputSchema, { name: "B audience", description: "", isActive: true, rule: { match: "all", conditions: [{ type: "tags", tagIds: [tagB.id], match: "any" }] } }));
  const campB = await createCampaign(wsB, parsed(campaignInputSchema, { name: "B campaign", channel: "email", audienceId: aB.id, templateId: null, subject: "B", body: "B body {{unsubscribe_url}}" }));
  other = { audience: aB.id, campaign: campB.id, contact: cB.id };
});
beforeEach(() => {
  mk.allowlist = [...ALLOWED_LIST];
  mk.providers = { email: fakeEmail };
  sent.length = 0;
});
afterAll(async () => {
  await h.cleanup();
});

describe("roles and the permission ceiling", () => {
  it("an AI grant can never exceed the real role: a manager cannot be given approve or delete, an employee no write", async () => {
    const owner = actorOf(h, T.A.owner);
    const m = await seedMember(h.db, T.companyA, "manager");
    for (const cell of [{ approve: true }, { delete: true }]) expect(await code(saveMemberGrant(owner, m.userId.toHexString(), grant({ marketing: { ...g(true, true, true, false, false), ...cell } }), 0))).not.toBe("OK");
    const e = await seedMember(h.db, T.companyA, "employee");
    expect(await code(saveMemberGrant(owner, e.userId.toHexString(), grant({ marketing: g(true, true, false, false, false) }), 0))).not.toBe("OK");
    expect(await code(saveMemberGrant(owner, m.userId.toHexString(), grant({ marketing: g(true, true, true, false, false) }), 0))).toBe("OK");
  });

  it("the manager drafts but cannot approve, schedule or cancel, even with the same tools; the employee can only read", async () => {
    const a = await audienceOf([unique("x") + "@example.test"]);
    const c = await pending(a.audience.id);
    for (const [tool, args] of [["marketing_approve_campaign", { campaignId: c.id }], ["marketing_schedule_campaign", { campaignId: c.id, scheduledAt: future(30) }], ["marketing_cancel_campaign", { campaignId: c.id }]] as const) {
      expect(await code(f.propose(mgr, tool, args)), `mgr ${tool}`).toBe("FORBIDDEN");
      expect(await code(f.propose(viewer, tool, args)), `viewer ${tool}`).toBe("FORBIDDEN");
    }
    expect(await code(f.propose(viewer, "marketing_create_template", { name: "x", channel: "sms", body: "hi" }))).toBe("FORBIDDEN");
    expect(await code(f.read(viewer, "marketing_list_campaigns", {}))).toBe("OK");
    for (const cmd of ["approvecampaign", "schedulecampaign", "cancelcampaign"]) expect(await code(f.step(mgr, { command: cmd, step: "start", args: {} })), cmd).not.toBe("OK");
  });

  it("a manager who holds the approve permission in a grant-less role still cannot: the grant cell is checked live", async () => {
    const lowered = await seedMember(h.db, T.companyA, "admin");
    await saveMemberGrant(actorOf(h, T.A.owner), lowered.userId.toHexString(), grant({ marketing: g(true, true, true, false, false) }), 0);
    const a = await audienceOf([unique("y") + "@example.test"]);
    const c = await pending(a.audience.id);
    expect(await code(f.propose(lowered, "marketing_approve_campaign", { campaignId: c.id }))).toBe("FORBIDDEN");
  });
});

describe("contact privacy", () => {
  it("lists, cards, audiences and deliveries carry no full email or phone, in the data or in the parts", async () => {
    const email = `private.${unique("p")}@example.test`;
    const a = await audienceOf([email]);
    const c = await pending(a.audience.id);
    await approveCampaign(owner(), c.id, c.version);
    for (const [member, tool, args] of [[mgr, "marketing_list_contacts", { q: "Rec" }], [viewer, "marketing_list_contacts", {}], [boss, "marketing_list_deliveries", { campaignId: c.id }], [boss, "marketing_get_campaign", { campaignId: c.id }], [viewer, "marketing_preview_audience", { audienceId: a.audience.id, channel: "email" }], [boss, "marketing_campaign_report", { campaignId: c.id }]] as const) {
      const text = everything(await f.read(member, tool, args));
      expect(text, tool).not.toContain(email);
    }
    const listed = JSON.stringify((await f.read(mgr, "marketing_list_contacts", { q: "Rec" })).data);
    expect(listed).toMatch(/p•••@example\.test/);
  });

  it("only a contact manager can reveal a full address, and only by asking for it", async () => {
    const email = `reveal.${unique("r")}@example.test`;
    const ct = await createContact(owner(), parsed(contactCreateSchema, { firstName: "Reveal", lastName: "Me", email, phone: "+21620123456", source: "manual", lifecycleStage: "lead", isActive: true, consent: { email: false, sms: false } }));
    expect(everything(await f.read(mgr, "marketing_get_contact", { contactId: ct.id }))).not.toContain(email);
    expect(everything(await f.read(mgr, "marketing_get_contact", { contactId: ct.id, reveal: true }))).toContain(email);
    expect(everything(await f.read(viewer, "marketing_get_contact", { contactId: ct.id }))).not.toContain("+21620123456");
  });

  it("an edit form never contains the real address, and the model prompt never sees it", async () => {
    const email = `form.${unique("f")}@example.test`;
    const ct = await createContact(owner(), parsed(contactCreateSchema, { firstName: "Formy", lastName: "Person", email, phone: "", source: "manual", lifecycleStage: "lead", isActive: true, consent: { email: false, sms: false } }));
    const form = kind(await f.parts(mgr, { command: "editcontact", step: "select", args: { contactId: ct.id } }), "form");
    expect(JSON.stringify(form)).not.toContain(email);
    expect(fieldValue(form, "email")).toBe("");
    const { complete, calls } = llm({ target: { search: "Formy" }, values: { lifecycleStage: stated("customer", "customer") } });
    const draft = kind(await f.parts(mgr, { command: "editcontact", step: "draft", args: {}, draft: { text: "Move Formy Person to the customer stage", provenance: {} } }, complete), "form");
    expect(fieldValue(draft, "lifecycleStage")).toBe("customer");
    expect(JSON.stringify([draft, calls.mock.calls])).not.toContain(email);
  });
});

describe("consent is never touched", () => {
  it("there is no consent tool or command, and a new contact has no consent", async () => {
    expect(aiToolRegistry.all().filter((t) => /consent/.test(t.name))).toEqual([]);
    expect(await code(f.propose(boss, "marketing_set_consent", { contactId: other.contact, channel: "email", status: "granted" }))).not.toBe("OK");
    const email = `new.${unique("n")}@example.test`;
    await run(mgr, "marketing_create_contact", { firstName: "Brand", lastName: "New", email });
    const created = (await h.db.collection(MARKETING_COLLECTIONS.contacts).findOne({ normalizedEmail: email }))!;
    expect(await h.db.collection(MARKETING_COLLECTIONS.consentEvents).countDocuments({ contactId: created._id })).toBe(0);
    expect(await h.db.collection(MARKETING_COLLECTIONS.consentStates).countDocuments({ contactId: created._id })).toBe(0);
    expect(await code(f.propose(mgr, "marketing_create_contact", { firstName: "NoWay", consent: { email: true } }))).toBe("VALIDATION_ERROR");
    expect(await code(f.propose(mgr, "marketing_create_contact", { firstName: "NoAddress" }))).toBe("VALIDATION_ERROR");
  });

  it("editing leaves the stored consent exactly as it was, and an address with consent cannot be changed or removed", async () => {
    const email = `consented.${unique("c")}@example.test`;
    const ct = await createContact(owner(), parsed(contactCreateSchema, { firstName: "Con", lastName: "Sented", email, phone: "", source: "manual", lifecycleStage: "lead", isActive: true, consent: { email: true, sms: false } }));
    const before = await h.db.collection(MARKETING_COLLECTIONS.consentStates).find({ contactId: new ObjectId(ct.id) }).toArray();
    await run(mgr, "marketing_update_contact", { contactId: ct.id, lifecycleStage: "customer", lastName: "Sented-Ben" });
    const after = await h.db.collection(MARKETING_COLLECTIONS.consentStates).find({ contactId: new ObjectId(ct.id) }).toArray();
    expect(after.map((s) => [s.channel, s.status])).toEqual(before.map((s) => [s.channel, s.status]));
    expect((await getContact(owner(), ct.id)).lifecycleStage).toBe("customer");
    expect(await code(f.propose(mgr, "marketing_update_contact", { contactId: ct.id, email: "someone.else@example.test" }))).toBe("FORBIDDEN");
    expect(await code(f.propose(mgr, "marketing_update_contact", { contactId: ct.id, email: "" }))).toBe("FORBIDDEN");
    await changeConsent(owner(), ct.id, parsed(consentChangeSchema, { channel: "email", status: "withdrawn", source: "manual", occurredAt: "" }));
    const free = await f.propose(mgr, "marketing_update_contact", { contactId: ct.id, email: `moved.${unique("m")}@example.test` });
    expect(free.details.at(-1)).toEqual({ label: "Consent", after: "unchanged" });
    await f.confirm(mgr, free.id);
    expect((await getContact(owner(), ct.id)).consent.email?.status).toBe("withdrawn"); // not re-granted for the new address
  });

  it("a contact changed after the proposal is not overwritten", async () => {
    const ct = await createContact(owner(), parsed(contactCreateSchema, { firstName: "Stale", lastName: "One", email: `stale.${unique("s")}@example.test`, phone: "", source: "manual", lifecycleStage: "lead", isActive: true, consent: { email: false, sms: false } }));
    const p = await f.propose(mgr, "marketing_update_contact", { contactId: ct.id, lifecycleStage: "prospect" });
    await run(boss, "marketing_update_contact", { contactId: ct.id, lastName: "Two" });
    expect(await code(f.confirm(mgr, p.id))).toBe("CONFLICT");
  });
});

describe("tenant isolation", () => {
  it("another company's campaign, audience and contact are not found, readable or editable", async () => {
    for (const [tool, args] of [["marketing_get_campaign", { campaignId: other.campaign }], ["marketing_list_deliveries", { campaignId: other.campaign }], ["marketing_campaign_report", { campaignId: other.campaign }], ["marketing_preview_audience", { audienceId: other.audience, channel: "email" }], ["marketing_get_contact", { contactId: other.contact }]] as const) expect(await code(f.read(boss, tool, args)), tool).toBe("NOT_FOUND");
    for (const [tool, args] of [["marketing_update_campaign", { campaignId: other.campaign, name: "Hacked" }], ["marketing_submit_campaign", { campaignId: other.campaign }], ["marketing_approve_campaign", { campaignId: other.campaign }], ["marketing_cancel_campaign", { campaignId: other.campaign }], ["marketing_update_contact", { contactId: other.contact, lifecycleStage: "customer" }], ["marketing_create_campaign", { name: "x", channel: "email", audienceId: other.audience, subject: "s", body: "b" }]] as const) expect(await code(f.propose(boss, tool, args)), tool).toBe("NOT_FOUND");
    expect(everything(await f.read(boss, "marketing_list_contacts", {}))).not.toContain("Tenant");
    expect(everything(await f.read(boss, "marketing_list_campaigns", {}))).not.toContain("B campaign");
  });
});

describe("drafts", () => {
  it("a campaign draft is created without sending anything; invalid content, unknown variables and inactive audiences are refused", async () => {
    const a = await audienceOf([unique("d") + "@example.test"]);
    const base = { name: unique("Draft"), channel: "email", audienceId: a.audience.id, subject: "Winter sale", body: "Hello {{first_name}}, 20% off." };
    const p = await f.propose(mgr, "marketing_create_campaign", base);
    expect(p.requiresTyped).toBe(false);
    expect(p.summary).toContain("Nothing is sent");
    await f.confirm(mgr, p.id);
    const c = (await h.db.collection(MARKETING_COLLECTIONS.campaigns).findOne({ name: base.name }))!;
    expect(c.status).toBe("draft");
    expect(sent).toEqual([]);
    expect(await h.db.collection(MARKETING_COLLECTIONS.deliveries).countDocuments({ campaignId: c._id })).toBe(0);
    const bad = (extra: object) => code(f.propose(mgr, "marketing_create_campaign", { ...base, name: unique("x"), ...extra }));
    expect(await bad({ body: "Hi {{secret_field}}" })).toBe("VALIDATION_ERROR");
    expect(await bad({ subject: "" })).toBe("VALIDATION_ERROR");
    expect(await bad({ channel: "sms", subject: "no subject allowed" })).toBe("VALIDATION_ERROR");
    expect(await bad({ channel: "carrier-pigeon" })).toBe("VALIDATION_ERROR");
    expect(await code(f.propose(mgr, "marketing_create_campaign", { ...base, extra: "field" }))).toBe("VALIDATION_ERROR");
  });

  it("only drafts can be edited, with a precise diff, and a stale edit is refused", async () => {
    const a = await audienceOf([unique("e") + "@example.test"]);
    const c = await draftCampaign(a.audience.id);
    const p = await f.propose(mgr, "marketing_update_campaign", { campaignId: c.id, subject: "A new subject" });
    expect(p.details).toEqual([{ label: "Subject", before: "Hello {{first_name}}", after: "A new subject" }]);
    await run(boss, "marketing_update_campaign", { campaignId: c.id, name: unique("renamed") });
    expect(await code(f.confirm(mgr, p.id))).toBe("CONFLICT");
    await submitCampaign(owner(), c.id, (await getCampaign(owner(), c.id)).version);
    expect(await code(f.propose(mgr, "marketing_update_campaign", { campaignId: c.id, subject: "Too late" }))).toBe("INVALID_TRANSITION");
  });

  it("templates, audiences and tags are drafted through the existing validated structures; no raw query can be passed", async () => {
    await run(mgr, "marketing_create_template", { name: unique("tpl"), channel: "sms", body: "Hello {{first_name}}" });
    expect(await code(f.propose(mgr, "marketing_create_template", { name: unique("t"), channel: "sms", body: "hi {{nope}}" }))).toBe("VALIDATION_ERROR");
    const tag = await run(mgr, "marketing_create_tag", { name: unique("vip") });
    expect(tag.result).toBeDefined();
    expect(await code(f.propose(mgr, "marketing_create_audience", { name: unique("a"), rule: { match: "all", conditions: [{ type: "lifecycle_stage", values: ["customer"] }] }, $where: "1" }))).toBe("VALIDATION_ERROR");
    expect(await code(f.propose(mgr, "marketing_create_audience", { name: unique("a"), rule: { match: "all", conditions: [{ type: "raw_query", query: "{}" }] } }))).toBe("VALIDATION_ERROR");
    expect(await code(f.propose(mgr, "marketing_create_audience", { name: unique("a"), rule: { match: "all", conditions: [] } }))).toBe("VALIDATION_ERROR");
    const ok = await f.propose(mgr, "marketing_create_audience", { name: unique("Customers"), rule: { match: "all", conditions: [{ type: "lifecycle_stage", values: ["customer"] }, { type: "consent", channel: "email", status: "granted" }] } });
    expect(ok.details.at(-1)?.label).toBe("Eligible now");
    await f.confirm(mgr, ok.id);
  });

  it("social posts are drafts only: there is no way to schedule or publish through AI", async () => {
    const names = aiToolRegistry.all().map((t) => t.name).filter((n) => n.startsWith("marketing_"));
    expect(names.filter((n) => /social/.test(n) && /schedule|publish|cancel/.test(n))).toEqual([]);
    expect(commandRegistry.all().filter((c) => c.module === "marketing" && /social/.test(c.name) && /schedule|publish/.test(c.name))).toEqual([]);
    expect(await code(f.propose(mgr, "marketing_schedule_social_post", { postId: new ObjectId().toHexString() }))).not.toBe("OK");
  });
});

describe("approval", () => {
  it("shows the recipient counts, exclusions, channel and content, needs the name and eligible count typed, and freezes the list", async () => {
    const a = await audienceOf([unique("a1") + "@example.test", unique("a2") + "@example.test"]);
    await audienceOf([unique("nc") + "@example.test"], false); // a different audience with no consent: irrelevant here
    const c = await pending(a.audience.id);
    const p = await f.propose(boss, "marketing_approve_campaign", { campaignId: c.id });
    expect(p.requiresTyped).toBe(true);
    expect(p.typedPhrase).toBe(`${c.name} · 2`);
    const labels = p.details.map((d) => d.label);
    expect(labels).toEqual(expect.arrayContaining(["Campaign", "Channel", "Audience", "Matched", "Eligible", "Excluded", "Subject", "Message (example recipient)", "Recipient allowlist"]));
    expect(p.details.find((d) => d.label === "Eligible")?.after).toBe("2");
    expect(JSON.stringify(p.details)).not.toMatch(/@example\.test/);
    expect(await code(f.confirm(boss, p.id, "wrong phrase"))).toBe("VALIDATION_ERROR");
    expect((await getCampaign(owner(), c.id)).status).toBe("pending_approval");
    await f.confirm(boss, p.id, p.typedPhrase!);
    const done = await getCampaign(owner(), c.id);
    expect(done.status).toBe("approved");
    expect(done.snapshot).toMatchObject({ eligibleCount: 2 });
    expect(sent).toEqual([]);
  });

  it("recipients or the campaign changing before confirmation force a fresh preview", async () => {
    const a = await audienceOf([unique("b1") + "@example.test", unique("b2") + "@example.test"]);
    const c1 = await pending(a.audience.id);
    const p1 = await f.propose(boss, "marketing_approve_campaign", { campaignId: c1.id });
    await changeConsent(owner(), a.ids[0], parsed(consentChangeSchema, { channel: "email", status: "withdrawn", source: "manual", occurredAt: "" }));
    expect(await code(f.confirm(boss, p1.id, p1.typedPhrase!))).toBe("CONFLICT");
    expect((await getCampaign(owner(), c1.id)).status).toBe("pending_approval");

    const b = await audienceOf([unique("b3") + "@example.test"]);
    const c2 = await pending(b.audience.id);
    const p2 = await f.propose(boss, "marketing_approve_campaign", { campaignId: c2.id });
    await h.db.collection(MARKETING_COLLECTIONS.campaigns).updateOne({ _id: new ObjectId(c2.id) }, { $inc: { version: 1 } });
    expect(await code(f.confirm(boss, p2.id, p2.typedPhrase!))).toBe("CONFLICT");
  });

  it("an audience nobody can receive is not approvable; duplicate confirmations approve once", async () => {
    const none = await audienceOf([unique("n") + "@example.test"], false);
    const c = await pending(none.audience.id);
    expect(await code(f.propose(boss, "marketing_approve_campaign", { campaignId: c.id }))).toBe("VALIDATION_ERROR");
    const a = await audienceOf([unique("dup") + "@example.test"]);
    const c2 = await pending(a.audience.id);
    const p = await f.propose(boss, "marketing_approve_campaign", { campaignId: c2.id });
    const results = await Promise.all([1, 2, 3].map(() => code(f.confirm(boss, p.id, p.typedPhrase!))));
    expect(results.filter((r) => r === "OK")).toHaveLength(1);
    expect(await h.db.collection(MARKETING_COLLECTIONS.deliveries).countDocuments({ campaignId: new ObjectId(c2.id) })).toBe(1);
  });
});

describe("scheduling is the only send boundary, and it can never be immediate", () => {
  it("refuses an empty time, 'now', a time without a timezone, the past and anything under five minutes", async () => {
    const s = await approved([allowedEmail()]);
    const bad = (scheduledAt: string) => code(f.propose(boss, "marketing_schedule_campaign", { campaignId: s.campaign.id, scheduledAt }));
    for (const t of ["", "now", "immediately", "2030-01-01", "2030-01-01 09:00", "2030-01-01T09:00:00", "tomorrow at 9", future(-60), future(2)]) expect(await bad(t), JSON.stringify(t)).toBe("VALIDATION_ERROR");
    expect(await bad("2099-01-01T09:00:00+01:00")).toBe("VALIDATION_ERROR"); // more than a year ahead
    expect(await code(f.propose(boss, "marketing_schedule_campaign", { campaignId: s.campaign.id }))).toBe("VALIDATION_ERROR");
    expect(await code(f.step(boss, { command: "schedulecampaign", step: "submit", args: { campaignId: s.campaign.id }, values: { scheduledAt: "" } }))).toBe("VALIDATION_ERROR");
    expect(parseSendTime(future(30)).getTime()).toBeGreaterThan(Date.now());
    expect(tunisLocalToIso("2026-12-01 09:00")).toBe("2026-12-01T09:00:00+01:00");
    expect(await jobs().countDocuments({ targetId: new ObjectId(s.campaign.id) })).toBe(0);
    expect(sent).toEqual([]);
  });

  it("is refused unless a recipient allowlist is active or this is production, and when the channel has no provider", async () => {
    const s = await approved([allowedEmail()]);
    const at = future(60);
    mk.allowlist = null;
    expect(await code(f.propose(boss, "marketing_schedule_campaign", { campaignId: s.campaign.id, scheduledAt: at }))).toBe("FORBIDDEN");
    vi.stubEnv("NODE_ENV", "production");
    expect(await code(f.propose(boss, "marketing_schedule_campaign", { campaignId: s.campaign.id, scheduledAt: at }))).toBe("OK");
    vi.unstubAllEnvs();
    mk.allowlist = [...ALLOWED_LIST];
    mk.providers = {};
    expect(await code(f.propose(boss, "marketing_schedule_campaign", { campaignId: s.campaign.id, scheduledAt: at }))).toBe("PROVIDER_NOT_CONFIGURED");
  });

  it("shows everything before confirming, needs the name and eligible count typed, queues one future job and sends nothing now", async () => {
    const s = await approved([allowedEmail(), unique("other") + "@example.test"]);
    const at = future(90);
    const p = await f.propose(boss, "marketing_schedule_campaign", { campaignId: s.campaign.id, scheduledAt: at });
    expect(p).toMatchObject({ risk: "financial", requiresTyped: true, typedPhrase: `${s.campaign.name} · 2` });
    expect(p.summary).toContain("Real messages will be delivered");
    const labels = p.details.map((d) => d.label);
    expect(labels).toEqual(expect.arrayContaining(["Campaign", "Channel", "Audience", "Eligible recipients", "Suppressed", "Subject", "Message (full, example recipient)", "Send time", "Recipient allowlist"]));
    expect(p.details.find((d) => d.label === "Recipient allowlist")?.after).toMatch(/ACTIVE/);
    expect(p.details.find((d) => d.label === "Send time")?.after).toContain("Tunis");
    expect(await code(f.confirm(boss, p.id))).toBe("VALIDATION_ERROR");
    expect(await code(f.confirm(boss, p.id, s.campaign.name))).toBe("VALIDATION_ERROR");
    expect((await getCampaign(owner(), s.campaign.id)).status).toBe("approved");
    await f.confirm(boss, p.id, p.typedPhrase!);
    const c = await getCampaign(owner(), s.campaign.id);
    expect(c.status).toBe("scheduled");
    const queued = await jobs().find({ targetId: new ObjectId(s.campaign.id) }).toArray();
    expect(queued).toHaveLength(1);
    expect(queued[0].runAt.getTime()).toBeGreaterThan(Date.now() + 60 * 60_000);
    expect(sent).toEqual([]);
  });

  it("concurrent or repeated confirmations schedule exactly once", async () => {
    const s = await approved([allowedEmail()]);
    const p = await f.propose(boss, "marketing_schedule_campaign", { campaignId: s.campaign.id, scheduledAt: future(120) });
    const results = await Promise.all([1, 2, 3, 4].map(() => code(f.confirm(boss, p.id, p.typedPhrase!))));
    expect(results.filter((r) => r === "OK")).toHaveLength(1);
    expect(await jobs().countDocuments({ targetId: new ObjectId(s.campaign.id) })).toBe(1);
    const second = await f.propose(boss, "marketing_schedule_campaign", { campaignId: s.campaign.id, scheduledAt: future(130) }).then(() => "proposed", (e) => (e as { code: string }).code);
    expect(second).toBe("INVALID_TRANSITION"); // already scheduled
  });

  it("a campaign changed, cancelled or recipients changed after the proposal is not scheduled", async () => {
    const s = await approved([allowedEmail()]);
    const p = await f.propose(boss, "marketing_schedule_campaign", { campaignId: s.campaign.id, scheduledAt: future(70) });
    await h.db.collection(MARKETING_COLLECTIONS.campaigns).updateOne({ _id: new ObjectId(s.campaign.id) }, { $set: { status: "cancelled" } });
    expect(await code(f.confirm(boss, p.id, p.typedPhrase!))).toBe("CONFLICT");
    expect(await jobs().countDocuments({ targetId: new ObjectId(s.campaign.id) })).toBe(0);

    const t = await approved([allowedEmail()]);
    const p2 = await f.propose(boss, "marketing_schedule_campaign", { campaignId: t.campaign.id, scheduledAt: future(70) });
    await h.db.collection(MARKETING_COLLECTIONS.campaigns).updateOne({ _id: new ObjectId(t.campaign.id) }, { $set: { "snapshot.eligibleCount": 9 } });
    expect(await code(f.confirm(boss, p2.id, p2.typedPhrase!))).toBe("CONFLICT");
  });

  it("revoking the approve cell or the allowlist after the proposal stops the confirmation", async () => {
    const s = await approved([allowedEmail()]);
    const p = await f.propose(boss, "marketing_schedule_campaign", { campaignId: s.campaign.id, scheduledAt: future(80) });
    mk.allowlist = null;
    expect(await code(f.confirm(boss, p.id, p.typedPhrase!))).not.toBe("OK");
    expect((await getCampaign(owner(), s.campaign.id)).status).toBe("approved");

    mk.allowlist = [...ALLOWED_LIST];
    const q = await f.propose(boss, "marketing_schedule_campaign", { campaignId: s.campaign.id, scheduledAt: future(80) });
    const cur = await h.db.collection("ai_access_grants").findOne({ userId: boss.userId });
    await saveMemberGrant(actorOf(h, T.A.owner), boss.userId.toHexString(), grant({ marketing: g(true, true, true, true, false) }), Number(cur?.version ?? 0));
    expect(await code(f.confirm(boss, q.id, q.typedPhrase!))).not.toBe("OK");
    expect((await getCampaign(owner(), s.campaign.id)).status).toBe("approved");
    const again = await h.db.collection("ai_access_grants").findOne({ userId: boss.userId });
    await saveMemberGrant(actorOf(h, T.A.owner), boss.userId.toHexString(), grant({ marketing: g(true, true, true, true, true) }), Number(again?.version ?? 0));
  });

  it("cancelling a scheduled campaign is typed, removes its queued job and happens once", async () => {
    const s = await approved([allowedEmail()]);
    await run(boss, "marketing_schedule_campaign", { campaignId: s.campaign.id, scheduledAt: future(100) });
    const p = await f.propose(boss, "marketing_cancel_campaign", { campaignId: s.campaign.id });
    expect(p).toMatchObject({ risk: "destructive", requiresTyped: true, typedPhrase: s.campaign.name });
    expect(await code(f.confirm(boss, p.id, "nope"))).toBe("VALIDATION_ERROR");
    const results = await Promise.all([1, 2, 3].map(() => code(f.confirm(boss, p.id, p.typedPhrase!))));
    expect(results.filter((r) => r === "OK")).toHaveLength(1);
    expect((await getCampaign(owner(), s.campaign.id)).status).toBe("cancelled");
    const job = await jobs().findOne({ targetId: new ObjectId(s.campaign.id) });
    expect(job?.status).not.toBe("queued");
    expect(await code(f.propose(boss, "marketing_cancel_campaign", { campaignId: s.campaign.id }))).toBe("INVALID_TRANSITION");
  });

  it("the guided flow: schedule form requires a time, converts Tunis time, and leads to the typed preview", async () => {
    const s = await approved([allowedEmail()]);
    const form = kind(await f.parts(boss, { command: "schedulecampaign", step: "select", args: { campaignId: s.campaign.id } }), "form");
    expect(form.fields.map((x) => x.name)).toEqual(["scheduledAt"]);
    expect(fieldValue(form, "scheduledAt")).toBe("");
    const local = new Date(Date.now() + 3 * 3600_000 + 3600_000).toISOString().slice(0, 16).replace("T", " ");
    const review = kind(await f.parts(boss, { command: "schedulecampaign", step: "submit", args: form.context, values: { scheduledAt: local } }), "confirmation");
    expect(review).toMatchObject({ risk: "financial", requiresTyped: true });
  });
});

describe("AI copy, usage accounting and secrets", () => {
  it("a campaign described in words becomes an editable draft; the model writes the copy and it is labelled as AI-written; tokens are counted", async () => {
    const a = await audienceOf([unique("cp") + "@example.test"]);
    const before = (await getMyUsageToday(actorOf(h, mgr))).tokens;
    const { complete } = llm({
      values: { name: stated("Winter sale", "Winter sale"), channel: { value: "email", basis: "matched_option", evidence: "email" }, audienceId: { value: a.audience.id, basis: "matched_option", evidence: a.audience.name }, subject: { value: "Our winter sale is here", basis: "assumed" }, body: { value: "Hi {{first_name}}, enjoy 20% off this winter. {{unsubscribe_url}}", basis: "assumed" } },
    });
    const draft = kind(await f.parts(mgr, { command: "newcampaign", step: "draft", args: {}, draft: { text: `Email campaign called Winter sale to ${a.audience.name} announcing 20% off`, provenance: {} } }, complete), "form");
    expect(fieldValue(draft, "audienceId")).toBe(a.audience.id);
    expect(String(fieldValue(draft, "body"))).toContain("20% off");
    expect(draft.draft!.provenance.body).toBe("inferred");
    const review = kind(await f.parts(mgr, { command: "newcampaign", step: "submit", args: draft.context, values: formValues(draft) }), "confirmation");
    expect(review.summary).toContain("Nothing is sent");
    expect((await getMyUsageToday(actorOf(h, mgr))).tokens).toBeGreaterThan(before);
    expect(await h.db.collection(MARKETING_COLLECTIONS.campaigns).countDocuments({ name: "Winter sale" })).toBe(0); // nothing stored until confirmed
  });

  it("an audience is never assumed and the model cannot pick a channel the person did not state", async () => {
    const { complete } = llm({ values: { audienceId: { value: "Anyone", basis: "assumed" }, channel: { value: "sms", basis: "assumed" } } });
    const draft = kind(await f.parts(mgr, { command: "newcampaign", step: "draft", args: {}, draft: { text: "send something nice", provenance: {} } }, complete), "form");
    expect(fieldValue(draft, "audienceId")).toBe("");
    expect(draft.draft!.questions.map((q) => q.field)).toEqual(expect.arrayContaining(["audienceId"]));
  });

  it("the daily token cap stops AI drafting without calling the model", async () => {
    const capped = await seedMember(h.db, T.companyA, "manager");
    await saveMemberGrant(actorOf(h, T.A.owner), capped.userId.toHexString(), grant({ marketing: g(true, true, true, false, false) }, 5), 0);
    const { complete, calls } = llm({ values: {} });
    expect(await code(f.step(capped, { command: "newcampaign", step: "draft", args: {}, draft: { text: "a campaign", provenance: {} } }, complete))).toBe("RATE_LIMITED");
    expect(calls).not.toHaveBeenCalled();
  });

  it("integration status is yes/no only: no host, key, address or token in data or parts", async () => {
    const r = await f.read(viewer, "marketing_integration_status", {});
    expect(Object.values(r.data as Record<string, unknown>).every((x) => typeof x === "boolean")).toBe(true);
    const text = everything(r);
    expect(text).not.toMatch(/smtp|password|secret|token|api[_-]?key|webhook|@|bot/i);
  });

  it("no tool returns a credential-shaped field", async () => {
    const a = await approved([allowedEmail()]);
    for (const [tool, args] of [["marketing_get_campaign", { campaignId: a.campaign.id }], ["marketing_dashboard", {}], ["marketing_list_templates", {}], ["marketing_list_audiences", {}], ["marketing_list_social_accounts", {}], ["marketing_list_social_posts", {}]] as const) {
      expect(everything(await f.read(boss, tool, args)), tool).not.toMatch(/accessToken|botToken|apiKey|appSecret|encryptionKey|password|linkToken/i);
    }
  });
});
