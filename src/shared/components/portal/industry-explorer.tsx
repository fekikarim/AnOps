"use client";

import Link from "next/link";
import { useState } from "react";
import { AnimatedIcon } from "@/shared/components/portal/animated-icon";
import { IconArrowRight } from "@/shared/components/ui/brand-icons";
import { getApp } from "@/shared/config/catalog";
import { industries } from "@/shared/config/industries";
import { cn } from "@/shared/lib/utils";

/** Pick an industry to see its challenges mapped to the application that addresses each one. */
export function IndustryExplorer() {
  const [slug, setSlug] = useState(industries[0].slug);
  const industry = industries.find((item) => item.slug === slug) ?? industries[0];

  return (
    <div className="overflow-hidden rounded-[20px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
      <div role="group" aria-label="Choose an industry" className="flex gap-1 overflow-x-auto border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] p-2 [scrollbar-width:none]">
        {industries.map((item) => (
          <button
            key={item.slug}
            type="button"
            aria-pressed={item.slug === slug}
            onClick={() => setSlug(item.slug)}
            className={cn(
              "group flex min-h-[44px] shrink-0 items-center gap-2 rounded-[12px] px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)]",
              item.slug === slug
                ? "bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-[0_6px_18px_-12px_rgba(17,31,29,0.5)]"
                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            )}
          >
            <AnimatedIcon icon={item.icon} size={28} play={item.slug === slug ? "always" : "hover"} />
            {item.name}
          </button>
        ))}
      </div>

      <div key={industry.slug} className="grid gap-8 p-5 sm:p-8 lg:grid-cols-[0.9fr_1.1fr] motion-safe:animate-[anops-rise_450ms_var(--ease-out)_both]" aria-live="polite">
        <div>
          <h3 className="font-[family-name:var(--font-heading)] text-2xl font-semibold tracking-[-0.03em] text-[var(--color-text-primary)]">{industry.name}</h3>
          <p className="mt-3 text-sm leading-relaxed text-[var(--color-text-secondary)]">{industry.intro}</p>
          <p className="mt-6 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-text-secondary)]">Applications involved</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {industry.apps.map((appSlug) => {
              const app = getApp(appSlug);
              return app ? (
                <li key={appSlug}>
                  <Link href={`/apps/${appSlug}`} className="group inline-flex min-h-[40px] items-center gap-2 rounded-full border border-[var(--color-border-subtle)] py-1 pl-1 pr-3 text-sm font-medium text-[var(--color-text-primary)] hover:border-[var(--color-border-control)]">
                    <AnimatedIcon icon={app.icon} size={28} />
                    {app.name}
                  </Link>
                </li>
              ) : null;
            })}
          </ul>
          <Link href={`/industries/${industry.slug}`} className="mt-8 inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)] underline decoration-[var(--color-border-control)] underline-offset-[6px] hover:decoration-[var(--color-text-primary)]">
            See the full {industry.name.toLowerCase()} solution
            <IconArrowRight size={14} />
          </Link>
        </div>

        <ol className="space-y-3">
          {industry.answers.map((answer, index) => {
            const app = getApp(answer.app);
            return (
              <li key={answer.challenge} className="grid gap-3 rounded-[14px] border border-[var(--color-border-subtle)] p-4 sm:grid-cols-[1fr_auto_1.3fr] sm:items-center">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-status-error-fg)]">Challenge {index + 1}</p>
                  <p className="mt-1 text-sm font-semibold text-[var(--color-text-primary)]">{answer.challenge}</p>
                </div>
                <IconArrowRight size={14} className="hidden text-[var(--color-text-secondary)] sm:block" />
                <div className="rounded-[10px] bg-[var(--color-bg-subtle)] p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-secondary)]">{app?.name}</p>
                  <p className="mt-1 text-sm leading-relaxed text-[var(--color-text-primary)]">{answer.how}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
