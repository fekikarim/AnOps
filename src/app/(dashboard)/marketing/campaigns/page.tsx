import type { Metadata } from "next";
import Link from "next/link";
import { getPageWorkspace } from "@/server/tenancy/workspace";
import { listCampaigns } from "@/server/marketing/campaign.service";
import { PageHeader } from "@/shared/components/data-display/page-header";
import { Pagination } from "@/shared/components/data-display/pagination";
import { EmptyState } from "@/shared/components/data-display/empty-state";
import { StatusBadge } from "@/shared/components/data-display/status-badge";
import { campaignListQuerySchema } from "@/features/marketing/schemas/marketing.schema";
import { buttonClass, selectClass } from "@/shared/components/ui/button";
import { CAMPAIGN_STATUS_LABELS, CAMPAIGN_STATUS_TONE, CHANNEL_LABELS } from "@/features/marketing/labels";
import { CAMPAIGN_STATUSES, MARKETING_CHANNELS } from "@/features/marketing/types/constants";
import { PERMISSIONS } from "@/server/security/permissions";
import { formatDateTime } from "@/shared/lib/format";

export const metadata: Metadata = { title: "Campaigns | AnOps ERP" };

function single(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getPageWorkspace();
  const raw = await searchParams;
  const query = campaignListQuerySchema.parse({
    q: single(raw.q),
    status: single(raw.status) || undefined,
    channel: single(raw.channel) || undefined,
    page: single(raw.page) || undefined,
  });
  const result = await listCampaigns(ctx, query);
  const canManage = ctx.permissions.has(PERMISSIONS.MARKETING_CAMPAIGN_MANAGE);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Campaigns"
        description="Drafts go through approval. Approval freezes the recipients; sending checks consent again for every recipient."
        actions={canManage ? <Link href="/marketing/campaigns/new" className={buttonClass("primary")}>New campaign</Link> : undefined}
      />
      <form method="get" role="search" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_auto_auto_auto] xl:items-end">
        <div className="space-y-1.5">
          <label htmlFor="q" className="text-sm font-semibold">Search by name</label>
          <input id="q" name="q" defaultValue={query.q} maxLength={80} className="min-h-[44px] w-full rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3 text-sm" />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="status" className="text-sm font-semibold">Status</label>
          <select id="status" name="status" defaultValue={query.status} className={selectClass}>
            <option value="all">All statuses</option>
            {CAMPAIGN_STATUSES.map((status) => <option key={status} value={status}>{CAMPAIGN_STATUS_LABELS[status]}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="channel" className="text-sm font-semibold">Channel</label>
          <select id="channel" name="channel" defaultValue={query.channel} className={selectClass}>
            <option value="all">All channels</option>
            {MARKETING_CHANNELS.map((item) => <option key={item} value={item}>{CHANNEL_LABELS[item]}</option>)}
          </select>
        </div>
        <button type="submit" className={buttonClass("secondary")}>Filter</button>
      </form>

      {result.items.length === 0 ? (
        <EmptyState title="No campaigns yet" description="Create a draft, choose an audience and a template, then submit it for approval." actionHref={canManage ? "/marketing/campaigns/new" : undefined} actionLabel={canManage ? "Create a campaign" : undefined} />
      ) : (
        <ul className="divide-y divide-[var(--color-border-subtle)] rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
          {result.items.map((campaign) => (
            <li key={campaign.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <Link href={`/marketing/campaigns/${campaign.id}`} className="break-words font-semibold underline-offset-2 hover:underline">{campaign.name}</Link>
                <p className="break-words text-sm text-[var(--color-text-secondary)]">
                  {CHANNEL_LABELS[campaign.channel]} · Audience: {campaign.audienceName}
                  {campaign.snapshot ? ` · ${campaign.snapshot.eligibleCount} eligible` : ""}
                </p>
                <p className="text-xs text-[var(--color-text-secondary)]">
                  {campaign.scheduledAt ? `Scheduled ${formatDateTime(campaign.scheduledAt)}` : `Created ${formatDateTime(campaign.createdAt)}`}
                </p>
              </div>
              <StatusBadge label={CAMPAIGN_STATUS_LABELS[campaign.status]} tone={CAMPAIGN_STATUS_TONE[campaign.status]} />
            </li>
          ))}
        </ul>
      )}
      <Pagination basePath="/marketing/campaigns" page={result.page} totalPages={result.totalPages} params={{ q: query.q || undefined, status: query.status === "all" ? undefined : query.status, channel: query.channel === "all" ? undefined : query.channel }} />
    </div>
  );
}
