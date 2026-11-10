"use client";

import { useId } from "react";
import { ChevronDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/shared/lib/utils";

/**
 * Disclosure card with a full-width header button. The panel stays mounted while collapsed (inert and hidden from
 * assistive tech), so a half-filled form keeps its values and an in-flight submit is not interrupted.
 * Open state is controlled by the caller so it can close the section after a successful save.
 */
export function ExpandableSection({
  title,
  description,
  icon: Icon,
  open,
  onOpenChange,
  children,
}: {
  title: string;
  description?: string;
  icon: LucideIcon;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const id = useId();
  const headingId = `${id}-heading`;
  const panelId = `${id}-panel`;
  return (
    <section aria-labelledby={headingId} className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
      <h2 id={headingId} className="text-base font-semibold">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => onOpenChange(!open)}
          className="group flex min-h-[64px] w-full items-center gap-3 rounded-[var(--radius-card)] px-4 py-3 text-left transition-colors hover:bg-[var(--color-bg-subtle)] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)] active:bg-[var(--color-bg-subtle)] sm:px-6"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-action-primary)] text-[var(--color-action-on-primary)]">
            <Icon aria-hidden className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block">{title}</span>
            {description && <span className="block text-sm font-normal text-[var(--color-text-secondary)]">{description}</span>}
          </span>
          <ChevronDown aria-hidden className={cn("size-5 shrink-0 text-[var(--color-text-secondary)] transition-transform duration-200 ease-out motion-reduce:transition-none", open && "rotate-180")} />
        </button>
      </h2>
      <div
        id={panelId}
        role="region"
        aria-labelledby={headingId}
        className={cn("grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}
      >
        <div className="overflow-hidden" inert={!open}>
          <div className="border-t border-[var(--color-border-subtle)] p-4 sm:p-6">{children}</div>
        </div>
      </div>
    </section>
  );
}
