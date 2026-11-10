"use server";

import bcrypt from "bcryptjs";
import { auth } from "@/server/auth";
import clientPromise from "@/server/db/client";
import { z } from "zod";

const forceResetSchema = z
  .object({
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type ForceResetResult = { ok: boolean; message: string };

/**
 * Resets the password for the currently logged-in user (forcePasswordReset flow).
 * No email token required — identity is established via the active session.
 * Clears the forcePasswordReset flag so the user can access the app on next login.
 */
export async function forceResetPasswordAction(data: unknown): Promise<ForceResetResult> {
  const session = await auth();
  if (!session?.user?.email) {
    return { ok: false, message: "You must be logged in." };
  }

  const parsed = forceResetSchema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message || "Invalid data." };
  }

  try {
    const client = await clientPromise;
    const db = client.db();
    const normalizedEmail = session.user.email.toLowerCase().trim();

    const user = await db.collection("users").findOne({ email: normalizedEmail });
    if (!user) {
      return { ok: false, message: "User account not found." };
    }

    const hashed = await bcrypt.hash(parsed.data.password, 12);

    await db.collection("users").updateOne(
      { email: normalizedEmail },
      {
        $set: {
          password: hashed,
          updatedAt: new Date(),
        },
        $unset: {
          forcePasswordReset: "",
          passwordResetToken: "",
          passwordResetTokenHash: "",
          passwordResetExpires: "",
        },
      }
    );

    return { ok: true, message: "Password updated successfully. Please sign in again." };
  } catch (err) {
    console.error("[forceResetPasswordAction]", err);
    return { ok: false, message: "Something went wrong. Please try again." };
  }
}
