"use server";

import bcrypt from "bcryptjs";
import clientPromise from "@/server/db/client";
import { hashResetToken } from "@/server/auth/reset-token";
import { resetPasswordSchema } from "@/features/auth/schemas/auth.schema";

export type ResetPasswordResult = {
  ok: boolean;
  message: string;
};

export async function resetPassword(data: unknown): Promise<ResetPasswordResult> {
  const parsed = resetPasswordSchema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message || "Invalid data" };
  }

  const { token, password } = parsed.data;

  try {
    const client = await clientPromise;
    const db = client.db();
    const users = db.collection("users");

    // Look up by hash and consume in the same atomic step: a token works once, even if two requests race.
    const user = await users.findOneAndUpdate(
      { passwordResetTokenHash: hashResetToken(token), passwordResetExpires: { $gt: new Date() } },
      { $unset: { passwordResetTokenHash: "", passwordResetToken: "", passwordResetExpires: "" } },
      { returnDocument: "before", projection: { _id: 1 } }
    );

    if (!user) {
      return { ok: false, message: "Invalid or expired reset token" };
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    await users.updateOne(
      { _id: user._id },
      {
        $set: {
          password: hashedPassword,
          updatedAt: new Date(),
        },
        // Any other reset link still outstanding for this account dies with the password change.
        $unset: { passwordResetTokenHash: "", passwordResetToken: "", passwordResetExpires: "", forcePasswordReset: "" },
      }
    );

    return { ok: true, message: "Password updated. You can now sign in." };
  } catch (error) {
    console.error("resetPassword error", error);
    return { ok: false, message: "Something went wrong. Please try again." };
  }
}
