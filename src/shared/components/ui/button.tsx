import Link from "next/link";
import { cn } from "@/shared/lib/utils";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-[var(--color-action-primary)] text-[var(--color-action-on-primary)] hover:bg-[var(--color-action-hover)] border-transparent",
  secondary:
    "bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] border-[var(--color-border-control)] hover:bg-[var(--color-bg-subtle)]",
  danger: "bg-[var(--color-status-error-bg)] text-[var(--color-status-error)] border-[var(--color-status-error)] hover:opacity-90",
  ghost: "bg-transparent text-[var(--color-text-primary)] border-transparent hover:bg-[var(--color-bg-subtle)]",
};

const BASE =
  "inline-flex min-h-[44px] items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-control)] border px-4 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)] disabled:cursor-not-allowed disabled:opacity-60";

export function buttonClass(variant: Variant = "secondary", extra?: string): string {
  return cn(BASE, VARIANTS[variant], extra);
}

export function Button({
  variant = "secondary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type="button" className={buttonClass(variant, className)} {...props} />;
}

export function ButtonLink({
  href,
  variant = "secondary",
  className,
  children,
}: {
  href: string;
  variant?: Variant;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={buttonClass(variant, className)}>
      {children}
    </Link>
  );
}

/** Shared input styling for native form controls. Pair with TextField for labelled text inputs. */
export const selectClass =
  "w-full min-h-[44px] rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3 text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-[3px] focus:ring-[var(--color-focus-ring)]";

export const textareaClass =
  "w-full rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-[3px] focus:ring-[var(--color-focus-ring)]";
