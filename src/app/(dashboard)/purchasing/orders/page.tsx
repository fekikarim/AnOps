import type { Metadata } from "next";
import Link from "next/link";
import { getPageWorkspace } from "@/server/tenancy/workspace";
import { listPurchaseOrders } from "@/server/purchasing/purchase-order.service";
import { purchaseOrderListQuerySchema } from "@/features/purchasing/schemas/purchasing.schema";
import { PageHeader } from "@/shared/components/data-display/page-header";
import { EmptyState } from "@/shared/components/data-display/empty-state";
import { Pagination, redirectIfPageOutOfRange } from "@/shared/components/data-display/pagination";
import { StatusBadge } from "@/shared/components/data-display/status-badge";
import { PO_STATUS } from "@/features/purchasing/labels";
import { ButtonLink, Button } from "@/shared/components/ui/button";
import { ExportExcelButton } from "@/shared/components/data-display/export-excel-button";
import { exportUrl } from "@/shared/lib/download";
import { formatDate, formatMoney } from "@/shared/lib/format";
import { Filter, Plus } from "lucide-react";
import { Select } from "@/shared/components/ui/form-kit";
import { FilterBar, FilterField, filterInputClass } from "@/shared/components/data-display/filter-bar";
import { safeLoad } from "@/shared/lib/safe-load";

export const metadata: Metadata = { title: "Purchase orders | AnOps ERP" };

export default async function PurchaseOrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getPageWorkspace();
  const raw = await searchParams;
  const parsed = purchaseOrderListQuerySchema.safeParse({
    status: typeof raw.status === "string" ? raw.status : undefined,
    q: typeof raw.q === "string" ? raw.q : undefined,
    page: typeof raw.page === "string" ? raw.page : undefined,
  });
  const query = parsed.success ? parsed.data : purchaseOrderListQuerySchema.parse({});
  const loaded = await safeLoad(() => listPurchaseOrders(ctx, query));
  const result = loaded.ok ? loaded.data : null;
  if (result) redirectIfPageOutOfRange(result, "/purchasing/orders", { q: query.q || undefined, status: query.status });
  const canCreate = ctx.permissions.has("purchasing.order.manage");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Purchase orders"
        description="Orders are approved first. Stock increases only when goods are received and the receipt is posted."
        actions={
          <>
            <ExportExcelButton href={exportUrl("purchase-orders", { q: query.q, status: query.status })} />
            {canCreate && <ButtonLink href="/purchasing/orders/new" variant="primary"><Plus aria-hidden className="size-4" />New order</ButtonLink>}
          </>
        }
      />
      <FilterBar role="search" aria-label="Filter purchase orders">
        <FilterField label="Order number" htmlFor="q" className="sm:w-64">
          <input id="q" name="q" defaultValue={query.q} maxLength={80} placeholder="e.g. PO-000001" className={filterInputClass} />
        </FilterField>
        <FilterField label="Status" htmlFor="status">
          <Select id="status" name="status" defaultValue={query.status}>
            <option value="all">All statuses</option>
            {Object.entries(PO_STATUS).map(([value, meta]) => (
              <option key={value} value={value}>{meta.label}</option>
            ))}
          </Select>
        </FilterField>
        <Button type="submit" variant="primary" className="w-full sm:w-auto"><Filter aria-hidden className="size-4" />Apply filters</Button>
      </FilterBar>

{!result ? (
        <EmptyState variant="error" title="Purchase orders could not be loaded" description="Something went wrong while loading this list. Your data is safe. Try again in a moment." actionHref="/purchasing/orders" actionLabel="Try again" />
      ) : result.items.length === 0 ? (
        query.q || query.status !== "all" ? (
          <EmptyState variant="filtered" title="No matching orders" description="Nothing matches the current search or status. Check the order number or choose a different status." actionHref="/purchasing/orders" actionLabel="Clear filters" />
        ) : (
          <EmptyState
            title="No purchase orders yet"
            description="Create a draft for a supplier, approve it, then record receipts as goods arrive."
            actionHref={canCreate ? "/purchasing/orders/new" : undefined}
            actionLabel={canCreate ? "Create an order" : undefined}
            actionIcon={Plus}
          />
        )
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
          <table className="w-full min-w-[680px] text-left text-sm">
            <caption className="sr-only">Purchase orders</caption>
            <thead className="text-xs uppercase tracking-wide text-[var(--color-text-secondary)]">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Order</th>
                <th scope="col" className="px-4 py-3 font-semibold">Supplier</th>
                <th scope="col" className="px-4 py-3 font-semibold">Created</th>
                <th scope="col" className="px-4 py-3 font-semibold">Expected</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Total</th>
                <th scope="col" className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border-subtle)]">
              {result.items.map((order) => (
                <tr key={order.id} className="hover:bg-[var(--color-bg-subtle)]">
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/purchasing/orders/${order.id}`} className="underline-offset-2 hover:underline">{order.orderNumber}</Link>
                  </td>
                  <td className="px-4 py-3">{order.supplierName}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-[var(--color-text-secondary)]">{formatDate(order.createdAt)}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-[var(--color-text-secondary)]">{formatDate(order.expectedDate)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatMoney(order.total, order.currencyCode)}</td>
                  <td className="px-4 py-3"><StatusBadge label={PO_STATUS[order.status].label} tone={PO_STATUS[order.status].tone} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result && <Pagination basePath="/purchasing/orders" page={result.page} totalPages={result.totalPages} total={result.total} pageSize={result.pageSize} params={{ q: query.q || undefined, status: query.status }} />}
    </div>
  );
}
