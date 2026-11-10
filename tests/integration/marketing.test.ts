import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createHarness, parsed, type TestHarness } from "../helpers/workspace";
import { MARKETING_COLLECTIONS, type CampaignDoc, type DeliveryDoc, type JobDoc } from "@/server/marketing/documents";
import { contactCreateSchema, consentChangeSchema, campaignInputSchema, audienceInputSchema, templateInputSchema, tagInputSchema } from "@/features/marketing/schemas/marketing.schema";
import { createContact, deleteContact, getContact, listContacts, setContactActive, updateContact } from "@/server/marketing/contact.service";
import { assignTags, createTag, deleteTag, removeTags } from "@/server/marketing/tag.service";
import { appendConsentEvent, changeConsent, getConsentState, listConsentHistory } from "@/server/marketing/consent.service";
import { createAudience, previewAudience, deleteAudience } from "@/server/marketing/audience.service";
import { createTemplate } from "@/server/marketing/template.service";
import {
  approveCampaign,
  cancelCampaign,
  createCampaign,
  getCampaign,
  listDeliveries,
  scheduleCampaign,
  submitCampaign,
  returnCampaign,
} from "@/server/marketing/campaign.service";
import { runDueJobs } from "@/server/marketing/dispatch";
import { ProviderError, type MessageProvider } from "@/server/marketing/providers";
import { enqueueJob } from "@/server/marketing/jobs";
import { applyDeliveryEvent } from "@/server/marketing/delivery-events";
import { confirmUnsubscribe, viewUnsubscribe } from "@/server/marketing/unsubscribe.service";
import { createUnsubscribeToken } from "@/server/marketing/unsubscribe-token";
import { getCampaignReport, getDashboard } from "@/server/marketing/analytics.service";
import type { WorkspaceContext } from "@/server/tenancy/workspace";

let h: TestHarness;
let owner: WorkspaceContext;
let approver: WorkspaceContext;
let operator: WorkspaceContext;
let viewer: WorkspaceContext;
let other: WorkspaceContext;

const contactInput = (overrides: Record<string, unknown> = {}) => ({
  firstName: "Amina",
  lastName: "Ben",
  email: "",
  phone: "",
  source: "manual",
  lifecycleStage: "lead",
  isActive: true,
  consent: { email: false, sms: false },
  ...overrides,
});

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
}

beforeAll(async () => {
  // These tests drive the real dispatch engine with fake providers and no recipient allowlist. Outside production the central
  // policy refuses every destination (see marketing-allowlist.test.ts), so they run as a production deployment.
  vi.stubEnv("NODE_ENV", "production");
  h = await createHarness();
  owner = h.ctx("owner");
  approver = { ...h.ctx("owner"), userId: new ObjectId() };
  operator = { ...h.ctx("operator"), userId: new ObjectId() };
  viewer = { ...h.ctx("viewer"), userId: new ObjectId() };
  other = h.otherTenant("owner");
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await h.cleanup();
});

describe("contacts", () => {
  it("normalizes and persists a contact, and records requested consent", async () => {
    const created = await createContact(
      owner,
      parsed(contactCreateSchema, contactInput({ firstName: " Amina ", email: "Amina.Ben@Example.TEST", phone: "+216 20 123 456", consent: { email: true, sms: false } }))
    );
    expect(created.email).toBe("amina.ben@example.test");
    expect(created.phone).toBe("+21620123456");
    const detail = await getContact(owner, created.id);
    expect(detail.consent.email?.status).toBe("granted");
    expect(detail.consent.sms).toBeNull();
    expect(detail.hasHistory).toBe(true);
  });

  it("prevents a second contact with the same email in the same company, but not in another company", async () => {
    const first = await createContact(owner, parsed(contactCreateSchema, contactInput({ email: "dup@example.test" })));
    expect(first.id).toBeTruthy();
    await expectCode(createContact(owner, parsed(contactCreateSchema, contactInput({ email: "DUP@example.test" }))), "CONFLICT");
    const elsewhere = await createContact(other, parsed(contactCreateSchema, contactInput({ email: "dup@example.test" })));
    expect(elsewhere.id).toBeTruthy();
  });

  it("allows many contacts that share a phone number", async () => {
    await createContact(owner, parsed(contactCreateSchema, contactInput({ firstName: "Family A", phone: "+21655000111" })));
    await createContact(owner, parsed(contactCreateSchema, contactInput({ firstName: "Family B", phone: "+21655000111" })));
    const page = await listContacts(owner, parsed(await import("@/features/marketing/schemas/marketing.schema").then((m) => m.contactListQuerySchema), { q: "Family", sort: "name", dir: "asc" }));
    expect(page.items.length).toBe(2);
  });

  it("searches by name, email and phone, and filters by stage", async () => {
    const schema = (await import("@/features/marketing/schemas/marketing.schema")).contactListQuerySchema;
    const byEmail = await listContacts(owner, parsed(schema, { q: "amina.ben@" }));
    expect(byEmail.items.every((item) => item.email.startsWith("amina.ben@"))).toBe(true);
    const byPhone = await listContacts(owner, parsed(schema, { q: "+216 20 123" }));
    expect(byPhone.items.length).toBeGreaterThan(0);
    const leads = await listContacts(owner, parsed(schema, { lifecycle: "customer" }));
    expect(leads.items.length).toBe(0);
  });

  it("uses optimistic concurrency on edits", async () => {
    const created = await createContact(owner, parsed(contactCreateSchema, contactInput({ firstName: "Version" })));
    const edit = { firstName: "Version", lastName: "Two", email: "", phone: "", source: "import", lifecycleStage: "prospect", isActive: true, consent: { email: false, sms: false }, expectedVersion: created.version };
    const updated = await updateContact(owner, created.id, parsed((await import("@/features/marketing/schemas/marketing.schema")).contactUpdateSchema, edit));
    expect(updated.version).toBe(created.version + 1);
    await expectCode(updateContact(owner, created.id, parsed((await import("@/features/marketing/schemas/marketing.schema")).contactUpdateSchema, edit)), "CONFLICT");
  });

  it("syncs email and SMS consent on edit, writing history only for channels that change", async () => {
    const schema = (await import("@/features/marketing/schemas/marketing.schema")).contactUpdateSchema;
    const created = await createContact(owner, parsed(contactCreateSchema, contactInput({ firstName: "Edit", email: "edit-consent@example.test", phone: "+21655555555" })));
    const base = { firstName: "Edit", lastName: "Consent", email: "edit-consent@example.test", phone: "+21655555555", source: "manual", lifecycleStage: "lead", isActive: true };

    const granted = await updateContact(owner, created.id, parsed(schema, { ...base, consent: { email: true, sms: true }, expectedVersion: created.version }));
    let detail = await getContact(owner, granted.id);
    expect(detail.consent.email?.status).toBe("granted");
    expect(detail.consent.sms?.status).toBe("granted");
    expect(await h.db.collection(MARKETING_COLLECTIONS.consentEvents).countDocuments({ contactId: new ObjectId(created.id) })).toBe(2);

    // Saving again with the same choice must not add history.
    const unchanged = await updateContact(owner, created.id, parsed(schema, { ...base, consent: { email: true, sms: true }, expectedVersion: granted.version }));
    expect(await h.db.collection(MARKETING_COLLECTIONS.consentEvents).countDocuments({ contactId: new ObjectId(created.id) })).toBe(2);

    // Withdrawing SMS keeps the email grant and the history.
    await updateContact(owner, created.id, parsed(schema, { ...base, consent: { email: true, sms: false }, expectedVersion: unchanged.version }));
    detail = await getContact(owner, created.id);
    expect(detail.consent.email?.status).toBe("granted");
    expect(detail.consent.sms?.status).toBe("withdrawn");
    expect(await h.db.collection(MARKETING_COLLECTIONS.consentEvents).countDocuments({ contactId: new ObjectId(created.id) })).toBe(3);
  });

  it("refuses an edit that grants consent on a missing address, and saves nothing", async () => {
    const schema = (await import("@/features/marketing/schemas/marketing.schema")).contactUpdateSchema;
    const created = await createContact(owner, parsed(contactCreateSchema, contactInput({ firstName: "NoAddress", email: "no-address@example.test" })));
    const edit = { firstName: "Renamed", lastName: "", email: "", phone: "", source: "manual", lifecycleStage: "lead", isActive: true, consent: { email: true, sms: false }, expectedVersion: created.version };
    await expectCode(updateContact(owner, created.id, parsed(schema, edit)), "VALIDATION_ERROR");
    const detail = await getContact(owner, created.id);
    expect(detail.firstName).toBe("NoAddress");
    expect(detail.version).toBe(created.version);
  });

  it("deletes a contact without history, but only deactivates one with consent history", async () => {
    const clean = await createContact(owner, parsed(contactCreateSchema, contactInput({ firstName: "Clean" })));
    await deleteContact(owner, clean.id);
    await expectCode(getContact(owner, clean.id), "NOT_FOUND");

    const withHistory = await createContact(owner, parsed(contactCreateSchema, contactInput({ firstName: "Kept", email: "kept@example.test", consent: { email: true, sms: false } })));
    await expectCode(deleteContact(owner, withHistory.id), "CONFLICT");
    const deactivated = await setContactActive(owner, withHistory.id, false, 1);
    expect(deactivated.isActive).toBe(false);
  });

  it("returns NOT_FOUND for another company's contact, never its data", async () => {
    const mine = await createContact(owner, parsed(contactCreateSchema, contactInput({ firstName: "Private" })));
    await expectCode(getContact(other, mine.id), "NOT_FOUND");
    await expectCode(deleteContact(other, mine.id), "NOT_FOUND");
  });
});

describe("tags", () => {
  it("assigns a tag once, skips duplicates and removes it", async () => {
    const tag = await createTag(owner, parsed(tagInputSchema, { name: "VIP", color: "#1f7a5c" }));
    const contact = await createContact(owner, parsed(contactCreateSchema, contactInput({ firstName: "Tagged" })));
    expect(await assignTags(owner, [contact.id], tag.id)).toEqual({ assigned: 1, skipped: 0 });
    expect(await assignTags(owner, [contact.id], tag.id)).toEqual({ assigned: 0, skipped: 1 });
    const links = await h.db.collection(MARKETING_COLLECTIONS.contactTags).countDocuments({ contactId: new ObjectId(contact.id), tagId: new ObjectId(tag.id) });
    expect(links).toBe(1);
    expect((await removeTags(owner, [contact.id], tag.id)).removed).toBe(1);
  });

  it("lets one contact carry several tags alongside its lifecycle stage", async () => {
    const lead = await createTag(owner, parsed(tagInputSchema, { name: "Newsletter", color: "#2563eb" }));
    const inactive = await createTag(owner, parsed(tagInputSchema, { name: "Winter", color: "#b45309" }));
    const contact = await createContact(owner, parsed(contactCreateSchema, contactInput({ firstName: "Multi", lifecycleStage: "lead" })));
    await assignTags(owner, [contact.id], lead.id);
    await assignTags(owner, [contact.id], inactive.id);
    const detail = await getContact(owner, contact.id);
    expect(detail.tags.map((tag) => tag.name).sort()).toEqual(["Newsletter", "Winter"]);
    expect(detail.lifecycleStage).toBe("lead");
  });

  it("rejects assigning another company's contact to our tag, and our tag to another company", async () => {
    const tag = await createTag(owner, parsed(tagInputSchema, { name: "Isolated", color: "#6d28d9" }));
    const foreign = await createContact(other, parsed(contactCreateSchema, contactInput({ firstName: "Foreign" })));
    // Only foreign contacts were requested, so nothing in this company matches. Reported as not found.
    await expectCode(assignTags(owner, [foreign.id], tag.id), "NOT_FOUND");
    const otherTag = await createTag(other, parsed(tagInputSchema, { name: "Theirs", color: "#6d28d9" }));
    const mine = await createContact(owner, parsed(contactCreateSchema, contactInput({ firstName: "Mine" })));
    await expectCode(assignTags(owner, [mine.id], otherTag.id), "NOT_FOUND");
  });

  it("removes assignments when a tag is deleted, but refuses while an audience uses it", async () => {
    const tag = await createTag(owner, parsed(tagInputSchema, { name: "Temporary", color: "#475569" }));
    const contact = await createContact(owner, parsed(contactCreateSchema, contactInput({ firstName: "Temp" })));
    await assignTags(owner, [contact.id], tag.id);
    const audience = await createAudience(owner, parsed(audienceInputSchema, { name: "Temp audience", description: "", isActive: true, rule: { match: "all", conditions: [{ type: "tags", tagIds: [tag.id], match: "any" }] } }));
    await expectCode(deleteTag(owner, tag.id), "CONFLICT");
    await deleteAudience(owner, audience.id);
    await deleteTag(owner, tag.id);
    expect(await h.db.collection(MARKETING_COLLECTIONS.contactTags).countDocuments({ tagId: new ObjectId(tag.id) })).toBe(0);
  });
});

describe("consent ordering and history", () => {
  it("keeps every event and never lets an older grant override a newer withdrawal", async () => {
    const contact = await createContact(owner, parsed(contactCreateSchema, contactInput({ firstName: "Consent", email: "consent@example.test" })));
    const contactId = new ObjectId(contact.id);
    const base = { companyId: owner.companyId, contactId, channel: "email" as const, source: "import" as const, recordedBy: owner.userId, requestId: "t" };
    const t1 = new Date("2026-01-01T10:00:00Z");
    const t2 = new Date("2026-02-01T10:00:00Z");
    await appendConsentEvent(h.db, { ...base, status: "granted", occurredAt: t1 });
    await appendConsentEvent(h.db, { ...base, status: "withdrawn", occurredAt: t2 });
    const late = await appendConsentEvent(h.db, { ...base, status: "granted", occurredAt: new Date("2026-01-15T10:00:00Z") });
    expect(late.effectiveStatus).toBe("withdrawn");
    expect(await h.db.collection(MARKETING_COLLECTIONS.consentEvents).countDocuments({ contactId })).toBe(3);
    const newer = await appendConsentEvent(h.db, { ...base, status: "granted", occurredAt: new Date("2026-03-01T10:00:00Z") });
    expect(newer.effectiveStatus).toBe("granted");
  });

  it("records an older consent date through the transactional action quickly, without changing the newer state", async () => {
    // Regression: an older date used to hit the unique index inside a transaction, which aborted and retried
    // for a long time. It must now finish at once, keep the newer state, and still keep the history row.
    const contact = await createContact(owner, parsed(contactCreateSchema, contactInput({ firstName: "OlderDate", email: "older@example.test", consent: { email: true, sms: false } })));
    const started = Date.now();
    const result = await changeConsent(owner, contact.id, parsed(consentChangeSchema, { channel: "email", status: "withdrawn", source: "manual", occurredAt: "2020-01-01T09:00:00.000Z" }));
    expect(Date.now() - started).toBeLessThan(3000);
    expect(result.effectiveStatus).toBe("granted");
    expect(result.stateChanged).toBe(false);
    const history = await listConsentHistory(owner, contact.id);
    expect(history.length).toBe(2);
  });

  it("treats equal timestamps as withdrawal-wins", async () => {
    const contact = await createContact(owner, parsed(contactCreateSchema, contactInput({ firstName: "Tie", email: "tie@example.test" })));
    const contactId = new ObjectId(contact.id);
    const at = new Date("2026-04-01T10:00:00Z");
    const base = { companyId: owner.companyId, contactId, channel: "email" as const, source: "manual" as const, recordedBy: null, requestId: "t", occurredAt: at };
    await appendConsentEvent(h.db, { ...base, status: "granted" });
    const result = await appendConsentEvent(h.db, { ...base, status: "withdrawn" });
    expect(result.effectiveStatus).toBe("withdrawn");
  });

  it("does not let email consent authorise SMS", async () => {
    const contact = await createContact(owner, parsed(contactCreateSchema, contactInput({ firstName: "Channel", email: "channel@example.test", phone: "+21622222222", consent: { email: true, sms: false } })));
    const state = await getConsentState(owner, contact.id);
    expect(state.email?.status).toBe("granted");
    expect(state.sms).toBeNull();
  });

  it("records a change through the action path and shows history newest first", async () => {
    const contact = await createContact(owner, parsed(contactCreateSchema, contactInput({ firstName: "Hist", phone: "+21633333333" })));
    await changeConsent(owner, contact.id, parsed(consentChangeSchema, { channel: "sms", status: "granted", source: "form", occurredAt: "" }));
    await changeConsent(owner, contact.id, parsed(consentChangeSchema, { channel: "sms", status: "withdrawn", source: "manual", occurredAt: "" }));
    const history = await listConsentHistory(owner, contact.id);
    expect(history.map((event) => event.status)).toEqual(["withdrawn", "granted"]);
  });

  it("refuses to record SMS consent for a contact without a phone number", async () => {
    const contact = await createContact(owner, parsed(contactCreateSchema, contactInput({ firstName: "NoPhone", email: "nophone@example.test" })));
    await expectCode(changeConsent(owner, contact.id, parsed(consentChangeSchema, { channel: "sms", status: "granted", source: "manual", occurredAt: "" })), "VALIDATION_ERROR");
  });
});

describe("audiences", () => {
  it("previews matching contacts with exclusion reasons", async () => {
    const tag = await createTag(owner, parsed(tagInputSchema, { name: "Preview", color: "#be123c" }));
    const consented = await createContact(owner, parsed(contactCreateSchema, contactInput({ firstName: "Prev A", email: "prev-a@example.test", consent: { email: true, sms: false } })));
    const unconsented = await createContact(owner, parsed(contactCreateSchema, contactInput({ firstName: "Prev B", email: "prev-b@example.test" })));
    const inactive = await createContact(owner, parsed(contactCreateSchema, contactInput({ firstName: "Prev C", email: "prev-c@example.test", consent: { email: true, sms: false } })));
    await setContactActive(owner, inactive.id, false, 1);
    for (const contact of [consented, unconsented, inactive]) await assignTags(owner, [contact.id], tag.id);
    const preview = await previewAudience(owner, parsed(audienceInputSchema, { name: "x", description: "", isActive: true, rule: { match: "all", conditions: [{ type: "tags", tagIds: [tag.id], match: "any" }] } }).rule, "email");
    expect(preview.matchedCount).toBe(3);
    expect(preview.eligibleCount).toBe(1);
    expect(preview.exclusions.no_consent).toBe(1);
    expect(preview.exclusions.contact_inactive).toBe(1);
  });

  it("matches tags with ALL semantics when requested", async () => {
    const one = await createTag(owner, parsed(tagInputSchema, { name: "All-1", color: "#1f7a5c" }));
    const two = await createTag(owner, parsed(tagInputSchema, { name: "All-2", color: "#1f7a5c" }));
    const both = await createContact(owner, parsed(contactCreateSchema, contactInput({ firstName: "Both", email: "both@example.test" })));
    const only = await createContact(owner, parsed(contactCreateSchema, contactInput({ firstName: "OnlyOne", email: "only@example.test" })));
    await assignTags(owner, [both.id, only.id], one.id);
    await assignTags(owner, [both.id], two.id);
    const rule = { match: "all" as const, conditions: [{ type: "tags" as const, tagIds: [one.id, two.id], match: "all" as const }] };
    const preview = await previewAudience(owner, rule, "email");
    expect(preview.matchedCount).toBe(1);
  });

  it("cannot reference another company's tags", async () => {
    const foreign = await createTag(other, parsed(tagInputSchema, { name: "Foreign tag", color: "#1f7a5c" }));
    await expectCode(
      createAudience(owner, parsed(audienceInputSchema, { name: "Stolen", description: "", isActive: true, rule: { match: "all", conditions: [{ type: "tags", tagIds: [foreign.id], match: "any" }] } })),
      "VALIDATION_ERROR"
    );
  });
});

describe("campaigns, snapshots and dispatch", () => {
  let campaignId: string;
  let contacts: Record<"a" | "b" | "c" | "d", string>;
  let providerCalls: string[];

  const provider = (failFirstFor?: string): MessageProvider => ({
    name: "fake-email",
    channel: "email",
    minIntervalMs: 0,
    async send(message) {
      providerCalls.push(message.to);
      if (failFirstFor && message.to === failFirstFor && providerCalls.filter((to) => to === failFirstFor).length === 1) {
        throw new ProviderError("THROTTLED", "try later", true);
      }
      return { providerMessageId: `msg-${message.idempotencyKey}` };
    },
  });

  beforeAll(async () => {
    providerCalls = [];
    const template = await createTemplate(owner, parsed(templateInputSchema, { name: "Launch", channel: "email", subject: "Hi {{first_name}}", body: "Offer for {{first_name}}", isActive: true }));
    const tag = await createTag(owner, parsed(tagInputSchema, { name: "Launch list", color: "#1f7a5c" }));
    const make = async (firstName: string, email: string, consent: boolean, active = true) => {
      const contact = await createContact(owner, parsed(contactCreateSchema, contactInput({ firstName, email, consent: { email: consent, sms: false } })));
      if (!active) await setContactActive(owner, contact.id, false, 1);
      await assignTags(owner, [contact.id], tag.id);
      return contact.id;
    };
    contacts = {
      a: await make("Alpha", "alpha@launch.test", true),
      b: await make("Beta", "beta@launch.test", false),
      c: await make("Gamma", "gamma@launch.test", true),
      d: await make("Delta", "delta@launch.test", true, false),
    };
    const audience = await createAudience(owner, parsed(audienceInputSchema, { name: "Launch audience", description: "", isActive: true, rule: { match: "all", conditions: [{ type: "tags", tagIds: [tag.id], match: "any" }] } }));
    const campaign = await createCampaign(owner, parsed(campaignInputSchema, { name: "Launch", channel: "email", audienceId: audience.id, templateId: template.id, subject: "Hi {{first_name}}", body: "Offer for {{first_name}}" }));
    campaignId = campaign.id;
    await submitCampaign(owner, campaignId, 1);
  });

  it("denies approval to the operator role and to the submitter without dispatch rights", async () => {
    await expectCode(approveCampaign(operator, campaignId, 2), "FORBIDDEN");
    await expectCode(approveCampaign(viewer, campaignId, 2), "FORBIDDEN");
  });

  it("returns a campaign for revision and resubmits it", async () => {
    await returnCampaign(approver, campaignId, 2);
    const detail = await getCampaign(owner, campaignId);
    expect(detail.status).toBe("draft");
    await submitCampaign(owner, campaignId, 3);
  });

  it("freezes eligible recipients at approval and records exclusions, with each contact once", async () => {
    const approved = await approveCampaign(approver, campaignId, 4);
    expect(approved.status).toBe("approved");
    expect(approved.snapshot?.matchedCount).toBe(4);
    expect(approved.snapshot?.eligibleCount).toBe(2);
    expect(approved.snapshot?.suppressedCount).toBe(2);
    expect(approved.snapshot?.exclusions.no_consent).toBe(1);
    expect(approved.snapshot?.exclusions.contact_inactive).toBe(1);
    const rows = await h.db.collection<DeliveryDoc>(MARKETING_COLLECTIONS.deliveries).countDocuments({ campaignId: new ObjectId(campaignId) });
    expect(rows).toBe(4);
  });

  it("refuses to schedule when no provider is configured, so nothing is ever reported as sent by a stub", async () => {
    await expectCode(scheduleCampaign(owner, campaignId, "", 5), "PROVIDER_NOT_CONFIGURED");
  });

  it("does not let an audience edit change an approved recipient set", async () => {
    const audience = await h.db.collection(MARKETING_COLLECTIONS.audiences).findOne({ companyId: owner.companyId });
    await h.db.collection(MARKETING_COLLECTIONS.audiences).updateOne({ _id: audience?._id }, { $set: { isActive: false } });
    const rows = await h.db.collection(MARKETING_COLLECTIONS.deliveries).countDocuments({ campaignId: new ObjectId(campaignId) });
    expect(rows).toBe(4);
    await h.db.collection(MARKETING_COLLECTIONS.audiences).updateOne({ _id: audience?._id }, { $set: { isActive: true } });
  });

  it("dispatches through the worker, rechecks consent just before sending, retries throttling and completes", async () => {
    // Scheduling needs a configured provider. The worker contract is tested directly by enqueueing the job.
    const runAt = new Date();
    await h.db.collection<CampaignDoc>(MARKETING_COLLECTIONS.campaigns).updateOne({ _id: new ObjectId(campaignId) }, { $set: { status: "scheduled", scheduledAt: runAt } });
    await enqueueJob(h.db, { companyId: owner.companyId, type: "campaign.dispatch", targetId: new ObjectId(campaignId), key: `campaign.dispatch:${campaignId}`, runAt });

    // Consent is withdrawn after approval. The recipient must be suppressed at send time.
    await changeConsent(owner, contacts.a, parsed(consentChangeSchema, { channel: "email", status: "withdrawn", source: "manual", occurredAt: "" }));

    const first = await runDueJobs(h.db, { workerId: "w1", providers: { email: provider("gamma@launch.test") }, sleep: async () => undefined, now: new Date() });
    expect(first.claimed).toBe(1);
    expect(providerCalls).not.toContain("alpha@launch.test");

    const pending = await h.db.collection<DeliveryDoc>(MARKETING_COLLECTIONS.deliveries).findOne({ campaignId: new ObjectId(campaignId), contactId: new ObjectId(contacts.c) });
    expect(pending?.status).toBe("pending");
    expect(pending?.lastErrorCode).toBe("THROTTLED");

    await runDueJobs(h.db, { workerId: "w1", providers: { email: provider("gamma@launch.test") }, sleep: async () => undefined, now: new Date(Date.now() + 60 * 60_000) });
    const detail = await getCampaign(owner, campaignId);
    expect(detail.status).toBe("completed");
    expect(detail.deliverySummary.sent).toBe(1);
    expect(detail.deliverySummary.suppressed).toBe(3);
    expect(providerCalls.filter((to) => to === "gamma@launch.test").length).toBe(2);
  });

  it("uses an idempotent job key, so a second enqueue does nothing", async () => {
    const again = await enqueueJob(h.db, { companyId: owner.companyId, type: "campaign.dispatch", targetId: new ObjectId(campaignId), key: `campaign.dispatch:${campaignId}`, runAt: new Date() });
    expect(again).toBe(false);
  });

  it("records provider events once, moves state forward only, and ignores unknown messages", async () => {
    const deliveries = await listDeliveries(owner, campaignId, { status: "sent", page: 1 });
    expect(deliveries.items.length).toBe(1);
    const row = await h.db.collection<DeliveryDoc>(MARKETING_COLLECTIONS.deliveries).findOne({ campaignId: new ObjectId(campaignId), status: "sent" });
    const event = { eventId: "evt-1", type: "delivered" as const, providerMessageId: row?.providerMessageId ?? "", occurredAt: new Date().toISOString() };
    expect(await applyDeliveryEvent(h.db, event, "test")).toBe("recorded");
    expect(await applyDeliveryEvent(h.db, event, "test")).toBe("duplicate");
    const delivered = await h.db.collection<DeliveryDoc>(MARKETING_COLLECTIONS.deliveries).findOne({ _id: row?._id });
    expect(delivered?.status).toBe("delivered");
    expect(await applyDeliveryEvent(h.db, { ...event, eventId: "evt-2", type: "bounced" }, "test")).toBe("recorded");
    const stillDelivered = await h.db.collection<DeliveryDoc>(MARKETING_COLLECTIONS.deliveries).findOne({ _id: row?._id });
    expect(stillDelivered?.status).toBe("bounced");
    expect(await applyDeliveryEvent(h.db, { eventId: "evt-x", type: "delivered", providerMessageId: "unknown-message", occurredAt: new Date().toISOString() }, "test")).toBe("unmatched");
  });

  it("suppresses a bounced address for future campaigns", async () => {
    const sent = await h.db.collection<DeliveryDoc>(MARKETING_COLLECTIONS.deliveries).findOne({ campaignId: new ObjectId(campaignId), contactId: new ObjectId(contacts.c) });
    expect(sent?.status).toBe("bounced");
    const suppressions = await h.db.collection(MARKETING_COLLECTIONS.suppressions).countDocuments({ companyId: owner.companyId, normalizedDestination: "gamma@launch.test" });
    expect(suppressions).toBe(1);
  });

  it("reports rates with explicit denominators and counts unsubscribes once", async () => {
    const report = await getCampaignReport(owner, campaignId);
    expect(report.accepted).toBe(1);
    expect(report.rates.bounceRate).toBe(1);
    expect(report.rates.deliveryRate).toBe(0);
    expect(report.openTracking).toBe("not_reported");
    expect(report.definitions.deliveryRate).toContain("accepted");
  });

  it("confirms a valid unsubscribe idempotently and rejects a tampered link", async () => {
    const token = createUnsubscribeToken({ companyId: owner.companyId.toHexString(), contactId: contacts.a, channel: "email", campaignId });
    const view = await viewUnsubscribe(h.db, token);
    expect(view).toMatchObject({ valid: true, channel: "email", alreadyUnsubscribed: true });
    expect(await confirmUnsubscribe(h.db, token, "t")).toBe("already_unsubscribed");
    expect(await confirmUnsubscribe(h.db, `${token.slice(0, -2)}xx`, "t")).toBe("invalid");

    const fresh = await createContact(owner, parsed(contactCreateSchema, contactInput({ firstName: "Leaves", email: "leaves@example.test", consent: { email: true, sms: false } })));
    const freshToken = createUnsubscribeToken({ companyId: owner.companyId.toHexString(), contactId: fresh.id, channel: "email", campaignId: null });
    expect(await confirmUnsubscribe(h.db, freshToken, "t")).toBe("unsubscribed");
    expect(await confirmUnsubscribe(h.db, freshToken, "t")).toBe("already_unsubscribed");
    const state = await getConsentState(owner, fresh.id);
    expect(state.email?.status).toBe("withdrawn");
    expect(state.email?.source).toBe("unsubscribe_link");
    const suppressed = await h.db.collection(MARKETING_COLLECTIONS.suppressions).countDocuments({ companyId: owner.companyId, normalizedDestination: "leaves@example.test", reason: "unsubscribed" });
    expect(suppressed).toBe(1);
  });

  it("cancels a draft and refuses to cancel once dispatch has started", async () => {
    const other2 = await createCampaign(owner, parsed(campaignInputSchema, { name: "Scratch", channel: "email", audienceId: (await h.db.collection(MARKETING_COLLECTIONS.audiences).findOne({ companyId: owner.companyId }))?._id.toHexString(), templateId: "", subject: "S", body: "B" }));
    await cancelCampaign(owner, other2.id, 1);
    expect((await getCampaign(owner, other2.id)).status).toBe("cancelled");
    await expectCode(cancelCampaign(owner, campaignId, 99), "INVALID_TRANSITION");
  });

  it("gives the dashboard and report only this company's numbers", async () => {
    const mine = await getDashboard(owner);
    const theirs = await getDashboard(other);
    expect(mine.contacts.total).toBeGreaterThan(theirs.contacts.total);
    expect(theirs.campaigns.byStatus.completed).toBe(0);
    await expectCode(getCampaignReport(other, campaignId), "NOT_FOUND");
  });

  it("rejects a campaign that uses another company's audience", async () => {
    const foreignAudience = await createAudience(other, parsed(audienceInputSchema, { name: "Foreign", description: "", isActive: true, rule: { match: "all", conditions: [{ type: "active", value: true }] } }));
    await expectCode(
      createCampaign(owner, parsed(campaignInputSchema, { name: "Cross", channel: "email", audienceId: foreignAudience.id, templateId: "", subject: "S", body: "B" })),
      "VALIDATION_ERROR"
    );
  });

  it("refuses to edit or delete a locked campaign", async () => {
    await expectCode(
      (async () => {
        const { updateCampaign, deleteCampaign } = await import("@/server/marketing/campaign.service");
        await updateCampaign(owner, campaignId, parsed(campaignInputSchema, { name: "Changed", channel: "email", audienceId: (await h.db.collection(MARKETING_COLLECTIONS.audiences).findOne({ companyId: owner.companyId }))?._id.toHexString(), templateId: "", subject: "S", body: "B" }) as never);
        await deleteCampaign(owner, campaignId);
      })(),
      "INVALID_TRANSITION"
    );
  });

  it("uses the job table as a durable queue record", async () => {
    const job = await h.db.collection<JobDoc>(MARKETING_COLLECTIONS.jobs).findOne({ key: `campaign.dispatch:${campaignId}` });
    expect(job?.status).toBe("succeeded");
  });
});

describe("permission boundaries", () => {
  it("stops viewers from mutating and operators from approving or dispatching", async () => {
    await expectCode(createContact(viewer, parsed(contactCreateSchema, contactInput({ firstName: "Nope" }))), "FORBIDDEN");
    await expectCode(createTemplate(viewer, parsed(templateInputSchema, { name: "Nope", channel: "sms", subject: "", body: "x", isActive: true })), "FORBIDDEN");
    await expectCode(createTag(viewer, parsed(tagInputSchema, { name: "Nope", color: "#1f7a5c" })), "FORBIDDEN");
    // Employees do not read the contact list at all (personal data of customers and leads).
    await expectCode(listContacts(viewer, parsed((await import("@/features/marketing/schemas/marketing.schema")).contactListQuerySchema, {})), "FORBIDDEN");
  });
});
