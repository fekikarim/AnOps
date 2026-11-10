"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, BookOpen, Check, CheckCircle2, Database, Loader2, ShieldCheck, X, XCircle } from "lucide-react";
import { cancelAiActionAction, confirmAiActionAction } from "@/features/hr/actions/hr-assistant.action";
import type { ConfirmationCard as ConfirmationCardData, CopilotSources } from "@/features/hr/ai/types";

type CardState = "open" | "confirmed" | "cancelled" | "failed";

/**
 * Human-in-the-loop step for a write the copilot prepared.
 * Sends only the action id: the server runs the payload it stored and re-validates it first.
 */
export function ConfirmationCard({ card, onConfirmed }: { card: ConfirmationCardData; onConfirmed?: () => void }) {
  const [state, setState] = useState<CardState>("open");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const run = (action: typeof confirmAiActionAction, success: CardState) => {
    startTransition(async () => {
      const result = await action(card.actionId);
      if (result.ok) {
        setState(success);
        setMessage(result.message);
        if (success === "confirmed") onConfirmed?.();
      } else {
        setState("failed");
        setMessage(result.error);
      }
    });
  };

  const details = Object.entries(card.details).filter(([, value]) => value !== null && value !== undefined);

  return (
    <div className="rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] p-3 space-y-2.5 text-[var(--color-text-primary)] animate-in fade-in duration-200">
      <div className="flex items-center gap-1.5 border-b border-[var(--color-border-subtle)] pb-2 text-xs font-bold">
        <ShieldCheck className="h-3.5 w-3.5 text-[var(--color-action-primary)]" />
        {card.title}
      </div>

      <p className="text-xs">{card.summary}</p>

      <dl className="grid grid-cols-2 gap-1.5 text-[11px]">
        {details.map(([label, value]) => (
          <div key={label} className="rounded-md bg-[var(--color-bg-subtle)] px-2 py-1">
            <dt className="text-[10px] text-[var(--color-text-secondary)]">{label}</dt>
            <dd className="font-semibold capitalize">{String(value).replace("_", " / ")}</dd>
          </div>
        ))}
      </dl>

      {card.warnings.map((warning) => (
        <p key={warning} className="flex items-start gap-1.5 rounded-md bg-[var(--color-warning-bg)] px-2 py-1.5 text-[11px] text-[var(--color-warning-text)]">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          {warning}
        </p>
      ))}

      {state === "open" ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={isPending}
              onClick={() => run(cancelAiActionAction, "cancelled")}
              className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] text-xs font-bold text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] transition-colors disabled:opacity-60"
            >
              <X className="h-3.5 w-3.5" />
              Cancel
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => run(confirmAiActionAction, "confirmed")}
              className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-[var(--radius-control)] bg-[var(--color-action-primary)] text-xs font-bold text-[var(--color-action-on-primary)] hover:bg-[var(--color-action-hover)] transition-colors disabled:opacity-60"
            >
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Confirm
            </button>
          </div>
          <p className="text-[10px] text-[var(--color-text-secondary)]">
            Nothing is submitted until you confirm. Expires at {new Date(card.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.
          </p>
        </>
      ) : (
        <p
          role="status"
          className={`flex items-start gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-semibold ${
            state === "failed"
              ? "bg-[var(--color-status-error-bg)] text-[var(--color-status-error)]"
              : state === "confirmed"
              ? "bg-[var(--color-status-success-bg)] text-[var(--color-status-success)]"
              : "bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)]"
          }`}
        >
          {state === "confirmed" ? <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" /> : <XCircle className="mt-0.5 h-3 w-3 shrink-0" />}
          {message}
        </p>
      )}
    </div>
  );
}

/** Built by the server from the tools really called, so it cannot be invented by the model. */
export function SourcesLine({ sources }: { sources: CopilotSources }) {
  if (sources.policies.length === 0 && sources.data.length === 0) return null;
  return (
    <div className="space-y-0.5 border-t border-[var(--color-border-subtle)] pt-1.5 text-[10px] text-[var(--color-text-secondary)]">
      {sources.policies.length > 0 && (
        <p className="flex items-start gap-1">
          <BookOpen className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            <span className="font-bold">Sources: </span>
            {sources.policies.map((p) => `${p.title} > ${p.section}`).join("; ")}
          </span>
        </p>
      )}
      {sources.data.length > 0 && (
        <p className="flex items-start gap-1">
          <Database className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            <span className="font-bold">Data used: </span>
            {sources.data.join(", ")}
          </span>
        </p>
      )}
    </div>
  );
}
