"use client";

import { useState, useEffect, useTransition } from "react";
import { X, Clock, RefreshCw, AlertCircle, RotateCcw, ArrowDownLeft, ArrowUpRight, ShieldCheck } from "lucide-react";
import type { LeaveTransactionRecord, Employee } from "@/features/hr/types";
import { fetchLeaveTransactionsAction, reverseLeaveTransactionAction } from "@/features/hr/actions/leave.action";
import { Portal } from "@/shared/components/ui/portal";
import { useScrollLock } from "@/shared/hooks/use-scroll-lock";
import { useDialog } from "@/shared/hooks/use-dialog";

type LeaveHistoryModalProps = {
  isOpen: boolean;
  onClose: () => void;
  employee: Employee;
  isAdmin: boolean;
  onRefresh?: () => void;
};

export function LeaveHistoryModal({
  isOpen,
  onClose,
  employee,
  isAdmin,
  onRefresh,
}: LeaveHistoryModalProps) {
  const [transactions, setTransactions] = useState<LeaveTransactionRecord[]>([]);
  // "version" bumps to force a reload (after a reversal); loading is "open and the current version is not loaded yet".
  const [version, setVersion] = useState(0);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Reversal sub-state
  const [reversingTxId, setReversingTxId] = useState<string | null>(null);
  const [reversalReason, setReversalReason] = useState("");

  useScrollLock(isOpen);
  const dialogRef = useDialog<HTMLDivElement>(isOpen, onClose);

  const requestKey = `${employee.id}:${version}`;
  if (!isOpen && loadedKey !== null) setLoadedKey(null); // reopening always reloads
  const loading = isOpen && loadedKey !== requestKey;
  const loadTransactions = () => setVersion((current) => current + 1);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    fetchLeaveTransactionsAction({ employeeId: employee.id }).then((res) => {
      if (cancelled) return;
      setError(res.error ?? null);
      if (res.data) setTransactions(res.data);
      setLoadedKey(requestKey);
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, employee.id, requestKey]);

  const handleConfirmReversal = (txId: string) => {
    if (!reversalReason.trim() || reversalReason.trim().length < 3) {
      setError("A reversal reason (at least 3 characters) is required.");
      return;
    }

    startTransition(async () => {
      const res = await reverseLeaveTransactionAction(txId, reversalReason.trim());
      if (res.error) {
        setError(res.error);
      } else {
        setReversingTxId(null);
        setReversalReason("");
        loadTransactions();
        onRefresh?.();
      }
    });
  };

  if (!isOpen) return null;

  return (
    <Portal>
      <div role="dialog" ref={dialogRef} tabIndex={-1} aria-modal="true" aria-label="Leave history" className="fixed inset-0 z-50 flex flex-col justify-end sm:justify-center sm:items-center overflow-hidden p-0 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
        <div
          className="relative w-full max-w-2xl max-h-[92dvh] sm:max-h-[85vh] overflow-hidden flex flex-col rounded-t-[calc(var(--radius-card)+6px)] sm:rounded-[var(--radius-card)] border-t sm:border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 sm:p-6 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] pb-3 sm:pb-4 shrink-0">
            <div>
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-[var(--color-action-primary)]" />
                <h2 className="text-lg sm:text-xl font-bold tracking-tight text-[var(--color-text-primary)]">
                  Leave Balance History
                </h2>
              </div>
              <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                Append-only leave ledger for <strong>{employee.fullName}</strong>.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              aria-label="Close"
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[var(--radius-control)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] transition-colors shrink-0"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {error && (
            <div className="mt-3 flex items-start gap-2.5 rounded-[var(--radius-control)] border border-[var(--color-status-error)]/30 bg-[var(--color-status-error-bg)] p-3 text-xs text-[var(--color-status-error)] shrink-0">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Transaction List */}
          <div className="mt-4 flex-1 overflow-y-auto space-y-2.5 pr-1">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-12 text-[var(--color-text-secondary)] text-sm">
                <RefreshCw className="h-6 w-6 animate-spin mb-2" />
                <span>Loading ledger...</span>
              </div>
            ) : transactions.length === 0 ? (
              <div className="text-center py-12 text-[var(--color-text-secondary)] text-sm">
                No leave transactions recorded yet.
              </div>
            ) : (
              transactions.map((tx) => {
                const isPositive = tx.days > 0;
                const isReversalTarget = reversingTxId === tx.id;

                let badgeColor = "bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)]";
                if (tx.transactionType === "ACCRUAL") badgeColor = "bg-blue-500/10 text-blue-600 border border-blue-500/20";
                if (tx.transactionType === "TAKEN") badgeColor = "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20";
                if (tx.transactionType === "RESERVATION") badgeColor = "bg-amber-500/10 text-amber-600 border border-amber-500/20";
                if (tx.transactionType === "RELEASE") badgeColor = "bg-purple-500/10 text-purple-600 border border-purple-500/20";
                if (tx.transactionType === "ADJUSTMENT") badgeColor = "bg-orange-500/10 text-orange-600 border border-orange-500/20";
                if (tx.transactionType === "REVERSAL") badgeColor = "bg-red-500/10 text-red-600 border border-red-500/20";

                return (
                  <div
                    key={tx.id}
                    className="flex flex-col rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-canvas)] p-3 text-xs gap-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${badgeColor}`}>
                          {tx.transactionType}
                        </span>
                        <span className="text-[var(--color-text-secondary)] font-mono text-[11px]">
                          {tx.effectiveDate}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`font-bold text-sm ${
                            isPositive ? "text-emerald-600" : "text-amber-600"
                          }`}
                        >
                          {isPositive ? `+${tx.days}` : tx.days} d
                        </span>
                        {isAdmin && tx.transactionType !== "REVERSAL" && (
                          <button
                            type="button"
                            onClick={() => {
                              setReversingTxId(isReversalTarget ? null : tx.id);
                              setReversalReason("");
                            }}
                            className="p-1 rounded hover:bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)] hover:text-red-500 transition-colors"
                            title="Reverse this transaction"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    <p className="text-[var(--color-text-primary)] font-medium">
                      {tx.description}
                    </p>

                    <div className="flex items-center justify-between text-[10px] text-[var(--color-text-secondary)] pt-1 border-t border-[var(--color-border-subtle)]/50">
                      <span>Author: {tx.createdBy}</span>
                      <span>{new Date(tx.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                    </div>

                    {/* Inline Reversal Form */}
                    {isReversalTarget && (
                      <div className="mt-2 p-2.5 rounded bg-[var(--color-bg-surface)] border border-red-500/30 space-y-2">
                          <span className="font-semibold text-red-600 text-[11px]">
                          Reason for reversing this transaction:
                        </span>
                        <input
                          type="text"
                          value={reversalReason}
                          onChange={(e) => setReversalReason(e.target.value)}
                          placeholder="E.g. Data entry error, schedule correction..."
                          className="w-full min-h-[36px] rounded px-2.5 text-xs border border-[var(--color-border-control)] bg-[var(--color-bg-surface)]"
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setReversingTxId(null)}
                            className="px-2.5 py-1 text-xs rounded border border-[var(--color-border-subtle)]"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => handleConfirmReversal(tx.id)}
                            disabled={isPending}
                            className="px-3 py-1 text-xs rounded bg-red-600 text-white font-bold hover:bg-red-700"
                          >
                            Confirm Reversal
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Footer note */}
          <div className="mt-4 pt-3 border-t border-[var(--color-border-subtle)] flex items-center justify-between text-[11px] text-[var(--color-text-secondary)] shrink-0">
            <span className="flex items-center gap-1">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
              Append-only protected ledger
            </span>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] hover:bg-[var(--color-bg-subtle)] text-xs font-semibold"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
