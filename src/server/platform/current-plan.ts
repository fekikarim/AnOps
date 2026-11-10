import "server-only";
import { auth } from "@/server/auth";
import { resolveOrgAccess } from "@/server/platform/access";
import type { CurrentPlan } from "@/shared/components/marketing/pricing-plans";

/**
 * The plan of the signed-in person's active organization, for public pages such as pricing.
 * Never redirects and never throws: signed out, no organization or any lookup problem gives null (plain public view).
 */
export async function getCurrentPlan(): Promise<CurrentPlan | null> {
  try {
    if (!(await auth())?.user?.id) return null;
    const access = await resolveOrgAccess();
    const ent = access.entitlements;
    return {
      orgId: access.organization.id,
      orgName: access.organization.name,
      kind: ent.kind,
      plan: ent.plan,
      trialDaysLeft: ent.trialDaysLeft,
      accessEndsAt: ent.accessEndsAt?.toISOString() ?? null,
    };
  } catch {
    return null;
  }
}
