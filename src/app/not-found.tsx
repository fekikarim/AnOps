import Link from "next/link";
export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg-canvas)] text-[var(--color-text-primary)] px-4">
      <div className="text-center space-y-3">
        <div className="inline-flex items-center justify-center mb-4">
          <img src="/brand-kit/01-brand-identity/logos/anops-logo-horizontal-dark.svg" alt="AnOps" className="h-8 block dark:hidden" />
          <img src="/brand-kit/01-brand-identity/logos/anops-logo-horizontal-white.svg" alt="AnOps" className="h-8 hidden dark:block" />
        </div>
        <h1 className="text-5xl tracking-[-0.03em]">404</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">Page not found</p>
        <Link
          href="/"
          className="inline-flex h-11 items-center rounded-[var(--radius-control)] bg-[var(--color-action-primary)] px-5 text-sm font-semibold text-[var(--color-action-on-primary)] hover:bg-[var(--color-action-hover)]"
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}
