import { requireAiFeatures } from "@/server/platform/access";
import type { Metadata } from "next";
import { getPageWorkspace } from "@/server/tenancy/workspace";
import { getGeneration } from "@/server/marketing/ai/copy.service";
import { listCampaigns } from "@/server/marketing/campaign.service";
import { connectedAccountOptions } from "@/server/marketing/social/accounts.service";
import { PageHeader } from "@/shared/components/data-display/page-header";
import { AiCopyEditor } from "@/features/marketing/components/ai-copy-editor";
import { PERMISSIONS } from "@/server/security/permissions";
import { orNotFound } from "@/server/marketing/page-guard";

export const metadata: Metadata = { title: "Draft | AnOps ERP" };

export default async function AiCopyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAiFeatures("/marketing");
  const ctx = await getPageWorkspace();
  const { id } = await params;
  const canCampaign = ctx.permissions.has(PERMISSIONS.MARKETING_CAMPAIGN_MANAGE);
  const canSocial = ctx.permissions.has(PERMISSIONS.MARKETING_SOCIAL_MANAGE);
  const [generation, campaigns, accounts] = await orNotFound(() =>
    Promise.all([
      getGeneration(ctx, id),
      canCampaign ? listCampaigns(ctx, { q: "", status: "draft", channel: "all", page: 1 }) : Promise.resolve({ items: [] }),
      canSocial ? connectedAccountOptions(ctx) : Promise.resolve([]),
    ])
  );
  return (
    <div className="space-y-6">
      <PageHeader title="AI draft" description={`Brief: ${generation.targetAudience} · tone: ${generation.tone} · ${generation.language.toUpperCase()}`} />
      <details className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 text-sm">
        <summary className="cursor-pointer font-semibold">Brief</summary>
        <dl className="mt-3 space-y-2">
          <div><dt className="font-semibold">Product or service</dt><dd className="break-words">{generation.productDescription}</dd></div>
          <div><dt className="font-semibold">Goal</dt><dd>{generation.goal || "—"}</dd></div>
        </dl>
      </details>
      <AiCopyEditor
        generation={generation}
        campaigns={campaigns.items.map((item) => ({ id: item.id, name: item.name, channel: item.channel, version: item.version }))}
        socialAccounts={accounts}
        canGenerate={ctx.permissions.has(PERMISSIONS.MARKETING_AI_GENERATE)}
        canManageCampaigns={canCampaign}
        canManageSocial={canSocial}
      />
    </div>
  );
}
