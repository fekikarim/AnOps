import Link from "next/link";
import { container } from "@/shared/components/marketing/styles";
import { AnimatedIcon } from "@/shared/components/portal/animated-icon";
import { LegalToc } from "@/shared/components/portal/legal-toc";
import { Eyebrow } from "@/shared/components/portal/sections";
import { IconArrowRight } from "@/shared/components/ui/brand-icons";
import type { LegalDoc } from "@/shared/config/legal";

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(iso));

/** Shared layout for formal legal pages: summary, sticky contents, numbered sections. */
export function LegalDocument({ doc, related }: { doc: LegalDoc; related: { label: string; href: string } }) {
  const toc = doc.sections.map((section) => ({ id: section.id, title: section.title }));

  return (
    <>
      <header className="relative overflow-hidden border-b border-[var(--color-border-subtle)]">
        <div aria-hidden="true" className="portal-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_top_right,black_5%,transparent_60%)]" />
        <div className={`${container} relative pb-12 pt-12 sm:pb-16 sm:pt-16`}>
          <nav aria-label="Breadcrumb" className="text-sm text-[var(--color-text-secondary)]">
            <Link href="/" className="hover:text-[var(--color-text-primary)] hover:underline">
              Home
            </Link>
            <span aria-hidden="true"> / </span>
            <span>Legal</span>
          </nav>
          <div className="mt-8 flex flex-col gap-6 sm:flex-row sm:items-start">
            <AnimatedIcon icon={doc.icon} size={64} play="always" />
            <div className="min-w-0 max-w-3xl">
              <Eyebrow>Legal</Eyebrow>
              <h1 className="mt-3 font-[family-name:var(--font-heading)] text-[36px] leading-[1.08] tracking-[-0.04em] text-[var(--color-text-primary)] sm:text-[52px]">
                {doc.title}
              </h1>
              <p className="mt-4 text-base leading-relaxed text-[var(--color-text-secondary)] sm:text-lg">{doc.intro}</p>
              <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-2 text-sm">
                <div className="flex gap-2">
                  <dt className="text-[var(--color-text-secondary)]">Last updated</dt>
                  <dd className="font-semibold text-[var(--color-text-primary)]">
                    <time dateTime={doc.updated}>{formatDate(doc.updated)}</time>
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-[var(--color-text-secondary)]">Reading time</dt>
                  <dd className="font-semibold text-[var(--color-text-primary)]">{doc.minutes} min</dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      </header>

      <div className={`${container} grid gap-10 py-10 sm:py-14 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-14`}>
        <aside className="lg:order-none">
          <div className="lg:sticky lg:top-24 lg:max-h-[calc(100dvh-7rem)] lg:overflow-y-auto lg:pr-2">
            <details className="group rounded-[14px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] lg:hidden">
              <summary className="flex min-h-[48px] cursor-pointer list-none items-center justify-between px-4 text-sm font-semibold text-[var(--color-text-primary)] [&::-webkit-details-marker]:hidden">
                On this page
                <span aria-hidden="true" className="text-lg leading-none text-[var(--color-text-secondary)] transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <nav aria-label="On this page" className="faq-answer px-4 pb-4">
                <LegalToc items={toc} />
              </nav>
            </details>
            <nav aria-label="Contents" className="hidden lg:block">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-secondary)]">Contents</p>
              <LegalToc items={toc} />
              <Link href={related.href} className="mt-8 inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)] underline decoration-[var(--color-border-control)] underline-offset-4 hover:decoration-[var(--color-text-primary)]">
                {related.label}
                <IconArrowRight size={13} />
              </Link>
            </nav>
          </div>
        </aside>

        <article className="min-w-0 max-w-[760px]">
          <section aria-labelledby="summary-heading" className="rounded-[18px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 sm:p-7">
            <h2 id="summary-heading" className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-text-secondary)]">
              In short
            </h2>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {doc.summary.map((point) => (
                <li key={point} className="flex gap-3 text-sm leading-relaxed text-[var(--color-text-primary)]">
                  <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-action-primary)] ring-2 ring-[color-mix(in_oklab,var(--color-action-primary)_30%,transparent)]" />
                  {point}
                </li>
              ))}
            </ul>
            <p className="mt-5 border-t border-[var(--color-border-subtle)] pt-4 text-xs leading-relaxed text-[var(--color-text-secondary)]">
              This summary is for convenience only. The full text below is what applies.
            </p>
          </section>

          <div className="mt-12 space-y-12">
            {doc.sections.map((section, index) => (
              <section key={section.id} id={section.id} aria-labelledby={`${section.id}-heading`} className="scroll-mt-24">
                <h2 id={`${section.id}-heading`} className="flex gap-3 font-[family-name:var(--font-heading)] text-[22px] font-semibold leading-tight tracking-[-0.025em] text-[var(--color-text-primary)] sm:text-[26px]">
                  <span className="tabular-nums text-[var(--color-text-secondary)]">{index + 1}.</span>
                  <span>{section.title}</span>
                </h2>
                <div className="mt-4 space-y-4 text-[15px] leading-[1.75] text-[var(--color-text-secondary)] sm:text-base">
                  {section.body?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                  {section.items && (
                    <ul className="space-y-3">
                      {section.items.map((item) => (
                        <li key={item.term ?? item.text} className="flex gap-3">
                          <span aria-hidden="true" className="mt-[11px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-text-secondary)]" />
                          <span>
                            {item.term && <strong className="font-semibold text-[var(--color-text-primary)]">{item.term}. </strong>}
                            {item.text}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {section.table && (
                    <ul className="space-y-3 sm:hidden">
                      {section.table.rows.map((row) => (
                        <li key={row[0]} className="rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4">
                          <p className="break-all font-mono text-xs text-[var(--color-text-primary)]">{row[0]}</p>
                          <dl className="mt-3 space-y-2 text-sm">
                            {row.slice(1).map((cell, i) => (
                              <div key={i}>
                                <dt className="text-xs font-semibold text-[var(--color-text-primary)]">{section.table?.head[i + 1]}</dt>
                                <dd>{cell}</dd>
                              </div>
                            ))}
                          </dl>
                        </li>
                      ))}
                    </ul>
                  )}
                  {section.table && (
                    <div className="hidden overflow-x-auto rounded-[12px] border border-[var(--color-border-subtle)] sm:block" role="region" aria-label={section.title} tabIndex={0}>
                      <table className="w-full min-w-[520px] text-left text-sm">
                        <thead className="bg-[var(--color-bg-subtle)] text-[var(--color-text-primary)]">
                          <tr>
                            {section.table.head.map((cell) => (
                              <th key={cell} scope="col" className="px-4 py-3 font-semibold">
                                {cell}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
                          {section.table.rows.map((row) => (
                            <tr key={row[0]}>
                              {row.map((cell, i) => (
                                <td key={i} className={i === 0 ? "px-4 py-3 align-top font-mono text-xs text-[var(--color-text-primary)]" : "px-4 py-3 align-top"}>
                                  {cell}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {section.after?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                </div>
              </section>
            ))}
          </div>

          <section aria-labelledby="questions-heading" className="portal-ink mt-16 rounded-[20px] p-6 sm:p-8">
            <h2 id="questions-heading" className="font-[family-name:var(--font-heading)] text-xl font-semibold tracking-[-0.02em]">
              Questions about this document?
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">
              Contact us and mention the document title. If your question concerns data inside a company workspace, you can also ask that
              company&apos;s owner or administrator.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Link href="/contact" className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-[var(--radius-control)] bg-[#C8F03E] px-5 text-sm font-semibold text-[#111F1D] transition-colors hover:bg-[#B9DE36]">
                Contact us
                <IconArrowRight size={14} />
              </Link>
              <Link href={related.href} className="inline-flex min-h-[44px] items-center justify-center rounded-[var(--radius-control)] border border-[#5d7a6f] px-5 text-sm font-semibold text-[#F7F7F2] transition-colors hover:bg-[#192B27]">
                {related.label}
              </Link>
            </div>
          </section>
        </article>
      </div>
    </>
  );
}
