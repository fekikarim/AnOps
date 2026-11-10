"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen flex items-center justify-center bg-[var(--color-bg-canvas)] text-[var(--color-text-primary)] px-4">
        <div className="text-center space-y-3">
          <h1 className="text-4xl tracking-[-0.03em]">Something went wrong</h1>
          <p className="text-sm text-[var(--color-text-secondary)]">An unexpected error occurred.</p>
          <button
            onClick={() => reset()}
            className="h-11 rounded-[var(--radius-control)] bg-[var(--color-action-primary)] px-5 text-sm font-semibold text-[var(--color-action-on-primary)] hover:bg-[var(--color-action-hover)]"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
