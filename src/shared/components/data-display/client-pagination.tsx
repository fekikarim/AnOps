"use client";

import { useEffect } from "react";
import { PaginationView } from "@/shared/components/data-display/pagination-view";

/** Pager for lists paginated in the browser. Same look as the server pager; adjusts itself if the page becomes invalid. */
export function ClientPagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  useEffect(() => {
    if (page > totalPages) onPageChange(totalPages);
  }, [page, totalPages, onPageChange]);
  return (
    <PaginationView
      page={Math.min(page, totalPages)}
      totalPages={totalPages}
      total={total}
      pageSize={pageSize}
      renderControl={(_control, target, disabled, className, children) => (
        <button type="button" disabled={disabled} aria-disabled={disabled} onClick={() => onPageChange(target)} className={className}>
          {children}
        </button>
      )}
    />
  );
}
