"use server";

import { randomUUID } from "crypto";
import { ObjectId } from "mongodb";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { auth, signIn } from "@/server/auth";
import clientPromise from "@/server/db/client";
import { ensureIndexes } from "@/server/db/indexes";
import { activateOrganization } from "@/server/platform/activation.service";
import { acceptInvitation, inviteMembers, type InviteOutcome } from "@/server/platform/invitation.service";
import { resolveOrgAccess } from "@/server/platform/access";
import { toActionError } from "@/server/actions/run-action";
import { ACTIVE_COMPANY_COOKIE } from "@/server/tenant/context";
import { consumeSharedRateLimit } from "@/server/security/shared-rate-limit";
import { isAppError, type ActionResult } from "@/shared/lib/errors";

async function db() {
  const database = (await clientPromise).db();
  await ensureIndexes(database);
  return database;
}

async function setActiveCompany(companyId: ObjectId) {
  (await cookies()).set(ACTIVE_COMPANY_COOKIE, companyId.toHexString(), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
}

export type ActivationFormState = { error?: string };

/** POST-only activation (a link preview or mail scanner opening the URL cannot consume the token). */
export async function activateOrganizationAction(_prev: ActivationFormState, formData: FormData): Promise<ActivationFormState> {
  const requestId = randomUUID();
  let next = "/onboarding/ready";
  try {
    const database = await db();
    await consumeSharedRateLimit(database, `activate:${String(formData.get("token") ?? "").slice(0, 12)}`, 10, 10 * 60 * 1000);
    const result = await activateOrganization(database, formData.get("token"), requestId);
    const session = await auth();
    if (session?.user?.id === result.userId.toHexString()) await setActiveCompany(result.companyId);
    else next = "/login?callbackUrl=/onboarding/ready&activated=1";
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    console.error(`[platform] activation failed: ${error instanceof Error ? error.name : "unknown"}`);
    return { error: "We could not activate your organization. Please try again." };
  }
  redirect(next);
}

export async function sendInvitationsAction(invitations: { email: string; role: string }[]): Promise<ActionResult<InviteOutcome[]>> {
  const requestId = randomUUID();
  try {
    const access = await resolveOrgAccess(requestId);
    const outcomes = await inviteMembers({ db: access.ctx.db, companyId: access.ctx.companyId, userId: access.ctx.userId, role: access.ctx.role, requestId }, { invitations });
    return { ok: true, data: outcomes };
  } catch (error) {
    return { ok: false, error: toActionError(error, requestId, "platform.invite") };
  }
}

export type AcceptState = { error?: string; fieldErrors?: Record<string, string> };

export async function acceptInvitationAction(_prev: AcceptState, formData: FormData): Promise<AcceptState> {
  const requestId = randomUUID();
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  let email: string | null = null;
  let created = false;
  try {
    const database = await db();
    const session = await auth();
    const signedIn = session?.user?.id && ObjectId.isValid(session.user.id) ? new ObjectId(session.user.id) : null;
    const result = await acceptInvitation(database, {
      token,
      signedInUserId: signedIn,
      newAccount: { firstName: formData.get("firstName"), lastName: formData.get("lastName"), password, confirmPassword: formData.get("confirmPassword") },
      requestId,
    });
    created = result.createdAccount;
    if (created) {
      const user = await database.collection("users").findOne({ _id: result.userId }, { projection: { email: 1 } });
      email = String(user?.email ?? "");
    }
    await setActiveCompany(result.companyId);
  } catch (error) {
    if (isAppError(error)) return { error: error.message, fieldErrors: error.details };
    console.error(`[platform] invitation accept failed: ${error instanceof Error ? error.name : "unknown"}`);
    return { error: "We could not accept this invitation. Please try again." };
  }

  if (created && email) {
    try {
      await signIn("credentials", { email, password, redirectTo: "/anops?welcome=1" });
    } catch (error) {
      if (error instanceof AuthError) redirect("/login?callbackUrl=/anops");
      throw error;
    }
  }
  redirect("/anops");
}
