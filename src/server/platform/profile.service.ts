import "server-only";
import bcrypt from "bcryptjs";
import type { Db, ObjectId } from "mongodb";
import { recordAudit } from "@/server/audit/audit.service";
import { consumeSharedRateLimit } from "@/server/security/shared-rate-limit";
import { changePasswordSchema, userProfileSchema } from "@/features/platform/schemas";
import { userCompletion, type Completion } from "@/shared/domain/profile";
import { AppError } from "@/shared/lib/errors";
import { toFieldErrors } from "@/shared/lib/validation";

export type UserProfileView = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  jobTitle: string | null;
  language: "en" | "fr";
  notifications: { product: boolean; billing: boolean; security: boolean };
  emailVerified: boolean;
  createdAt: string | null;
  completion: Completion;
};

export async function getUserProfile(db: Db, userId: ObjectId): Promise<UserProfileView> {
  const user = await db.collection("users").findOne({ _id: userId }, { projection: { password: 0 } });
  if (!user) throw new AppError("NOT_FOUND", "Account not found.");
  const [first, ...rest] = String(user.name ?? "").split(" ");
  const firstName = String(user.firstName ?? first ?? "");
  const lastName = String(user.lastName ?? rest.join(" "));
  const prefs = (user.notificationPreferences ?? {}) as Record<string, unknown>;
  return {
    firstName,
    lastName,
    email: String(user.email ?? ""),
    phone: typeof user.phone === "string" ? user.phone : null,
    jobTitle: typeof user.jobTitle === "string" ? user.jobTitle : null,
    language: user.language === "fr" ? "fr" : "en",
    notifications: { product: prefs.product !== false, billing: prefs.billing !== false, security: prefs.security !== false },
    emailVerified: Boolean(user.emailVerified),
    createdAt: user.createdAt instanceof Date ? user.createdAt.toISOString() : null,
    completion: userCompletion({ ...user, firstName, lastName }),
  };
}

export async function updateUserProfile(db: Db, userId: ObjectId, raw: unknown): Promise<void> {
  const parsed = userProfileSchema.safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Check the form.", toFieldErrors(parsed.error));
  const { notifications, ...fields } = parsed.data;
  await db.collection("users").updateOne(
    { _id: userId },
    { $set: { ...fields, name: `${fields.firstName} ${fields.lastName}`, notificationPreferences: { ...notifications, security: true }, updatedAt: new Date() } }
  );
}

export async function changePassword(db: Db, userId: ObjectId, raw: unknown, requestId: string): Promise<void> {
  const parsed = changePasswordSchema.safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Check the form.", toFieldErrors(parsed.error));
  await consumeSharedRateLimit(db, `password-change:${userId.toHexString()}`, 5, 15 * 60 * 1000, "Too many attempts. Try again in a few minutes.");
  const user = await db.collection("users").findOne({ _id: userId }, { projection: { password: 1 } });
  if (!user?.password || !(await bcrypt.compare(parsed.data.currentPassword, String(user.password)))) {
    throw new AppError("VALIDATION_ERROR", "Your current password is incorrect.", { currentPassword: "Incorrect password." });
  }
  await db.collection("users").updateOne({ _id: userId }, { $set: { password: await bcrypt.hash(parsed.data.password, 12), forcePasswordReset: false, passwordChangedAt: new Date(), updatedAt: new Date() }, $unset: { passwordResetTokenHash: "", passwordResetToken: "", passwordResetExpires: "" } });
  await recordAudit(db, { companyId: null, actorUserId: userId, action: "user.password_changed", entityType: "user", entityId: userId.toHexString(), requestId });
}
