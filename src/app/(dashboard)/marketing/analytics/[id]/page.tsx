import type { Metadata } from "next";
import Link from "next/link";
import { getPageWorkspace } from "@/server/tenancy/workspace";
import { getCampaignReport } from "@/server/marketing/analytics.service";
import { PageHeader } from "@/shared/components/data-display/page-header";
import { StatCard } from "@/features/marketing/components/stat-card";
import { CHANNEL_LABELS, EXCLUSION_LABELS, DELIVERY_STATUS_LABELS } from "@/features/marketing/labels";
import { DELIVERY_STATUSES, type DeliveryStatus } from "@/features/marketing/types/constants";
import { orNotFound } from "@/server/marketing/page-guard";

export const metadata: Metadata = { title: "Campaign report | AnOps ERP" };

function percent(value: number | null): string {
  return value === null ? "No data" : `${(value * 100).toFixed(1)}%`;
}

export default async function CampaignReportPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getPageWorkspace();
  const { id } = await params;
  const report = await orNotFound(() => getCampaignReport(ctx, id));
  const maxSent = Math.max(1, ...report.timeline.map((row) => row.sent));
  return (
    <div className="space-y-8">
      <PageHeader
        title={report.name}
        description={`${CHANNEL_LABELS[report.channel]} campaign report · ${report.status.replace("_", " ")}`}
        actions={<Link href={`/marketing/campaigns/${report.campaignId}`} className="inline-flex min-h-[44px] items-center rounded-[var(--radius-control)] border border-[var(--color-border-control)] px-4 text-sm">Open campaign</Link>}
      />

      {report.snapshot ? (
        <section aria-labelledby="recipients" className="space-y-3">
          <h2 id="recipients" className="text-base font-semibold">Recipients at approval</h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Matched" value={report.snapshot.matched} />
            <StatCard label="Eligible" value={report.snapshot.eligible} />
            <StatCard label="Suppressed" value={report.snapshot.suppressed} />
            <StatCard label="Accepted by provider" value={report.accepted} />
          </div>
          <ul className="flex flex-wrap gap-2 text-sm">
            {(Object.keys(EXCLUSION_LABELS) as (keyof typeof EXCLUSION_LABELS)[]).map((reason) => (
              <li key={reason} className="rounded-[var(--radius-pill)] border border-[var(--color-border-control)] px-3 py-1">
                {EXCLUSION_LABELS[reason]}: <span className="font-semibold tabular-nums">{report.snapshot?.exclusions[reason] ?? 0}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="text-sm text-[var(--color-text-secondary)]">This campaign has not been approved, so it has no recipient snapshot yet.</p>
      )}

      <section aria-labelledby="rates" className="space-y-3">
        <h2 id="rates" className="text-base font-semibold">Rates</h2>
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {([
            ["Delivery rate", report.rates.deliveryRate, report.definitions.deliveryRate, report.support.delivery],
            ["Bounce rate", report.rates.bounceRate, report.definitions.bounceRate, report.support.bounce],
            ["Complaint rate", report.rates.complaintRate, report.definitions.complaintRate, report.support.bounce],
            ["Failure rate", report.rates.failureRate, report.definitions.failureRate, true],
            ["Open rate (estimate)", report.rates.openRateEstimate, report.definitions.openRateEstimate, report.support.opens],
            ["Click rate", report.rates.clickRate, report.definitions.clickRate, report.support.clicks],
          ] as const).map(([label, value, definition, supported]) => (
            <div key={label} className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4">
              <dt className="text-xs font-medium uppercase tracking-[0.06em] text-[var(--color-text-secondary)]">{label}</dt>
              {supported ? (
                <>
                  <dd className="mt-2 text-2xl font-semibold tabular-nums">{percent(value)}</dd>
                  <dd className="mt-2 text-xs text-[var(--color-text-secondary)]">{definition}</dd>
                </>
              ) : (
                <>
                  <dd className="mt-2 text-base font-semibold text-[var(--color-text-secondary)]">Not reported by {CHANNEL_LABELS[report.channel]}</dd>
                  <dd className="mt-2 text-xs text-[var(--color-text-secondary)]">Shown as unavailable, not as zero.</dd>
                </>
              )}
            </div>
          ))}
        </dl>
        {report.channel === "telegram" && (
          <p className="text-sm text-[var(--color-text-secondary)]">
            Telegram tells AnOps when it accepts a message, not whether it was delivered or read, so only acceptance, failures,
            pending messages and opt-outs are measured. The delivery breakdown below counts messages Telegram accepted as Sent.
          </p>
        )}
        {report.channel !== "telegram" && report.openTracking === "not_reported" && (
          <p className="text-sm text-[var(--color-text-secondary)]">Open and click rates appear only when the sending provider reports those events. None are reported yet.</p>
        )}
        <p className="text-sm text-[var(--color-text-secondary)]">Unsubscribes through this campaign: <span className="font-semibold text-[var(--color-text-primary)]">{report.unsubscribes}</span></p>
      </section>

      <section aria-labelledby="breakdown" className="space-y-3">
        <h2 id="breakdown" className="text-base font-semibold">Delivery breakdown</h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {DELIVERY_STATUSES.map((status) => (
            <div key={status} className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] px-3 py-2">
              <dt className="text-sm text-[var(--color-text-secondary)]">{DELIVERY_STATUS_LABELS[status as DeliveryStatus]}</dt>
              <dd className="text-lg font-semibold tabular-nums">{report.deliveries[status as DeliveryStatus]}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="timeline" className="space-y-3">
        <h2 id="timeline" className="text-base font-semibold">Sends per day (last 30 days, UTC)</h2>
        {report.timeline.length === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)]">No messages have been sent yet.</p>
        ) : (
          <>
            <div className="flex items-end gap-1 overflow-x-auto rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4" role="img" aria-label={`Bar chart of messages sent per day: ${report.timeline.map((row) => `${row.day} ${row.sent}`).join(", ")}`}>
              {report.timeline.map((row) => (
                <div key={row.day} className="flex min-w-[24px] flex-col items-center gap-1">
                  <div className="w-5 rounded-t bg-[var(--color-action-primary)]" style={{ height: `${Math.max(4, (row.sent / maxSent) * 120)}px` }} />
                  <span className="text-[10px] text-[var(--color-text-secondary)]">{row.day.slice(8)}</span>
                </div>
              ))}
            </div>
            <table className="sr-only">
              <caption>Sends per day</caption>
              <thead><tr><th scope="col">Day</th><th scope="col">Sent</th></tr></thead>
              <tbody>{report.timeline.map((row) => <tr key={row.day}><td>{row.day}</td><td>{row.sent}</td></tr>)}</tbody>
            </table>
          </>
        )}
      </section>

      <section aria-labelledby="definitions" className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5">
        <h2 id="definitions" className="text-base font-semibold">Definitions</h2>
        <dl className="mt-3 space-y-2 text-sm">
          {Object.entries(report.definitions).map(([key, text]) => (
            <div key={key}><dt className="font-semibold">{key}</dt><dd className="text-[var(--color-text-secondary)]">{text}</dd></div>
          ))}
        </dl>
      </section>
    </div>
  );
}
