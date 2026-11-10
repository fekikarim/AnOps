import type { Metadata } from "next";
import Link from "next/link";
import { getPageWorkspace } from "@/server/tenancy/workspace";
import { listAudiences } from "@/server/marketing/audience.service";
import { PageHeader } from "@/shared/components/data-display/page-header";
import { Pagination } from "@/shared/components/data-display/pagination";
import { EmptyState } from "@/shared/components/data-display/empty-state";
import { StatusBadge } from "@/shared/components/data-display/status-badge";
import { audienceListQuerySchema } from "@/features/marketing/schemas/marketing.schema";
import { buttonClass, selectClass } from "@/shared/components/ui/button";
import { PERMISSIONS } from "@/server/security/permissions";
import { formatDate } from "@/shared/lib/format";

export const metadata: Metadata = { title: "Audiences | AnOps ERP" };

function single(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function AudiencesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getPageWorkspace();
  const raw = await searchParams;
  const query = audienceListQuerySchema.parse({ q: single(raw.q), active: single(raw.active) || undefined, page: single(raw.page) || undefined });
  const result = await listAudiences(ctx, query);
  const canManage = ctx.permissions.has(PERMISSIONS.MARKETING_AUDIENCE_MANAGE);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Audiences"
        description="Saved selection rules. Each campaign freezes its recipients when it is approved."
        actions={canManage ? <Link href="/marketing/audiences/new" className={buttonClass("primary")}>New audience</Link> : undefined}
      />
      <form method="get" role="search" className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <div className="space-y-1.5">
          <label htmlFor="q" className="text-sm font-semibold">Search by name</label>
          <input id="q" name="q" defaultValue={query.q} maxLength={80} className="min-h-[44px] w-full rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3 text-sm" />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="active" className="text-sm font-semibold">Status</label>
          <select id="active" name="active" defaultValue={query.active} className={selectClass}>
            <option value="all">All</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </div>
        <button type="submit" className={buttonClass("secondary")}>Filter</button>
      </form>

      {result.items.length === 0 ? (
        <EmptyState title="No audiences yet" description="An audience is a saved rule, for example 'customers with email consent tagged VIP'." actionHref={canManage ? "/marketing/audiences/new" : undefined} actionLabel={canManage ? "Create an audience" : undefined} />
      ) : (
        <ul className="divide-y divide-[var(--color-border-subtle)] rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
          {result.items.map((audience) => (
            <li key={audience.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <Link href={`/marketing/audiences/${audience.id}`} className="break-words font-semibold underline-offset-2 hover:underline">{audience.name}</Link>
                <p className="text-sm text-[var(--color-text-secondary)]">{audience.description || `${audience.rule ? `${audience.rule.conditions.length} condition(s) · ${audience.rule.match === "all" ? "all must match" : "any may match"}` : "No description"}`}</p>
                {!audience.rule && (
                  <p className="text-sm font-semibold text-[var(--color-status-warning)]">
                    Rule unavailable. Open this audience and save a rule before approving campaigns.
                  </p>
                )}
                <p className="text-xs text-[var(--color-text-secondary)]">Updated {formatDate(audience.updatedAt)}</p>
              </div>
              <StatusBadge
                label={!audience.rule ? "Needs rule" : audience.isActive ? "Active" : "Inactive"}
                tone={!audience.rule ? "warning" : audience.isActive ? "success" : "neutral"}
              />
            </li>
          ))}
        </ul>
      )}
      <Pagination basePath="/marketing/audiences" page={result.page} totalPages={result.totalPages} params={{ q: query.q || undefined, active: query.active === "all" ? undefined : query.active }} />
    </div>
  );
}
