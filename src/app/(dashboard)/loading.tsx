export default function Loading() {
  return (
    <div className="space-y-8">
      <div className="h-10 w-48 animate-pulse rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)]" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-32 animate-pulse rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]"
          />
        ))}
      </div>
    </div>
  );
}
