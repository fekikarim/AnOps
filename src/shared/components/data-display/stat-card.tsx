import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/shared/lib/utils";

export type StatTone = "default" | "warning" | "error" | "success" | "blue" | "teal" | "violet";

const ICON_TONES: Record<StatTone, string> = {
  default: "bg-[var(--color-bg-subtle)] text-[var(--color-text-primary)]",
  warning: "bg-[var(--color-status-warning-bg)] text-[var(--color-status-warning)]",
  error: "bg-[var(--color-status-error-bg)] text-[var(--color-status-error)]",
  success: "bg-[var(--color-status-success-bg)] text-[var(--color-status-success)]",
  blue: "bg-[var(--color-accent-blue-bg)] text-[var(--color-accent-blue)]",
  teal: "bg-[var(--color-accent-teal-bg)] text-[var(--color-accent-teal)]",
  violet: "bg-[var(--color-accent-violet-bg)] text-[var(--color-accent-violet)]",
};

/** Shared KPI card: icon, label, prominent value and optional supporting text. Renders a link when href is given. */
export function StatCard({
  label,
  value,
  icon: Icon,
  href,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  href?: string;
  hint?: string;
  tone?: StatTone;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">{label}</span>
        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-control)]", ICON_TONES[tone])}>
          <Icon aria-hidden className="size-[18px]" />
        </span>
      </div>
      <span className="mt-3 block break-words text-2xl font-bold tracking-tight tabular-nums text-[var(--color-text-primary)]">{value}</span>
      {hint && <span className="mt-1 block text-xs text-[var(--color-text-secondary)]">{hint}</span>}
    </>
  );
  const base = "block min-w-0 rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4";
  if (!href) return <div className={base}>{body}</div>;
  return (
    <Link href={href} className={cn(base, "transition-colors hover:bg-[var(--color-bg-subtle)] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)]")}>
      {body}
    </Link>
  );
}
