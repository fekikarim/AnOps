"use server";

import { z } from "zod";
import clientPromise from "@/server/db/client";

const verifySchema = z.object({
  token: z.string().trim().min(16, "Invalid verification token"),
});

export type VerifyEmailResult = {
  ok: boolean;
  message: string;
};

export async function verifyEmail(rawToken: string): Promise<VerifyEmailResult> {
  const parsed = verifySchema.safeParse({ token: rawToken });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid verification token" };
  }
  const token = parsed.data.token;

  try {
    const client = await clientPromise;
    const db = client.db();
    const users = db.collection("users");

    const user = await users.findOne({
      verificationToken: token,
      verificationTokenExpires: { $gt: new Date() },
    });

    if (!user) {
      return { ok: false, message: "Invalid or expired verification token" };
    }

    await users.updateOne(
      { _id: user._id },
      {
        $set: {
          emailVerified: new Date(),
          status: "active",
          updatedAt: new Date(),
        },
        $unset: {
          verificationToken: "",
          verificationTokenExpires: "",
        },
      }
    );

    return { ok: true, message: "Email verified. You can now sign in." };
  } catch (error) {
    console.error("verifyEmail error", error);
    return { ok: false, message: "Something went wrong. Please try again." };
  }
}
