import type { Metadata } from "next";
import { container } from "@/shared/components/marketing/styles";
import { AiCommandDemo } from "@/shared/components/home/ai-command-demo";
import { EcosystemOrbit } from "@/shared/components/home/ecosystem-orbit";
import { FinalScene } from "@/shared/components/home/final-scene";
import { HomeHero } from "@/shared/components/home/hero";
import { OnboardingDemo } from "@/shared/components/home/onboarding-demo";
import { IntelligentOperations } from "@/shared/components/home/operations";
import { ScrollScene } from "@/shared/components/home/scroll-scene";
import { Eyebrow, SectionHeading, TextLink } from "@/shared/components/portal/sections";
import { apps } from "@/shared/config/catalog";
import { siteDescription } from "@/shared/config/site";

export const metadata: Metadata = {
  title: "AnOps | One platform. Every operation.",
  description: siteDescription,
  openGraph: {
    title: "AnOps | One platform. Every operation.",
    description: siteDescription,
    type: "website",
  },
};

/**
 * The homepage is told in six scenes (see ANOPS_HOMEPAGE_MOTION_ROADMAP.md):
 * hero → AI Command Center → getting started → ecosystem → operations → closing.
 * Demos are sandboxed: sample data in the browser, no requests, nothing saved.
 */
export default function HomePage() {
  return (
    <>
      <HomeHero />

      {/* Scene 2: the Command Center rises from the bottom and settles in the centre. */}
      <ScrollScene id="command-center" labelledBy="ai-title" length="lg" className="portal-ink scroll-mt-16" stickClassName="py-10 md:py-6">
        <div aria-hidden="true" className="portal-grid pointer-events-none absolute inset-0 opacity-40 [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" />
        <div className={`${container} home-scene-body relative flex min-h-0 flex-1 flex-col`}>
          <div className="home-fade-up shrink-0 text-center">
            <Eyebrow className="justify-center">AnOps AI Command Center</Eyebrow>
            <h2 id="ai-title" className="mx-auto mt-3 max-w-3xl font-[family-name:var(--font-heading)] text-[30px] font-semibold leading-[1.06] tracking-[-0.04em] text-[#F7F7F2] sm:text-[44px] md:[@media(max-height:820px)]:text-[34px]">
              Ask in plain language. Confirm what changes.
            </h2>
            <p className="mx-auto mt-3 hidden max-w-xl text-base text-[#B4BFB7] sm:block md:[@media(max-height:820px)]:hidden">Try it below. This is a sandbox with sample data: nothing you do here touches a real organization.</p>
          </div>
          <div className="home-emerge home-panel mx-auto mt-6 flex min-h-0 w-full max-w-[1000px] md:mt-8 md:[@media(max-height:820px)]:mt-5">
            <AiCommandDemo />
          </div>
        </div>
      </ScrollScene>

      {/* Scene 3 */}
      <section className="relative" aria-labelledby="start-title">
        <div className={`${container} py-20 sm:py-28`}>
          <SectionHeading
            id="start-title"
            eyebrow="Getting started"
            title="From first click to a working team in minutes."
            lead="Choose your applications, create the owner account, activate your organization and invite colleagues. That is all it takes."
            action={<TextLink href="/trial">Start now</TextLink>}
          />
          <div className="mt-12 lg:mt-4">
            <OnboardingDemo />
          </div>
        </div>
      </section>

      {/* Scene 4 */}
      <section className="border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]/40" aria-labelledby="eco-title">
        <div className={`${container} py-20 sm:py-28`}>
          <SectionHeading
            id="eco-title"
            eyebrow="Your business ecosystem"
            title={`${apps.length} applications. One set of records.`}
            lead="Every application works on the same organization, people, products, suppliers and customers. Pick one to see what it shares."
            action={<TextLink href="/apps">Open the app directory</TextLink>}
          />
          <div className="mt-12 sm:mt-16">
            <EcosystemOrbit />
          </div>
        </div>
      </section>

      {/* Scene 5 */}
      <section className="border-t border-[var(--color-border-subtle)]" aria-labelledby="ops-title">
        <div className={`${container} py-20 sm:py-28`}>
          <SectionHeading
            id="ops-title"
            eyebrow="Intelligent operations"
            title="Less coordination. More done."
            lead="Automation, AI and connected records that work today, and a clear view of what comes next."
          />
          <div className="mt-12">
            <IntelligentOperations />
          </div>
        </div>
      </section>

      {/* Scene 6 */}
      <FinalScene />
    </>
  );
}
