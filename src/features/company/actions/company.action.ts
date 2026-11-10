"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { auth } from "@/server/auth";
import clientPromise from "@/server/db/client";
import { createCompanySchema } from "@/features/company/schemas/company.schema";
import { createCompany, getUserCompanies } from "@/server/services/company.service";
import { recordAudit } from "@/server/audit/audit.service";
import { consumeSharedRateLimit } from "@/server/security/shared-rate-limit";
import { ACTIVE_COMPANY_COOKIE } from "@/server/tenant/context";
import { ObjectId } from "mongodb";
import { isAppError } from "@/shared/lib/errors";
import type { Company } from "@/features/company/types";

/**
 * Organization (company) actions. Organization management itself lives in the organization pages
 * (`/organization/[orgId]`); these two actions only create an organization and change the active one.
 */
export type CompanyActionResult<T = unknown> = {
  success?: boolean;
  data?: T;
  error?: string;
};

/** A person can own or belong to at most this many organizations created through this form (abuse guard). */
const MAX_ORGANIZATIONS_PER_USER = 20;

const cookieOptions = {
  path: "/",
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 60 * 60 * 24 * 365,
};

export async function createCompanyAction(rawData: unknown): Promise<CompanyActionResult<Company>> {
  try {
    const session = await auth();
    if (!session?.user?.id || !ObjectId.isValid(session.user.id)) {
      return { error: "You must be signed in to create an organization." };
    }

    const parsed = createCompanySchema.safeParse(rawData);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message || "Invalid organization details." };
    }

    const db = (await clientPromise).db();
    await consumeSharedRateLimit(db, `org-create:${session.user.id}`, 5, 60 * 60 * 1000, "You created several organizations in a short time. Try again later.");
    const existing = await getUserCompanies(session.user.id);
    if (existing.length >= MAX_ORGANIZATIONS_PER_USER) {
      return { error: `You can belong to at most ${MAX_ORGANIZATIONS_PER_USER} organizations.` };
    }

    // The new organization starts without a plan: its owner chooses one (or the free OneOps application) from /anops.
    const company = await createCompany(session.user.id, parsed.data);
    await recordAudit(db, {
      companyId: new ObjectId(company.id),
      actorUserId: new ObjectId(session.user.id),
      action: "organization.created",
      entityType: "organization",
      entityId: company.id,
      requestId: `create-${company.id}`,
    });

    (await cookies()).set(ACTIVE_COMPANY_COOKIE, company.id, cookieOptions);
    revalidatePath("/", "layout");
    return { success: true, data: company };
  } catch (err: unknown) {
    if (isAppError(err)) return { error: err.message };
    console.error(`[organization] create failed: ${err instanceof Error ? err.name : "unknown"}`);
    return { error: "Failed to create the organization." };
  }
}

/** Makes an organization the active workspace. Only organizations the person actively belongs to can be selected. */
export async function switchCompanyAction(companyId: string): Promise<CompanyActionResult<boolean>> {
  try {
    const session = await auth();
    if (!session?.user?.id) return { error: "You must be signed in." };

    const companies = await getUserCompanies(session.user.id);
    if (!companies.some((company) => company.id === companyId)) {
      return { error: "You are not a member of this organization." };
    }

    (await cookies()).set(ACTIVE_COMPANY_COOKIE, companyId, cookieOptions);
    revalidatePath("/", "layout");
    return { success: true, data: true };
  } catch {
    return { error: "Failed to switch organization." };
  }
}
