import type { Metadata } from "next";
import Link from "next/link";
import { getPageWorkspace } from "@/server/tenancy/workspace";
import { listTemplates } from "@/server/marketing/template.service";
import { PageHeader } from "@/shared/components/data-display/page-header";
import { Pagination } from "@/shared/components/data-display/pagination";
import { EmptyState } from "@/shared/components/data-display/empty-state";
import { TemplateList } from "@/features/marketing/components/template-list";
import { templateListQuerySchema } from "@/features/marketing/schemas/marketing.schema";
import { buttonClass, selectClass } from "@/shared/components/ui/button";
import { CHANNEL_LABELS } from "@/features/marketing/labels";
import { MARKETING_CHANNELS } from "@/features/marketing/types/constants";
import { PERMISSIONS } from "@/server/security/permissions";

export const metadata: Metadata = { title: "Templates | AnOps ERP" };

function single(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function TemplatesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getPageWorkspace();
  const raw = await searchParams;
  const query = templateListQuerySchema.parse({ q: single(raw.q), channel: single(raw.channel) || undefined, page: single(raw.page) || undefined });
  const result = await listTemplates(ctx, query);
  const canManage = ctx.permissions.has(PERMISSIONS.MARKETING_TEMPLATE_MANAGE);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Templates"
        description="Reusable email and SMS text. A campaign copies a template when it is chosen, so later edits never change a sent message."
        actions={canManage ? <Link href="/marketing/templates/new" className={buttonClass("primary")}>New template</Link> : undefined}
      />
      <form method="get" role="search" className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <div className="space-y-1.5">
          <label htmlFor="q" className="text-sm font-semibold">Search by name</label>
          <input id="q" name="q" defaultValue={query.q} maxLength={80} className="min-h-[44px] w-full rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3 text-sm" />
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
        <EmptyState title="No templates yet" description="Write a message once and reuse it in many campaigns." actionHref={canManage ? "/marketing/templates/new" : undefined} actionLabel={canManage ? "Create a template" : undefined} />
      ) : (
        <TemplateList templates={result.items} canManage={canManage} />
      )}
      <Pagination basePath="/marketing/templates" page={result.page} totalPages={result.totalPages} params={{ q: query.q || undefined, channel: query.channel === "all" ? undefined : query.channel }} />
    </div>
  );
}
