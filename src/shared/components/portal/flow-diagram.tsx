import Link from "next/link";
import { AnimatedIcon } from "@/shared/components/portal/animated-icon";
import { delay } from "@/shared/components/portal/sections";
import { getApp } from "@/shared/config/catalog";
import type { IndustryStep } from "@/shared/config/industries";

/** Ordered workflow across apps: horizontal with an animated connector on desktop, vertical on mobile. */
export function FlowDiagram({ steps }: { steps: IndustryStep[] }) {
  return (
    <ol className="relative grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(170px, 1fr))` }}>
      {steps.map((step, index) => {
        const app = getApp(step.app);
        if (!app) return null;
        return (
          <li key={`${step.label}-${index}`} data-reveal style={delay(index, 90)} className="relative">
            {index < steps.length - 1 && (
              <svg aria-hidden="true" className="absolute -right-3 top-[38px] z-10 hidden h-3 w-3 text-[var(--color-text-secondary)] sm:block" viewBox="0 0 12 12">
                <path d="M2 6h8M7 3l3 3-3 3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
              </svg>
            )}
            <Link
              href={`/apps/${app.slug}`}
              style={{ ["--accent" as string]: app.accent }}
              className="group flex h-full flex-col rounded-[14px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 transition-colors hover:border-[color-mix(in_oklab,var(--accent)_60%,var(--color-border-subtle))]"
            >
              <div className="flex items-center justify-between">
                <AnimatedIcon icon={app.icon} size={40} />
                <span className="text-xs font-semibold text-[var(--color-text-secondary)]">{String(index + 1).padStart(2, "0")}</span>
              </div>
              <p className="mt-4 text-base font-semibold text-[var(--color-text-primary)]">{step.label}</p>
              <p className="text-xs font-semibold text-[var(--color-text-secondary)]">{app.name}</p>
              <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">{step.detail}</p>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
