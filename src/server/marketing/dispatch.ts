import "server-only";
import type { Db } from "mongodb";
import { MARKETING_COLLECTIONS, type CampaignDoc, type ContactDoc, type DeliveryDoc, type JobDoc } from "@/server/marketing/documents";
import { isStillEligible } from "@/server/marketing/eligibility";
import { getAppUrl } from "@/config/env";
import { createUnsubscribeToken } from "@/server/marketing/unsubscribe-token";
import { companyName } from "@/server/marketing/common";
import { isAllowlistedDestination } from "@/server/marketing/config";
import { renderMessage } from "@/server/marketing/message";
import { ProviderError, getConfiguredProviders, type MessageProviders, type MessageProvider } from "@/server/marketing/providers";
import { claimNextJob, finishJob, type JobOutcome } from "@/server/marketing/jobs";
import { retryDelayMs } from "@/features/marketing/utils/retry";
import { normalizeEmailDesign } from "@/features/marketing/utils/email-design";
import { recordAudit } from "@/server/audit/audit.service";
import { AppError } from "@/shared/lib/errors";
import { runSocialPublishJob } from "@/server/marketing/social/post.service";
import { markTelegramUnreachable } from "@/server/marketing/telegram.service";

/** Deliveries handled per run. Worst case (every send times out) must fit inside JOB_LEASE_MS. */
export const DELIVERY_BATCH_SIZE = 20;
export const MAX_DELIVERY_ATTEMPTS = 5;
export const SEND_TIMEOUT_MS = 15_000;
/** A delivery left in "sending" longer than this belonged to a crashed run. It may have been accepted. */
export const STALE_SENDING_MS = 10 * 60_000;

export type RunSummary = { claimed: number; succeeded: number; requeued: number; retried: number; dead: number };

type DispatchContext = { db: Db; providers: MessageProviders; now: Date; sleep: (ms: number) => Promise<void> };

/**
 * Runs due background jobs. Bounded by `limit` so one invocation cannot run unbounded. Each job is
 * claimed under a lease, so two workers never run the same job at the same time.
 */
export async function runDueJobs(
  db: Db,
  options: {
    workerId: string;
    limit?: number;
    now?: Date;
    providers?: MessageProviders;
    sleep?: (ms: number) => Promise<void>;
  }
): Promise<RunSummary> {
  const now = options.now ?? new Date();
  const ctx: DispatchContext = {
    db,
    providers: options.providers ?? getConfiguredProviders(),
    now,
    sleep: options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
  };
  const summary: RunSummary = { claimed: 0, succeeded: 0, requeued: 0, retried: 0, dead: 0 };

  for (let i = 0; i < (options.limit ?? 5); i += 1) {
    const job = await claimNextJob(db, options.workerId, now);
    if (!job) break;
    summary.claimed += 1;

    let outcome: JobOutcome;
    if (job.attempts > job.maxAttempts) {
      outcome = { kind: "dead", errorCode: "MAX_ATTEMPTS" };
    } else {
      try {
        outcome = await runJob(ctx, job);
      } catch (error) {
        outcome = failureOutcome(job, error);
      }
    }
    await finishJob(db, job, options.workerId, outcome, now);
    if (outcome.kind === "dead") {
      await onJobDead(db, job, outcome.errorCode, now);
    }
    if (outcome.kind === "succeeded") summary.succeeded += 1;
    if (outcome.kind === "requeue") summary.requeued += 1;
    if (outcome.kind === "retry") summary.retried += 1;
    if (outcome.kind === "dead") summary.dead += 1;
  }
  return summary;
}

function failureOutcome(job: JobDoc, error: unknown): JobOutcome {
  const code = error instanceof ProviderError || error instanceof AppError ? error.code : "JOB_ERROR";
  const retryable = error instanceof ProviderError ? error.retryable : true;
  if (!retryable || job.attempts >= job.maxAttempts) return { kind: "dead", errorCode: code };
  return { kind: "retry", errorCode: code };
}

async function runJob(ctx: DispatchContext, job: JobDoc): Promise<JobOutcome> {
  switch (job.type) {
    case "campaign.dispatch":
      return dispatchCampaign(ctx, job);
    case "social.publish":
      return runSocialPublishJob(ctx.db, job, ctx.now);
  }
}

/** A campaign whose job is dead is marked failed. Pending deliveries stay pending for an audit trail. */
async function onJobDead(db: Db, job: JobDoc, errorCode: string, now: Date): Promise<void> {
  if (job.type !== "campaign.dispatch") return;
  const campaigns = db.collection<CampaignDoc>(MARKETING_COLLECTIONS.campaigns);
  const campaign = await campaigns.findOne({ _id: job.targetId, companyId: job.companyId }, { projection: { createdBy: 1 } });
  await campaigns.updateOne(
    { _id: job.targetId, companyId: job.companyId, status: { $in: ["scheduled", "processing"] } },
    { $set: { status: "failed", failureCode: errorCode, completedAt: now, updatedAt: now }, $inc: { version: 1 } }
  );
  if (!campaign) return;
  await recordAudit(db, {
    companyId: job.companyId,
    actorUserId: campaign.createdBy,
    action: "marketing.campaign.failed",
    entityType: "marketing_campaign",
    entityId: job.targetId.toHexString(),
    requestId: `job:${job._id.toHexString()}`,
    metadata: { errorCode },
  });
}

/**
 * One run of campaign dispatch. It advances the campaign's deliveries by one bounded batch and then
 * either finishes the campaign or asks for another run. Every decision is re-derived from stored state,
 * so a run that dies halfway resumes safely.
 */
async function dispatchCampaign(ctx: DispatchContext, job: JobDoc): Promise<JobOutcome> {
  const { db, now } = ctx;
  const scope = { companyId: job.companyId };
  const campaigns = db.collection<CampaignDoc>(MARKETING_COLLECTIONS.campaigns);
  const deliveries = db.collection<DeliveryDoc>(MARKETING_COLLECTIONS.deliveries);

  let campaign = await campaigns.findOne({ _id: job.targetId, ...scope });
  if (!campaign || campaign.status === "cancelled" || campaign.status === "completed" || campaign.status === "failed") {
    return { kind: "succeeded" };
  }
  if (campaign.status === "scheduled") {
    // Starting dispatch is a conditional transition, so a concurrent cancellation cannot race it.
    const started = await campaigns.findOneAndUpdate(
      { _id: campaign._id, ...scope, status: "scheduled" },
      { $set: { status: "processing", startedAt: now, updatedAt: now }, $inc: { version: 1 } },
      { returnDocument: "after" }
    );
    if (!started) return { kind: "succeeded" };
    campaign = started;
  }
  if (campaign.status !== "processing") {
    throw new AppError("INVALID_TRANSITION", "The campaign is not in a state that can be dispatched");
  }

  const provider = ctx.providers[campaign.channel];
  if (!provider) {
    throw new ProviderError("PROVIDER_NOT_CONFIGURED", "No delivery provider is configured for this channel", true);
  }

  // A crashed run may have handed the message to SMTP before it died. Re-sending would risk a duplicate,
  // so stale "sending" rows become a terminal AMBIGUOUS_SEND for an operator to reconcile.
  await deliveries.updateMany(
    { ...scope, campaignId: campaign._id, status: "sending", lastAttemptAt: { $lt: new Date(now.getTime() - STALE_SENDING_MS) } },
    {
      $set: {
        status: "failed",
        lastErrorCode: "AMBIGUOUS_SEND",
        failedAt: now,
        nextAttemptAt: null,
        updatedAt: now,
      },
    }
  );

  const due = await deliveries
    .find({
      ...scope,
      campaignId: campaign._id,
      status: "pending",
      $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }],
    })
    .sort({ _id: 1 })
    .limit(DELIVERY_BATCH_SIZE)
    .toArray();

  const company = await companyName(db, job.companyId);
  for (const delivery of due) {
    await sendDelivery(ctx, campaign, delivery, provider, company);
    if (provider.minIntervalMs > 0) await ctx.sleep(provider.minIntervalMs);
  }

  const open = await deliveries.countDocuments({ ...scope, campaignId: campaign._id, status: { $in: ["pending", "sending"] } });
  if (open > 0) {
    if (due.length === DELIVERY_BATCH_SIZE) return { kind: "requeue", runAt: now };
    const next = await deliveries.findOne(
      { ...scope, campaignId: campaign._id, status: "pending" },
      { sort: { nextAttemptAt: 1 }, projection: { nextAttemptAt: 1 } }
    );
    const runAt = next?.nextAttemptAt && next.nextAttemptAt > now ? next.nextAttemptAt : new Date(now.getTime() + 60_000);
    return { kind: "requeue", runAt };
  }

  await campaigns.updateOne(
    { _id: campaign._id, ...scope, status: "processing" },
    { $set: { status: "completed", completedAt: now, updatedAt: now }, $inc: { version: 1 } }
  );
  await recordAudit(db, {
    companyId: job.companyId,
    actorUserId: campaign.createdBy,
    action: "marketing.campaign.completed",
    entityType: "marketing_campaign",
    entityId: campaign._id.toHexString(),
    requestId: `job:${job._id.toHexString()}`,
  });
  return { kind: "succeeded" };
}

/**
 * Decides whether a failed send may be retried.
 * - Before the provider was called: nothing was sent, so a retry is safe only for provider-signalled throttling.
 * - ProviderError.retryable (HTTP 429): the provider did not process the request. Retry.
 * - A definite rejection (bad request, bad key, not allowlisted): the message was not sent. Fail, no retry.
 * - Everything else (timeout, network error, 5xx, unreadable reply): the message may have been accepted.
 *   Fail as AMBIGUOUS_SEND. Retrying could duplicate a message the provider already sent.
 */
const DEFINITE_REJECTIONS = new Set([
  "REQUEST_REJECTED",
  "AUTH_REJECTED",
  "NOT_ALLOWLISTED",
  "INVALID_DESTINATION",
  "CONTENT_INVALID",
  "SMTP_REJECTED",
  "SMTP_AUTH_REJECTED",
  "SMTP_RECIPIENT_REJECTED",
  "TELEGRAM_BOT_BLOCKED",
  "TELEGRAM_CHAT_NOT_FOUND",
]);

/** Codes that mean the chat itself cannot be reached, so the subscription stops being a destination. */
const TELEGRAM_UNREACHABLE = new Set(["TELEGRAM_BOT_BLOCKED", "TELEGRAM_CHAT_NOT_FOUND"]);

export function classifySendFailure(
  error: unknown,
  timedOut: boolean,
  providerCalled: boolean
): { kind: "retry" | "fail"; code: string } {
  if (!providerCalled) {
    return { kind: "fail", code: "CONTENT_INVALID" };
  }
  if (error instanceof ProviderError && error.retryable && !timedOut) {
    return { kind: "retry", code: error.code };
  }
  if (error instanceof ProviderError && DEFINITE_REJECTIONS.has(error.code) && !timedOut) {
    return { kind: "fail", code: error.code };
  }
  return { kind: "fail", code: "AMBIGUOUS_SEND" };
}

/**
 * Sends one delivery. The recipient is checked against the current eligibility rules immediately before
 * the provider call, so a consent withdrawal or suppression after approval still stops the send.
 */
async function sendDelivery(
  ctx: DispatchContext,
  campaign: CampaignDoc,
  delivery: DeliveryDoc,
  provider: MessageProvider,
  company: string
): Promise<void> {
  const { db, now } = ctx;
  const scope = { companyId: campaign.companyId };
  const deliveries = db.collection<DeliveryDoc>(MARKETING_COLLECTIONS.deliveries);

  // Claim the delivery. A duplicate run that lost the race sees zero modified documents and does nothing.
  const claim = await deliveries.updateOne(
    { _id: delivery._id, ...scope, status: "pending" },
    { $set: { status: "sending", lastAttemptAt: now, updatedAt: now }, $inc: { attemptCount: 1 } }
  );
  if (claim.modifiedCount === 0) return;
  const attempt = delivery.attemptCount + 1;

  const contact = await db.collection<ContactDoc>(MARKETING_COLLECTIONS.contacts).findOne({ _id: delivery.contactId, ...scope });
  if (!contact) {
    await deliveries.updateOne({ _id: delivery._id }, { $set: { status: "suppressed", exclusionReason: "contact_missing", updatedAt: now } });
    return;
  }
  const eligibility = await isStillEligible(db, campaign.companyId, campaign.channel, contact);
  if (!eligibility.eligible) {
    await deliveries.updateOne(
      { _id: delivery._id },
      { $set: { status: "suppressed", exclusionReason: eligibility.reason, updatedAt: now } }
    );
    return;
  }

  // One gate for every channel and every provider, before any request is built. The adapters enforce the same list as a
  // second line of defence; this one cannot be bypassed by a provider that forgets to.
  if (!isAllowlistedDestination(campaign.channel, eligibility.destination)) {
    await deliveries.updateOne(
      { _id: delivery._id },
      { $set: { status: "failed", failedAt: new Date(), lastErrorCode: "NOT_ALLOWLISTED", nextAttemptAt: null, updatedAt: new Date() } }
    );
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  let providerCalled = false;
  try {
    // Telegram opts out with /stop in the chat, so it has no link and no signed token.
    const unsubscribeUrl =
      campaign.channel === "telegram"
        ? ""
        : `${getAppUrl()}/unsubscribe?token=${createUnsubscribeToken({
            companyId: campaign.companyId.toHexString(),
            contactId: contact._id.toHexString(),
            channel: campaign.channel,
            campaignId: campaign._id.toHexString(),
          })}`;
    const rendered = renderMessage(
      campaign.channel,
      { subject: campaign.subject, body: campaign.body, design: normalizeEmailDesign(campaign.design) },
      {
        first_name: contact.firstName,
        last_name: contact.lastName,
        email: contact.normalizedEmail ?? "",
        company_name: company,
        unsubscribe_url: unsubscribeUrl,
      }
    );
    providerCalled = true;
    const result = await provider.send(
      { idempotencyKey: delivery._id.toHexString(), to: eligibility.destination, subject: rendered.subject, text: rendered.text, html: rendered.html },
      { signal: controller.signal }
    );
    await deliveries.updateOne(
      { _id: delivery._id },
      {
        $set: {
          status: "sent",
          providerMessageId: result.providerMessageId,
          sentAt: new Date(),
          nextAttemptAt: null,
          lastErrorCode: null,
          updatedAt: new Date(),
        },
      }
    );
  } catch (error) {
    const now = new Date();
    const failure = classifySendFailure(error, controller.signal.aborted, providerCalled);
    if (failure.kind === "retry" && attempt < MAX_DELIVERY_ATTEMPTS) {
      // The provider certainly did not process this request, so a later attempt cannot duplicate a message.
      await deliveries.updateOne(
        { _id: delivery._id },
        {
          $set: {
            status: "pending",
            // Never sooner than the provider asked for (Telegram's retry_after).
            nextAttemptAt: new Date(Date.now() + Math.max(retryDelayMs(attempt), error instanceof ProviderError ? error.retryAfterMs ?? 0 : 0)),
            lastErrorCode: failure.code,
            updatedAt: now,
          },
        }
      );
    } else {
      // Terminal. For AMBIGUOUS_SEND the provider may have accepted the message, so it is never retried
      // automatically. An operator must check the provider's records before anything else happens.
      await deliveries.updateOne(
        { _id: delivery._id },
        { $set: { status: "failed", failedAt: now, lastErrorCode: failure.code, nextAttemptAt: null, updatedAt: now } }
      );
      if (campaign.channel === "telegram" && TELEGRAM_UNREACHABLE.has(failure.code)) {
        await markTelegramUnreachable(db, campaign.companyId, contact._id, failure.code, `delivery:${delivery._id.toHexString()}`);
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

