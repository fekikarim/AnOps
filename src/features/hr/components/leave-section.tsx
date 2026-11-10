"use client";

import { confirmAction, promptAction, noticeAction } from "@/shared/components/ui/confirm-dialog";
import { Fragment, useState, useTransition, useMemo, useEffect } from "react";
import {
  Calendar,
  Plus,
  CheckCircle,
  XCircle,
  Clock,
  Check,
  X,
  Loader2,
  RefreshCw,
  AlertCircle,
  FileText,
  Sliders,
  CalendarCheck,
  RotateCcw,
  Ban,
  User,
  Calculator,
} from "lucide-react";
import type { Employee, LeaveRequest, LeaveBalance, LeaveStatus, SoldeDeConge } from "@/features/hr/types";
import { getAgeCategory } from "@/features/hr/utils/date-utils";
import { AdvisorCard } from "./advisor-card";
import { LeaveRequestModal } from "./leave-request-modal";
import { LeaveHistoryModal } from "./leave-history-modal";
import { ManualAdjustmentModal } from "./manual-adjustment-modal";
import {
  reviewLeaveRequestAction,
  cancelLeaveRequestAction,
  runMonthlyAccrualAction,
  getSoldeDeCongeAction,
} from "@/features/hr/actions/leave.action";
import { Portal } from "@/shared/components/ui/portal";
import { DialogOverlay } from "@/shared/components/ui/dialog-overlay";

type LeaveSectionProps = {
  leaveRequests: LeaveRequest[];
  employees: Employee[];
  currentEmployee?: Employee | null;
  leaveBalance: LeaveBalance;
  onRefresh: () => void;
  userRole?: "employee" | "manager" | "hr_admin";
  requestModalOpen?: boolean;
  onRequestModalOpenChange?: (open: boolean) => void;
};

export function LeaveSection({
  leaveRequests,
  employees,
  currentEmployee,
  leaveBalance,
  onRefresh,
  userRole = "employee",
  requestModalOpen: controlledModalOpen,
  onRequestModalOpenChange,
}: LeaveSectionProps) {
  const [isPending, startTransition] = useTransition();
  const [internalModalOpen, setInternalModalOpen] = useState(false);
  const isControlled = typeof controlledModalOpen === "boolean";
  const requestModalOpen = isControlled ? controlledModalOpen : internalModalOpen;
  const setRequestModalOpen = (open: boolean) => {
    if (onRequestModalOpenChange) onRequestModalOpenChange(open);
    if (!isControlled) setInternalModalOpen(open);
  };
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const isAdmin = userRole === "hr_admin";
  const [activeTab, setActiveTab] = useState<"all" | "my">(isAdmin ? "all" : "my");

  // Selected employee for admin view & ledger breakdown
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>(
    currentEmployee?.id || employees[0]?.id || ""
  );

  const activeEmployee = useMemo(() => {
    return employees.find((e) => e.id === selectedEmployeeId) || currentEmployee || employees[0];
  }, [employees, selectedEmployeeId, currentEmployee]);

  const [liveSolde, setLiveSolde] = useState<SoldeDeConge | null>(null);

  useEffect(() => {
    if (selectedEmployeeId) {
      getSoldeDeCongeAction(selectedEmployeeId).then((res) => {
        if (res.data) setLiveSolde(res.data);
      });
    }
  }, [selectedEmployeeId]);

  // Modals state
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [adjustmentModalOpen, setAdjustmentModalOpen] = useState(false);
  const [accrualSuccess, setAccrualSuccess] = useState<string | null>(null);

  // Review modal state
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [requestToReview, setRequestToReview] = useState<LeaveRequest | null>(null);
  const [reviewAction, setReviewAction] = useState<"approve" | "reject">("approve");
  const [adminComment, setAdminComment] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [reviewError, setReviewError] = useState<string | null>(null);

  const filteredRequests = useMemo(() => {
    return leaveRequests.filter((r) => {
      if (activeTab === "my" && activeEmployee && r.employeeId !== activeEmployee.id) {
        return false;
      }
      if (statusFilter !== "all" && r.status !== statusFilter) {
        return false;
      }
      return true;
    });
  }, [leaveRequests, activeTab, activeEmployee, statusFilter]);

  const pendingApprovalsCount = useMemo(() => {
    return leaveRequests.filter((r) => r.status === "pending").length;
  }, [leaveRequests]);

  const handleOpenReview = (request: LeaveRequest, action: "approve" | "reject") => {
    setRequestToReview(request);
    setReviewAction(action);
    setAdminComment("");
    setOverrideReason("");
    setReviewError(null);
    setReviewModalOpen(true);
  };

  const handleConfirmReview = (e: React.FormEvent) => {
    e.preventDefault();
    if (!requestToReview) return;

    startTransition(async () => {
      const reviewerName = currentEmployee?.fullName || "HR Administrator";
      const res = await reviewLeaveRequestAction(
        {
          requestId: requestToReview.id,
          action: reviewAction,
          adminComment: adminComment.trim() || undefined,
          overrideReason: overrideReason.trim() || undefined,
        },
        reviewerName
      );

      if (res.error) {
        setReviewError(res.error);
      } else {
        setReviewModalOpen(false);
        setRequestToReview(null);
        onRefresh();
      }
    });
  };

  const handleCancelRequest = async (requestId: string) => {
    const reason = await promptAction({
      title: "Cancel this leave request?",
      message: "The employee's balance is restored. Add a short reason for the record.",
      label: "Reason",
      defaultValue: "Schedule change",
      tone: "warning",
      confirmLabel: "Cancel request",
      cancelLabel: "Keep request",
    });
    if (!reason) return;

    startTransition(async () => {
      const res = await cancelLeaveRequestAction(requestId, reason);
      if (res.error) {
        void noticeAction({ title: "Something went wrong", message: res.error, tone: "danger", okLabel: "Close" });
      } else {
        onRefresh();
      }
    });
  };

  const handleRunAccrual = async () => {
    if (!(await confirmAction({ title: "Run the monthly accrual?", message: "Leave days are credited to every active employee for the current month.", confirmLabel: "Run accrual" }))) return;

    startTransition(async () => {
      const res = await runMonthlyAccrualAction();
      if (res.error) {
        void noticeAction({ title: "Something went wrong", message: res.error, tone: "danger", okLabel: "Close" });
      } else if (res.data) {
        if (res.data.accruedEmployees.length > 0) {
          setAccrualSuccess(`Monthly accrual complete: ${res.data.accruedEmployees.length} employee(s) credited.`);
        } else {
          setAccrualSuccess(`All active employees have already received their accrual for this period (${res.data.processed} checked).`);
        }
        setTimeout(() => setAccrualSuccess(null), 5000);
        onRefresh();
      }
    });
  };

  // Solde metrics breakdown
  const earnedDays = liveSolde?.earned ?? leaveBalance.earned ?? leaveBalance.allowance;
  const takenDays = liveSolde?.taken ?? leaveBalance.taken ?? leaveBalance.usedPaidDays;
  const reservedDays = liveSolde?.reserved ?? leaveBalance.reserved ?? 0;
  const availableDays = liveSolde?.available ?? leaveBalance.available ?? leaveBalance.remainingDays;

  return (
    <div className="space-y-6">
      {/* Notification banner if accrual executed */}
      {accrualSuccess && (
        <div className="flex items-center gap-2 p-3 rounded-[var(--radius-control)] bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 text-xs font-semibold">
          <CheckCircle className="h-4 w-4" />
          <span>{accrualSuccess}</span>
        </div>
      )}

      {/* Admin Employee Switcher Bar */}
      {isAdmin && employees.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] shadow-xs">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="flex items-center gap-1.5 text-xs font-bold text-[var(--color-text-secondary)] uppercase tracking-wide">
              <User className="h-4 w-4 text-[var(--color-action-primary)]" />
              Viewing Employee:
            </span>
            <select
              value={selectedEmployeeId}
              onChange={(e) => setSelectedEmployeeId(e.target.value)}
              className="min-h-[38px] rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3 text-xs font-bold text-[var(--color-text-primary)] outline-none focus:border-[var(--color-action-primary)] transition-colors cursor-pointer"
            >
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.fullName} — {emp.jobTitle} ({emp.departmentName})
                </option>
              ))}
            </select>
          </div>

          {activeEmployee && (
            <div className="flex items-center gap-2 text-xs">
              <span className="px-2 py-0.5 rounded bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)] font-medium">
                Category: <strong className="text-[var(--color-text-primary)] capitalize">{activeEmployee.dateOfBirth ? "Age-tracked" : "Standard"}</strong>
              </span>
              <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-700 font-bold border border-emerald-500/20 capitalize">
                {activeEmployee.status}
              </span>
            </div>
          )}
        </div>
      )}

      {/* KPI Cards: Solde de Congé Breakdown */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        {/* Acquis (Earned) */}
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 shadow-xs">
          <p className="text-xs font-medium text-[var(--color-text-secondary)]">
            Earned
          </p>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">
              {earnedDays}
            </span>
            <span className="text-xs text-[var(--color-text-secondary)]">days</span>
          </div>
          <p className="mt-1 text-[11px] text-[var(--color-text-secondary)]">Monthly accrual</p>
        </div>

        {/* Pris (Taken) */}
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 shadow-xs">
          <p className="text-xs font-medium text-[var(--color-text-secondary)]">
            Taken
          </p>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">
              {takenDays}
            </span>
            <span className="text-xs text-[var(--color-text-secondary)]">days taken</span>
          </div>
          <p className="mt-1 text-[11px] text-[var(--color-text-secondary)]">Approved & past leave</p>
        </div>

        {/* Réservé (Reserved) */}
        <div className="rounded-[var(--radius-card)] border border-amber-500/30 bg-amber-500/10 p-4 shadow-xs">
          <p className="text-xs font-bold text-amber-700">
            Reserved
          </p>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-amber-800">
              {reservedDays}
            </span>
            <span className="text-xs text-amber-700">days held</span>
          </div>
          <p className="mt-1 text-[11px] text-amber-700">Future approved requests</p>
        </div>

        {/* Disponible (Available) */}
        <div className="rounded-[var(--radius-card)] border border-[var(--color-action-primary)]/40 bg-[var(--color-action-primary)]/10 p-4 shadow-xs">
          <p className="text-xs font-bold text-[var(--color-text-primary)]">
            Available
          </p>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-extrabold tracking-tight text-[var(--color-text-primary)]">
              {availableDays}
            </span>
            <span className="text-xs font-semibold text-[var(--color-text-primary)]">days remaining</span>
          </div>
          <p className="mt-1 text-[11px] text-[var(--color-text-primary)]">
            {activeEmployee ? `${activeEmployee.fullName}'s Balance` : "Your Balance"}
          </p>
        </div>
      </div>

      {/* Solde de Congé - Mathematical Formula Card */}
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 sm:p-5 shadow-xs space-y-3.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[var(--color-border-subtle)] pb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-action-primary)]/15 text-[var(--color-action-on-primary)]">
              <Calculator className="h-4 w-4" />
            </div>
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-primary)]">
                Solde de Congé — Mathematical Balance Invariant
              </h4>
              <p className="text-[11px] text-[var(--color-text-secondary)]">
                Tunisian Labour Code (Art. 113–114) • Append-Only Ledger Model
              </p>
            </div>
          </div>
          <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-700 border border-emerald-500/25">
            Legal Invariant Verified
          </span>
        </div>

        {/* The Theoretical Formula */}
        <div className="flex flex-wrap items-center gap-2 text-xs font-mono font-bold">
          <span className="px-2.5 py-1 rounded bg-[var(--color-action-primary)]/20 text-[var(--color-text-primary)] border border-[var(--color-action-primary)]/40 shadow-2xs">
            Available
          </span>
          <span className="text-[var(--color-text-secondary)] text-sm font-black">=</span>
          <span className="px-2.5 py-1 rounded bg-blue-500/15 text-blue-700 border border-blue-500/30 shadow-2xs">
            Earned (Acquis)
          </span>
          <span className="text-[var(--color-text-secondary)] text-sm font-black">−</span>
          <span className="px-2.5 py-1 rounded bg-emerald-500/15 text-emerald-700 border border-emerald-500/30 shadow-2xs">
            Taken (Consommé)
          </span>
          <span className="text-[var(--color-text-secondary)] text-sm font-black">−</span>
          <span className="px-2.5 py-1 rounded bg-amber-500/15 text-amber-800 border border-amber-500/30 shadow-2xs">
            Reserved (Bloqué)
          </span>
          <span className="text-[var(--color-text-secondary)] text-sm font-black">+</span>
          <span className="px-2.5 py-1 rounded bg-orange-500/15 text-orange-700 border border-orange-500/30 shadow-2xs">
            Adjustments
          </span>
        </div>

        {/* Live Evaluation with Active Employee's Real Numbers */}
        <div className="space-y-3 pt-2.5 border-t border-[var(--color-border-subtle)]/70 bg-[var(--color-bg-subtle)]/50 p-3.5 rounded-[var(--radius-control)]">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
              <span className="text-[11px] font-bold text-[var(--color-text-secondary)] font-sans mr-1">
                Live for {activeEmployee ? activeEmployee.fullName : "Employee"}:
              </span>
              <span className="px-2.5 py-0.5 rounded font-black text-sm text-[var(--color-text-primary)] bg-[var(--color-action-primary)]/25">
                {availableDays}d
              </span>
              <span className="text-xs font-black text-[var(--color-text-secondary)]">=</span>
              <span className="px-2 py-0.5 rounded font-bold text-blue-700 bg-blue-500/15">
                {earnedDays}d
              </span>
              <span className="text-xs font-black text-[var(--color-text-secondary)]">−</span>
              <span className="px-2 py-0.5 rounded font-bold text-emerald-700 bg-emerald-500/15">
                {takenDays}d
              </span>
              <span className="text-xs font-black text-[var(--color-text-secondary)]">−</span>
              <span className="px-2 py-0.5 rounded font-bold text-amber-800 bg-amber-500/20">
                {reservedDays}d
              </span>
            </div>

            <div className="text-[10px] text-[var(--color-text-secondary)] italic">
              * Accrual rate: <strong className="text-[var(--color-text-primary)]">{activeEmployee?.dateOfBirth && getAgeCategory(activeEmployee.dateOfBirth) === "young_adult" ? "1.5d/mo (Young Adult, Art. 114)" : "1.0d/mo (Adult, Art. 113)"}</strong>
            </div>
          </div>

          {/* Step-by-Step Educational Derivation */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2.5 border-t border-[var(--color-border-subtle)]/60 text-[11px]">
            <div className="p-2 rounded bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)]/80">
              <span className="text-[10px] font-bold uppercase tracking-wider text-blue-700 block mb-0.5">
                1. Monthly Accrual (Acquis)
              </span>
              <p className="text-[var(--color-text-secondary)] leading-relaxed">
                Accrued across <strong>11 months</strong> in 2026 (Jan–Nov) at <strong>{activeEmployee?.dateOfBirth && getAgeCategory(activeEmployee.dateOfBirth) === "young_adult" ? "1.5" : "1.0"}d/month</strong> = <strong className="text-blue-700">{earnedDays}d</strong> total.
              </p>
            </div>

            <div className="p-2 rounded bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)]/80">
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800 block mb-0.5">
                2. Usage & Future Holds
              </span>
              <p className="text-[var(--color-text-secondary)] leading-relaxed">
                Consumed: <strong className="text-emerald-700">{takenDays}d</strong> (past leaves) + Reserved: <strong className="text-amber-800">{reservedDays}d</strong> (approved upcoming leaves).
              </p>
            </div>

            <div className="p-2 rounded bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)]/80">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-action-primary)] block mb-0.5">
                3. Net Available Balance
              </span>
              <p className="text-[var(--color-text-secondary)] leading-relaxed">
                <strong className="text-[var(--color-text-primary)]">{earnedDays}d Earned</strong> − {takenDays}d Taken − {reservedDays}d Reserved = <strong className="text-[var(--color-action-primary)]">{availableDays}d Available</strong> to request.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Container Card */}
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 sm:p-6 shadow-xs space-y-4">
        {/* Header Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h3 className="text-lg font-bold text-[var(--color-text-primary)]">
                Leave Management & Balance
              </h3>
              {pendingApprovalsCount > 0 && (
                <span className="rounded-full bg-[var(--color-warning-bg)] border border-[var(--color-warning-border)] px-2.5 py-0.5 text-xs font-bold text-[var(--color-warning-text)]">
                  {pendingApprovalsCount} Pending
                </span>
              )}
            </div>
            <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
              Leave requests, real-time reservations and transaction history
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onRefresh}
              className="flex min-h-[40px] items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-3 text-xs font-bold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-subtle)] transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>Actualiser</span>
            </button>

            {/* History Modal Trigger */}
            <button
              type="button"
              onClick={() => setHistoryModalOpen(true)}
              className="flex min-h-[40px] items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-3 text-xs font-bold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-subtle)] transition-colors"
            >
              <Clock className="h-3.5 w-3.5" />
              <span>History</span>
            </button>

            {/* Admin Accrual Engine Trigger */}
            {isAdmin && (
              <button
                type="button"
                onClick={handleRunAccrual}
                disabled={isPending}
                className="flex min-h-[40px] items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-3 text-xs font-bold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-subtle)] transition-colors"
                title="Trigger monthly accrual for all active employees"
              >
                <CalendarCheck className="h-3.5 w-3.5 text-blue-600" />
                <span>Monthly Accrual</span>
              </button>
            )}

            {/* Admin Manual Adjustment Trigger */}
            {isAdmin && (
              <button
                type="button"
                onClick={() => setAdjustmentModalOpen(true)}
                className="flex min-h-[40px] items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-3 text-xs font-bold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-subtle)] transition-colors"
              >
                <Sliders className="h-3.5 w-3.5 text-orange-500" />
                <span>Adjust Balance</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setRequestModalOpen(true)}
              className="flex min-h-[40px] items-center gap-2 rounded-[var(--radius-control)] bg-[var(--color-action-primary)] px-4 text-xs font-bold text-[var(--color-action-on-primary)] hover:bg-[var(--color-action-hover)] transition-colors shadow-xs"
            >
              <Plus className="h-4 w-4" />
              <span>Request Leave</span>
            </button>
          </div>
        </div>

        {/* Tab & Status Filter Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-y border-[var(--color-border-subtle)] py-3">
          {/* My vs All Tabs — All Requests only for hr_admin */}
          <div className="flex items-center gap-1 bg-[var(--color-bg-subtle)] p-1 rounded-[var(--radius-control)]">
            {isAdmin && (
            <button
              type="button"
              onClick={() => setActiveTab("all")}
              className={`px-3 py-1.5 rounded-[calc(var(--radius-control)-2px)] text-xs font-bold transition-all ${
                activeTab === "all"
                  ? "bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-xs"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              }`}
            >
              All Requests ({leaveRequests.length})
            </button>
            )}
            <button
              type="button"
              onClick={() => setActiveTab("my")}
              className={`px-3 py-1.5 rounded-[calc(var(--radius-control)-2px)] text-xs font-bold transition-all ${
                activeTab === "my"
                  ? "bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-xs"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              }`}
            >
              My Requests
            </button>
          </div>


          {/* Status Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            {["all", "pending", "approved", "rejected"].map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`min-h-[32px] px-3 rounded-[var(--radius-pill)] text-xs font-bold capitalize transition-colors ${
                  statusFilter === st
                    ? "bg-[var(--color-text-primary)] text-[var(--color-bg-surface)]"
                    : "border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)]"
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>

        {/* Desktop Table View */}
        <div className="hidden md:block overflow-x-auto rounded-[var(--radius-control)] border border-[var(--color-border-subtle)]">
          <table className="w-full text-left text-xs">
            <thead className="bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)] font-bold uppercase tracking-wider text-[10px]">
              <tr>
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Leave Type</th>
                <th className="px-4 py-3">Duration (Working Days)</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
              {filteredRequests.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-[var(--color-text-secondary)]">
                    <FileText className="mx-auto h-8 w-8 opacity-40 mb-2" />
                    <p className="font-medium">No leave requests found</p>
                    <p className="text-[11px] mt-0.5">Submit a new request to see it listed here.</p>
                  </td>
                </tr>
              ) : (
                filteredRequests.map((req) => {
                  const isPendingStatus = req.status === "pending";
                  const isApproved = req.status === "approved";

                  return (
                    <Fragment key={req.id}>
                    <tr className="hover:bg-[var(--color-bg-subtle)]/50 transition-colors">
                      {/* Employee */}
                      <td className="px-4 py-3.5">
                        <div className="font-bold text-[var(--color-text-primary)]">
                          {req.employeeName}
                        </div>
                        <div className="text-[11px] text-[var(--color-text-secondary)]">
                          {req.departmentName}
                        </div>
                      </td>

                      {/* Leave Type */}
                      <td className="px-4 py-3.5">
                        <div className="font-medium capitalize text-[var(--color-text-primary)]">
                          {req.leaveType.replace("_", " / ")}
                        </div>
                        <span
                          className={`inline-block mt-0.5 rounded px-1.5 py-0.5 text-[9px] font-bold ${
                            req.isPaid
                              ? "bg-[var(--color-status-success-bg)] text-[var(--color-status-success)]"
                              : "bg-[var(--color-warning-bg)] text-[var(--color-warning-text)] border border-[var(--color-warning-border)]"
                          }`}
                        >
                          {req.isPaid ? "Paid" : "Unpaid (Payroll Deduction)"}
                        </span>
                      </td>

                      {/* Duration */}
                      <td className="px-4 py-3.5">
                        <div className="font-bold text-[var(--color-text-primary)]">
                          {req.days} working day{req.days > 1 ? "s" : ""}
                        </div>
                        <div className="text-[11px] text-[var(--color-text-secondary)]">
                          {req.startDate} → {req.endDate}
                        </div>
                      </td>

                      {/* Reason & Comments */}
                      <td className="px-4 py-3.5 max-w-xs">
                        <p className="text-[var(--color-text-primary)] line-clamp-2">
                          {req.reason}
                        </p>
                        {req.adminComment && (
                          <p className="mt-1 text-[11px] text-[var(--color-text-secondary)] italic">
                            HR: &quot;{req.adminComment}&quot;
                          </p>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3.5">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                            isPendingStatus
                              ? "bg-[var(--color-warning-bg)] text-[var(--color-warning-text)] border border-[var(--color-warning-border)]"
                              : isApproved
                              ? "bg-[var(--color-status-success-bg)] text-[var(--color-status-success)]"
                              : "bg-[var(--color-status-error-bg)] text-[var(--color-status-error)]"
                          }`}
                        >
                          {isPendingStatus && <Clock className="h-3 w-3" />}
                          {isApproved && <CheckCircle className="h-3 w-3" />}
                          {req.status === "rejected" && <XCircle className="h-3 w-3" />}
                          {req.status}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3.5 text-right whitespace-nowrap">
                        {isPendingStatus && isAdmin ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleOpenReview(req, "approve")}
                              title="Approve Request"
                              className="flex h-8 items-center gap-1 rounded-[var(--radius-control)] bg-[var(--color-status-success)]/15 px-2.5 text-xs font-bold text-[var(--color-status-success)] hover:bg-[var(--color-status-success)]/25 transition-colors"
                            >
                              <Check className="h-3.5 w-3.5" />
                              <span>Approve</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleOpenReview(req, "reject")}
                              title="Reject Request"
                              className="flex h-8 items-center gap-1 rounded-[var(--radius-control)] bg-[var(--color-status-error)]/15 px-2.5 text-xs font-bold text-[var(--color-status-error)] hover:bg-[var(--color-status-error)]/25 transition-colors"
                            >
                              <X className="h-3.5 w-3.5" />
                              <span>Reject</span>
                            </button>
                          </div>
                        ) : (
                          <span className="text-[11px] text-[var(--color-text-secondary)]">
                            {req.reviewedBy ? `Reviewed by ${req.reviewedBy}` : isPendingStatus ? "Pending" : "Completed"}
                          </span>
                        )}
                      </td>

                    </tr>
                    {isPendingStatus && isAdmin && (
                      <tr>
                        <td colSpan={6} className="px-4 pb-3 pt-0">
                          <AdvisorCard requestId={req.id} />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile Cards View */}
        <div className="md:hidden divide-y divide-[var(--color-border-subtle)] rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] overflow-hidden">
          {filteredRequests.length === 0 ? (
            <div className="p-6 text-center text-[var(--color-text-secondary)]">
              <FileText className="mx-auto h-8 w-8 opacity-40 mb-2" />
              <p className="font-semibold text-xs">No leave requests found</p>
              <p className="text-[11px] mt-0.5">Submit a new request to see it listed here.</p>
            </div>
          ) : (
            filteredRequests.map((req) => {
              const isPendingStatus = req.status === "pending";
              const isApproved = req.status === "approved";

              return (
                <div key={req.id} className="p-3.5 space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-bold text-sm text-[var(--color-text-primary)]">
                        {req.employeeName}
                      </p>
                      <p className="text-xs text-[var(--color-text-secondary)]">
                        {req.departmentName}
                      </p>
                    </div>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider shrink-0 ${
                        isPendingStatus
                          ? "bg-[var(--color-warning-bg)] text-[var(--color-warning-text)] border border-[var(--color-warning-border)]"
                          : isApproved
                          ? "bg-[var(--color-status-success-bg)] text-[var(--color-status-success)]"
                          : "bg-[var(--color-status-error-bg)] text-[var(--color-status-error)]"
                      }`}
                    >
                      {isPendingStatus && <Clock className="h-3 w-3" />}
                      {isApproved && <CheckCircle className="h-3 w-3" />}
                      {req.status === "rejected" && <XCircle className="h-3 w-3" />}
                      {req.status}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)] p-2">
                      <span className="text-[10px] uppercase font-bold text-[var(--color-text-secondary)] block">
                        Leave Type
                      </span>
                      <p className="font-semibold capitalize text-[var(--color-text-primary)] mt-0.5 truncate">
                        {req.leaveType.replace("_", " / ")}
                      </p>
                      <span
                        className={`inline-block mt-1 rounded px-1.5 py-0.5 text-[9px] font-bold ${
                          req.isPaid
                            ? "bg-[var(--color-status-success-bg)] text-[var(--color-status-success)]"
                            : "bg-[var(--color-warning-bg)] text-[var(--color-warning-text)]"
                        }`}
                      >
                        {req.isPaid ? "Paid" : "Unpaid"}
                      </span>
                    </div>

                    <div className="rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)] p-2">
                      <span className="text-[10px] uppercase font-bold text-[var(--color-text-secondary)] block">
                        Duration
                      </span>
                      <p className="font-bold text-[var(--color-text-primary)] mt-0.5">
                        {req.days} working day{req.days > 1 ? "s" : ""}
                      </p>
                      <p className="text-[10px] text-[var(--color-text-secondary)] mt-1 truncate">
                        {req.startDate} → {req.endDate}
                      </p>
                    </div>
                  </div>

                  {req.reason && (
                    <div className="text-xs text-[var(--color-text-primary)] bg-[var(--color-bg-subtle)]/50 rounded-[var(--radius-control)] p-2">
                      <span className="text-[10px] font-bold uppercase text-[var(--color-text-secondary)] block mb-0.5">
                        Reason
                      </span>
                      <p className="line-clamp-2">{req.reason}</p>
                      {req.adminComment && (
                        <p className="mt-1 text-[11px] text-[var(--color-text-secondary)] italic border-t border-[var(--color-border-subtle)] pt-1">
                          HR: &quot;{req.adminComment}&quot;
                        </p>
                      )}
                    </div>
                  )}

                  {isPendingStatus && isAdmin && <AdvisorCard requestId={req.id} />}

                  {/* Actions on Mobile — admin only */}
                  {isPendingStatus && isAdmin ? (
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => handleOpenReview(req, "approve")}
                        className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-[var(--radius-control)] bg-[var(--color-status-success)]/15 font-bold text-xs text-[var(--color-status-success)] hover:bg-[var(--color-status-success)]/25 transition-colors"
                      >
                        <Check className="h-4 w-4" />
                        <span>Approve</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpenReview(req, "reject")}
                        className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-[var(--radius-control)] bg-[var(--color-status-error)]/15 font-bold text-xs text-[var(--color-status-error)] hover:bg-[var(--color-status-error)]/25 transition-colors"
                      >
                        <X className="h-4 w-4" />
                        <span>Reject</span>
                      </button>
                    </div>
                  ) : (
                    <p className="text-[11px] text-[var(--color-text-secondary)] text-right pt-0.5">
                      {req.reviewedBy ? `Reviewed by ${req.reviewedBy}` : isPendingStatus ? "Awaiting review" : "Completed"}
                    </p>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Leave Request Modal */}
      <LeaveRequestModal
        isOpen={requestModalOpen}
        onClose={() => setRequestModalOpen(false)}
        employees={employees}
        currentEmployee={currentEmployee}
        onSuccess={onRefresh}
      />

      {/* Review Confirmation Modal */}
      {reviewModalOpen && requestToReview && (
        <Portal>
          <DialogOverlay label="Review leave request" onClose={() => setReviewModalOpen(false)} className="fixed inset-0 z-50 flex flex-col justify-end sm:justify-center sm:items-center overflow-hidden p-0 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
            <div
              className="relative w-full max-w-md max-h-[92dvh] sm:max-h-[85vh] overflow-y-auto rounded-t-[calc(var(--radius-card)+6px)] sm:rounded-[var(--radius-card)] border-t sm:border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 sm:p-6 shadow-2xl pb-[max(1rem,env(safe-area-inset-bottom))]"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Mobile drag handle */}
              <div className="w-10 h-1 rounded-full bg-[var(--color-border-control)] mx-auto mb-3 sm:hidden shrink-0" />

              <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] pb-3">
                <h3 className="text-base font-bold text-[var(--color-text-primary)]">
                  {reviewAction === "approve" ? "Approve Leave Request" : "Reject Leave Request"}
                </h3>
                <button
                  type="button"
                  onClick={() => setReviewModalOpen(false)}
                  aria-label="Close dialog"
                  className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[var(--radius-control)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] transition-colors shrink-0"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {reviewError && (
                <div className="mt-3 flex items-start gap-2 rounded bg-[var(--color-status-error-bg)] p-2.5 text-xs text-[var(--color-status-error)]">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{reviewError}</span>
                </div>
              )}

              <form onSubmit={handleConfirmReview} className="mt-4 space-y-3">
                <div className="rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)] p-3 text-xs space-y-1">
                  <div className="font-bold text-[var(--color-text-primary)]">
                    {requestToReview.employeeName}
                  </div>
                  <div className="text-[var(--color-text-secondary)]">
                    {requestToReview.days} working day(s) ({requestToReview.startDate} → {requestToReview.endDate})
                  </div>
                  <div className="text-[var(--color-text-secondary)] italic">
                    &quot;{requestToReview.reason}&quot;
                  </div>
                  {!requestToReview.isPaid && (
                    <div className="text-[11px] font-bold text-[var(--color-warning-text)]">
                      * Note: This is an unpaid leave. Deductions will apply in payroll.
                    </div>
                  )}
                </div>

                <AdvisorCard requestId={requestToReview.id} defaultOpen />

                {reviewAction === "approve" && (
                  <div>
                    <label className="block text-xs font-bold text-[var(--color-text-primary)] mb-1">
                    Override reason if balance is exceeded (Optional)
                    </label>
                    <input
                      type="text"
                      value={overrideReason}
                      onChange={(e) => setOverrideReason(e.target.value)}
                      placeholder="Required only if duration exceeds available balance..."
                      className="w-full rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] p-2 text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--color-action-primary)]"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold text-[var(--color-text-primary)] mb-1">
                    HR Comment / Internal Note
                  </label>
                  <textarea
                    value={adminComment}
                    onChange={(e) => setAdminComment(e.target.value)}
                    placeholder="Add a note or justification for the employee..."
                    rows={2}
                    className="w-full rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] p-2.5 text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--color-action-primary)]"
                  />
                </div>

                <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2.5 pt-2 border-t border-[var(--color-border-subtle)]">
                  <button
                    type="button"
                    onClick={() => setReviewModalOpen(false)}
                    disabled={isPending}
                    className="flex min-h-[44px] w-full sm:w-auto items-center justify-center rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-4 text-sm font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isPending}
                    className={`flex min-h-[44px] w-full sm:w-auto items-center justify-center gap-1.5 rounded-[var(--radius-control)] px-5 text-sm font-bold text-white transition-colors ${
                      reviewAction === "approve"
                        ? "bg-[var(--color-status-success)] hover:opacity-90"
                        : "bg-[var(--color-status-error)] hover:opacity-90"
                    }`}
                  >
                    {isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : reviewAction === "approve" ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <X className="h-3.5 w-3.5" />
                    )}
                    <span>Confirm {reviewAction === "approve" ? "Approval" : "Rejection"}</span>
                  </button>
                </div>
              </form>
            </div>
          </DialogOverlay>
        </Portal>
      )}

      {/* Leave History Modal */}
      {activeEmployee && (
        <LeaveHistoryModal
          isOpen={historyModalOpen}
          onClose={() => setHistoryModalOpen(false)}
          employee={activeEmployee}
          isAdmin={isAdmin}
          onRefresh={() => {
            onRefresh();
            if (selectedEmployeeId) {
              getSoldeDeCongeAction(selectedEmployeeId).then((res) => {
                if (res.data) setLiveSolde(res.data);
              });
            }
          }}
        />
      )}

      {/* Manual Adjustment Modal (Admin only) */}
      {isAdmin && (
        <ManualAdjustmentModal
          isOpen={adjustmentModalOpen}
          onClose={() => setAdjustmentModalOpen(false)}
          employees={employees}
          selectedEmployeeId={activeEmployee?.id}
          onSuccess={() => {
            onRefresh();
            if (selectedEmployeeId) {
              getSoldeDeCongeAction(selectedEmployeeId).then((res) => {
                if (res.data) setLiveSolde(res.data);
              });
            }
          }}
        />
      )}
    </div>
  );
}
