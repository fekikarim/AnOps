"use server";

import { auth, signIn, signOut } from "@/server/auth";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { registerUser } from "@/features/auth/actions/register.action";
import { requestPasswordReset } from "@/features/auth/actions/password-reset-request.action";
import { resetPassword } from "@/features/auth/actions/password-reset.action";

export type FormState = {
  error?: string;
  success?: string;
  warning?: string;
};

function emailFailureWarning(reason: "not_configured" | "error" | undefined, kind: "reset" | "verify"): string {
  if (reason === "not_configured") {
    return `We couldn't send the ${kind === "reset" ? "reset" : "verification"} email because email delivery is not configured on this server. In development, the link is printed in the server console.`;
  }
  return `We couldn't send the ${kind === "reset" ? "reset" : "verification"} email. Please check the server logs and try again.`;
}

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const rawCallback = (formData.get("callbackUrl") as string) || "/anops";
  // Only same-site paths: never redirect to another origin after sign-in.
  const callbackUrl = rawCallback.startsWith("/") && !rawCallback.startsWith("//") ? rawCallback : "/anops";

  try {
    await signIn("credentials", { email, password, redirectTo: callbackUrl });
    return {};
  } catch (error) {
    if (error instanceof AuthError) {
      const code = (error as AuthError & { code?: string }).code;
      if (code === "banned") redirect("/banned");
      if (code === "rate_limited") return { error: "Too many sign-in attempts. Please wait 15 minutes and try again." };
      if (code === "unverified") {
        redirect(`/unverified?email=${encodeURIComponent(email)}`);
      }
      return { error: "Invalid email or password." };
    }
    throw error;
  }
}

export async function logoutAction() {
  await signOut({ redirectTo: "/login" });
}

export async function registerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const result = await registerUser({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!result.ok) {
    return { error: result.message };
  }

  const params = new URLSearchParams();
  const email = String(formData.get("email") ?? "").toLowerCase().trim();
  if (email) params.set("email", email);
  if (!result.email?.delivered) {
    params.set("delivery", result.email?.reason ?? "error");
  }

  redirect(`/unverified?${params.toString()}`);
}

export async function forgotPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const result = await requestPasswordReset({ email: formData.get("email") });

  if (!result.ok) {
    return { error: result.message };
  }

  if (result.emailAttempted && !result.emailDelivered) {
    return { warning: emailFailureWarning(result.emailReason, "reset") };
  }

  return { success: result.message };
}

export async function resetPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const result = await resetPassword({
    token: formData.get("token"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!result.ok) {
    return { error: result.message };
  }

  redirect("/login?reset=success");
}

export async function requireAuth() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  return session;
}

export async function requireActive() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  /** Re-check live status from DB so bans/verification changes apply immediately
   *  even though the JWT was issued earlier. */
  const clientPromise = (await import("@/server/db/client")).default;
  const client = await clientPromise;
  const db = client.db();
  const user = await db.collection("users").findOne({ email: session.user.email });

  if (!user) redirect("/login");
  if (user.status === "banned") redirect("/banned");
  const provisional = !user.emailVerified && user.provisionalUntil instanceof Date && user.provisionalUntil > new Date();
  if (user.status === "unverified" || (!user.emailVerified && !provisional)) redirect("/unverified");

  return session;
}
