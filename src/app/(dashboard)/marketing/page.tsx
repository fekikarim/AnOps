import type { Metadata } from "next";
import Link from "next/link";
import { getPageWorkspace } from "@/server/tenancy/workspace";
import { getDashboard } from "@/server/marketing/analytics.service";
import { PageHeader } from "@/shared/components/data-display/page-header";
import { CAMPAIGN_STATUS_LABELS, CHANNEL_LABELS, DELIVERY_STATUS_LABELS, LIFECYCLE_LABELS } from "@/features/marketing/labels";
import { CAMPAIGN_STATUSES, DELIVERY_STATUSES, LIFECYCLE_STAGES, MARKETING_CHANNELS } from "@/features/marketing/types/constants";
import { StatCard } from "@/features/marketing/components/stat-card";
import { ButtonLink } from "@/shared/components/ui/button";
import { StatusBadge } from "@/shared/components/data-display/status-badge";

export const metadata: Metadata = { title: "Marketing | AnOps ERP" };

export default async function MarketingOverviewPage() {
  const ctx = await getPageWorkspace();
  const data = await getDashboard(ctx);
  return (
    <div className="space-y-8">
      <PageHeader
        title="Marketing"
        description="Contacts, consent, campaigns and social publishing for this company."
        actions={<ButtonLink href="/marketing/campaigns/new" variant="primary">New campaign</ButtonLink>}
      />

      {!data.integrations.email && !data.integrations.sms && !data.integrations.telegram && (
        <div role="status" className="rounded-[var(--radius-card)] border border-[var(--color-status-warning)] bg-[var(--color-status-warning-bg)] p-4 text-sm text-[var(--color-status-warning)]">
          No email, SMS or Telegram provider is connected. Campaigns can be drafted and approved, but they cannot be scheduled
          until a provider is configured. See <Link className="underline" href="/marketing/integrations">Integrations</Link>.
        </div>
      )}

      <section aria-labelledby="kpis" className="space-y-3">
        <h2 id="kpis" className="text-base font-semibold">Overview</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Contacts" value={data.contacts.total} hint={`${data.contacts.active} active`} href="/marketing/contacts" />
          <StatCard label="Active audiences" value={data.audiences.active} hint={`${data.audiences.total} total`} href="/marketing/audiences" />
          <StatCard label="Campaigns scheduled" value={data.campaigns.scheduled} hint={`${data.campaigns.completed} completed`} href="/marketing/campaigns" />
          <StatCard label="Queued deliveries" value={data.deliveries.queued} hint={`${data.deliveries.accepted} accepted by provider`} />
        </div>
      </section>

      <section aria-labelledby="channels" className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5">
        <h2 id="channels" className="mb-1 text-base font-semibold">Channels</h2>
        <p className="mb-4 text-sm text-[var(--color-text-secondary)]">
          Each channel has its own provider and its own consent. &ldquo;Accepted&rdquo; counts messages the provider took; it is not a read or delivery count.
        </p>
        <ul className="divide-y divide-[var(--color-border-subtle)]">
          {MARKETING_CHANNELS.map((channel) => (
            <li key={channel} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <span className="w-20 font-semibold">{CHANNEL_LABELS[channel]}</span>
                <StatusBadge label={data.integrations[channel] ? "Provider ready" : "No provider"} tone={data.integrations[channel] ? "success" : "neutral"} />
              </div>
              <p className="text-sm tabular-nums text-[var(--color-text-secondary)]">
                {data.channels[channel].campaigns} campaign{data.channels[channel].campaigns === 1 ? "" : "s"} · {data.channels[channel].accepted} accepted
                {channel === "telegram" && ` · ${data.telegram.connectedContacts} contact${data.telegram.connectedContacts === 1 ? "" : "s"} connected${data.telegram.blockedContacts > 0 ? `, ${data.telegram.blockedContacts} unreachable` : ""}`}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5">
          <h2 className="mb-3 text-base font-semibold">Contacts by lifecycle stage</h2>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {LIFECYCLE_STAGES.map((stage) => (
              <div key={stage} className="flex items-center justify-between rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)] px-3 py-2">
                <dt className="text-[var(--color-text-secondary)]">{LIFECYCLE_LABELS[stage]}</dt>
                <dd className="font-semibold tabular-nums">{data.contacts.byLifecycle[stage]}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5">
          <h2 className="mb-3 text-base font-semibold">Campaigns by status</h2>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {CAMPAIGN_STATUSES.map((status) => (
              <div key={status} className="flex items-center justify-between rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)] px-3 py-2">
                <dt className="text-[var(--color-text-secondary)]">{CAMPAIGN_STATUS_LABELS[status]}</dt>
                <dd className="font-semibold tabular-nums">{data.campaigns.byStatus[status]}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section aria-labelledby="deliveries" className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5">
        <h2 id="deliveries" className="mb-1 text-base font-semibold">Deliveries across campaigns</h2>
        <p className="mb-4 text-sm text-[var(--color-text-secondary)]">
          Counts come from stored delivery records. Suppressed recipients were excluded before sending.
        </p>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {DELIVERY_STATUSES.map((status) => (
            <div key={status} className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] px-3 py-2">
              <dt className="text-[var(--color-text-secondary)]">{DELIVERY_STATUS_LABELS[status]}</dt>
              <dd className="text-lg font-semibold tabular-nums">{data.deliveries.byStatus[status]}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-sm text-[var(--color-text-secondary)]">
          Unsubscribes recorded through opt-out links: <span className="font-semibold text-[var(--color-text-primary)]">{data.unsubscribes}</span>
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <StatCard label="Published posts (provider-confirmed)" value={data.socialPosts.publishedConfirmed} href="/marketing/social" />
        <StatCard label="AI drafts (last 30 days)" value={data.ai.generationsLast30Days} href="/marketing/ai" />
      </section>
    </div>
  );
}
