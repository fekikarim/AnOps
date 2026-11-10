"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { registerOrganizationAction, type RegistrationState } from "@/features/platform/actions/registration.action";
import { ORGANIZATION_CURRENCIES } from "@/features/platform/schemas";
import { IconArrowRight } from "@/shared/components/ui/brand-icons";
import type { ApplicationId } from "@/shared/domain/applications";
import { cn } from "@/shared/lib/utils";

const field =
  "mt-1.5 h-12 w-full rounded-[var(--radius-control)] border bg-[var(--color-bg-surface)] px-3.5 text-[15px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)]/70 transition-[border-color,box-shadow] focus:outline-none focus:ring-[3px] focus:ring-[var(--color-focus-ring)]";
const label = "text-sm font-semibold text-[var(--color-text-primary)]";

const CURRENCY_LABEL: Record<(typeof ORGANIZATION_CURRENCIES)[number], string> = {
  TND: "TND · Tunisian dinar",
  EUR: "EUR · Euro",
  USD: "USD · US dollar",
  GBP: "GBP · Pound sterling",
};

function strength(pw: string): { score: number; label: string } {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Za-z]/.test(pw) && /[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw) || (/[a-z]/.test(pw) && /[A-Z]/.test(pw))) score++;
  return { score, label: ["Too short", "Weak", "Fair", "Good", "Strong"][score] };
}

export function RegistrationForm({ apps, defaultCurrency }: { apps: ApplicationId[]; defaultCurrency: string }) {
  const [state, action, pending] = useActionState<RegistrationState, FormData>(registerOrganizationAction, {});
  const [password, setPassword] = useState("");
  const errors = state.fieldErrors ?? {};
  const v = state.values ?? {};
  const pw = strength(password);

  const input = (name: string) => ({
    id: name,
    name,
    defaultValue: v[name] ?? "",
    "aria-invalid": Boolean(errors[name]) || undefined,
    "aria-describedby": errors[name] ? `${name}-error` : undefined,
    className: cn(field, errors[name] ? "border-[var(--color-status-error-fg)]" : "border-[var(--color-border-control)]"),
  });
  const err = (name: string) =>
    errors[name] ? (
      <p id={`${name}-error`} className="mt-1.5 text-sm text-[var(--color-status-error-fg)]">
        {errors[name]}
      </p>
    ) : null;

  return (
    <form action={action} className="space-y-6" noValidate={false}>
      {apps.map((id) => (
        <input key={id} type="hidden" name="apps" value={id} />
      ))}

      {state.error && (
        <div role="alert" className="rounded-[12px] border border-[var(--color-status-error-fg)]/40 bg-[var(--color-status-error-bg)] px-4 py-3 text-sm text-[var(--color-status-error)]">
          {state.error}
          {errors.email && (
            <>
              {" "}
              <Link href="/login" className="font-semibold underline">
                Sign in
              </Link>
            </>
          )}
        </div>
      )}

      <fieldset className="space-y-4">
        <legend className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-text-secondary)]">About you</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="firstName" className={label}>
              First name
            </label>
            <input {...input("firstName")} autoComplete="given-name" required maxLength={60} />
            {err("firstName")}
          </div>
          <div>
            <label htmlFor="lastName" className={label}>
              Last name
            </label>
            <input {...input("lastName")} autoComplete="family-name" required maxLength={60} />
            {err("lastName")}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="email" className={label}>
              Work email
            </label>
            <input {...input("email")} type="email" autoComplete="email" inputMode="email" required placeholder="you@company.com" />
            {err("email")}
          </div>
          <div>
            <label htmlFor="phone" className={label}>
              Phone number
            </label>
            <input {...input("phone")} type="tel" autoComplete="tel" inputMode="tel" required placeholder="+216 20 123 456" />
            {err("phone")}
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-text-secondary)]">Your organization</legend>
        <div className="grid gap-4 sm:grid-cols-[1.4fr_1fr]">
          <div>
            <label htmlFor="organizationName" className={label}>
              Organization or website name
            </label>
            <input {...input("organizationName")} autoComplete="organization" required maxLength={80} placeholder="Atlas Trading" />
            {err("organizationName")}
          </div>
          <div>
            <label htmlFor="currency" className={label}>
              Currency
            </label>
            <select id="currency" name="currency" defaultValue={v.currency ?? defaultCurrency} className={cn(field, "border-[var(--color-border-control)]")}>
              {ORGANIZATION_CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {CURRENCY_LABEL[code]}
                </option>
              ))}
            </select>
            {err("currency")}
          </div>
        </div>
        <p className="text-sm text-[var(--color-text-secondary)]">Industry, company size and priorities can be added later from your organization profile.</p>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-text-secondary)]">Security</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="password" className={label}>
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={72}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-describedby="password-help"
              className={cn(field, errors.password ? "border-[var(--color-status-error-fg)]" : "border-[var(--color-border-control)]")}
            />
            <div id="password-help" className="mt-2 flex items-center gap-2" aria-live="polite">
              <div className="flex flex-1 gap-1" aria-hidden="true">
                {[1, 2, 3, 4].map((i) => (
                  <span key={i} className={cn("h-1 flex-1 rounded-full transition-colors", password && pw.score >= i ? (pw.score >= 3 ? "bg-[var(--color-status-success-fg)]" : "bg-[var(--color-status-warning-fg)]") : "bg-[var(--color-border-subtle)]")} />
                ))}
              </div>
              <span className="w-16 text-right text-xs text-[var(--color-text-secondary)]">{password ? pw.label : "8+ chars"}</span>
            </div>
            {err("password")}
          </div>
          <div>
            <label htmlFor="confirmPassword" className={label}>
              Confirm password
            </label>
            <input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required className={cn(field, errors.confirmPassword ? "border-[var(--color-status-error-fg)]" : "border-[var(--color-border-control)]")} />
            {err("confirmPassword")}
          </div>
        </div>
        <p className="text-xs text-[var(--color-text-secondary)]">At least 8 characters, with a letter and a number.</p>
      </fieldset>

      <label className="flex items-start gap-3 text-sm text-[var(--color-text-secondary)]">
        <input type="checkbox" name="acceptTerms" required className="mt-0.5 h-5 w-5 shrink-0 " />
        <span>
          I accept the{" "}
          <Link href="/terms" target="_blank" className="font-semibold text-[var(--color-text-primary)] underline underline-offset-4">
            Terms of Use
          </Link>{" "}
          and the{" "}
          <Link href="/privacy" target="_blank" className="font-semibold text-[var(--color-text-primary)] underline underline-offset-4">
            Privacy Policy
          </Link>
          .
        </span>
      </label>
      {err("acceptTerms")}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-[var(--color-action-primary)] text-sm font-semibold text-[#111F1D] transition-colors hover:bg-[var(--color-action-hover)] disabled:cursor-wait disabled:opacity-70"
      >
        {pending ? (
          <>
            <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-[#111F1D]/30 border-t-[#111F1D]" />
            Creating your workspace…
          </>
        ) : (
          <>
            Create my workspace
            <IconArrowRight size={14} />
          </>
        )}
      </button>
      <p className="text-center text-sm text-[var(--color-text-secondary)]">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-[var(--color-text-primary)] underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </form>
  );
}
