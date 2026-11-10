"use client";

import { cn } from "@/shared/lib/utils";

/**
 * Accessible on/off switch in the AnOps identity: lime track with a soft glow when on, a white thumb that glides
 * with a springy ease and shows a check when on. The whole 44px row is the hit area; motion respects reduced-motion.
 */
export function Switch({
  checked,
  onChange,
  label,
  labelledBy,
  describedBy,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Accessible name when there is no visible label to point at. */
  label?: string;
  labelledBy?: string;
  describedBy?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "group inline-flex min-h-[44px] min-w-[56px] shrink-0 items-center justify-center rounded-[14px] focus-visible:outline-none disabled:cursor-not-allowed",
        className
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "relative box-border block h-[30px] w-[52px] rounded-full border transition-[background-color,border-color,box-shadow] duration-300 ease-[var(--ease-out)] motion-reduce:transition-none",
          "group-focus-visible:ring-[3px] group-focus-visible:ring-[var(--color-focus-ring)] group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-[var(--color-bg-surface)]",
          checked
            ? "border-transparent bg-[var(--color-action-primary)] shadow-[0_0_0_1px_color-mix(in_oklab,var(--color-action-primary)_60%,transparent),0_6px_16px_-6px_var(--color-action-primary)]"
            : "border-[var(--color-border-control)] bg-[var(--color-bg-subtle)] group-hover:border-[var(--color-text-secondary)]",
          disabled && "opacity-55 shadow-none"
        )}
      >
        <span
          className={cn(
            "absolute left-[2px] top-[2px] flex h-6 w-6 items-center justify-center rounded-full bg-white shadow-[0_2px_5px_rgba(0,0,0,0.3)] transition-transform duration-300 [transition-timing-function:cubic-bezier(0.34,1.4,0.64,1)] motion-reduce:transition-none",
            "group-active:scale-[0.92]",
            checked ? "translate-x-[22px]" : "translate-x-0"
          )}
        >
          <svg
            viewBox="0 0 12 12"
            className={cn("h-3 w-3 text-[#111F1D] transition-[opacity,transform] duration-200 motion-reduce:transition-none", checked ? "scale-100 opacity-100" : "scale-50 opacity-0")}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2.5 6.2l2.4 2.4 4.6-5" />
          </svg>
        </span>
      </span>
    </button>
  );
}
