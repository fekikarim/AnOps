"use client";

import Link from "next/link";
import { useActionState } from "react";
import { activateOrganizationAction, type ActivationFormState } from "@/features/platform/actions/lifecycle.action";
import { AnimatedIcon } from "@/shared/components/portal/animated-icon";

export function ActivateForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<ActivationFormState, FormData>(activateOrganizationAction, {});
  return (
    <form action={action} className="text-center">
      <input type="hidden" name="token" value={token} />
      <div className="flex justify-center">
        <AnimatedIcon icon="wired-lineal-3308-building-office-in-reveal.webp" size={80} play="always" />
      </div>
      <h1 className="mt-6 font-[family-name:var(--font-heading)] text-3xl font-semibold tracking-[-0.035em] text-[var(--color-text-primary)]">Activate your organization</h1>
      <p className="mt-3 text-sm leading-relaxed text-[var(--color-text-secondary)]">Confirm your email address to make your AnOps organization permanent.</p>
      {state.error && (
        <div role="alert" className="mt-6 rounded-[12px] border border-[var(--color-status-error-fg)]/40 bg-[var(--color-status-error-bg)] px-4 py-3 text-left text-sm text-[var(--color-status-error)]">
          {state.error}{" "}
          <Link href="/anops" className="font-semibold underline">
            Open AnOps to request a new link
          </Link>
          .
        </div>
      )}
      <button
        type="submit"
        disabled={pending}
        className="mt-8 inline-flex h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-[var(--color-action-primary)] text-sm font-semibold text-[#111F1D] transition-colors hover:bg-[var(--color-action-hover)] disabled:opacity-70"
      >
        {pending ? "Activating…" : "Activate organization"}
      </button>
    </form>
  );
}
