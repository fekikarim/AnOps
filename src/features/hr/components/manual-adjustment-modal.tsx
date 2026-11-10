"use client";

import { useState, useTransition } from "react";
import { X, Sliders, AlertCircle, Loader2, CheckCircle2 } from "lucide-react";
import type { Employee } from "@/features/hr/types";
import { createManualAdjustmentAction } from "@/features/hr/actions/leave.action";
import { Portal } from "@/shared/components/ui/portal";
import { useScrollLock } from "@/shared/hooks/use-scroll-lock";
import { useDialog } from "@/shared/hooks/use-dialog";

type ManualAdjustmentModalProps = {
  isOpen: boolean;
  onClose: () => void;
  employees: Employee[];
  selectedEmployeeId?: string;
  onSuccess?: () => void;
};

export function ManualAdjustmentModal({
  isOpen,
  onClose,
  employees,
  selectedEmployeeId: defaultEmpId,
  onSuccess,
}: ManualAdjustmentModalProps) {
  const [employeeId, setEmployeeId] = useState(defaultEmpId || employees[0]?.id || "");
  const [days, setDays] = useState<number>(1);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useScrollLock(isOpen);
  const dialogRef = useDialog<HTMLDivElement>(isOpen, onClose);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!employeeId) {
      setError("Please select an employee.");
      return;
    }
    if (days === 0) {
      setError("Adjusted days cannot be zero.");
      return;
    }
    if (!reason.trim() || reason.trim().length < 3) {
      setError("A mandatory reason (minimum 3 characters) is required.");
      return;
    }

    startTransition(async () => {
      const res = await createManualAdjustmentAction({
        employeeId,
        days,
        reason: reason.trim(),
      });

      if (res.error) {
        setError(res.error);
      } else {
        onSuccess?.();
        onClose();
        setReason("");
        setDays(1);
      }
    });
  };

  if (!isOpen) return null;

  return (
    <Portal>
      <div role="dialog" ref={dialogRef} tabIndex={-1} aria-modal="true" aria-label="Manual leave adjustment" className="fixed inset-0 z-50 flex flex-col justify-end sm:justify-center sm:items-center overflow-hidden p-0 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
        <div
          className="relative w-full max-w-md rounded-t-[calc(var(--radius-card)+6px)] sm:rounded-[var(--radius-card)] border-t sm:border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 sm:p-6 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] pb-3">
            <div className="flex items-center gap-2">
              <Sliders className="h-5 w-5 text-orange-500" />
              <h2 className="text-lg font-bold tracking-tight text-[var(--color-text-primary)]">
                Manual Balance Adjustment
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
            <div className="mt-3 flex items-start gap-2.5 rounded-[var(--radius-control)] border border-[var(--color-status-error)]/30 bg-[var(--color-status-error-bg)] p-3 text-xs text-[var(--color-status-error)]">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            {/* Employee Selector */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold tracking-wide text-[var(--color-text-secondary)] uppercase">
                Employee
              </label>
              <select
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                disabled={isPending}
                className="w-full min-h-[44px] rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3 text-sm text-[var(--color-text-primary)]"
              >
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.fullName} ({emp.departmentName})
                  </option>
                ))}
              </select>
            </div>

            {/* Days (+ or -) */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold tracking-wide text-[var(--color-text-secondary)] uppercase">
                Days (+ to credit, − to debit)
              </label>
              <input
                type="number"
                step="0.5"
                value={days}
                onChange={(e) => setDays(parseFloat(e.target.value) || 0)}
                required
                disabled={isPending}
                className="w-full min-h-[44px] rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3 text-sm font-bold text-[var(--color-text-primary)]"
              />
              <p className="text-[11px] text-[var(--color-text-secondary)]">
                E.g. <strong>2</strong> to add 2 days, <strong>-1.5</strong> to deduct 1.5 days.
              </p>
            </div>

            {/* Reason */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold tracking-wide text-[var(--color-text-secondary)] uppercase">
                Mandatory Reason (required)
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="E.g. Prior-year balance correction, exceptional agreement..."
                rows={3}
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
                Cancel
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="flex items-center gap-2 px-5 py-2 text-sm font-bold rounded-[var(--radius-control)] bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-50"
              >
                {isPending ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /><span>Saving...</span></>
                ) : (
                  <><CheckCircle2 className="h-4 w-4" /><span>Save Adjustment</span></>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Portal>
  );
}
