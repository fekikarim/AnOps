import Link from "next/link";
import type { Metadata } from "next";
import { container } from "@/shared/components/marketing/styles";
import { AnimatedIcon } from "@/shared/components/portal/animated-icon";
import { IndustryExplorer } from "@/shared/components/portal/industry-explorer";
import { CtaBand, PageHero, SectionHeading, delay } from "@/shared/components/portal/sections";
import { IconArrowRight } from "@/shared/components/ui/brand-icons";
import { getApp } from "@/shared/config/catalog";
import { industries } from "@/shared/config/industries";

export const metadata: Metadata = {
  title: "Industries",
  description:
    "How AnOps supports manufacturing, distribution, retail, professional services, agencies and multi-company groups with connected applications.",
};

const contrast = [
  { topic: "Records", before: "Copied between tools and spreadsheets", after: "Entered once, used by every app that needs them" },
  { topic: "Access", before: "Separate accounts and permissions per tool", after: "One role per company, checked on every request" },
  { topic: "Stock and money", before: "Reconciled by hand at month-end", after: "Updated together in one transaction" },
  { topic: "AI", before: "Generic chat with no view of your data", after: "Works through your permissions and asks before it acts" },
  { topic: "Several entities", before: "One subscription and login per company", after: "Switch companies from one account" },
];

export default function IndustriesPage() {
  return (
    <>
      <PageHero
        eyebrow="Industry solutions"
        title="Different businesses. The same need for one clear picture."
        lead="Pick your industry to see the problems AnOps addresses, the applications involved and how work flows between them."
      />

      <section className={`${container} py-16 sm:py-24`} aria-labelledby="explorer-heading">
        <SectionHeading id="explorer-heading" eyebrow="Explore" title="From challenge to application." />
        <div className="mt-10" data-reveal style={delay(1)}>
          <IndustryExplorer />
        </div>
      </section>

      <section className="border-y border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]/50" aria-labelledby="all-heading">
        <div className={`${container} py-16 sm:py-24`}>
          <SectionHeading id="all-heading" eyebrow="All industries" title="Find your starting point." />
          <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {industries.map((industry, index) => (
              <li key={industry.slug} data-reveal style={delay(index, 60)}>
                <Link
                  href={`/industries/${industry.slug}`}
                  style={{ ["--accent" as string]: industry.accent }}
                  className="group relative flex h-full flex-col overflow-hidden rounded-[18px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-6 transition-[border-color,box-shadow] duration-300 hover:border-[color-mix(in_oklab,var(--accent)_55%,var(--color-border-subtle))] hover:shadow-[0_18px_40px_-26px_var(--accent)]"
                >
                  <div aria-hidden="true" className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-[var(--accent)] opacity-10 blur-2xl transition-opacity group-hover:opacity-25" />
                  <AnimatedIcon icon={industry.icon} size={56} />
                  <h3 className="mt-5 text-xl font-semibold tracking-[-0.02em] text-[var(--color-text-primary)]">{industry.name}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">{industry.summary}</p>
                  <p className="mt-5 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-text-secondary)]">
                    {industry.apps.length} apps · {industry.challenges.length} challenges
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {industry.apps.map((slug) => (
                      <span key={slug} className="rounded-full bg-[var(--color-bg-subtle)] px-2.5 py-1 text-xs text-[var(--color-text-secondary)]">
                        {getApp(slug)?.name}
                      </span>
                    ))}
                  </div>
                  <span className="mt-auto inline-flex items-center gap-1.5 pt-6 text-sm font-semibold text-[var(--color-text-primary)]">
                    Read the solution
                    <IconArrowRight size={13} className="transition-transform group-hover:translate-x-1" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className={`${container} py-16 sm:py-24`} aria-labelledby="contrast-heading">
        <SectionHeading
          id="contrast-heading"
          eyebrow="Centralized operations"
          title="What changes when your tools stop working alone."
          lead="Disconnected tools can each be good at one job. The cost appears between them. This is what one platform changes."
        />
        <div className="mt-10 overflow-hidden rounded-[18px] border border-[var(--color-border-subtle)]" data-reveal>
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Disconnected tools compared with one connected platform</caption>
            <thead className="bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)]">
              <tr>
                <th scope="col" className="hidden px-5 py-3 font-semibold sm:table-cell">
                  Topic
                </th>
                <th scope="col" className="px-5 py-3 font-semibold">
                  Disconnected tools
                </th>
                <th scope="col" className="px-5 py-3 font-semibold text-[var(--color-text-primary)]">
                  With AnOps
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
              {contrast.map((row) => (
                <tr key={row.topic}>
                  <th scope="row" className="hidden px-5 py-4 font-semibold text-[var(--color-text-primary)] sm:table-cell">
                    {row.topic}
                  </th>
                  <td className="px-5 py-4 text-[var(--color-text-secondary)]">
                    <span className="block text-xs font-semibold text-[var(--color-text-primary)] sm:hidden">{row.topic}</span>
                    {row.before}
                  </td>
                  <td className="px-5 py-4 font-medium text-[var(--color-text-primary)]">{row.after}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <CtaBand title="Tell us how your business runs." body="Start free with one application, or talk to us about the setup that fits your industry." />
    </>
  );
}
