"use client";

import { confirmAction } from "@/shared/components/ui/confirm-dialog";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { chooseOneOpsAction, openBillingPortalAction, setCancelAtPeriodEndAction, startCheckoutAction } from "@/features/platform/actions/billing.action";
import { updateBillingContactAction } from "@/features/platform/actions/organization.action";
import type { InvoiceView } from "@/server/platform/billing.service";
import { AnimatedIcon } from "@/shared/components/portal/animated-icon";
import { useToast } from "@/shared/components/ui/toast";
import { APPLICATIONS, getApplication, type ApplicationId } from "@/shared/domain/applications";
import { ALLOPS_APP_COUNT, CUSTOM_MAX_APPS, CUSTOM_MIN_APPS, PLANS, formatMoney, quotePrice, type AccessKind, type BillingCurrency, type BillingInterval, type PaidPlanId, type PlanId } from "@/shared/domain/plans";
import { cn } from "@/shared/lib/utils";

export type BillingData = {
  orgId: string;
  isOwner: boolean;
  kind: AccessKind;
  plan: PlanId | null;
  appIds: ApplicationId[];
  aiFeatures: boolean;
  trialDaysLeft: number | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  accessEndsAt: string | null;
  hasStripeSubscription: boolean;
  billingEmail: string;
  billingCurrency: BillingCurrency;
  billingInterval: BillingInterval | null;
  freeAppId: ApplicationId | null;
  fallbackChoices: ApplicationId[];
  needsPlanSelection: boolean;
  config: { payments: boolean; testMode: boolean; webhooks: boolean };
  invoices: InvoiceView[];
  checkoutResult: "active" | "pending" | "canceled" | null;
  preselect: PaidPlanId | null;
};

const card = "rounded-[20px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 sm:p-6";
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : "—");
const STATE_LABEL: Record<AccessKind, string> = {
  legacy: "Grandfathered full access",
  free: "Free forever",
  trial: "Free trial",
  trial_expired: "Trial ended",
  paid: "Active",
  grace: "Payment failed · grace period",
  canceling: "Cancels at period end",
  lapsed: "Inactive",
};

export function BillingCenter({ data }: { data: BillingData }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [interval, setInterval] = useState<BillingInterval>(data.billingInterval ?? "month");
  const [currency, setCurrency] = useState<BillingCurrency>(data.billingCurrency);
  const [selected, setSelected] = useState<PaidPlanId>(data.preselect ?? (data.plan && data.plan !== "oneops" ? data.plan : "allops"));
  const [customApps, setCustomApps] = useState<ApplicationId[]>(data.kind === "trial" || data.kind === "trial_expired" ? data.appIds.filter((id) => getApplication(id).status === "available") : []);
  const [aiAddon, setAiAddon] = useState(false);
  const [billingEmail, setBillingEmail] = useState(data.billingEmail);

  const price = (plan: PaidPlanId, apps = customApps.length, ai = aiAddon) => {
    if (plan === "custom" && (apps < CUSTOM_MIN_APPS || apps > CUSTOM_MAX_APPS)) return null;
    return quotePrice({ plan, currency, interval, appCount: apps, aiAddon: ai });
  };
  const quote = useMemo(() => price(selected), [selected, currency, interval, customApps, aiAddon]); // eslint-disable-line react-hooks/exhaustive-deps
  const suffix = interval === "month" ? "/month" : "/year";
  const allopsMonthly = quotePrice({ plan: "allops", currency, interval, appCount: 0 }).total;
  const customHitsCap = selected === "custom" && quote !== null && customApps.length >= 5;

  const act = <T,>(fn: () => Promise<{ ok: true; data: T } | { ok: false; error: { message: string; code: string; requestId: string } }>, onOk: (data: T) => void) =>
    start(async () => {
      const result = await fn();
      if (result.ok) onOk(result.data);
      else toast.fromError(result.error);
    });

  const checkout = () =>
    act(
      () => startCheckoutAction(data.orgId, { plan: selected, interval, currency, appIds: customApps, aiAddon }),
      (result) => {
        window.location.href = result.url;
      }
    );

  const planName = data.plan ? PLANS[data.plan].name : data.kind === "trial" || data.kind === "trial_expired" ? "Trial" : data.kind === "legacy" ? "Full access" : "No plan";

  return (
    <div className="space-y-6">
      {data.checkoutResult === "active" && <p role="status" className="rounded-[14px] bg-[var(--color-status-success-bg)] px-4 py-3 text-sm font-medium text-[var(--color-status-success)]">Payment confirmed by Stripe. Your new plan is active.</p>}
      {data.checkoutResult === "pending" && <p role="status" className="rounded-[14px] bg-[var(--color-warning-bg)] px-4 py-3 text-sm text-[var(--color-warning-text)]">Stripe has not confirmed the payment yet. This page updates once it does; refresh in a moment.</p>}
      {data.checkoutResult === "canceled" && <p role="status" className="rounded-[14px] bg-[var(--color-bg-subtle)] px-4 py-3 text-sm text-[var(--color-text-secondary)]">Checkout was cancelled. Nothing was charged.</p>}

      {/* Current plan */}
      <section className={cn(card, "relative overflow-hidden")} aria-labelledby="current-title">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-text-secondary)]">Current plan</p>
            <h2 id="current-title" className="mt-1 font-[family-name:var(--font-heading)] text-3xl font-semibold tracking-[-0.035em] text-[var(--color-text-primary)]">
              {planName}
            </h2>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{STATE_LABEL[data.kind]}</p>
          </div>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
            {data.kind === "trial" && (
              <div>
                <dt className="text-[var(--color-text-secondary)]">Trial ends</dt>
                <dd className="font-semibold text-[var(--color-text-primary)]">
                  {date(data.trialEndsAt)} · {data.trialDaysLeft}d left
                </dd>
              </div>
            )}
            {data.currentPeriodEnd && (
              <div>
                <dt className="text-[var(--color-text-secondary)]">{data.cancelAtPeriodEnd ? "Access until" : "Renews on"}</dt>
                <dd className="font-semibold text-[var(--color-text-primary)]">{date(data.currentPeriodEnd)}</dd>
              </div>
            )}
            {data.billingInterval && (
              <div>
                <dt className="text-[var(--color-text-secondary)]">Billing</dt>
                <dd className="font-semibold capitalize text-[var(--color-text-primary)]">{data.billingInterval === "year" ? "Annual" : "Monthly"}</dd>
              </div>
            )}
            <div>
              <dt className="text-[var(--color-text-secondary)]">AI features</dt>
              <dd className="font-semibold text-[var(--color-text-primary)]">{data.aiFeatures ? "Included" : "Not included"}</dd>
            </div>
          </dl>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          {data.appIds.map((id) => (
            <span key={id} className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border-subtle)] py-1 pl-1 pr-3 text-xs font-medium text-[var(--color-text-primary)]">
              <AnimatedIcon icon={getApplication(id).icon} size={24} play="never" />
              {getApplication(id).name}
            </span>
          ))}
          {data.appIds.length === 0 && <span className="text-sm text-[var(--color-text-secondary)]">No application is active. Choose a plan below; your data is preserved.</span>}
        </div>
        {data.isOwner && data.hasStripeSubscription && (
          <div className="mt-6 flex flex-wrap gap-2 border-t border-[var(--color-border-subtle)] pt-5">
            <button type="button" disabled={pending} onClick={() => act(() => openBillingPortalAction(data.orgId), (r) => (window.location.href = r.url))} className="min-h-[40px] rounded-[8px] border border-[var(--color-border-control)] px-4 text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-bg-subtle)] disabled:opacity-60">
              Payment method & receipts
            </button>
            {data.cancelAtPeriodEnd ? (
              <button type="button" disabled={pending} onClick={() => act(() => setCancelAtPeriodEndAction(data.orgId, false), () => (toast.success("Subscription will renew"), router.refresh()))} className="min-h-[40px] rounded-[8px] bg-[var(--color-action-primary)] px-4 text-sm font-semibold text-[#111F1D] disabled:opacity-60">
                Keep my subscription
              </button>
            ) : (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  void confirmAction({
                    title: "Cancel your subscription?",
                    message: `It ends on ${date(data.currentPeriodEnd)}. You keep access until then and your data is preserved.`,
                    tone: "warning",
                    confirmLabel: "Cancel subscription",
                    cancelLabel: "Keep subscription",
                  }).then((ok) => ok && act(() => setCancelAtPeriodEndAction(data.orgId, true), () => (toast.success("Cancellation scheduled"), router.refresh())))
                }
                className="min-h-[40px] rounded-[8px] px-4 text-sm font-semibold text-[var(--color-status-error-fg)] hover:bg-[var(--color-status-error-bg)] disabled:opacity-60"
              >
                Cancel subscription
              </button>
            )}
          </div>
        )}
      </section>

      {/* Plan chooser */}
      {data.isOwner ? (
        <section className={card} aria-labelledby="plans-title">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 id="plans-title" className="text-base font-semibold text-[var(--color-text-primary)]">
                {data.hasStripeSubscription ? "Change plan" : "Choose a plan"}
              </h2>
              <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Unlimited users on every plan. Prices exclude applicable taxes.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <div role="group" aria-label="Billing interval" className="inline-flex rounded-full border border-[var(--color-border-subtle)] p-1">
                {(["month", "year"] as const).map((value) => (
                  <button key={value} type="button" aria-pressed={interval === value} onClick={() => setInterval(value)} className={cn("min-h-[34px] rounded-full px-4 text-sm font-medium", interval === value ? "bg-[var(--color-text-primary)] text-[var(--color-bg-canvas)]" : "text-[var(--color-text-secondary)]")}>
                    {value === "month" ? "Monthly" : "Annual · 2 months free"}
                  </button>
                ))}
              </div>
              <label>
                <span className="sr-only">Billing currency</span>
                <select value={currency} onChange={(e) => setCurrency(e.target.value as BillingCurrency)} className="h-[44px] rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-3 text-sm text-[var(--color-text-primary)]">
                  <option value="eur">EUR €</option>
                  <option value="usd">USD $</option>
                </select>
              </label>
            </div>
          </div>

          <div role="radiogroup" aria-label="Plan" className="mt-6 grid gap-3 md:grid-cols-3">
            {(["custom", "allops", "maxops"] as const).map((id) => {
              const p = id === "custom" ? price("custom", Math.max(customApps.length, CUSTOM_MIN_APPS), false) : price(id);
              const active = selected === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setSelected(id)}
                  className={cn("relative flex flex-col rounded-[16px] border p-5 text-left transition-[border-color,box-shadow]", active ? "border-[var(--color-text-primary)] shadow-[0_18px_40px_-28px_rgba(17,31,29,0.6)]" : "border-[var(--color-border-subtle)] hover:border-[var(--color-border-control)]")}
                >
                  {id === "allops" && <span className="absolute -top-3 left-5 rounded-full bg-[var(--color-action-primary)] px-2.5 py-0.5 text-[11px] font-semibold text-[#111F1D]">Best value</span>}
                  <span className="text-base font-semibold text-[var(--color-text-primary)]">{PLANS[id].name}</span>
                  <span className="mt-1 text-xs text-[var(--color-text-secondary)]">{PLANS[id].tagline}</span>
                  <span className="mt-4 font-[family-name:var(--font-heading)] text-2xl font-semibold tracking-[-0.03em] text-[var(--color-text-primary)]">
                    {id === "custom" ? "from " : ""}
                    {p ? formatMoney(p.total, currency) : "—"}
                    <span className="text-sm font-normal text-[var(--color-text-secondary)]">{suffix}</span>
                  </span>
                  <ul className="mt-3 space-y-1">
                    {PLANS[id].features.map((f) => (
                      <li key={f} className="text-xs text-[var(--color-text-secondary)]">
                        · {f}
                      </li>
                    ))}
                  </ul>
                  {data.plan === id && data.hasStripeSubscription && <span className="mt-3 text-xs font-semibold text-[var(--color-status-success-fg)]">Current plan</span>}
                </button>
              );
            })}
          </div>

          {selected === "custom" && (
            <div className="mt-5 rounded-[16px] bg-[var(--color-bg-subtle)] p-4 sm:p-5">
              <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                Choose {CUSTOM_MIN_APPS}–{CUSTOM_MAX_APPS} applications <span className="font-normal text-[var(--color-text-secondary)]">· {customApps.length} selected</span>
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {APPLICATIONS.filter((app) => app.status === "available").map((app) => {
                  const on = customApps.includes(app.id);
                  return (
                    <button
                      key={app.id}
                      type="button"
                      aria-pressed={on}
                      disabled={(!on && customApps.length >= CUSTOM_MAX_APPS) || (app.aiNative && !aiAddon && !on)}
                      title={app.aiNative && !aiAddon ? "Requires the AI add-on" : undefined}
                      onClick={() => setCustomApps((cur) => (on ? cur.filter((x) => x !== app.id) : [...cur, app.id]))}
                      className={cn("inline-flex min-h-[38px] items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-xs font-medium disabled:opacity-40", on ? "border-[var(--color-text-primary)] bg-[var(--color-bg-surface)] text-[var(--color-text-primary)]" : "border-[var(--color-border-subtle)] text-[var(--color-text-secondary)]")}
                    >
                      <AnimatedIcon icon={app.icon} size={26} play="never" />
                      {app.name}
                    </button>
                  );
                })}
              </div>
              <label className="mt-4 flex items-center gap-3 text-sm text-[var(--color-text-primary)]">
                <input type="checkbox" checked={aiAddon} onChange={(e) => { setAiAddon(e.target.checked); if (!e.target.checked) setCustomApps((cur) => cur.filter((id) => !getApplication(id).aiNative)); }} className="h-4 w-4 accent-[#111F1D]" />
                Add AI features (+{formatMoney(quotePrice({ plan: "custom", currency, interval, appCount: CUSTOM_MIN_APPS, aiAddon: true }).aiAddon, currency)}
                {suffix})
              </label>
              {customHitsCap && (
                <p className="mt-3 text-xs text-[var(--color-text-secondary)]">
                  Custom is capped below AllOps. AllOps gives you {ALLOPS_APP_COUNT} applications (no AI) for {formatMoney(allopsMonthly, currency)}
                  {suffix}.
                </p>
              )}
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--color-border-subtle)] pt-5">
            <div>
              <p className="text-sm text-[var(--color-text-secondary)]">Total</p>
              <p className="font-[family-name:var(--font-heading)] text-2xl font-semibold text-[var(--color-text-primary)]">
                {quote ? formatMoney(quote.total, currency) : "—"}
                <span className="text-sm font-normal text-[var(--color-text-secondary)]">{suffix}</span>
              </p>
            </div>
            {data.config.payments ? (
              <button type="button" disabled={pending || !quote} onClick={checkout} className="inline-flex min-h-[48px] items-center rounded-[var(--radius-control)] bg-[var(--color-action-primary)] px-7 text-sm font-semibold text-[#111F1D] hover:bg-[var(--color-action-hover)] disabled:opacity-60">
                {pending ? "Opening secure checkout…" : "Continue to secure checkout"}
              </button>
            ) : (
              <p className="max-w-sm text-sm text-[var(--color-text-secondary)]">Online payment is not configured on this server yet.</p>
            )}
          </div>
          {data.config.testMode && <p className="mt-3 text-xs text-[var(--color-text-secondary)]">Stripe test mode: no real charges. Use Stripe test card 4242 4242 4242 4242.</p>}
          <p className="mt-2 text-xs text-[var(--color-text-secondary)]">Payments are processed by Stripe. Your plan changes only after Stripe confirms the payment. Changing plan replaces your current subscription.</p>
        </section>
      ) : (
        <section className={card}>
          <p className="text-sm text-[var(--color-text-secondary)]">Only the organization owner can change the plan or billing details.</p>
        </section>
      )}

      {/* OneOps fallback */}
      {data.isOwner && data.needsPlanSelection && data.fallbackChoices.length > 0 && (
        <section className={card} aria-labelledby="oneops-title">
          <h2 id="oneops-title" className="text-base font-semibold text-[var(--color-text-primary)]">
            Or keep one application free (OneOps)
          </h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            {data.freeAppId ? "Your free application was chosen at registration." : "This one-time choice is permanent."} Unlimited users, no AI features. Other applications stay closed; their data is preserved.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {data.fallbackChoices.map((id) => (
              <button
                key={id}
                type="button"
                disabled={pending}
                onClick={() =>
                  void confirmAction({
                    title: `Keep ${getApplication(id).name} free forever?`,
                    message: "This choice is permanent and cannot be changed later.",
                    tone: "warning",
                    confirmLabel: "Keep it free",
                  }).then((ok) => ok && act(() => chooseOneOpsAction(data.orgId, id), () => (toast.success(`${getApplication(id).name} is now your free application`), router.refresh())))
                }
                className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-[var(--color-border-control)] py-1 pl-1 pr-4 text-sm font-semibold text-[var(--color-text-primary)] hover:border-[var(--color-text-primary)] disabled:opacity-60"
              >
                <AnimatedIcon icon={getApplication(id).icon} size={32} play="never" />
                {getApplication(id).name}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Billing contact */}
      <section className={card} aria-labelledby="contact-title">
        <h2 id="contact-title" className="text-base font-semibold text-[var(--color-text-primary)]">
          Billing contact
        </h2>
        <form
          className="mt-4 flex flex-col gap-3 sm:flex-row"
          action={() => act(() => updateBillingContactAction(data.orgId, billingEmail), () => toast.success("Billing contact saved"))}
        >
          <label className="flex-1">
            <span className="sr-only">Billing email</span>
            <input type="email" value={billingEmail} onChange={(e) => setBillingEmail(e.target.value)} disabled={!data.isOwner} className="h-11 w-full rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3 text-sm text-[var(--color-text-primary)] disabled:bg-[var(--color-bg-subtle)]" />
          </label>
          {data.isOwner && (
            <button type="submit" disabled={pending} className="min-h-[44px] rounded-[var(--radius-control)] border border-[var(--color-border-control)] px-5 text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-bg-subtle)] disabled:opacity-60">
              Save
            </button>
          )}
        </form>
      </section>

      {/* Invoices */}
      <section className={card} aria-labelledby="invoices-title">
        <h2 id="invoices-title" className="text-base font-semibold text-[var(--color-text-primary)]">
          Billing history
        </h2>
        {data.invoices.length === 0 ? (
          <div className="mt-6 flex flex-col items-center gap-3 py-6 text-center">
            <AnimatedIcon icon="wired-lineal-755-receipt-dollar-hover-pinch.webp" size={56} />
            <p className="text-sm text-[var(--color-text-secondary)]">No invoices yet. Invoices and payment receipts appear here after your first payment.</p>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="text-[var(--color-text-secondary)]">
                <tr>
                  <th className="pb-2 font-medium">Date</th>
                  <th className="pb-2 font-medium">Invoice</th>
                  <th className="pb-2 font-medium">Amount</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium">
                    <span className="sr-only">Documents</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border-subtle)]">
                {data.invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td className="py-3 text-[var(--color-text-primary)]">{date(inv.issuedAt)}</td>
                    <td className="py-3 text-[var(--color-text-secondary)]">{inv.number ?? "—"}</td>
                    <td className="py-3 font-semibold text-[var(--color-text-primary)]">{inv.total}</td>
                    <td className="py-3">
                      <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold capitalize", inv.status === "paid" ? "bg-[var(--color-status-success-bg)] text-[var(--color-status-success)]" : "bg-[var(--color-status-warning-bg)] text-[var(--color-status-warning)]")}>{inv.status}</span>
                    </td>
                    <td className="py-3 text-right">
                      {inv.hostedInvoiceUrl && (
                        <a href={inv.hostedInvoiceUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-[var(--color-text-primary)] underline">
                          View
                        </a>
                      )}
                      {inv.invoicePdf && (
                        <a href={inv.invoicePdf} target="_blank" rel="noopener noreferrer" className="ml-3 font-semibold text-[var(--color-text-primary)] underline">
                          PDF
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
