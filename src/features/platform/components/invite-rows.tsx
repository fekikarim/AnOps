"use client";

import { useId, useState, useTransition } from "react";
import { sendInvitationsAction } from "@/features/platform/actions/lifecycle.action";
import type { InviteOutcome } from "@/server/platform/invitation.service";
import { cn } from "@/shared/lib/utils";

type Row = { key: number; email: string; role: "employee" | "manager" | "admin" };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STATUS_TEXT: Record<InviteOutcome["status"], string> = {
  sent: "Invitation sent",
  not_delivered: "Saved, but the email could not be sent. Resend it from Members.",
  already_member: "Already a member",
  already_invited: "Already invited",
};

/** Add/remove invitation rows with role selection. Validation runs here for feedback and on the server. */
export function InviteRows({ canInviteAdmins, onDone, submitLabel = "Send invitations" }: { canInviteAdmins: boolean; onDone?: (outcomes: InviteOutcome[]) => void; submitLabel?: string }) {
  const baseId = useId();
  const [rows, setRows] = useState<Row[]>([{ key: 1, email: "", role: "employee" }]);
  const [error, setError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<InviteOutcome[] | null>(null);
  const [pending, start] = useTransition();

  const update = (key: number, patch: Partial<Row>) => setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const filled = rows.filter((row) => row.email.trim());
  const invalid = filled.filter((row) => !EMAIL.test(row.email.trim()));

  const submit = () => {
    setError(null);
    if (filled.length === 0) return setError("Add at least one email address.");
    if (invalid.length > 0) return setError(`Check ${invalid.map((r) => r.email).join(", ")}.`);
    start(async () => {
      const result = await sendInvitationsAction(filled.map((row) => ({ email: row.email.trim().toLowerCase(), role: row.role })));
      if (!result.ok) return setError(result.error.message);
      setOutcomes(result.data);
      setRows([{ key: Date.now(), email: "", role: "employee" }]);
      onDone?.(result.data);
    });
  };

  return (
    <div>
      <ul className="space-y-3">
        {rows.map((row, index) => {
          const bad = row.email.trim() !== "" && !EMAIL.test(row.email.trim());
          return (
            <li key={row.key} className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_160px_auto]">
              <label className="sr-only" htmlFor={`${baseId}-email-${row.key}`}>
                Email {index + 1}
              </label>
              <input
                id={`${baseId}-email-${row.key}`}
                type="email"
                inputMode="email"
                value={row.email}
                onChange={(event) => update(row.key, { email: event.target.value })}
                placeholder="colleague@company.com"
                aria-invalid={bad || undefined}
                className={cn(
                  "h-12 w-full rounded-[var(--radius-control)] border bg-[var(--color-bg-surface)] px-3.5 text-[15px] text-[var(--color-text-primary)] focus:outline-none focus:ring-[3px] focus:ring-[var(--color-focus-ring)]",
                  bad ? "border-[var(--color-status-error-fg)]" : "border-[var(--color-border-control)]"
                )}
              />
              <label className="sr-only" htmlFor={`${baseId}-role-${row.key}`}>
                Role {index + 1}
              </label>
              <select
                id={`${baseId}-role-${row.key}`}
                value={row.role}
                onChange={(event) => update(row.key, { role: event.target.value as Row["role"] })}
                className="col-span-1 h-12 rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3 text-sm text-[var(--color-text-primary)] max-sm:col-start-1 max-sm:row-start-2"
              >
                <option value="employee">Employee · view</option>
                <option value="manager">Manager · operate</option>
                {canInviteAdmins && <option value="admin">Administrator</option>}
              </select>
              <button
                type="button"
                onClick={() => setRows((current) => (current.length === 1 ? [{ key: Date.now(), email: "", role: "employee" }] : current.filter((r) => r.key !== row.key)))}
                aria-label={`Remove row ${index + 1}`}
                className="h-12 w-12 rounded-[var(--radius-control)] text-xl text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text-primary)]"
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        disabled={rows.length >= 20}
        onClick={() => setRows((current) => [...current, { key: Date.now(), email: "", role: current.at(-1)?.role ?? "employee" }])}
        className="mt-3 inline-flex min-h-[40px] items-center text-sm font-semibold text-[var(--color-text-primary)] underline underline-offset-4 disabled:opacity-50"
      >
        + Add another
      </button>
      {error && (
        <p role="alert" className="mt-3 text-sm text-[var(--color-status-error-fg)]">
          {error}
        </p>
      )}
      {outcomes && (
        <ul role="status" className="mt-4 space-y-1.5 rounded-[12px] bg-[var(--color-bg-subtle)] p-3 text-sm">
          {outcomes.map((outcome) => (
            <li key={outcome.email} className="flex flex-wrap justify-between gap-2">
              <span className="font-medium text-[var(--color-text-primary)]">{outcome.email}</span>
              <span className={outcome.status === "sent" ? "text-[var(--color-status-success-fg)]" : "text-[var(--color-text-secondary)]"}>{STATUS_TEXT[outcome.status]}</span>
            </li>
          ))}
        </ul>
      )}
      <button type="button" onClick={submit} disabled={pending} className="mt-5 inline-flex h-12 w-full items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-action-primary)] text-sm font-semibold text-[#111F1D] hover:bg-[var(--color-action-hover)] disabled:opacity-70">
        {pending ? "Sending…" : submitLabel}
      </button>
    </div>
  );
}
