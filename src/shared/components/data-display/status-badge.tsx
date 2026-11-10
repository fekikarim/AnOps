import { cn } from "@/shared/lib/utils";

export type BadgeTone = "success" | "warning" | "error" | "neutral" | "info";

const TONES: Record<BadgeTone, string> = {
  success: "bg-[var(--color-status-success-bg)] text-[var(--color-status-success)]",
  warning: "bg-[var(--color-status-warning-bg)] text-[var(--color-status-warning)]",
  error: "bg-[var(--color-status-error-bg)] text-[var(--color-status-error)]",
  neutral: "bg-[var(--color-status-neutral-bg)] text-[var(--color-status-neutral)]",
  info: "bg-[var(--color-bg-subtle)] text-[var(--color-text-primary)]",
};

/** Status is always shown as text, never by colour alone. */
export function StatusBadge({ label, tone = "neutral" }: { label: string; tone?: BadgeTone }) {
  return (
    <span className={cn("inline-flex items-center rounded-[var(--radius-pill)] px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap", TONES[tone])}>
      {label}
    </span>
  );
}
