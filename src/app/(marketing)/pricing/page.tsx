import Link from "next/link";
import type { Metadata } from "next";
import { Faq } from "@/shared/components/marketing/faq";
import { container } from "@/shared/components/marketing/styles";
import { CurrentPlanBanner, PricingPlans } from "@/shared/components/marketing/pricing-plans";
import { getCurrentPlan } from "@/server/platform/current-plan";
import { PlanFinder } from "@/shared/components/portal/plan-finder";
import { CtaBand, PageHero, SectionHeading, delay } from "@/shared/components/portal/sections";
import { IconCheck } from "@/shared/components/ui/brand-icons";
import { comparisonRows, plans, pricingFaq } from "@/shared/config/site";
import { cn } from "@/shared/lib/utils";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "AnOps plans: Free (one company, one app), Standard (one company, all apps), Pro (multiple companies), Ultra (advanced AI) and Custom.",
};

export default async function PricingPage() {
  const current = await getCurrentPlan();

  return (
    <>
      <PageHero
        eyebrow="Pricing"
        title="Unlimited users. Pay for applications, not people."
        lead="Start with one application free forever, try up to three for 15 days, then pick the plan that fits. Every plan includes unlimited users."
      />

      <section className={`${container} py-14 sm:py-20`} aria-label="Plans">
        {current && (
          <div className="mb-8" data-reveal>
            <CurrentPlanBanner current={current} />
          </div>
        )}
        <PricingPlans current={current} />

        <p className="mt-6 text-sm text-[var(--color-text-secondary)]">
          Prices per organization, unlimited users, excluding applicable taxes. Annual billing: two months free. Need something specific?{" "}
          <Link href="/contact" className="font-semibold text-[var(--color-text-primary)] underline underline-offset-4">
            Talk to us
          </Link>
          .
        </p>
      </section>

      <section className="border-y border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]/50" aria-labelledby="finder-heading">
        <div className={`${container} py-16 sm:py-24`}>
          <SectionHeading id="finder-heading" eyebrow="Plan finder" title="Not sure which plan fits?" lead="Three questions, one suggestion. You can change plans later." />
          <div className="mt-10" data-reveal style={delay(1)}>
            <PlanFinder />
          </div>
        </div>
      </section>

      <section className={`${container} py-16 sm:py-24`} aria-labelledby="compare-heading">
        <SectionHeading id="compare-heading" eyebrow="Compare" title="Every plan, side by side." />
        <div className="mt-10 overflow-x-auto rounded-[18px] border border-[var(--color-border-subtle)]" data-reveal tabIndex={0} role="region" aria-labelledby="compare-heading">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-[var(--color-bg-subtle)]">
              <tr>
                <th scope="col" className="sticky left-0 bg-[var(--color-bg-subtle)] px-5 py-4 font-semibold text-[var(--color-text-secondary)]">
                  Feature
                </th>
                {plans.map((plan) => (
                  <th key={plan.id} scope="col" className="px-4 py-4 font-semibold text-[var(--color-text-primary)]">
                    {plan.name}
                    {plan.highlight && <span className="ml-2 inline-block h-2 w-2 rounded-full bg-[var(--color-action-primary)]" aria-label="Recommended" />}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
              {comparisonRows.map((row) => (
                <tr key={row.label} className="transition-colors hover:bg-[var(--color-bg-subtle)]/60">
                  <th scope="row" className="sticky left-0 bg-[var(--color-bg-surface)] px-5 py-4 font-medium text-[var(--color-text-primary)]">
                    {row.label}
                  </th>
                  {row.values.map((value, i) => (
                    <td key={i} className={cn("px-4 py-4", value === "—" ? "text-[var(--color-text-secondary)]" : "text-[var(--color-text-primary)]")}>
                      {value === "Included" ? (
                        <span className="inline-flex items-center gap-1.5">
                          <IconCheck size={12} />
                          <span>Included</span>
                        </span>
                      ) : value === "—" ? (
                        <span>
                          <span aria-hidden="true">—</span>
                          <span className="sr-only">Not included</span>
                        </span>
                      ) : (
                        value
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="border-t border-[var(--color-border-subtle)]" aria-labelledby="pricing-faq-heading">
        <div className={`${container} grid gap-10 py-16 sm:py-24 lg:grid-cols-[0.8fr_1.2fr]`}>
          <div data-reveal>
            <SectionHeading id="pricing-faq-heading" eyebrow="Billing questions" title="Plans and billing, explained." />
            <p className="mt-4 text-sm text-[var(--color-text-secondary)]">
              Something else? <Link href="/contact" className="font-semibold text-[var(--color-text-primary)] underline underline-offset-4">Contact us</Link>.
            </p>
          </div>
          <div data-reveal style={delay(1)}>
            <Faq items={pricingFaq} idPrefix="pricing-faq" />
          </div>
        </div>
      </section>

      <CtaBand />
    </>
  );
}
