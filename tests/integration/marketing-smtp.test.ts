import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createHarness, parsed, type TestHarness } from "../helpers/workspace";
import {
  MARKETING_COLLECTIONS,
  type CampaignDoc,
  type DeliveryDoc,
  type SuppressionDoc,
} from "@/server/marketing/documents";
import {
  audienceInputSchema,
  campaignInputSchema,
  consentChangeSchema,
  contactCreateSchema,
  tagInputSchema,
} from "@/features/marketing/schemas/marketing.schema";
import { createContact } from "@/server/marketing/contact.service";
import { assignTags, createTag } from "@/server/marketing/tag.service";
import { changeConsent } from "@/server/marketing/consent.service";
import { createAudience } from "@/server/marketing/audience.service";
import {
  approveCampaign,
  createCampaign,
  getCampaign,
  scheduleCampaign,
  submitCampaign,
} from "@/server/marketing/campaign.service";
import { enqueueJob } from "@/server/marketing/jobs";
import { runDueJobs } from "@/server/marketing/dispatch";
import { ProviderError, type MessageProvider } from "@/server/marketing/providers";
import { createSmtpEmailProvider } from "@/server/marketing/providers/smtp/adapters";
import type { SmtpConfig } from "@/server/marketing/providers/smtp/config";
import type { WorkspaceContext } from "@/server/tenancy/workspace";

let h: TestHarness;
let owner: WorkspaceContext;
let approver: WorkspaceContext;
let operator: WorkspaceContext;
let other: WorkspaceContext;

const smtpConfig: SmtpConfig = {
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  user: "campaigns@example.test",
  password: "app-password",
  from: "Northwind <campaigns@example.test>",
  fromAddress: "campaigns@example.test",
  sendAllowlist: null,
};

let sequence = 0;
const unique = (label: string) => `${label}-${++sequence}@example.test`;

function provider(
  send: (message: { to: string; idempotencyKey: string; subject: string; text: string }) => Promise<{ providerMessageId: string }>
): MessageProvider {
  return createSmtpEmailProvider(smtpConfig, {
    send: async (input) => {
      const result = await send({
        to: input.to,
        idempotencyKey: input.messageId ?? "",
        subject: input.subject,
        text: input.text,
      });
      return {
        messageId: result.providerMessageId,
        response: "250 OK",
        accepted: [input.to],
      };
    },
  });
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
}

async function approvedCampaign(emails: string[]): Promise<{ id: string; version: number; contactIds: string[] }> {
  const tag = await createTag(owner, parsed(tagInputSchema, { name: `Tag ${sequence}-${Date.now()}`, color: "#1f7a5c" }));
  const contactIds: string[] = [];
  for (const email of emails) {
    const contact = await createContact(
      owner,
      parsed(contactCreateSchema, {
        firstName: "Recipient",
        lastName: String(contactIds.length),
        email,
        phone: "",
        source: "manual",
        lifecycleStage: "lead",
        isActive: true,
        consent: { email: true, sms: false },
      })
    );
    contactIds.push(contact.id);
    await assignTags(owner, [contact.id], tag.id);
  }

  const audience = await createAudience(
    owner,
    parsed(audienceInputSchema, {
      name: `Audience ${sequence}-${Date.now()}`,
      description: "",
      isActive: true,
      rule: { match: "all", conditions: [{ type: "tags", tagIds: [tag.id], match: "any" }] },
    })
  );
  const created = await createCampaign(
    owner,
    parsed(campaignInputSchema, {
      name: `Campaign ${sequence}-${Date.now()}`,
      channel: "email",
      audienceId: audience.id,
      templateId: null,
      subject: "Hello {{first_name}}",
      body: "Message for {{first_name}}",
    })
  );
  await submitCampaign(owner, created.id, created.version);
  const approved = await approveCampaign(approver, created.id, created.version + 1);
  return { id: approved.id, version: approved.version, contactIds };
}

async function scheduleForDispatch(id: string): Promise<void> {
  await h.db
    .collection<CampaignDoc>(MARKETING_COLLECTIONS.campaigns)
    .updateOne({ _id: new ObjectId(id) }, { $set: { status: "scheduled", scheduledAt: new Date() } });
  await enqueueJob(h.db, {
    companyId: owner.companyId,
    type: "campaign.dispatch",
    targetId: new ObjectId(id),
    key: `campaign.dispatch:${id}`,
    runAt: new Date(),
  });
}

async function deliveryFor(campaignId: string, contactId: string): Promise<DeliveryDoc | null> {
  return h.db.collection<DeliveryDoc>(MARKETING_COLLECTIONS.deliveries).findOne({
    companyId: owner.companyId,
    campaignId: new ObjectId(campaignId),
    contactId: new ObjectId(contactId),
  });
}

beforeAll(async () => {
  // These tests drive the real dispatch engine with fake providers and no recipient allowlist. Outside production the central
  // policy refuses every destination (see marketing-allowlist.test.ts), so they run as a production deployment.
  vi.stubEnv("NODE_ENV", "production");
  h = await createHarness();
  owner = h.ctx("owner");
  approver = { ...h.ctx("owner"), userId: new ObjectId() };
  operator = { ...h.ctx("operator"), userId: new ObjectId() };
  other = h.otherTenant("owner");
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await h.cleanup();
});

describe("campaign authorization", () => {
  it("refuses scheduling by a role without dispatch permission", async () => {
    const campaign = await approvedCampaign([unique("authz")]);
    await expectCode(scheduleCampaign(operator, campaign.id, "", campaign.version), "FORBIDDEN");
  });

  it("refuses an approved campaign when no usable email provider is configured", async () => {
    const campaign = await approvedCampaign([unique("no-provider")]);
    // The test environment has no EMAIL_SERVER_HOST / EMAIL_FROM, so scheduling must be refused.
    await expectCode(scheduleCampaign(owner, campaign.id, "", campaign.version), "PROVIDER_NOT_CONFIGURED");
    const stillApproved = await getCampaign(owner, campaign.id);
    expect(stillApproved.status).toBe("approved");
  });

  it("keeps drafts editable while sending is unavailable", async () => {
    const audience = await createAudience(
      owner,
      parsed(audienceInputSchema, {
        name: `Draft audience ${sequence}-${Date.now()}`,
        description: "",
        isActive: true,
        rule: { match: "all", conditions: [{ type: "active", value: true }] },
      })
    );
    const draft = await createCampaign(
      owner,
      parsed(campaignInputSchema, {
        name: `Draft ${sequence}-${Date.now()}`,
        channel: "email",
        audienceId: audience.id,
        templateId: null,
        subject: "Draft subject",
        body: "Draft body",
      })
    );
    expect(draft.status).toBe("draft");
    const detail = await getCampaign(owner, draft.id);
    expect(detail.actions.canEdit).toBe(true);
  });

  it("never reads or dispatches another company's campaign", async () => {
    const campaign = await approvedCampaign([unique("cross-company")]);
    await expectCode(getCampaign(other, campaign.id), "NOT_FOUND");
    await expectCode(scheduleCampaign(other, campaign.id, "", campaign.version), "NOT_FOUND");

    // A job written under the wrong company must not send the campaign.
    await enqueueJob(h.db, {
      companyId: other.companyId,
      type: "campaign.dispatch",
      targetId: new ObjectId(campaign.id),
      key: `campaign.dispatch:${campaign.id}`,
      runAt: new Date(),
    });
    let sent = 0;
    await runDueJobs(h.db, {
      workerId: "cross-company",
      providers: { email: provider(async () => { sent += 1; return { providerMessageId: `x-${sent}` }; }) },
      sleep: async () => undefined,
    });
    expect(sent).toBe(0);
    expect((await getCampaign(owner, campaign.id)).status).toBe("approved");
  });
});

describe("dispatch safety", () => {
  it("rechecks consent and suppression immediately before sending", async () => {
    const [withdrawn, suppressed, kept] = [unique("withdrawn"), unique("suppressed"), unique("kept")];
    const campaign = await approvedCampaign([withdrawn, suppressed, kept]);

    await changeConsent(
      owner,
      campaign.contactIds[0],
      parsed(consentChangeSchema, { channel: "email", status: "withdrawn", source: "manual", occurredAt: "" })
    );
    const suppression: SuppressionDoc = {
      _id: new ObjectId(),
      companyId: owner.companyId,
      channel: "email",
      normalizedDestination: suppressed,
      reason: "manual",
      contactId: new ObjectId(campaign.contactIds[1]),
      createdAt: new Date(),
    };
    await h.db.collection<SuppressionDoc>(MARKETING_COLLECTIONS.suppressions).insertOne(suppression);

    const sent: string[] = [];
    await scheduleForDispatch(campaign.id);
    await runDueJobs(h.db, {
      workerId: "consent-worker",
      providers: { email: provider(async (message) => { sent.push(message.to); return { providerMessageId: `msg-${message.idempotencyKey}` }; }) },
      sleep: async () => undefined,
    });

    expect(sent).toEqual([kept]);
    expect((await deliveryFor(campaign.id, campaign.contactIds[0]))?.status).toBe("suppressed");
    expect((await deliveryFor(campaign.id, campaign.contactIds[1]))?.status).toBe("suppressed");
    expect((await deliveryFor(campaign.id, campaign.contactIds[2]))?.status).toBe("sent");
    expect((await getCampaign(owner, campaign.id)).status).toBe("completed");
  });

  it("retries only when SMTP did not accept the message, and never sends a duplicate", async () => {
    const email = unique("retry");
    const campaign = await approvedCampaign([email]);
    const sent: string[] = [];
    let attempts = 0;
    const flaky = provider(async (message) => {
      attempts += 1;
      if (attempts === 1) throw new ProviderError("SMTP_TEMPORARY_FAILURE", "try later", true);
      sent.push(message.to);
      return { providerMessageId: `msg-${message.idempotencyKey}` };
    });

    await scheduleForDispatch(campaign.id);
    const first = await runDueJobs(h.db, { workerId: "retry-1", providers: { email: flaky }, sleep: async () => undefined });
    expect(first.claimed).toBe(1);
    expect((await deliveryFor(campaign.id, campaign.contactIds[0]))?.status).toBe("pending");

    // The job was requeued with a backoff. Run it after the backoff has elapsed.
    await runDueJobs(h.db, {
      workerId: "retry-2",
      providers: { email: flaky },
      sleep: async () => undefined,
      now: new Date(Date.now() + 60 * 60_000),
    });
    expect(sent).toEqual([email]);
    const delivery = await deliveryFor(campaign.id, campaign.contactIds[0]);
    expect(delivery?.status).toBe("sent");
    expect(delivery?.attemptCount).toBe(2);
    expect(delivery?.providerMessageId).toBeTruthy();

    // Nothing is pending, so a further run cannot send again.
    await runDueJobs(h.db, {
      workerId: "retry-3",
      providers: { email: flaky },
      sleep: async () => undefined,
      now: new Date(Date.now() + 2 * 60 * 60_000),
    });
    expect(sent).toEqual([email]);
    expect((await getCampaign(owner, campaign.id)).status).toBe("completed");
  });

  it("completes a campaign with partial failures without inventing delivery", async () => {
    const [goodA, bad, goodB] = [unique("good-a"), unique("bad"), unique("good-b")];
    const campaign = await approvedCampaign([goodA, bad, goodB]);
    const accepted: string[] = [];

    await scheduleForDispatch(campaign.id);
    await runDueJobs(h.db, {
      workerId: "partial",
      providers: {
        email: provider(async (message) => {
          if (message.to === bad) throw new ProviderError("SMTP_REJECTED", "recipient rejected", false);
          accepted.push(message.to);
          return { providerMessageId: `msg-${message.idempotencyKey}` };
        }),
      },
      sleep: async () => undefined,
    });

    const detail = await getCampaign(owner, campaign.id);
    expect(detail.status).toBe("completed");
    expect(detail.deliverySummary.sent).toBe(2);
    expect(detail.deliverySummary.failed).toBe(1);
    expect(detail.deliverySummary.delivered).toBe(0);

    const failed = await deliveryFor(campaign.id, campaign.contactIds[1]);
    expect(failed?.status).toBe("failed");
    expect(failed?.lastErrorCode).toBe("SMTP_REJECTED");
    // SMTP acceptance is "sent", not "delivered"; only a provider event may claim delivery.
    expect((await deliveryFor(campaign.id, campaign.contactIds[0]))?.status).toBe("sent");
    expect((await deliveryFor(campaign.id, campaign.contactIds[0]))?.deliveredAt).toBeNull();
  });

  it("never re-sends a delivery left in sending by a crashed run", async () => {
    const email = unique("stale");
    const campaign = await approvedCampaign([email]);
    await h.db.collection<DeliveryDoc>(MARKETING_COLLECTIONS.deliveries).updateOne(
      { companyId: owner.companyId, campaignId: new ObjectId(campaign.id), contactId: new ObjectId(campaign.contactIds[0]) },
      { $set: { status: "sending", lastAttemptAt: new Date(Date.now() - 11 * 60_000) } }
    );

    const sent: string[] = [];
    await scheduleForDispatch(campaign.id);
    await runDueJobs(h.db, {
      workerId: "stale",
      providers: { email: provider(async (message) => { sent.push(message.to); return { providerMessageId: `msg-${message.idempotencyKey}` }; }) },
      sleep: async () => undefined,
    });

    expect(sent).toEqual([]);
    const delivery = await deliveryFor(campaign.id, campaign.contactIds[0]);
    expect(delivery?.status).toBe("failed");
    expect(delivery?.lastErrorCode).toBe("AMBIGUOUS_SEND");
    expect((await getCampaign(owner, campaign.id)).status).toBe("completed");
  });

  it("uses an idempotent job key per campaign", async () => {
    const campaign = await approvedCampaign([unique("idempotent")]);
    await scheduleForDispatch(campaign.id);
    const duplicate = await enqueueJob(h.db, {
      companyId: owner.companyId,
      type: "campaign.dispatch",
      targetId: new ObjectId(campaign.id),
      key: `campaign.dispatch:${campaign.id}`,
      runAt: new Date(),
    });
    expect(duplicate).toBe(false);
  });
});
