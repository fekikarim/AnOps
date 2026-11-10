import type { Metadata } from "next";
import { getPageWorkspace } from "@/server/tenancy/workspace";
import { listTags } from "@/server/marketing/tag.service";
import { PageHeader } from "@/shared/components/data-display/page-header";
import { AudienceBuilder } from "@/features/marketing/components/audience-builder";
import { PERMISSIONS } from "@/server/security/permissions";
import { PermissionDenied } from "@/shared/components/data-display/permission-denied";

export const metadata: Metadata = { title: "New audience | AnOps ERP" };

export default async function NewAudiencePage() {
  const ctx = await getPageWorkspace();
  if (!ctx.permissions.has(PERMISSIONS.MARKETING_AUDIENCE_MANAGE)) {
    return <PermissionDenied backHref="/marketing/audiences" backLabel="Back to audiences" />;
  }
  const tags = await listTags(ctx);
  return (
    <div className="space-y-6">
      <PageHeader title="New audience" description="Describe who should receive a campaign. Preview before saving." />
      <AudienceBuilder tags={tags} canManage />
    </div>
  );
}
