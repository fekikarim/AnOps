import type { Metadata } from "next";
import Link from "next/link";
import { getPageWorkspace } from "@/server/tenancy/workspace";
import { listWorkOrders } from "@/server/manufacturing/work-order.service";
import { workOrderListQuerySchema } from "@/features/manufacturing/schemas/manufacturing.schema";
import { PageHeader } from "@/shared/components/data-display/page-header";
import { EmptyState } from "@/shared/components/data-display/empty-state";
import { Pagination, redirectIfPageOutOfRange } from "@/shared/components/data-display/pagination";
import { StatusBadge } from "@/shared/components/data-display/status-badge";
import { Button, ButtonLink } from "@/shared/components/ui/button";
import { Filter, Plus } from "lucide-react";
import { Select } from "@/shared/components/ui/form-kit";
import { FilterBar, FilterField } from "@/shared/components/data-display/filter-bar";
import { WORK_ORDER_STATUS } from "@/features/manufacturing/labels";
import { formatDate, formatDecimalString } from "@/shared/lib/format";
import { safeLoad } from "@/shared/lib/safe-load";

export const metadata: Metadata = { title: "Work orders | AnOps ERP" };

export default async function WorkOrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getPageWorkspace();
  const raw = await searchParams;
  const parsed = workOrderListQuerySchema.safeParse({ status: raw.status, page: raw.page });
  const query = parsed.success ? parsed.data : workOrderListQuerySchema.parse({});
  const loaded = await safeLoad(() => listWorkOrders(ctx, query));
  const result = loaded.ok ? loaded.data : null;
  if (result) redirectIfPageOutOfRange(result, "/manufacturing/work-orders", { status: query.status === "all" ? undefined : query.status });
  const canCreate = ctx.permissions.has("manufacturing.work_order.manage");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Work orders"
        description="Production runs. Components are consumed and finished goods are added when an order is completed."
        actions={canCreate ? <ButtonLink href="/manufacturing/work-orders/new" variant="primary"><Plus aria-hidden className="size-4" />New work order</ButtonLink> : undefined}
      />
      <FilterBar aria-label="Filter work orders">
        <FilterField label="Status" htmlFor="status">
          <Select id="status" name="status" defaultValue={query.status}>
            <option value="all">All statuses</option>
            {Object.entries(WORK_ORDER_STATUS).map(([value, meta]) => (
              <option key={value} value={value}>{meta.label}</option>
            ))}
          </Select>
        </FilterField>
        <Button type="submit" variant="primary" className="w-full sm:w-auto"><Filter aria-hidden className="size-4" />Apply filters</Button>
      </FilterBar>

{!result ? (
        <EmptyState variant="error" title="Work orders could not be loaded" description="Something went wrong while loading this list. Your data is safe. Try again in a moment." actionHref="/manufacturing/work-orders" actionLabel="Try again" />
      ) : result.items.length === 0 ? (
query.status !== "all" ? (
          <EmptyState variant="filtered" title="No matching work orders" description="No work orders have this status. Choose another status to see more." actionHref="/manufacturing/work-orders" actionLabel="Clear filters" />
        ) : (
        <EmptyState
          title="No work orders"
          description="Create a work order from an active bill of materials to plan a production run."
          actionHref={canCreate ? "/manufacturing/work-orders/new" : undefined}
          actionLabel={canCreate ? "Create a work order" : undefined}
          actionIcon={Plus}
        />
        )
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
          <table className="w-full min-w-[640px] text-left text-sm">
            <caption className="sr-only">Work orders</caption>
            <thead className="text-xs uppercase tracking-wide text-[var(--color-text-secondary)]">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Order</th>
                <th scope="col" className="px-4 py-3 font-semibold">Product</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Planned</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Produced</th>
                <th scope="col" className="px-4 py-3 font-semibold">Planned start</th>
                <th scope="col" className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border-subtle)]">
              {result.items.map((wo) => (
                <tr key={wo.id} className="hover:bg-[var(--color-bg-subtle)]">
                  <td className="px-4 py-3 font-medium"><Link href={`/manufacturing/work-orders/${wo.id}`} className="underline-offset-2 hover:underline">{wo.orderNumber}</Link></td>
                  <td className="px-4 py-3">{wo.finishedSku}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatDecimalString(wo.plannedQuantity)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatDecimalString(wo.producedQuantity)}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-[var(--color-text-secondary)]">{formatDate(wo.plannedStart)}</td>
                  <td className="px-4 py-3"><StatusBadge label={WORK_ORDER_STATUS[wo.status].label} tone={WORK_ORDER_STATUS[wo.status].tone} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result && <Pagination basePath="/manufacturing/work-orders" page={result.page} totalPages={result.totalPages} total={result.total} pageSize={result.pageSize} params={{ status: query.status }} />}
    </div>
  );
}
