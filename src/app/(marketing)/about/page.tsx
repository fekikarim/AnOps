import Link from "next/link";
import type { Metadata } from "next";
import { IconArrowRight } from "@/shared/components/ui/brand-icons";
import { card, container, eyebrow, headingLg, headingXl, lead, sectionY } from "@/shared/components/marketing/styles";
import { siteDescription } from "@/shared/config/site";

export const metadata: Metadata = {
  title: "About",
  description: "What AnOps is, how it is built, and how we think about AI in business operations.",
};

const principles = [
  {
    title: "One connected platform",
    body: "Modular apps that share one set of records, so teams work from the same information rather than copying it between tools.",
  },
  {
    title: "AI that suggests, people who decide",
    body: "AI features draft, summarize and forecast. Authorized people review and approve every action that changes a record.",
  },
  {
    title: "Honest about progress",
    body: "Every app shows whether it is In Progress or Coming Soon. We do not present planned work as available.",
  },
];

export default function AboutPage() {
  return (
    <>
      <section className={`${container} pb-8 pt-16 sm:pt-20`}>
        <p className={eyebrow}>About AnOps</p>
        <h1 className={`${headingXl} mt-3 max-w-3xl`}>One platform. Every operation.</h1>
        <p className={`${lead} mt-5 max-w-2xl`}>{siteDescription}</p>
      </section>

      <section className={`${container} ${sectionY} scroll-reveal border-t border-[var(--color-border-subtle)]`} aria-labelledby="principles-heading">
        <h2 id="principles-heading" className={headingLg}>
          How we build
        </h2>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {principles.map((principle, index) => (
            <div key={principle.title} className={`${card} p-6`}>
              <p className="text-xs font-semibold text-[var(--color-text-secondary)]">0{index + 1}</p>
              <h3 className="mt-3 text-lg font-semibold text-[var(--color-text-primary)]">{principle.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">{principle.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className={`${container} ${sectionY} scroll-reveal border-t border-[var(--color-border-subtle)]`}>
        <h2 className={headingLg}>Want to know more?</h2>
        <p className={`${lead} mt-4 max-w-2xl`}>Explore the apps, compare plans, or reach out to talk about your operations.</p>
        <div className="mt-8 flex flex-wrap gap-6 text-sm font-semibold text-[var(--color-text-primary)]">
          <Link href="/apps" className="inline-flex items-center gap-2 hover:underline">
            Explore apps <IconArrowRight size={14} />
          </Link>
          <Link href="/pricing" className="inline-flex items-center gap-2 hover:underline">
            View pricing <IconArrowRight size={14} />
          </Link>
          <Link href="/contact" className="inline-flex items-center gap-2 hover:underline">
            Contact us <IconArrowRight size={14} />
          </Link>
        </div>
      </section>
    </>
  );
}
