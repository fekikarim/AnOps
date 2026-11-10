"use client";

import { useState, useEffect, useTransition } from "react";
import { X, UserMinus, AlertTriangle, Loader2, CheckCircle2 } from "lucide-react";
import type { Employee } from "@/features/hr/types";
import { getDepartureReviewAction, confirmDepartureCompensationAction } from "@/features/hr/actions/leave.action";
import { Portal } from "@/shared/components/ui/portal";
import { useScrollLock } from "@/shared/hooks/use-scroll-lock";
import { useDialog } from "@/shared/hooks/use-dialog";

type DepartureReviewModalProps = {
  isOpen: boolean;
  onClose: () => void;
  employee: Employee;
  onSuccess?: () => void;
};

export function DepartureReviewModal({
  isOpen,
  onClose,
  employee,
  onSuccess,
}: DepartureReviewModalProps) {
  const [data, setData] = useState<{
    earned: number;
    taken: number;
    potentialCompensationDays: number;
    warning: string;
  } | null>(null);
  // Which employee the loaded data belongs to; loading is simply "open and not loaded yet".
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();

  useScrollLock(isOpen);
  const dialogRef = useDialog<HTMLDivElement>(isOpen, onClose);

  if (!isOpen && loadedFor !== null) setLoadedFor(null); // reopening always reloads
  const loading = isOpen && loadedFor !== employee.id;

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    getDepartureReviewAction(employee.id).then((res) => {
      if (cancelled) return;
      setError(res.error ?? null);
      if (res.data) setData(res.data);
      setLoadedFor(employee.id);
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, employee.id]);

  const handleConfirmCompensation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!data) return;

    if (!reason.trim()) {
      setError("Please enter a departure / validation reason.");
      return;
    }

    startTransition(async () => {
      const res = await confirmDepartureCompensationAction(
        employee.id,
        data.potentialCompensationDays,
        reason.trim()
      );

      if (res.error) {
        setError(res.error);
      } else {
        onSuccess?.();
        onClose();
      }
    });
  };

  if (!isOpen) return null;

  return (
    <Portal>
      <div role="dialog" ref={dialogRef} tabIndex={-1} aria-modal="true" aria-label="Departure review" className="fixed inset-0 z-50 flex flex-col justify-end sm:justify-center sm:items-center overflow-hidden p-0 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
        <div
          className="relative w-full max-w-lg rounded-t-[calc(var(--radius-card)+6px)] sm:rounded-[var(--radius-card)] border-t sm:border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 sm:p-6 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] pb-3">
            <div className="flex items-center gap-2">
              <UserMinus className="h-5 w-5 text-amber-500" />
              <h2 className="text-lg font-bold tracking-tight text-[var(--color-text-primary)]">
                Departure Review — Unused Leave Balance
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              aria-label="Close"
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[var(--radius-control)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {error && (
            <div className="mt-3 flex items-start gap-2.5 rounded-[var(--radius-control)] border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="flex flex-col items-center justify-center py-10 text-sm text-[var(--color-text-secondary)]">
              <Loader2 className="h-6 w-6 animate-spin mb-2" />
              <span>Calculating remaining balance...</span>
            </div>
          ) : data ? (
            <form onSubmit={handleConfirmCompensation} className="mt-4 space-y-4">
              <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-canvas)] p-3 text-xs space-y-2">
                <p className="font-semibold text-sm text-[var(--color-text-primary)]">
                  Employee: {employee.fullName} ({employee.jobTitle})
                </p>
                <div className="grid grid-cols-3 gap-2 text-center pt-2 border-t border-[var(--color-border-subtle)]">
                  <div>
                    <span className="text-[10px] text-[var(--color-text-secondary)] block">Days Earned</span>
                    <span className="text-sm font-bold text-[var(--color-text-primary)]">{data.earned} j</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[var(--color-text-secondary)] block">Days Taken</span>
                    <span className="text-sm font-bold text-[var(--color-text-primary)]">{data.taken} j</span>
                  </div>
                  <div className="bg-amber-500/10 rounded p-1">
                    <span className="text-[10px] text-amber-700 block font-bold">Unused Balance</span>
                    <span className="text-sm font-extrabold text-amber-700">{data.potentialCompensationDays} j</span>
                  </div>
                </div>
              </div>

              {/* Legal Warning Notice */}
              <div className="flex items-start gap-2.5 rounded-[var(--radius-control)] border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
                <p className="leading-relaxed">
                  <strong>Legal Notice:</strong> Paid leave compensation is not automatic.
                  Eligibility depends on the termination reason (e.g., excluded for gross misconduct, Art. 120 Labour Code) and applicable collective agreement.
                </p>
              </div>

              {/* Reason input */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold tracking-wide text-[var(--color-text-secondary)] uppercase">
                  HR Validation Reason
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="E.g. End of fixed-term contract, resignation with served notice, final settlement..."
                  rows={2}
                  required
                  disabled={isPending}
                  className="w-full rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] p-3 text-sm text-[var(--color-text-primary)] resize-none"
                />
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[var(--color-border-subtle)]">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isPending}
                  className="px-4 py-2 text-sm font-semibold rounded-[var(--radius-control)] border border-[var(--color-border-subtle)]"
                >
                  Close without compensation
                </button>
                <button
                  type="submit"
                  disabled={isPending || data.potentialCompensationDays <= 0}
                  className="flex items-center gap-2 px-5 py-2 text-sm font-bold rounded-[var(--radius-control)] bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  {isPending ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /><span>Validating...</span></>
                  ) : (
                    <><CheckCircle2 className="h-4 w-4" /><span>Confirm compensation ({data.potentialCompensationDays}d)</span></>
                  )}
                </button>
              </div>
            </form>
          ) : null}
        </div>
      </div>
    </Portal>
  );
}
