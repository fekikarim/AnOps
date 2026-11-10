"use client";

import Link from "next/link";
import { useState } from "react";
import { IconArrowRight } from "@/shared/components/ui/brand-icons";
import { AnimatedIcon } from "@/shared/components/portal/animated-icon";
import { apps, getApp } from "@/shared/config/catalog";
import { cn } from "@/shared/lib/utils";

const SIZE = 100;
const RADIUS = 38;
const center = SIZE / 2;

/** Positions on a ring, starting at the top, as percentages of the stage. */
const ring = apps.map((app, index) => {
  const angle = (index / apps.length) * Math.PI * 2 - Math.PI / 2;
  return { app, x: center + Math.cos(angle) * RADIUS, y: center + Math.sin(angle) * RADIUS };
});
const at = new Map(ring.map((node) => [node.app.slug, node]));

/**
 * Scene 4: every application orbits one set of records. Selecting an app lights the apps it shares
 * records with (from the catalog's `connectsWith`), so the picture is the real data model, not decoration.
 */
export function EcosystemOrbit() {
  const [selected, setSelected] = useState("inventory");
  const current = getApp(selected) ?? apps[0];
  const linked = new Set(current.connectsWith);
  const origin = at.get(current.slug)!;

  return (
    <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:gap-14">
      <div data-reveal="fade" className="relative mx-auto aspect-square w-full max-w-[600px]">
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="absolute inset-0 h-full w-full" aria-hidden="true">
          <circle cx={center} cy={center} r={RADIUS} fill="none" stroke="var(--color-border-subtle)" strokeWidth="0.25" strokeDasharray="0.6 1.2" />
          <circle cx={center} cy={center} r={RADIUS * 0.55} fill="none" stroke="var(--color-border-subtle)" strokeWidth="0.2" />
          {ring.map(({ app, x, y }, index) => (
            <line
              key={app.slug}
              x1={center}
              y1={center}
              x2={x}
              y2={y}
              pathLength={1}
              className="home-orbit-line"
              style={{ ["--d" as string]: `${index * 80}ms` }}
              stroke={app.slug === current.slug ? current.accent : "var(--color-border-subtle)"}
              strokeOpacity={app.slug === current.slug ? 0.9 : 0.6}
              strokeWidth={app.slug === current.slug ? 0.45 : 0.25}
            />
          ))}
          {current.connectsWith.map((slug) => {
            const target = at.get(slug);
            if (!target) return null;
            return (
              <line
                key={`${current.slug}-${slug}`}
                x1={origin.x}
                y1={origin.y}
                x2={target.x}
                y2={target.y}
                stroke={current.accent}
                strokeWidth="0.4"
                strokeLinecap="round"
                className="portal-flow"
                style={{ strokeDasharray: "1 1.5" }}
              />
            );
          })}
        </svg>

        {/* Core: the shared records. */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <span aria-hidden="true" className="home-pulse-ring absolute inset-0 rounded-[28%] bg-[#C8F03E]/40" />
          <span aria-hidden="true" className="home-pulse-ring absolute inset-0 rounded-[28%] bg-[#C8F03E]/30" style={{ ["--d" as string]: "1.3s" }} />
          {/* eslint-disable-next-line @next/next/no-img-element -- brand mark */}
          <img src="/brand-kit/02-app-icons/anops-app-icon-ios-192x192.svg" alt="" width={96} height={96} className="relative h-16 w-16 rounded-[22%] shadow-[0_20px_50px_-20px_rgba(17,31,29,0.7)] sm:h-24 sm:w-24" />
        </div>

        <ul className="absolute inset-0" aria-label="AnOps applications">
          {ring.map(({ app, x, y }, index) => {
            const isCurrent = app.slug === current.slug;
            const isLinked = linked.has(app.slug);
            return (
              <li key={app.slug} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${x}%`, top: `${y}%` }}>
                <button
                  type="button"
                  onClick={() => setSelected(app.slug)}
                  onMouseEnter={() => setSelected(app.slug)}
                  onFocus={() => setSelected(app.slug)}
                  aria-pressed={isCurrent}
                  aria-label={`${app.name}${app.status === "coming-soon" ? " (coming soon)" : ""}`}
                  className={cn(
                    "group flex flex-col items-center gap-1.5 rounded-[16px] p-1 transition-[opacity,transform] duration-300 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)]",
                    !isCurrent && !isLinked && "opacity-55",
                    isCurrent && "scale-110"
                  )}
                >
                  <span className="home-idle block" style={{ ["--d" as string]: `${index * -600}ms` }}>
                    {/* Scaled rather than resized on phones so the tile, ring and artwork stay in proportion. */}
                    <span className="block origin-center max-sm:scale-[0.74]">
                    <span
                      className="block rounded-[16px] transition-shadow duration-300"
                      style={{ boxShadow: isCurrent ? `0 0 0 3px ${app.accent}, 0 18px 40px -16px ${app.accent}` : isLinked ? `0 0 0 2px color-mix(in oklab, ${app.accent} 55%, transparent)` : undefined }}
                    >
                      <AnimatedIcon icon={app.icon} size={56} play={isCurrent ? "always" : "never"} />
                    </span>
                    </span>
                  </span>
                  <span className="hidden max-w-[96px] truncate text-xs font-semibold text-[var(--color-text-primary)] sm:block">{app.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div data-reveal style={{ ["--d" as string]: "120ms" }}>
        <div key={current.slug} className="home-pop rounded-[24px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-6 sm:p-7" style={{ ["--accent" as string]: current.accent }}>
          <div className="flex items-center gap-4">
            <AnimatedIcon icon={current.icon} size={56} play="never" />
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold tracking-[-0.02em] text-[var(--color-text-primary)]">{current.name}</p>
              <span
                className={cn(
                  "mt-1 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                  current.status === "available" ? "bg-[var(--color-status-success-bg)] text-[var(--color-status-success)]" : "bg-[var(--color-status-warning-bg)] text-[var(--color-status-warning)]"
                )}
              >
                {current.status === "available" ? "Available now" : "Coming soon"}
              </span>
            </div>
          </div>
          <p className="mt-5 font-[family-name:var(--font-heading)] text-2xl font-semibold leading-tight tracking-[-0.03em] text-[var(--color-text-primary)]">{current.tagline}</p>
          <p className="mt-3 text-sm leading-relaxed text-[var(--color-text-secondary)]">{current.summary}</p>
          {current.connectsWith.length > 0 && (
            <>
              <p className="mt-6 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-text-secondary)]">Shares records with</p>
              <ul className="mt-2.5 flex flex-wrap gap-1.5">
                {current.connectsWith.map((slug, index) => {
                  const app = getApp(slug);
                  if (!app) return null;
                  return (
                    <li key={slug} className="home-pop" style={{ ["--d" as string]: `${index * 60}ms` }}>
                      <button
                        type="button"
                        onClick={() => setSelected(slug)}
                        className="inline-flex min-h-[32px] items-center gap-1.5 rounded-full border border-[var(--color-border-subtle)] px-3 text-xs font-medium text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-border-control)]"
                      >
                        <span className="h-2 w-2 rounded-full" style={{ background: app.accent }} />
                        {app.name}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          <Link href={`/apps/${current.slug}`} className="group mt-7 inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
            Explore {current.name}
            <IconArrowRight size={13} className="transition-transform group-hover:translate-x-1" />
          </Link>
        </div>
      </div>
    </div>
  );
}
