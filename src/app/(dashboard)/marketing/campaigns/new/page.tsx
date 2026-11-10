import type { Metadata } from "next";
import { getPageWorkspace } from "@/server/tenancy/workspace";
import { PageHeader } from "@/shared/components/data-display/page-header";
import { CampaignForm } from "@/features/marketing/components/campaign-form";
import { audienceOptions } from "@/server/marketing/audience.service";
import { templateOptions } from "@/server/marketing/template.service";
import { PERMISSIONS } from "@/server/security/permissions";
import { PermissionDenied } from "@/shared/components/data-display/permission-denied";
import { MARKETING_CHANNELS } from "@/features/marketing/types/constants";

export const metadata: Metadata = { title: "New campaign | AnOps ERP" };

export default async function NewCampaignPage() {
  const ctx = await getPageWorkspace();
  if (!ctx.permissions.has(PERMISSIONS.MARKETING_CAMPAIGN_MANAGE)) {
    return <PermissionDenied backHref="/marketing/campaigns" backLabel="Back to campaigns" />;
  }
  const [audiences, templateLists] = await Promise.all([
    audienceOptions(ctx),
    Promise.all(MARKETING_CHANNELS.map((channel) => templateOptions(ctx, channel).then((list) => list.map((item) => ({ ...item, channel }))))),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader title="New campaign" description="Create a draft. You can change it until it is submitted for approval." />
      <CampaignForm audiences={audiences} templates={templateLists.flat()} />
    </div>
  );
}
