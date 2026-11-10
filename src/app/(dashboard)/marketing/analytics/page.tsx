import type { Metadata } from "next";
import Link from "next/link";
import { getPageWorkspace } from "@/server/tenancy/workspace";
import { listCampaigns } from "@/server/marketing/campaign.service";
import { PageHeader } from "@/shared/components/data-display/page-header";
import { Pagination } from "@/shared/components/data-display/pagination";
import { EmptyState } from "@/shared/components/data-display/empty-state";
import { StatusBadge } from "@/shared/components/data-display/status-badge";
import { CAMPAIGN_STATUS_LABELS, CAMPAIGN_STATUS_TONE, CHANNEL_LABELS } from "@/features/marketing/labels";
import { campaignListQuerySchema } from "@/features/marketing/schemas/marketing.schema";
import { getDashboard } from "@/server/marketing/analytics.service";
import { StatCard } from "@/features/marketing/components/stat-card";

export const metadata: Metadata = { title: "Analytics | AnOps ERP" };

function single(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getPageWorkspace();
  const raw = await searchParams;
  const query = campaignListQuerySchema.parse({ q: single(raw.q), status: single(raw.status) || undefined, page: single(raw.page) || undefined });
  const [campaigns, dashboard] = await Promise.all([listCampaigns(ctx, query), getDashboard(ctx)]);
  return (
    <div className="space-y-8">
      <PageHeader title="Analytics" description="Reports are calculated from stored delivery records. Each rate states its denominator." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Accepted by provider" value={dashboard.deliveries.accepted} />
        <StatCard label="Delivered" value={dashboard.deliveries.byStatus.delivered} />
        <StatCard label="Bounced" value={dashboard.deliveries.byStatus.bounced} />
        <StatCard label="Unsubscribes (links)" value={dashboard.unsubscribes} />
      </div>
      <form method="get" role="search" className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="space-y-1.5 sm:w-80">
          <label htmlFor="q" className="text-sm font-semibold">Find a campaign</label>
          <input id="q" name="q" defaultValue={query.q} maxLength={80} className="min-h-[44px] w-full rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3 text-sm" />
        </div>
        <button type="submit" className="min-h-[44px] rounded-[var(--radius-control)] border border-[var(--color-border-control)] px-4 text-sm font-semibold">Search</button>
      </form>
      {campaigns.items.length === 0 ? (
        <EmptyState title="No campaigns to report on" description="Reports appear once a campaign has been approved." actionHref="/marketing/campaigns" actionLabel="Go to campaigns" />
      ) : (
        <ul className="divide-y divide-[var(--color-border-subtle)] rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
          {campaigns.items.map((campaign) => (
            <li key={campaign.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <Link href={`/marketing/analytics/${campaign.id}`} className="break-words font-semibold underline-offset-2 hover:underline">{campaign.name}</Link>
                <p className="text-sm text-[var(--color-text-secondary)]">{CHANNEL_LABELS[campaign.channel]}{campaign.snapshot ? ` · ${campaign.snapshot.eligibleCount} eligible at approval` : " · not approved yet"}</p>
              </div>
              <StatusBadge label={CAMPAIGN_STATUS_LABELS[campaign.status]} tone={CAMPAIGN_STATUS_TONE[campaign.status]} />
            </li>
          ))}
        </ul>
      )}
      <Pagination basePath="/marketing/analytics" page={campaigns.page} totalPages={campaigns.totalPages} params={{ q: query.q || undefined }} />
    </div>
  );
}
