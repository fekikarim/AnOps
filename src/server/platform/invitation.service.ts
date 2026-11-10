import "server-only";
import bcrypt from "bcryptjs";
import { ObjectId, type Db } from "mongodb";
import { recordAudit } from "@/server/audit/audit.service";
import { withTransaction } from "@/server/db/transactions";
import { sendMail } from "@/server/email/client";
import { invitationEmail } from "@/server/email/templates";
import { PLATFORM_COLLECTIONS, type InvitationDoc, type InvitationRole } from "@/server/platform/collections";
import { hashToken, isWellFormedToken, newToken } from "@/server/platform/tokens";
import { consumeSharedRateLimit } from "@/server/security/shared-rate-limit";
import { acceptInvitationSchema, invitationBatchSchema } from "@/features/platform/schemas";
import { AppError } from "@/shared/lib/errors";
import { toFieldErrors } from "@/shared/lib/validation";

export const INVITATION_DAYS = 7;
const INVALID = "This invitation is invalid, already used or expired.";
const ROLE_LABEL: Record<InvitationRole, string> = { admin: "Administrator", manager: "Manager", employee: "Employee" };

const invitations = (db: Db) => db.collection<InvitationDoc>(PLATFORM_COLLECTIONS.invitations);

export type InviterContext = { db: Db; companyId: ObjectId; userId: ObjectId; role: "owner" | "admin" | "operator" | "viewer"; requestId: string };

export type InvitationView = { id: string; email: string; role: InvitationRole; status: "pending" | "expired" | "accepted" | "revoked"; expiresAt: string; sentAt: string; sendCount: number };

function assertCanInvite(ctx: InviterContext, role: InvitationRole) {
  if (ctx.role !== "owner" && ctx.role !== "admin") throw new AppError("FORBIDDEN", "Only owners and administrators can invite members.");
  // Admins cannot create peers with more authority than they have; only the owner appoints administrators.
  if (role === "admin" && ctx.role !== "owner") throw new AppError("FORBIDDEN", "Only the owner can invite administrators.");
}

async function deliver(db: Db, ctx: InviterContext, email: string, role: InvitationRole, token: string): Promise<boolean> {
  const [company, inviter] = await Promise.all([
    db.collection("companies").findOne({ _id: ctx.companyId }, { projection: { name: 1 } }),
    db.collection("users").findOne({ _id: ctx.userId }, { projection: { name: 1 } }),
  ]);
  const message = invitationEmail({ inviterName: String(inviter?.name ?? "A colleague"), organizationName: String(company?.name ?? "an organization"), roleLabel: ROLE_LABEL[role], token, days: INVITATION_DAYS });
  const result = await sendMail({ to: email, ...message });
  return result.delivered;
}

export type InviteOutcome = { email: string; status: "sent" | "not_delivered" | "already_member" | "already_invited" };

/** Sends invitations one by one; duplicates and existing members are reported, never duplicated. */
export async function inviteMembers(ctx: InviterContext, raw: unknown): Promise<InviteOutcome[]> {
  const parsed = invitationBatchSchema.safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Check the invitations.", toFieldErrors(parsed.error));
  const { db } = ctx;
  const company = await db.collection("companies").findOne({ _id: ctx.companyId }, { projection: { activationStatus: 1 } });
  if (company?.activationStatus === "pending") throw new AppError("INVALID_TRANSITION", "Activate your organization before inviting colleagues.");
  await consumeSharedRateLimit(db, `invite:${ctx.companyId.toHexString()}`, 60, 60 * 60 * 1000, "Too many invitations in a short time. Try again later.");

  const seen = new Set<string>();
  const outcomes: InviteOutcome[] = [];
  for (const { email, role } of parsed.data.invitations) {
    if (seen.has(email)) continue;
    seen.add(email);
    assertCanInvite(ctx, role);

    const user = await db.collection("users").findOne({ email }, { projection: { _id: 1 } });
    if (user && (await db.collection("company_members").findOne({ companyId: ctx.companyId, userId: user._id, status: { $in: ["active", "suspended"] } }))) {
      outcomes.push({ email, status: "already_member" });
      continue;
    }

    const now = new Date();
    // An expired pending invitation for the same address is retired before a new one is issued.
    await invitations(db).updateMany({ companyId: ctx.companyId, email, status: "pending", expiresAt: { $lte: now } }, { $set: { status: "revoked", updatedAt: now } });
    const { token, hash } = newToken();
    try {
      await invitations(db).insertOne({
        _id: new ObjectId(),
        companyId: ctx.companyId,
        email,
        role,
        appAccess: null,
        tokenHash: hash,
        status: "pending",
        invitedBy: ctx.userId,
        expiresAt: new Date(now.getTime() + INVITATION_DAYS * 86_400_000),
        sentAt: now,
        sendCount: 1,
        acceptedAt: null,
        acceptedUserId: null,
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        outcomes.push({ email, status: "already_invited" });
        continue;
      }
      throw error;
    }
    const delivered = await deliver(db, ctx, email, role, token);
    await recordAudit(db, { companyId: ctx.companyId, actorUserId: ctx.userId, action: "invitation.created", entityType: "invitation", entityId: email, requestId: ctx.requestId, metadata: { role, delivered } });
    outcomes.push({ email, status: delivered ? "sent" : "not_delivered" });
  }
  return outcomes;
}

export async function listInvitations(db: Db, companyId: ObjectId): Promise<InvitationView[]> {
  const now = new Date();
  const docs = await invitations(db).find({ companyId, status: { $in: ["pending"] } }).sort({ createdAt: -1 }).limit(200).toArray();
  return docs.map((doc) => ({
    id: doc._id.toHexString(),
    email: doc.email,
    role: doc.role,
    status: doc.expiresAt <= now ? "expired" : "pending",
    expiresAt: doc.expiresAt.toISOString(),
    sentAt: doc.sentAt.toISOString(),
    sendCount: doc.sendCount,
  }));
}

/** Issues a fresh token (the old link stops working) and extends the expiry. */
export async function resendInvitation(ctx: InviterContext, invitationId: string): Promise<boolean> {
  if (!ObjectId.isValid(invitationId)) throw new AppError("NOT_FOUND", "Invitation not found.");
  const doc = await invitations(ctx.db).findOne({ _id: new ObjectId(invitationId), companyId: ctx.companyId, status: "pending" });
  if (!doc) throw new AppError("NOT_FOUND", "Invitation not found.");
  assertCanInvite(ctx, doc.role);
  if (Date.now() - doc.sentAt.getTime() < 60_000) throw new AppError("RATE_LIMITED", "Please wait a minute before resending.");
  const { token, hash } = newToken();
  const now = new Date();
  await invitations(ctx.db).updateOne(
    { _id: doc._id, status: "pending" },
    { $set: { tokenHash: hash, sentAt: now, expiresAt: new Date(now.getTime() + INVITATION_DAYS * 86_400_000), updatedAt: now }, $inc: { sendCount: 1 } }
  );
  const delivered = await deliver(ctx.db, ctx, doc.email, doc.role, token);
  await recordAudit(ctx.db, { companyId: ctx.companyId, actorUserId: ctx.userId, action: "invitation.resent", entityType: "invitation", entityId: doc.email, requestId: ctx.requestId, metadata: { delivered } });
  return delivered;
}

export async function revokeInvitation(ctx: InviterContext, invitationId: string): Promise<void> {
  if (!ObjectId.isValid(invitationId)) throw new AppError("NOT_FOUND", "Invitation not found.");
  const doc = await invitations(ctx.db).findOne({ _id: new ObjectId(invitationId), companyId: ctx.companyId, status: "pending" });
  if (!doc) throw new AppError("NOT_FOUND", "Invitation not found.");
  assertCanInvite(ctx, doc.role);
  await invitations(ctx.db).updateOne({ _id: doc._id, status: "pending" }, { $set: { status: "revoked", updatedAt: new Date() } });
  await recordAudit(ctx.db, { companyId: ctx.companyId, actorUserId: ctx.userId, action: "invitation.revoked", entityType: "invitation", entityId: doc.email, requestId: ctx.requestId });
}

export type InvitationPreview = { email: string; organizationName: string; roleLabel: string; accountExists: boolean };

/** Read-only lookup for the accept page. Reveals nothing for an invalid token. */
export async function previewInvitation(db: Db, rawToken: unknown): Promise<InvitationPreview | null> {
  if (!isWellFormedToken(rawToken)) return null;
  const doc = await invitations(db).findOne({ tokenHash: hashToken(rawToken), status: "pending", expiresAt: { $gt: new Date() } });
  if (!doc) return null;
  const [company, user] = await Promise.all([
    db.collection("companies").findOne({ _id: doc.companyId, activationStatus: { $ne: "expiring" } }, { projection: { name: 1 } }),
    db.collection("users").findOne({ email: doc.email }, { projection: { _id: 1 } }),
  ]);
  if (!company) return null;
  return { email: doc.email, organizationName: String(company.name), roleLabel: ROLE_LABEL[doc.role], accountExists: Boolean(user) };
}

/**
 * Accepts an invitation. Existing accounts must be signed in as the invited email (`signedInUserId`);
 * new people create their account here, and the token proves they own the email address.
 */
export async function acceptInvitation(db: Db, input: { token: unknown; signedInUserId: ObjectId | null; newAccount?: unknown; requestId: string }): Promise<{ companyId: ObjectId; userId: ObjectId; createdAccount: boolean }> {
  if (!isWellFormedToken(input.token)) throw new AppError("NOT_FOUND", INVALID);
  const tokenHash = hashToken(input.token);
  const pending = await invitations(db).findOne({ tokenHash, status: "pending", expiresAt: { $gt: new Date() } });
  if (!pending) throw new AppError("NOT_FOUND", INVALID);

  const existing = await db.collection("users").findOne({ email: pending.email }, { projection: { _id: 1 } });
  let passwordHash: string | null = null;
  let names: { firstName: string; lastName: string } | null = null;
  if (existing) {
    if (!input.signedInUserId || !existing._id.equals(input.signedInUserId)) {
      throw new AppError("FORBIDDEN", `Sign in as ${pending.email} to accept this invitation.`);
    }
  } else {
    const parsed = acceptInvitationSchema.safeParse({ ...(input.newAccount as object), token: input.token });
    if (!parsed.success) throw new AppError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Check the form.", toFieldErrors(parsed.error));
    passwordHash = await bcrypt.hash(parsed.data.password, 12);
    names = { firstName: parsed.data.firstName, lastName: parsed.data.lastName };
  }

  return withTransaction(db, async (tx) => {
    const now = new Date();
    const claimed = await invitations(db).findOneAndUpdate(
      { _id: pending._id, tokenHash, status: "pending", expiresAt: { $gt: now } },
      { $set: { status: "accepted", acceptedAt: now, updatedAt: now } },
      { session: tx.session, returnDocument: "after" }
    );
    if (!claimed) throw new AppError("NOT_FOUND", INVALID);
    tx.onRollback(() => invitations(db).updateOne({ _id: claimed._id }, { $set: { status: "pending", acceptedAt: null } }));

    let userId = existing?._id as ObjectId | undefined;
    const createdAccount = !userId;
    if (!userId && names && passwordHash) {
      userId = new ObjectId();
      await db.collection("users").insertOne(
        {
          _id: userId,
          name: `${names.firstName} ${names.lastName}`,
          firstName: names.firstName,
          lastName: names.lastName,
          email: claimed.email,
          password: passwordHash,
          role: "employee",
          status: "active",
          emailVerified: now, // the single-use link sent to this address proves ownership
          language: "en",
          notificationPreferences: { product: true, billing: false, security: true },
          createdAt: now,
          updatedAt: now,
        },
        { session: tx.session }
      );
      const created = userId;
      tx.onRollback(() => db.collection("users").deleteOne({ _id: created }));
    }
    if (!userId) throw new AppError("NOT_FOUND", INVALID);

    const members = db.collection("company_members");
    const already = await members.findOne({ companyId: claimed.companyId, userId }, { session: tx.session });
    if (already && already.status !== "invited") throw new AppError("CONFLICT", "You are already a member of this organization.");
    if (already) {
      await members.updateOne({ _id: already._id }, { $set: { status: "active", role: claimed.role, updatedAt: now } }, { session: tx.session });
    } else {
      const memberId = new ObjectId();
      await members.insertOne(
        { _id: memberId, companyId: claimed.companyId, userId, role: claimed.role, status: "active", appAccess: claimed.appAccess, invitedBy: claimed.invitedBy, joinedAt: now, createdAt: now, updatedAt: now },
        { session: tx.session }
      );
      tx.onRollback(() => members.deleteOne({ _id: memberId }));
    }
    await invitations(db).updateOne({ _id: claimed._id }, { $set: { acceptedUserId: userId } }, { session: tx.session });
    await recordAudit(db, { companyId: claimed.companyId, actorUserId: userId, action: "invitation.accepted", entityType: "invitation", entityId: claimed.email, requestId: input.requestId, metadata: { role: claimed.role } }, tx);
    return { companyId: claimed.companyId, userId, createdAccount };
  });
}
