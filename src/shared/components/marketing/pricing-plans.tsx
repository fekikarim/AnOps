import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Check, Sparkles } from "lucide-react";
import { btnPrimary, btnSecondary } from "@/shared/components/marketing/styles";
import { AnimatedIcon } from "@/shared/components/portal/animated-icon";
import { delay } from "@/shared/components/portal/sections";
import { IconCheck } from "@/shared/components/ui/brand-icons";
import { plans, type Plan } from "@/shared/config/site";
import { PLANS, type AccessKind, type PlanId } from "@/shared/domain/plans";
import { cn } from "@/shared/lib/utils";

/** What the signed-in person's organization has today. null = signed out (the plain public cards). */
export type CurrentPlan = {
  orgId: string;
  orgName: string;
  kind: AccessKind;
  plan: PlanId | null;
  trialDaysLeft: number | null;
  accessEndsAt: string | null;
};

const icons: Record<string, string> = {
  oneops: "wired-lineal-501-coupon-free-morph-rotate.webp",
  custom: "wired-lineal-12-layers-hover-slide.webp",
  allops: "wired-lineal-3510-flow-chart-hover-pinch.webp",
  maxops: "wired-lineal-256x256-ai-chip-hover-pinch.webp",
};

const RANK: Record<PlanId, number> = { oneops: 0, custom: 1, allops: 2, maxops: 3 };

/** Catchy upgrade labels, by the plan being offered (and where the person is coming from). */
function upgradeLabel(target: PlanId, from: PlanId | null): string {
  if (target === "maxops") return "Unlock AnOps AI";
  if (target === "allops") return from === "custom" ? "Go all in" : "Unlock every app";
  return "Pick your apps";
}

/** Honest, specific cost of going down: what the team would lose today. */
function downgradeNote(target: PlanId, from: PlanId): string {
  if (target === "oneops") return "Back to one application. Every other app your team uses would lock, and AI features would switch off.";
  if (target === "custom") return from === "maxops" ? "You'd give up applications your team relies on, plus AnOps AI and every AI feature." : "You'd give up applications your team relies on today.";
  return "You'd lose AnOps AI and the AI features built into every application.";
}

function statusLine(current: CurrentPlan): { title: string; detail: string } {
  const planName = current.plan ? PLANS[current.plan].name : null;
  const until = current.accessEndsAt ? new Date(current.accessEndsAt).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" }) : null;
  switch (current.kind) {
    case "trial":
      return { title: "You're on your free trial", detail: `${current.trialDaysLeft ?? 0} day${current.trialDaysLeft === 1 ? "" : "s"} left with every AI feature on. Pick a plan to keep everything running.` };
    case "free":
      return { title: "You're on OneOps (free)", detail: "One application, unlimited users, forever. Ready for more?" };
    case "paid":
      return { title: `You're on ${planName}`, detail: "Your plan is active. Unlimited users on every plan." };
    case "canceling":
      return { title: `${planName} ends ${until ?? "soon"}`, detail: "You keep full access until then. Stay and keep everything your team has built." };
    case "grace":
      return { title: `${planName}: payment needs attention`, detail: `Update your payment method${until ? ` before ${until}` : ""} to keep access.` };
    case "legacy":
      return { title: "You have full access", detail: "Your organization predates plans, so every application is open." };
    default:
      return { title: "Your plan has ended", detail: "Choose a plan to reopen your applications. Your data is safe." };
  }
}

export function CurrentPlanBanner({ current }: { current: CurrentPlan }) {
  const { title, detail } = statusLine(current);
  const billing = `/organization/${current.orgId}/billing`;
  return (
    <div className="relative overflow-hidden rounded-[20px] border border-[var(--color-text-primary)] bg-[var(--color-bg-surface)] p-5 shadow-[0_24px_50px_-34px_rgba(17,31,29,0.55)] sm:p-6">
      <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full bg-[var(--color-action-primary)] opacity-25 blur-3xl" />
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--color-action-primary)] text-[var(--color-action-on-primary)]">
            <Check size={20} strokeWidth={2.6} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-text-secondary)]">Your plan · {current.orgName}</p>
            <p className="mt-1 font-[family-name:var(--font-heading)] text-xl font-semibold tracking-[-0.02em] text-[var(--color-text-primary)] sm:text-2xl">{title}</p>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{detail}</p>
          </div>
        </div>
        <Link href={billing} className={cn(btnSecondary, "w-full shrink-0 sm:w-auto")}>
          Manage subscription
        </Link>
      </div>
    </div>
  );
}

function PlanCard({ plan, index, current }: { plan: Plan; index: number; current: CurrentPlan | null }) {
  const id = plan.id as PlanId;
  const billing = current ? `/organization/${current.orgId}/billing` : null;
  const owned = current && current.plan === id && ["paid", "free", "canceling", "grace"].includes(current.kind);
  const ranked = current?.plan ? RANK[current.plan] : null;
  const higher = !owned && current && (ranked === null || RANK[id] > ranked);
  const lower = !owned && current && ranked !== null && RANK[id] < ranked;

  return (
    <li
      data-reveal
      style={delay(index, 70)}
      className={cn(
        "group relative flex flex-col rounded-[20px] border p-6 transition-[box-shadow,transform,opacity] duration-300",
        owned
          ? "border-[var(--color-action-primary)] bg-[var(--color-bg-surface)] shadow-[0_0_0_2px_var(--color-action-primary),0_30px_60px_-36px_rgba(17,31,29,0.6)]"
          : plan.highlight && !current
            ? "border-[var(--color-text-primary)] bg-[var(--color-bg-surface)] shadow-[0_30px_60px_-40px_rgba(17,31,29,0.6)]"
            : "border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]",
        higher && "motion-safe:hover:-translate-y-1 hover:border-[var(--color-text-primary)] hover:shadow-[0_30px_60px_-40px_rgba(17,31,29,0.6)]",
        lower && "opacity-[0.92]"
      )}
    >
      {owned ? (
        <span className="absolute -top-3 left-6 inline-flex items-center gap-1.5 rounded-full bg-[var(--color-action-primary)] px-3 py-1 text-xs font-bold text-[#111F1D]">
          <Check size={12} strokeWidth={3} aria-hidden="true" /> Your current plan
        </span>
      ) : (
        plan.highlight && !current && <span className="absolute -top-3 left-6 rounded-full bg-[var(--color-action-primary)] px-3 py-1 text-xs font-semibold text-[#111F1D]">{plan.highlight}</span>
      )}
      <div className="flex items-center justify-between">
        <h2 className="font-[family-name:var(--font-heading)] text-xl font-semibold tracking-[-0.02em] text-[var(--color-text-primary)]">{plan.name}</h2>
        <AnimatedIcon icon={icons[plan.id]} size={44} />
      </div>
      <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{plan.audience}</p>
      <p className="mt-6 font-[family-name:var(--font-heading)] text-[26px] font-semibold leading-tight tracking-[-0.035em] text-[var(--color-text-primary)]">{plan.price}</p>
      <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{plan.priceNote}</p>
      <dl className="mt-6 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-[10px] bg-[var(--color-bg-subtle)] p-3">
          <dt className="text-xs text-[var(--color-text-secondary)]">Users</dt>
          <dd className="mt-0.5 font-semibold text-[var(--color-text-primary)]">Unlimited</dd>
        </div>
        <div className="rounded-[10px] bg-[var(--color-bg-subtle)] p-3">
          <dt className="text-xs text-[var(--color-text-secondary)]">Applications</dt>
          <dd className="mt-0.5 font-semibold text-[var(--color-text-primary)]">{plan.applications}</dd>
        </div>
      </dl>
      <ul className="mt-6 space-y-2.5">
        {plan.features.map((feature) => (
          <li key={feature} className="flex gap-2.5 text-sm text-[var(--color-text-primary)]">
            <IconCheck size={12} className="mt-1 shrink-0" />
            {feature}
          </li>
        ))}
      </ul>

      <div className="mt-auto space-y-3 pt-8">
        {lower && current?.plan && (
          <p className="flex items-start gap-2 rounded-[12px] border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] px-3 py-2.5 text-[13px] leading-snug text-[var(--color-warning-text)]">
            <ArrowDownRight size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>{downgradeNote(id, current.plan)}</span>
          </p>
        )}
        {!current && (
          <Link href={plan.cta.href} className={cn(plan.highlight || plan.id === "oneops" ? btnPrimary : btnSecondary, "w-full")}>
            {plan.cta.label}
          </Link>
        )}
        {owned && billing && (
          <Link href={billing} className={cn(btnSecondary, "w-full")}>
            Manage plan
          </Link>
        )}
        {higher && billing && (
          <Link href={billing} className={cn(btnPrimary, "group/cta w-full")}>
            {id === "maxops" ? <Sparkles size={16} aria-hidden="true" /> : null}
            {upgradeLabel(id, current?.plan ?? null)}
            <ArrowUpRight size={16} aria-hidden="true" className="transition-transform duration-200 motion-safe:group-hover/cta:-translate-y-0.5 motion-safe:group-hover/cta:translate-x-0.5" />
          </Link>
        )}
        {lower && billing && (
          <Link href={billing} className="block w-full rounded-[var(--radius-control)] px-3 py-2.5 text-center text-xs font-medium text-[var(--color-text-secondary)] underline-offset-4 hover:text-[var(--color-text-primary)] hover:underline">
            Switch to {plan.name} anyway
          </Link>
        )}
      </div>
    </li>
  );
}

export function PricingPlans({ current }: { current: CurrentPlan | null }) {
  return (
    <ol className="grid gap-4 pt-3 md:grid-cols-2 xl:grid-cols-4">
      {plans.map((plan, index) => (
        <PlanCard key={plan.id} plan={plan} index={index} current={current} />
      ))}
    </ol>
  );
}
