"use client";

import { useState, useTransition, useMemo } from "react";
import { X, Calendar, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import type { Employee, LeaveType } from "@/features/hr/types";
import { useScrollLock } from "@/shared/hooks/use-scroll-lock";
import { useDialog } from "@/shared/hooks/use-dialog";
import { Portal } from "@/shared/components/ui/portal";
import { submitLeaveRequestAction } from "@/features/hr/actions/leave.action";

type LeaveRequestModalProps = {
  isOpen: boolean;
  onClose: () => void;
  employees: Employee[];
  currentEmployee?: Employee | null;
  onSuccess?: () => void;
};

const LEAVE_TYPES: { type: LeaveType; label: string; defaultPaid: boolean; desc: string }[] = [
  { type: "annual", label: "Annual Leave", defaultPaid: true, desc: "Standard paid vacation from 25-day allowance" },
  { type: "sick", label: "Sick Leave", defaultPaid: true, desc: "Medical absence (cert required for >2 days)" },
  { type: "unpaid", label: "Unpaid Leave", defaultPaid: false, desc: "Deducted from salary: (Base / 22) * days" },
  { type: "maternity_paternity", label: "Maternity / Paternity", defaultPaid: true, desc: "60 days maternity / 5 days paternity" },
  { type: "bereavement", label: "Bereavement Leave", defaultPaid: true, desc: "3 days for immediate family members" },
  { type: "other", label: "Other Special Leave", defaultPaid: true, desc: "Subject to manager approval" },
];

export function LeaveRequestModal({
  isOpen,
  onClose,
  employees,
  currentEmployee,
  onSuccess,
}: LeaveRequestModalProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>(
    currentEmployee?.id || (employees[0]?.id ?? "")
  );
  const [leaveType, setLeaveType] = useState<LeaveType>("annual");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [isHalfDay, setIsHalfDay] = useState<boolean>(false);
  const [halfDaySlot, setHalfDaySlot] = useState<"morning" | "afternoon">("morning");
  const [reason, setReason] = useState<string>("");
  const [isPaid, setIsPaid] = useState<boolean>(true);

  useScrollLock(isOpen);
  const dialogRef = useDialog<HTMLDivElement>(isOpen, onClose);

  // Automatically adjust isPaid default when leaveType changes
  const handleLeaveTypeChange = (type: LeaveType) => {
    setLeaveType(type);
    if (type === "unpaid") {
      setIsPaid(false);
    } else {
      setIsPaid(true);
    }
  };

  // Compute business days excluding Sat/Sun
  const calculatedDays = useMemo(() => {
    if (!startDate || !endDate) return 0;
    const s = new Date(startDate);
    const e = new Date(endDate);
    if (isNaN(s.getTime()) || isNaN(e.getTime()) || e < s) return 0;

    if (startDate === endDate && isHalfDay) {
      return 0.5;
    }

    let count = 0;
    const cur = new Date(s);
    while (cur <= e) {
      const day = cur.getDay();
      if (day !== 0 && day !== 6) {
        count++;
      }
      cur.setDate(cur.getDate() + 1);
    }
    return Math.max(1, count);
  }, [startDate, endDate, isHalfDay]);

  const activeTargetEmployee = useMemo(() => {
    return employees.find((e) => e.id === selectedEmployeeId) || currentEmployee || employees[0];
  }, [employees, selectedEmployeeId, currentEmployee]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!selectedEmployeeId) {
      setError("Please select an employee.");
      return;
    }
    if (!startDate || !endDate) {
      setError("Please specify both start and end dates.");
      return;
    }
    if (new Date(endDate) < new Date(startDate)) {
      setError("End date must be on or after start date.");
      return;
    }
    if (calculatedDays <= 0) {
      setError("Selected dates only cover weekend days.");
      return;
    }
    if (!reason.trim() || reason.trim().length < 3) {
      setError("Please provide a reason (minimum 3 characters).");
      return;
    }

    startTransition(async () => {
      const res = await submitLeaveRequestAction({
        employeeId: selectedEmployeeId,
        leaveType,
        startDate,
        endDate,
        halfDayOption: isHalfDay && startDate === endDate ? halfDaySlot : undefined,
        reason: reason.trim(),
        isPaid,
      });

      if (res.error) {
        setError(res.error);
      } else {
        onSuccess?.();
        onClose();
        setReason("");
        setStartDate("");
        setEndDate("");
        setIsHalfDay(false);
      }
    });
  };

  if (!isOpen) return null;

  return (
    <Portal>
      <div role="dialog" ref={dialogRef} tabIndex={-1} aria-modal="true" aria-label="Leave request" className="fixed inset-0 z-50 flex flex-col justify-end sm:justify-center sm:items-center overflow-hidden p-0 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
        <div
          className="relative w-full max-w-lg max-h-[92dvh] sm:max-h-[90vh] overflow-y-auto rounded-t-[calc(var(--radius-card)+6px)] sm:rounded-[var(--radius-card)] border-t sm:border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 sm:p-6 shadow-2xl pb-[max(1rem,env(safe-area-inset-bottom))]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Mobile drag handle */}
          <div className="w-10 h-1 rounded-full bg-[var(--color-border-control)] mx-auto mb-3 sm:hidden shrink-0" />

          {/* Header */}
          <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] pb-3 sm:pb-4">
            <div>
              <h2 className="text-lg sm:text-xl font-bold tracking-tight text-[var(--color-text-primary)]">
                Submit Leave Request
              </h2>
              <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                Weekends are automatically excluded from the computed duration.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              aria-label="Close dialog"
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[var(--radius-control)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] transition-colors shrink-0"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {error && (
            <div className="mt-3 sm:mt-4 flex items-start gap-2.5 rounded-[var(--radius-control)] border border-[var(--color-status-error)]/30 bg-[var(--color-status-error-bg)] p-3 text-xs text-[var(--color-status-error)]">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-4 sm:mt-5 space-y-3.5 sm:space-y-4">
            {/* Employee Selector */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold tracking-wide text-[var(--color-text-secondary)] uppercase">
                Employee
              </label>
              <select
                value={selectedEmployeeId}
                onChange={(e) => setSelectedEmployeeId(e.target.value)}
                disabled={isPending}
                className="w-full min-h-[44px] rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3.5 text-base sm:text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
              >
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.fullName} ({emp.departmentName} — {emp.jobTitle})
                  </option>
                ))}
              </select>
              {activeTargetEmployee && (
                <p className="mt-1 text-[11px] text-[var(--color-text-secondary)]">
                  Annual allowance: {activeTargetEmployee.leaveAllowance} days
                </p>
              )}
            </div>

            {/* Leave Type Grid */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold tracking-wide text-[var(--color-text-secondary)] uppercase">
                Leave Category
              </label>
              <div className="grid grid-cols-2 gap-2">
                {LEAVE_TYPES.map((lt) => {
                  const isSelected = leaveType === lt.type;
                  return (
                    <button
                      key={lt.type}
                      type="button"
                      onClick={() => handleLeaveTypeChange(lt.type)}
                      className={`flex flex-col items-start min-h-[54px] p-2.5 rounded-[var(--radius-control)] border text-left transition-all ${
                        isSelected
                          ? "border-[var(--color-action-primary)] bg-[var(--color-action-primary)]/10 font-bold text-[var(--color-text-primary)] ring-1 ring-[var(--color-action-primary)]"
                          : "border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)]/40 hover:border-[var(--color-border-control)] text-[var(--color-text-secondary)]"
                      }`}
                    >
                      <span className="text-xs font-semibold">{lt.label}</span>
                      <span className="text-[10px] text-[var(--color-text-secondary)] font-normal line-clamp-1">
                        {lt.desc}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Dates */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold tracking-wide text-[var(--color-text-secondary)] uppercase">
                  Start Date
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  required
                  disabled={isPending}
                  className="w-full min-h-[44px] rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3.5 text-base sm:text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold tracking-wide text-[var(--color-text-secondary)] uppercase">
                  End Date
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  required
                  disabled={isPending}
                  className="w-full min-h-[44px] rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3.5 text-base sm:text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                />
              </div>
            </div>

            {/* Half-day selector if single day */}
            {startDate && endDate && startDate === endDate && (
              <div className="flex items-center justify-between rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)]/60 p-3 text-xs">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="halfDayCheckbox"
                    checked={isHalfDay}
                    onChange={(e) => setIsHalfDay(e.target.checked)}
                    className="h-4 w-4 shrink-0 rounded-[calc(var(--radius-control)*0.5)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] accent-[var(--color-action-primary)]"
                  />
                  <label htmlFor="halfDayCheckbox" className="font-semibold text-[var(--color-text-primary)] cursor-pointer">
                    Half-day request (0.5 day)
                  </label>
                </div>
                {isHalfDay && (
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="radio"
                        name="halfDaySlot"
                        value="morning"
                        checked={halfDaySlot === "morning"}
                        onChange={() => setHalfDaySlot("morning")}
                        className="accent-[var(--color-action-primary)]"
                      />
                      <span>Morning</span>
                    </label>
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="radio"
                        name="halfDaySlot"
                        value="afternoon"
                        checked={halfDaySlot === "afternoon"}
                        onChange={() => setHalfDaySlot("afternoon")}
                        className="accent-[var(--color-action-primary)]"
                      />
                      <span>Afternoon</span>
                    </label>
                  </div>
                )}
              </div>
            )}

            {/* Live Day Computation Banner */}
            {calculatedDays > 0 && (
              <div className="flex items-center justify-between rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] p-3 text-xs">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-[var(--color-action-on-primary)]" />
                  <span className="font-semibold text-[var(--color-text-primary)]">
                    Calculated Duration:
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm text-[var(--color-text-primary)]">
                    {calculatedDays} working day{calculatedDays > 1 ? "s" : ""}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      isPaid
                        ? "bg-[var(--color-status-success-bg)] text-[var(--color-status-success)]"
                        : "bg-[var(--color-warning-bg)] text-[var(--color-warning-text)] border border-[var(--color-warning-border)]"
                    }`}
                  >
                    {isPaid ? "Paid Leave" : "Unpaid (Payroll Deduction)"}
                  </span>
                </div>
              </div>
            )}

            {/* Paid / Unpaid Toggle */}
            <div className="flex items-center gap-3 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-canvas)] p-3">
              <input
                type="checkbox"
                id="isPaidCheckbox"
                checked={isPaid}
                onChange={(e) => setIsPaid(e.target.checked)}
                disabled={isPending || leaveType === "unpaid"}
                className="h-4 w-4 shrink-0 rounded-[calc(var(--radius-control)*0.5)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] accent-[var(--color-action-primary)] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-offset-[2px] focus-visible:ring-offset-[var(--color-bg-surface)]"
              />
              <label htmlFor="isPaidCheckbox" className="text-xs text-[var(--color-text-primary)] cursor-pointer select-none">
                Mark as Paid Leave{" "}
                <span className="text-[var(--color-text-secondary)]">(uncheck to apply unpaid leave salary deduction)</span>
              </label>
            </div>

            {/* Reason */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold tracking-wide text-[var(--color-text-secondary)] uppercase">
                Reason / Details
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Brief description of the reason for absence..."
                rows={3}
                required
                disabled={isPending}
                className="w-full rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] p-3.5 text-base sm:text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)] resize-none"
              />
            </div>

            {/* Actions — stacked on mobile, row on sm+ */}
            <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2.5 pt-3 border-t border-[var(--color-border-subtle)]">
              <button
                type="button"
                onClick={onClose}
                disabled={isPending}
                className="flex min-h-[44px] w-full sm:w-auto items-center justify-center rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-5 text-sm font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="flex min-h-[44px] w-full sm:w-auto items-center justify-center gap-2 rounded-[var(--radius-control)] bg-[var(--color-action-primary)] px-6 text-sm font-bold text-[var(--color-action-on-primary)] hover:bg-[var(--color-action-hover)] transition-colors disabled:opacity-50"
              >
                {isPending ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /><span>Submitting...</span></>
                ) : (
                  <><CheckCircle2 className="h-4 w-4" /><span>Submit Request</span></>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Portal>
  );
}
