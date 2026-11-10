"use client";

import { confirmAction } from "@/shared/components/ui/confirm-dialog";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { AnimatedIcon } from "@/shared/components/portal/animated-icon";
import { IconArrowRight, IconCheck, IconSettings } from "@/shared/components/ui/brand-icons";
import { ThemeToggle } from "@/shared/components/theme-toggle";
import { OrgAvatar } from "@/shared/components/ui/org-avatar";
import { LogoutButton } from "@/features/platform/components/logout-button";
import { AppSwitcher } from "@/features/platform/components/app-switcher";
import { chooseFreeFallbackAction, resendActivationAction } from "@/features/platform/actions/workspace.action";
import { switchCompanyAction } from "@/features/company/actions/company.action";
import { APPLICATIONS, getApplication, type ApplicationId } from "@/shared/domain/applications";
import { PLANS, formatMoney, quotePrice, type AccessKind, type BillingCurrency, type PlanId } from "@/shared/domain/plans";
import type { Completion } from "@/shared/domain/profile";
import { cn } from "@/shared/lib/utils";

export type HomeData = {
  user: { firstName: string; name: string; email: string; initials: string };
  organization: { id: string; name: string; logoUrl: string | null; initials: string; role: string };
  organizations: { id: string; name: string }[];
  access: { kind: AccessKind; plan: PlanId | null; trialDaysLeft: number | null; accessEndsAt: string | null; needsPlanSelection: boolean; aiFeatures: boolean };
  allowedApps: ApplicationId[];
  orgApps: ApplicationId[];
  fallbackChoices: ApplicationId[];
  permissions: string[];
  activation: { pending: boolean; email: string; deadline: string | null; resendAvailableAt: string | null } | null;
  completion: Completion | null;
  welcome: boolean;
  lockedApp: ApplicationId | null;
  billingCurrency: BillingCurrency;
};

const PLAN_LABEL: Record<AccessKind, string> = {
  legacy: "Full access",
  free: "OneOps · Free",
  trial: "Free trial",
  trial_expired: "Trial ended",
  paid: "",
  grace: "Payment issue",
  canceling: "Ending soon",
  lapsed: "No active plan",
};

function useCountdown(target: string | null) {
  // null until mounted: the server and the first client render must match, so the live time starts after hydration.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!target) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- starts the clock after hydration
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [target]);
  if (!target || now === null) return null;
  const ms = Math.max(0, new Date(target).getTime() - now);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return { ms, label: `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s` };
}

/* ───────────────────────── Welcome ───────────────────────── */

function WelcomeOverlay({ data, onDone }: { data: HomeData; onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t1 = window.setTimeout(() => setLeaving(true), reduced ? 2500 : 3600);
    const t2 = window.setTimeout(onDone, reduced ? 2600 : 4200);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [onDone]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
      className={cn("portal-ink fixed inset-0 z-[90] flex items-center justify-center overflow-hidden px-6 transition-opacity duration-500", leaving ? "opacity-0" : "opacity-100")}
    >
      <div aria-hidden="true" className="portal-grid absolute inset-0 opacity-50 [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" />
      <div aria-hidden="true" className="absolute left-1/2 top-1/2 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#C8F03E] opacity-[0.12] blur-[120px]" />
      <div className="relative max-w-2xl text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#C8F03E] motion-safe:animate-[anops-rise_600ms_var(--ease-out)_both]">{data.organization.name}</p>
        <h1 id="welcome-title" className="mt-5 font-[family-name:var(--font-heading)] text-[44px] leading-[1.02] tracking-[-0.045em] text-[#F7F7F2] sm:text-[72px] motion-safe:animate-[anops-rise_700ms_var(--ease-out)_150ms_both]">
          Welcome to AnOps.
        </h1>
        <p className="mt-5 text-lg text-[#B4BFB7] motion-safe:animate-[anops-rise_700ms_var(--ease-out)_350ms_both]">
          Your workspace is ready. One connected ecosystem. Endless possibilities.
        </p>
        <ul className="mt-10 flex flex-wrap justify-center gap-4">
          {data.allowedApps.map((id, i) => (
            <li key={id} className="flex flex-col items-center gap-2 motion-safe:animate-[anops-rise_600ms_var(--ease-out)_both]" style={{ animationDelay: `${600 + i * 120}ms` }}>
              <AnimatedIcon icon={getApplication(id).icon} size={64} play="always" />
              <span className="text-xs font-medium text-[#F7F7F2]">{getApplication(id).name}</span>
            </li>
          ))}
        </ul>
        <button type="button" onClick={onDone} className="mt-12 inline-flex min-h-[44px] items-center gap-2 rounded-full border border-[#5d7a6f] px-5 text-sm font-semibold text-[#F7F7F2] hover:bg-[#192B27]">
          Enter workspace
          <IconArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}

/* ───────────────────────── Activation ───────────────────────── */

function ActivationNotice({ data }: { data: HomeData }) {
  const activation = data.activation;
  const [expanded, setExpanded] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState<string | null>(activation?.resendAvailableAt ?? null);
  const [pending, start] = useTransition();
  const remaining = useCountdown(activation?.deadline ?? null);
  const cooldown = useCountdown(cooldownUntil);
  const isOwner = data.organization.role === "owner";

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- per-tab preference restored after hydration
      if (sessionStorage.getItem("anops:activation-collapsed") === data.organization.id) setExpanded(false);
    } catch {
      /* ignore */
    }
  }, [data.organization.id]);

  if (!activation?.pending) return null;

  const collapse = () => {
    setExpanded(false);
    try {
      sessionStorage.setItem("anops:activation-collapsed", data.organization.id);
    } catch {
      /* ignore */
    }
  };

  const resend = () =>
    start(async () => {
      const result = await resendActivationAction();
      if (result.ok) {
        setMessage(result.data.delivered ? `A new activation email is on its way to ${result.data.email}.` : "We could not send the email right now. Try again in a moment.");
        setCooldownUntil(new Date(Date.now() + 60_000).toISOString());
      } else setMessage(result.error.message);
    });

  const resendDisabled = pending || (cooldown !== null && cooldown.ms > 0);

  if (!expanded) {
    return (
      <div className="pointer-events-none sticky top-0 z-40 mx-auto w-full max-w-[1100px] px-4 pb-2 pt-[max(12px,env(safe-area-inset-top))] sm:px-6">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="pointer-events-auto flex w-full items-center gap-3 rounded-[14px] border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] px-4 py-2.5 text-left text-sm text-[var(--color-warning-text)] shadow-[0_10px_30px_-14px_rgba(17,31,29,0.35)] transition-shadow hover:shadow-[0_14px_34px_-14px_rgba(17,31,29,0.45)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)] motion-safe:animate-[anops-rise_400ms_var(--ease-out)_both]"
        >
          <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--color-warning-border)] live-dot" />
          <span className="min-w-0 flex-1 leading-snug">
            <strong>Activate your organization</strong>
            <span className="hidden sm:inline"> · {remaining ? `${remaining.label} left · ` : ""}check {activation.email}</span>
            <span className="block text-xs sm:hidden">{remaining ? `${remaining.label} left · ` : ""}check {activation.email}</span>
          </span>
          <span className="shrink-0 font-semibold underline underline-offset-2">Details</span>
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 p-3 backdrop-blur-[2px] sm:items-center motion-safe:animate-[anops-fade_200ms_ease-out_both]">
      <div role="alertdialog" aria-modal="true" aria-labelledby="activation-title" aria-describedby="activation-body" className="relative w-full max-w-[520px]">
        {/* Stacked cards */}
        <div aria-hidden="true" className="absolute inset-x-6 -top-3 h-full rounded-[22px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] opacity-50" />
        <div aria-hidden="true" className="absolute inset-x-3 -top-1.5 h-full rounded-[22px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] opacity-80" />
        <div className="relative rounded-[22px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-6 shadow-[0_40px_90px_-40px_rgba(0,0,0,0.6)] motion-safe:animate-[anops-rise_400ms_var(--ease-out)_both] sm:p-7">
          <div className="flex items-start gap-4">
            <AnimatedIcon icon="wired-lineal-3094-mail-open-marketing-hover-pinch.webp" size={56} play="always" />
            <div>
              <h2 id="activation-title" className="font-[family-name:var(--font-heading)] text-2xl font-semibold tracking-[-0.03em] text-[var(--color-text-primary)]">
                Activate your organization
              </h2>
              {remaining && (
                <p className="mt-1 text-sm font-semibold tabular-nums text-[var(--color-status-warning-fg)]" aria-live="off">
                  {remaining.label} remaining
                </p>
              )}
            </div>
          </div>
          <p id="activation-body" className="mt-4 text-sm leading-relaxed text-[var(--color-text-secondary)]">
            We&apos;ve sent an activation email to <strong className="text-[var(--color-text-primary)]">{activation.email}</strong>. Your organization and its data are temporarily reserved for 12 hours.
            Activate your account before this period expires.
          </p>
          <ol className="mt-4 space-y-2 text-sm text-[var(--color-text-primary)]">
            {["Open the email from AnOps", "Click “Activate organization”", "You will continue straight into a short onboarding"].map((step, i) => (
              <li key={step} className="flex items-center gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-bg-subtle)] text-xs font-semibold">{i + 1}</span>
                {step}
              </li>
            ))}
          </ol>
          {message && (
            <p role="status" className="mt-4 rounded-[10px] bg-[var(--color-bg-subtle)] px-3 py-2 text-sm text-[var(--color-text-primary)]">
              {message}
            </p>
          )}
          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            {isOwner && (
              <button
                type="button"
                onClick={resend}
                disabled={resendDisabled}
                className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-[var(--radius-control)] border border-[var(--color-border-control)] px-4 text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-bg-subtle)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pending ? "Sending…" : cooldown && cooldown.ms > 0 ? `Resend in ${Math.ceil(cooldown.ms / 1000)}s` : "Resend email"}
              </button>
            )}
            <button type="button" onClick={collapse} className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-action-primary)] px-4 text-sm font-semibold text-[#111F1D] hover:bg-[var(--color-action-hover)]">
              Continue to workspace
            </button>
          </div>
          <Link href={`/organization/${data.organization.id}`} className="mt-4 inline-block text-sm font-semibold text-[var(--color-text-secondary)] underline underline-offset-4 hover:text-[var(--color-text-primary)]">
            Manage organization
          </Link>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── Plan gate ───────────────────────── */

function PlanGate({ data }: { data: HomeData }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isOwner = data.organization.role === "owner";
  const expired = data.access.kind === "trial_expired";
  const currency = data.billingCurrency;
  const billing = `/organization/${data.organization.id}/billing`;

  const plans: { id: PlanId; price: string }[] = [
    { id: "custom", price: `from ${formatMoney(quotePrice({ plan: "custom", currency, interval: "month", appCount: 2 }).total, currency)}/mo` },
    { id: "allops", price: `${formatMoney(quotePrice({ plan: "allops", currency, interval: "month" }).total, currency)}/mo` },
    { id: "maxops", price: `${formatMoney(quotePrice({ plan: "maxops", currency, interval: "month" }).total, currency)}/mo` },
  ];

  const fallback = (appId: ApplicationId) =>
    start(async () => {
      const result = await chooseFreeFallbackAction(appId);
      if (result.ok) router.refresh();
      else setError(result.error.message);
    });

  return (
    <section aria-labelledby="plan-gate-title" className="mx-auto mb-10 w-full max-w-[1100px] overflow-hidden rounded-[24px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] motion-safe:animate-[anops-rise_500ms_var(--ease-out)_both]">
      <div className="portal-ink relative px-6 py-8 sm:px-10">
        <div aria-hidden="true" className="portal-grid absolute inset-0 opacity-40" />
        <p className="relative text-xs font-semibold uppercase tracking-[0.14em] text-[#C8F03E]">{expired ? "Your free trial has ended" : "Your plan needs attention"}</p>
        <h2 id="plan-gate-title" className="relative mt-3 font-[family-name:var(--font-heading)] text-3xl font-semibold tracking-[-0.035em] text-[#F7F7F2] sm:text-4xl">
          {expired ? "Keep your workspace running." : "Choose how to continue."}
        </h2>
        <p className="relative mt-3 max-w-2xl text-sm leading-relaxed text-[#B4BFB7]">
          Your organization&apos;s data and settings are safe and preserved. {isOwner ? "Choose a plan to reopen your applications." : "Only the organization owner can choose a plan. Ask them to pick one to reopen the applications."}
        </p>
      </div>
      {isOwner && (
        <div className="grid gap-6 p-6 sm:p-10 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <p className="text-sm font-semibold text-[var(--color-text-primary)]">Upgrade</p>
            <ul className="mt-3 grid gap-3 sm:grid-cols-3">
              {plans.map((plan) => (
                <li key={plan.id}>
                  <Link href={`${billing}?plan=${plan.id}`} className="group flex h-full flex-col rounded-[16px] border border-[var(--color-border-subtle)] p-4 transition-colors hover:border-[var(--color-text-primary)]">
                    <span className="font-semibold text-[var(--color-text-primary)]">{PLANS[plan.id].name}</span>
                    <span className="mt-1 text-xs text-[var(--color-text-secondary)]">{PLANS[plan.id].tagline}</span>
                    <span className="mt-4 text-sm font-semibold text-[var(--color-text-primary)]">{plan.price}</span>
                    <span className="mt-auto inline-flex items-center gap-1 pt-3 text-xs font-semibold text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)]">
                      Choose <IconArrowRight size={11} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          {data.fallbackChoices.length > 0 && (
            <div className="rounded-[16px] bg-[var(--color-bg-subtle)] p-5">
              <p className="text-sm font-semibold text-[var(--color-text-primary)]">Or keep one application free</p>
              <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-secondary)]">
                OneOps keeps a single application free forever, with unlimited users and no AI features. This choice is permanent and cannot be changed later.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {data.fallbackChoices.map((id) => (
                  <button
                    key={id}
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      void confirmAction({
                        title: `Keep ${getApplication(id).name} free forever?`,
                        message: "It becomes your permanent free application. This choice cannot be changed later.",
                        tone: "warning",
                        confirmLabel: "Keep it free",
                      }).then((ok) => ok && fallback(id));
                    }}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] py-1 pl-1 pr-4 text-sm font-semibold text-[var(--color-text-primary)] hover:border-[var(--color-text-primary)] disabled:opacity-60"
                  >
                    <AnimatedIcon icon={getApplication(id).icon} size={32} play="never" />
                    {getApplication(id).name}
                  </button>
                ))}
              </div>
              {error && (
                <p role="alert" className="mt-3 text-sm text-[var(--color-status-error-fg)]">
                  {error}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/* ───────────────────────── Dock ───────────────────────── */

function Dock({ data }: { data: HomeData }) {
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const [pending, start] = useTransition();
  const item = "group relative flex h-12 w-12 items-center justify-center rounded-[14px] transition-transform duration-200 ease-[var(--ease-out)] motion-safe:hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]";
  const tip = "pointer-events-none absolute -top-9 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-[#111F1D] px-2 py-1 text-[11px] font-medium text-[#F7F7F2] group-hover:block group-focus-visible:block";

  return (
    <nav aria-label="Dock" className="fixed inset-x-0 bottom-0 z-50 flex justify-center px-3 pb-[max(14px,env(safe-area-inset-bottom))]">
      <div className="relative flex items-center gap-2 rounded-[22px] border border-white/15 bg-[color-mix(in_oklab,var(--color-bg-surface)_85%,transparent)] p-2 shadow-[0_0_0_1px_rgba(17,31,29,0.08),0_2px_6px_rgba(17,31,29,0.18),0_12px_32px_-6px_rgba(17,31,29,0.38),0_0_28px_-4px_rgba(17,31,29,0.3)] backdrop-blur-xl">
        {menu && data.organizations.length > 1 && (
          <div className="absolute bottom-full left-0 mb-3 w-64 rounded-[16px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-2 shadow-xl motion-safe:animate-[anops-menu-in_180ms_var(--ease-out)_both]">
            <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-secondary)]">Switch organization</p>
            {data.organizations.map((org) => (
              <button
                key={org.id}
                type="button"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    await switchCompanyAction(org.id);
                    setMenu(false);
                    router.refresh();
                  })
                }
                className="flex w-full items-center justify-between rounded-[10px] px-2 py-2 text-left text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-bg-subtle)]"
              >
                {org.name}
                {org.id === data.organization.id && <IconCheck size={12} />}
              </button>
            ))}
            <Link href={`/organization/${data.organization.id}`} className="mt-1 block rounded-[10px] px-2 py-2 text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-bg-subtle)]">
              Manage {data.organization.name}
            </Link>
            <Link href="/organization" className="block rounded-[10px] px-2 py-2 text-sm font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text-primary)]">
              All organizations · New
            </Link>
          </div>
        )}
        <Link href="/" aria-label="AnOps public website" className={item}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand-kit/02-app-icons/anops-app-icon-ios-192x192.svg" alt="" width={44} height={44} className="h-11 w-11 rounded-[12px] shadow-[0_6px_14px_-8px_rgba(0,0,0,0.6)]" />
          <span className={tip}>Public website</span>
        </Link>
        <span aria-hidden="true" className="mx-1 h-8 w-px bg-[var(--color-border-subtle)]" />
        {data.organizations.length > 1 ? (
          <button type="button" onClick={() => setMenu((v) => !v)} aria-expanded={menu} aria-label={`Organization: ${data.organization.name}`} className={item}>
            <OrgAvatar name={data.organization.name} logoUrl={data.organization.logoUrl} className="h-11 w-11 rounded-[12px] bg-[#111F1D] text-sm font-bold text-[#C8F03E]" />
            <span className={tip}>{data.organization.name}</span>
          </button>
        ) : (
          <Link href={`/organization/${data.organization.id}`} aria-label={`Organization: ${data.organization.name}`} className={item}>
            <OrgAvatar name={data.organization.name} logoUrl={data.organization.logoUrl} className="h-11 w-11 rounded-[12px] bg-[#111F1D] text-sm font-bold text-[#C8F03E]" />
            <span className={tip}>{data.organization.name}</span>
          </Link>
        )}
        <Link href="/profile" aria-label={`Your profile: ${data.user.name}`} className={item}>
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--color-action-primary)] text-sm font-bold text-[#111F1D]">{data.user.initials}</span>
          <span className={tip}>Profile</span>
        </Link>
        <span aria-hidden="true" className="mx-1 h-8 w-px bg-[var(--color-border-subtle)]" />
        <div className="group relative">
          <AppSwitcher allowed={data.allowedApps} permissions={data.permissions} aiFeatures={data.access.aiFeatures} trigger="icon" hotkey={false} />
          <span className={tip}>Search ⌘K</span>
        </div>
        <Link href={`/organization/${data.organization.id}/settings`} aria-label="Settings" className={cn(item, "text-[var(--color-text-primary)]")}>
          <IconSettings size={20} />
          <span className={tip}>Settings</span>
        </Link>
      </div>
    </nav>
  );
}

/* ───────────────────────── Home ───────────────────────── */

export function AnopsHome({ data }: { data: HomeData }) {
  const router = useRouter();
  const [welcome, setWelcome] = useState(data.welcome);
  const allowed = useMemo(() => new Set(data.allowedApps), [data.allowedApps]);
  const installed = APPLICATIONS.filter((app) => allowed.has(app.id));
  const others = APPLICATIONS.filter((app) => !allowed.has(app.id));
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const planName = data.access.plan ? PLANS[data.access.plan].name : null;
  const badge = data.access.kind === "paid" ? planName : data.access.kind === "trial" ? `Free trial · ${data.access.trialDaysLeft} day${data.access.trialDaysLeft === 1 ? "" : "s"} left` : PLAN_LABEL[data.access.kind];
  const locked = data.lockedApp ? getApplication(data.lockedApp) : null;
  const isManager = data.organization.role === "owner" || data.organization.role === "admin";

  const finishWelcome = () => {
    setWelcome(false);
    router.replace("/anops", { scroll: false });
  };

  return (
    <div className="relative min-h-[100dvh] overflow-x-hidden bg-[var(--color-bg-canvas)]">
      <div aria-hidden="true" className="portal-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_80%_60%_at_50%_0%,black,transparent)]" />
      <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-[-240px] h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-[var(--color-action-primary)] opacity-[0.10] blur-[120px]" />

      {welcome && <WelcomeOverlay data={data} onDone={finishWelcome} />}
      {!welcome && <ActivationNotice data={data} />}

      <header className="relative mx-auto flex w-full max-w-[1100px] items-center justify-between gap-4 px-4 pt-[max(20px,env(safe-area-inset-top))] sm:px-6">
        <Link href="/anops" aria-label="AnOps home" className="flex items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand-kit/01-brand-identity/logos/anops-logo-horizontal-dark.svg" alt="" className="block h-7 dark:hidden" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand-kit/01-brand-identity/logos/anops-logo-horizontal-white.svg" alt="" className="hidden h-7 dark:block" />
        </Link>
        <div className="flex items-center gap-2">
          <div className="hidden sm:block">
            <AppSwitcher allowed={data.allowedApps} permissions={data.permissions} aiFeatures={data.access.aiFeatures} />
          </div>
          <ThemeToggle />
          <LogoutButton />
        </div>
      </header>

      <main className="relative mx-auto w-full max-w-[1100px] px-4 pb-40 pt-10 sm:px-6 sm:pt-14">
        {data.activation?.pending && <span className="sr-only">Your organization is waiting for activation.</span>}
        <div className="mb-10 motion-safe:animate-[anops-rise_600ms_var(--ease-out)_both]">
          <p className="text-sm text-[var(--color-text-secondary)]">
            {greeting}, {data.user.firstName}
          </p>
          <h1 className="mt-2 font-[family-name:var(--font-heading)] text-[34px] leading-[1.05] tracking-[-0.04em] text-[var(--color-text-primary)] sm:text-[48px]">{data.organization.name}</h1>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {badge && <span className="rounded-full bg-[var(--color-text-primary)] px-3 py-1 text-xs font-semibold text-[var(--color-bg-canvas)]">{badge}</span>}
            <span className="rounded-full border border-[var(--color-border-subtle)] px-3 py-1 text-xs font-medium capitalize text-[var(--color-text-secondary)]">{data.organization.role}</span>
            {!data.access.aiFeatures && data.access.kind !== "lapsed" && data.access.kind !== "trial_expired" && (
              <span className="rounded-full border border-[var(--color-border-subtle)] px-3 py-1 text-xs text-[var(--color-text-secondary)]">AI features not included</span>
            )}
          </div>
        </div>

        {locked && (
          <div role="status" className="mb-6 flex flex-col gap-3 rounded-[16px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 sm:flex-row sm:items-center">
            <AnimatedIcon icon={locked.icon} size={40} play="never" />
            <p className="flex-1 text-sm text-[var(--color-text-secondary)]">
              <strong className="text-[var(--color-text-primary)]">{locked.name}</strong> is not available{" "}
              {data.orgApps.includes(locked.id) ? "for your account. Ask an administrator for access." : "in your organization's current plan."}
            </p>
            {isManager && !data.orgApps.includes(locked.id) && (
              <Link href={`/organization/${data.organization.id}/billing`} className="text-sm font-semibold text-[var(--color-text-primary)] underline underline-offset-4">
                See plans
              </Link>
            )}
          </div>
        )}

        {data.access.kind === "trial" && data.access.trialDaysLeft !== null && data.access.trialDaysLeft <= 5 && isManager && (
          <div className="mb-6 flex items-center justify-between gap-3 rounded-[16px] border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] px-4 py-3 text-sm text-[var(--color-warning-text)]">
            <span>Your trial ends in {data.access.trialDaysLeft} day{data.access.trialDaysLeft === 1 ? "" : "s"}. Choose a plan to keep every application.</span>
            <Link href={`/organization/${data.organization.id}/billing`} className="shrink-0 font-semibold underline">
              Choose a plan
            </Link>
          </div>
        )}
        {(data.access.kind === "grace" || data.access.kind === "canceling") && isManager && (
          <div className="mb-6 flex items-center justify-between gap-3 rounded-[16px] border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] px-4 py-3 text-sm text-[var(--color-warning-text)]">
            <span>
              {data.access.kind === "grace" ? "Your last payment failed. Update your payment method to avoid interruption" : "Your subscription is set to end"}
              {data.access.accessEndsAt ? ` on ${new Date(data.access.accessEndsAt).toLocaleDateString()}` : ""}.
            </span>
            <Link href={`/organization/${data.organization.id}/billing`} className="shrink-0 font-semibold underline">
              Billing
            </Link>
          </div>
        )}

        {data.access.needsPlanSelection && <PlanGate data={data} />}

        {installed.length > 0 && (
          <section aria-labelledby="apps-title">
            <h2 id="apps-title" className="mb-5 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-text-secondary)]">
              Your applications
            </h2>
            <ul className="grid grid-cols-4 gap-x-3 gap-y-6 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
              {installed.map((app, index) => (
                <li key={app.id} className="motion-safe:animate-[anops-rise_500ms_var(--ease-out)_both]" style={{ animationDelay: `${index * 45}ms` }}>
                  <Link
                    href={app.href}
                    style={{ ["--accent" as string]: app.accent }}
                    className="group flex h-full flex-col items-center gap-2 rounded-[22px] text-center transition-[transform,background-color,border-color,box-shadow] duration-300 ease-[var(--ease-out)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)] active:scale-95 sm:items-start sm:gap-0 sm:border sm:border-[var(--color-border-subtle)] sm:bg-[var(--color-bg-surface)] sm:p-5 sm:text-left sm:hover:border-[color-mix(in_oklab,var(--accent)_55%,var(--color-border-subtle))] sm:hover:shadow-[0_22px_44px_-28px_var(--accent)] motion-safe:sm:hover:-translate-y-1"
                  >
                    <span className="sm:hidden">
                      <AnimatedIcon icon={app.icon} size={64} className="rounded-[18px] shadow-[0_8px_18px_-10px_rgba(0,0,0,0.35)]" />
                    </span>
                    <span className="hidden sm:block">
                      <AnimatedIcon icon={app.icon} size={60} />
                    </span>
                    <span className="w-full truncate text-[12px] font-medium text-[var(--color-text-primary)] sm:mt-5 sm:text-base sm:font-semibold sm:tracking-[-0.01em]">{app.name}</span>
                    <span className="hidden text-sm leading-relaxed text-[var(--color-text-secondary)] sm:mt-1 sm:block">{app.tagline}</span>
                    <span className="hidden items-center gap-1 pt-4 text-xs font-semibold text-[var(--color-text-secondary)] opacity-0 transition-opacity group-hover:opacity-100 sm:mt-auto sm:inline-flex">
                      Open <IconArrowRight size={11} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {data.completion && data.completion.percent < 100 && isManager && (
          <section aria-labelledby="completion-title" className="mt-12 rounded-[20px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 id="completion-title" className="text-base font-semibold text-[var(--color-text-primary)]">
                  Complete your organization profile
                </h2>
                <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Optional. It helps AnOps tailor guides and defaults to your business.</p>
              </div>
              <span className="font-[family-name:var(--font-heading)] text-2xl font-semibold text-[var(--color-text-primary)]">{data.completion.percent}%</span>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--color-bg-subtle)]" role="progressbar" aria-valuenow={data.completion.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Profile completion">
              <div className="h-full rounded-full bg-[var(--color-action-primary)] transition-[width] duration-700" style={{ width: `${data.completion.percent}%` }} />
            </div>
            <ul className="mt-4 flex flex-wrap gap-2">
              {data.completion.missing.slice(0, 4).map((item) => (
                <li key={item.key}>
                  <Link href={item.href} title={item.why} className="inline-flex min-h-[36px] items-center rounded-full border border-[var(--color-border-subtle)] px-3 text-xs font-medium text-[var(--color-text-primary)] hover:border-[var(--color-border-control)]">
                    + {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {others.length > 0 && !data.access.needsPlanSelection && (
          <section aria-labelledby="more-title" className="mt-12">
            <div className="mb-4 flex items-end justify-between gap-3">
              <h2 id="more-title" className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-text-secondary)]">
                More applications
              </h2>
              {isManager && (
                <Link href={`/organization/${data.organization.id}/billing`} className="text-sm font-semibold text-[var(--color-text-primary)] underline underline-offset-4">
                  Compare plans
                </Link>
              )}
            </div>
            <ul className="grid grid-cols-4 gap-3 sm:grid-cols-6 lg:grid-cols-8">
              {others.map((app) => (
                <li key={app.id} className="group flex flex-col items-center gap-1.5 text-center opacity-60 transition-opacity hover:opacity-100" title={`${app.name}: ${data.orgApps.includes(app.id) ? "ask an administrator for access" : "not in your plan"}`}>
                  <AnimatedIcon icon={app.icon} size={48} className="grayscale group-hover:grayscale-0" />
                  <span className="w-full truncate text-[11px] text-[var(--color-text-secondary)]">{app.name}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      <Dock data={data} />
    </div>
  );
}
