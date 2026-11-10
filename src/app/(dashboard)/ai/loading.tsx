export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading AnOps AI" className="grid h-[60dvh] gap-4 lg:grid-cols-[17rem_1fr]">
      <div className="hidden animate-pulse rounded-[var(--radius-card)] bg-[var(--color-bg-subtle)] lg:block" />
      <div className="animate-pulse rounded-[var(--radius-card)] bg-[var(--color-bg-subtle)]" />
    </div>
  );
}
