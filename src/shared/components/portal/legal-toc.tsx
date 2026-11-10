"use client";

import { useEffect, useState } from "react";
import { cn } from "@/shared/lib/utils";

type Item = { id: string; title: string };

/** Table of contents that highlights the section currently in view. */
export function LegalToc({ items }: { items: Item[] }) {
  const [active, setActive] = useState(items[0]?.id);

  useEffect(() => {
    const targets = items.map((item) => document.getElementById(item.id)).filter((el): el is HTMLElement => el !== null);
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-96px 0px -65% 0px" }
    );
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, [items]);

  return (
    <ol className="space-y-0.5 border-l border-[var(--color-border-subtle)] text-sm">
      {items.map((item, index) => (
        <li key={item.id}>
          <a
            href={`#${item.id}`}
            aria-current={active === item.id ? "location" : undefined}
            className={cn(
              "-ml-px flex gap-2 border-l py-1.5 pl-3 leading-snug transition-colors duration-200",
              active === item.id
                ? "border-[var(--color-text-primary)] font-semibold text-[var(--color-text-primary)]"
                : "border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            )}
          >
            <span className="w-5 shrink-0 tabular-nums">{index + 1}.</span>
            <span>{item.title}</span>
          </a>
        </li>
      ))}
    </ol>
  );
}
