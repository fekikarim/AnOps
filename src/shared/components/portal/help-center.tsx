"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { IconArrowRight, IconSearch } from "@/shared/components/ui/brand-icons";
import { helpItems, helpTopics, type HelpTopic } from "@/shared/config/help";
import { cn } from "@/shared/lib/utils";

/** Searchable, topic-filtered list of troubleshooting fixes and FAQs. */
export function HelpCenter() {
  const [query, setQuery] = useState("");
  const [topic, setTopic] = useState<HelpTopic | "all">("all");
  const [open, setOpen] = useState<string | null>(null);

  const results = useMemo(() => {
    const term = query.trim().toLowerCase();
    return helpItems.filter((item) => (topic === "all" || item.topic === topic) && (!term || `${item.title} ${item.body}`.toLowerCase().includes(term)));
  }, [query, topic]);

  return (
    <div>
      <div className="relative max-w-2xl">
        <label htmlFor="help-search" className="sr-only">
          Search help
        </label>
        <IconSearch size={18} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)]" />
        <input
          id="help-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Describe your problem, e.g. “stock did not increase”"
          className="h-14 w-full rounded-[16px] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] pl-12 pr-4 text-base text-[var(--color-text-primary)] shadow-[0_10px_30px_-20px_rgba(17,31,29,0.4)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:ring-[3px] focus:ring-[var(--color-focus-ring)]"
        />
      </div>

      <div role="group" aria-label="Filter by topic" className="-mx-4 mt-5 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0">
        {[{ id: "all" as const, label: "All topics" }, ...helpTopics].map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={topic === item.id}
            onClick={() => setTopic(item.id)}
            className={cn(
              "inline-flex min-h-[40px] shrink-0 items-center rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)]",
              topic === item.id
                ? "border-[var(--color-text-primary)] bg-[var(--color-text-primary)] text-[var(--color-bg-canvas)]"
                : "border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <p aria-live="polite" className="mt-6 text-sm text-[var(--color-text-secondary)]">
        {results.length} {results.length === 1 ? "answer" : "answers"}
      </p>

      {results.length === 0 ? (
        <div className="mt-4 rounded-[18px] border border-dashed border-[var(--color-border-control)] p-10 text-center">
          <p className="text-base font-semibold text-[var(--color-text-primary)]">No answer matches yet.</p>
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">Try fewer words, browse the documentation, or tell us what you need.</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link href="/docs" className="inline-flex min-h-[44px] items-center rounded-[var(--radius-control)] border border-[var(--color-border-control)] px-5 text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-bg-subtle)]">
              Browse documentation
            </Link>
            <Link href="/community-hub#feedback" className="inline-flex min-h-[44px] items-center rounded-[var(--radius-control)] bg-[var(--color-action-primary)] px-5 text-sm font-semibold text-[#111F1D] hover:bg-[var(--color-action-hover)]">
              Report a problem
            </Link>
          </div>
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-[var(--color-border-subtle)] overflow-hidden rounded-[18px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
          {results.map((item) => {
            const expanded = open === item.id;
            return (
              <li key={item.id}>
                <h3>
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={`help-${item.id}`}
                    onClick={() => setOpen(expanded ? null : item.id)}
                    className="flex min-h-[56px] w-full items-center gap-4 px-5 py-3 text-left hover:bg-[var(--color-bg-subtle)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-[var(--color-focus-ring)]"
                  >
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                        item.kind === "fix" ? "bg-[var(--color-status-warning-bg)] text-[var(--color-status-warning)]" : "bg-[var(--color-status-neutral-bg)] text-[var(--color-status-neutral)]"
                      )}
                    >
                      {item.kind === "fix" ? "Fix" : "FAQ"}
                    </span>
                    <span className="flex-1 text-sm font-semibold text-[var(--color-text-primary)] sm:text-base">{item.title}</span>
                    <span aria-hidden="true" className={cn("text-xl leading-none text-[var(--color-text-secondary)] transition-transform", expanded && "rotate-45")}>
                      +
                    </span>
                  </button>
                </h3>
                <div id={`help-${item.id}`} hidden={!expanded} className="faq-answer px-5 pb-5 sm:pl-[76px]">
                  <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">{item.body}</p>
                  {item.href && (
                    <Link href={item.href} className="mt-3 inline-flex min-h-[40px] items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)] underline underline-offset-4">
                      Read more
                      <IconArrowRight size={13} />
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
