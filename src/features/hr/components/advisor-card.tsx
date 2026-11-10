"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Loader2, OctagonX, RefreshCw, Sparkles } from "lucide-react";
import type { AdvisorCardData } from "@/features/hr/ai/types";

/** At most this many analyses run at once, so a long approvals list stays within provider limits. */
const MAX_CONCURRENT = 2;
let running = 0;
const waiting: Array<() => void> = [];

async function withSlot<T>(work: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  running += 1;
  try {
    return await work();
  } finally {
    running -= 1;
    waiting.shift()?.();
  }
}

/** Shared per request, so the desktop row, the mobile card and the review dialog make one call between them. */
const loaded = new Map<string, Promise<AdvisorCardData>>();

function fetchCard(requestId: string, refresh: boolean): Promise<AdvisorCardData> {
  const existing = refresh ? undefined : loaded.get(requestId);
  if (existing) return existing;
  const promise = withSlot(async () => {
    const res = await fetch(`/api/v1/hr/leave-requests/${requestId}/advisor`, { method: refresh ? "POST" : "GET" });
    const json = (await res.json()) as { data?: AdvisorCardData; error?: { message: string } };
    if (!res.ok || !json.data) throw new Error(json.error?.message ?? "The analysis is unavailable right now.");
    return json.data;
  });
  loaded.set(requestId, promise);
  promise.catch(() => loaded.delete(requestId));
  return promise;
}

const BADGES = {
  APPROVE: {
    label: "Recommend approve",
    icon: CheckCircle2,
    className: "bg-[var(--color-status-success-bg)] text-[var(--color-status-success)]",
  },
  REVIEW: {
    label: "Review",
    icon: AlertTriangle,
    className: "bg-[var(--color-warning-bg)] text-[var(--color-warning-text)] border border-[var(--color-warning-border)]",
  },
  REJECT_RISK: {
    label: "Rejection risk",
    icon: OctagonX,
    className: "bg-[var(--color-status-error-bg)] text-[var(--color-status-error)]",
  },
} as const;

function factsLine(card: AdvisorCardData): string[] {
  const { balance, team, attendance, history } = card.facts;
  return [
    balance
      ? `Balance: ${balance.available} available, ${balance.after} after this request`
      : "Unpaid leave: balance not used",
    team.colleagues > 0
      ? `Team: ${team.onLeaveCount} of ${team.colleagues} colleagues off${team.onLeaveNames.length ? ` (${team.onLeaveNames.join(", ")})` : ""}`
      : "Team: no other colleagues in this department",
    attendance.unexplainedAbsences === null
      ? `Attendance: no records in the last ${attendance.windowDays} days`
      : `Attendance (${attendance.windowDays} days): ${attendance.unexplainedAbsences} unexplained absences, ${attendance.lateCheckIns} late check-ins`,
    `History (12 months): ${history.requestsLast12Months} other requests, ${history.rejectionsLast12Months} rejected`,
  ];
}

/** Advisory only: it shows a recommendation. Approve and Reject stay separate, and belong to the admin. */
export function AdvisorCard({ requestId, defaultOpen = false }: { requestId: string; defaultOpen?: boolean }) {
  const [card, setCard] = useState<AdvisorCardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    let active = true;
    fetchCard(requestId, false)
      .then((data) => active && setCard(data))
      .catch((err: unknown) => active && setError(err instanceof Error ? err.message : "The analysis is unavailable right now."))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [requestId]);

  const refresh = () => {
    setLoading(true);
    setError(null);
    fetchCard(requestId, true)
      .then(setCard)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "The analysis is unavailable right now."))
      .finally(() => setLoading(false));
  };

  if (!card) {
    return (
      <div className="flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)]/40 px-3 py-2 text-[11px] text-[var(--color-text-secondary)]">
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <AlertTriangle className="h-3.5 w-3.5" />}
        <span>{loading ? "Analysing this request…" : error}</span>
      </div>
    );
  }

  const badge = card.blocked
    ? { ...BADGES.REJECT_RISK, label: "Blocked" }
    : BADGES[card.recommendation];
  const BadgeIcon = badge.icon;

  return (
    <div className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] text-xs whitespace-normal">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex min-h-[44px] w-full items-start gap-2 p-2.5 text-left hover:bg-[var(--color-bg-subtle)]/50 transition-colors rounded-[var(--radius-control)]"
      >
        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${badge.className}`}>
          <BadgeIcon className="h-3 w-3" />
          {badge.label}
        </span>
        <span className="min-w-0 flex-1 text-[var(--color-text-primary)]">{card.summary}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-[var(--color-text-secondary)] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="space-y-2.5 border-t border-[var(--color-border-subtle)] p-2.5">
          <ul className="list-disc space-y-0.5 pl-4 text-[var(--color-text-primary)]">
            {card.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>

          <div className="rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)] p-2 text-[11px] text-[var(--color-text-secondary)] space-y-0.5">
            {factsLine(card).map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>

          {card.policy_refs.length > 0 && (
            <p className="text-[11px] text-[var(--color-text-secondary)]">
              <span className="font-bold">Policy: </span>
              {card.policy_refs.map((ref) => `${ref.source} > ${ref.section}`).join("; ")}
            </p>
          )}
          {card.confidence_note && (
            <p className="text-[11px] italic text-[var(--color-text-secondary)]">{card.confidence_note}</p>
          )}
          {error && <p className="text-[11px] text-[var(--color-status-error)]">{error}</p>}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border-subtle)] pt-2">
            <span className="flex items-center gap-1 text-[10px] text-[var(--color-text-secondary)]">
              <Sparkles className="h-3 w-3" />
              {card.origin === "llm"
                ? `Generated by AI, advisory only. ${card.provider} / ${card.model}`
                : "Generated by fixed rules (no AI), advisory only."}
            </span>
            {!card.blocked && (
            <button
              type="button"
              onClick={refresh}
              disabled={loading}
              className="flex min-h-[44px] items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] px-3 text-[11px] font-bold text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] transition-colors disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              {card.origin === "llm" ? "Refresh analysis" : "Ask AI"}
            </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
