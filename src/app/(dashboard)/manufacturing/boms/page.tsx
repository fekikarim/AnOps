import type { Metadata } from "next";
import Link from "next/link";
import { getPageWorkspace } from "@/server/tenancy/workspace";
import { listBoms } from "@/server/manufacturing/bom.service";
import { bomListQuerySchema } from "@/features/manufacturing/schemas/manufacturing.schema";
import { PageHeader } from "@/shared/components/data-display/page-header";
import { EmptyState } from "@/shared/components/data-display/empty-state";
import { Pagination, redirectIfPageOutOfRange } from "@/shared/components/data-display/pagination";
import { StatusBadge } from "@/shared/components/data-display/status-badge";
import { ButtonLink } from "@/shared/components/ui/button";
import { Plus } from "lucide-react";
import { BOM_STATUS } from "@/features/manufacturing/labels";
import { formatDateTime } from "@/shared/lib/format";
import { safeLoad } from "@/shared/lib/safe-load";

export const metadata: Metadata = { title: "Bills of materials | AnOps ERP" };

export default async function BomsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getPageWorkspace();
  const raw = await searchParams;
  const parsed = bomListQuerySchema.safeParse({ status: raw.status, page: raw.page });
  const query = parsed.success ? parsed.data : bomListQuerySchema.parse({});
  const loaded = await safeLoad(() => listBoms(ctx, query));
  const result = loaded.ok ? loaded.data : null;
  if (result) redirectIfPageOutOfRange(result, "/manufacturing/boms", { status: query.status === "all" ? undefined : query.status });
  const canManage = ctx.permissions.has("manufacturing.bom.manage");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bills of materials"
        description="Recipes that list the components needed for one unit of a finished product. Each edit creates a new revision."
        actions={canManage ? <ButtonLink href="/manufacturing/boms/new" variant="primary"><Plus aria-hidden className="size-4" />New BOM</ButtonLink> : undefined}
      />
{!result ? (
        <EmptyState variant="error" title="Bills of materials could not be loaded" description="Something went wrong while loading this list. Your data is safe. Try again in a moment." actionHref="/manufacturing/boms" actionLabel="Try again" />
      ) : result.items.length === 0 ? (
query.status !== "all" ? (
          <EmptyState variant="filtered" title="No matching bills of materials" description="No bills of materials have this status. Choose another status to see more." actionHref="/manufacturing/boms" actionLabel="Clear filters" />
        ) : (
        <EmptyState
          title="No bills of materials"
          description="Define the components for a finished product, then activate the revision before creating work orders."
          actionHref={canManage ? "/manufacturing/boms/new" : undefined}
          actionLabel={canManage ? "Create a BOM" : undefined}
          actionIcon={Plus}
        />
        )
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
          <table className="w-full min-w-[620px] text-left text-sm">
            <caption className="sr-only">Bills of materials</caption>
            <thead className="text-xs uppercase tracking-wide text-[var(--color-text-secondary)]">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Finished product</th>
                <th scope="col" className="px-4 py-3 font-semibold">Revision</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Components</th>
                <th scope="col" className="px-4 py-3 font-semibold">Updated</th>
                <th scope="col" className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border-subtle)]">
              {result.items.map((bom) => (
                <tr key={bom.id} className="hover:bg-[var(--color-bg-subtle)]">
                  <td className="px-4 py-3">
                    <Link href={`/manufacturing/boms/${bom.id}`} className="font-medium underline-offset-2 hover:underline">{bom.finishedSku}</Link>
                    <span className="block text-xs text-[var(--color-text-secondary)]">{bom.finishedName}</span>
                  </td>
                  <td className="px-4 py-3 tabular-nums">{bom.revision}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{bom.componentCount}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-[var(--color-text-secondary)]">{formatDateTime(bom.updatedAt)}</td>
                  <td className="px-4 py-3"><StatusBadge label={BOM_STATUS[bom.status].label} tone={BOM_STATUS[bom.status].tone} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result && <Pagination basePath="/manufacturing/boms" page={result.page} totalPages={result.totalPages} total={result.total} pageSize={result.pageSize} params={{ status: query.status }} />}
    </div>
  );
}
