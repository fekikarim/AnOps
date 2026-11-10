import "server-only";
import { cookies } from "next/headers";
import { auth } from "@/server/auth";
import { getUserCompanies, getCompanyMember } from "@/server/services/company.service";
import type { Company, CompanyRole } from "@/features/company/types";

export const ACTIVE_COMPANY_COOKIE = "anops_active_company_id";

export type TenantContext = {
  company: Company;
  companyId: string;
  role: CompanyRole;
  isOwner: boolean;
  isAdmin: boolean;
};

/**
 * Resolves the currently active Company tenant for the authenticated session.
 * Uses the HTTP-only cookie `anops_active_company_id` and falls back to the user's primary company.
 */
export async function getActiveTenant(): Promise<TenantContext | null> {
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }

  const userId = session.user.id;
  const userCompanies = await getUserCompanies(userId);

  if (userCompanies.length === 0) {
    return null;
  }

  const cookieStore = await cookies();
  const selectedCompanyId = cookieStore.get(ACTIVE_COMPANY_COOKIE)?.value;

  let activeCompany = userCompanies[0];
  if (selectedCompanyId) {
    const found = userCompanies.find((c) => c.id === selectedCompanyId);
    if (found) {
      activeCompany = found;
    }
  }

  const member = await getCompanyMember(activeCompany.id, userId);
  const role: CompanyRole = member?.role || "employee";

  return {
    company: activeCompany,
    companyId: activeCompany.id,
    role,
    isOwner: role === "owner",
    isAdmin: role === "owner" || role === "admin" || (session.user.role as string) === "hr_admin",
  };
}

/**
 * Returns the active company ID or throws an error if no company is active.
 */
export async function requireActiveTenant(): Promise<TenantContext> {
  const tenant = await getActiveTenant();
  if (!tenant) {
    throw new Error("No active company found. Please create or join a company to proceed.");
  }
  return tenant;
}
