"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Check, CircleSlash, Loader2, ShieldCheck, TriangleAlert } from "lucide-react";
import { cancelAiActionAction, confirmAiActionAction } from "@/features/ai/actions/ai.action";
import { Button } from "@/shared/components/ui/button";
import { DiffList, DraftPrompt, EntryChoice, GuidedForm, RecordCard, RecordTable } from "@/features/ai/components/result-parts";
import { StatusBadge, type BadgeTone } from "@/shared/components/data-display/status-badge";
import { errorCopy } from "@/shared/lib/action-error-copy";
import { cn } from "@/shared/lib/utils";
import type { AiMessagePart } from "@/server/db/documents";
import { AI_MODULE_LABELS, AI_OPERATION_LABELS, type AiRisk } from "@/shared/domain/ai";

type Part<T extends AiMessagePart["type"]> = Extract<AiMessagePart, { type: T }>;

/** Minimal, safe markdown: **bold**, `code`, - lists and paragraphs. Everything else renders as plain text. */
function Prose({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="space-y-3 text-[15px] leading-relaxed text-[var(--color-text-primary)]">
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*[-*]\s+/, ""))}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="whitespace-pre-wrap break-words">
            {inline(block)}
          </p>
        );
      })}
    </div>
  );
}

function inline(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((piece, i) => {
    if (piece.startsWith("**") && piece.endsWith("**")) return <strong key={i}>{piece.slice(2, -2)}</strong>;
    if (piece.startsWith("`") && piece.endsWith("`")) {
      return (
        <code key={i} className="rounded bg-[var(--color-bg-subtle)] px-1.5 py-0.5 font-mono text-[13px]">
          {piece.slice(1, -1)}
        </code>
      );
    }
    return piece;
  });
}

const RISK: Record<AiRisk, { label: string; tone: BadgeTone }> = {
  low: { label: "Standard change", tone: "neutral" },
  sensitive: { label: "Sensitive change", tone: "warning" },
  destructive: { label: "Permanent change", tone: "error" },
  financial: { label: "Financial change", tone: "warning" },
};

function AccessSummary({ part }: { part: Part<"access_summary"> }) {
  return (
    <section aria-label="What AnOps AI can do for you" className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
        <ShieldCheck aria-hidden className="size-4 text-[var(--color-accent-teal)]" />
        Your AI access
      </div>
      {part.modules.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">No modules are open to you yet. Ask an owner or administrator.</p>
      ) : (
        <dl className="mt-3 divide-y divide-[var(--color-border-subtle)]">
          {part.modules.map((m) => (
            <div key={m.module} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
              <dt className="text-sm font-medium text-[var(--color-text-primary)]">{AI_MODULE_LABELS[m.module]}</dt>
              <dd className="flex flex-wrap gap-1.5">
                {m.operations.map((op) => (
                  <StatusBadge key={op} label={AI_OPERATION_LABELS[op]} tone="info" />
                ))}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

type ConfirmState = "idle" | "working" | "done" | "cancelled" | "closed";

function ConfirmationCard({ part }: { part: Part<"confirmation"> }) {
  const [state, setState] = useState<ConfirmState>("idle");
  const [typed, setTyped] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [resultParts, setResultParts] = useState<AiMessagePart[]>([]);
  const [isError, setIsError] = useState(false);
  const [, startTransition] = useTransition();
  const risk = RISK[part.risk];
  const needsTyping = part.requiresTyped;

  const confirm = () => {
    setState("working");
    setMessage(null);
    startTransition(async () => {
      const result = await confirmAiActionAction({ actionId: part.actionId, ...(needsTyping ? { typedConfirmation: typed } : {}) });
      if (result.ok) {
        setState("done");
        setIsError(false);
        setMessage(result.data.summary);
        setResultParts(result.data.parts ?? []);
        return;
      }
      const copy = errorCopy(result.error);
      setIsError(true);
      setMessage(result.error.message || copy.title);
      // A wrong phrase can be retried; every other refusal ends this proposal.
      setState(result.error.code === "VALIDATION_ERROR" ? "idle" : "closed");
    });
  };

  const cancel = () => {
    setState("working");
    startTransition(async () => {
      const result = await cancelAiActionAction(part.actionId);
      if (result.ok) {
        setState("cancelled");
        setMessage("Cancelled. Nothing was changed.");
      } else {
        setState("closed");
        setIsError(true);
        setMessage(result.error.message);
      }
    });
  };

  const settled = state === "done" || state === "cancelled" || state === "closed";

  return (
    <section
      aria-label="Change waiting for your confirmation"
      className={cn(
        "rounded-[var(--radius-card)] border bg-[var(--color-bg-surface)] p-4",
        state === "done" ? "border-[var(--color-status-success)]" : part.risk === "destructive" ? "border-[var(--color-status-error)]" : "border-[var(--color-border-control)]"
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-[var(--color-text-primary)]">Review before it happens</span>
        <StatusBadge label={risk.label} tone={risk.tone} />
      </div>
      <p className="mt-2 text-[15px] text-[var(--color-text-primary)]">{part.summary}</p>
      <DiffList rows={part.details ?? []} />

      {!settled && needsTyping && (
        <div className="mt-3 space-y-1.5">
          <label htmlFor={`typed-${part.actionId}`} className="block text-sm font-semibold text-[var(--color-text-primary)]">
            Type <strong className="font-mono text-[13px]">{part.typedPhrase}</strong> to confirm
          </label>
          <input
            id={`typed-${part.actionId}`}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            className="min-h-[44px] w-full rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3 text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-[3px] focus:ring-[var(--color-focus-ring)]"
          />
        </div>
      )}

      {message && (
        <p role={isError ? "alert" : "status"} className={cn("mt-3 flex items-start gap-2 text-sm", isError ? "text-[var(--color-status-error-fg)]" : "text-[var(--color-status-success-fg)]")}>
          {isError ? <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" /> : state === "cancelled" ? <CircleSlash aria-hidden className="mt-0.5 size-4 shrink-0" /> : <Check aria-hidden className="mt-0.5 size-4 shrink-0" />}
          {message}
        </p>
      )}

      {resultParts.length > 0 && <div className="mt-3 space-y-3">{resultParts.map((p, i) => <MessagePart key={i} part={p} />)}</div>}

      {!settled && (
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button onClick={cancel} disabled={state === "working"}>
            Cancel
          </Button>
          <Button variant={part.risk === "destructive" ? "danger" : "primary"} onClick={confirm} disabled={state === "working" || (needsTyping && typed.trim().length === 0)}>
            {state === "working" && <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />}
            {state === "working" ? "Working" : "Confirm and apply"}
          </Button>
        </div>
      )}
    </section>
  );
}

function ToolStatus({ part }: { part: Part<"tool_status"> }) {
  const failed = part.status === "failed";
  return (
    <p className={cn("inline-flex items-center gap-2 text-xs", failed ? "text-[var(--color-status-error-fg)]" : "text-[var(--color-text-secondary)]")}>
      {part.status === "running" ? <Loader2 aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" /> : failed ? <AlertTriangle aria-hidden className="size-3.5" /> : <Check aria-hidden className="size-3.5" />}
      <span>{part.summary ?? part.tool.replace(/_/g, " ")}</span>
    </p>
  );
}

export function MessagePart({ part }: { part: AiMessagePart }) {
  switch (part.type) {
    case "text":
      return <Prose text={part.text} />;
    case "tool_status":
      return <ToolStatus part={part} />;
    case "confirmation":
      return <ConfirmationCard part={part} />;
    case "access_summary":
      return <AccessSummary part={part} />;
    case "record_table":
      return <RecordTable part={part} />;
    case "record_card":
      return <RecordCard part={part} />;
    case "form":
      return <GuidedForm part={part} />;
    case "entry_choice":
      return <EntryChoice part={part} />;
    case "draft_prompt":
      return <DraftPrompt part={part} />;
    case "error":
      return (
        <p role="alert" className="flex items-start gap-2 rounded-[var(--radius-control)] bg-[var(--color-status-error-bg)] px-3 py-2 text-sm text-[var(--color-status-error)]">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {part.message}
        </p>
      );
  }
}
