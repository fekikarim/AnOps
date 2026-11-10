import type { Metadata } from "next";
import { container } from "@/shared/components/marketing/styles";
import { Eyebrow, display } from "@/shared/components/portal/sections";
import { TrialSelector } from "@/features/platform/components/trial-selector";
import { isApplicationId, type ApplicationId } from "@/shared/domain/applications";
import { MAX_TRIAL_APPS } from "@/shared/domain/plans";

export const metadata: Metadata = {
  title: "Try AnOps free",
  description: "Choose the AnOps applications for your business. One application is free forever; two or three start a 15-day trial. No credit card required.",
};

export default async function TrialPage({ searchParams }: { searchParams: Promise<{ apps?: string }> }) {
  const params = await searchParams;
  const initial = [...new Set((params.apps ?? "").split(",").filter(isApplicationId).filter((id) => id !== "ai"))].slice(0, MAX_TRIAL_APPS) as ApplicationId[];

  return (
    <div className="relative">
      <div aria-hidden="true" className="portal-grid pointer-events-none absolute inset-x-0 top-0 h-[420px] [mask-image:radial-gradient(ellipse_at_top,black_10%,transparent_70%)]" />
      <div className={`${container} relative pt-12 sm:pt-16`}>
        <div className="max-w-3xl motion-safe:animate-[anops-rise_600ms_var(--ease-out)_both]">
          <Eyebrow>Try it free</Eyebrow>
          <h1 className={`${display} mt-5`}>Your business. Your applications. Your way.</h1>
          <p className="mt-6 text-lg leading-relaxed text-[var(--color-text-secondary)]">
            Get started instantly. No credit card required. Choose the applications that fit your business.
          </p>
        </div>
        <div className="mt-10">
          <TrialSelector initial={initial} />
        </div>
      </div>
    </div>
  );
}
