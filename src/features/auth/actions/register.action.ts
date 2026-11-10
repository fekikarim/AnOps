"use server";

import bcrypt from "bcryptjs";
import { allowAuthAttempt, requestIp } from "@/server/security/auth-throttle";
import { maskEmail } from "@/server/auth/reset-token";
import clientPromise from "@/server/db/client";
import { registerSchema } from "@/features/auth/schemas/auth.schema";
import {
  issueVerificationEmail,
  type IssueVerificationOutcome,
  type VerificationUser,
} from "@/server/auth/verification";

export type RegisterResult = {
  ok: boolean;
  message: string;
  email?: {
    delivered: boolean;
    reason?: "not_configured" | "error";
    error?: string;
  };
};

function toEmailState(outcome: IssueVerificationOutcome): RegisterResult["email"] {
  if (outcome.status === "failed") {
    return { delivered: false, reason: outcome.reason, error: outcome.error };
  }
  return { delivered: true };
}

export async function registerUser(data: unknown): Promise<RegisterResult> {
  const parsed = registerSchema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message || "Invalid data" };
  }

  const { name, email, password } = parsed.data;
  const normalizedEmail = email.toLowerCase().trim();
  console.info(`[auth] register: creating account for ${maskEmail(normalizedEmail)}`);

  try {
    const client = await clientPromise;
    const db = client.db();
    const users = db.collection("users");

    // Stops sign-up floods and repeated verification emails to one address (resending ignores the one-minute throttle).
    if (!(await allowAuthAttempt(db, "register", await requestIp(), normalizedEmail, { pair: 3, account: 5, ip: 20, windowMs: 60 * 60_000 }))) {
      return { ok: false, message: "Too many attempts. Please wait an hour and try again." };
    }

    const existing = await users.findOne({ email: normalizedEmail });
    if (existing) {
      const isUnverified = existing.status === "unverified" || !existing.emailVerified;
      if (isUnverified && existing.status !== "banned") {
        console.warn(
          `[auth] register: ${maskEmail(normalizedEmail)} already exists but is unverified — resending verification`
        );
        const outcome = await issueVerificationEmail(existing as VerificationUser, { force: true });
        return {
          ok: true,
          message: "Account created. Check your email to verify.",
          email: toEmailState(outcome),
        };
      }

      // Same answer as a new sign-up, so this form cannot be used to find out who has an account. Nothing is sent.
      console.warn(`[auth] register: ${maskEmail(normalizedEmail)} already has an account — nothing sent`);
      return { ok: true, message: "Account created. Check your email to verify.", email: { delivered: true } };
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const now = new Date();

    const inserted = await users.insertOne({
      name: name.trim(),
      email: normalizedEmail,
      password: hashedPassword,
      role: "employee",
      emailVerified: null,
      status: "unverified",
      createdAt: now,
      updatedAt: now,
    });

    const outcome = await issueVerificationEmail(
      {
        _id: inserted.insertedId,
        email: normalizedEmail,
        name: name.trim(),
        status: "unverified",
      },
      { force: true }
    );

    return {
      ok: true,
      message:
        outcome.status === "sent"
          ? "Account created. Check your email to verify."
          : "Account created, but the verification email could not be sent.",
      email: toEmailState(outcome),
    };
  } catch (error) {
    console.error("registerUser error", error);
    return { ok: false, message: "Something went wrong. Please try again." };
  }
}
