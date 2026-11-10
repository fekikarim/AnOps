import Link from "next/link";
import type { Metadata } from "next";
import { container } from "@/shared/components/marketing/styles";
import { AnimatedIcon } from "@/shared/components/portal/animated-icon";
import { DocsSearch } from "@/shared/components/portal/docs-search";
import { PageHero, SectionHeading, delay } from "@/shared/components/portal/sections";
import { StatusBadge } from "@/shared/components/marketing/status-badge";
import { getApp } from "@/shared/config/catalog";
import { docs } from "@/shared/config/docs";

export const metadata: Metadata = {
  title: "Documentation",
  description: "AnOps documentation: getting started, roles and permissions, references for every application and step-by-step guides.",
};

export default function DocsPage() {
  const start = docs.filter((doc) => doc.kind === "start");
  const refs = docs.filter((doc) => doc.kind === "app");
  const guides = docs.filter((doc) => doc.kind === "guide");

  return (
    <>
      <PageHero eyebrow="Documentation" title="Everything you need to run AnOps." lead="Get started, understand roles, read the reference for each application and follow guides for real workflows.">
        <div className="mt-8 max-w-xl">
          <DocsSearch docs={docs} />
        </div>
      </PageHero>

      <section className={`${container} py-14 sm:py-20`} aria-labelledby="start-heading">
        <SectionHeading id="start-heading" eyebrow="Start here" title="The basics." />
        <ul className="mt-8 grid gap-4 md:grid-cols-2">
          {start.map((doc, i) => (
            <li key={doc.slug} data-reveal style={delay(i)}>
              <Link href={`/docs/${doc.slug}`} className="group flex h-full gap-5 rounded-[18px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-6 hover:border-[var(--color-border-control)]">
                <AnimatedIcon icon={doc.icon} size={56} />
                <span>
                  <span className="block text-lg font-semibold text-[var(--color-text-primary)]">{doc.title}</span>
                  <span className="mt-1 block text-sm leading-relaxed text-[var(--color-text-secondary)]">{doc.summary}</span>
                  <span className="mt-3 block text-xs font-semibold text-[var(--color-text-secondary)]">{doc.minutes} min read</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="border-y border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]/50" aria-labelledby="refs-heading">
        <div className={`${container} py-14 sm:py-20`}>
          <SectionHeading id="refs-heading" eyebrow="Application reference" title="One page per application." />
          <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {refs.map((doc, i) => {
              const app = doc.app ? getApp(doc.app) : undefined;
              return (
                <li key={doc.slug} data-reveal style={delay(i, 40)}>
                  <Link href={`/docs/${doc.slug}`} className="group flex h-full items-center gap-4 rounded-[14px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 hover:border-[var(--color-border-control)]">
                    <AnimatedIcon icon={doc.icon} size={44} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
                        {app?.name}
                        {app && app.status !== "available" && <StatusBadge status={app.status} />}
                      </span>
                      <span className="block truncate text-xs text-[var(--color-text-secondary)]">{app?.tagline}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <section id="guides" className={`${container} scroll-mt-24 py-14 sm:py-20`} aria-labelledby="guides-heading">
        <SectionHeading id="guides-heading" eyebrow="Guides & tutorials" title="Step by step, from start to finish." />
        <ol className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {guides.map((doc, i) => (
            <li key={doc.slug} data-reveal style={delay(i, 50)}>
              <Link href={`/docs/${doc.slug}`} className="group flex h-full flex-col rounded-[18px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-6 hover:border-[var(--color-border-control)]">
                <div className="flex items-center justify-between">
                  <AnimatedIcon icon={doc.icon} size={48} />
                  <span className="text-xs font-semibold text-[var(--color-text-secondary)]">{doc.minutes} min</span>
                </div>
                <span className="mt-5 text-base font-semibold text-[var(--color-text-primary)]">{doc.title}</span>
                <span className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">{doc.summary}</span>
                <span className="mt-auto pt-4 text-xs font-semibold text-[var(--color-text-secondary)]">{doc.app && getApp(doc.app)?.name}</span>
              </Link>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
