import "server-only";
import type { AiAccess } from "@/server/ai/access/access.service";
import { moneyOf } from "@/server/ai/finance/money";
import type { EmployeeView, HrScope } from "@/server/ai/hr/access";
import type { AiAction, AiBadge, AiRecordCardPart, AiRecordTablePart } from "@/server/db/documents";
import type { AttendanceRecord, Department, JobTitle, LeaveRequest, PayslipRecord, SoldeDeConge, TodayAttendanceSummary } from "@/features/hr/types";
import type { AiOperation } from "@/shared/domain/ai";

/**
 * HR results as structured parts. Sensitive columns and fields are added only when the caller passes sensitive access, and the same
 * views feed the model, so what is hidden here is absent from the model's data too. Actions appear only for people who
 * may do them; each goes back through the command runner, which authorises it again.
 */
const can = (access: AiAccess, op: AiOperation) => access.can("hr", op);
type Args = Record<string, string | number | boolean>;
export const HR_PAGE = 20;

export function paginate<T>(items: T[], page: number) {
  const totalPages = Math.max(1, Math.ceil(items.length / HR_PAGE));
  const p = Math.min(Math.max(1, page), totalPages);
  return { slice: items.slice((p - 1) * HR_PAGE, p * HR_PAGE), page: p, totalPages, total: items.length };
}

/** Day counts, trimmed: 2, 2.5. */
export const days = (n: number | undefined) => String(Math.round((Number(n) || 0) * 100) / 100);
const tnd = (n: number | undefined) => moneyOf(n, "TND");

const LEAVE_STATUS: Record<string, AiBadge> = {
  pending: { label: "Pending", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "error" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  taken: { label: "Taken", tone: "info" },
};

export function employeesTable(rows: EmployeeView[], page: number, args: Args, scope: HrScope, access: AiAccess, select?: { command: string; key: string }): AiRecordTablePart {
  const p = paginate(rows, page);
  const withSalary = scope.admin && scope.sensitive;
  const columns: AiRecordTablePart["columns"] = [
    { key: "name", label: "Employee" },
    { key: "title", label: "Job title" },
    { key: "department", label: "Department" },
    ...(scope.admin ? [{ key: "email", label: "Email" }] : []),
    ...(withSalary ? [{ key: "salary", label: "Base salary", align: "right" as const }] : []),
  ];
  return {
    type: "record_table",
    title: select ? "Choose an employee" : "Employees",
    columns,
    rows: p.slice.map((e) => ({
      id: e.id,
      cells: { name: e.fullName, title: e.jobTitle, department: e.departmentName, email: e.email ?? "", salary: e.baseSalary !== undefined ? tnd(e.baseSalary) : "" },
      badge: e.status === "active" ? { label: "Active", tone: "success" } : { label: "Inactive", tone: "neutral" },
      actions: select
        ? [{ label: "Select", command: select.command, args: { [select.key]: e.id }, step: "select" as const }]
        : [{ label: "Open", command: "employee", args: { employeeId: e.id } }],
    })),
    total: p.total,
    emptyMessage: "No employees match.",
    paging: { page: p.page, totalPages: p.totalPages, command: select ? select.command : "employees", args },
  };
}

export function employeeCard(e: EmployeeView, scope: HrScope, access: AiAccess): AiRecordCardPart {
  const args = { employeeId: e.id };
  const actions: AiAction[] = [];
  if (scope.admin && can(access, "edit")) actions.push({ label: "Edit employee", command: "editemployee", args, step: "select" });
  if (can(access, "view")) actions.push({ label: "Leave balance", command: "leavebalance", args });
  if (scope.sensitive && can(access, "view") && (scope.admin || e.id === scope.selfId)) actions.push({ label: "Payroll preview", command: "payrollpreview", args, step: "select" });
  return {
    type: "record_card",
    title: e.fullName,
    subtitle: `${e.jobTitle} · ${e.departmentName}`,
    badges: [e.status === "active" ? { label: "Active", tone: "success" } : { label: "Inactive", tone: "neutral" }],
    fields: [
      ...(e.email !== undefined ? [{ label: "Email", value: e.email || "None" }] : []),
      ...(e.phone !== undefined ? [{ label: "Phone", value: e.phone || "None" }] : []),
      ...(e.hireDate ? [{ label: "Hired", value: e.hireDate.slice(0, 10) }] : []),
      ...(e.leaveAllowance !== undefined ? [{ label: "Leave allowance", value: `${days(e.leaveAllowance)} days` }] : []),
      ...(e.baseSalary !== undefined ? [{ label: "Base salary", value: tnd(e.baseSalary) }] : []),
      ...(e.dateOfBirth ? [{ label: "Date of birth", value: e.dateOfBirth.slice(0, 10) }] : []),
    ],
    actions,
  };
}

export function departmentsTable(rows: Department[], access: AiAccess, scope: HrScope): AiRecordTablePart {
  return {
    type: "record_table",
    title: "Departments",
    columns: [{ key: "name", label: "Department" }, { key: "description", label: "Description" }, { key: "count", label: "Active staff", align: "right" }],
    rows: rows.map((d) => ({
      id: d.id,
      cells: { name: d.name, description: d.description ?? "", count: String(d.employeeCount ?? 0) },
      actions: scope.admin && can(access, "edit") ? [{ label: "Edit", command: "editdepartment", args: { departmentId: d.id }, step: "select" as const }] : [],
    })),
    total: rows.length,
    emptyMessage: "No departments yet. Add one with /newdepartment.",
  };
}

export function jobTitlesTable(rows: JobTitle[], departments: Department[], access: AiAccess, scope: HrScope): AiRecordTablePart {
  const dep = new Map(departments.map((d) => [d.id, d.name]));
  return {
    type: "record_table",
    title: "Job titles",
    columns: [{ key: "title", label: "Job title" }, { key: "department", label: "Department" }, { key: "count", label: "Active staff", align: "right" }],
    rows: rows.map((t) => ({
      id: t.id,
      cells: { title: t.title, department: (t.departmentId && dep.get(t.departmentId)) || "Any", count: String(t.employeeCount ?? 0) },
      actions: scope.admin && can(access, "edit") ? [{ label: "Edit", command: "editjobtitle", args: { jobTitleId: t.id }, step: "select" as const }] : [],
    })),
    total: rows.length,
    emptyMessage: "No job titles yet. Add one with /newjobtitle.",
  };
}

export function leaveRequestsTable(rows: LeaveRequest[], page: number, args: Args, scope: HrScope, access: AiAccess, select?: { command: string }): AiRecordTablePart {
  const p = paginate(rows, page);
  return {
    type: "record_table",
    title: select ? "Choose a leave request" : "Leave requests",
    columns: [
      { key: "employee", label: "Employee" },
      { key: "type", label: "Type" },
      { key: "dates", label: "Dates" },
      { key: "days", label: "Days", align: "right" },
    ],
    rows: p.slice.map((r) => {
      const actions: AiAction[] = [];
      if (select) actions.push({ label: "Select", command: select.command, args: { requestId: r.id }, step: "select" });
      else if (scope.admin) {
        if (r.status === "pending" && can(access, "approve")) {
          actions.push({ label: "Approve", command: "approveleave", args: { requestId: r.id }, step: "select" });
          actions.push({ label: "Reject", command: "rejectleave", args: { requestId: r.id }, step: "select" });
        }
        if ((r.status === "pending" || r.status === "approved") && can(access, "edit")) actions.push({ label: "Cancel", command: "cancelleave", args: { requestId: r.id }, step: "select" });
      }
      return {
        id: r.id,
        cells: { employee: r.employeeName, type: `${r.leaveType.replace("_", " ")}${r.isPaid ? "" : " (unpaid)"}`, dates: `${r.startDate} → ${r.endDate}`, days: days(r.days) },
        badge: LEAVE_STATUS[r.status] ?? { label: r.status, tone: "neutral" },
        actions,
      };
    }),
    total: p.total,
    emptyMessage: "No leave requests match.",
    paging: { page: p.page, totalPages: p.totalPages, command: select ? select.command : "leaverequests", args },
  };
}

export function balanceCard(s: SoldeDeConge): AiRecordCardPart {
  return {
    type: "record_card",
    title: `Leave balance ${s.year}`,
    subtitle: s.employeeName,
    fields: [
      { label: "Earned", value: `${days(s.earned)} days` },
      { label: "Taken", value: `${days(s.taken)} days` },
      { label: "Reserved (approved, not yet taken)", value: `${days(s.reserved)} days` },
      { label: "Adjustments", value: `${days(s.adjustments)} days` },
      { label: "Available", value: `${days(s.available)} days` },
      { label: "Unpaid days taken", value: `${days(s.unpaidDaysTaken)} days` },
      ...(s.policySummary ? [{ label: "Policy", value: `${s.policySummary.name} · ${days(s.policySummary.accrualRate)} days a month, cap ${days(s.policySummary.annualCap)}` }] : []),
    ],
  };
}

export function attendanceTable(rows: AttendanceRecord[], page: number, args: Args, title = "Attendance"): AiRecordTablePart {
  const p = paginate(rows, page);
  const time = (iso?: string) => (iso ? new Date(iso).toISOString().slice(11, 16) : "");
  return {
    type: "record_table",
    title,
    columns: [{ key: "date", label: "Date" }, { key: "employee", label: "Employee" }, { key: "in", label: "In" }, { key: "out", label: "Out" }, { key: "hours", label: "Hours", align: "right" }],
    rows: p.slice.map((r) => ({
      id: r.id,
      cells: { date: r.date, employee: r.employeeName, in: time(r.checkIn), out: time(r.checkOut), hours: days(r.hoursWorked) },
      badge: r.status === "present" ? { label: "Present", tone: "success" } : { label: "Checked out", tone: "neutral" },
    })),
    total: p.total,
    emptyMessage: "No attendance records.",
    paging: { page: p.page, totalPages: p.totalPages, command: "attendance", args },
  };
}

export function todayCard(s: TodayAttendanceSummary): AiRecordCardPart {
  return {
    type: "record_card",
    title: "Attendance today",
    fields: [
      { label: "Active employees", value: String(s.totalActive) },
      { label: "Present", value: String(s.presentCount) },
      { label: "Checked out", value: String(s.checkedOutCount) },
      { label: "Absent", value: String(s.absentCount) },
    ],
  };
}

export function payslipsTable(rows: PayslipRecord[], page: number, args: Args): AiRecordTablePart {
  const p = paginate(rows, page);
  return {
    type: "record_table",
    title: "Payslips",
    columns: [{ key: "period", label: "Period" }, { key: "employee", label: "Employee" }, { key: "deduction", label: "Deduction", align: "right" }, { key: "net", label: "Net", align: "right" }],
    rows: p.slice.map((r) => ({
      id: r.id,
      cells: { period: r.period, employee: r.employeeName, deduction: tnd(r.deduction), net: tnd(r.netSalary) },
      badge: r.status === "paid" ? { label: "Paid", tone: "success" } : { label: "Generated", tone: "info" },
      actions: [{ label: "Open", command: "payslips", args: { payslipId: r.id } }],
    })),
    total: p.total,
    emptyMessage: "No payslips for that selection.",
    paging: { page: p.page, totalPages: p.totalPages, command: "payslips", args },
  };
}

export function payslipCard(r: PayslipRecord): AiRecordCardPart {
  return {
    type: "record_card",
    title: `Payslip ${r.period}`,
    subtitle: `${r.employeeName} · ${r.jobTitle}`,
    badges: [r.status === "paid" ? { label: "Paid", tone: "success" } : { label: "Generated", tone: "info" }],
    fields: [
      { label: "Base salary", value: tnd(r.baseSalary) },
      { label: "Working days", value: String(r.workingDaysInMonth) },
      { label: "Daily rate", value: tnd(r.dailyRate) },
      { label: "Unpaid leave days", value: days(r.unpaidLeaveDays) },
      { label: "Deduction", value: tnd(r.deduction) },
      { label: "Net salary", value: tnd(r.netSalary) },
    ],
  };
}

export function previewCard(p: { employee: { fullName: string; jobTitle: string }; period: string; baseSalary: number; workingDaysInMonth: number; dailyRate: number; unpaidLeaveDays: number; deduction: number; netSalary: number }, existing: PayslipRecord | undefined): AiRecordCardPart {
  return {
    type: "record_card",
    title: `Payroll preview ${p.period}`,
    subtitle: `${p.employee.fullName} · ${p.employee.jobTitle}`,
    badges: [{ label: "Preview only", tone: "warning" }],
    fields: [
      { label: "Base salary", value: tnd(p.baseSalary) },
      { label: "Working days in month", value: String(p.workingDaysInMonth) },
      { label: "Daily rate", value: tnd(p.dailyRate) },
      { label: "Unpaid leave days", value: days(p.unpaidLeaveDays) },
      { label: "Deduction", value: tnd(p.deduction) },
      { label: "Net salary", value: tnd(p.netSalary) },
      { label: "Existing payslip", value: existing ? `${tnd(existing.netSalary)} net, ${existing.status}` : "None yet" },
    ],
    sections: [{ title: "Read this", rows: [{ label: "Note", value: "Calculated by the HR payroll service. Nothing is generated or paid from here; payslips are generated in HR." }] }],
  };
}
