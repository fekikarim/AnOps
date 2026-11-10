import Link from "next/link";
import { cn } from "@/shared/lib/utils";

export function AuthCard({
  children,
  title,
  description,
}: {
  children: React.ReactNode;
  title: string;
  description?: string;
}) {
  return (
    <main id="main" className="min-h-screen flex items-center justify-center px-4 bg-[var(--color-bg-canvas)]">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link href="/" className="inline-flex items-center justify-center mb-6">
            <img
              src="/brand-kit/01-brand-identity/logos/anops-logo-horizontal-dark.svg"
              alt="AnOps"
              className="h-8 block dark:hidden"
            />
            <img
              src="/brand-kit/01-brand-identity/logos/anops-logo-horizontal-white.svg"
              alt="AnOps"
              className="h-8 hidden dark:block"
            />
          </Link>
          <h1 className="text-2xl font-bold tracking-[-0.03em] text-[var(--color-text-primary)]">{title}</h1>
          {description && <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{description}</p>}
        </div>
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-6 shadow-[0_1px_1px_rgba(17,31,29,0.02),0_4px_16px_rgba(17,31,29,0.04)]">
          {children}
        </div>
      </div>
    </main>
  );
}

export function Field({
  label,
  name,
  type = "text",
  placeholder,
  required = true,
  autoComplete,
}: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
  autoComplete?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="text-sm font-semibold text-[var(--color-text-primary)]">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        placeholder={placeholder}
        required={required}
        autoComplete={autoComplete}
        className={cn(
          "w-full h-12 px-3 rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)]",
          "focus:outline-none focus:ring-[3px] focus:ring-[var(--color-focus-ring)] focus:ring-offset-[2px] focus:ring-offset-[var(--color-bg-surface)]"
        )}
      />
    </div>
  );
}

export function Button({
  children,
  variant = "primary",
  type = "button",
  className = "",
  disabled = false,
}: {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "tertiary";
  type?: "button" | "submit";
  className?: string;
  disabled?: boolean;
}) {
  const base = "h-12 px-5 rounded-[var(--radius-control)] text-sm font-semibold transition-colors focus-visible:outline-[3px] focus-visible:outline-[var(--color-focus-ring)] focus-visible:outline-offset-2 disabled:opacity-50 disabled:pointer-events-none min-h-[44px]";
  const styles = {
    primary: "bg-[var(--color-action-primary)] text-[var(--color-action-on-primary)] hover:bg-[var(--color-action-hover)]",
    secondary: "bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] border border-[var(--color-border-control)] hover:bg-[var(--color-bg-subtle)]",
    tertiary: "text-[var(--color-text-primary)] hover:bg-[var(--color-bg-subtle)]",
  };
  return (
    <button type={type} disabled={disabled} className={cn(base, styles[variant], className)}>
      {children}
    </button>
  );
}
