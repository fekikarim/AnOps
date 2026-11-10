import Link from "next/link";

/** Summary tile. Renders as a link when a destination is given, so the whole tile is a 44px+ touch target. */
export function StatCard({ label, value, hint, href }: { label: string; value: number | string; hint?: string; href?: string }) {
  const body = (
    <>
      <p className="text-xs font-medium uppercase tracking-[0.06em] text-[var(--color-text-secondary)]">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-[var(--color-text-primary)] sm:text-3xl">{value}</p>
      {hint && <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{hint}</p>}
    </>
  );
  const className =
    "block min-h-[44px] rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 hover:bg-[var(--color-bg-subtle)] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)]";
  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}
