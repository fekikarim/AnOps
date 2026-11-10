"use server";

import { randomUUID } from "crypto";
import { ObjectId } from "mongodb";
import { revalidatePath } from "next/cache";
import { auth } from "@/server/auth";
import clientPromise from "@/server/db/client";
import { toActionError } from "@/server/actions/run-action";
import { resolveOrganizationById, type OrgAccess } from "@/server/platform/access";
import { generateLogoCandidate, setOrganizationLogo } from "@/server/platform/organization-logo.service";
import { resendInvitation, revokeInvitation } from "@/server/platform/invitation.service";
import { changeMemberRole, leaveOrganization, removeMember, setMemberAppAccess, setMemberSuspended, updateOrganizationProfile } from "@/server/platform/organization.service";
import { changePassword, updateUserProfile } from "@/server/platform/profile.service";
import { setBillingPreferences } from "@/server/platform/subscription.service";
import { consumeSharedRateLimit } from "@/server/security/shared-rate-limit";
import { AppError, type ActionResult } from "@/shared/lib/errors";

async function runOrg<T>(orgId: string, name: string, op: (access: OrgAccess) => Promise<T>): Promise<ActionResult<T>> {
  const requestId = randomUUID();
  try {
    const access = await resolveOrganizationById(orgId, requestId);
    await consumeSharedRateLimit(access.ctx.db, `user:${access.ctx.userId.toHexString()}:${name}`, 60, 60_000);
    const data = await op(access);
    revalidatePath(`/organization/${orgId}`, "layout");
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: toActionError(error, requestId, name) };
  }
}

const inviterCtx = (a: OrgAccess) => ({ db: a.ctx.db, companyId: a.ctx.companyId, userId: a.ctx.userId, role: a.ctx.role, requestId: a.ctx.requestId });

export const updateOrganizationProfileAction = async (orgId: string, input: unknown) => runOrg(orgId, "org.profile", (a) => updateOrganizationProfile(a, input));
export const changeMemberRoleAction = async (orgId: string, memberId: string, role: string) => runOrg(orgId, "org.member.role", (a) => changeMemberRole(a, memberId, role));
export const setMemberSuspendedAction = async (orgId: string, memberId: string, suspended: boolean) => runOrg(orgId, "org.member.status", (a) => setMemberSuspended(a, memberId, suspended));
export const removeMemberAction = async (orgId: string, memberId: string) => runOrg(orgId, "org.member.remove", (a) => removeMember(a, memberId));
export const setMemberAppAccessAction = async (orgId: string, memberId: string, apps: string[] | null) => runOrg(orgId, "org.member.apps", (a) => setMemberAppAccess(a, memberId, apps));
export const resendInvitationAction = async (orgId: string, invitationId: string) => runOrg(orgId, "org.invite.resend", (a) => resendInvitation(inviterCtx(a), invitationId));
export const revokeInvitationAction = async (orgId: string, invitationId: string) => runOrg(orgId, "org.invite.revoke", (a) => revokeInvitation(inviterCtx(a), invitationId));
export const updateBillingContactAction = async (orgId: string, email: string) =>
  runOrg(orgId, "org.billing.contact", async (a) => {
    if (a.companyRole !== "owner") throw new AppError("FORBIDDEN", "Only the owner can change billing details.");
    const value = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value.length > 254) throw new AppError("VALIDATION_ERROR", "Enter a valid billing email.");
    await setBillingPreferences(a.ctx.db, a.ctx.companyId, { billingEmail: value });
  });

/** Brand identity. The owner check, plan check and limits live in the service; nothing here trusts the client. */
export const generateLogoAction = async (orgId: string, input: unknown) => runOrg(orgId, "org.logo.generate", (a) => generateLogoCandidate(a, input));
export const setOrganizationLogoAction = async (orgId: string, image: string) => runOrg(orgId, "org.logo.save", async (a) => {
  const result = await setOrganizationLogo(a, image);
  // The app launcher, Dock and switchers read the logo from the layout/home data.
  revalidatePath("/anops");
  revalidatePath("/organization");
  return result;
});

// ───────────────────────── Personal profile (no organization involved) ─────────────────────────

async function runSelf<T>(name: string, op: (db: Awaited<ReturnType<typeof getDb>>, userId: ObjectId, requestId: string) => Promise<T>): Promise<ActionResult<T>> {
  const requestId = randomUUID();
  try {
    const session = await auth();
    if (!session?.user?.id || !ObjectId.isValid(session.user.id)) throw new AppError("UNAUTHENTICATED", "Please sign in to continue.");
    const data = await op(await getDb(), new ObjectId(session.user.id), requestId);
    revalidatePath("/profile");
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: toActionError(error, requestId, name) };
  }
}

async function getDb() {
  return (await clientPromise).db();
}

export const updateProfileAction = async (input: unknown) => runSelf("profile.update", (db, userId) => updateUserProfile(db, userId, input));
export const changePasswordAction = async (input: unknown) => runSelf("profile.password", (db, userId, requestId) => changePassword(db, userId, input, requestId));

/** The caller leaves the organization in the URL. Returns where to go next (their other organizations / home). */
export const leaveOrganizationAction = async (orgId: string) => runOrg(orgId, "org.leave", async (a) => {
  await leaveOrganization(a);
});
