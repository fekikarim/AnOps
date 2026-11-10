import "server-only";
import { ObjectId, type Db } from "mongodb";
import type { Tx } from "@/server/db/transactions";
import { recordAudit } from "@/server/audit/audit.service";
import { PLATFORM_COLLECTIONS, type SubscriptionDoc } from "@/server/platform/collections";
import { isApplicationId, type ApplicationId } from "@/shared/domain/applications";
import {
  billingCurrencyFor,
  freeFallbackChoices,
  resolveEntitlements,
  type BillingCurrency,
  type Entitlements,
  type SubscriptionState,
} from "@/shared/domain/plans";
import { AppError } from "@/shared/lib/errors";

const subs = (db: Db) => db.collection<SubscriptionDoc>(PLATFORM_COLLECTIONS.subscriptions);

export function toState(doc: SubscriptionDoc | null): SubscriptionState | null {
  // Organizations created before subscriptions keep grandfathered access until a paid plan is synced.
  if (!doc || doc.legacy) return null;
  return {
    plan: doc.plan,
    status: doc.status,
    freeAppId: doc.freeAppId,
    trialAppIds: doc.trialAppIds ?? [],
    trialStartedAt: doc.trialStartedAt,
    trialEndsAt: doc.trialEndsAt,
    customAppIds: doc.customAppIds ?? [],
    aiAddon: Boolean(doc.aiAddon),
    currentPeriodEnd: doc.currentPeriodEnd,
    cancelAtPeriodEnd: Boolean(doc.cancelAtPeriodEnd),
    pastDueSince: doc.pastDueSince,
  };
}

export async function getSubscriptionDoc(db: Db, companyId: ObjectId): Promise<SubscriptionDoc | null> {
  return subs(db).findOne({ companyId });
}

export async function getEntitlements(db: Db, companyId: ObjectId, now = new Date()): Promise<Entitlements> {
  return resolveEntitlements(toState(await getSubscriptionDoc(db, companyId)), now);
}

/** Creates the organization's first subscription document inside the registration transaction. */
export async function createInitialSubscription(
  db: Db,
  input: { companyId: ObjectId; state: SubscriptionState; orgCurrency: string; billingEmail: string },
  tx: Tx
): Promise<void> {
  const now = new Date();
  const doc: SubscriptionDoc = {
    _id: new ObjectId(),
    companyId: input.companyId,
    ...input.state,
    billingCurrency: billingCurrencyFor(input.orgCurrency),
    billingInterval: null,
    billingEmail: input.billingEmail,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    stripeStatus: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  await subs(db).insertOne(doc, { session: tx.session });
  tx.onRollback(() => subs(db).deleteOne({ _id: doc._id }));
}

/**
 * One-time fallback to the permanent OneOps plan. Only allowed when the organization currently has no
 * paid access; the free application can never be changed once set.
 */
export async function chooseFreeFallback(db: Db, input: { companyId: ObjectId; actorUserId: ObjectId; appId: unknown; requestId: string }): Promise<void> {
  if (!isApplicationId(input.appId)) throw new AppError("VALIDATION_ERROR", "Choose a valid application.");
  const doc = await getSubscriptionDoc(db, input.companyId);
  if (!doc) throw new AppError("INVALID_TRANSITION", "This organization already has full access.");
  const ent = resolveEntitlements(toState(doc));
  if (!ent.needsPlanSelection) throw new AppError("INVALID_TRANSITION", "Your organization already has an active plan.");
  const choices = freeFallbackChoices(toState(doc));
  if (!choices.includes(input.appId)) {
    throw new AppError("FORBIDDEN", doc.freeAppId ? "Your free application was chosen earlier and cannot be changed." : "This application cannot be your free application.");
  }
  const appId: ApplicationId = input.appId;
  // Conditional update: a concurrent fallback or payment cannot be overwritten.
  const result = await subs(db).updateOne(
    { _id: doc._id, version: doc.version, $or: [{ freeAppId: null }, { freeAppId: appId }] },
    {
      $set: { plan: "oneops", status: "free", freeAppId: appId, cancelAtPeriodEnd: false, pastDueSince: null, updatedAt: new Date() },
      $inc: { version: 1 },
    }
  );
  if (result.modifiedCount !== 1) throw new AppError("CONFLICT", "Your subscription changed meanwhile. Reload and try again.");
  await recordAudit(db, {
    companyId: input.companyId,
    actorUserId: input.actorUserId,
    action: "subscription.free_fallback",
    entityType: "subscription",
    entityId: doc._id.toHexString(),
    requestId: input.requestId,
    metadata: { appId },
  });
}

export async function setBillingPreferences(db: Db, companyId: ObjectId, patch: { billingEmail?: string; billingCurrency?: BillingCurrency }): Promise<void> {
  const $set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.billingEmail !== undefined) $set.billingEmail = patch.billingEmail;
  if (patch.billingCurrency !== undefined) $set.billingCurrency = patch.billingCurrency;
  const result = await subs(db).updateOne({ companyId }, { $set });
  if (result.matchedCount === 0) throw new AppError("NOT_FOUND", "This organization has no subscription record yet.");
}

/** Marks trials whose end date passed as lapsed. Entitlements already treat them as expired; this keeps stored status honest. */
export async function markExpiredTrials(db: Db, now = new Date()): Promise<number> {
  const result = await subs(db).updateMany(
    { status: "trialing", trialEndsAt: { $lte: now } },
    { $set: { status: "lapsed", updatedAt: now }, $inc: { version: 1 } }
  );
  return result.modifiedCount;
}
