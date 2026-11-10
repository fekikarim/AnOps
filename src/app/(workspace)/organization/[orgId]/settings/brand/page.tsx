import Link from "next/link";
import type { Metadata } from "next";
import { LogoStudio } from "@/features/platform/components/logo-studio";
import { getPageOrganization } from "@/server/platform/access";
import { getLogoStudioStatus } from "@/server/platform/organization-logo.service";

export const metadata: Metadata = { title: "Brand identity" };

export default async function BrandIdentityPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const access = await getPageOrganization(orgId);
  const studio = await getLogoStudioStatus(access);
  return (
    <div className="space-y-6">
      <div>
        <Link href={`/organization/${orgId}/settings`} className="inline-flex min-h-[44px] items-center text-sm font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
          <span aria-hidden="true">←&nbsp;</span> Settings
        </Link>
        <h2 className="mt-1 font-[family-name:var(--font-heading)] text-2xl font-semibold tracking-[-0.03em] text-[var(--color-text-primary)]">Brand identity</h2>
        <p className="mt-1 max-w-2xl text-sm text-[var(--color-text-secondary)]">Create your organization&apos;s logo with AI, adjust it, and apply it once you are happy. Only the owner can change the logo.</p>
      </div>
      <LogoStudio orgId={orgId} orgName={access.organization.name} studio={studio} />
    </div>
  );
}
