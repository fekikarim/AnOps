"use server";

import clientPromise from "@/server/db/client";
import { forgotPasswordSchema } from "@/features/auth/schemas/auth.schema";
import { sendPasswordResetEmail } from "@/server/email";
import { allowAuthAttempt, requestIp } from "@/server/security/auth-throttle";
import { generateResetToken, hashResetToken, maskEmail, RESET_TOKEN_TTL_MS } from "@/server/auth/reset-token";

export type ForgotPasswordResult = {
  ok: boolean;
  message: string;
  emailAttempted: boolean;
  emailDelivered: boolean;
  emailReason?: "not_configured" | "error";
  emailError?: string;
};

export async function requestPasswordReset(data: unknown): Promise<ForgotPasswordResult> {
  const parsed = forgotPasswordSchema.safeParse(data);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message || "Invalid email",
      emailAttempted: false,
      emailDelivered: false,
    };
  }

  const email = parsed.data.email.toLowerCase().trim();
  console.info(`[auth] password reset requested for ${maskEmail(email)}`);

  try {
    const client = await clientPromise;
    const db = client.db();
    const users = db.collection("users");

    // Same answer whether the account exists or the limit was hit: nothing to learn from the response.
    if (!(await allowAuthAttempt(db, "password-reset", await requestIp(), email, { pair: 3, account: 5, ip: 20, windowMs: 60 * 60_000 }))) {
      return { ok: true, message: "If an account exists, a reset link has been sent.", emailAttempted: false, emailDelivered: false };
    }

    const user = await users.findOne({ email });
    if (!user) {
      console.warn(`[auth] password reset: no user found for ${maskEmail(email)} — no email sent`);
      return {
        ok: true,
        message: "If an account exists, a reset link has been sent.",
        emailAttempted: false,
        emailDelivered: false,
      };
    }

    const token = generateResetToken();
    await users.updateOne(
      { _id: user._id },
      {
        $set: {
          // Only the hash is stored; the raw token exists in the email alone.
          passwordResetTokenHash: hashResetToken(token),
          passwordResetExpires: new Date(Date.now() + RESET_TOKEN_TTL_MS),
          updatedAt: new Date(),
        },
        $unset: { passwordResetToken: "" },
      }
    );

    const name = typeof user.name === "string" && user.name.length > 0 ? user.name : email;

    try {
      const mailResult = await sendPasswordResetEmail(email, name, token);
      if (!mailResult.delivered) {
        console.error(
          `[auth] Password reset email NOT delivered to ${maskEmail(email)} (reason=${mailResult.reason ?? "unknown"}${mailResult.error ? `, error=${mailResult.error}` : ""})`
        );
        return {
          ok: true,
          message: "If an account exists, a reset link has been sent.",
          emailAttempted: true,
          emailDelivered: false,
          emailReason: mailResult.reason,
          emailError: mailResult.error,
        };
      }

      return {
        ok: true,
        message: "If an account exists, a reset link has been sent.",
        emailAttempted: true,
        emailDelivered: true,
      };
    } catch (mailError) {
      console.error("[auth] Unexpected error sending password reset email", mailError);
      return {
        ok: true,
        message: "If an account exists, a reset link has been sent.",
        emailAttempted: true,
        emailDelivered: false,
        emailReason: "error",
        emailError: String(mailError),
      };
    }
  } catch (error) {
    console.error("requestPasswordReset error", error);
    return {
      ok: false,
      message: "Something went wrong. Please try again.",
      emailAttempted: false,
      emailDelivered: false,
    };
  }
}
