"use server";

import { randomUUID } from "crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import clientPromise from "@/server/db/client";
import { ensureIndexes } from "@/server/db/indexes";
import { signIn } from "@/server/auth";
import { registerOrganization } from "@/server/platform/registration.service";
import { isAppError } from "@/shared/lib/errors";

export type RegistrationState = {
  error?: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
};

async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim().slice(0, 64);
}

/**
 * Creates the owner, organization and Free/Trial subscription, then signs the owner in and opens
 * `/anops`. The selected applications are re-validated by the service; nothing from the client is trusted.
 */
export async function registerOrganizationAction(_prev: RegistrationState, formData: FormData): Promise<RegistrationState> {
  const raw = {
    firstName: String(formData.get("firstName") ?? ""),
    lastName: String(formData.get("lastName") ?? ""),
    organizationName: String(formData.get("organizationName") ?? ""),
    email: String(formData.get("email") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    currency: String(formData.get("currency") ?? ""),
    password: String(formData.get("password") ?? ""),
    confirmPassword: String(formData.get("confirmPassword") ?? ""),
    acceptTerms: formData.get("acceptTerms") === "on",
    apps: formData.getAll("apps").map(String),
  };
  // Echoed back to refill the form after an error; secrets are never echoed.
  const values = { firstName: raw.firstName, lastName: raw.lastName, organizationName: raw.organizationName, email: raw.email, phone: raw.phone, currency: raw.currency };

  try {
    const db = (await clientPromise).db();
    await ensureIndexes(db);
    await registerOrganization(db, raw, { ip: await clientIp(), requestId: randomUUID() });
  } catch (error) {
    if (isAppError(error)) return { error: error.message, fieldErrors: error.details, values };
    console.error(`[platform] registration failed: ${error instanceof Error ? error.name : "unknown"}`);
    return { error: "We could not create your workspace. Please try again.", values };
  }

  try {
    await signIn("credentials", { email: raw.email.trim().toLowerCase(), password: raw.password, redirectTo: "/anops?welcome=1" });
  } catch (error) {
    if (error instanceof AuthError) redirect("/login?callbackUrl=/anops&registered=1");
    throw error; // NEXT_REDIRECT
  }
  return {};
}
