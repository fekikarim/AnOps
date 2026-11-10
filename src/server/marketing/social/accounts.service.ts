import "server-only";
import { ObjectId, type Db } from "mongodb";
import { MARKETING_COLLECTIONS, type SocialAccountDoc, type SocialConnectionStatus, type SocialOauthStateDoc, type SocialPostDoc } from "@/server/marketing/documents";
import type { SocialPlatform } from "@/features/marketing/types/constants";
import { recordAudit } from "@/server/audit/audit.service";
import { withTransaction } from "@/server/db/transactions";
import type { WorkspaceContext } from "@/server/tenancy/workspace";
import { AppError } from "@/shared/lib/errors";
import { getAppUrl } from "@/config/env";
import { COLLECTIONS } from "@/server/db/documents";
import { getSocialConfig, type IntegrationState } from "@/server/marketing/config";
import { requireMarketing, scopeOf, toObjectId, toIso, pageMeta, MARKETING_PAGE_SIZE, skipOf } from "@/server/marketing/common";
import { PERMISSIONS } from "@/server/security/permissions";
import { encryptToken, decryptToken, TokenCryptoError } from "@/server/marketing/crypto";
import { buildAuthorizationUrl, exchangeCodeForToken, exchangeForLongLivedToken, generateOauthState, hashOauthState, listManagedPages, MetaApiError } from "@/server/marketing/social/meta";
import type { Paged } from "@/features/inventory/types";

export const OAUTH_STATE_TTL_MS = 10 * 60_000;
export const SOCIAL_CALLBACK_PATH = "/api/v1/marketing/social/callback";

export type SocialAccountDto = {
  id: string;
  platform: SocialPlatform;
  platformLabel: string;
  externalAccountId: string;
  displayName: string;
  connectionStatus: SocialConnectionStatus;
  grantedScopes: string[];
  connectedAt: string;
  disconnectedAt: string | null;
  lastErrorCode: string | null;
  version: number;
};

export type SocialIntegrationDto = { configured: boolean; reason: string | null; missing: string[] };

/** Reports configuration state without exposing any value. Only variable names are returned. */
export function socialIntegrationStatus(): SocialIntegrationDto {
  const config: IntegrationState & { missing?: string[] } = getSocialConfig();
  return config.configured
    ? { configured: true, reason: null, missing: [] }
    : { configured: false, reason: config.reason, missing: config.missing };
}

const PLATFORM_LABEL: Record<SocialPlatform, string> = { facebook_page: "Facebook Page" };

function toAccountDto(doc: SocialAccountDoc): SocialAccountDto {
  return {
    id: doc._id.toHexString(),
    platform: doc.platform,
    platformLabel: PLATFORM_LABEL[doc.platform],
    externalAccountId: doc.externalAccountId,
    displayName: doc.displayName,
    connectionStatus: doc.connectionStatus,
    grantedScopes: doc.grantedScopes,
    connectedAt: doc.connectedAt.toISOString(),
    disconnectedAt: toIso(doc.disconnectedAt),
    lastErrorCode: doc.lastErrorCode,
    version: doc.version,
  };
}

export async function listSocialAccounts(ctx: WorkspaceContext, page = 1): Promise<Paged<SocialAccountDto>> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_READ);
  const filter = scopeOf(ctx);
  const collection = ctx.db.collection<SocialAccountDoc>(MARKETING_COLLECTIONS.socialAccounts);
  const [total, docs] = await Promise.all([
    collection.countDocuments(filter),
    collection.find(filter).sort({ connectedAt: -1 }).skip(skipOf(page)).limit(MARKETING_PAGE_SIZE).toArray(),
  ]);
  return { items: docs.map(toAccountDto), ...pageMeta(page, total) };
}

/** Accounts a post can be attached to. Only connected accounts qualify. */
export async function connectedAccountOptions(ctx: WorkspaceContext): Promise<{ id: string; name: string }[]> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_READ);
  const docs = await ctx.db
    .collection<SocialAccountDoc>(MARKETING_COLLECTIONS.socialAccounts)
    .find({ ...scopeOf(ctx), connectionStatus: "connected" }, { projection: { displayName: 1 } })
    .sort({ displayName: 1 })
    .limit(200)
    .toArray();
  return docs.map((doc) => ({ id: doc._id.toHexString(), name: doc.displayName }));
}

/**
 * Starts authorization. The state is bound to the company and the user who started it. Only a hash of it
 * is stored, and it expires after ten minutes.
 */
export async function startSocialConnection(ctx: WorkspaceContext): Promise<{ authorizationUrl: string }> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_SOCIAL_MANAGE);
  const config = getSocialConfig();
  if (!config.configured || !config.appId) {
    throw new AppError("PROVIDER_NOT_CONFIGURED", "The Facebook integration is not configured on this server.");
  }
  const state = generateOauthState();
  const now = new Date();
  const doc: SocialOauthStateDoc = {
    _id: hashOauthState(state),
    companyId: ctx.companyId,
    userId: ctx.userId,
    platform: "facebook_page",
    createdAt: now,
    expiresAt: new Date(now.getTime() + OAUTH_STATE_TTL_MS),
    consumedAt: null,
  };
  await ctx.db.collection<SocialOauthStateDoc>(MARKETING_COLLECTIONS.socialOauthStates).insertOne(doc);
  return { authorizationUrl: buildAuthorizationUrl({ appId: config.appId }, `${getAppUrl()}${SOCIAL_CALLBACK_PATH}`, state) };
}

/**
 * Completes authorization. The state is consumed atomically, so a replayed callback fails. The callback's
 * session user must be the user who started the flow, and that user must still hold social-management rights.
 */
export async function completeSocialConnection(
  db: Db,
  input: { state: string; code: string; userId: ObjectId; requestId: string }
): Promise<{ connectedPages: number }> {
  const config = getSocialConfig();
  if (!config.configured || !config.encryptionKey) {
    throw new AppError("PROVIDER_NOT_CONFIGURED", "The Facebook integration is not configured on this server.");
  }
  const now = new Date();
  const consumed = await db.collection<SocialOauthStateDoc>(MARKETING_COLLECTIONS.socialOauthStates).findOneAndUpdate(
    { _id: hashOauthState(input.state), userId: input.userId, consumedAt: null, expiresAt: { $gt: now } },
    { $set: { consumedAt: now } },
    { returnDocument: "after" }
  );
  if (!consumed) {
    throw new AppError("FORBIDDEN", "This connection link has expired or was already used. Start the connection again.");
  }

  // Read through the same database handle as the rest of the flow, and check the live membership.
  const membership = await db
    .collection<{ role: string; status: string }>(COLLECTIONS.companyMembers)
    .findOne({ companyId: consumed.companyId, userId: input.userId, status: "active" }, { projection: { role: 1 } });
  if (!membership || !canManageSocial(membership.role)) {
    throw new AppError("FORBIDDEN", "You no longer have permission to manage social accounts for this company.");
  }

  try {
    const redirectUri = `${getAppUrl()}${SOCIAL_CALLBACK_PATH}`;
    const shortToken = await exchangeCodeForToken(config, redirectUri, input.code);
    const longToken = await exchangeForLongLivedToken(config, shortToken);
    const pages = await listManagedPages(longToken);
    const publishable = pages.filter((page) => page.tasks.includes("CREATE_CONTENT") || page.tasks.length === 0);

    for (const page of publishable) {
      await upsertConnectedPage(db, consumed.companyId, input.userId, page, config.encryptionKey);
    }
    await recordAudit(db, {
      companyId: consumed.companyId,
      actorUserId: input.userId,
      action: "marketing.social.connected",
      entityType: "marketing_social_account",
      entityId: consumed.companyId.toHexString(),
      requestId: input.requestId,
      metadata: { pages: publishable.length },
    });
    return { connectedPages: publishable.length };
  } catch (error) {
    if (error instanceof MetaApiError) {
      throw new AppError("INTERNAL", "The Facebook connection could not be completed. Try again later.");
    }
    if (error instanceof TokenCryptoError) {
      throw new AppError("INTERNAL", "The credential store is not configured correctly.");
    }
    throw error;
  }
}

function canManageSocial(role: string): boolean {
  return role === "owner" || role === "admin" || role === "manager";
}

async function upsertConnectedPage(
  db: Db,
  companyId: ObjectId,
  userId: ObjectId,
  page: { id: string; name: string; accessToken: string },
  key: Buffer
): Promise<void> {
  const now = new Date();
  await db.collection<SocialAccountDoc>(MARKETING_COLLECTIONS.socialAccounts).updateOne(
    { companyId, platform: "facebook_page", externalAccountId: page.id },
    {
      $set: {
        displayName: page.name.slice(0, 200),
        connectionStatus: "connected",
        encryptedToken: encryptToken(page.accessToken, key),
        grantedScopes: ["pages_manage_posts"],
        connectedBy: userId,
        connectedAt: now,
        disconnectedAt: null,
        lastErrorCode: null,
        updatedAt: now,
      },
      $setOnInsert: { _id: new ObjectId(), companyId, platform: "facebook_page", externalAccountId: page.id, createdAt: now },
      $inc: { version: 1 },
    },
    { upsert: true }
  );
}

/**
 * Disconnects an account: the stored token is removed and scheduled posts for the account are cancelled in
 * the same transaction. Provider-side revocation is not performed; the user can also remove the app in Facebook.
 */
export async function disconnectSocialAccount(ctx: WorkspaceContext, idRaw: string, expectedVersion: number): Promise<void> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_SOCIAL_MANAGE);
  const accountId = toObjectId(idRaw);
  const now = new Date();
  await withTransaction(ctx.db, async (tx) => {
    const result = await ctx.db.collection<SocialAccountDoc>(MARKETING_COLLECTIONS.socialAccounts).updateOne(
      { _id: accountId, ...scopeOf(ctx), version: expectedVersion },
      {
        $set: { connectionStatus: "disconnected", encryptedToken: null, disconnectedAt: now, updatedAt: now },
        $inc: { version: 1 },
      },
      { session: tx.session }
    );
    if (result.matchedCount === 0) throw new AppError("CONFLICT", "This account changed. Reload and try again.");
    const posts = await ctx.db
      .collection<SocialPostDoc>(MARKETING_COLLECTIONS.socialPosts)
      .find({ ...scopeOf(ctx), socialAccountId: accountId, status: "scheduled" }, { projection: { _id: 1 } })
      .toArray();
    if (posts.length > 0) {
      await ctx.db.collection<SocialPostDoc>(MARKETING_COLLECTIONS.socialPosts).updateMany(
        { _id: { $in: posts.map((post) => post._id) }, ...scopeOf(ctx), status: "scheduled" },
        { $set: { status: "cancelled", lastErrorCode: "ACCOUNT_DISCONNECTED", updatedAt: now }, $inc: { version: 1 } },
        { session: tx.session }
      );
      await ctx.db.collection(MARKETING_COLLECTIONS.jobs).updateMany(
        { ...scopeOf(ctx), type: "social.publish", targetId: { $in: posts.map((post) => post._id) }, status: "queued" },
        { $set: { status: "cancelled", updatedAt: now } },
        { session: tx.session }
      );
    }
    await recordAudit(
      ctx.db,
      {
        companyId: ctx.companyId,
        actorUserId: ctx.userId,
        action: "marketing.social.disconnected",
        entityType: "marketing_social_account",
        entityId: idRaw,
        requestId: ctx.requestId,
        metadata: { cancelledPosts: posts.length },
      },
      tx
    );
  });
}

/** Exposed for the post service: decrypts a page token for one publish attempt. Never returned to clients. */
export function openAccountToken(doc: SocialAccountDoc, key: Buffer): string {
  if (!doc.encryptedToken) throw new TokenCryptoError();
  return decryptToken(doc.encryptedToken, key);
}
