import type { Metadata } from "next";
import Link from "next/link";
import { getPageWorkspace } from "@/server/tenancy/workspace";
import { getCampaign, listCampaignEvents, listDeliveries } from "@/server/marketing/campaign.service";
import { audienceOptions } from "@/server/marketing/audience.service";
import { templateOptions } from "@/server/marketing/template.service";
import { PageHeader } from "@/shared/components/data-display/page-header";
import { Pagination } from "@/shared/components/data-display/pagination";
import { StatusBadge } from "@/shared/components/data-display/status-badge";
import { CampaignForm } from "@/features/marketing/components/campaign-form";
import { TelegramPreview } from "@/features/marketing/components/telegram-preview";
import { EmailPreview } from "@/features/marketing/components/email-preview";
import { CampaignActions } from "@/features/marketing/components/campaign-actions";
import { DeliveryFilter } from "@/features/marketing/components/delivery-filter";
import { CAMPAIGN_STATUS_LABELS, CAMPAIGN_STATUS_TONE, CHANNEL_LABELS, DELIVERY_STATUS_LABELS, DELIVERY_STATUS_TONE, EXCLUSION_LABELS, ERROR_CODE_MESSAGES } from "@/features/marketing/labels";
import { renderTemplate, type TemplateVariable } from "@/features/marketing/utils/template";
import { renderEmailHtml } from "@/features/marketing/utils/email-design";
import { companyName } from "@/server/marketing/common";
import { type DeliveryStatus } from "@/features/marketing/types/constants";
import { formatDateTime } from "@/shared/lib/format";
import { orNotFound } from "@/server/marketing/page-guard";
import { getConfiguredProviders } from "@/server/marketing/providers";
import { deliveryStatusFilter } from "@/features/marketing/utils/query";
import { buttonClass } from "@/shared/components/ui/button";

export const metadata: Metadata = { title: "Campaign | AnOps ERP" };

const SAMPLE_VALUES: Record<TemplateVariable, string> = {
  first_name: "Amina",
  last_name: "Ben Ali",
  email: "amina@example.test",
  company_name: "Your company",
  unsubscribe_url: "#unsubscribe",
};

export default async function CampaignDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getPageWorkspace();
  const { id } = await params;
  const raw = await searchParams;
  const statusParam = deliveryStatusFilter(Array.isArray(raw.status) ? raw.status[0] : raw.status);
  const page = Math.max(1, Math.min(1000, Number(Array.isArray(raw.page) ? raw.page[0] : raw.page) || 1));
  const [campaign, deliveries, events] = await orNotFound(() =>
    Promise.all([getCampaign(ctx, id), listDeliveries(ctx, id, { status: statusParam, page }), listCampaignEvents(ctx, id)])
  );
  const providers = getConfiguredProviders();
  const providerReady = Boolean(providers[campaign.channel]);
  const [audiences, templates] = campaign.actions.canEdit
    ? await Promise.all([audienceOptions(ctx), templateOptions(ctx, campaign.channel)])
    : [[], []];
  const templateList = templates.map((template) => ({ ...template, channel: campaign.channel }));
  const company = campaign.channel === "email" && !campaign.actions.canEdit ? await companyName(ctx.db, ctx.companyId) : "";
  const exclusions = campaign.snapshot?.exclusions ?? {};
  const job = campaign.job;
  const totalDeliveries = Object.values(campaign.deliverySummary).reduce((sum, count) => sum + count, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={campaign.name}
        description={`${CHANNEL_LABELS[campaign.channel]} campaign · Audience: ${campaign.audienceName}${campaign.templateName ? ` · From template: ${campaign.templateName}` : ""}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge label={CAMPAIGN_STATUS_LABELS[campaign.status]} tone={CAMPAIGN_STATUS_TONE[campaign.status]} />
            <Link href={`/marketing/analytics/${campaign.id}`} className={buttonClass("secondary")}>Report</Link>
          </div>
        }
      />

      {campaign.failureCode && (
        <p role="alert" className="rounded-[var(--radius-card)] border border-[var(--color-status-error)] bg-[var(--color-status-error-bg)] p-4 text-sm text-[var(--color-status-error)]">
          Sending stopped: {ERROR_CODE_MESSAGES[campaign.failureCode] ?? "a background job failed. Check the delivery list and try again."}
        </p>
      )}

      <CampaignActions campaign={campaign} providerReady={providerReady} channelLabel={CHANNEL_LABELS[campaign.channel]} />

      {campaign.actions.canEdit && (
        <section aria-labelledby="edit-draft" className="space-y-4 rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5">
          <h2 id="edit-draft" className="text-base font-semibold">Edit draft</h2>
          <CampaignForm campaign={campaign} audiences={audiences} templates={templateList} />
        </section>
      )}

      {!campaign.actions.canEdit && (
        <section aria-labelledby="content" className="space-y-3 rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5">
          <h2 id="content" className="text-base font-semibold">Content (locked)</h2>
          {campaign.subject && (
            <p className="break-words text-sm">
              <span className="font-semibold">Subject:</span> {renderTemplate(campaign.subject, SAMPLE_VALUES)}
            </p>
          )}
          {campaign.channel === "email" ? (
            <EmailPreview
              title="Campaign email preview"
              html={renderEmailHtml({
                design: campaign.design,
                subject: renderTemplate(campaign.subject, SAMPLE_VALUES),
                body: renderTemplate(campaign.body, SAMPLE_VALUES),
                companyName: company || SAMPLE_VALUES.company_name,
                unsubscribeUrl: SAMPLE_VALUES.unsubscribe_url,
                unsubscribeInBody: campaign.body.includes("{{unsubscribe_url}}"),
              })}
            />
          ) : campaign.channel === "telegram" ? (
            <TelegramPreview body={renderTemplate(campaign.body, SAMPLE_VALUES)} />
          ) : (
            <p className="whitespace-pre-wrap break-words text-sm">{renderTemplate(campaign.body, SAMPLE_VALUES)}</p>
          )}
        </section>
      )}

      <section aria-labelledby="recipients" className="space-y-4 rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5">
        <h2 id="recipients" className="text-base font-semibold">Recipients</h2>
        {campaign.snapshot ? (
          <>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div className="rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)] p-3"><dt className="text-[var(--color-text-secondary)]">Matched at approval</dt><dd className="text-xl font-semibold tabular-nums">{campaign.snapshot.matchedCount}</dd></div>
              <div className="rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)] p-3"><dt className="text-[var(--color-text-secondary)]">Eligible</dt><dd className="text-xl font-semibold tabular-nums">{campaign.snapshot.eligibleCount}</dd></div>
              <div className="rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)] p-3"><dt className="text-[var(--color-text-secondary)]">Suppressed</dt><dd className="text-xl font-semibold tabular-nums">{campaign.snapshot.suppressedCount}</dd></div>
              <div className="rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)] p-3"><dt className="text-[var(--color-text-secondary)]">Frozen</dt><dd className="text-sm font-medium">{formatDateTime(campaign.snapshot.takenAt)}</dd></div>
            </dl>
            {Object.values(exclusions).some((count) => count > 0) && (
              <ul className="flex flex-wrap gap-2 text-sm">
                {(Object.keys(EXCLUSION_LABELS) as (keyof typeof EXCLUSION_LABELS)[]).map((reason) => (
                  <li key={reason}><StatusBadge label={`${EXCLUSION_LABELS[reason]}: ${exclusions[reason] ?? 0}`} tone="warning" /></li>
                ))}
              </ul>
            )}
          </>
        ) : campaign.recipientEstimate ? (
          <div className="space-y-2 text-sm">
            <p>Estimate for this audience today: <span className="font-semibold">{campaign.recipientEstimate.eligibleCount}</span> eligible of {campaign.recipientEstimate.matchedCount} matching{campaign.recipientEstimate.truncated ? " (partial)" : ""}.</p>
            <p className="text-[var(--color-text-secondary)]">The final list is fixed when the campaign is approved, and each recipient is checked again before sending.</p>
          </div>
        ) : (
          <p className="text-sm text-[var(--color-text-secondary)]">Recipients are frozen at approval.</p>
        )}
      </section>

      <section aria-labelledby="deliveries" className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <h2 id="deliveries" className="text-base font-semibold">Deliveries</h2>
          <DeliveryFilter campaignId={id} current={statusParam} matching={deliveries.total} total={totalDeliveries} />
        </div>
        {deliveries.items.length === 0 ? (
          <p className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border-control)] p-6 text-sm text-[var(--color-text-secondary)]">No deliveries match.</p>
        ) : (
          <>
            <div className="hidden overflow-x-auto rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] md:block">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-[var(--color-bg-subtle)] text-xs uppercase tracking-[0.06em] text-[var(--color-text-secondary)]">
                  <tr>
                    <th scope="col" className="px-3 py-3">Contact</th>
                    <th scope="col" className="px-3 py-3">Destination</th>
                    <th scope="col" className="px-3 py-3">Status</th>
                    <th scope="col" className="px-3 py-3">Attempts</th>
                    <th scope="col" className="px-3 py-3">Timeline</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-subtle)]">
                  {deliveries.items.map((row) => (
                    <tr key={row.id}>
                      <td className="px-3 py-3"><Link href={`/marketing/contacts/${row.contactId}`} className="underline-offset-2 hover:underline">{row.contactName}</Link></td>
                      <td className="px-3 py-3 font-mono text-xs">{row.destinationMasked}</td>
                      <td className="px-3 py-3">
                        <StatusBadge label={DELIVERY_STATUS_LABELS[row.status as DeliveryStatus]} tone={DELIVERY_STATUS_TONE[row.status as DeliveryStatus]} />
                        {row.exclusionReason && <span className="ml-2 text-xs text-[var(--color-text-secondary)]">{EXCLUSION_LABELS[row.exclusionReason as keyof typeof EXCLUSION_LABELS] ?? row.exclusionReason}</span>}
                        {row.lastErrorCode && <span className="ml-2 text-xs text-[var(--color-text-secondary)]">{row.lastErrorCode}</span>}
                      </td>
                      <td className="px-3 py-3 tabular-nums">{row.attemptCount}</td>
                      <td className="px-3 py-3 text-xs text-[var(--color-text-secondary)]">
                        {[row.sentAt && `Sent ${formatDateTime(row.sentAt)}`, row.deliveredAt && `Delivered ${formatDateTime(row.deliveredAt)}`, row.bouncedAt && `Bounced ${formatDateTime(row.bouncedAt)}`, row.complainedAt && `Complained ${formatDateTime(row.complainedAt)}`, row.failedAt && `Failed ${formatDateTime(row.failedAt)}`].filter(Boolean).join(" · ") || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="space-y-3 md:hidden">
              {deliveries.items.map((row) => (
                <li key={row.id} className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4">
                  <div className="flex items-start justify-between gap-2">
                    <Link href={`/marketing/contacts/${row.contactId}`} className="break-words font-semibold underline-offset-2 hover:underline">{row.contactName}</Link>
                    <StatusBadge label={DELIVERY_STATUS_LABELS[row.status as DeliveryStatus]} tone={DELIVERY_STATUS_TONE[row.status as DeliveryStatus]} />
                  </div>
                  <p className="mt-1 font-mono text-xs text-[var(--color-text-secondary)]">{row.destinationMasked} · {row.attemptCount} attempt(s)</p>
                  {row.sentAt && <p className="mt-1 text-xs text-[var(--color-text-secondary)]">Sent {formatDateTime(row.sentAt)}</p>}
                </li>
              ))}
            </ul>
            <Pagination basePath={`/marketing/campaigns/${id}`} page={deliveries.page} totalPages={deliveries.totalPages} params={{ status: statusParam === "all" ? undefined : statusParam }} />
          </>
        )}
      </section>

      <section aria-labelledby="history" className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5">
          <h2 id="history" className="text-base font-semibold">Execution</h2>
          {job ? (
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-[var(--color-text-secondary)]">Job status</dt><dd className="font-medium">{job.status}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-[var(--color-text-secondary)]">Next run</dt><dd>{formatDateTime(job.runAt)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-[var(--color-text-secondary)]">Attempts</dt><dd>{job.attempts}</dd></div>
              {job.lastErrorCode && <div className="flex justify-between gap-3"><dt className="text-[var(--color-text-secondary)]">Last error</dt><dd>{job.lastErrorCode}</dd></div>}
            </dl>
          ) : (
            <p className="mt-3 text-sm text-[var(--color-text-secondary)]">Not scheduled yet.</p>
          )}
          <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
            Started: {formatDateTime(campaign.startedAt)} · Completed: {formatDateTime(campaign.completedAt)}
          </p>
        </div>
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5">
          <h2 className="text-base font-semibold">Recent events</h2>
          {events.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--color-text-secondary)]">No provider events yet. Events appear here after delivery reports arrive.</p>
          ) : (
            <ol className="mt-3 divide-y divide-[var(--color-border-subtle)] text-sm">
              {events.map((event) => (
                <li key={event.id} className="flex justify-between gap-3 py-2">
                  <span className="capitalize">{event.type}</span>
                  <span className="text-[var(--color-text-secondary)]">{formatDateTime(event.occurredAt)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>
    </div>
  );
}
