import "server-only";
import { randomUUID } from "crypto";
import { cache } from "react";
import { redirect } from "next/navigation";
import { ObjectId, type Db } from "mongodb";
import { auth } from "@/server/auth";
import clientPromise from "@/server/db/client";
import { ensureIndexes } from "@/server/db/indexes";
import { getActiveTenant } from "@/server/tenant/context";
import { permissionsForRole, workspaceRoleFor, type Permission, type WorkspaceRole } from "@/server/security/permissions";
import { AppError, isAppError } from "@/shared/lib/errors";

/**
 * Trusted, server-resolved tenant context for every company-scoped service.
 *
 * It is built only from the verified session, the live user record, and the membership in the
 * active company (cookie `anops_active_company_id`, resolved by server/tenant/context.ts).
 * Nothing in it is taken from a request body or URL. The company is the single tenant boundary.
 */
export type WorkspaceContext = {
  db: Db;
  requestId: string;
  userId: ObjectId;
  companyId: ObjectId;
  role: WorkspaceRole;
  currencyCode: string;
  permissions: ReadonlySet<Permission>;
};

/**
 * Resolves the active company for the caller.
 * Throws UNAUTHENTICATED when there is no valid session, and NO_COMPANY when the user has no company yet.
 */
export async function resolveWorkspace(requestId: string = randomUUID()): Promise<WorkspaceContext> {
  const session = await auth();
  const rawUserId = session?.user?.id;
  if (!rawUserId || !ObjectId.isValid(rawUserId)) {
    throw new AppError("UNAUTHENTICATED", "Please sign in to continue.");
  }

  const db = (await clientPromise).db();
  await ensureIndexes(db);

  const userId = new ObjectId(rawUserId);
  // Re-check the live account state: a ban or lock must take effect before the JWT expires.
  const user = await db
    .collection("users")
    .findOne({ _id: userId }, { projection: { status: 1, emailVerified: 1, provisionalUntil: 1 } });
  if (!user || user.status === "banned" || user.status === "unverified" || !isEmailTrusted(user)) {
    throw new AppError("UNAUTHENTICATED", "Please sign in to continue.");
  }

  const tenant = await getActiveTenant();
  if (!tenant) {
    throw new AppError("NO_COMPANY", "Create or join a company to continue.");
  }

  const role = workspaceRoleFor(tenant.role);
  return {
    db,
    requestId,
    userId,
    companyId: new ObjectId(tenant.companyId),
    role,
    currencyCode: tenant.company.currency,
    permissions: permissionsForRole(role),
  };
}

/**
 * A verified email, or a new organization owner inside the activation window: the spec lets the owner
 * use the workspace right away and confirm the email afterwards (see server/platform/activation.service.ts).
 */
export function isEmailTrusted(user: Record<string, unknown>, now = new Date()): boolean {
  if (user.emailVerified) return true;
  return user.provisionalUntil instanceof Date && user.provisionalUntil > now;
}

/**
 * Page-level variant: visitors go to login; users without a company go to onboarding.
 * Memoized for one render: the layout, nested layouts and the page all ask for it, and it is read-only, so they
 * share one set of identity and membership lookups instead of repeating them (actions use resolveWorkspace directly).
 */
export const getPageWorkspace = cache(async function getPageWorkspace(): Promise<WorkspaceContext> {
  try {
    return await resolveWorkspace();
  } catch (error) {
    if (isAppError(error) && error.code === "UNAUTHENTICATED") redirect("/login");
    if (isAppError(error) && error.code === "NO_COMPANY") redirect("/onboarding");
    throw error;
  }
});
