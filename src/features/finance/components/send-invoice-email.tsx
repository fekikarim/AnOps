"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Mail, Send } from "lucide-react";
import { sendInvoiceEmailAction } from "@/features/finance/actions/finance-ai.actions";
import { Button, selectClass } from "@/shared/components/ui/button";
import { Field, Textarea } from "@/shared/components/ui/form-kit";
import { useToast } from "@/shared/components/ui/toast";

/** Sends the posted invoice to the customer. The address and message are reviewed before anything is sent. */
export function SendInvoiceEmail({ invoiceId, customerEmail, lastSentAt, lastSentTo }: { invoiceId: string; customerEmail?: string; lastSentAt?: string; lastSentTo?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(customerEmail ?? "");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const sentLine = lastSentAt ? `Last sent ${new Date(lastSentAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}${lastSentTo ? ` to ${lastSentTo}` : ""}.` : null;

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <Button onClick={() => setOpen(true)}>
          <Mail aria-hidden className="size-4 shrink-0" /> Send by email
        </Button>
        {sentLine && <span className="text-xs text-[var(--color-text-secondary)]">{sentLine}</span>}
      </div>
    );
  }

  function send(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await sendInvoiceEmailAction(invoiceId, { to, message: note });
      if (res.error || !res.data) return setError(res.error ?? "The invoice could not be sent.");
      toast.success("Invoice sent", `To ${res.data.to}`);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <form onSubmit={send} className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 sm:p-5 space-y-4 print:hidden" aria-labelledby="send-heading">
      <h2 id="send-heading" className="flex items-center gap-2 text-base font-semibold text-[var(--color-text-primary)]">
        <Mail aria-hidden className="size-4" /> Send invoice by email
      </h2>
      <Field label="To" htmlFor="send-to" required hint={customerEmail ? "The customer's address; change it to send elsewhere." : "This customer has no e-mail on file."}>
        <input id="send-to" type="email" required className={selectClass} value={to} onChange={(e) => setTo(e.target.value)} placeholder="e.g. accounts@customer.tn" />
      </Field>
      <Field label="Message (optional)" htmlFor="send-note" hint="Shown above the invoice in the e-mail.">
        <Textarea id="send-note" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Please find our invoice for October. Thank you!" />
      </Field>
      {sentLine && <p className="text-xs text-[var(--color-text-secondary)]">{sentLine}</p>}
      {error && <p role="alert" className="text-sm text-[var(--color-status-error)]">{error}</p>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={pending || !to}>
          {pending ? <Loader2 aria-hidden className="size-4 shrink-0 animate-spin motion-reduce:animate-none" /> : <Send aria-hidden className="size-4 shrink-0" />}
          Send invoice
        </Button>
      </div>
    </form>
  );
}
