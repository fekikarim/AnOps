import "server-only";
import bcrypt from "bcryptjs";
import { ObjectId, type Db } from "mongodb";
import { recordAudit } from "@/server/audit/audit.service";
import { withTransaction } from "@/server/db/transactions";
import { createActivationToken, sendActivationEmail } from "@/server/platform/activation.service";
import { PLATFORM_COLLECTIONS } from "@/server/platform/collections";
import { createInitialSubscription } from "@/server/platform/subscription.service";
import { consumeSharedRateLimit } from "@/server/security/shared-rate-limit";
import { registrationSchema } from "@/features/platform/schemas";
import { ACTIVATION_HOURS, initialSubscriptionState, validateTrialSelection } from "@/shared/domain/plans";
import { AppError } from "@/shared/lib/errors";
import { toFieldErrors } from "@/shared/lib/validation";

export type RegistrationResult = {
  userId: ObjectId;
  companyId: ObjectId;
  email: string;
  kind: "free" | "trial";
  emailDelivered: boolean;
};

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "organization"
  );
}

async function uniqueSlug(db: Db, name: string): Promise<string> {
  const base = slugify(name);
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 7)}`;
    if (!(await db.collection("companies").findOne({ slug: candidate }, { projection: { _id: 1 } }))) return candidate;
  }
  return `${base}-${new ObjectId().toHexString().slice(-8)}`;
}

/**
 * Creates owner account, organization, owner membership, subscription (free or trial) and activation
 * token as one unit of work. The email lock prevents two concurrent registrations for one address;
 * the server re-validates the application selection and never trusts the client's entitlement.
 */
export async function registerOrganization(db: Db, raw: unknown, meta: { ip: string; requestId: string }): Promise<RegistrationResult> {
  const parsed = registrationSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Please check the form.", toFieldErrors(parsed.error));
  }
  const input = parsed.data;
  const selection = validateTrialSelection(input.apps);
  if (!selection.ok) throw new AppError("VALIDATION_ERROR", selection.message, { apps: selection.message });

  await consumeSharedRateLimit(db, `register:ip:${meta.ip}`, 10, 60 * 60 * 1000, "Too many sign-ups from this network. Try again later.");
  await consumeSharedRateLimit(db, `register:email:${input.email}`, 5, 60 * 60 * 1000);

  const locks = db.collection<{ _id: string; createdAt: Date }>(PLATFORM_COLLECTIONS.registrationLocks);
  try {
    await locks.insertOne({ _id: input.email, createdAt: new Date() });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) throw new AppError("CONFLICT", "A registration for this email is already in progress. Please wait a moment.");
    throw error;
  }

  try {
    const existing = await db.collection("users").findOne({ email: input.email }, { projection: { _id: 1 } });
    if (existing) throw new AppError("CONFLICT", "An account with this email already exists. Sign in instead.", { email: "This email is already registered." });

    const passwordHash = await bcrypt.hash(input.password, 12);
    const slug = await uniqueSlug(db, input.organizationName);
    const now = new Date();
    const deadline = new Date(now.getTime() + ACTIVATION_HOURS * 60 * 60 * 1000);
    const userId = new ObjectId();
    const companyId = new ObjectId();
    const name = `${input.firstName} ${input.lastName}`;

    const token = await withTransaction(db, async (tx) => {
      const users = db.collection("users");
      await users.insertOne(
        {
          _id: userId,
          name,
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          phone: input.phone,
          password: passwordHash,
          role: "employee",
          // Usable immediately; the email is confirmed by the organization activation link.
          status: "active",
          emailVerified: null,
          provisionalUntil: deadline,
          language: "en",
          notificationPreferences: { product: true, billing: true, security: true },
          createdAt: now,
          updatedAt: now,
        },
        { session: tx.session }
      );
      tx.onRollback(() => users.deleteOne({ _id: userId }));

      const companies = db.collection("companies");
      await companies.insertOne(
        {
          _id: companyId,
          name: input.organizationName,
          slug,
          ownerId: userId,
          currency: input.currency,
          contactEmail: input.email,
          contactPhone: input.phone,
          activationStatus: "pending",
          activationDeadline: deadline,
          createdAt: now,
          updatedAt: now,
        },
        { session: tx.session }
      );
      tx.onRollback(() => companies.deleteOne({ _id: companyId }));

      const members = db.collection("company_members");
      const memberId = new ObjectId();
      await members.insertOne({ _id: memberId, companyId, userId, role: "owner", status: "active", createdAt: now, updatedAt: now }, { session: tx.session });
      tx.onRollback(() => members.deleteOne({ _id: memberId }));

      await createInitialSubscription(db, { companyId, state: initialSubscriptionState(selection, now), orgCurrency: input.currency, billingEmail: input.email }, tx);
      const activationToken = await createActivationToken(db, { userId, companyId, expiresAt: deadline }, tx);
      await recordAudit(
        db,
        { companyId, actorUserId: userId, action: "organization.registered", entityType: "organization", entityId: companyId.toHexString(), requestId: meta.requestId, metadata: { kind: selection.kind, apps: selection.appIds.join(",") } },
        tx
      );
      return activationToken;
    });

    const sent = await sendActivationEmail({ to: input.email, name: input.firstName, organizationName: input.organizationName, token });
    return { userId, companyId, email: input.email, kind: selection.kind, emailDelivered: sent.delivered };
  } finally {
    await locks.deleteOne({ _id: input.email });
  }
}
