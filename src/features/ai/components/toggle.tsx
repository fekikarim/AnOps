"use client";

import { cn } from "@/shared/lib/utils";

/** Accessible on/off switch. The 44px hit area is the button; the visible track is smaller. */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
  describedBy,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  describedBy?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "group inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-[var(--radius-control)] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)] disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
    >
      <span
        aria-hidden
        className={cn(
          "relative h-6 w-11 rounded-full border transition-colors duration-200",
          checked ? "border-transparent bg-[var(--color-action-primary)]" : "border-[var(--color-border-control)] bg-[var(--color-bg-subtle)]"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 size-5 rounded-full bg-[var(--color-bg-surface)] shadow-sm ring-1 ring-[var(--color-border-subtle)] transition-transform duration-200 [transition-timing-function:var(--ease-out)] motion-reduce:transition-none",
            checked && "translate-x-5"
          )}
        />
      </span>
    </button>
  );
}
