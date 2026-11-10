import Link from "next/link";
import { redirect } from "next/navigation";
import { PaginationView } from "@/shared/components/data-display/pagination-view";

type Params = Record<string, string | undefined>;

function buildHref(basePath: string, params: Params, pageParam: string, page: number): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  search.set(pageParam, String(page));
  return `${basePath}?${search.toString()}`;
}

/**
 * Server-rendered pager. Preserves other query parameters so filters and searches survive paging.
 * Shows the record range and total; renders nothing when there are no records.
 */
export function Pagination({
  basePath,
  page,
  totalPages,
  total,
  pageSize,
  params,
  pageParam = "page",
}: {
  basePath: string;
  page: number;
  totalPages: number;
  total?: number;
  pageSize?: number;
  params: Params;
  /** Query key for this pager when a page holds more than one table. */
  pageParam?: string;
}) {
  const hrefFor = (target: number) => buildHref(basePath, params, pageParam, target);
  return (
    <PaginationView
      page={page}
      totalPages={totalPages}
      total={total}
      pageSize={pageSize}
      renderControl={(control, target, disabled, className, children) =>
        disabled ? (
          <span aria-disabled="true" className={className}>{children}</span>
        ) : (
          <Link href={hrefFor(target)} scroll={false} className={className}>{children}</Link>
        )
      }
    />
  );
}

/**
 * When a requested page is past the end (for example after filtering or deleting), send the user to the last valid page
 * instead of showing a misleading empty table.
 */
export function redirectIfPageOutOfRange(
  result: { items: unknown[]; total: number; page: number; totalPages: number },
  basePath: string,
  params: Params,
  pageParam = "page"
): void {
  if (result.items.length === 0 && result.total > 0 && result.page > result.totalPages) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
    search.set(pageParam, String(result.totalPages));
    redirect(`${basePath}?${search.toString()}`);
  }
}
