import { cn } from "@/shared/lib/utils";

/**
 * Shared filter row. Fields wrap on narrow screens and each label sits above its control with a fixed gap,
 * so a label can never touch its dropdown. Use with method="get" forms.
 */
export function FilterBar({
  children,
  className,
  role,
  ...props
}: React.FormHTMLAttributes<HTMLFormElement>) {
  return (
    <form
      method="get"
      role={role}
      className={cn(
        "flex flex-col gap-4 rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 sm:flex-row sm:flex-wrap sm:items-end",
        className
      )}
      {...props}
    >
      {children}
    </form>
  );
}

export function FilterField({ label, htmlFor, className, children }: { label: string; htmlFor: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-2 sm:w-56", className)}>
      <label htmlFor={htmlFor} className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
        {label}
      </label>
      {children}
    </div>
  );
}

/** Shared look for text inputs inside a FilterBar. */
export const filterInputClass =
  "h-11 w-full rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:ring-[3px] focus:ring-[var(--color-focus-ring)]";
