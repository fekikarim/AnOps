import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createHarness, parsed, type TestHarness } from "../helpers/workspace";
import { MARKETING_COLLECTIONS, type CampaignDoc, type ConsentStateDoc, type DeliveryDoc, type TelegramSubscriptionDoc } from "@/server/marketing/documents";
import { audienceInputSchema, campaignInputSchema, contactCreateSchema, tagInputSchema } from "@/features/marketing/schemas/marketing.schema";
import { createContact } from "@/server/marketing/contact.service";
import { assignTags, createTag } from "@/server/marketing/tag.service";
import { createAudience } from "@/server/marketing/audience.service";
import { approveCampaign, createCampaign, submitCampaign } from "@/server/marketing/campaign.service";
import { enqueueJob } from "@/server/marketing/jobs";
import { runDueJobs } from "@/server/marketing/dispatch";
import { getSendAllowlist, isAllowlistedDestination } from "@/server/marketing/config";
import { parseAllowlist } from "@/server/marketing/providers/brevo/config";
import { assertMaySchedule } from "@/server/ai/marketing/access";
import type { MessageProvider } from "@/server/marketing/providers";
import type { MarketingChannel } from "@/features/marketing/types/constants";
import type { WorkspaceContext } from "@/server/tenancy/workspace";

let h: TestHarness;
let owner: WorkspaceContext;
let seq = 0;

/** A provider that does NOT check the allowlist itself: only the dispatch gate stands between it and the recipient. */
function bareProvider(channel: MarketingChannel, sent: string[]): MessageProvider {
  return { name: `bare-${channel}`, channel, minIntervalMs: 0, send: async (m) => (sent.push(m.to), { providerMessageId: `m-${new ObjectId().toHexString()}` }) };
}

async function campaignFor(channel: MarketingChannel, recipients: { email?: string; phone?: string; chatId?: string }[]) {
  const tag = await createTag(owner, parsed(tagInputSchema, { name: `Tag ${++seq}-${Date.now()}`, color: "#1f7a5c" }));
  for (const r of recipients) {
    const c = await createContact(owner, parsed(contactCreateSchema, { firstName: "Rec", lastName: String(++seq), email: r.email ?? "", phone: r.phone ?? "", source: "manual", lifecycleStage: "lead", isActive: true, consent: { email: channel === "email", sms: channel === "sms" } }));
    await assignTags(owner, [c.id], tag.id);
    if (channel === "telegram") {
      const now = new Date();
      const contactId = new ObjectId(c.id);
      await h.db.collection<ConsentStateDoc>(MARKETING_COLLECTIONS.consentStates).insertOne({ _id: new ObjectId(), companyId: owner.companyId, contactId, channel: "telegram", purpose: "marketing", status: "granted", occurredAt: now, eventId: new ObjectId(), updatedAt: now });
      await h.db.collection<TelegramSubscriptionDoc>(MARKETING_COLLECTIONS.telegramSubscriptions).insertOne({ _id: new ObjectId(), companyId: owner.companyId, contactId, chatId: r.chatId!, username: null, status: "active", connectedAt: now, disconnectedAt: null, blockedAt: null, lastErrorCode: null, createdAt: now, updatedAt: now, version: 1 });
    }
  }
  const audience = await createAudience(owner, parsed(audienceInputSchema, { name: `Aud ${++seq}-${Date.now()}`, description: "", isActive: true, rule: { match: "all", conditions: [{ type: "tags", tagIds: [tag.id], match: "any" }] } }));
  const created = await createCampaign(owner, parsed(campaignInputSchema, { name: `C ${++seq}-${Date.now()}`, channel, audienceId: audience.id, templateId: null, subject: channel === "email" ? "Hello" : "", body: channel === "email" ? "Hi {{first_name}} {{unsubscribe_url}}" : "Hi {{first_name}}" }));
  await submitCampaign(owner, created.id, created.version);
  const approved = await approveCampaign(owner, created.id, created.version + 1);
  await h.db.collection<CampaignDoc>(MARKETING_COLLECTIONS.campaigns).updateOne({ _id: new ObjectId(approved.id) }, { $set: { status: "scheduled", scheduledAt: new Date() } });
  await enqueueJob(h.db, { companyId: owner.companyId, type: "campaign.dispatch", targetId: new ObjectId(approved.id), key: `campaign.dispatch:${approved.id}`, runAt: new Date() });
  return approved.id;
}
const deliveriesOf = (id: string) => h.db.collection<DeliveryDoc>(MARKETING_COLLECTIONS.deliveries).find({ campaignId: new ObjectId(id) }).toArray();


// MARKETING_SEND_ALLOWLIST is deliberately NOT set here (the hermetic test environment clears it). Fake providers only.

beforeAll(async () => {
  h = await createHarness();
  owner = h.ctx("owner");
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await h.cleanup();
});

const CHANNELS = [
  ["email", { email: "someone@example.test" }],
  ["sms", { phone: "+21620000009" }],
  ["telegram", { chatId: "777888999" }],
] as const;

describe("no allowlist configured", () => {
  it("has no list", () => {
    expect(getSendAllowlist()).toBeNull();
  });

  it("outside production the shared check refuses every channel, so nothing can reach arbitrary recipients", () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(isAllowlistedDestination("email", "anyone@example.com")).toBe(false);
    expect(isAllowlistedDestination("sms", "+21620000009")).toBe(false);
    expect(isAllowlistedDestination("telegram", "777888999")).toBe(false);
    vi.stubEnv("NODE_ENV", "development");
    expect(isAllowlistedDestination("email", "anyone@example.com")).toBe(false);
  });

  it("in production an unset list is the normal open behaviour, on purpose", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isAllowlistedDestination("email", "anyone@example.com")).toBe(true);
    expect(isAllowlistedDestination("sms", "+21620000009")).toBe(true);
    expect(isAllowlistedDestination("telegram", "777888999")).toBe(true);
  });

  it("AI scheduling follows the same policy: refused outside production, allowed in production", () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(() => assertMaySchedule()).toThrow(/allowlist/i);
    vi.stubEnv("NODE_ENV", "production");
    expect(() => assertMaySchedule()).not.toThrow();
  });

  it("a list that names nobody parses to an empty list (set but empty), which allows nobody", () => {
    expect(parseAllowlist("")).toBeNull();
    expect(parseAllowlist("  ")).toBeNull();
    expect(parseAllowlist(" , ,")).toEqual([]);
  });

  for (const [channel, base] of CHANNELS) {
    const recipient = base as { email?: string; phone?: string; chatId?: string };
    it(`${channel}: the dispatch gate hands nothing to the provider outside production`, async () => {
      vi.stubEnv("NODE_ENV", "test");
      const sent: string[] = [];
      const id = await campaignFor(channel, [recipient]);
      await runDueJobs(h.db, { workerId: `unset-${channel}`, providers: { [channel]: bareProvider(channel, sent) }, sleep: async () => undefined });
      const rows = await deliveriesOf(id);
      expect(sent).toHaveLength(0);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: "failed", lastErrorCode: "NOT_ALLOWLISTED" });
    });

    it(`${channel}: in production with no list the fake provider is called`, async () => {
      vi.stubEnv("NODE_ENV", "production");
      const sent: string[] = [];
      const id = await campaignFor(channel, [{ email: recipient.email && "prod-" + recipient.email, phone: recipient.phone && recipient.phone.slice(0, -1) + "8", chatId: recipient.chatId && recipient.chatId + "1" }]);
      await runDueJobs(h.db, { workerId: `prod-${channel}`, providers: { [channel]: bareProvider(channel, sent) }, sleep: async () => undefined });
      expect(sent).toHaveLength(1);
      expect((await deliveriesOf(id))[0]).toMatchObject({ status: "sent" });
    });
  }
});
