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
import { isAllowlistedDestination } from "@/server/marketing/config";
import type { MessageProvider } from "@/server/marketing/providers";
import type { MarketingChannel } from "@/features/marketing/types/constants";
import type { WorkspaceContext } from "@/server/tenancy/workspace";

// The controlled-recipient list, set before the configuration is first read. Real provider credentials are never involved.
vi.hoisted(() => {
  process.env.MARKETING_SEND_ALLOWLIST = "ok@example.test,+21620000001,111222333";
});

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

beforeAll(async () => {
  h = await createHarness();
  owner = h.ctx("owner");
});
afterAll(async () => {
  await h.cleanup();
});

describe("the recipient allowlist is one gate for every channel", () => {
  it("the shared check understands email addresses, phone numbers and Telegram chat ids, and is case-insensitive", () => {
    expect(isAllowlistedDestination("email", "OK@Example.test")).toBe(true);
    expect(isAllowlistedDestination("email", "blocked@example.test")).toBe(false);
    expect(isAllowlistedDestination("sms", "+21620000001")).toBe(true);
    expect(isAllowlistedDestination("sms", "21620000001")).toBe(true);
    expect(isAllowlistedDestination("sms", "+21620000002")).toBe(false);
    expect(isAllowlistedDestination("telegram", "111222333")).toBe(true);
    expect(isAllowlistedDestination("telegram", "999")).toBe(false);
    expect(isAllowlistedDestination("telegram", "ok@example.test")).toBe(true); // a list is a list; ids never collide with addresses
  });

  for (const [channel, allowed, blocked] of [
    ["email", { email: "ok@example.test" }, { email: "blocked@example.test" }],
    ["sms", { phone: "+21620000001" }, { phone: "+21620000002" }],
    ["telegram", { chatId: "111222333" }, { chatId: "444555666" }],
  ] as const) {
    it(`${channel}: an unlisted recipient is never handed to the provider, even a provider that ignores the list`, async () => {
      const sent: string[] = [];
      const id = await campaignFor(channel, [allowed, blocked]);
      await runDueJobs(h.db, { workerId: `allow-${channel}`, providers: { [channel]: bareProvider(channel, sent) }, sleep: async () => undefined });
      const rows = await deliveriesOf(id);
      expect(sent).toHaveLength(1);
      expect(rows.filter((r) => r.status === "sent")).toHaveLength(1);
      const refused = rows.filter((r) => r.status === "failed");
      expect(refused).toHaveLength(1);
      expect(refused[0]).toMatchObject({ lastErrorCode: "NOT_ALLOWLISTED", attemptCount: 1 });
      expect(rows.some((r) => r.status === "pending" || r.status === "sending")).toBe(false);
    });
  }
});
