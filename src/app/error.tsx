"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 bg-[var(--color-bg-canvas)]">
      <div className="max-w-md text-center space-y-3">
        <h1 className="text-2xl font-bold tracking-[-0.03em] text-[var(--color-text-primary)]">
          Something went wrong
        </h1>
        <p className="text-sm text-[var(--color-text-secondary)]">
          An unexpected error occurred. Please try again.
        </p>
        <button
          onClick={() => reset()}
          className="h-11 rounded-[var(--radius-control)] bg-[var(--color-action-primary)] px-5 text-sm font-semibold text-[var(--color-action-on-primary)] hover:bg-[var(--color-action-hover)]"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
