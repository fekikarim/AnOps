"use client";

import { useMemo, useState } from "react";
import { btnSecondary } from "@/shared/components/marketing/styles";
import { AppTile } from "@/shared/components/portal/sections";
import { apps, categories, type AppStatus, type CategoryId } from "@/shared/config/catalog";
import { IconSearch } from "@/shared/components/ui/brand-icons";
import { cn } from "@/shared/lib/utils";

const chip =
  "inline-flex min-h-[40px] items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)]";
const chipOn = "border-[var(--color-text-primary)] bg-[var(--color-text-primary)] text-[var(--color-bg-canvas)]";
const chipOff = "border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-control)]";

export function AppsDirectory({ initialCategory }: { initialCategory?: CategoryId }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryId | "all">(initialCategory ?? "all");
  const [status, setStatus] = useState<"all" | AppStatus>("all");

  const results = useMemo(() => {
    const term = query.trim().toLowerCase();
    return apps.filter((app) => {
      if (category !== "all" && app.category !== category) return false;
      if (status !== "all" && app.status !== status) return false;
      if (!term) return true;
      return [app.name, app.summary, app.tagline, ...app.highlights, ...app.features.map((f) => `${f.title} ${f.body}`)]
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [query, category, status]);

  const filtered = query.trim() !== "" || category !== "all" || status !== "all";
  const reset = () => {
    setQuery("");
    setCategory("all");
    setStatus("all");
  };

  return (
    <div>
      <div className="sticky top-[72px] z-20 -mx-4 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-canvas)]/90 px-4 py-4 backdrop-blur sm:mx-0 sm:rounded-[16px] sm:border sm:px-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative lg:w-[320px]">
            <label htmlFor="app-search" className="sr-only">
              Search applications
            </label>
            <IconSearch size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)]" />
            <input
              id="app-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search features, e.g. receipts"
              className="h-11 w-full rounded-full border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] pl-11 pr-4 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:ring-[3px] focus:ring-[var(--color-focus-ring)]"
            />
          </div>
          <div role="group" aria-label="Filter by area" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] lg:pb-0">
            <button type="button" aria-pressed={category === "all"} onClick={() => setCategory("all")} className={cn(chip, "shrink-0", category === "all" ? chipOn : chipOff)}>
              All
            </button>
            {categories.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={category === item.id}
                onClick={() => setCategory(item.id)}
                className={cn(chip, "shrink-0", category === item.id ? chipOn : chipOff)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3 lg:ml-auto">
            <label htmlFor="status-filter" className="sr-only">
              Status
            </label>
            <select
              id="status-filter"
              value={status}
              onChange={(event) => setStatus(event.target.value as "all" | AppStatus)}
              className="h-10 rounded-full border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3 text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-[3px] focus:ring-[var(--color-focus-ring)]"
            >
              <option value="all">Any status</option>
              <option value="available">Available</option>
              <option value="coming-soon">Coming soon</option>
            </select>
            <p aria-live="polite" className="whitespace-nowrap text-sm text-[var(--color-text-secondary)]">
              {results.length} of {apps.length}
            </p>
          </div>
        </div>
      </div>

      {results.length === 0 ? (
        <div className="mt-10 rounded-[16px] border border-dashed border-[var(--color-border-control)] p-10 text-center">
          <p className="text-base font-semibold text-[var(--color-text-primary)]">No application matches these filters.</p>
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">Try another keyword, such as “invoice”, “stock” or “leave”.</p>
          <button type="button" onClick={reset} className={`${btnSecondary} mt-6`}>
            Clear filters
          </button>
        </div>
      ) : filtered ? (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {results.map((app, index) => (
            <li key={app.slug}>
              <AppTile app={app} index={index} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-6 space-y-14">
          {categories.map((group) => {
            const groupApps = apps.filter((app) => app.category === group.id);
            return (
              <section key={group.id} aria-labelledby={`area-${group.id}`} className="scroll-mt-40" id={group.id}>
                <div className="flex flex-col gap-1 border-b border-[var(--color-border-subtle)] pb-4 sm:flex-row sm:items-end sm:justify-between">
                  <h2 id={`area-${group.id}`} className="font-[family-name:var(--font-heading)] text-2xl font-semibold tracking-[-0.03em] text-[var(--color-text-primary)]">
                    {group.label}
                  </h2>
                  <p className="text-sm text-[var(--color-text-secondary)]">{group.description}</p>
                </div>
                <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {groupApps.map((app, index) => (
                    <li key={app.slug}>
                      <AppTile app={app} index={index} />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
