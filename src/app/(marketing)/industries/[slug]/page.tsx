import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { container } from "@/shared/components/marketing/styles";
import { AnimatedIcon } from "@/shared/components/portal/animated-icon";
import { FlowDiagram } from "@/shared/components/portal/flow-diagram";
import { AppTile, CtaBand, Eyebrow, SectionHeading, delay, display } from "@/shared/components/portal/sections";
import { IconArrowRight, IconCheck } from "@/shared/components/ui/brand-icons";
import { getApp, type App } from "@/shared/config/catalog";
import { getIndustry, industries } from "@/shared/config/industries";

type Params = Promise<{ slug: string }>;

export function generateStaticParams() {
  return industries.map((industry) => ({ slug: industry.slug }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const industry = getIndustry(slug);
  if (!industry) return { title: "Industry not found" };
  return { title: `AnOps for ${industry.name}`, description: industry.summary };
}

export default async function IndustryPage({ params }: { params: Params }) {
  const { slug } = await params;
  const industry = getIndustry(slug);
  if (!industry) notFound();

  const apps = industry.apps.map((item) => getApp(item)).filter((item): item is App => item !== undefined);
  const others = industries.filter((item) => item.slug !== industry.slug);

  return (
    <div style={{ ["--accent" as string]: industry.accent }}>
      <section className="relative overflow-hidden border-b border-[var(--color-border-subtle)]">
        <div aria-hidden="true" className="portal-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_top_right,black_10%,transparent_65%)]" />
        <div aria-hidden="true" className="pointer-events-none absolute -right-40 -top-40 h-[460px] w-[460px] rounded-full bg-[var(--accent)] opacity-[0.14] blur-[110px]" />
        <div className={`${container} relative pb-16 pt-10 sm:pb-24 sm:pt-14`}>
          <nav aria-label="Breadcrumb" className="text-sm text-[var(--color-text-secondary)]">
            <ol className="flex flex-wrap items-center gap-2">
              <li>
                <Link href="/industries" className="hover:text-[var(--color-text-primary)] hover:underline">
                  Industries
                </Link>
              </li>
              <li aria-hidden="true">/</li>
              <li aria-current="page" className="text-[var(--color-text-primary)]">
                {industry.name}
              </li>
            </ol>
          </nav>
          <div className="mt-10 max-w-3xl" data-reveal>
            <AnimatedIcon icon={industry.icon} size={72} play="always" />
            <Eyebrow className="mt-8">AnOps for {industry.name}</Eyebrow>
            <h1 className={`${display} mt-4`}>{industry.name}</h1>
            <p className="mt-5 font-[family-name:var(--font-heading)] text-xl font-medium tracking-[-0.02em] text-[var(--color-text-primary)] sm:text-2xl">{industry.summary}</p>
            <p className="mt-5 text-base leading-relaxed text-[var(--color-text-secondary)] sm:text-lg">{industry.intro}</p>
          </div>
        </div>
      </section>

      <section className={`${container} py-16 sm:py-24`} aria-labelledby="challenges-heading">
        <SectionHeading id="challenges-heading" eyebrow="The challenges" title="What gets in the way today." />
        <ul className="mt-10 grid gap-4 md:grid-cols-3">
          {industry.challenges.map((challenge, i) => (
            <li key={challenge.title} data-reveal style={delay(i)} className="rounded-[16px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-6">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-status-error-bg)] text-sm font-semibold text-[var(--color-status-error)]">{i + 1}</span>
              <h3 className="mt-4 text-base font-semibold text-[var(--color-text-primary)]">{challenge.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">{challenge.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="border-y border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]/50" aria-labelledby="answers-heading">
        <div className={`${container} py-16 sm:py-24`}>
          <SectionHeading id="answers-heading" eyebrow="How AnOps helps" title="Each challenge, the app that handles it." />
          <ol className="mt-10 space-y-3">
            {industry.answers.map((answer, i) => {
              const app = getApp(answer.app);
              return (
                <li key={answer.challenge} data-reveal style={delay(i)} className="group grid items-center gap-4 rounded-[16px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 md:grid-cols-[1fr_auto_1.6fr]">
                  <p className="text-sm font-semibold text-[var(--color-text-primary)]">{answer.challenge}</p>
                  <IconArrowRight size={16} className="hidden text-[var(--color-text-secondary)] md:block" />
                  <div className="flex items-start gap-4">
                    {app && <AnimatedIcon icon={app.icon} size={44} />}
                    <div>
                      <Link href={`/apps/${answer.app}`} className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:underline">
                        {app?.name}
                      </Link>
                      <p className="mt-1 text-sm leading-relaxed text-[var(--color-text-primary)]">{answer.how}</p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      <section className={`${container} py-16 sm:py-24`} aria-labelledby="flow-heading">
        <SectionHeading
          id="flow-heading"
          eyebrow="A typical workflow"
          title="How work moves between applications."
          lead="Each step builds on the record created before it."
        />
        <div className="mt-10">
          <FlowDiagram steps={industry.flow} />
        </div>
      </section>

      <section className="border-t border-[var(--color-border-subtle)]" aria-labelledby="apps-heading">
        <div className={`${container} grid gap-12 py-16 sm:py-24 lg:grid-cols-[1fr_320px]`}>
          <div>
            <SectionHeading id="apps-heading" eyebrow="Applications" title="The apps in this solution." />
            <ul className="mt-10 grid gap-4 sm:grid-cols-2">
              {apps.map((app, i) => (
                <li key={app.slug}>
                  <AppTile app={app} index={i} compact />
                </li>
              ))}
            </ul>
          </div>
          <aside data-reveal className="portal-ink self-start rounded-[20px] p-7">
            <h2 className="font-[family-name:var(--font-heading)] text-xl font-semibold">What you can expect</h2>
            <ul className="mt-5 space-y-4">
              {industry.outcomes.map((outcome) => (
                <li key={outcome} className="flex gap-3 text-sm leading-relaxed">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#C8F03E] text-[#111F1D]">
                    <IconCheck size={10} />
                  </span>
                  {outcome}
                </li>
              ))}
            </ul>
            <p className="mt-6 text-xs leading-relaxed text-[var(--color-text-secondary)]">
              Outcomes depend on how you set up and use the applications. AnOps does not publish customer benchmarks yet.
            </p>
          </aside>
        </div>
      </section>

      <section className="border-t border-[var(--color-border-subtle)]" aria-labelledby="others-heading">
        <div className={`${container} py-14`}>
          <h2 id="others-heading" className="text-lg font-semibold text-[var(--color-text-primary)]">
            Other industries
          </h2>
          <ul className="mt-5 flex flex-wrap gap-2">
            {others.map((item) => (
              <li key={item.slug}>
                <Link href={`/industries/${item.slug}`} className="group inline-flex min-h-[44px] items-center gap-2 rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] py-1 pl-1 pr-4 text-sm font-medium text-[var(--color-text-primary)] hover:border-[var(--color-border-control)]">
                  <AnimatedIcon icon={item.icon} size={32} />
                  {item.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <CtaBand title={`Run your ${industry.name.toLowerCase()} business on one platform.`} />
    </div>
  );
}
