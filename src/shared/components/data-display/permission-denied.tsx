import { ButtonLink } from "@/shared/components/ui/button";

/** Shown when a signed-in user opens a page their role cannot use. The server still enforces the same rule on every action. */
export function PermissionDenied({ backHref, backLabel }: { backHref: string; backLabel: string }) {
  return (
    <div className="mx-auto max-w-lg rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-8 text-center">
      <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">You don&apos;t have access to this page</h1>
      <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
        Your role in this workspace does not include this action. Ask an owner or admin if you need access.
      </p>
      <div className="mt-6">
        <ButtonLink href={backHref}>{backLabel}</ButtonLink>
      </div>
    </div>
  );
}
