import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { cn } from "@/shared/lib/utils";

export const PAGER_BUTTON =
  "inline-flex size-10 items-center justify-center rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-bg-subtle)] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)]";
const PAGER_DISABLED = "pointer-events-none cursor-not-allowed opacity-50";

export type PagerControl = "first" | "previous" | "next" | "last";

const LABELS: Record<PagerControl, string> = { first: "First page", previous: "Previous page", next: "Next page", last: "Last page" };
const ICONS = { first: ChevronsLeft, previous: ChevronLeft, next: ChevronRight, last: ChevronsRight };

/** "Showing 26–50 of 112" text, or null when there are no records. */
export function rangeText(page: number, pageSize: number, total: number): string | null {
  if (total <= 0) return null;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);
  return `Showing ${start.toLocaleString("en-US")}–${end.toLocaleString("en-US")} of ${total.toLocaleString("en-US")}`;
}

/**
 * Presentational pager shared by the server (link) and client (button) variants.
 * `renderControl` supplies the interactive element so both variants look and behave the same.
 */
export function PaginationView({
  page,
  totalPages,
  pageSize,
  total,
  renderControl,
  className,
}: {
  page: number;
  totalPages: number;
  pageSize?: number;
  total?: number;
  renderControl: (control: PagerControl, target: number, disabled: boolean, className: string, children: React.ReactNode) => React.ReactNode;
  className?: string;
}) {
  if (total === 0) return null;
  const summary = total !== undefined && pageSize ? rangeText(page, pageSize, total) : null;
  if (!summary && totalPages <= 1) return null;
  const atStart = page <= 1;
  const atEnd = page >= totalPages;
  const targets: Record<PagerControl, number> = { first: 1, previous: page - 1, next: page + 1, last: totalPages };
  const disabled: Record<PagerControl, boolean> = { first: atStart, previous: atStart, next: atEnd, last: atEnd };
  const order: PagerControl[] = ["first", "previous", "next", "last"];
  const control = (c: PagerControl) => {
    const Icon = ICONS[c];
    return (
      <span key={c} className="contents">
        {renderControl(c, targets[c], disabled[c], cn(PAGER_BUTTON, disabled[c] && PAGER_DISABLED), (
          <>
            <Icon aria-hidden className="size-4" />
            <span className="sr-only">{LABELS[c]}</span>
          </>
        ))}
      </span>
    );
  };
  return (
    <nav aria-label="Pagination" className={cn("flex flex-col items-center gap-3 pt-2 text-sm sm:flex-row sm:justify-between", className)}>
      <p className="text-[var(--color-text-secondary)]" aria-live="polite">{summary}</p>
      {totalPages > 1 && (
        <div className="flex items-center gap-2">
          {control(order[0])}
          {control(order[1])}
          <span className="min-w-[96px] px-1 text-center font-medium text-[var(--color-text-primary)]" aria-current="page">
            Page {page} of {totalPages}
          </span>
          {control(order[2])}
          {control(order[3])}
        </div>
      )}
    </nav>
  );
}
