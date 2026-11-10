"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AnimatedIcon } from "@/shared/components/portal/animated-icon";
import { IconSearch } from "@/shared/components/ui/brand-icons";
import type { Doc } from "@/shared/config/docs";

const kindLabel: Record<Doc["kind"], string> = { start: "Start here", app: "App reference", guide: "Guide" };

/** Full-text filter over titles, summaries and section content. */
export function DocsSearch({ docs, placeholder = "Search documentation, e.g. “receipt”" }: { docs: Doc[]; placeholder?: string }) {
  const [query, setQuery] = useState("");
  const term = query.trim().toLowerCase();

  const results = useMemo(() => {
    if (!term) return [];
    return docs
      .map((doc) => {
        const haystack = [doc.title, doc.summary, ...doc.sections.flatMap((s) => [s.heading, s.body ?? "", ...(s.steps ?? []), ...(s.list ?? [])])].join(" ").toLowerCase();
        const score = (doc.title.toLowerCase().includes(term) ? 3 : 0) + (doc.summary.toLowerCase().includes(term) ? 2 : 0) + (haystack.includes(term) ? 1 : 0);
        return { doc, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
  }, [docs, term]);

  return (
    <div className="relative">
      <label htmlFor="docs-search" className="sr-only">
        Search documentation
      </label>
      <IconSearch size={18} className="pointer-events-none absolute left-5 top-[26px] -translate-y-1/2 text-[var(--color-text-secondary)]" />
      <input
        id="docs-search"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        className="h-[52px] w-full rounded-[14px] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] pl-12 pr-4 text-base text-[var(--color-text-primary)] shadow-[0_10px_30px_-20px_rgba(17,31,29,0.4)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:ring-[3px] focus:ring-[var(--color-focus-ring)]"
      />
      {term && (
        <div className="mt-2 overflow-hidden rounded-[14px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]" aria-live="polite">
          {results.length === 0 ? (
            <p className="p-5 text-sm text-[var(--color-text-secondary)]">
              Nothing found for “{query}”. Try a simpler word, or browse the <Link href="/help#faq" className="font-semibold text-[var(--color-text-primary)] underline">FAQ</Link>.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--color-border-subtle)]">
              {results.map(({ doc }) => (
                <li key={doc.slug}>
                  <Link href={`/docs/${doc.slug}`} className="group flex items-center gap-4 px-4 py-3 hover:bg-[var(--color-bg-subtle)]">
                    <AnimatedIcon icon={doc.icon} size={36} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-[var(--color-text-primary)]">{doc.title}</span>
                      <span className="block truncate text-xs text-[var(--color-text-secondary)]">
                        {kindLabel[doc.kind]} · {doc.summary}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
