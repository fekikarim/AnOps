"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Link from "next/link";
import { allocatePaymentAction, exportPaymentsCsvAction } from "@/features/finance/actions/finance.actions";
import { Sparkles } from "lucide-react";
import type { MatchSuggestion } from "@/features/finance/utils/insights";
import { Button } from "@/shared/components/ui/button";
import { StatusBadge } from "@/shared/components/data-display/status-badge";
import { FormMessage } from "@/shared/components/ui/form-message";
import { DialogOverlay } from "@/shared/components/ui/dialog-overlay";

type PaymentItem = {
  id: string;
  companyId: string;
  paymentDate: string;
  amount: number;
  currency: string;
  method: string;
  reference?: string;
  unallocatedAmount: number;
  createdAt: string;
};

type UnpaidInvoice = {
  id: string;
  invoiceNumber: string;
  customerId?: string;
  customerName: string;
  total: number;
  amountPaid: number;
  balance: number;
  currency: string;
  dueDate?: string;
};

export function PaymentManager({
  payments,
  unpaidInvoices,
  canAllocate,
  suggestions = {},
}: {
  /** Best matches per payment id, computed by code from references, amounts and customers. */
  suggestions?: Record<string, MatchSuggestion[]>;
  payments: PaymentItem[];
  unpaidInvoices: UnpaidInvoice[];
  canAllocate: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Allocation Modal State
  const [allocatingPayment, setAllocatingPayment] = useState<PaymentItem | null>(null);
  const [allocMap, setAllocMap] = useState<Record<string, number>>({});
  const [modalError, setModalError] = useState<string | null>(null);

  const fmt = (n: number, c: string) =>
    new Intl.NumberFormat("fr-TN", { style: "currency", currency: c || "TND" }).format(n || 0);

  function openAllocateModal(p: PaymentItem, preset?: MatchSuggestion) {
    setAllocatingPayment(p);
    setAllocMap(preset ? Object.fromEntries(preset.allocations.map((a) => [a.invoiceId, a.amount])) : {});
    setModalError(null);
  }

  // Money is never applied across currencies, so the dialog only offers invoices in the payment's currency.
  const modalInvoices = allocatingPayment ? unpaidInvoices.filter((inv) => inv.currency === allocatingPayment.currency) : [];

  function handleAutoDistribute(p: PaymentItem) {
    let remaining = p.unallocatedAmount || 0;
    const newMap: Record<string, number> = {};

    for (const inv of unpaidInvoices.filter((i) => i.currency === p.currency)) {
      if (remaining <= 0) break;
      const toApply = Math.min(remaining, inv.balance);
      if (toApply > 0) {
        newMap[inv.id] = Math.round(toApply * 100) / 100;
        remaining -= toApply;
      }
    }
    setAllocMap(newMap);
  }

  const currentTotalAlloc = Object.values(allocMap).reduce((sum, v) => sum + (Number(v) || 0), 0);
  const remainingUnallocated = (allocatingPayment?.unallocatedAmount || 0) - currentTotalAlloc;

  function handleAllocateSubmit(e: React.FormEvent) {
    e.preventDefault();
    setModalError(null);

    if (!allocatingPayment) return;

    const allocations = Object.entries(allocMap)
      .map(([invoiceId, amount]) => ({ invoiceId, amount: Number(amount) || 0 }))
      .filter((a) => a.amount > 0);

    if (allocations.length === 0) {
      setModalError("Please specify an amount to allocate to at least one invoice.");
      return;
    }

    if (currentTotalAlloc > allocatingPayment.unallocatedAmount) {
      setModalError(`Total allocated (${currentTotalAlloc}) exceeds available unallocated amount (${allocatingPayment.unallocatedAmount}).`);
      return;
    }

    startTransition(async () => {
      const res = await allocatePaymentAction({
        paymentId: allocatingPayment.id,
        allocations,
      });

      if (res.error) {
        setModalError(res.error);
        return;
      }

      setAllocatingPayment(null);
      setMessage({ type: "success", text: "Payment allocated successfully to invoice(s)." });
      router.refresh();
    });
  }

  function handleExport() {
    startTransition(async () => {
      const res = await exportPaymentsCsvAction();
      if (res.error) {
        setMessage({ type: "error", text: res.error });
        return;
      }
      if (res.data?.csv) {
        const blob = new Blob([res.data.csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.setAttribute("download", res.data.filename || "payments.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }
    });
  }

  const totalCollected = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
  const totalUnallocated = payments.reduce((sum, p) => sum + (p.unallocatedAmount || 0), 0);

  return (
    <div className="space-y-6">
      {/* Top Stats */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="p-4 bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-[var(--radius-control)]">
          <div className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
            Total Payments Received
          </div>
          <div className="mt-1 text-2xl font-semibold text-[var(--color-text-primary)]">
            {fmt(totalCollected, "TND")}
          </div>
        </div>
        <div className="p-4 bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-[var(--radius-control)]">
          <div className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
            Unallocated Funds
          </div>
          <div className="mt-1 text-2xl font-semibold text-[var(--color-status-warning)]">
            {fmt(totalUnallocated, "TND")}
          </div>
        </div>
        <div className="p-4 bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-[var(--radius-control)]">
          <div className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
            Open Invoices Awaiting Payment
          </div>
          <div className="mt-1 text-2xl font-semibold text-[var(--color-action-primary)]">
            {unpaidInvoices.length}
          </div>
        </div>
      </div>

      {message && (
        <FormMessage kind={message.type === "success" ? "success" : "error"}>
          {message.text}
        </FormMessage>
      )}

      {/* Control Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm font-medium text-[var(--color-text-primary)]">
          Payment Transactions
        </div>
        <div className="flex items-center gap-2">
          {payments.length > 0 && (
            <Button variant="secondary" onClick={handleExport} disabled={pending} className="text-xs">
              ⬇ Export CSV
            </Button>
          )}
          <Link
            href="/finance/payments/new"
            className="inline-flex min-h-[40px] items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-action-primary)] text-[var(--color-action-on-primary)] px-4 text-xs font-semibold hover:bg-[var(--color-action-hover)]"
          >
            + Record Payment
          </Link>
        </div>
      </div>

      {/* Payments Table */}
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)]/50 text-[var(--color-text-secondary)] font-medium text-xs">
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Method</th>
                <th className="py-3 px-4">Reference</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Amount Received</th>
                <th className="py-3 px-4 text-right">Unallocated Balance</th>
                <th className="py-3 px-4 text-right">Allocation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border-subtle)]">
              {payments.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-[var(--color-text-secondary)] text-sm">
                    No payments recorded yet. Record incoming client payments to reconcile invoices.
                  </td>
                </tr>
              ) : (
                payments.map((p) => {
                  const isUnallocated = p.unallocatedAmount > 0;
                  // Nothing allocated yet is "Unallocated"; only a payment with some of it matched is "Partially allocated".
                  const allocation = !isUnallocated ? "Fully allocated" : p.unallocatedAmount >= p.amount ? "Unallocated" : "Partially allocated";
                  return (
                    <tr key={p.id} className="hover:bg-[var(--color-bg-subtle)]/40 transition-colors">
                      <td className="py-3 px-4 text-xs text-[var(--color-text-primary)] whitespace-nowrap">
                        {p.paymentDate}
                      </td>
                      <td className="py-3 px-4 capitalize font-medium text-[var(--color-text-primary)]">
                        {p.method.replace("_", " ")}
                      </td>
                      <td className="py-3 px-4 text-xs font-mono text-[var(--color-text-secondary)]">
                        {p.reference || "—"}
                      </td>
                      <td className="py-3 px-4">
                        <StatusBadge
                          label={allocation}
                          tone={isUnallocated ? "warning" : "success"}
                        />
                      </td>
                      <td className="py-3 px-4 text-right font-medium text-[var(--color-text-primary)] tabular-nums">
                        {fmt(p.amount, p.currency)}
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums">
                        <span className={isUnallocated ? "font-semibold text-[var(--color-status-warning)]" : "text-[var(--color-text-secondary)]"}>
                          {fmt(p.unallocatedAmount, p.currency)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        {canAllocate && isUnallocated && suggestions[p.id]?.[0] && (
                          <button
                            onClick={() => openAllocateModal(p, suggestions[p.id][0])}
                            title={suggestions[p.id][0].reason}
                            className="mr-1.5 inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold bg-[var(--color-status-success-bg)] text-[var(--color-status-success)] hover:opacity-80"
                          >
                            <Sparkles aria-hidden className="size-3.5 shrink-0" />
                            Match {suggestions[p.id][0].allocations.length > 1 ? `${suggestions[p.id][0].allocations.length} invoices` : unpaidInvoices.find((i) => i.id === suggestions[p.id][0].allocations[0].invoiceId)?.invoiceNumber}
                          </button>
                        )}
                        {canAllocate && isUnallocated && (
                          <button
                            onClick={() => openAllocateModal(p)}
                            className="px-2.5 py-1 rounded text-xs font-semibold bg-[var(--color-action-primary)]/10 text-[var(--color-action-primary)] hover:bg-[var(--color-action-primary)]/20"
                          >
                            Allocate →
                          </button>
                        )}
                        {!isUnallocated && (
                          <span className="text-xs text-[var(--color-status-success)] font-medium">
                            ✓ Reconciled
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Allocation Modal */}
      {allocatingPayment && (
        <DialogOverlay label="Allocate payment" onClose={() => setAllocatingPayment(null)} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-6 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] pb-3">
              <div>
                <h3 className="text-base font-semibold text-[var(--color-text-primary)]">
                  Allocate Payment ({fmt(allocatingPayment.amount, allocatingPayment.currency)})
                </h3>
                <p className="text-xs text-[var(--color-text-secondary)]">
                  Available Unallocated: <span className="font-semibold text-[var(--color-action-primary)]">{fmt(allocatingPayment.unallocatedAmount, allocatingPayment.currency)}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAllocatingPayment(null)}
                className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              >
                ✕ Close
              </button>
            </div>

            {modalInvoices.length === 0 ? (
              <div className="py-6 text-center text-sm text-[var(--color-text-secondary)] space-y-2">
                <div>There are currently no open/unpaid posted invoices to reconcile.</div>
                <Button variant="secondary" onClick={() => setAllocatingPayment(null)}>
                  Close
                </Button>
              </div>
            ) : (
              <form onSubmit={handleAllocateSubmit} className="space-y-4">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-[var(--color-text-secondary)]">Select open invoices to apply funds:</span>
                  <button
                    type="button"
                    onClick={() => handleAutoDistribute(allocatingPayment)}
                    className="font-medium text-[var(--color-action-primary)] hover:underline"
                  >
                    ⚡ Auto-distribute funds
                  </button>
                </div>

                <div className="space-y-2 max-h-60 overflow-y-auto divide-y divide-[var(--color-border-subtle)] border border-[var(--color-border-subtle)] rounded-[var(--radius-control)] p-2">
                  {modalInvoices.map((inv) => {
                    const allocatedVal = allocMap[inv.id] || "";
                    return (
                      <div key={inv.id} className="pt-2 first:pt-0 flex items-center justify-between gap-3 text-xs">
                        <div className="space-y-0.5">
                          <div className="font-semibold text-[var(--color-text-primary)]">
                            {inv.invoiceNumber} · {inv.customerName}
                          </div>
                          <div className="text-[var(--color-text-secondary)]">
                            Total: {fmt(inv.total, inv.currency)} · Remaining Balance: <span className="font-medium text-[var(--color-text-primary)]">{fmt(inv.balance, inv.currency)}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="text-[var(--color-text-secondary)]">Apply:</span>
                          <input
                            type="number"
                            min="0"
                            max={inv.balance}
                            step="0.01"
                            value={allocatedVal}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value) || 0;
                              setAllocMap((prev) => ({ ...prev, [inv.id]: Math.min(v, inv.balance) }));
                            }}
                            placeholder="0.00"
                            className="w-24 px-2 py-1 rounded border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] text-right font-medium text-[var(--color-text-primary)]"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Live balance check */}
                <div className="p-3 rounded bg-[var(--color-bg-subtle)]/70 text-xs flex justify-between items-center">
                  <div>
                    Total Allocated: <span className="font-semibold text-[var(--color-text-primary)]">{fmt(currentTotalAlloc, allocatingPayment.currency)}</span>
                  </div>
                  <div>
                    Remaining Unallocated: <span className={`font-semibold ${remainingUnallocated < 0 ? "text-[var(--color-status-error)]" : "text-[var(--color-status-success)]"}`}>
                      {fmt(remainingUnallocated, allocatingPayment.currency)}
                    </span>
                  </div>
                </div>

                {modalError && <FormMessage kind="error">{modalError}</FormMessage>}

                <div className="flex justify-end gap-2 pt-2 border-t border-[var(--color-border-subtle)]">
                  <Button variant="secondary" onClick={() => setAllocatingPayment(null)} disabled={pending}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    type="submit"
                    disabled={pending || currentTotalAlloc <= 0 || remainingUnallocated < 0}
                  >
                    {pending ? "Applying..." : "Confirm & Apply Payment"}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </DialogOverlay>
      )}
    </div>
  );
}
