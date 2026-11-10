import type { Metadata } from "next";
import Link from "next/link";
import { getPageWorkspace } from "@/server/tenancy/workspace";
import { listProducts } from "@/server/inventory/catalog.service";
import { productListQuerySchema } from "@/features/inventory/schemas/inventory.schema";
import { PageHeader } from "@/shared/components/data-display/page-header";
import { EmptyState } from "@/shared/components/data-display/empty-state";
import { StatusBadge } from "@/shared/components/data-display/status-badge";
import { ButtonLink, Button } from "@/shared/components/ui/button";
import { Pagination, redirectIfPageOutOfRange } from "@/shared/components/data-display/pagination";
import { ExportExcelButton } from "@/shared/components/data-display/export-excel-button";
import { exportUrl } from "@/shared/lib/download";
import { formatDecimalString } from "@/shared/lib/format";
import { STOCK_STATUS_LABELS, STOCK_STATUS_TONES } from "@/features/inventory/labels";
import { UNIT_LABELS, type UnitOfMeasure } from "@/shared/domain/units";
import { Filter, Plus } from "lucide-react";
import { Select } from "@/shared/components/ui/form-kit";
import { FilterBar, FilterField, filterInputClass } from "@/shared/components/data-display/filter-bar";
import { safeLoad } from "@/shared/lib/safe-load";

export const metadata: Metadata = { title: "Products | AnOps ERP" };

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getPageWorkspace();
  const raw = await searchParams;
  const parsedQuery = productListQuerySchema.safeParse({
    q: typeof raw.q === "string" ? raw.q : undefined,
    status: typeof raw.status === "string" ? raw.status : undefined,
    page: typeof raw.page === "string" ? raw.page : undefined,
  });
  const query = parsedQuery.success ? parsedQuery.data : productListQuerySchema.parse({});
  const loaded = await safeLoad(() => listProducts(ctx, query));
  const result = loaded.ok ? loaded.data : null;
  if (result) redirectIfPageOutOfRange(result, "/inventory/products", { q: query.q || undefined, status: query.status });
  const canManage = ctx.permissions.has("inventory.product.manage");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Products"
        description={result ? `${result.total} product${result.total === 1 ? "" : "s"} · ${query.status === "all" ? "all statuses" : query.status}` : undefined}
        actions={
          <>
            <ExportExcelButton href={exportUrl("products", { q: query.q, status: query.status })} />
            {canManage && <ButtonLink href="/inventory/products/new" variant="primary"><Plus aria-hidden className="size-4" />New product</ButtonLink>}
          </>
        }
      />

      <FilterBar role="search" aria-label="Filter products">
        <FilterField label="Search by name or SKU" htmlFor="q" className="sm:w-72">
          <input id="q" name="q" defaultValue={query.q} placeholder="e.g. RM-STEEL or Steel sheet" maxLength={80} className={filterInputClass} />
        </FilterField>
        <FilterField label="Status" htmlFor="status">
          <Select id="status" name="status" defaultValue={query.status}>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="all">All</option>
          </Select>
        </FilterField>
        <Button type="submit" variant="primary" className="w-full sm:w-auto"><Filter aria-hidden className="size-4" />Apply filters</Button>
      </FilterBar>

      {!result ? (
        <EmptyState variant="error" title="Products could not be loaded" description="Something went wrong while loading this list. Your data is safe. Try again in a moment." actionHref="/inventory/products" actionLabel="Try again" />
      ) : result.items.length === 0 ? (
        query.q || query.status !== "active" ? (
          <EmptyState variant="filtered" title="No matching products" description="Nothing matches the current search or filters. Check the spelling or try a different status." actionHref="/inventory/products" actionLabel="Clear filters" />
        ) : (
          <EmptyState
            title="No products yet"
            description="Products are the items you buy, store, sell, or manufacture. Create your first one to start tracking stock."
            actionHref={canManage ? "/inventory/products/new" : undefined}
            actionLabel={canManage ? "Create a product" : undefined}
            actionIcon={Plus}
          />
        )
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
          <table className="w-full min-w-[720px] text-left text-sm">
            <caption className="sr-only">Products</caption>
            <thead className="text-xs uppercase tracking-wide text-[var(--color-text-secondary)]">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">SKU</th>
                <th scope="col" className="px-4 py-3 font-semibold">Name</th>
                <th scope="col" className="px-4 py-3 font-semibold">Category</th>
                <th scope="col" className="px-4 py-3 font-semibold">Unit</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">On hand</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Reorder at</th>
                <th scope="col" className="px-4 py-3 font-semibold">Stock</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border-subtle)]">
              {result.items.map((product) => (
                <tr key={product.id} className="hover:bg-[var(--color-bg-subtle)]">
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/inventory/products/${product.id}`} className="underline-offset-2 hover:underline">
                      {product.sku}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    {product.name}
                    {!product.isActive && <span className="ml-2 text-xs text-[var(--color-text-secondary)]">(archived)</span>}
                  </td>
                  <td className="px-4 py-3 text-[var(--color-text-secondary)]">{product.categoryName ?? "—"}</td>
                  <td className="px-4 py-3">{UNIT_LABELS[product.unitOfMeasure as UnitOfMeasure]}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatDecimalString(product.onHand)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatDecimalString(product.reorderPoint)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge label={STOCK_STATUS_LABELS[product.stockStatus]} tone={STOCK_STATUS_TONES[product.stockStatus]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {result && <Pagination
        basePath="/inventory/products"
        page={result.page}
        totalPages={result.totalPages}
        total={result.total}
        pageSize={result.pageSize}
        params={{ q: query.q || undefined, status: query.status }}
      />}
    </div>
  );
}
