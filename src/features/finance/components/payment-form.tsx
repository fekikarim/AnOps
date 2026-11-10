"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { recordPaymentAction } from "@/features/finance/actions/finance.actions";
import { Button, selectClass } from "@/shared/components/ui/button";
import { TextField } from "@/shared/components/ui/text-field";
import { FormMessage } from "@/shared/components/ui/form-message";

/** Today as a yyyy-mm-dd string in the person's own time zone (a UTC date would be "tomorrow" late in the evening in Tunis). */
function today(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

export function PaymentForm() {
  const uid = useId();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ amount: string; currency: string } | null>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  // Filled in the browser after hydration so the server and the browser can never disagree about "today".
  const fillToday = () => {
    if (dateRef.current && !dateRef.current.value) dateRef.current.value = today();
  };
  useEffect(fillToday, []);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setError(null);
    setSaved(null);
    start(async () => {
      const result = await recordPaymentAction(formData);
      if (result?.error) {
        setError(result.error);
        return;
      }
      setSaved({ amount: String(formData.get("amount") ?? ""), currency: String(formData.get("currency") ?? "") });
      form.reset();
      fillToday();
    });
  }

  const label = "text-sm font-medium text-[var(--color-text-secondary)]";
  return (
    <form onSubmit={onSubmit} className="max-w-2xl space-y-4 rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 sm:p-6" aria-busy={pending}>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField ref={dateRef} label="Payment date" name="paymentDate" type="date" required />
        <TextField label="Amount" name="amount" type="number" step="0.001" min="0.001" inputMode="decimal" required />
        <div className="space-y-1">
          <label htmlFor={`${uid}-method`} className={label}>
            Method
          </label>
          <select id={`${uid}-method`} name="method" className={selectClass} defaultValue="bank_transfer">
            <option value="bank_transfer">Bank transfer</option>
            <option value="cash">Cash</option>
            <option value="card">Card</option>
            <option value="cheque">Cheque</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor={`${uid}-currency`} className={label}>
            Currency
          </label>
          <select id={`${uid}-currency`} name="currency" className={selectClass} defaultValue="TND">
            <option value="TND">TND</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
            <option value="GBP">GBP</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <TextField label="Reference" name="reference" placeholder="e.g. bank transfer number" />
        </div>
      </div>

      {error && <FormMessage kind="error">{error}</FormMessage>}
      {saved && (
        <FormMessage kind="success">
          Payment of {saved.amount} {saved.currency} recorded. It stays unallocated until you match it to an invoice.{" "}
          <Link href="/finance/payments" className="font-semibold underline">
            Go to payments
          </Link>
        </FormMessage>
      )}

      <div className="flex justify-end gap-2">
        <Link href="/finance/payments" className="inline-flex min-h-[44px] items-center rounded-[var(--radius-control)] px-4 text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-bg-subtle)]">
          Back
        </Link>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Recording..." : "Record payment"}
        </Button>
      </div>
    </form>
  );
}
