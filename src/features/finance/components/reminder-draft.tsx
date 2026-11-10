"use client";

import { useState, useTransition } from "react";
import { Copy, Loader2, Mail, Sparkles } from "lucide-react";
import { draftReminderAction } from "@/features/finance/actions/finance-ai.actions";
import { Button, buttonClass, selectClass } from "@/shared/components/ui/button";
import { Field, Textarea } from "@/shared/components/ui/form-kit";
import { useToast } from "@/shared/components/ui/toast";

/** AI-drafted payment reminder for one invoice. Nothing is sent: the person edits, then copies or opens it in their mail app. */
export function ReminderDraft({ invoiceId, overdue, customerEmail }: { invoiceId: string; overdue: boolean; customerEmail?: string }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [tone, setTone] = useState<"friendly" | "firm">(overdue ? "firm" : "friendly");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function generate(t = tone) {
    setError(null);
    startTransition(async () => {
      const res = await draftReminderAction(invoiceId, t);
      if (res.error || !res.data) return setError(res.error ?? "The reminder could not be drafted.");
      setSubject(res.data.subject);
      setBody(res.data.body);
    });
  }

  if (!open) {
    return (
      <Button onClick={() => (setOpen(true), generate())} className="print:hidden">
        <Sparkles aria-hidden className="size-4 shrink-0" /> {overdue ? "Draft overdue reminder" : "Draft payment reminder"}
      </Button>
    );
  }

  return (
    <section aria-labelledby="reminder-heading" className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 sm:p-5 space-y-4 print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="reminder-heading" className="flex items-center gap-2 text-base font-semibold text-[var(--color-text-primary)]">
          <Sparkles aria-hidden className="size-4 text-[var(--color-action-primary)]" /> Payment reminder
        </h2>
        <div role="radiogroup" aria-label="Tone" className="inline-flex rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] p-0.5">
          {(["friendly", "firm"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={tone === t}
              disabled={pending}
              onClick={() => (setTone(t), generate(t))}
              className={`rounded px-3 py-1 text-xs font-semibold capitalize focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)] ${tone === t ? "bg-[var(--color-action-primary)] text-[var(--color-action-on-primary)]" : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)]"}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {pending && !body ? (
        <p className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
          <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> Writing from the invoice figures…
        </p>
      ) : (
        <>
          <Field label="Subject" htmlFor="reminder-subject">
            <input id="reminder-subject" className={selectClass} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Reminder: invoice INV-2026-00012" />
          </Field>
          <Field label="Message" htmlFor="reminder-body" hint="Check the wording before you send it. Amounts and dates come from the invoice.">
            <Textarea id="reminder-body" rows={8} value={body} onChange={(e) => setBody(e.target.value)} placeholder="The reminder text appears here." />
          </Field>
        </>
      )}

      {error && <p role="alert" className="text-sm text-[var(--color-status-error)]">{error}</p>}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={() => setOpen(false)}>Close</Button>
        <Button
          disabled={!body}
          onClick={() =>
            navigator.clipboard?.writeText(`${subject}\n\n${body}`).then(
              () => toast.success("Reminder copied"),
              () => toast.error("Could not copy", "Select the text and copy it.")
            )
          }
        >
          <Copy aria-hidden className="size-4 shrink-0" /> Copy
        </Button>
        {customerEmail && body && (
          <a className={buttonClass("primary")} href={`mailto:${encodeURIComponent(customerEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}>
            <Mail aria-hidden className="size-4 shrink-0" /> Open in mail app
          </a>
        )}
      </div>
    </section>
  );
}
