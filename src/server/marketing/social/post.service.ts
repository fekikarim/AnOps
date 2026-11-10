import "server-only";
import { ObjectId, type Db, type Filter } from "mongodb";
import { MARKETING_COLLECTIONS, type JobDoc, type SocialAccountDoc, type SocialPostDoc } from "@/server/marketing/documents";
import type { SocialPostStatus } from "@/features/marketing/types/constants";
import { recordAudit } from "@/server/audit/audit.service";
import { withTransaction } from "@/server/db/transactions";
import type { WorkspaceContext } from "@/server/tenancy/workspace";
import { AppError } from "@/shared/lib/errors";
import type { SocialPostInput } from "@/features/marketing/schemas/marketing.schema";
import { canTransitionSocialPost, SOCIAL_POST_STATUS_LABELS } from "@/features/marketing/utils/social-state";
import { MARKETING_PAGE_SIZE, pageMeta, requireMarketing, scopeOf, skipOf, toIso, toObjectId } from "@/server/marketing/common";
import { PERMISSIONS, type Permission } from "@/server/security/permissions";
import { enqueueJob } from "@/server/marketing/jobs";
import { decryptToken, TokenCryptoError } from "@/server/marketing/crypto";
import { getSocialConfig } from "@/server/marketing/config";
import { publishPagePost, MetaApiError } from "@/server/marketing/social/meta";
import { resolveScheduledAt } from "@/server/marketing/campaign.service";
import type { JobOutcome } from "@/server/marketing/jobs";
import type { Paged } from "@/features/inventory/types";

export type SocialPostDto = {
  id: string;
  socialAccountId: string;
  accountName: string;
  platform: "facebook_page";
  content: string;
  status: SocialPostStatus;
  statusLabel: string;
  scheduledAt: string | null;
  publishedAt: string | null;
  /** Present only after the provider confirmed publication. */
  externalPostId: string | null;
  lastErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  actions: { canEdit: boolean; canSchedule: boolean; canCancel: boolean; canDelete: boolean };
};

function actionsFor(doc: SocialPostDoc, permissions: ReadonlySet<Permission>) {
  const manage = permissions.has(PERMISSIONS.MARKETING_SOCIAL_MANAGE);
  const publish = permissions.has(PERMISSIONS.MARKETING_SOCIAL_PUBLISH);
  return {
    canEdit: manage && doc.status === "draft",
    canSchedule: publish && (doc.status === "draft" || doc.status === "failed"),
    canCancel: publish && doc.status === "scheduled",
    canDelete: manage && (doc.status === "draft" || doc.status === "cancelled"),
  };
}

function toPostDto(doc: SocialPostDoc, permissions: ReadonlySet<Permission>): SocialPostDto {
  return {
    id: doc._id.toHexString(),
    socialAccountId: doc.socialAccountId.toHexString(),
    accountName: doc.accountName,
    platform: doc.platform,
    content: doc.content,
    status: doc.status,
    statusLabel: SOCIAL_POST_STATUS_LABELS[doc.status],
    scheduledAt: toIso(doc.scheduledAt),
    publishedAt: toIso(doc.publishedAt),
    externalPostId: doc.status === "published" ? doc.externalPostId : null,
    lastErrorCode: doc.lastErrorCode,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    version: doc.version,
    actions: actionsFor(doc, permissions),
  };
}

async function loadPost(db: Db, companyId: ObjectId, id: ObjectId): Promise<SocialPostDoc> {
  const doc = await db.collection<SocialPostDoc>(MARKETING_COLLECTIONS.socialPosts).findOne({ _id: id, companyId });
  if (!doc) throw new AppError("NOT_FOUND", "Post not found");
  return doc;
}

/** The account must belong to this company and be connected. Anything else is rejected before a row is written. */
async function connectedAccount(db: Db, companyId: ObjectId, id: ObjectId): Promise<SocialAccountDoc> {
  const account = await db.collection<SocialAccountDoc>(MARKETING_COLLECTIONS.socialAccounts).findOne({ _id: id, companyId });
  if (!account) throw new AppError("VALIDATION_ERROR", "Choose an account connected to this company", { socialAccountId: "Choose a connected account" });
  if (account.connectionStatus !== "connected") {
    throw new AppError("VALIDATION_ERROR", "This account is not connected. Reconnect it before posting.", { socialAccountId: "Account is not connected" });
  }
  return account;
}

export async function listSocialPosts(ctx: WorkspaceContext, query: { status: "all" | SocialPostStatus; page: number }): Promise<Paged<SocialPostDto>> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_READ);
  const filter: Filter<SocialPostDoc> = { ...scopeOf(ctx) };
  if (query.status !== "all") filter.status = query.status;
  const collection = ctx.db.collection<SocialPostDoc>(MARKETING_COLLECTIONS.socialPosts);
  const [total, docs] = await Promise.all([
    collection.countDocuments(filter),
    collection
      .find(filter)
      .sort({ scheduledAt: 1, createdAt: -1 })
      .skip(skipOf(query.page))
      .limit(MARKETING_PAGE_SIZE)
      .toArray(),
  ]);
  return { items: docs.map((doc) => toPostDto(doc, ctx.permissions)), ...pageMeta(query.page, total) };
}

export async function getSocialPost(ctx: WorkspaceContext, idRaw: string): Promise<SocialPostDto> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_READ);
  return toPostDto(await loadPost(ctx.db, ctx.companyId, toObjectId(idRaw)), ctx.permissions);
}

export async function createSocialPost(ctx: WorkspaceContext, input: SocialPostInput): Promise<SocialPostDto> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_SOCIAL_MANAGE);
  const account = await connectedAccount(ctx.db, ctx.companyId, toObjectId(input.socialAccountId));
  const now = new Date();
  const doc: SocialPostDoc = {
    _id: new ObjectId(),
    companyId: ctx.companyId,
    socialAccountId: account._id,
    platform: account.platform,
    accountName: account.displayName,
    content: input.content,
    status: "draft",
    scheduledAt: null,
    publishedAt: null,
    externalPostId: null,
    attemptCount: 0,
    lastErrorCode: null,
    createdBy: ctx.userId,
    updatedBy: ctx.userId,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
  await ctx.db.collection<SocialPostDoc>(MARKETING_COLLECTIONS.socialPosts).insertOne(doc);
  return toPostDto(doc, ctx.permissions);
}

export async function updateSocialPost(ctx: WorkspaceContext, idRaw: string, input: SocialPostInput & { expectedVersion: number }): Promise<SocialPostDto> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_SOCIAL_MANAGE);
  const postId = toObjectId(idRaw);
  const existing = await loadPost(ctx.db, ctx.companyId, postId);
  if (existing.status !== "draft") throw new AppError("INVALID_TRANSITION", "Only drafts can be edited. Cancel the scheduled post first.");
  const account = await connectedAccount(ctx.db, ctx.companyId, toObjectId(input.socialAccountId));
  const result = await ctx.db.collection<SocialPostDoc>(MARKETING_COLLECTIONS.socialPosts).findOneAndUpdate(
    { _id: postId, companyId: ctx.companyId, status: "draft", version: input.expectedVersion },
    {
      $set: {
        socialAccountId: account._id,
        platform: account.platform,
        accountName: account.displayName,
        content: input.content,
        updatedBy: ctx.userId,
        updatedAt: new Date(),
      },
      $inc: { version: 1 },
    },
    { returnDocument: "after" }
  );
  if (!result) throw new AppError("CONFLICT", "This post changed. Reload and try again.");
  return toPostDto(result, ctx.permissions);
}

export async function deleteSocialPost(ctx: WorkspaceContext, idRaw: string): Promise<void> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_SOCIAL_MANAGE);
  const result = await ctx.db
    .collection<SocialPostDoc>(MARKETING_COLLECTIONS.socialPosts)
    .deleteOne({ _id: toObjectId(idRaw), companyId: ctx.companyId, status: { $in: ["draft", "cancelled"] } });
  if (result.deletedCount === 0) {
    throw new AppError("INVALID_TRANSITION", "Only drafts or cancelled posts can be deleted. Published posts stay on the platform and are kept here.");
  }
}

/**
 * Schedules a post for publication, or queues it immediately when `scheduledAt` is empty. The publish job
 * is written in the same transaction. Its key includes the post version, so rescheduling after a failure
 * creates a new job instead of colliding with the old one.
 */
export async function scheduleSocialPost(ctx: WorkspaceContext, idRaw: string, scheduledAtRaw: string, expectedVersion: number): Promise<SocialPostDto> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_SOCIAL_PUBLISH);
  const postId = toObjectId(idRaw);
  const post = await loadPost(ctx.db, ctx.companyId, postId);
  if (!canTransitionSocialPost(post.status, "scheduled")) {
    throw new AppError("INVALID_TRANSITION", "This post cannot be scheduled from its current state.");
  }
  await connectedAccount(ctx.db, ctx.companyId, post.socialAccountId);
  if (!getSocialConfig().configured) {
    throw new AppError("PROVIDER_NOT_CONFIGURED", "Facebook publishing is not configured on this server. Connect the integration first.");
  }
  const now = new Date();
  const runAt = resolveScheduledAt(scheduledAtRaw, now);
  const nextVersion = expectedVersion + 1;

  const updated = await withTransaction(ctx.db, async (tx) => {
    const result = await ctx.db.collection<SocialPostDoc>(MARKETING_COLLECTIONS.socialPosts).findOneAndUpdate(
      { _id: postId, companyId: ctx.companyId, status: { $in: ["draft", "failed"] }, version: expectedVersion },
      { $set: { status: "scheduled", scheduledAt: runAt, lastErrorCode: null, updatedBy: ctx.userId, updatedAt: now }, $inc: { version: 1 } },
      { returnDocument: "after", session: tx.session }
    );
    if (!result) throw new AppError("CONFLICT", "This post changed. Reload and try again.");
    await enqueueJob(
      ctx.db,
      { companyId: ctx.companyId, type: "social.publish", targetId: postId, key: `social.publish:${idRaw}:v${nextVersion}`, runAt },
      tx.session
    );
    await recordAudit(
      ctx.db,
      {
        companyId: ctx.companyId,
        actorUserId: ctx.userId,
        action: "marketing.social.scheduled",
        entityType: "marketing_social_post",
        entityId: idRaw,
        requestId: ctx.requestId,
        metadata: { sendNow: scheduledAtRaw === "" },
      },
      tx
    );
    return result;
  });
  return toPostDto(updated, ctx.permissions);
}

export async function cancelSocialPost(ctx: WorkspaceContext, idRaw: string, expectedVersion: number): Promise<void> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_SOCIAL_PUBLISH);
  const postId = toObjectId(idRaw);
  await withTransaction(ctx.db, async (tx) => {
    const result = await ctx.db.collection<SocialPostDoc>(MARKETING_COLLECTIONS.socialPosts).updateOne(
      { _id: postId, companyId: ctx.companyId, status: "scheduled", version: expectedVersion },
      { $set: { status: "cancelled", updatedBy: ctx.userId, updatedAt: new Date() }, $inc: { version: 1 } },
      { session: tx.session }
    );
    if (result.matchedCount === 0) {
      throw new AppError("INVALID_TRANSITION", "Only scheduled posts can be cancelled. Publishing may have started.");
    }
    await ctx.db.collection<JobDoc>(MARKETING_COLLECTIONS.jobs).updateMany(
      { companyId: ctx.companyId, type: "social.publish", targetId: postId, status: "queued" },
      { $set: { status: "cancelled", updatedAt: new Date() } },
      { session: tx.session }
    );
    await recordAudit(
      ctx.db,
      {
        companyId: ctx.companyId,
        actorUserId: ctx.userId,
        action: "marketing.social.cancelled",
        entityType: "marketing_social_post",
        entityId: idRaw,
        requestId: ctx.requestId,
      },
      tx
    );
  });
}

/** Provider call used by the publish job. Injected in tests so no real provider is contacted. */
export type SocialPublisher = (input: { pageId: string; token: string; content: string }) => Promise<{ externalPostId: string }>;

/**
 * One publish attempt, run by the worker.
 *
 * - The post moves scheduled → publishing before the provider is called. A concurrent cancel cannot
 *   interleave with that move.
 * - Provider rejected (4xx) or token unreadable: the post fails and is not retried.
 * - Rate limited (429): the provider did not process the request, so the job retries safely.
 * - Timeout, network error or 5xx: the provider may already have published. The post becomes
 *   `needs_reconciliation` and is never retried automatically, which prevents duplicates.
 * - Only a provider-confirmed id is stored as `externalPostId`.
 */
export async function runSocialPublishJob(
  db: Db,
  job: JobDoc,
  now: Date,
  publish?: SocialPublisher
): Promise<JobOutcome> {
  const scope = { companyId: job.companyId };
  const posts = db.collection<SocialPostDoc>(MARKETING_COLLECTIONS.socialPosts);
  const post = await posts.findOne({ _id: job.targetId, ...scope });
  if (!post || post.status !== "scheduled") return { kind: "succeeded" };

  const account = await db.collection<SocialAccountDoc>(MARKETING_COLLECTIONS.socialAccounts).findOne({ _id: post.socialAccountId, ...scope });
  const config = getSocialConfig();
  const fail = async (code: string, outcomeCode = code): Promise<JobOutcome> => {
    await posts.updateOne({ _id: post._id, ...scope, status: "publishing" }, { $set: { status: "failed", lastErrorCode: code, updatedAt: now }, $inc: { version: 1 } });
    return { kind: "dead", errorCode: outcomeCode };
  };

  if (!account || account.connectionStatus !== "connected") {
    await posts.updateOne({ _id: post._id, ...scope, status: "scheduled" }, { $set: { status: "failed", lastErrorCode: "ACCOUNT_DISCONNECTED", updatedAt: now }, $inc: { version: 1 } });
    return { kind: "dead", errorCode: "ACCOUNT_DISCONNECTED" };
  }
  if (!publish && !config.configured) {
    await posts.updateOne({ _id: post._id, ...scope, status: "scheduled" }, { $set: { status: "failed", lastErrorCode: "PROVIDER_NOT_CONFIGURED", updatedAt: now }, $inc: { version: 1 } });
    return { kind: "dead", errorCode: "PROVIDER_NOT_CONFIGURED" };
  }

  const claimed = await posts.findOneAndUpdate(
    { _id: post._id, ...scope, status: "scheduled" },
    { $set: { status: "publishing", updatedAt: now }, $inc: { attemptCount: 1, version: 1 } },
    { returnDocument: "after" }
  );
  if (!claimed) return { kind: "succeeded" };

  let token: string;
  try {
    token = decryptToken(account.encryptedToken ?? "", config.encryptionKey ?? Buffer.alloc(0));
  } catch (error) {
    if (error instanceof TokenCryptoError) {
      await db.collection<SocialAccountDoc>(MARKETING_COLLECTIONS.socialAccounts).updateOne(
        { _id: account._id, ...scope },
        { $set: { connectionStatus: "reauthorization_required", lastErrorCode: "TOKEN_UNREADABLE", updatedAt: now }, $inc: { version: 1 } }
      );
      return fail("TOKEN_UNREADABLE");
    }
    throw error;
  }

  try {
    const sender = publish ?? ((input) => publishPagePost(input.pageId, input.token, input.content));
    const result = await sender({ pageId: account.externalAccountId, token, content: claimed.content });
    await posts.updateOne(
      { _id: post._id, ...scope, status: "publishing" },
      { $set: { status: "published", publishedAt: now, externalPostId: result.externalPostId, lastErrorCode: null, updatedAt: now }, $inc: { version: 1 } }
    );
    await recordAudit(db, {
      companyId: job.companyId,
      actorUserId: claimed.updatedBy,
      action: "marketing.social.published",
      entityType: "marketing_social_post",
      entityId: post._id.toHexString(),
      requestId: `job:${job._id.toHexString()}`,
    });
    return { kind: "succeeded" };
  } catch (error) {
    if (error instanceof MetaApiError) {
      if (error.notProcessed && error.code === "RATE_LIMITED") {
        await posts.updateOne({ _id: post._id, ...scope, status: "publishing" }, { $set: { status: "scheduled", lastErrorCode: error.code, updatedAt: now }, $inc: { version: 1 } });
        return { kind: "retry", errorCode: error.code };
      }
      if (error.notProcessed) {
        if (error.reauthorize) {
          await db.collection<SocialAccountDoc>(MARKETING_COLLECTIONS.socialAccounts).updateOne(
            { _id: account._id, ...scope },
            { $set: { connectionStatus: "reauthorization_required", lastErrorCode: error.code, updatedAt: now }, $inc: { version: 1 } }
          );
        }
        return fail(error.code);
      }
      // Ambiguous: the provider may have accepted the post. Do not retry automatically.
      await posts.updateOne(
        { _id: post._id, ...scope, status: "publishing" },
        { $set: { status: "needs_reconciliation", lastErrorCode: error.code, updatedAt: now }, $inc: { version: 1 } }
      );
      return { kind: "succeeded" };
    }
    await posts.updateOne(
      { _id: post._id, ...scope, status: "publishing" },
      { $set: { status: "needs_reconciliation", lastErrorCode: "AMBIGUOUS_RESULT", updatedAt: now }, $inc: { version: 1 } }
    );
    return { kind: "succeeded" };
  }
}

