import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AnopsHome, type HomeData } from "@/features/platform/components/anops-home";
import { getPageOrgAccess } from "@/server/platform/access";
import { getActivationStatus } from "@/server/platform/activation.service";
import { getSubscriptionDoc, toState } from "@/server/platform/subscription.service";
import { getUserCompanies } from "@/server/services/company.service";
import { isApplicationId } from "@/shared/domain/applications";
import { freeFallbackChoices } from "@/shared/domain/plans";
import { organizationCompletion } from "@/shared/domain/profile";

export const metadata: Metadata = { title: "AnOps", description: "Your AnOps workspace." };

const initials = (text: string) =>
  text
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "A";

export default async function AnopsPage({ searchParams }: { searchParams: Promise<{ welcome?: string; locked?: string; plans?: string }> }) {
  const params = await searchParams;
  const access = await getPageOrgAccess();
  const { db, userId, companyId } = access.ctx;
  // "Compare plans" links from inside applications land on the billing page of the active organization.
  if (params.plans === "1") redirect(`/organization/${access.organization.id}/billing`);

  const [user, company, organizations, activation, sub] = await Promise.all([
    db.collection("users").findOne({ _id: userId }, { projection: { name: 1, firstName: 1, lastName: 1, email: 1 } }),
    db.collection("companies").findOne({ _id: companyId }),
    getUserCompanies(userId.toHexString()),
    access.organization.activationStatus === "pending" ? getActivationStatus(db, { userId, companyId }) : Promise.resolve(null),
    getSubscriptionDoc(db, companyId),
  ]);

  const name = String(user?.name ?? user?.email ?? "there");
  const firstName = String(user?.firstName ?? name.split(" ")[0]);
  const isOwner = access.companyRole === "owner";

  const data: HomeData = {
    user: { firstName, name, email: String(user?.email ?? ""), initials: initials(name) },
    organization: { id: access.organization.id, name: access.organization.name, logoUrl: access.organization.logoUrl, initials: initials(access.organization.name), role: access.companyRole },
    organizations: organizations.map((org) => ({ id: org.id, name: org.name })),
    access: {
      kind: access.entitlements.kind,
      plan: access.entitlements.plan,
      trialDaysLeft: access.entitlements.trialDaysLeft,
      accessEndsAt: access.entitlements.accessEndsAt?.toISOString() ?? null,
      needsPlanSelection: access.entitlements.needsPlanSelection,
      aiFeatures: access.entitlements.aiFeatures,
    },
    allowedApps: access.apps,
    orgApps: access.entitlements.appIds,
    fallbackChoices: isOwner ? freeFallbackChoices(toState(sub)) : [],
    permissions: [...access.ctx.permissions],
    activation: activation ? { pending: activation.pending, email: activation.email, deadline: activation.deadline, resendAvailableAt: activation.resendAvailableAt } : null,
    completion: company ? organizationCompletion(company, access.organization.id) : null,
    welcome: params.welcome === "1",
    lockedApp: isApplicationId(params.locked) ? params.locked : null,
    billingCurrency: sub?.billingCurrency ?? "eur",
  };

  return <AnopsHome data={data} />;
}
