"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Sparkles, Target } from "lucide-react";
import { dashboardInsightsAction } from "@/features/finance/actions/finance-ai.actions";
import { Button } from "@/shared/components/ui/button";
import type { ForecastWindow } from "@/features/finance/utils/insights";

type Bullet = { tone: "good" | "watch" | "act"; text: string };

const TONE = {
  good: { icon: CheckCircle2, className: "text-[var(--color-status-success)]" },
  watch: { icon: AlertTriangle, className: "text-[var(--color-status-warning)]" },
  act: { icon: Target, className: "text-[var(--color-action-primary)]" },
} as const;

export function FinanceInsightsPanel({
  currency,
  forecast,
  overdueIncluded,
  avgMonthlyExpenses,
}: {
  currency: string;
  forecast: ForecastWindow[];
  overdueIncluded: number;
  avgMonthlyExpenses: number;
}) {
  const [pending, startTransition] = useTransition();
  const [bullets, setBullets] = useState<Bullet[] | null>(null);
  const [meta, setMeta] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fmt = (n: number) => new Intl.NumberFormat("fr-TN", { style: "currency", currency }).format(n || 0);

  function load(refresh: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await dashboardInsightsAction(currency, refresh);
      if (res.error || !res.data) return setError(res.error ?? "Insights are not available right now.");
      setBullets(res.data.bullets);
      setMeta(`${res.data.cached ? "From earlier today" : "Just now"} · ${new Date(res.data.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Forecast: computed by code */}
      <section aria-labelledby="forecast-heading" className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 space-y-4">
        <div>
          <h2 id="forecast-heading" className="text-base font-semibold text-[var(--color-text-primary)]">Cash-flow forecast</h2>
          <p className="text-xs text-[var(--color-text-secondary)]">
            Money in: open invoices by due date{overdueIncluded > 0 ? `, plus ${fmt(overdueIncluded)} already overdue` : ""}. Money out: your average of {fmt(avgMonthlyExpenses)} expenses a month.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {forecast.map((w) => (
            <div key={w.days} className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] p-3">
              <div className="text-[11px] font-semibold uppercase text-[var(--color-text-secondary)]">Next {w.days} days</div>
              <div className={`mt-1 text-base font-bold tabular-nums ${w.net >= 0 ? "text-[var(--color-status-success)]" : "text-[var(--color-status-error)]"}`}>{fmt(w.net)}</div>
              <div className="mt-1 space-y-0.5 text-[11px] text-[var(--color-text-secondary)] tabular-nums">
                <div>In {fmt(w.expectedIn)}</div>
                <div>Out {fmt(w.expectedOut)}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* AI narrative: explains the figures, never computes them */}
      <section aria-labelledby="ai-insights-heading" className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-start gap-2">
            <Sparkles aria-hidden className="mt-0.5 size-4 shrink-0 text-[var(--color-action-primary)]" />
            <div>
              <h2 id="ai-insights-heading" className="text-base font-semibold text-[var(--color-text-primary)]">AI insights</h2>
              <p className="text-xs text-[var(--color-text-secondary)]">{meta ?? "Three things worth knowing, written from the figures on this page."}</p>
            </div>
          </div>
          {bullets ? (
            <Button variant="ghost" onClick={() => load(true)} disabled={pending} aria-label="Refresh AI insights" title="Write the insights again from the current figures">
              {pending ? <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> : <RefreshCw aria-hidden className="size-4" />}
            </Button>
          ) : (
            <Button variant="primary" onClick={() => load(false)} disabled={pending}>
              {pending ? <Loader2 aria-hidden className="size-4 shrink-0 animate-spin motion-reduce:animate-none" /> : <Sparkles aria-hidden className="size-4 shrink-0" />}
              Get insights
            </Button>
          )}
        </div>
        {error && <p role="alert" className="text-sm text-[var(--color-status-error)]">{error}</p>}
        {bullets && (
          <ul className="space-y-2.5">
            {bullets.map((b, i) => {
              const T = TONE[b.tone];
              return (
                <li key={i} className="flex items-start gap-2.5 text-sm text-[var(--color-text-primary)]">
                  <T.icon aria-hidden className={`mt-0.5 size-4 shrink-0 ${T.className}`} />
                  <span>{b.text}</span>
                </li>
              );
            })}
          </ul>
        )}
        {!bullets && !error && !pending && <p className="text-sm text-[var(--color-text-secondary)]">Uses AI only when you ask. Figures come from your books; the AI only explains them.</p>}
      </section>
    </div>
  );
}
