import "server-only";
import { randomBytes } from "crypto";
import type { ObjectId } from "mongodb";
import clientPromise from "@/server/db/client";
import { sendVerificationEmail } from "@/server/email";

const TOKEN_TTL_MS = 1000 * 60 * 60 * 24;
const MIN_RESEND_INTERVAL_MS = 1000 * 60;

export type VerificationUser = {
  _id: ObjectId;
  email?: unknown;
  name?: unknown;
  status?: unknown;
  emailVerified?: unknown;
  verificationSentAt?: unknown;
};

export type IssueVerificationOutcome =
  | { status: "sent" }
  | { status: "throttled" }
  | { status: "already_verified" }
  | { status: "failed"; reason: "not_configured" | "error"; error?: string };

export async function issueVerificationEmail(
  user: VerificationUser,
  options: { force?: boolean } = {}
): Promise<IssueVerificationOutcome> {
  const email = typeof user.email === "string" ? user.email.toLowerCase().trim() : "";
  if (!email) {
    return { status: "failed", reason: "error", error: "User has no email address" };
  }

  if (user.status === "active" || user.emailVerified) {
    return { status: "already_verified" };
  }

  const now = Date.now();
  const lastSent = user.verificationSentAt instanceof Date ? user.verificationSentAt.getTime() : 0;
  if (!options.force && now - lastSent < MIN_RESEND_INTERVAL_MS) {
    return { status: "throttled" };
  }

  const token = randomBytes(32).toString("hex");

  const client = await clientPromise;
  await client
    .db()
    .collection("users")
    .updateOne(
      { _id: user._id },
      {
        $set: {
          status: "unverified",
          verificationToken: token,
          verificationTokenExpires: new Date(now + TOKEN_TTL_MS),
          verificationSentAt: new Date(now),
          updatedAt: new Date(now),
        },
      }
    );

  const name = typeof user.name === "string" && user.name.length > 0 ? user.name : email;
  const result = await sendVerificationEmail(email, name, token);

  if (!result.delivered) {
    console.error(
      `[auth] verification email NOT delivered to ${email} (reason=${result.reason ?? "unknown"}${result.error ? `, error=${result.error}` : ""})`
    );
    return { status: "failed", reason: result.reason ?? "error", error: result.error };
  }

  return { status: "sent" };
}
