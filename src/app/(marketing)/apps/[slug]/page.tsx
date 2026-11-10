import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { IconArrowRight, IconCheck } from "@/shared/components/ui/brand-icons";
import { StatusBadge } from "@/shared/components/marketing/status-badge";
import { btnPrimary, btnSecondary, container } from "@/shared/components/marketing/styles";
import { AnimatedIcon } from "@/shared/components/portal/animated-icon";
import { AppPreview } from "@/shared/components/portal/app-preview";
import { AppTile, CtaBand, Eyebrow, Notice, SectionHeading, delay, display } from "@/shared/components/portal/sections";
import { apps, getApp, getCategory, relatedApps } from "@/shared/config/catalog";
import { docsForApp } from "@/shared/config/docs";
import { industries } from "@/shared/config/industries";

type Params = Promise<{ slug: string }>;

export function generateStaticParams() {
  return apps.map((app) => ({ slug: app.slug }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const app = getApp(slug);
  if (!app) return { title: "App not found" };
  return {
    title: `${app.name}: ${app.tagline}`,
    description: app.summary,
    openGraph: { title: `${app.name} · AnOps`, description: app.summary },
  };
}

export default async function AppDetailPage({ params }: { params: Params }) {
  const { slug } = await params;
  const app = getApp(slug);
  if (!app) notFound();

  const category = getCategory(app.category);
  const related = relatedApps(app);
  const guides = docsForApp(app.slug);
  const usedIn = industries.filter((industry) => industry.apps.includes(app.slug));
  const index = apps.findIndex((item) => item.slug === app.slug);
  const prev = apps[(index - 1 + apps.length) % apps.length];
  const next = apps[(index + 1) % apps.length];
  const available = app.status === "available";

  return (
    <div style={{ ["--accent" as string]: app.accent }}>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-[var(--color-border-subtle)]">
        <div aria-hidden="true" className="portal-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_top_right,black_10%,transparent_65%)]" />
        <div aria-hidden="true" className="pointer-events-none absolute -right-40 -top-40 h-[480px] w-[480px] rounded-full bg-[var(--accent)] opacity-[0.14] blur-[110px]" />
        <div className={`${container} relative pb-16 pt-10 sm:pb-24 sm:pt-14`}>
          <nav aria-label="Breadcrumb" className="text-sm text-[var(--color-text-secondary)]">
            <ol className="flex flex-wrap items-center gap-2">
              <li>
                <Link href="/apps" className="hover:text-[var(--color-text-primary)] hover:underline">
                  Apps
                </Link>
              </li>
              <li aria-hidden="true">/</li>
              <li>
                <Link href={`/apps?category=${category.id}`} className="hover:text-[var(--color-text-primary)] hover:underline">
                  {category.label}
                </Link>
              </li>
              <li aria-hidden="true">/</li>
              <li className="text-[var(--color-text-primary)]" aria-current="page">
                {app.name}
              </li>
            </ol>
          </nav>

          <div className="mt-10 grid items-center gap-12 lg:grid-cols-[1fr_1.05fr]">
            <div data-reveal>
              <div className="flex flex-wrap items-center gap-4">
                <AnimatedIcon icon={app.icon} size={72} play="always" />
                <div>
                  <Eyebrow>{category.label}</Eyebrow>
                  <div className="mt-2">
                    <StatusBadge status={app.status} />
                  </div>
                </div>
              </div>
              <h1 className={`${display} mt-8`}>{app.name}</h1>
              <p className="mt-4 font-[family-name:var(--font-heading)] text-2xl font-medium tracking-[-0.02em] text-[var(--color-text-primary)]">{app.tagline}</p>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-[var(--color-text-secondary)] sm:text-lg">{app.summary}</p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                {available ? (
                  <Link href="/trial" className={`${btnPrimary} h-12 px-6`}>
                    Start free with {app.name}
                    <IconArrowRight size={14} />
                  </Link>
                ) : (
                  <Link href="/contact" className={`${btnPrimary} h-12 px-6`}>
                    Tell us what you need
                    <IconArrowRight size={14} />
                  </Link>
                )}
                <Link href="/pricing" className={`${btnSecondary} h-12 px-6`}>
                  Compare plans
                </Link>
              </div>
            </div>
            <div data-reveal="scale" style={delay(2)}>
              <AppPreview app={app} />
            </div>
          </div>
        </div>
      </section>

      {/* Overview + features */}
      <section className={`${container} py-20 sm:py-28`} aria-labelledby="features-heading">
        <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          <div data-reveal className="lg:sticky lg:top-28 lg:self-start">
            <Eyebrow>Overview</Eyebrow>
            <h2 id="features-heading" className="mt-4 font-[family-name:var(--font-heading)] text-[30px] leading-[1.1] tracking-[-0.035em] text-[var(--color-text-primary)] sm:text-[38px]">
              {available ? "What you can do" : "What is planned"}
            </h2>
            <p className="mt-5 text-base leading-relaxed text-[var(--color-text-secondary)]">{app.intro}</p>
            {!available && (
              <div className="mt-6">
                <Notice>{app.notes[0]}</Notice>
              </div>
            )}
          </div>
          <ol className="grid gap-4 sm:grid-cols-2">
            {app.features.map((feature, i) => (
              <li
                key={feature.title}
                data-reveal
                style={delay(i, 60)}
                className="relative rounded-[16px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-6"
              >
                <span aria-hidden="true" className="absolute left-6 top-0 h-[3px] w-10 rounded-b-full bg-[var(--accent)]" />
                <span className="text-xs font-semibold text-[var(--color-text-secondary)]">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="mt-3 text-base font-semibold text-[var(--color-text-primary)]">{feature.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">{feature.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Use cases + benefits */}
      <section className="border-y border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]/50" aria-labelledby="usecases-heading">
        <div className={`${container} grid gap-12 py-20 sm:py-24 lg:grid-cols-[1.2fr_0.8fr]`}>
          <div>
            <SectionHeading id="usecases-heading" eyebrow="Use cases" title={`Where ${app.name} helps`} />
            <ul className="mt-10 space-y-4">
              {app.useCases.map((useCase, i) => (
                <li key={useCase.title} data-reveal style={delay(i)} className="flex gap-5 rounded-[16px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-6">
                  <span aria-hidden="true" className="font-[family-name:var(--font-heading)] text-3xl font-semibold leading-none text-[color-mix(in_oklab,var(--accent)_65%,var(--color-text-primary))]">
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="text-base font-semibold text-[var(--color-text-primary)]">{useCase.title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-text-secondary)]">{useCase.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div data-reveal style={delay(1)} className="self-start rounded-[20px] portal-ink p-7 sm:p-8">
            <h2 className="font-[family-name:var(--font-heading)] text-xl font-semibold tracking-[-0.02em]">Business value</h2>
            <ul className="mt-6 space-y-4">
              {app.benefits.map((benefit) => (
                <li key={benefit} className="flex gap-3 text-sm leading-relaxed">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#C8F03E] text-[#111F1D]">
                    <IconCheck size={10} />
                  </span>
                  {benefit}
                </li>
              ))}
            </ul>
            {available && app.notes.length > 0 && (
              <div className="mt-8 border-t border-[var(--color-border-subtle)] pt-6">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-text-secondary)]">Good to know</p>
                <ul className="mt-3 space-y-2">
                  {app.notes.map((note) => (
                    <li key={note} className="text-sm leading-relaxed text-[var(--color-text-secondary)]">
                      {note}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Related apps */}
      <section className={`${container} py-20 sm:py-28`} aria-labelledby="related-heading">
        <SectionHeading
          id="related-heading"
          eyebrow="Works with"
          title={`${app.name} shares records with`}
          lead="Applications that read or update the same records, so information flows without being re-entered."
        />
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {related.map((item, i) => (
            <li key={item.slug}>
              <AppTile app={item} index={i} compact />
            </li>
          ))}
        </ul>
      </section>

      {/* Learn + industries */}
      <section className="border-t border-[var(--color-border-subtle)]" aria-label="Learn more">
        <div className={`${container} grid gap-10 py-16 sm:py-20 md:grid-cols-2`}>
          <div data-reveal>
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Documentation</h2>
            <ul className="mt-4 divide-y divide-[var(--color-border-subtle)] border-y border-[var(--color-border-subtle)]">
              {guides.map((doc) => (
                <li key={doc.slug}>
                  <Link href={`/docs/${doc.slug}`} className="group flex min-h-[56px] items-center justify-between gap-4 py-3 text-sm">
                    <span>
                      <span className="block font-semibold text-[var(--color-text-primary)]">{doc.title}</span>
                      <span className="block text-[var(--color-text-secondary)]">{doc.kind === "guide" ? "Guide" : "Reference"} · {doc.minutes} min read</span>
                    </span>
                    <IconArrowRight size={14} className="shrink-0 transition-transform group-hover:translate-x-1" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          {usedIn.length > 0 && (
            <div data-reveal style={delay(1)}>
              <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Used in these industries</h2>
              <ul className="mt-4 flex flex-wrap gap-2">
                {usedIn.map((industry) => (
                  <li key={industry.slug}>
                    <Link
                      href={`/industries/${industry.slug}`}
                      className="inline-flex min-h-[40px] items-center rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-4 text-sm font-medium text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-border-control)]"
                    >
                      {industry.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      {/* Prev / next */}
      <nav aria-label="More applications" className={`${container} grid gap-3 pb-16 sm:grid-cols-2`}>
        {[
          { label: "Previous", app: prev },
          { label: "Next", app: next },
        ].map((item) => (
          <Link
            key={item.label}
            href={`/apps/${item.app.slug}`}
            className={`group flex items-center gap-4 rounded-[16px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 transition-colors hover:border-[var(--color-border-control)] ${item.label === "Next" ? "sm:flex-row-reverse sm:text-right" : ""}`}
          >
            <AnimatedIcon icon={item.app.icon} size={44} />
            <span>
              <span className="block text-xs text-[var(--color-text-secondary)]">{item.label}</span>
              <span className="block text-sm font-semibold text-[var(--color-text-primary)]">{item.app.name}</span>
            </span>
          </Link>
        ))}
      </nav>

      <CtaBand />
    </div>
  );
}
