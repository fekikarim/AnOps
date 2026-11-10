"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AnimatedIcon } from "@/shared/components/portal/animated-icon";
import { IconArrowRight, IconCheck } from "@/shared/components/ui/brand-icons";
import { APPLICATIONS, getApplication, type ApplicationId } from "@/shared/domain/applications";
import { ALLOPS_APP_COUNT, MAX_TRIAL_APPS, TOTAL_APP_COUNT, TRIAL_DAYS, validateTrialSelection } from "@/shared/domain/plans";
import { cn } from "@/shared/lib/utils";

export const TRIAL_STORAGE_KEY = "anops:trial-apps";

function readStored(): ApplicationId[] {
  try {
    const raw = sessionStorage.getItem(TRIAL_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed.filter((id) => APPLICATIONS.some((a) => a.id === id && !a.aiNative)) as ApplicationId[]).slice(0, MAX_TRIAL_APPS) : [];
  } catch {
    return [];
  }
}

export function TrialSelector({ initial }: { initial: ApplicationId[] }) {
  const [selected, setSelected] = useState<ApplicationId[]>(initial);

  // Restore a selection made earlier in this tab (back from the registration page).
  useEffect(() => {
    if (initial.length > 0) return;
    const stored = readStored();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore from browser storage after hydration
    if (stored.length > 0) setSelected(stored.filter((id) => !getApplication(id).aiNative));
  }, [initial.length]);

  useEffect(() => {
    try {
      sessionStorage.setItem(TRIAL_STORAGE_KEY, JSON.stringify(selected));
    } catch {
      /* storage unavailable: the query string still carries the selection */
    }
  }, [selected]);

  const verdict = useMemo(() => validateTrialSelection(selected), [selected]);
  const full = selected.length >= MAX_TRIAL_APPS;

  const toggle = (id: ApplicationId) => {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : current.length >= MAX_TRIAL_APPS ? current : [...current, id]));
  };

  const continueHref = `/get-started?apps=${selected.join(",")}`;
  const kind = verdict.ok ? verdict.kind : null;

  return (
    <div className="pb-48 sm:pb-40">
      <div className="mb-8 grid gap-3 sm:grid-cols-2">
        <div className={cn("rounded-[16px] border p-4 transition-colors", kind === "free" ? "border-[var(--color-text-primary)] bg-[var(--color-bg-surface)]" : "border-[var(--color-border-subtle)]")}>
          <p className="text-sm font-semibold text-[var(--color-text-primary)]">1 application · Free forever</p>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Unlimited users, no expiration, no credit card. AI-powered features are not included.</p>
        </div>
        <div className={cn("rounded-[16px] border p-4 transition-colors", kind === "trial" ? "border-[var(--color-text-primary)] bg-[var(--color-bg-surface)]" : "border-[var(--color-border-subtle)]")}>
          <p className="text-sm font-semibold text-[var(--color-text-primary)]">2–3 applications · {TRIAL_DAYS}-day trial</p>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Everything in the selected applications, AI features included. No credit card. Choose a plan when it ends.</p>
        </div>
      </div>

      {full && (
        <p role="status" className="mb-6 rounded-[14px] border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] px-4 py-3 text-sm text-[var(--color-warning-text)]">
          You have selected the maximum of {MAX_TRIAL_APPS} applications. Start your {TRIAL_DAYS}-day trial now, then upgrade to AllOps ({ALLOPS_APP_COUNT} applications, no AI), MaxOps (all {TOTAL_APP_COUNT} with AI) or a Custom plan.
          Remove one to pick another.
        </p>
      )}

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {APPLICATIONS.map((app, index) => {
          const isSelected = selected.includes(app.id);
          const unavailable = app.status !== "available";
          const maxOpsOnly = app.aiNative;
          const disabled = unavailable || maxOpsOnly || (!isSelected && full);
          return (
            <li key={app.id} className="motion-safe:animate-[anops-rise_500ms_var(--ease-out)_both]" style={{ animationDelay: `${index * 35}ms` }}>
              <button
                type="button"
                onClick={() => toggle(app.id)}
                aria-pressed={isSelected}
                disabled={disabled}
                style={{ ["--accent" as string]: app.accent }}
                className={cn(
                  "group relative flex h-full w-full flex-col rounded-[18px] border bg-[var(--color-bg-surface)] p-5 text-left transition-[border-color,box-shadow,transform,opacity] duration-300 ease-[var(--ease-out)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)]",
                  isSelected
                    ? "border-[var(--accent)] shadow-[0_18px_40px_-24px_var(--accent)] ring-1 ring-[var(--accent)]"
                    : "border-[var(--color-border-subtle)] hover:border-[var(--color-border-control)] motion-safe:hover:-translate-y-0.5",
                  disabled && "cursor-not-allowed opacity-50 hover:translate-y-0 hover:border-[var(--color-border-subtle)]"
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <AnimatedIcon icon={app.icon} size={52} play={isSelected ? "always" : "hover"} />
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex h-7 w-7 items-center justify-center rounded-full border transition-colors",
                      isSelected ? "border-transparent bg-[var(--color-action-primary)] text-[#111F1D]" : "border-[var(--color-border-control)] text-transparent"
                    )}
                  >
                    <IconCheck size={12} />
                  </span>
                </div>
                <span className="mt-4 flex items-center gap-2 text-lg font-semibold tracking-[-0.02em] text-[var(--color-text-primary)]">
                  {app.name}
                  {maxOpsOnly && <span className="rounded-full bg-[var(--color-status-neutral-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-status-neutral)]">MaxOps only</span>}
                  {unavailable && <span className="rounded-full bg-[var(--color-status-neutral-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-status-neutral)]">Coming soon</span>}
                </span>
                <span className="mt-1 text-sm leading-relaxed text-[var(--color-text-secondary)]">{app.tagline}</span>
                <ul className="mt-4 space-y-1.5">
                  {app.highlights.map((item) => (
                    <li key={item} className="flex gap-2 text-sm text-[var(--color-text-primary)]">
                      <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                      {item}
                    </li>
                  ))}
                </ul>
                {app.aiNative && <span className="mt-4 text-xs text-[var(--color-text-secondary)]">Only available with the MaxOps plan.</span>}
              </button>
            </li>
          );
        })}
      </ul>

      {/* Persistent selection summary */}
      <div className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(12px,env(safe-area-inset-bottom))] sm:px-6">
        <div
          role="region"
          aria-label="Your selection"
          aria-live="polite"
          className="mx-auto flex max-w-[1100px] flex-col gap-4 rounded-[20px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]/95 p-4 shadow-[0_24px_60px_-24px_rgba(17,31,29,0.45)] backdrop-blur sm:flex-row sm:items-center sm:p-5"
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex -space-x-2">
              {selected.length === 0 ? (
                <span className="flex h-11 w-11 items-center justify-center rounded-[14px] border border-dashed border-[var(--color-border-control)] text-xs text-[var(--color-text-secondary)]">0</span>
              ) : (
                selected.map((id) => (
                  <span key={id} className="rounded-[14px] ring-2 ring-[var(--color-bg-surface)]">
                    <AnimatedIcon icon={getApplication(id).icon} size={44} play="never" />
                  </span>
                ))
              )}
            </div>
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
                {selected.length} of {MAX_TRIAL_APPS} selected
                {kind && (
                  <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-semibold", kind === "free" ? "bg-[var(--color-status-success-bg)] text-[var(--color-status-success)]" : "bg-[var(--color-action-primary)] text-[#111F1D]")}>
                    {kind === "free" ? "Permanent Free" : `${TRIAL_DAYS}-day trial`}
                  </span>
                )}
              </p>
              <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">
                {selected.length === 0
                  ? "Select one application to use free forever, or two to three to try them together."
                  : verdict.ok
                    ? verdict.kind === "free"
                      ? `${getApplication(selected[0]).name} stays free forever, with unlimited users.`
                      : `${selected.map((id) => getApplication(id).name).join(", ")} for ${TRIAL_DAYS} days, AI included. No card needed.`
                    : verdict.message}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 gap-2 sm:ml-auto">
            {selected.length > 0 && (
              <button type="button" onClick={() => setSelected([])} className="min-h-[48px] rounded-[var(--radius-control)] px-4 text-sm font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
                Clear
              </button>
            )}
            {verdict.ok ? (
              <Link href={continueHref} className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-[var(--radius-control)] bg-[var(--color-action-primary)] px-6 text-sm font-semibold text-[#111F1D] transition-colors hover:bg-[var(--color-action-hover)] sm:flex-none">
                Continue
                <IconArrowRight size={14} />
              </Link>
            ) : (
              <span aria-disabled="true" className="inline-flex min-h-[48px] flex-1 cursor-not-allowed items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)] px-6 text-sm font-semibold text-[var(--color-text-secondary)] sm:flex-none">
                Continue
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
