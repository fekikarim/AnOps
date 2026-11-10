"use client";

import { useEffect } from "react";

/**
 * Dashboard error boundary. Users never see internal error text: the raw message is logged in the browser
 * console for support, and the page offers a retry and a way back.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[dashboard] unexpected error", error.digest ?? error.name);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div role="alert" className="max-w-md space-y-4 text-center">
        <h1 className="text-2xl font-bold tracking-[-0.03em] text-[var(--color-text-primary)]">This page hit a problem</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Nothing you entered has been lost in this view. Try again, or return to the dashboard. If it keeps happening, share the reference below with support.
        </p>
        {error.digest && (
          <p className="font-mono text-xs text-[var(--color-text-secondary)]">Reference: {error.digest.slice(0, 12)}</p>
        )}
        <div className="flex flex-col justify-center gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => reset()}
            className="min-h-[44px] rounded-[var(--radius-control)] bg-[var(--color-action-primary)] px-5 text-sm font-semibold text-[var(--color-action-on-primary)] hover:bg-[var(--color-action-hover)] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)]"
          >
            Try again
          </button>
          <a
            href="/anops"
            className="inline-flex min-h-[44px] items-center justify-center rounded-[var(--radius-control)] border border-[var(--color-border-control)] px-5 text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-bg-subtle)]"
          >
            Go to dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
