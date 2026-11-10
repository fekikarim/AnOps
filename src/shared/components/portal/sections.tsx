import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { IconArrowRight } from "@/shared/components/ui/brand-icons";
import { AnimatedIcon } from "@/shared/components/portal/animated-icon";
import { StatusBadge } from "@/shared/components/marketing/status-badge";
import { btnPrimary, container } from "@/shared/components/marketing/styles";
import type { App } from "@/shared/config/catalog";
import { cn } from "@/shared/lib/utils";

export const display =
  "font-[family-name:var(--font-heading)] text-[40px] leading-[1.04] tracking-[-0.04em] sm:text-[56px] lg:text-[68px] text-[var(--color-text-primary)]";
export const h2 =
  "font-[family-name:var(--font-heading)] text-[30px] leading-[1.1] tracking-[-0.035em] sm:text-[40px] text-[var(--color-text-primary)]";

export const delay = (index: number, step = 70): CSSProperties => ({ ["--d" as string]: `${index * step}ms` });

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-text-secondary)]", className)}>
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[var(--color-action-primary)] ring-2 ring-[color-mix(in_oklab,var(--color-action-primary)_30%,transparent)]" />
      {children}
    </p>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  lead,
  align = "left",
  id,
  action,
}: {
  eyebrow?: string;
  title: ReactNode;
  lead?: ReactNode;
  align?: "left" | "center";
  id?: string;
  action?: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-6 md:flex-row md:items-end md:justify-between", align === "center" && "items-center text-center md:flex-col md:items-center")}>
      <div data-reveal className={cn("max-w-2xl", align === "center" && "mx-auto")}>
        {eyebrow && <Eyebrow className={align === "center" ? "justify-center" : undefined}>{eyebrow}</Eyebrow>}
        <h2 id={id} className={cn(h2, "mt-4")}>
          {title}
        </h2>
        {lead && <p className="mt-4 text-base leading-relaxed text-[var(--color-text-secondary)] sm:text-lg">{lead}</p>}
      </div>
      {action}
    </div>
  );
}

export function TextLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "group/link inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]",
        className
      )}
    >
      <span className="underline decoration-[var(--color-border-control)] decoration-1 underline-offset-[6px] transition-colors group-hover/link:decoration-[var(--color-text-primary)]">
        {children}
      </span>
      <IconArrowRight size={14} className="transition-transform duration-300 group-hover/link:translate-x-0.5" />
    </Link>
  );
}

export function PageHero({
  eyebrow,
  title,
  lead,
  children,
  aside,
}: {
  eyebrow: string;
  title: ReactNode;
  lead: ReactNode;
  children?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section className="relative overflow-hidden border-b border-[var(--color-border-subtle)]">
      <div aria-hidden="true" className="portal-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_top_right,black_10%,transparent_65%)]" />
      <div className={cn(container, "relative grid items-center gap-10 pb-14 pt-14 sm:pb-20 sm:pt-20", aside && "lg:grid-cols-[1.15fr_0.85fr]")}>
        <div data-reveal>
          <Eyebrow>{eyebrow}</Eyebrow>
          <h1 className={cn(display, "mt-5 max-w-3xl")}>{title}</h1>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-[var(--color-text-secondary)] sm:text-lg">{lead}</p>
          {children}
        </div>
        {aside && (
          <div data-reveal="scale" style={delay(2)}>
            {aside}
          </div>
        )}
      </div>
    </section>
  );
}

export function AppTile({ app, index = 0, compact = false }: { app: App; index?: number; compact?: boolean }) {
  return (
    <Link
      href={`/apps/${app.slug}`}
      data-reveal
      style={{ ...delay(index, 50), ["--accent" as string]: app.accent }}
      className="group relative flex h-full flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 transition-[border-color,box-shadow,transform] duration-300 ease-[var(--ease-out)] hover:border-[color-mix(in_oklab,var(--accent)_55%,var(--color-border-subtle))] hover:shadow-[0_18px_40px_-24px_color-mix(in_oklab,var(--accent)_70%,transparent)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)] motion-safe:hover:-translate-y-0.5"
    >
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-[3px] origin-left scale-x-0 bg-[var(--accent)] transition-transform duration-500 ease-[var(--ease-out)] group-hover:scale-x-100 group-focus-visible:scale-x-100" />
      <div className="flex items-start justify-between gap-3">
        <AnimatedIcon icon={app.icon} size={compact ? 44 : 52} />
        <StatusBadge status={app.status} />
      </div>
      <h3 className="mt-5 text-lg font-semibold tracking-[-0.02em] text-[var(--color-text-primary)]">{app.name}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-text-secondary)]">{compact ? app.tagline : app.summary}</p>
      {!compact && (
        <ul className="mt-4 space-y-1.5">
          {app.highlights.map((item) => (
            <li key={item} className="flex items-start gap-2 text-sm text-[var(--color-text-primary)]">
              <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
              {item}
            </li>
          ))}
        </ul>
      )}
      <span className="mt-auto inline-flex items-center gap-1.5 pt-5 text-sm font-semibold text-[var(--color-text-primary)]">
        Learn more
        <IconArrowRight size={13} className="transition-transform duration-300 group-hover:translate-x-1" />
      </span>
    </Link>
  );
}

export function CtaBand({
  title = "Start with one app. Grow into the whole platform.",
  body = "Try it free with one company and one application, or talk to us about the right plan.",
}: {
  title?: string;
  body?: string;
}) {
  return (
    <section className={cn(container, "pb-20 pt-4 sm:pb-28")}>
      <div data-reveal="scale" className="portal-ink relative overflow-hidden rounded-[20px] px-6 py-14 sm:px-14 sm:py-20">
        <div aria-hidden="true" className="portal-grid pointer-events-none absolute inset-0 opacity-60 [mask-image:radial-gradient(ellipse_at_bottom_right,black,transparent_70%)]" />
        <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[#C8F03E] opacity-[0.12] blur-3xl" />
        <div className="relative max-w-2xl">
          <h2 className="font-[family-name:var(--font-heading)] text-[32px] leading-[1.08] tracking-[-0.035em] text-[#F7F7F2] sm:text-[48px]">{title}</h2>
          <p className="mt-5 text-base leading-relaxed text-[#B4BFB7] sm:text-lg">{body}</p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link href="/trial" className={btnPrimary}>
              Try it free
              <IconArrowRight size={14} />
            </Link>
            <Link
              href="/contact"
              className="inline-flex min-h-[44px] items-center justify-center rounded-[var(--radius-control)] border border-[#5d7a6f] px-5 text-sm font-semibold text-[#F7F7F2] transition-colors hover:bg-[#192B27]"
            >
              Talk to us
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="flex gap-3 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-4 py-3 text-sm leading-relaxed text-[var(--color-text-secondary)]">
      <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-text-secondary)]" />
      <span>{children}</span>
    </p>
  );
}
