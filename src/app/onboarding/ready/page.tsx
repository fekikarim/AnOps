import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OnboardingFlow } from "@/features/platform/components/onboarding-flow";
import { PlatformShell } from "@/features/platform/components/platform-shell";
import { getPageOrgAccess } from "@/server/platform/access";

export const metadata: Metadata = { title: "Your organization is ready" };

export default async function OnboardingReadyPage() {
  const access = await getPageOrgAccess();
  if (access.organization.activationStatus === "pending") redirect("/anops");
  return (
    <PlatformShell wide>
      <OnboardingFlow organizationName={access.organization.name} apps={access.apps} isOwner={access.companyRole === "owner"} />
    </PlatformShell>
  );
}
