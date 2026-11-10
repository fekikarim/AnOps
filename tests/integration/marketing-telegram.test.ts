import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

// Telegram settings are read lazily, so they only need to exist before the first call. Test values only.
process.env.TELEGRAM_BOT_TOKEN = "123456789:TEST_TOKEN_abcdefghijklmnopqrstuvwxyz012";
process.env.TELEGRAM_BOT_USERNAME = "AnOpsTestBot";
process.env.TELEGRAM_WEBHOOK_SECRET = "w".repeat(40);

import { createHarness, parsed, type TestHarness } from "../helpers/workspace";
import {
  MARKETING_COLLECTIONS,
  type ConsentStateDoc,
  type DeliveryDoc,
  type SuppressionDoc,
  type TelegramLinkTokenDoc,
  type TelegramSubscriptionDoc,
} from "@/server/marketing/documents";
import { audienceInputSchema, campaignInputSchema, consentChangeSchema, contactCreateSchema, tagInputSchema } from "@/features/marketing/schemas/marketing.schema";
import { createContact } from "@/server/marketing/contact.service";
import { assignTags, createTag } from "@/server/marketing/tag.service";
import { changeConsent, getConsentState } from "@/server/marketing/consent.service";
import { createAudience } from "@/server/marketing/audience.service";
import { approveCampaign, createCampaign, getCampaign, scheduleCampaign, submitCampaign } from "@/server/marketing/campaign.service";
import { runDueJobs } from "@/server/marketing/dispatch";
import { getCampaignReport, getDashboard } from "@/server/marketing/analytics.service";
import { createTelegramLink, disconnectTelegram, getTelegramConnection, processTelegramUpdate, LINK_TOKEN_TTL_MS, hashLinkToken } from "@/server/marketing/telegram.service";
import { sendTelegramNotification } from "@/server/marketing/telegram-notify";
import { getTelegramState } from "@/server/marketing/providers/telegram/config";
import { createTelegramProvider } from "@/server/marketing/providers/telegram/adapters";
import { getConfiguredProviders } from "@/server/marketing/providers";
import type { WorkspaceContext } from "@/server/tenancy/workspace";

let h: TestHarness;
let owner: WorkspaceContext;
let approver: WorkspaceContext;
let operator: WorkspaceContext;
let viewer: WorkspaceContext;
let other: WorkspaceContext;

type Call = { method: string; body: Record<string, unknown> };
let calls: Call[] = [];
let respond: (call: Call) => Response = () => json(200, { ok: true, result: { message_id: nextMessageId() } });
let messageId = 100;
const nextMessageId = () => ++messageId;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

function stubTelegram() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: RequestInit) => {
      const method = String(url).split("/").pop() ?? "";
      const call = { method, body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> };
      calls.push(call);
      return respond(call);
    })
  );
}
const sends = () => calls.filter((call) => call.method === "sendMessage");

let sequence = 0;
let updateId = 1000;
const unique = (label: string) => `${label}-${++sequence}@example.test`;

async function contact(label: string, ctx: WorkspaceContext = owner) {
  return createContact(
    ctx,
    parsed(contactCreateSchema, {
      firstName: label,
      lastName: "Tester",
      email: unique(label),
      phone: "",
      source: "manual",
      lifecycleStage: "customer",
      isActive: true,
      consent: { email: false, sms: false },
    })
  );
}

const startUpdate = (token: string, chatId: number, username = "amina_t") => ({
  update_id: ++updateId,
  message: { message_id: 1, text: `/start ${token}`, chat: { id: chatId, type: "private" }, from: { id: chatId, is_bot: false, username } },
});
const stopUpdate = (chatId: number) => ({
  update_id: ++updateId,
  message: { message_id: 2, text: "/stop", chat: { id: chatId, type: "private" }, from: { id: chatId, is_bot: false } },
});

function tokenOf(url: string): string {
  return new URL(url).searchParams.get("start") ?? "";
}

/** Creates a contact, links a chat through the real webhook processor, and records Telegram marketing consent. */
async function connectedContact(label: string, chatId: number, consent = true) {
  const created = await contact(label);
  const link = await createTelegramLink(owner, created.id);
  expect(await processTelegramUpdate(h.db, startUpdate(tokenOf(link.url), chatId), "t")).toBe("connected");
  if (consent) {
    await changeConsent(owner, created.id, parsed(consentChangeSchema, { channel: "telegram", status: "granted", source: "manual", occurredAt: "" }));
  }
  return created;
}

async function approvedTelegramCampaign(contactIds: string[], body = "Hi {{first_name}}, new arrivals!") {
  const tag = await createTag(owner, parsed(tagInputSchema, { name: `TG ${++sequence}-${Date.now()}`, color: "#1f7a5c" }));
  for (const id of contactIds) await assignTags(owner, [id], tag.id);
  const audience = await createAudience(
    owner,
    parsed(audienceInputSchema, { name: `TG audience ${sequence}-${Date.now()}`, description: "", isActive: true, rule: { match: "all", conditions: [{ type: "tags", tagIds: [tag.id], match: "any" }] } })
  );
  const created = await createCampaign(
    owner,
    parsed(campaignInputSchema, { name: `TG campaign ${sequence}-${Date.now()}`, channel: "telegram", audienceId: audience.id, templateId: null, subject: "", body })
  );
  await submitCampaign(owner, created.id, created.version);
  return approveCampaign(approver, created.id, created.version + 1);
}

const providers = () => ({ telegram: createTelegramProvider((getTelegramState() as { config: Parameters<typeof createTelegramProvider>[0] }).config) });
const run = (workerId: string, now?: Date) => runDueJobs(h.db, { workerId, providers: providers(), sleep: async () => undefined, now });

const subscriptions = () => h.db.collection<TelegramSubscriptionDoc>(MARKETING_COLLECTIONS.telegramSubscriptions);
const delivery = (campaignId: string, contactId: string) =>
  h.db.collection<DeliveryDoc>(MARKETING_COLLECTIONS.deliveries).findOne({ companyId: owner.companyId, campaignId: new ObjectId(campaignId), contactId: new ObjectId(contactId) });
async function expectCode(promise: Promise<unknown>, code: string) {
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
afterEach(() => {
  calls = [];
  respond = () => json(200, { ok: true, result: { message_id: nextMessageId() } });
  vi.unstubAllGlobals();
});

describe("configuration", () => {
  it("registers Telegram as a provider only when the bot is fully configured", () => {
    expect(getTelegramState().configured).toBe(true);
    expect(getConfiguredProviders().telegram?.channel).toBe("telegram");
  });
});

describe("connection flow", () => {
  it("connects a chat to exactly the contact the token was issued for, and shows it in the UI data", async () => {
    stubTelegram();
    const created = await contact("Connect");
    expect((await getTelegramConnection(owner, created.id)).status).toBe("not_connected");
    const link = await createTelegramLink(owner, created.id);
    expect(link.url.startsWith("https://t.me/AnOpsTestBot?start=")).toBe(true);

    const stored = await h.db.collection<TelegramLinkTokenDoc>(MARKETING_COLLECTIONS.telegramLinkTokens).findOne({ contactId: new ObjectId(created.id) });
    expect(stored?._id).toBe(hashLinkToken(tokenOf(link.url)));
    expect(JSON.stringify(stored)).not.toContain(tokenOf(link.url));

    expect(await processTelegramUpdate(h.db, startUpdate(tokenOf(link.url), 7001, "amina_t"), "t")).toBe("connected");
    const connection = await getTelegramConnection(owner, created.id);
    expect(connection).toMatchObject({ status: "active", username: "amina_t", chatHint: "••••7001" });
    expect(JSON.stringify(connection)).not.toContain("chatId");
    expect(connection.history.map((item) => item.type)).toEqual(["connected"]);
    expect(sends().at(-1)?.body.chat_id).toBe("7001");
  });

  it("does not grant marketing consent when a customer presses Start", async () => {
    stubTelegram();
    const created = await connectedContact("NoConsent", 7002, false);
    expect((await getConsentState(owner, created.id)).telegram).toBeNull();
    await expectCode(
      changeConsent(owner, (await contact("NotLinked")).id, parsed(consentChangeSchema, { channel: "telegram", status: "granted", source: "manual", occurredAt: "" })),
      "VALIDATION_ERROR"
    );
  });

  it("consumes a token once: replay, expiry and garbage are all rejected", async () => {
    stubTelegram();
    const created = await contact("Replay");
    const link = await createTelegramLink(owner, created.id);
    const token = tokenOf(link.url);
    expect(await processTelegramUpdate(h.db, startUpdate(token, 7003), "t")).toBe("connected");
    expect(await processTelegramUpdate(h.db, startUpdate(token, 7004), "t")).toBe("link_invalid");
    expect((await subscriptions().findOne({ companyId: owner.companyId, contactId: new ObjectId(created.id) }))?.chatId).toBe("7003");

    const expired = await contact("Expired");
    const expiredToken = tokenOf((await createTelegramLink(owner, expired.id)).url);
    await h.db.collection<TelegramLinkTokenDoc>(MARKETING_COLLECTIONS.telegramLinkTokens).updateOne({ _id: hashLinkToken(expiredToken) }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await processTelegramUpdate(h.db, startUpdate(expiredToken, 7005), "t")).toBe("link_invalid");
    expect(await processTelegramUpdate(h.db, startUpdate("A".repeat(43), 7006), "t")).toBe("link_invalid");
    expect(LINK_TOKEN_TTL_MS).toBe(15 * 60_000);
  });

  it("regenerating a link revokes the previous unused one", async () => {
    stubTelegram();
    const created = await contact("Regen");
    const first = tokenOf((await createTelegramLink(owner, created.id)).url);
    const second = tokenOf((await createTelegramLink(owner, created.id)).url);
    expect(await processTelegramUpdate(h.db, startUpdate(first, 7007), "t")).toBe("link_invalid");
    expect(await processTelegramUpdate(h.db, startUpdate(second, 7007), "t")).toBe("connected");
  });

  it("ignores a repeated webhook update id", async () => {
    stubTelegram();
    const created = await contact("Dup");
    const update = startUpdate(tokenOf((await createTelegramLink(owner, created.id)).url), 7008);
    expect(await processTelegramUpdate(h.db, update, "t")).toBe("connected");
    const before = sends().length;
    expect(await processTelegramUpdate(h.db, update, "t")).toBe("duplicate");
    expect(sends().length).toBe(before);
  });

  it("does not link one Telegram account to a second contact of the same company", async () => {
    stubTelegram();
    await connectedContact("First", 7009, false);
    const second = await contact("Second");
    const outcome = await processTelegramUpdate(h.db, startUpdate(tokenOf((await createTelegramLink(owner, second.id)).url), 7009), "t");
    expect(outcome).toBe("link_conflict");
    expect((await getTelegramConnection(owner, second.id)).status).toBe("not_connected");
  });

  it("keeps companies apart: no cross-tenant read, link, disconnect or sending", async () => {
    stubTelegram();
    const mine = await connectedContact("Tenant", 7010);
    await expectCode(getTelegramConnection(other, mine.id), "NOT_FOUND");
    await expectCode(createTelegramLink(other, mine.id), "NOT_FOUND");
    await expectCode(disconnectTelegram(other, mine.id), "NOT_FOUND");
    await expectCode(
      sendTelegramNotification(h.db, { companyId: other.companyId, contactId: new ObjectId(mine.id), message: "hi", purpose: "transactional", actorUserId: other.userId, requestId: "t" }),
      "NOT_FOUND"
    );
    // The same Telegram account may belong to a contact of another company without touching this one.
    const theirs = await contact("Theirs", other);
    expect(await processTelegramUpdate(h.db, startUpdate(tokenOf((await createTelegramLink(other, theirs.id)).url), 7010), "t")).toBe("connected");
    expect((await getTelegramConnection(owner, mine.id)).status).toBe("active");
  });

  it("requires contact-management rights to create or remove a link", async () => {
    const created = await contact("Rights");
    await expectCode(createTelegramLink(viewer, created.id), "FORBIDDEN");
    await expectCode(disconnectTelegram(viewer, created.id), "FORBIDDEN");
    await expect(createTelegramLink(operator, created.id)).resolves.toBeTruthy();
  });

  it("disconnects and reconnects, and a disconnected contact is no longer a destination", async () => {
    stubTelegram();
    const created = await connectedContact("Reconnect", 7011);
    await disconnectTelegram(owner, created.id);
    expect((await getTelegramConnection(owner, created.id)).status).toBe("disconnected");
    const campaign = await approvedTelegramCampaign([created.id]).catch((e: { code: string }) => e);
    expect((campaign as { code: string }).code).toBe("VALIDATION_ERROR");
    expect(await processTelegramUpdate(h.db, startUpdate(tokenOf((await createTelegramLink(owner, created.id)).url), 7012), "t")).toBe("connected");
    const connection = await getTelegramConnection(owner, created.id);
    expect(connection.status).toBe("active");
    expect(connection.history.map((item) => item.type)).toEqual(["reconnected", "disconnected", "connected"]);
  });
});

describe("campaign engine", () => {
  it("sends a Telegram campaign through the existing worker, with consent, snapshot and delivery records", async () => {
    stubTelegram();
    const consented = await connectedContact("Sendable", 7101);
    const noConsent = await connectedContact("Silent", 7102, false);
    const notLinked = await contact("Unlinked");
    const campaign = await approvedTelegramCampaign([consented.id, noConsent.id, notLinked.id]);

    expect(campaign.snapshot).toMatchObject({ eligibleCount: 1, suppressedCount: 2 });
    expect(campaign.snapshot?.exclusions).toMatchObject({ no_consent: 1, missing_destination: 1 });

    await scheduleCampaign(owner, campaign.id, "", campaign.version);
    await run("tg-send");

    const messages = sends().filter((call) => call.body.chat_id === "7101" && String(call.body.text).includes("new arrivals"));
    expect(messages).toHaveLength(1);
    expect(messages[0].body.text).toBe("Hi Sendable, new arrivals!\n\nSend /stop to stop receiving marketing messages.");
    expect(messages[0].body).not.toHaveProperty("parse_mode");
    expect(sends().some((call) => call.body.chat_id === "7102" && String(call.body.text).includes("new arrivals"))).toBe(false);

    const sent = await delivery(campaign.id, consented.id);
    expect(sent).toMatchObject({ status: "sent", channel: "telegram", destination: "7101", attemptCount: 1 });
    expect(sent?.providerMessageId).toMatch(/^7101:\d+$/);
    expect(sent?.deliveredAt).toBeNull();
    expect((await delivery(campaign.id, noConsent.id))?.status).toBe("suppressed");
    expect((await getCampaign(owner, campaign.id)).status).toBe("completed");

    // A further worker pass cannot send it again.
    await run("tg-again", new Date(Date.now() + 3_600_000));
    expect(sends().filter((call) => call.body.chat_id === "7101" && String(call.body.text).includes("new arrivals"))).toHaveLength(1);
  });

  it("applies the separation of duties: the creator cannot approve their own Telegram campaign without dispatch rights", async () => {
    const created = await connectedContact("Duty", 7103);
    const tag = await createTag(owner, parsed(tagInputSchema, { name: `Duty ${Date.now()}`, color: "#1f7a5c" }));
    await assignTags(owner, [created.id], tag.id);
    const audience = await createAudience(owner, parsed(audienceInputSchema, { name: `Duty ${Date.now()}`, description: "", isActive: true, rule: { match: "all", conditions: [{ type: "tags", tagIds: [tag.id], match: "any" }] } }));
    const draft = await createCampaign(operator, parsed(campaignInputSchema, { name: `Duty ${Date.now()}`, channel: "telegram", audienceId: audience.id, templateId: null, subject: "", body: "Hi" }));
    await submitCampaign(operator, draft.id, draft.version);
    await expectCode(approveCampaign(operator, draft.id, draft.version + 1), "FORBIDDEN");
  });

  it("stops a send after approval when the customer sends /stop", async () => {
    stubTelegram();
    const subscriber = await connectedContact("Leaves", 7104);
    const campaign = await approvedTelegramCampaign([subscriber.id]);
    expect(campaign.snapshot?.eligibleCount).toBe(1);

    expect(await processTelegramUpdate(h.db, stopUpdate(7104), "t")).toBe("stopped");
    expect((await getConsentState(owner, subscriber.id)).telegram?.status).toBe("withdrawn");
    expect(await h.db.collection<SuppressionDoc>(MARKETING_COLLECTIONS.suppressions).countDocuments({ companyId: owner.companyId, channel: "telegram", normalizedDestination: "7104" })).toBe(1);

    await scheduleCampaign(owner, campaign.id, "", campaign.version);
    await run("tg-stop");
    expect(sends().filter((call) => String(call.body.text).includes("new arrivals"))).toHaveLength(0);
    expect(await delivery(campaign.id, subscriber.id)).toMatchObject({ status: "suppressed" });
  });

  it("lets an explicit new consent grant lift the /stop opt-out, and only then", async () => {
    stubTelegram();
    const subscriber = await connectedContact("Returns", 7105);
    await processTelegramUpdate(h.db, stopUpdate(7105), "t");
    const blocked = await approvedTelegramCampaign([subscriber.id]).catch((e: { code: string }) => e);
    expect((blocked as { code: string }).code).toBe("VALIDATION_ERROR");

    await changeConsent(owner, subscriber.id, parsed(consentChangeSchema, { channel: "telegram", status: "granted", source: "manual", occurredAt: "" }));
    expect((await approvedTelegramCampaign([subscriber.id])).snapshot?.eligibleCount).toBe(1);
  });

  it("marks a blocked chat unreachable, does not retry it, and skips it next time", async () => {
    stubTelegram();
    respond = (call) => (call.body.chat_id === "7106" ? json(403, { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }) : json(200, { ok: true, result: { message_id: nextMessageId() } }));
    const blocked = await connectedContact("Blocker", 7106);
    const campaign = await approvedTelegramCampaign([blocked.id]);
    await scheduleCampaign(owner, campaign.id, "", campaign.version);
    calls = [];
    await run("tg-block");
    expect(sends()).toHaveLength(1);
    expect(await delivery(campaign.id, blocked.id)).toMatchObject({ status: "failed", lastErrorCode: "TELEGRAM_BOT_BLOCKED", attemptCount: 1 });
    expect((await getTelegramConnection(owner, blocked.id)).status).toBe("blocked");
    expect((await approvedTelegramCampaign([blocked.id]).catch((e: { code: string }) => e)) as { code: string }).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("waits for Telegram's retry_after on HTTP 429 and then sends exactly once", async () => {
    stubTelegram();
    const subscriber = await connectedContact("Throttled", 7107);
    const campaign = await approvedTelegramCampaign([subscriber.id]);
    await scheduleCampaign(owner, campaign.id, "", campaign.version);
    let first = true;
    respond = () => {
      if (first) {
        first = false;
        return json(429, { ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 120 } });
      }
      return json(200, { ok: true, result: { message_id: nextMessageId() } });
    };
    calls = [];
    const started = Date.now();
    await run("tg-429-a");
    const waiting = await delivery(campaign.id, subscriber.id);
    expect(waiting?.status).toBe("pending");
    expect(waiting?.nextAttemptAt && waiting.nextAttemptAt.getTime() - started).toBeGreaterThanOrEqual(119_000);

    await run("tg-429-b", new Date(Date.now() + 3 * 3_600_000));
    expect(sends()).toHaveLength(2);
    expect(await delivery(campaign.id, subscriber.id)).toMatchObject({ status: "sent", attemptCount: 2 });
  });

  it("never retries an ambiguous result (server error): one attempt, failed, flagged for review", async () => {
    stubTelegram();
    const subscriber = await connectedContact("Ambiguous", 7108);
    const campaign = await approvedTelegramCampaign([subscriber.id]);
    await scheduleCampaign(owner, campaign.id, "", campaign.version);
    respond = () => json(502, { ok: false });
    calls = [];
    await run("tg-502");
    await run("tg-502b", new Date(Date.now() + 3 * 3_600_000));
    expect(sends()).toHaveLength(1);
    expect(await delivery(campaign.id, subscriber.id)).toMatchObject({ status: "failed", lastErrorCode: "AMBIGUOUS_SEND", attemptCount: 1 });
  });

  it("claims a delivery once even when two workers run together", async () => {
    stubTelegram();
    const subscriber = await connectedContact("Race", 7109);
    const campaign = await approvedTelegramCampaign([subscriber.id]);
    await scheduleCampaign(owner, campaign.id, "", campaign.version);
    calls = [];
    await Promise.all([run("race-a"), run("race-b")]);
    expect(sends().filter((call) => call.body.chat_id === "7109")).toHaveLength(1);
  });
});

describe("reports", () => {
  it("reports Telegram acceptance honestly and marks delivery/open/click as unsupported", async () => {
    stubTelegram();
    const subscriber = await connectedContact("Report", 7110);
    const campaign = await approvedTelegramCampaign([subscriber.id]);
    await scheduleCampaign(owner, campaign.id, "", campaign.version);
    await run("tg-report");
    const report = await getCampaignReport(owner, campaign.id);
    expect(report.channel).toBe("telegram");
    expect(report.accepted).toBe(1);
    expect(report.support).toEqual({ delivery: false, bounce: false, opens: false, clicks: false });
    expect(report.rates).toMatchObject({ deliveryRate: null, bounceRate: null, complaintRate: null, openRateEstimate: null, clickRate: null, failureRate: 0 });

    await processTelegramUpdate(h.db, stopUpdate(7110), "t");
    expect((await getCampaignReport(owner, campaign.id)).unsubscribes).toBe(1);

    const dashboard = await getDashboard(owner);
    expect(dashboard.channels.telegram.campaigns).toBeGreaterThan(0);
    expect(dashboard.integrations.telegram).toBe(true);
    expect(dashboard.unsubscribes).toBeGreaterThan(0);
  });
});

describe("notification service", () => {
  it("sends a transactional message to a connected contact without marketing consent, and records it", async () => {
    stubTelegram();
    const created = await connectedContact("Notify", 7201, false);
    const result = await sendTelegramNotification(h.db, { companyId: owner.companyId, contactId: new ObjectId(created.id), message: "Your order is ready", purpose: "transactional", actorUserId: owner.userId, requestId: "n1" });
    expect(result.providerMessageId).toMatch(/^7201:\d+$/);
    expect(sends().at(-1)?.body).toMatchObject({ chat_id: "7201", text: "Your order is ready" });
    const audit = await h.db.collection("audit_events").findOne({ action: "marketing.telegram.notification_sent", entityId: created.id });
    expect(audit).toBeTruthy();
    expect(JSON.stringify(audit)).not.toContain("Your order is ready");
  });

  it("applies the full marketing rules to marketing purposes and rejects oversized or unlinked sends", async () => {
    stubTelegram();
    const noConsent = await connectedContact("NotifyNo", 7202, false);
    calls = [];
    await expectCode(sendTelegramNotification(h.db, { companyId: owner.companyId, contactId: new ObjectId(noConsent.id), message: "Sale", purpose: "marketing", actorUserId: owner.userId, requestId: "n2" }), "FORBIDDEN");
    await expectCode(sendTelegramNotification(h.db, { companyId: owner.companyId, contactId: new ObjectId(noConsent.id), message: "x".repeat(5000), purpose: "transactional", actorUserId: owner.userId, requestId: "n3" }), "VALIDATION_ERROR");
    const unlinked = await contact("NotifyUnlinked");
    await expectCode(sendTelegramNotification(h.db, { companyId: owner.companyId, contactId: new ObjectId(unlinked.id), message: "Hi", purpose: "transactional", actorUserId: owner.userId, requestId: "n4" }), "VALIDATION_ERROR");
    expect(sends().filter((call) => call.body.chat_id === "7202")).toHaveLength(0);
  });
});

describe("consent stays per channel", () => {
  it("does not let email or SMS consent authorise Telegram, or contact-form saves change Telegram consent", async () => {
    stubTelegram();
    const created = await connectedContact("Isolated", 7301, true);
    const state = await h.db.collection<ConsentStateDoc>(MARKETING_COLLECTIONS.consentStates).find({ companyId: owner.companyId, contactId: new ObjectId(created.id) }).toArray();
    expect(state.map((row) => row.channel)).toEqual(["telegram"]);
    const { updateContact } = await import("@/server/marketing/contact.service");
    const { contactUpdateSchema } = await import("@/features/marketing/schemas/marketing.schema");
    await updateContact(owner, created.id, parsed(contactUpdateSchema, { firstName: "Isolated", lastName: "Tester", email: created.email, phone: "", source: "manual", lifecycleStage: "customer", isActive: true, consent: { email: false, sms: false }, expectedVersion: created.version }));
    expect((await getConsentState(owner, created.id)).telegram?.status).toBe("granted");
  });
});
