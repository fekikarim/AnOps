"use client";

import { useActionState } from "react";
import { acceptInvitationAction, type AcceptState } from "@/features/platform/actions/lifecycle.action";
import { cn } from "@/shared/lib/utils";

const field = "mt-1.5 h-12 w-full rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3.5 text-[15px] text-[var(--color-text-primary)] focus:outline-none focus:ring-[3px] focus:ring-[var(--color-focus-ring)]";

export function AcceptInvitationForm({ token, email, newAccount }: { token: string; email: string; newAccount: boolean }) {
  const [state, action, pending] = useActionState<AcceptState, FormData>(acceptInvitationAction, {});
  const errors = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      {state.error && (
        <p role="alert" className="rounded-[12px] border border-[var(--color-status-error-fg)]/40 bg-[var(--color-status-error-bg)] px-4 py-3 text-sm text-[var(--color-status-error)]">
          {state.error}
        </p>
      )}
      {newAccount && (
        <>
          <div>
            <label className="text-sm font-semibold text-[var(--color-text-primary)]" htmlFor="invite-email">
              Email
            </label>
            <input id="invite-email" value={email} readOnly className={cn(field, "bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)]")} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {(["firstName", "lastName"] as const).map((name) => (
              <div key={name}>
                <label className="text-sm font-semibold text-[var(--color-text-primary)]" htmlFor={name}>
                  {name === "firstName" ? "First name" : "Last name"}
                </label>
                <input id={name} name={name} required maxLength={60} autoComplete={name === "firstName" ? "given-name" : "family-name"} className={field} />
                {errors[name] && <p className="mt-1 text-sm text-[var(--color-status-error-fg)]">{errors[name]}</p>}
              </div>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm font-semibold text-[var(--color-text-primary)]" htmlFor="password">
                Password
              </label>
              <input id="password" name="password" type="password" required minLength={8} maxLength={72} autoComplete="new-password" className={field} />
              {errors.password && <p className="mt-1 text-sm text-[var(--color-status-error-fg)]">{errors.password}</p>}
            </div>
            <div>
              <label className="text-sm font-semibold text-[var(--color-text-primary)]" htmlFor="confirmPassword">
                Confirm password
              </label>
              <input id="confirmPassword" name="confirmPassword" type="password" required autoComplete="new-password" className={field} />
              {errors.confirmPassword && <p className="mt-1 text-sm text-[var(--color-status-error-fg)]">{errors.confirmPassword}</p>}
            </div>
          </div>
          <p className="text-xs text-[var(--color-text-secondary)]">At least 8 characters, with a letter and a number.</p>
        </>
      )}
      <button type="submit" disabled={pending} className="inline-flex h-12 w-full items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-action-primary)] text-sm font-semibold text-[#111F1D] hover:bg-[var(--color-action-hover)] disabled:opacity-70">
        {pending ? "Joining…" : newAccount ? "Create account and join" : "Accept invitation"}
      </button>
    </form>
  );
}
