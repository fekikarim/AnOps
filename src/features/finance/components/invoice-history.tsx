"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Undo2 } from "lucide-react";
import { reverseAllocationAction } from "@/features/finance/actions/finance.actions";
import { Button } from "@/shared/components/ui/button";

type Allocation = { id: string; amount: number; allocatedAt: string; reversedAt?: string; reversalReason?: string };
type CreditNote = { id: string; number: string; amount: number; reason: string; createdAt: string };

/** Payments applied to the invoice and its credit notes. A wrong allocation can be reversed, with a reason; it stays visible as reversed. */
export function InvoiceHistory({ invoiceId, currency, allocations, creditNotes, canAllocate }: { invoiceId: string; currency: string; allocations: Allocation[]; creditNotes: CreditNote[]; canAllocate: boolean }) {
  const router = useRouter();
  const [reversing, setReversing] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fmt = (n: number) => new Intl.NumberFormat("fr-TN", { style: "currency", currency }).format(n || 0);

  if (!allocations.length && !creditNotes.length) return null;

  function reverse(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await reverseAllocationAction(id, invoiceId, reason);
      if (res.error) return setError(res.error);
      setReversing(null);
      setReason("");
      router.refresh();
    });
  }

  return (
    <div className="border-t border-[var(--color-border-subtle)] pt-4 space-y-2 print:border-gray-300">
      <div className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] print:text-gray-500">Payments and credits</div>
      <ul className="space-y-1 text-xs">
        {allocations.map((a) => (
          <li key={a.id} className="rounded bg-[var(--color-bg-subtle)]/40 p-2 text-[var(--color-text-primary)] print:border print:border-gray-200">
            <div className="flex items-center justify-between gap-2">
              <span className={a.reversedAt ? "line-through text-[var(--color-text-secondary)]" : undefined}>Payment applied on {a.allocatedAt.slice(0, 10)}</span>
              <span className="flex items-center gap-2">
                <span className={a.reversedAt ? "line-through text-[var(--color-text-secondary)]" : "font-medium text-[var(--color-status-success)]"}>+{fmt(a.amount)}</span>
                {canAllocate && !a.reversedAt && reversing !== a.id && (
                  <button type="button" onClick={() => (setReversing(a.id), setError(null))} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text-primary)] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)] print:hidden" title="Undo this allocation: the money goes back to the payment">
                    <Undo2 aria-hidden className="size-3.5" /> Reverse
                  </button>
                )}
              </span>
            </div>
            {a.reversedAt && <p className="mt-1 text-[var(--color-text-secondary)]">Reversed {a.reversedAt.slice(0, 10)}{a.reversalReason ? `: ${a.reversalReason}` : ""}</p>}
            {reversing === a.id && (
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center print:hidden">
                <label htmlFor={`rev-${a.id}`} className="sr-only">Reason for the reversal</label>
                <input id={`rev-${a.id}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason, e.g. applied to the wrong invoice" maxLength={300} className="min-h-[36px] flex-1 rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-2 text-xs text-[var(--color-text-primary)]" />
                <div className="flex gap-2">
                  <Button variant="ghost" className="min-h-[36px] px-3 text-xs" onClick={() => setReversing(null)} disabled={pending}>Cancel</Button>
                  <Button variant="danger" className="min-h-[36px] px-3 text-xs" onClick={() => reverse(a.id)} disabled={pending || reason.trim().length < 3}>Reverse</Button>
                </div>
              </div>
            )}
          </li>
        ))}
        {creditNotes.map((n) => (
          <li key={n.id} className="flex justify-between gap-2 rounded bg-[var(--color-bg-subtle)]/40 p-2 text-[var(--color-text-primary)] print:border print:border-gray-200">
            <span>
              Credit note <span className="font-mono">{n.number}</span> on {n.createdAt.slice(0, 10)}: {n.reason}
            </span>
            <span className="shrink-0 font-medium">−{fmt(n.amount)}</span>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="text-xs text-[var(--color-status-error)]">{error}</p>}
    </div>
  );
}
