"use client";

import Link from "next/link";
import { useEffect } from "react";

/** Finance error boundary: renders inside the Finance layout, so the Copilot stays available. No internal error text is shown. */
export default function FinanceError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[finance] unexpected error", error.digest ?? error.name);
  }, [error]);
  return (
    <div className="flex min-h-[50vh] items-center justify-center px-4">
      <div role="alert" className="max-w-md space-y-4 text-center">
        <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">This finance page hit a problem</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">Your records are safe. Try again, or go back to the Finance dashboard.</p>
        {error.digest && <p className="font-mono text-xs text-[var(--color-text-secondary)]">Reference: {error.digest.slice(0, 12)}</p>}
        <div className="flex flex-col justify-center gap-2 sm:flex-row">
          <button type="button" onClick={() => reset()} className="min-h-[44px] rounded-[var(--radius-control)] bg-[var(--color-action-primary)] px-5 text-sm font-semibold text-[var(--color-action-on-primary)] hover:bg-[var(--color-action-hover)] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)]">
            Try again
          </button>
          <Link href="/finance" className="inline-flex min-h-[44px] items-center justify-center rounded-[var(--radius-control)] border border-[var(--color-border-control)] px-5 text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-bg-subtle)]">
            Finance dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
