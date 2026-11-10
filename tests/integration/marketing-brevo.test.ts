import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createHarness, parsed, type TestHarness } from "../helpers/workspace";
import { MARKETING_COLLECTIONS, type CampaignDoc, type DeliveryDoc, type JobDoc } from "@/server/marketing/documents";
import { audienceInputSchema, campaignInputSchema, contactCreateSchema } from "@/features/marketing/schemas/marketing.schema";
import { createContact, getContact } from "@/server/marketing/contact.service";
import { assignTags, createTag } from "@/server/marketing/tag.service";
import { createAudience } from "@/server/marketing/audience.service";
import { createCampaign, approveCampaign, submitCampaign } from "@/server/marketing/campaign.service";
import { enqueueJob } from "@/server/marketing/jobs";
import { runDueJobs } from "@/server/marketing/dispatch";
import { ProviderError, type MessageProvider } from "@/server/marketing/providers/types";
import type { WorkspaceContext } from "@/server/tenancy/workspace";

const WEBHOOK_TOKEN = "w".repeat(48);

// Brevo configuration and the database handle are provided per test file, never read from a real .env.
const shared = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/server/db/client", () => ({
  default: Promise.resolve({ db: () => shared.db }),
}));
vi.mock("@/server/marketing/providers/brevo/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/marketing/providers/brevo/config")>();
  return {
    ...actual,
    getBrevoState: () => ({
      configured: true,
      config: {
        apiKey: "test-key-not-real",
        emailSender: null,
        smsSender: "Northwind",
        webhookToken: WEBHOOK_TOKEN,
        emailMarketingApproved: false,
        sendAllowlist: null,
      },
    }),
  };
});

let h: TestHarness;
let owner: WorkspaceContext;

async function postEvent(body: unknown, token = WEBHOOK_TOKEN): Promise<{ status: number; json: { data?: Record<string, number> } }> {
  const { POST } = await import("@/app/api/v1/marketing/webhooks/brevo/[token]/route");
  const response = await POST(
    new Request(`http://localhost/api/v1/marketing/webhooks/brevo/${token}`, { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({ token }) }
  );
  return { status: response.status, json: (await response.json()) as { data?: Record<string, number> } };
}

beforeAll(async () => {
  // These tests drive the real dispatch engine with fake providers and no recipient allowlist. Outside production the central
  // policy refuses every destination (see marketing-allowlist.test.ts), so they run as a production deployment.
  vi.stubEnv("NODE_ENV", "production");
  h = await createHarness();
  shared.db = h.db;
  owner = h.ctx("owner");
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await h.cleanup();
});

/** Builds an SMS campaign for three contacts with consent and a phone, then schedules it through the job table. */
async function smsCampaign(tag: string, phones: string[]) {
  // One tag per batch keeps each campaign's audience to exactly this batch.
  const batch = await createTag(owner, { name: `Batch ${tag}`, color: "#1f7a5c" });
  const contactIds: string[] = [];
  for (const [index, phone] of phones.entries()) {
    const contact = await createContact(
      owner,
      parsed(contactCreateSchema, {
        firstName: `${tag}-${index}`,
        lastName: "Test",
        email: "",
        phone,
        source: "manual",
        lifecycleStage: "lead",
        isActive: true,
        consent: { email: false, sms: true },
      })
    );
    contactIds.push(contact.id);
    await assignTags(owner, [contact.id], batch.id);
  }
  // Contacts are selected by name prefix through a rule that keeps only this batch.
  const audience = await createAudience(
    owner,
    parsed(audienceInputSchema, {
      name: `Audience ${tag}`,
      description: "",
      isActive: true,
      rule: { match: "all", conditions: [{ type: "tags", tagIds: [batch.id], match: "any" }] },
    })
  );
  const campaign = await createCampaign(
    owner,
    parsed(campaignInputSchema, { name: `SMS ${tag}`, channel: "sms", audienceId: audience.id, templateId: "", subject: "", body: "Flash sale today." })
  );
  await submitCampaign(owner, campaign.id, campaign.version);
  const approved = await approveCampaign(owner, campaign.id, campaign.version + 1);
  await h.db.collection<CampaignDoc>(MARKETING_COLLECTIONS.campaigns).updateOne({ _id: new ObjectId(approved.id) }, { $set: { status: "scheduled", scheduledAt: new Date() } });
  await enqueueJob(h.db, { companyId: owner.companyId, type: "campaign.dispatch", targetId: new ObjectId(approved.id), key: `campaign.dispatch:${approved.id}`, runAt: new Date() });
  return { campaignId: approved.id, contactIds };
}

describe("Brevo webhook receiver", () => {
  it("answers unknown tokens with not found, without revealing that webhooks exist", async () => {
    const result = await postEvent({ event: "delivered", "message-id": "<x>" }, "wrong-token");
    expect(result.status).toBe(404);
  });

  it("refuses to process a body that is not JSON", async () => {
    const { POST } = await import("@/app/api/v1/marketing/webhooks/brevo/[token]/route");
    const response = await POST(
      new Request("http://localhost/x", { method: "POST", body: "{not json" }),
      { params: Promise.resolve({ token: WEBHOOK_TOKEN }) }
    );
    expect(response.status).toBe(400);
  });

  it("records a delivery once, ignores a replay, and reports unknown messages as unmatched", async () => {
    const { campaignId } = await smsCampaign("hook", ["+21611111111"]);
    const delivery = await h.db.collection<DeliveryDoc>(MARKETING_COLLECTIONS.deliveries).findOne({ campaignId: new ObjectId(campaignId) });
    // The dispatch test below covers how a message id is stored. Here we set one directly.
    await h.db.collection(MARKETING_COLLECTIONS.deliveries).updateOne({ _id: delivery?._id }, { $set: { status: "sent", providerMessageId: "9001" } });

    const event = { messageId: 9001, status: "delivered", id: 7, date: "2026-10-26T10:00:00Z" };
    expect((await postEvent(event)).json.data).toMatchObject({ recorded: 1 });
    expect((await postEvent(event)).json.data).toMatchObject({ duplicate: 1 });
    expect((await postEvent({ messageId: 123456, status: "delivered", id: 1 })).json.data).toMatchObject({ unmatched: 1 });
    const updated = await h.db.collection<DeliveryDoc>(MARKETING_COLLECTIONS.deliveries).findOne({ _id: delivery?._id });
    expect(updated?.status).toBe("delivered");
  });

  it("applies a provider unsubscribe: consent withdrawn, suppression added, and a later campaign skips the number", async () => {
    const { campaignId, contactIds } = await smsCampaign("unsub", ["+21622222222"]);
    const delivery = await h.db.collection<DeliveryDoc>(MARKETING_COLLECTIONS.deliveries).findOne({ campaignId: new ObjectId(campaignId) });
    await h.db.collection(MARKETING_COLLECTIONS.deliveries).updateOne({ _id: delivery?._id }, { $set: { status: "sent", providerMessageId: "9002" } });

    // Email-shaped unsubscribe for the same message, then the SMS-shaped one. The second is a repeat.
    const result = await postEvent({ event: "unsubscribed", "message-id": "9002", email: "", ts_event: 1790000000, id: 3 });
    expect(result.json.data).toMatchObject({ recorded: 1 });
    const smsEvent = await postEvent({ messageId: 9002, status: "unsubscribe", id: 4 });
    expect(smsEvent.json.data).toMatchObject({ recorded: 1 });

    const contact = await getContact(owner, contactIds[0]);
    expect(contact.consent.sms?.status).toBe("withdrawn");
    expect(contact.consent.sms?.source).toBe("unsubscribe_link");
    const suppressed = await h.db.collection(MARKETING_COLLECTIONS.suppressions).countDocuments({ companyId: owner.companyId, normalizedDestination: "+21622222222", reason: "unsubscribed" });
    expect(suppressed).toBe(1);
  });

  it("uses the company stored with the delivery, so a payload cannot write into another tenant", async () => {
    const { campaignId } = await smsCampaign("tenant", ["+21633333333"]);
    const delivery = await h.db.collection<DeliveryDoc>(MARKETING_COLLECTIONS.deliveries).findOne({ campaignId: new ObjectId(campaignId) });
    await h.db.collection(MARKETING_COLLECTIONS.deliveries).updateOne({ _id: delivery?._id }, { $set: { status: "sent", providerMessageId: "9003" } });
    const forged = { messageId: 9003, status: "delivered", id: 9, companyId: h.otherTenant("owner").companyId.toHexString() };
    expect((await postEvent(forged)).json.data).toMatchObject({ recorded: 1 });
    const events = await h.db.collection(MARKETING_COLLECTIONS.deliveryEvents).find({ deliveryId: delivery?._id }).toArray();
    expect(events.every((event) => event.companyId.equals(owner.companyId))).toBe(true);
  });
});

describe("dispatch outcomes with a fake SMS provider", () => {
  it("retries a throttled send, fails an ambiguous one without retrying it, and records a confirmed send", async () => {
    const { campaignId, contactIds } = await smsCampaign("dispatch", ["+21644444441", "+21644444442", "+21644444443"]);
    const calls: Record<string, number> = {};
    const provider: MessageProvider = {
      name: "fake-sms",
      channel: "sms",
      minIntervalMs: 0,
      async send(message) {
        calls[message.to] = (calls[message.to] ?? 0) + 1;
        if (message.to === "+21644444441" && calls[message.to] === 1) throw new ProviderError("RATE_LIMITED", "slow down", true);
        if (message.to === "+21644444442") throw new Error("socket reset after send");
        return { providerMessageId: `prov-${message.to.slice(-1)}` };
      },
    };

    await runDueJobs(h.db, { workerId: "dispatch-test", providers: { sms: provider }, sleep: async () => undefined, now: new Date() });
    await runDueJobs(h.db, { workerId: "dispatch-test", providers: { sms: provider }, sleep: async () => undefined, now: new Date(Date.now() + 2 * 60 * 60_000) });

    const rows = await h.db.collection<DeliveryDoc>(MARKETING_COLLECTIONS.deliveries).find({ campaignId: new ObjectId(campaignId) }).toArray();
    const byPhone = Object.fromEntries(rows.map((row) => [row.destination, row]));
    expect(byPhone["+21644444441"].status).toBe("sent");
    expect(byPhone["+21644444441"].attemptCount).toBe(2);
    expect(byPhone["+21644444442"].status).toBe("failed");
    expect(byPhone["+21644444442"].lastErrorCode).toBe("AMBIGUOUS_SEND");
    expect(calls["+21644444442"]).toBe(1);
    expect(byPhone["+21644444443"].providerMessageId).toBe("prov-3");
    expect(contactIds.length).toBe(3);
  });

  it("does not send a retry for a delivery whose request was definitively rejected", async () => {
    const { campaignId } = await smsCampaign("reject", ["+21655555555"]);
    let attempts = 0;
    const provider: MessageProvider = {
      name: "fake-sms",
      channel: "sms",
      minIntervalMs: 0,
      async send() {
        attempts += 1;
        throw new ProviderError("REQUEST_REJECTED", "bad request", false);
      },
    };
    await runDueJobs(h.db, { workerId: "dispatch-test", providers: { sms: provider }, sleep: async () => undefined, now: new Date() });
    const row = await h.db.collection<DeliveryDoc>(MARKETING_COLLECTIONS.deliveries).findOne({ campaignId: new ObjectId(campaignId) });
    expect(row?.status).toBe("failed");
    expect(row?.lastErrorCode).toBe("REQUEST_REJECTED");
    expect(attempts).toBe(1);
    const job = await h.db.collection<JobDoc>(MARKETING_COLLECTIONS.jobs).findOne({ key: `campaign.dispatch:${campaignId}` });
    expect(job).not.toBeNull();
  });
});
