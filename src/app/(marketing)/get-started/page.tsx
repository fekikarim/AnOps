import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { container } from "@/shared/components/marketing/styles";
import { AnimatedIcon } from "@/shared/components/portal/animated-icon";
import { Eyebrow } from "@/shared/components/portal/sections";
import { RegistrationForm } from "@/features/platform/components/registration-form";
import { auth } from "@/server/auth";
import { getApplication } from "@/shared/domain/applications";
import { ACTIVATION_HOURS, TRIAL_DAYS, validateTrialSelection } from "@/shared/domain/plans";

export const metadata: Metadata = {
  title: "Create your workspace",
  description: "Create your AnOps account and organization in a minute. No credit card required.",
};

export default async function GetStartedPage({ searchParams }: { searchParams: Promise<{ apps?: string }> }) {
  const session = await auth();
  if (session?.user?.id) redirect("/anops");

  const params = await searchParams;
  const verdict = validateTrialSelection((params.apps ?? "").split(",").filter(Boolean));
  if (!verdict.ok) redirect(`/trial${params.apps ? `?apps=${encodeURIComponent(params.apps)}` : ""}`);

  const steps = [
    { title: "Your workspace is created", body: "Your organization, your owner account and your applications are set up right away." },
    { title: "Open AnOps", body: "Start using your applications immediately." },
    { title: "Activate by email", body: `Confirm the email we send you within ${ACTIVATION_HOURS} hours to keep your organization.` },
  ];

  return (
    <div className="relative">
      <div aria-hidden="true" className="portal-grid pointer-events-none absolute inset-x-0 top-0 h-[360px] [mask-image:radial-gradient(ellipse_at_top_left,black_10%,transparent_70%)]" />
      <div className={`${container} relative grid gap-10 py-12 sm:py-16 lg:grid-cols-[1.25fr_0.75fr] lg:gap-14`}>
        <div className="motion-safe:animate-[anops-rise_600ms_var(--ease-out)_both]">
          <Eyebrow>Get started</Eyebrow>
          <h1 className="mt-4 font-[family-name:var(--font-heading)] text-[34px] leading-[1.08] tracking-[-0.04em] text-[var(--color-text-primary)] sm:text-[46px]">
            Create your workspace.
          </h1>
          <p className="mt-3 text-base text-[var(--color-text-secondary)] sm:text-lg">One minute, no credit card. You can complete your profile later.</p>
          <div className="mt-8 rounded-[20px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 sm:p-8">
            <RegistrationForm apps={verdict.appIds} defaultCurrency="TND" />
          </div>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start motion-safe:animate-[anops-rise_700ms_var(--ease-out)_both]">
          <div className="portal-ink rounded-[20px] p-6">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-text-secondary)]">Your selection</p>
              <Link
                href={`/trial?apps=${verdict.appIds.join(",")}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border-subtle)] px-3 py-1 text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <span aria-hidden="true">←</span> Change applications
              </Link>
            </div>
            <p className="mt-2 font-[family-name:var(--font-heading)] text-2xl font-semibold tracking-[-0.03em]">
              {verdict.kind === "free" ? "Permanent Free" : `${TRIAL_DAYS}-day free trial`}
            </p>
            <ul className="mt-5 space-y-3">
              {verdict.appIds.map((id) => {
                const app = getApplication(id);
                return (
                  <li key={id} className="flex items-center gap-3">
                    <AnimatedIcon icon={app.icon} size={40} play="never" />
                    <span>
                      <span className="block text-sm font-semibold">{app.name}</span>
                      <span className="block text-xs text-[var(--color-text-secondary)]">{app.tagline}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-5 border-t border-[var(--color-border-subtle)] pt-4 text-sm leading-relaxed text-[var(--color-text-secondary)]">
              {verdict.kind === "free"
                ? "Free forever with unlimited users. This choice is permanent; AI features are not included."
                : `All selected applications with AI features for ${TRIAL_DAYS} days. When the trial ends, choose AllOps, MaxOps, Custom, or keep one application free.`}
            </p>
          </div>
          <ol className="rounded-[20px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-6">
            {steps.map((step, index) => (
              <li key={step.title} className="flex gap-4 pb-5 last:pb-0">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-bg-subtle)] text-xs font-semibold text-[var(--color-text-primary)]">{index + 1}</span>
                <span>
                  <span className="block text-sm font-semibold text-[var(--color-text-primary)]">{step.title}</span>
                  <span className="mt-0.5 block text-sm text-[var(--color-text-secondary)]">{step.body}</span>
                </span>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </div>
  );
}
