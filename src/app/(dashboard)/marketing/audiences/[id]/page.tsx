import type { Metadata } from "next";
import { getPageWorkspace } from "@/server/tenancy/workspace";
import { getAudience } from "@/server/marketing/audience.service";
import { listTags } from "@/server/marketing/tag.service";
import { PageHeader } from "@/shared/components/data-display/page-header";
import { AudienceBuilder } from "@/features/marketing/components/audience-builder";
import { PERMISSIONS } from "@/server/security/permissions";
import { orNotFound } from "@/server/marketing/page-guard";

export const metadata: Metadata = { title: "Audience | AnOps ERP" };

export default async function AudienceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getPageWorkspace();
  const { id } = await params;
  const [audience, tags] = await orNotFound(() => Promise.all([getAudience(ctx, id), listTags(ctx)]));
  return (
    <div className="space-y-6">
      <PageHeader title={audience.name} description="Edit the rule. Changes apply to future previews and approvals, never to campaigns already approved." />
      <AudienceBuilder audience={audience} tags={tags} canManage={ctx.permissions.has(PERMISSIONS.MARKETING_AUDIENCE_MANAGE)} />
    </div>
  );
}
