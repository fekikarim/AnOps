import "server-only";
import { ObjectId, type Db } from "mongodb";
import { recordAudit } from "@/server/audit/audit.service";
import { withTransaction, type Tx } from "@/server/db/transactions";
import { sendMail } from "@/server/email/client";
import { organizationActivationEmail } from "@/server/email/templates";
import { PLATFORM_COLLECTIONS, type ActivationTokenDoc } from "@/server/platform/collections";
import { hashToken, isWellFormedToken, newToken } from "@/server/platform/tokens";
import { consumeSharedRateLimit } from "@/server/security/shared-rate-limit";
import { ACTIVATION_HOURS } from "@/shared/domain/plans";
import { AppError } from "@/shared/lib/errors";

export const RESEND_COOLDOWN_MS = 60_000;
const RESEND_LIMIT_PER_HOUR = 5;
const INVALID_LINK = "This activation link is invalid, already used or expired.";

const tokens = (db: Db) => db.collection<ActivationTokenDoc>(PLATFORM_COLLECTIONS.activationTokens);

/** Creates a new activation token and revokes every earlier unused one for the organization. Returns the raw token (never stored). */
export async function createActivationToken(db: Db, input: { userId: ObjectId; companyId: ObjectId; expiresAt: Date }, tx?: Tx): Promise<string> {
  const now = new Date();
  await tokens(db).updateMany({ companyId: input.companyId, usedAt: null, revokedAt: null }, { $set: { revokedAt: now } }, { session: tx?.session });
  const { token, hash } = newToken();
  const doc: ActivationTokenDoc = { _id: new ObjectId(), tokenHash: hash, userId: input.userId, companyId: input.companyId, expiresAt: input.expiresAt, usedAt: null, revokedAt: null, createdAt: now };
  await tokens(db).insertOne(doc, { session: tx?.session });
  tx?.onRollback(() => tokens(db).deleteOne({ _id: doc._id }));
  return token;
}

export async function sendActivationEmail(input: { to: string; name: string; organizationName: string; token: string }): Promise<{ delivered: boolean }> {
  const message = organizationActivationEmail(input.name, input.organizationName, input.token, ACTIVATION_HOURS);
  const result = await sendMail({ to: input.to, ...message });
  return { delivered: result.delivered };
}

export type ActivationStatusView = {
  pending: boolean;
  email: string;
  organizationName: string;
  deadline: string | null;
  lastSentAt: string | null;
  resendAvailableAt: string | null;
};

export async function getActivationStatus(db: Db, input: { userId: ObjectId; companyId: ObjectId }): Promise<ActivationStatusView | null> {
  const [company, user, last] = await Promise.all([
    db.collection("companies").findOne({ _id: input.companyId }, { projection: { name: 1, activationStatus: 1, activationDeadline: 1, ownerId: 1 } }),
    db.collection("users").findOne({ _id: input.userId }, { projection: { email: 1 } }),
    tokens(db).find({ companyId: input.companyId }).sort({ createdAt: -1 }).limit(1).next(),
  ]);
  if (!company || !user) return null;
  const pending = company.activationStatus === "pending";
  return {
    pending,
    email: String(user.email ?? ""),
    organizationName: String(company.name ?? ""),
    deadline: pending && company.activationDeadline instanceof Date ? company.activationDeadline.toISOString() : null,
    lastSentAt: last ? last.createdAt.toISOString() : null,
    resendAvailableAt: last ? new Date(last.createdAt.getTime() + RESEND_COOLDOWN_MS).toISOString() : null,
  };
}

/** Owner-only resend with a cooldown and an hourly cap. The new link expires at the original deadline (never extends it). */
export async function resendActivation(db: Db, input: { userId: ObjectId; companyId: ObjectId; requestId: string }): Promise<{ delivered: boolean; email: string }> {
  const company = await db.collection("companies").findOne({ _id: input.companyId });
  if (!company || company.activationStatus !== "pending") throw new AppError("INVALID_TRANSITION", "This organization is already active.");
  if (!(company.ownerId as ObjectId).equals(input.userId)) throw new AppError("FORBIDDEN", "Only the organization owner can resend the activation email.");
  const deadline = company.activationDeadline as Date;
  if (!(deadline instanceof Date) || deadline <= new Date()) throw new AppError("INVALID_TRANSITION", "The activation period has ended.");

  const last = await tokens(db).find({ companyId: input.companyId }).sort({ createdAt: -1 }).limit(1).next();
  if (last && Date.now() - last.createdAt.getTime() < RESEND_COOLDOWN_MS) {
    throw new AppError("RATE_LIMITED", "Please wait a minute before requesting another email.");
  }
  await consumeSharedRateLimit(db, `activation-resend:${input.companyId.toHexString()}`, RESEND_LIMIT_PER_HOUR, 60 * 60 * 1000, "Too many activation emails. Try again later.");

  const user = await db.collection("users").findOne({ _id: input.userId }, { projection: { email: 1, name: 1, firstName: 1 } });
  if (!user) throw new AppError("NOT_FOUND", "Account not found.");
  const token = await createActivationToken(db, { userId: input.userId, companyId: input.companyId, expiresAt: deadline });
  const sent = await sendActivationEmail({ to: String(user.email), name: String(user.firstName ?? user.name ?? ""), organizationName: String(company.name), token });
  await recordAudit(db, { companyId: input.companyId, actorUserId: input.userId, action: "organization.activation_resent", entityType: "organization", entityId: input.companyId.toHexString(), requestId: input.requestId, metadata: { delivered: sent.delivered } });
  return { delivered: sent.delivered, email: String(user.email) };
}

/**
 * Validates the token and activates owner and organization in one transaction. The token is claimed
 * atomically, so a link works exactly once even with concurrent clicks. Every failure returns the same
 * generic message (no enumeration).
 */
export async function activateOrganization(db: Db, rawToken: unknown, requestId: string): Promise<{ companyId: ObjectId; userId: ObjectId }> {
  if (!isWellFormedToken(rawToken)) throw new AppError("NOT_FOUND", INVALID_LINK);
  const tokenHash = hashToken(rawToken);

  return withTransaction(db, async (tx) => {
    const now = new Date();
    const claimed = await tokens(db).findOneAndUpdate(
      { tokenHash, usedAt: null, revokedAt: null, expiresAt: { $gt: now } },
      { $set: { usedAt: now } },
      { session: tx.session, returnDocument: "after" }
    );
    if (!claimed) throw new AppError("NOT_FOUND", INVALID_LINK);
    tx.onRollback(() => tokens(db).updateOne({ _id: claimed._id }, { $set: { usedAt: null } }));

    const company = await db.collection("companies").findOneAndUpdate(
      { _id: claimed.companyId, activationStatus: "pending", activationDeadline: { $gt: now } },
      { $set: { activationStatus: "active", activatedAt: now, updatedAt: now }, $unset: { activationDeadline: "" } },
      { session: tx.session, returnDocument: "before" }
    );
    if (!company) throw new AppError("NOT_FOUND", INVALID_LINK);
    tx.onRollback(() =>
      db.collection("companies").updateOne({ _id: claimed.companyId }, { $set: { activationStatus: "pending", activationDeadline: company.activationDeadline }, $unset: { activatedAt: "" } })
    );

    const before = await db.collection("users").findOneAndUpdate(
      { _id: claimed.userId },
      { $set: { emailVerified: now, status: "active", updatedAt: now }, $unset: { provisionalUntil: "" } },
      { session: tx.session, returnDocument: "before" }
    );
    if (!before) throw new AppError("NOT_FOUND", INVALID_LINK);
    tx.onRollback(() =>
      db.collection("users").updateOne({ _id: claimed.userId }, { $set: { emailVerified: before.emailVerified ?? null, provisionalUntil: before.provisionalUntil } })
    );

    await tokens(db).updateMany({ companyId: claimed.companyId, usedAt: null, revokedAt: null }, { $set: { revokedAt: now } }, { session: tx.session });
    await recordAudit(db, { companyId: claimed.companyId, actorUserId: claimed.userId, action: "organization.activated", entityType: "organization", entityId: claimed.companyId.toHexString(), requestId }, tx);
    return { companyId: claimed.companyId, userId: claimed.userId };
  });
}
