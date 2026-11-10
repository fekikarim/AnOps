"use client";

import { useNow } from "@/shared/hooks/use-now";
import { useState, useTransition, useMemo } from "react";
import {
  Clock,
  LogIn,
  LogOut,
  CheckCircle2,
  AlertCircle,
  Users,
  Calendar,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";
import type { Employee, TodayAttendanceSummary, AttendanceRecord } from "@/features/hr/types";
import { checkInAction, checkOutAction } from "@/features/hr/actions/attendance.action";

type AttendanceSectionProps = {
  todaySummary: TodayAttendanceSummary;
  attendanceHistory: AttendanceRecord[];
  employees: Employee[];
  currentEmployee?: Employee | null;
  onRefresh: () => void;
  userRole?: "employee" | "manager" | "hr_admin";
};

export function AttendanceSection({
  todaySummary,
  attendanceHistory,
  employees,
  currentEmployee,
  onRefresh,
  userRole = "employee",
}: AttendanceSectionProps) {
  const [isPending, startTransition] = useTransition();
  const [punchError, setPunchError] = useState<string | null>(null);
  const isAdmin = userRole === "hr_admin";

  // Live real-time clock
  const currentTime = useNow();

  // Selected employee for punch clock (defaults to current logged-in employee)
  const [punchEmployeeId, setPunchEmployeeId] = useState<string>(
    currentEmployee?.id || (employees[0]?.id ?? "")
  );

  // History filters
  const [historySearch, setHistorySearch] = useState("");
  const [historyDeptFilter, setHistoryDeptFilter] = useState("all");

  const activePunchEmployee = useMemo(() => {
    return employees.find((e) => e.id === punchEmployeeId) || currentEmployee || employees[0];
  }, [employees, punchEmployeeId, currentEmployee]);

  // Current punch employee's status today
  const myTodayRecord = useMemo(() => {
    return todaySummary.records.find((r) => r.employeeId === punchEmployeeId);
  }, [todaySummary.records, punchEmployeeId]);

  const handlePunchIn = () => {
    if (!punchEmployeeId) return;
    setPunchError(null);

    startTransition(async () => {
      const res = await checkInAction(punchEmployeeId);
      if (res.error) {
        setPunchError(res.error);
      } else {
        onRefresh();
      }
    });
  };

  const handlePunchOut = () => {
    if (!punchEmployeeId) return;
    setPunchError(null);

    startTransition(async () => {
      const res = await checkOutAction(punchEmployeeId);
      if (res.error) {
        setPunchError(res.error);
      } else {
        onRefresh();
      }
    });
  };

  const filteredHistory = useMemo(() => {
    return attendanceHistory.filter((rec) => {
      if (historyDeptFilter !== "all" && rec.departmentName !== historyDeptFilter) {
        return false;
      }
      if (historySearch.trim()) {
        const query = historySearch.toLowerCase();
        return (
          rec.employeeName.toLowerCase().includes(query) ||
          rec.date.includes(query) ||
          rec.departmentName.toLowerCase().includes(query)
        );
      }
      return true;
    });
  }, [attendanceHistory, historySearch, historyDeptFilter]);

  const departmentsList = useMemo(() => {
    const set = new Set(employees.map((e) => e.departmentName).filter(Boolean));
    return Array.from(set);
  }, [employees]);

  return (
    <div className="space-y-6">
      {/* Top Grid: Live Punch Clock Widget + Today's Summary KPIs */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Punch Clock Card */}
        <div className="lg:col-span-1 rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 sm:p-6 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
                Live Attendance Punch
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-status-success)]/10 px-2 py-0.5 text-[10px] font-bold text-[var(--color-status-success)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-status-success)] animate-pulse" />
                Live System
              </span>
            </div>

            {/* Digital Clock */}
            <div className="my-4 text-center">
              <div className="text-3xl sm:text-4xl font-extrabold tracking-tight text-[var(--color-text-primary)] font-mono">
                {currentTime ? currentTime.toLocaleTimeString() : "--:--:--"}
              </div>
              <p className="text-xs text-[var(--color-text-secondary)] mt-1">
                {currentTime
                  ? currentTime.toLocaleDateString(undefined, {
                      weekday: "long",
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })
                  : "Loading date..."}
              </p>
            </div>

            {/* Employee Switcher — admin only; employees see just their own name */}
            <div className="mt-3">
              <label className="block text-[11px] font-semibold text-[var(--color-text-secondary)] mb-1">
                {isAdmin ? "Active Staff Member" : "Your Attendance"}
              </label>
              {isAdmin ? (
              <select
                value={punchEmployeeId}
                onChange={(e) => {
                  setPunchEmployeeId(e.target.value);
                  setPunchError(null);
                }}
                disabled={isPending}
                className="w-full min-h-[40px] rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3 text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--color-action-primary)]"
              >
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.fullName} ({emp.jobTitle})
                  </option>
                ))}
              </select>
              ) : (
              <p className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-3 py-2 text-xs font-medium text-[var(--color-text-primary)]">
                {activePunchEmployee?.fullName || "You"} &mdash; {activePunchEmployee?.jobTitle}
              </p>
              )}
            </div>

            {/* Status indicator */}
            <div className="mt-3 rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)] p-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-[var(--color-text-secondary)]">Today&apos;s Status:</span>
                <span
                  className={`font-bold capitalize ${
                    !myTodayRecord
                      ? "text-[var(--color-text-secondary)]"
                      : myTodayRecord.status === "present"
                      ? "text-[var(--color-status-success)]"
                      : "text-blue-600 dark:text-blue-400"
                  }`}
                >
                  {!myTodayRecord
                    ? "Not Clocked In"
                    : myTodayRecord.status === "present"
                    ? "Active (Working)"
                    : `Completed (${myTodayRecord.hoursWorked}h)`}
                </span>
              </div>
              {myTodayRecord && (
                <div className="mt-1 flex items-center justify-between text-[11px] text-[var(--color-text-secondary)]">
                  <span>
                    In: {new Date(myTodayRecord.checkIn).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  {myTodayRecord.checkOut && (
                    <span>
                      Out: {new Date(myTodayRecord.checkOut).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  )}
                </div>
              )}
            </div>

            {punchError && (
              <div className="mt-3 flex items-start gap-2 rounded bg-[var(--color-status-error-bg)] p-2.5 text-xs text-[var(--color-status-error)]">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{punchError}</span>
              </div>
            )}
          </div>

          {/* Action Button */}
          <div className="mt-5">
            {!myTodayRecord ? (
              <button
                type="button"
                onClick={handlePunchIn}
                disabled={isPending}
                className="w-full flex min-h-[44px] items-center justify-center gap-2 rounded-[var(--radius-control)] bg-[var(--color-action-primary)] px-4 text-xs font-bold text-[var(--color-action-on-primary)] hover:bg-[var(--color-action-hover)] transition-all shadow-xs disabled:opacity-50"
              >
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <LogIn className="h-4 w-4" />
                )}
                <span>Check In Now</span>
              </button>
            ) : myTodayRecord.status === "present" ? (
              <button
                type="button"
                onClick={handlePunchOut}
                disabled={isPending}
                className="w-full flex min-h-[44px] items-center justify-center gap-2 rounded-[var(--radius-control)] bg-[var(--color-status-error)] px-4 text-xs font-bold text-white hover:opacity-90 transition-all shadow-xs disabled:opacity-50"
              >
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <LogOut className="h-4 w-4" />
                )}
                <span>Check Out / End Shift</span>
              </button>
            ) : (
              <div className="flex min-h-[44px] items-center justify-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-4 text-xs font-bold text-[var(--color-text-secondary)]">
                <CheckCircle2 className="h-4 w-4 text-[var(--color-status-success)]" />
                <span>Shift Completed for Today</span>
              </div>
            )}
          </div>
        </div>

        {/* Today's Roster & KPIs (2 columns) */}
        <div className="lg:col-span-2 space-y-4">
          {/* Quick Metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 shadow-xs">
              <span className="text-xs text-[var(--color-text-secondary)]">Present Now</span>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="text-2xl font-bold text-[var(--color-status-success)]">
                  {todaySummary.presentCount}
                </span>
                <span className="text-xs text-[var(--color-text-secondary)]">
                  / {todaySummary.totalActive}
                </span>
              </div>
            </div>

            <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 shadow-xs">
              <span className="text-xs text-[var(--color-text-secondary)]">Checked Out</span>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                  {todaySummary.checkedOutCount}
                </span>
                <span className="text-xs text-[var(--color-text-secondary)]">staff</span>
              </div>
            </div>

            <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 shadow-xs">
              <span className="text-xs text-[var(--color-text-secondary)]">Unrecorded / Absent</span>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="text-2xl font-bold text-[var(--color-status-warning)]">
                  {todaySummary.absentCount}
                </span>
                <span className="text-xs text-[var(--color-text-secondary)]">staff</span>
              </div>
            </div>
          </div>

          {/* Today's Roster Box */}
          <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 sm:p-5 shadow-xs">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h4 className="text-sm font-bold text-[var(--color-text-primary)]">
                  Today&apos;s Attendance Roster
                </h4>
                <p className="text-[11px] text-[var(--color-text-secondary)]">
                  Real-time presence overview of on-duty team members
                </p>
              </div>
              <button
                type="button"
                onClick={onRefresh}
                className="flex items-center gap-1 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              >
                <RefreshCw className="h-3 w-3" />
                <span>Refresh</span>
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)] font-bold text-[10px] uppercase">
                  <tr>
                    <th className="px-3 py-2">Staff Member</th>
                    <th className="px-3 py-2">Department</th>
                    <th className="px-3 py-2">Check-in</th>
                    <th className="px-3 py-2">Check-out</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-subtle)]">
                  {todaySummary.records.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-[var(--color-text-secondary)]">
                        No check-ins recorded yet today. Use the punch clock to log attendance.
                      </td>
                    </tr>
                  ) : (
                    todaySummary.records.map((r) => (
                      <tr key={r.id} className="hover:bg-[var(--color-bg-subtle)]/40 transition-colors">
                        <td className="px-3 py-2.5 font-bold text-[var(--color-text-primary)]">
                          {r.employeeName}
                        </td>
                        <td className="px-3 py-2.5 text-[var(--color-text-secondary)]">
                          {r.departmentName}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-[var(--color-text-primary)]">
                          {new Date(r.checkIn).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-[var(--color-text-secondary)]">
                          {r.checkOut
                            ? new Date(r.checkOut).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                            : "--:--"}
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                              r.status === "present"
                                ? "bg-[var(--color-status-success-bg)] text-[var(--color-status-success)]"
                                : "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                            }`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${
                                r.status === "present" ? "bg-[var(--color-status-success)]" : "bg-blue-500"
                              }`}
                            />
                            {r.status === "present" ? "Present" : `Out (${r.hoursWorked}h)`}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Attendance History Log Table */}
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 sm:p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-[var(--color-text-primary)]">
              Attendance History & Logged Hours
            </h3>
            <p className="text-xs text-[var(--color-text-secondary)]">
              Audit trail of daily check-ins, check-outs, and accumulated work hours
            </p>
          </div>

          {/* Search & Filter */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <div className="relative flex-1 sm:max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--color-text-secondary)]" />
              <input
                type="text"
                placeholder="Search staff or date..."
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                className="w-full min-h-[44px] sm:min-h-[38px] rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] pl-8 pr-3 text-sm sm:text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--color-action-primary)]"
              />
            </div>

            <select
              value={historyDeptFilter}
              onChange={(e) => setHistoryDeptFilter(e.target.value)}
              className="min-h-[44px] sm:min-h-[38px] rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-2.5 text-sm sm:text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--color-action-primary)]"
            >
              <option value="all">All Departments</option>
              {departmentsList.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Desktop Table View */}
        <div className="hidden md:block overflow-x-auto rounded-[var(--radius-control)] border border-[var(--color-border-subtle)]">
          <table className="w-full text-left text-xs">
            <thead className="bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)] font-bold text-[10px] uppercase">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Staff Member</th>
                <th className="px-4 py-3">Department</th>
                <th className="px-4 py-3">Check-In</th>
                <th className="px-4 py-3">Check-Out</th>
                <th className="px-4 py-3 text-right">Hours Logged</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
              {filteredHistory.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-[var(--color-text-secondary)]">
                    No attendance records found matching filters.
                  </td>
                </tr>
              ) : (
                filteredHistory.map((rec) => (
                  <tr key={rec.id} className="hover:bg-[var(--color-bg-subtle)]/40 transition-colors">
                    <td className="px-4 py-3 font-semibold text-[var(--color-text-primary)]">
                      {rec.date}
                    </td>
                    <td className="px-4 py-3 font-bold text-[var(--color-text-primary)]">
                      {rec.employeeName}
                    </td>
                    <td className="px-4 py-3 text-[var(--color-text-secondary)]">
                      {rec.departmentName}
                    </td>
                    <td className="px-4 py-3 font-mono text-[var(--color-text-primary)]">
                      {new Date(rec.checkIn).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="px-4 py-3 font-mono text-[var(--color-text-secondary)]">
                      {rec.checkOut
                        ? new Date(rec.checkOut).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                        : "Active"}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-[var(--color-text-primary)]">
                      {rec.hoursWorked > 0 ? `${rec.hoursWorked} hrs` : "In Progress"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile Cards View */}
        <div className="md:hidden divide-y divide-[var(--color-border-subtle)] rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] overflow-hidden">
          {filteredHistory.length === 0 ? (
            <div className="p-6 text-center text-[var(--color-text-secondary)] text-xs">
              No attendance records found matching filters.
            </div>
          ) : (
            filteredHistory.map((rec) => (
              <div key={rec.id} className="p-3.5 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-bold text-sm text-[var(--color-text-primary)]">
                      {rec.employeeName}
                    </p>
                    <p className="text-xs text-[var(--color-text-secondary)]">
                      {rec.departmentName}
                    </p>
                  </div>
                  <span className="font-mono text-xs font-bold text-[var(--color-text-secondary)] bg-[var(--color-bg-subtle)] px-2 py-0.5 rounded-[var(--radius-control)] shrink-0">
                    {rec.date}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)] p-2">
                    <span className="text-[10px] uppercase font-bold text-[var(--color-text-secondary)] block">
                      Check-In
                    </span>
                    <p className="font-mono font-bold text-[var(--color-text-primary)] mt-0.5">
                      {new Date(rec.checkIn).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>

                  <div className="rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)] p-2">
                    <span className="text-[10px] uppercase font-bold text-[var(--color-text-secondary)] block">
                      Check-Out
                    </span>
                    <p className="font-mono font-bold text-[var(--color-text-secondary)] mt-0.5">
                      {rec.checkOut
                        ? new Date(rec.checkOut).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                        : "Active"}
                    </p>
                  </div>

                  <div className="rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)] p-2">
                    <span className="text-[10px] uppercase font-bold text-[var(--color-text-secondary)] block">
                      Worked
                    </span>
                    <p className="font-bold text-[var(--color-text-primary)] mt-0.5 truncate">
                      {rec.hoursWorked > 0 ? `${rec.hoursWorked}h` : "Active"}
                    </p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
