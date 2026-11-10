import Link from "next/link";
import { IconArrowRight, IconCheck } from "@/shared/components/ui/brand-icons";
import { AnimatedIcon } from "@/shared/components/portal/animated-icon";
import { apps, getApp } from "@/shared/config/catalog";

const card = "group relative flex flex-col overflow-hidden rounded-[24px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-6 sm:p-7";
const available = (
  <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-status-success-bg)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--color-status-success)]">
    <IconCheck size={9} /> Available now
  </span>
);
const d = (ms: number) => ({ ["--d" as string]: `${ms}ms` });

const flow = ["purchasing", "inventory", "manufacturing", "finance"];
const automatic = [
  ["Receipt posted", "Stock increases in the right warehouse"],
  ["Work order completed", "Components consumed, finished goods added"],
  ["Payment received", "Allocated to the open invoice"],
  ["Telegram receipt", "Arrives in Finance as an expense to review"],
];
const guarantees = ["Permissions checked on the server", "Organizations fully isolated", "Money in whole cents, no drift", "Every sensitive change audited"];

/**
 * Scene 5: what AnOps does today, shown as small working pictures. Everything on the left of the
 * divider is available now; the roadmap strip lists only applications the catalog marks as coming soon.
 */
export function IntelligentOperations() {
  const upcoming = apps.filter((app) => app.status === "coming-soon");
  return (
    <div>
      <div className="grid gap-4 lg:grid-cols-6">
        {/* Connected workflows */}
        <article data-reveal className={`${card} lg:col-span-4`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg font-semibold tracking-[-0.02em] text-[var(--color-text-primary)]">Connected workflows</h3>
            {available}
          </div>
          <p className="mt-2 max-w-lg text-sm leading-relaxed text-[var(--color-text-secondary)]">A supplier order becomes stock, stock becomes product, product becomes an invoice. Nothing is typed twice.</p>
          <div className="relative mt-8 px-2 pb-2">
            <div aria-hidden="true" className="absolute left-[12%] right-[12%] top-7 h-px bg-[var(--color-border-subtle)] sm:top-8">
              <span className="home-runner absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#C8F03E] shadow-[0_0_0_6px_rgba(200,240,62,0.25)]" />
            </div>
            <ol className="relative grid grid-cols-4 gap-2">
              {flow.map((slug, index) => {
                const app = getApp(slug)!;
                return (
                  <li key={slug} className="flex flex-col items-center gap-2 text-center">
                    <AnimatedIcon icon={app.icon} size={64} play="hover" className="max-sm:!h-14 max-sm:!w-14" />
                    <span className="text-[11px] font-semibold text-[var(--color-text-primary)] sm:text-xs">{app.name}</span>
                    <span className="hidden text-[11px] text-[var(--color-text-secondary)] sm:block">{["Order", "Receive", "Produce", "Invoice"][index]}</span>
                  </li>
                );
              })}
            </ol>
          </div>
        </article>

        {/* AI that proposes */}
        <article data-reveal style={d(80)} className={`${card} portal-ink lg:col-span-2`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg font-semibold tracking-[-0.02em]">AI that proposes</h3>
            {available}
          </div>
          <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">It reads and drafts. Every change runs only after a person confirms it.</p>
          <div className="mt-6 rounded-[16px] border border-white/10 bg-white/[0.04] p-4">
            <p className="text-sm font-semibold text-[#F7F7F2]">Create purchase order · draft</p>
            <p className="mt-1 text-xs text-[#B4BFB7]">120 × Aluminium panel · Sahel Metals</p>
            <div className="mt-4 flex gap-2">
              <span className="relative inline-flex flex-1 items-center justify-center overflow-hidden rounded-[10px] bg-[#C8F03E] py-2 text-xs font-semibold text-[#111F1D]">
                Confirm
                <span aria-hidden="true" className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/50 to-transparent motion-safe:animate-[anops-sheen_3.2s_ease-in-out_infinite]" />
              </span>
              <span className="inline-flex flex-1 items-center justify-center rounded-[10px] border border-white/15 py-2 text-xs font-semibold text-[#F7F7F2]">Cancel</span>
            </div>
          </div>
          <p className="mt-4 text-xs text-[#B4BFB7]">Included in MaxOps and during the trial. Never more than each person&apos;s role allows.</p>
        </article>

        {/* Work that updates itself */}
        <article data-reveal style={d(60)} className={`${card} lg:col-span-3`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg font-semibold tracking-[-0.02em] text-[var(--color-text-primary)]">Work that updates itself</h3>
            {available}
          </div>
          <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">One action, every record that depends on it, in a single transaction.</p>
          <ul className="mt-6 space-y-2.5">
            {automatic.map(([trigger, effect], index) => (
              <li key={trigger} data-reveal style={d(120 + index * 90)} className="flex items-center gap-3 rounded-[14px] bg-[var(--color-bg-subtle)] p-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-text-primary)] text-[var(--color-bg-canvas)]">
                  <IconCheck size={11} />
                </span>
                <span className="min-w-0 text-sm">
                  <span className="font-semibold text-[var(--color-text-primary)]">{trigger}</span>
                  <span className="text-[var(--color-text-secondary)]"> → {effect}</span>
                </span>
              </li>
            ))}
          </ul>
        </article>

        {/* Centralized management */}
        <article data-reveal style={d(120)} className={`${card} lg:col-span-3`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg font-semibold tracking-[-0.02em] text-[var(--color-text-primary)]">Centralized management</h3>
            {available}
          </div>
          <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">Organizations, members, roles, plans and billing in one place. Switch organizations in a click.</p>
          <div className="mt-6 space-y-2">
            {[
              ["Qovri", "Owner · AllOps", true],
              ["Atlas Foods", "Administrator · Custom", false],
            ].map(([name, detail, active]) => (
              <div key={name as string} className="flex items-center gap-3 rounded-[14px] border border-[var(--color-border-subtle)] p-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[var(--color-action-primary)] text-xs font-bold text-[#111F1D]">{(name as string).slice(0, 2).toUpperCase()}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-[var(--color-text-primary)]">{name}</span>
                  <span className="block truncate text-xs text-[var(--color-text-secondary)]">{detail}</span>
                </span>
                {active && <span className="rounded-full bg-[var(--color-text-primary)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--color-bg-canvas)]">Active</span>}
              </div>
            ))}
            <div className="grid grid-cols-3 gap-2 pt-1 text-center">
              {[["12", "Members"], ["3", "Roles"], ["9", "Apps"]].map(([value, label]) => (
                <div key={label} className="rounded-[12px] bg-[var(--color-bg-subtle)] py-2.5">
                  <p className="font-[family-name:var(--font-heading)] text-lg font-semibold text-[var(--color-text-primary)]">{value}</p>
                  <p className="text-[11px] text-[var(--color-text-secondary)]">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </article>
      </div>

      {/* Guarantees */}
      <ul data-reveal className="mt-4 grid gap-2 rounded-[20px] border border-[var(--color-border-subtle)] p-3 sm:grid-cols-2 lg:grid-cols-4">
        {guarantees.map((item) => (
          <li key={item} className="flex items-center gap-2 px-2 py-1.5 text-sm text-[var(--color-text-primary)]">
            <IconCheck size={12} className="shrink-0 text-[var(--color-status-success-fg)]" />
            {item}
          </li>
        ))}
      </ul>

      {/* Roadmap: only what the catalog marks as coming soon. */}
      {upcoming.length > 0 && (
        <div data-reveal className="mt-10 flex flex-col gap-4 border-t border-dashed border-[var(--color-border-control)] pt-8 md:flex-row md:items-center">
          <div className="md:w-56">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-text-secondary)]">On the roadmap</p>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Not available yet. Shown so you can plan ahead.</p>
          </div>
          <ul className="grid min-w-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-2">
            {upcoming.map((app) => (
              <li key={app.slug}>
                <Link href={`/apps/${app.slug}`} className="group flex items-center gap-3 rounded-[16px] border border-dashed border-[var(--color-border-control)] p-3.5 transition-colors hover:bg-[var(--color-bg-surface)]">
                  <AnimatedIcon icon={app.icon} size={44} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
                      {app.name}
                      <span className="rounded-full bg-[var(--color-status-warning-bg)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-status-warning)]">Coming soon</span>
                    </span>
                    <span className="block truncate text-xs text-[var(--color-text-secondary)]">{app.tagline}</span>
                  </span>
                  <IconArrowRight size={12} className="shrink-0 text-[var(--color-text-secondary)] transition-transform group-hover:translate-x-1" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
