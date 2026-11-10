import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { container } from "@/shared/components/marketing/styles";
import { AnimatedIcon } from "@/shared/components/portal/animated-icon";
import { Eyebrow } from "@/shared/components/portal/sections";
import { IconArrowRight } from "@/shared/components/ui/brand-icons";
import { getApp } from "@/shared/config/catalog";
import { docs, getDoc, type Doc } from "@/shared/config/docs";
import { cn } from "@/shared/lib/utils";

type Params = Promise<{ slug: string }>;

const groups: { kind: Doc["kind"]; label: string }[] = [
  { kind: "start", label: "Start here" },
  { kind: "guide", label: "Guides" },
  { kind: "app", label: "Application reference" },
];

const anchor = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export function generateStaticParams() {
  return docs.map((doc) => ({ slug: doc.slug }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const doc = getDoc(slug);
  if (!doc) return { title: "Page not found" };
  return { title: `${doc.title} · Docs`, description: doc.summary };
}

export default async function DocPage({ params }: { params: Params }) {
  const { slug } = await params;
  const doc = getDoc(slug);
  if (!doc) notFound();

  const app = doc.app ? getApp(doc.app) : undefined;
  const ordered = groups.flatMap((group) => docs.filter((item) => item.kind === group.kind));
  const index = ordered.findIndex((item) => item.slug === doc.slug);
  const next = ordered[index + 1];

  return (
    <div className={`${container} grid gap-10 py-10 sm:py-14 lg:grid-cols-[240px_1fr] xl:grid-cols-[240px_1fr_200px]`}>
      <aside className="hidden lg:block">
        <nav aria-label="Documentation" className="sticky top-24 max-h-[calc(100dvh-7rem)] overflow-y-auto pr-2 text-sm">
          <Link href="/docs" className="font-semibold text-[var(--color-text-primary)] hover:underline">
            All documentation
          </Link>
          {groups.map((group) => (
            <div key={group.kind} className="mt-6">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-secondary)]">{group.label}</p>
              <ul className="mt-2 space-y-0.5 border-l border-[var(--color-border-subtle)]">
                {docs
                  .filter((item) => item.kind === group.kind)
                  .map((item) => (
                    <li key={item.slug}>
                      <Link
                        href={`/docs/${item.slug}`}
                        aria-current={item.slug === doc.slug ? "page" : undefined}
                        className={cn(
                          "-ml-px block border-l py-1.5 pl-3 transition-colors",
                          item.slug === doc.slug
                            ? "border-[var(--color-text-primary)] font-semibold text-[var(--color-text-primary)]"
                            : "border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                        )}
                      >
                        {item.kind === "app" ? (getApp(item.app ?? "")?.name ?? item.title) : item.title}
                      </Link>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      <article className="min-w-0 max-w-[720px]">
        <nav aria-label="Breadcrumb" className="text-sm text-[var(--color-text-secondary)]">
          <Link href="/docs" className="hover:text-[var(--color-text-primary)] hover:underline">
            Docs
          </Link>
          <span aria-hidden="true"> / </span>
          <span>{groups.find((group) => group.kind === doc.kind)?.label}</span>
        </nav>
        <div className="mt-6 flex items-center gap-4">
          <AnimatedIcon icon={doc.icon} size={56} play="always" />
          <Eyebrow>{doc.minutes} min read</Eyebrow>
        </div>
        <h1 className="mt-6 font-[family-name:var(--font-heading)] text-[34px] leading-[1.1] tracking-[-0.035em] text-[var(--color-text-primary)] sm:text-[44px]">{doc.title}</h1>
        <p className="mt-4 text-lg leading-relaxed text-[var(--color-text-secondary)]">{doc.summary}</p>

        <div className="mt-10 space-y-12">
          {doc.sections.map((section) => (
            <section key={section.heading} id={anchor(section.heading)} className="scroll-mt-24">
              <h2 className="font-[family-name:var(--font-heading)] text-2xl font-semibold tracking-[-0.025em] text-[var(--color-text-primary)]">{section.heading}</h2>
              {section.body && <p className="mt-3 text-base leading-relaxed text-[var(--color-text-secondary)]">{section.body}</p>}
              {section.steps && (
                <ol className="mt-5 space-y-4">
                  {section.steps.map((step, i) => (
                    <li key={step} className="flex gap-4">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-action-primary)] text-xs font-semibold text-[#111F1D]">{i + 1}</span>
                      <span className="pt-0.5 text-base leading-relaxed text-[var(--color-text-primary)]">{step}</span>
                    </li>
                  ))}
                </ol>
              )}
              {section.list && (
                <ul className="mt-4 space-y-2.5">
                  {section.list.map((item) => (
                    <li key={item} className="flex gap-3 text-base leading-relaxed text-[var(--color-text-primary)]">
                      <span aria-hidden="true" className="mt-[11px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-text-secondary)]" />
                      {item}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>

        <div className="mt-14 grid gap-3 border-t border-[var(--color-border-subtle)] pt-8 sm:grid-cols-2">
          {app && (
            <Link href={`/apps/${app.slug}`} className="group flex items-center gap-4 rounded-[14px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 hover:border-[var(--color-border-control)]">
              <AnimatedIcon icon={app.icon} size={40} />
              <span>
                <span className="block text-xs text-[var(--color-text-secondary)]">About the app</span>
                <span className="block text-sm font-semibold text-[var(--color-text-primary)]">{app.name}</span>
              </span>
            </Link>
          )}
          {next && (
            <Link href={`/docs/${next.slug}`} className="group flex items-center justify-between gap-4 rounded-[14px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 hover:border-[var(--color-border-control)] sm:col-start-2">
              <span>
                <span className="block text-xs text-[var(--color-text-secondary)]">Next</span>
                <span className="block text-sm font-semibold text-[var(--color-text-primary)]">{next.title}</span>
              </span>
              <IconArrowRight size={14} className="shrink-0 transition-transform group-hover:translate-x-1" />
            </Link>
          )}
        </div>
        <p className="mt-8 text-sm text-[var(--color-text-secondary)]">
          Something unclear or out of date? <Link href="/community-hub#feedback" className="font-semibold text-[var(--color-text-primary)] underline underline-offset-4">Send feedback</Link>.
        </p>
      </article>

      <aside className="hidden xl:block">
        <nav aria-label="On this page" className="sticky top-24 text-sm">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-secondary)]">On this page</p>
          <ul className="mt-3 space-y-2">
            {doc.sections.map((section) => (
              <li key={section.heading}>
                <a href={`#${anchor(section.heading)}`} className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
                  {section.heading}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
    </div>
  );
}
