import { forwardRef } from "react";
import type { ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { selectClass, textareaClass } from "@/shared/components/ui/button";

/**
 * Shared form building blocks for the Inventory, Purchasing and Manufacturing forms.
 * Labels stay visible, required fields are marked, and errors/hints sit under the control.
 */

export function FormCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 sm:p-6", className)}>
      {children}
    </div>
  );
}

/** A titled group of related fields. Fields flow in a two-column grid on wider screens. */
export function FormSection({
  title,
  description,
  icon: Icon,
  actions,
  children,
  columns = 2,
  id,
}: {
  title: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  actions?: ReactNode;
  children: ReactNode;
  columns?: 1 | 2;
  id?: string;
}) {
  const headingId = id ?? `section-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <section aria-labelledby={headingId} className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-border-subtle)] px-4 py-4 sm:px-6">
        <div className="flex min-w-0 items-start gap-3">
          {Icon && (
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)] text-[var(--color-text-primary)]">
              <Icon aria-hidden className="size-4" />
            </span>
          )}
          <div className="min-w-0">
            <h2 id={headingId} className="text-base font-semibold text-[var(--color-text-primary)]">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">{description}</p>}
          </div>
        </div>
        {actions}
      </header>
      <div className={cn("grid gap-5 p-4 sm:p-6", columns === 2 && "sm:grid-cols-2")}>{children}</div>
    </section>
  );
}

export function FieldError({ id, children }: { id?: string; children?: ReactNode }) {
  if (!children) return null;
  return <p id={id} role="alert" className="text-xs text-[var(--color-status-error)]">{children}</p>;
}

/** Label + control + hint/error wrapper for controls that are not TextField. */
export function Field({
  label,
  htmlFor,
  required,
  hint,
  error,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  hint?: string;
  error?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-sm font-semibold text-[var(--color-text-primary)]">
        {label}
        {required && <span aria-hidden="true" className="ml-0.5 text-[var(--color-status-error)]">*</span>}
      </label>
      {children}
      {error ? <FieldError id={`${htmlFor}-error`}>{error}</FieldError> : hint ? <p id={`${htmlFor}-hint`} className="text-xs text-[var(--color-text-secondary)]">{hint}</p> : null}
    </div>
  );
}

/** Native select (keeps keyboard, mobile pickers and form posting) restyled with a themed chevron. */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...props }, ref) {
  return (
    <div className="relative">
      <select
        ref={ref}
        className={cn(selectClass, "h-11 cursor-pointer appearance-none truncate pr-10 disabled:cursor-not-allowed disabled:bg-[var(--color-bg-subtle)] aria-[invalid=true]:border-[var(--color-status-error)]", className)}
        {...props}
      >
        {children}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-text-secondary)]" />
    </div>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, rows = 3, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(textareaClass, "min-h-[88px] resize-y py-2.5 placeholder:text-[var(--color-text-secondary)] aria-[invalid=true]:border-[var(--color-status-error)]", className)}
      {...props}
    />
  );
});

/** Sticky-free action row: stacked on phones (primary first), right-aligned on wider screens. */
export function FormActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">{children}</div>;
}
