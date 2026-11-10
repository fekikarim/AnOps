import "server-only";
import { z } from "zod";
import { defineTool } from "@/server/ai/tools/define-tool";
import { employeeView, hr, hrScope, ownOrAdmin, requireHrAdmin, visibleTo, type HrScope } from "@/server/ai/hr/access";
import { modelRows } from "@/server/ai/tools/inventory.parts";
import {
  attendanceTable,
  balanceCard,
  days,
  departmentsTable,
  employeeCard,
  employeesTable,
  jobTitlesTable,
  leaveRequestsTable,
  payslipCard,
  payslipsTable,
  previewCard,
  todayCard,
} from "@/server/ai/tools/hr.parts";
import { moneyOf, parseDate, MoneyError } from "@/server/ai/finance/money";
import { departmentSchema, employeeSchema, leaveAdjustmentSchema, leaveRequestSchema, leaveReviewSchema, jobTitleSchema } from "@/features/hr/schemas/hr.schema";
import { calculateLeaveDays } from "@/features/hr/utils/date-utils";
import * as svc from "@/server/services/hr.service";
import { PERMISSIONS } from "@/server/security/permissions";
import type { WorkspaceContext } from "@/server/tenancy/workspace";
import { AppError } from "@/shared/lib/errors";
import { objectIdSchema } from "@/shared/lib/schema-primitives";
import { toFieldErrors } from "@/shared/lib/validation";
import type { AiDiffRow } from "@/server/db/documents";

/**
 * HR tools: thin wrappers over hr.service and its schemas, behind a caller check the service itself lacks.
 *
 * Roles (live, every call): owners and admins read everything and are the only ones who write. Managers and employees
 * read their OWN leave, attendance and (with the sensitive switch) payslips, plus a salary-free directory of active staff.
 * Sensitive data (salary, date of birth, payslips, payroll) is absent from results unless the member's AI grant has the
 * separate sensitive-HR switch; the switch never widens a role.
 *
 * Grant cells: view = every read; create = departments, job titles, leave requests; edit = department, job title and
 * employee changes and leave cancellation; approve = approving and rejecting leave and manual balance adjustments.
 *
 * Deliberately NOT available: creating employees (the HR service always provisions a login and a temporary password,
 * and accounts stay a manual operation), changing salary, role, email, status or date of birth, deleting anything,
 * generating or paying payslips. Payroll is preview only.
 */
const R = PERMISSIONS.HR_READ;
const A = PERMISSIONS.HR_ADMIN;
const optText = (max: number) => z.string().max(max).optional();
const pageNo = z.number().int().min(1).max(1000).optional();
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const same = (expected: unknown, actual: unknown, what: string) => {
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new AppError("CONFLICT", `${what} changed since you reviewed it. Ask again to see the latest.`);
};
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  throw new AppError("VALIDATION_ERROR", r.error.issues[0]?.message ?? "The request is invalid.", toFieldErrors(r.error));
}
const company = (ctx: WorkspaceContext) => ctx.companyId.toHexString();
const year = () => new Date().getFullYear();

async function employeeOr404(ctx: WorkspaceContext, id: string) {
  const e = await hr(() => svc.getEmployeeById(id, company(ctx)));
  if (!e) throw new AppError("NOT_FOUND", "Employee not found.");
  return e;
}
/** A non-admin may touch only their own record; an unknown id looks the same as a forbidden one to avoid probing. */
async function readableEmployee(ctx: WorkspaceContext, scope: HrScope, id: string) {
  const e = await employeeOr404(ctx, id);
  if (!visibleTo(e, scope)) throw new AppError("NOT_FOUND", "Employee not found.");
  return e;
}
function hasWorkingDay(start: string, end: string, holidays: string[]): boolean {
  const skip = new Set(holidays);
  for (let d = new Date(`${start}T00:00:00Z`); d <= new Date(`${end}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6 && !skip.has(d.toISOString().slice(0, 10))) return true;
  }
  return false;
}
const available = async (ctx: WorkspaceContext, employeeId: string, y = year()) => (await hr(() => svc.getSoldeDeConge(employeeId, y, company(ctx)))).available;

// ─── Reads ────────────────────────────────────────────────────────────────────

export const listEmployeesTool = defineTool({
  name: "hr_list_employees",
  module: "hr",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "Search or list employees (q matches name or job title; admins also match email; department matches a department NAME such as Operations). status: active, inactive or all. Non-admins see active colleagues (name, title, department) and their own full record. Salary and date of birth appear only with sensitive HR access.",
  input: z.object({ q: optText(80), department: optText(60), departmentId: objectIdSchema.optional(), status: z.enum(["active", "inactive", "all"]).optional(), page: pageNo }).strict(),
  async run(ctx, args, { access }) {
    const scope = await hrScope(ctx, access);
    const term = norm(args.q ?? "");
    const dept = norm(args.department ?? "");
    const all = await hr(() => svc.getEmployees({ status: args.status ?? "all", departmentId: args.departmentId }, scope.companyId));
    const rows = all
      .filter((e) => visibleTo(e, scope))
      .filter((e) => dept === "" || norm(e.departmentName).includes(dept))
      .filter((e) => term === "" || norm(e.fullName).includes(term) || norm(e.jobTitle).includes(term) || (scope.admin && norm(e.email).includes(term)))
      .map((e) => employeeView(e, scope));
    return {
      summary: `${rows.length} employee${rows.length === 1 ? "" : "s"}`,
      parts: [employeesTable(rows, args.page ?? 1, { ...(args.q ? { q: args.q } : {}), ...(args.status ? { status: args.status } : {}) }, scope, access)],
      data: { total: rows.length, employees: modelRows(rows, (e) => ({ ...e })) },
    };
  },
});

export const getEmployeeTool = defineTool({
  name: "hr_get_employee",
  module: "hr",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "Show one employee. Admins and the employee themselves see the full record; others see name, title and department of active staff.",
  input: z.object({ employeeId: objectIdSchema }).strict(),
  async run(ctx, args, { access }) {
    const scope = await hrScope(ctx, access);
    const v = employeeView(await readableEmployee(ctx, scope, args.employeeId), scope);
    return { summary: v.fullName, parts: [employeeCard(v, scope, access)], data: { ...v } };
  },
});

export const listDepartmentsTool = defineTool({
  name: "hr_list_departments",
  module: "hr",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "List departments with ids and active headcount.",
  input: z.object({}).strict(),
  async run(ctx, _a, { access }) {
    const scope = await hrScope(ctx, access);
    const rows = await hr(() => svc.getDepartments(scope.companyId));
    return { summary: `${rows.length} departments`, parts: [departmentsTable(rows, access, scope)], data: { departments: modelRows(rows, (d) => ({ id: d.id, name: d.name, activeStaff: d.employeeCount }), 50) } };
  },
});

export const listJobTitlesTool = defineTool({
  name: "hr_list_job_titles",
  module: "hr",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "List job titles with ids, their department and active headcount.",
  input: z.object({ departmentId: objectIdSchema.optional() }).strict(),
  async run(ctx, args, { access }) {
    const scope = await hrScope(ctx, access);
    const [titles, deps] = await Promise.all([hr(() => svc.getJobTitles(scope.companyId)), hr(() => svc.getDepartments(scope.companyId))]);
    const rows = titles.filter((t) => !args.departmentId || t.departmentId === args.departmentId);
    return { summary: `${rows.length} job titles`, parts: [jobTitlesTable(rows, deps, access, scope)], data: { jobTitles: modelRows(rows, (t) => ({ id: t.id, title: t.title, departmentId: t.departmentId, activeStaff: t.employeeCount }), 60) } };
  },
});

export const dashboardTool = defineTool({
  name: "hr_get_dashboard",
  module: "hr",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "HR headcount: employees (active and inactive), departments and job titles. Admins only. Salary totals are included only with sensitive HR access.",
  input: z.object({}).strict(),
  async run(ctx, _a, { access }) {
    const scope = await hrScope(ctx, access);
    requireHrAdmin(scope);
    const d = await hr(() => svc.getHRDashboardStats(scope.companyId));
    const fields = [
      { label: "Employees", value: String(d.totalEmployees) },
      { label: "Active", value: String(d.activeEmployees) },
      { label: "Inactive", value: String(d.inactiveEmployees) },
      { label: "Departments", value: String(d.departmentCount) },
      { label: "Job titles", value: String(d.jobTitleCount) },
      ...(scope.sensitive ? [{ label: "Average base salary", value: moneyOf(d.averageSalary, "TND") }, { label: "Monthly gross payroll", value: moneyOf(d.monthlyPayrollGross, "TND") }] : []),
    ];
    return {
      summary: "HR dashboard",
      parts: [{ type: "record_card" as const, title: "HR overview", fields }],
      data: { employees: d.totalEmployees, active: d.activeEmployees, inactive: d.inactiveEmployees, departments: d.departmentCount, jobTitles: d.jobTitleCount, ...(scope.sensitive ? { averageBaseSalary: moneyOf(d.averageSalary, "TND"), monthlyGrossPayroll: moneyOf(d.monthlyPayrollGross, "TND") } : {}) },
    };
  },
});

export const listLeaveTypesTool = defineTool({
  name: "hr_list_leave_types",
  module: "hr",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "List leave types (code, whether paid).",
  input: z.object({}).strict(),
  async run(ctx) {
    const rows = (await hr(() => svc.getLeaveTypes(company(ctx)))).filter((t) => t.isActive);
    return { summary: `${rows.length} leave types`, data: { leaveTypes: modelRows(rows, (t) => ({ id: t.id, name: t.name, code: t.code, paid: t.isPaid })) } };
  },
});

export const leaveBalanceTool = defineTool({
  name: "hr_get_leave_balance",
  module: "hr",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "Leave balance (Solde de congé) for this year: earned, taken, reserved, adjustments, available. employeeId defaults to the person asking; only admins may name someone else.",
  input: z.object({ employeeId: objectIdSchema.optional() }).strict(),
  async run(ctx, args, { access }) {
    const scope = await hrScope(ctx, access);
    const id = ownOrAdmin(scope, args.employeeId);
    await readableEmployee(ctx, scope, id);
    const s = await hr(() => svc.getSoldeDeConge(id, year(), scope.companyId));
    return { summary: `${s.employeeName}: ${days(s.available)} days available`, parts: [balanceCard(s)], data: { employee: s.employeeName, year: s.year, earned: days(s.earned), taken: days(s.taken), reserved: days(s.reserved), adjustments: days(s.adjustments), available: days(s.available), unpaidDaysTaken: days(s.unpaidDaysTaken) } };
  },
});

export const listLeaveRequestsTool = defineTool({
  name: "hr_list_leave_requests",
  module: "hr",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "List leave requests, newest first. status: pending, approved, rejected, cancelled, taken. Non-admins see only their own.",
  input: z.object({ employeeId: objectIdSchema.optional(), status: z.enum(["pending", "approved", "rejected", "cancelled", "taken"]).optional(), page: pageNo }).strict(),
  async run(ctx, args, { access }) {
    const scope = await hrScope(ctx, access);
    const employeeId = scope.admin ? args.employeeId : ownOrAdmin(scope, args.employeeId);
    const rows = await hr(() => svc.getLeaveRequests({ employeeId, status: args.status }, scope.companyId));
    return {
      summary: `${rows.length} leave request${rows.length === 1 ? "" : "s"}`,
      parts: [leaveRequestsTable(rows, args.page ?? 1, { ...(args.status ? { status: args.status } : {}), ...(employeeId ? { employeeId } : {}) }, scope, access)],
      data: { total: rows.length, requests: modelRows(rows, (r) => ({ id: r.id, employeeId: r.employeeId, employee: r.employeeName, type: r.leaveType, paid: r.isPaid, start: r.startDate, end: r.endDate, days: days(r.days), status: r.status })) },
    };
  },
});

export const todayAttendanceTool = defineTool({
  name: "hr_today_attendance",
  module: "hr",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "Who is present today. Admins get the company roster and counts; others get only their own record.",
  input: z.object({}).strict(),
  async run(ctx, _a, { access }) {
    const scope = await hrScope(ctx, access);
    if (scope.admin) {
      const s = await hr(() => svc.getTodayAttendance(scope.companyId));
      return { summary: `${s.presentCount} present of ${s.totalActive}`, parts: [todayCard(s), attendanceTable(s.records, 1, {}, "Today")], data: { active: s.totalActive, present: s.presentCount, checkedOut: s.checkedOutCount, absent: s.absentCount } };
    }
    if (!scope.selfId) throw new AppError("VALIDATION_ERROR", "You have no employee record linked to your login.");
    const rec = await hr(() => svc.getEmployeeTodayAttendance(scope.selfId!, scope.companyId));
    return { summary: rec ? `You are ${rec.status === "present" ? "present" : "checked out"} today` : "No check-in today", parts: rec ? [attendanceTable([rec], 1, {}, "Today")] : [], data: { today: rec ? { status: rec.status, hours: days(rec.hoursWorked) } : null } };
  },
});

export const listAttendanceTool = defineTool({
  name: "hr_list_attendance",
  module: "hr",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "Attendance history, newest first. from and to are YYYY-MM-DD. Non-admins see only their own.",
  input: z.object({ employeeId: objectIdSchema.optional(), from: optText(10), to: optText(10), page: pageNo }).strict(),
  async run(ctx, args, { access }) {
    const scope = await hrScope(ctx, access);
    const employeeId = scope.admin ? args.employeeId : ownOrAdmin(scope, args.employeeId);
    const check = (v: string | undefined, label: string) => {
      try {
        return v ? parseDate(v, label) : undefined;
      } catch (e) {
        throw new AppError("VALIDATION_ERROR", e instanceof MoneyError ? e.message : `${label} is invalid.`);
      }
    };
    const rows = await hr(() => svc.getAttendanceHistory({ employeeId, startDate: check(args.from, "From"), endDate: check(args.to, "To") }, scope.companyId));
    return {
      summary: `${rows.length} attendance record${rows.length === 1 ? "" : "s"}`,
      parts: [attendanceTable(rows, args.page ?? 1, { ...(employeeId ? { employeeId } : {}), ...(args.from ? { from: args.from } : {}), ...(args.to ? { to: args.to } : {}) })],
      data: { total: rows.length, records: modelRows(rows, (r) => ({ date: r.date, employee: r.employeeName, hours: days(r.hoursWorked), status: r.status })) },
    };
  },
});

// ─── Sensitive reads: payslips and payroll ────────────────────────────────────

const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Period must be YYYY-MM");

export const listPayslipsTool = defineTool({
  name: "hr_list_payslips",
  module: "hr",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  sensitive: "hr",
  description: "List payslips (sensitive). period is YYYY-MM. Non-admins see only their own.",
  input: z.object({ period: period.optional(), employeeId: objectIdSchema.optional(), page: pageNo }).strict(),
  async run(ctx, args, { access }) {
    const scope = await hrScope(ctx, access);
    if (!scope.sensitive) throw new AppError("FORBIDDEN", "Sensitive HR access is required.");
    const employeeId = scope.admin ? args.employeeId : ownOrAdmin(scope, args.employeeId);
    const rows = await hr(() => svc.getPayslips({ period: args.period, employeeId }, scope.companyId));
    return {
      summary: `${rows.length} payslip${rows.length === 1 ? "" : "s"}`,
      parts: [payslipsTable(rows, args.page ?? 1, { ...(args.period ? { period: args.period } : {}), ...(employeeId ? { employeeId } : {}) })],
      data: { total: rows.length, payslips: modelRows(rows, (p) => ({ id: p.id, employee: p.employeeName, period: p.period, base: moneyOf(p.baseSalary, "TND"), deduction: moneyOf(p.deduction, "TND"), net: moneyOf(p.netSalary, "TND"), status: p.status })) },
    };
  },
});

export const getPayslipTool = defineTool({
  name: "hr_get_payslip",
  module: "hr",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  sensitive: "hr",
  description: "Show one payslip (sensitive). Non-admins may open only their own.",
  input: z.object({ payslipId: objectIdSchema }).strict(),
  async run(ctx, args, { access }) {
    const scope = await hrScope(ctx, access);
    if (!scope.sensitive) throw new AppError("FORBIDDEN", "Sensitive HR access is required.");
    const p = await hr(() => svc.getPayslipById(args.payslipId, scope.companyId));
    if (!p || (!scope.admin && p.employeeId !== scope.selfId)) throw new AppError("NOT_FOUND", "Payslip not found.");
    return { summary: `Payslip ${p.period} for ${p.employeeName}`, parts: [payslipCard(p)], data: { id: p.id, employee: p.employeeName, period: p.period, base: moneyOf(p.baseSalary, "TND"), deduction: moneyOf(p.deduction, "TND"), net: moneyOf(p.netSalary, "TND"), unpaidLeaveDays: days(p.unpaidLeaveDays), status: p.status } };
  },
});

export const payrollSummaryTool = defineTool({
  name: "hr_payroll_summary",
  module: "hr",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  sensitive: "hr",
  description: "Payroll totals for a period from generated payslips (sensitive, admins only).",
  input: z.object({ period }).strict(),
  async run(ctx, args, { access }) {
    const scope = await hrScope(ctx, access);
    if (!scope.sensitive) throw new AppError("FORBIDDEN", "Sensitive HR access is required.");
    requireHrAdmin(scope);
    const s = await hr(() => svc.getPayrollSummary(args.period, scope.companyId));
    const data = { period: s.period, gross: moneyOf(s.totalGross, "TND"), deductions: moneyOf(s.totalDeductions, "TND"), net: moneyOf(s.totalNet, "TND"), activeEmployees: s.totalEmployees, payslipsGenerated: s.payslipsGenerated };
    return { summary: `Payroll ${s.period}`, parts: [{ type: "record_card" as const, title: `Payroll ${s.period}`, subtitle: "From generated payslips", fields: [{ label: "Gross", value: data.gross }, { label: "Deductions", value: data.deductions }, { label: "Net", value: data.net }, { label: "Payslips", value: `${s.payslipsGenerated} of ${s.totalEmployees} active employees` }] }], data };
  },
});

export const previewPayrollTool = defineTool({
  name: "hr_preview_payroll",
  module: "hr",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  sensitive: "hr",
  description: "PREVIEW one employee's payroll for a month (sensitive): base salary, unpaid-leave deduction, net, all calculated by the payroll service. Nothing is generated or paid. period is YYYY-MM; workingDays defaults to 22. Non-admins may preview only themselves.",
  input: z.object({ employeeId: objectIdSchema.optional(), period, workingDays: z.number().int().min(1).max(31).optional() }).strict(),
  async run(ctx, args, { access }) {
    const scope = await hrScope(ctx, access);
    if (!scope.sensitive) throw new AppError("FORBIDDEN", "Sensitive HR access is required.");
    const id = ownOrAdmin(scope, args.employeeId);
    await readableEmployee(ctx, scope, id);
    const p = await hr(() => svc.calculateEmployeePayrollPreview(id, args.period, args.workingDays ?? 22, scope.companyId));
    const existing = (await hr(() => svc.getPayslips({ period: args.period, employeeId: id }, scope.companyId)))[0];
    return {
      summary: `Preview ${args.period} for ${p.employee.fullName}`,
      parts: [previewCard(p, existing)],
      data: { employee: p.employee.fullName, period: p.period, base: moneyOf(p.baseSalary, "TND"), workingDays: p.workingDaysInMonth, dailyRate: moneyOf(p.dailyRate, "TND"), unpaidLeaveDays: days(p.unpaidLeaveDays), deduction: moneyOf(p.deduction, "TND"), net: moneyOf(p.netSalary, "TND"), existingPayslip: existing ? { net: moneyOf(existing.netSalary, "TND"), status: existing.status } : null, note: "Preview only. Payslips are generated in HR." },
    };
  },
});

// ─── Writes (owners and admins only) ──────────────────────────────────────────

async function adminScope(ctx: WorkspaceContext, access: Parameters<typeof hrScope>[1]) {
  const scope = await hrScope(ctx, access);
  requireHrAdmin(scope);
  return scope;
}

export const createDepartmentTool = defineTool({
  name: "hr_create_department",
  module: "hr",
  operation: "create",
  kind: "write",
  risk: "low",
  permission: A,
  description: "Propose a new department. name is required; description is optional.",
  input: z.object({ name: z.string().max(60), description: optText(250) }).strict(),
  async prepare(ctx, args, { access }) {
    const scope = await adminScope(ctx, access);
    const input = parse(departmentSchema, args);
    if ((await hr(() => svc.getDepartments(scope.companyId))).some((d) => norm(d.name) === norm(input.name))) throw new AppError("CONFLICT", `A department named "${input.name}" already exists.`);
    return { context: { input }, summary: `Create the department "${input.name}".`, details: [{ label: "Name", after: input.name }, ...(input.description ? [{ label: "Description", after: input.description }] : [])] };
  },
  async run(ctx, _a, { access }, context) {
    const scope = await adminScope(ctx, access);
    const input = context.input as { name: string; description?: string };
    if ((await hr(() => svc.getDepartments(scope.companyId))).some((d) => norm(d.name) === norm(input.name))) throw new AppError("CONFLICT", `A department named "${input.name}" already exists.`);
    await hr(() => svc.createDepartment(input.name, input.description, scope.companyId));
    return { summary: `Created the department ${input.name}.` };
  },
});

export const updateDepartmentTool = defineTool({
  name: "hr_update_department",
  module: "hr",
  operation: "edit",
  kind: "write",
  risk: "low",
  permission: A,
  description: "Propose changes to a department. Send departmentId and only what changes (name, description). Renaming also updates the department name shown on its employees.",
  input: z.object({ departmentId: objectIdSchema, name: optText(60), description: optText(250) }).strict(),
  async prepare(ctx, args, { access }) {
    const scope = await adminScope(ctx, access);
    const deps = await hr(() => svc.getDepartments(scope.companyId));
    const cur = deps.find((d) => d.id === args.departmentId);
    if (!cur) throw new AppError("NOT_FOUND", "Department not found.");
    const input = parse(departmentSchema, { name: args.name ?? cur.name, description: args.description ?? cur.description ?? "" });
    const rows: AiDiffRow[] = [];
    if (input.name !== cur.name) rows.push({ label: "Name", before: cur.name, after: input.name });
    if ((input.description ?? "") !== (cur.description ?? "")) rows.push({ label: "Description", before: cur.description || "none", after: input.description || "none" });
    if (rows.length === 0) throw new AppError("VALIDATION_ERROR", "That would not change anything.");
    if (input.name !== cur.name && deps.some((d) => d.id !== cur.id && norm(d.name) === norm(input.name))) throw new AppError("CONFLICT", `A department named "${input.name}" already exists.`);
    if (input.name !== cur.name && (cur.employeeCount ?? 0) > 0) rows.push({ label: "Staff affected", after: `${cur.employeeCount} active employee${cur.employeeCount === 1 ? "" : "s"} will show the new name` });
    return { context: { input, fp: [cur.name, cur.description ?? ""], name: cur.name }, summary: `Update the department "${cur.name}".`, details: rows };
  },
  async run(ctx, args, { access }, context) {
    const scope = await adminScope(ctx, access);
    const cur = (await hr(() => svc.getDepartments(scope.companyId))).find((d) => d.id === args.departmentId);
    if (!cur) throw new AppError("NOT_FOUND", "Department not found.");
    same(context.fp, [cur.name, cur.description ?? ""], `The department ${String(context.name)}`);
    const input = context.input as { name: string; description?: string };
    await hr(() => svc.updateDepartment(args.departmentId, input.name, input.description, scope.companyId));
    return { summary: `Updated the department ${input.name}.` };
  },
});

export const createJobTitleTool = defineTool({
  name: "hr_create_job_title",
  module: "hr",
  operation: "create",
  kind: "write",
  risk: "low",
  permission: A,
  description: "Propose a new job title. title is required; departmentId (from hr_list_departments) optional.",
  input: z.object({ title: z.string().max(80), departmentId: objectIdSchema.optional() }).strict(),
  async prepare(ctx, args, { access }) {
    const scope = await adminScope(ctx, access);
    const input = parse(jobTitleSchema, args);
    const [titles, deps] = await Promise.all([hr(() => svc.getJobTitles(scope.companyId)), hr(() => svc.getDepartments(scope.companyId))]);
    if (titles.some((t) => norm(t.title) === norm(input.title))) throw new AppError("CONFLICT", `The job title "${input.title}" already exists.`);
    const dep = input.departmentId ? deps.find((d) => d.id === input.departmentId) : undefined;
    if (input.departmentId && !dep) throw new AppError("NOT_FOUND", "Department not found.");
    return { context: { input }, summary: `Create the job title "${input.title}".`, details: [{ label: "Title", after: input.title }, { label: "Department", after: dep?.name ?? "Any" }] };
  },
  async run(ctx, _a, { access }, context) {
    const scope = await adminScope(ctx, access);
    const input = context.input as { title: string; departmentId?: string };
    if ((await hr(() => svc.getJobTitles(scope.companyId))).some((t) => norm(t.title) === norm(input.title))) throw new AppError("CONFLICT", `The job title "${input.title}" already exists.`);
    await hr(() => svc.ensureJobTitle(input.title, input.departmentId, false, scope.companyId));
    return { summary: `Created the job title ${input.title}.` };
  },
});

export const updateJobTitleTool = defineTool({
  name: "hr_update_job_title",
  module: "hr",
  operation: "edit",
  kind: "write",
  risk: "sensitive",
  permission: A,
  description: "Propose changes to a job title (title, departmentId). Renaming a title also renames it on every employee who holds it.",
  input: z.object({ jobTitleId: objectIdSchema, title: optText(80), departmentId: objectIdSchema.optional() }).strict(),
  async prepare(ctx, args, { access }) {
    const scope = await adminScope(ctx, access);
    const [titles, deps] = await Promise.all([hr(() => svc.getJobTitles(scope.companyId)), hr(() => svc.getDepartments(scope.companyId))]);
    const cur = titles.find((t) => t.id === args.jobTitleId);
    if (!cur) throw new AppError("NOT_FOUND", "Job title not found.");
    const input = parse(jobTitleSchema, { title: args.title ?? cur.title, departmentId: args.departmentId ?? cur.departmentId });
    const dep = input.departmentId ? deps.find((d) => d.id === input.departmentId) : undefined;
    if (input.departmentId && !dep) throw new AppError("NOT_FOUND", "Department not found.");
    const rows: AiDiffRow[] = [];
    if (input.title !== cur.title) rows.push({ label: "Title", before: cur.title, after: input.title });
    if ((input.departmentId ?? "") !== (cur.departmentId ?? "")) rows.push({ label: "Department", before: deps.find((d) => d.id === cur.departmentId)?.name ?? "Any", after: dep?.name ?? "Any" });
    if (rows.length === 0) throw new AppError("VALIDATION_ERROR", "That would not change anything.");
    if (input.title !== cur.title) {
      if (titles.some((t) => t.id !== cur.id && norm(t.title) === norm(input.title))) throw new AppError("CONFLICT", `The job title "${input.title}" already exists.`);
      if ((cur.employeeCount ?? 0) > 0) rows.push({ label: "Staff affected", after: `${cur.employeeCount} active employee${cur.employeeCount === 1 ? "" : "s"} will be renamed` });
    }
    return { context: { input, fp: [cur.title, cur.departmentId ?? ""], name: cur.title }, summary: `Update the job title "${cur.title}".`, details: rows };
  },
  async run(ctx, args, { access }, context) {
    const scope = await adminScope(ctx, access);
    const cur = (await hr(() => svc.getJobTitles(scope.companyId))).find((t) => t.id === args.jobTitleId);
    if (!cur) throw new AppError("NOT_FOUND", "Job title not found.");
    same(context.fp, [cur.title, cur.departmentId ?? ""], `The job title ${String(context.name)}`);
    const input = context.input as { title: string; departmentId?: string };
    await hr(() => svc.updateJobTitle(args.jobTitleId, input.title, input.departmentId, scope.companyId));
    return { summary: `Updated the job title ${input.title}.` };
  },
});

/** Only these four fields of an employee can be changed through AI. Everything else is carried over from the live record, server-side. */
const EDITABLE = ["fullName", "phone", "jobTitle", "departmentId"] as const;
const employeeFp = (e: { fullName: string; phone?: string; jobTitle: string; departmentId: string; updatedAt?: string }) => [e.fullName, e.phone ?? "", e.jobTitle, e.departmentId, e.updatedAt ?? ""];

export const updateEmployeeTool = defineTool({
  name: "hr_update_employee",
  module: "hr",
  operation: "edit",
  kind: "write",
  risk: "sensitive",
  permission: A,
  description:
    "Propose changes to an employee's fullName, phone, jobTitle (an existing title) or departmentId. Send employeeId and only what changes. Salary, role, email, status, hire date and date of birth cannot be changed here.",
  input: z.object({ employeeId: objectIdSchema, fullName: optText(80), phone: optText(25), jobTitle: optText(80), departmentId: objectIdSchema.optional() }).strict(),
  async prepare(ctx, args, { access }) {
    const scope = await adminScope(ctx, access);
    const cur = await employeeOr404(ctx, args.employeeId);
    const changes: Record<string, string> = {};
    const rows: AiDiffRow[] = [];
    const [deps, titles] = await Promise.all([hr(() => svc.getDepartments(scope.companyId)), hr(() => svc.getJobTitles(scope.companyId))]);
    for (const key of EDITABLE) {
      const want = args[key];
      if (want === undefined) continue;
      const before = (cur[key] as string | undefined) ?? "";
      if (want.trim() === before) continue;
      if (key === "departmentId") {
        const dep = deps.find((d) => d.id === want);
        if (!dep) throw new AppError("NOT_FOUND", "Department not found.");
        rows.push({ label: "Department", before: cur.departmentName, after: dep.name });
      } else if (key === "jobTitle") {
        const known = titles.find((t) => norm(t.title) === norm(want));
        if (!known) throw new AppError("VALIDATION_ERROR", `"${want}" is not an existing job title. Create it first with the job title command.`);
        changes[key] = known.title;
        rows.push({ label: "Job title", before: cur.jobTitle, after: known.title });
        continue;
      } else rows.push({ label: key === "fullName" ? "Name" : "Phone", before: before || "none", after: want.trim() || "none" });
      changes[key] = want.trim();
    }
    if (rows.length === 0) throw new AppError("VALIDATION_ERROR", "That would not change anything.");
    parse(employeeSchema, { ...cur, ...changes, isCustomJobTitle: false }); // the module's own rules, over the full record
    // Only the changes are stored with the proposal, never the rest of the record (salary, date of birth).
    return { context: { changes, fp: employeeFp(cur), name: cur.fullName }, summary: `Update the employee record of ${cur.fullName}.`, details: rows };
  },
  async run(ctx, args, { access }, context) {
    const scope = await adminScope(ctx, access);
    const cur = await employeeOr404(ctx, args.employeeId);
    same(context.fp, employeeFp(cur), `The record of ${String(context.name)}`);
    const input = parse(employeeSchema, { ...cur, dateOfBirth: cur.dateOfBirth ?? "", phone: cur.phone ?? "", ...(context.changes as Record<string, string>), isCustomJobTitle: false });
    await hr(() => svc.updateEmployee(args.employeeId, input, scope.companyId));
    return { summary: `Updated the record of ${String(context.name)}.` };
  },
});

// Leave

const leaveFields = {
  employeeId: objectIdSchema,
  leaveType: z.enum(["annual", "sick", "unpaid", "maternity_paternity", "bereavement", "other"]),
  startDate: z.string().max(10),
  endDate: z.string().max(10),
  halfDayOption: z.enum(["morning", "afternoon"]).optional(),
  reason: z.string().max(300),
};

export const submitLeaveTool = defineTool({
  name: "hr_submit_leave_request",
  module: "hr",
  operation: "create",
  kind: "write",
  risk: "sensitive",
  permission: A,
  description: "Propose submitting a leave REQUEST for an employee (it stays pending until approved). leaveType unpaid is unpaid; every other type uses the paid balance. Dates are YYYY-MM-DD. reason must come from the person. The system counts the working days.",
  input: z.object(leaveFields).strict(),
  async prepare(ctx, args, { access }) {
    const scope = await adminScope(ctx, access);
    const emp = await employeeOr404(ctx, args.employeeId);
    if (emp.status !== "active") throw new AppError("VALIDATION_ERROR", `${emp.fullName} is inactive.`);
    let start: string;
    let end: string;
    try {
      start = parseDate(args.startDate, "Start date");
      end = parseDate(args.endDate, "End date");
    } catch (e) {
      throw new AppError("VALIDATION_ERROR", e instanceof MoneyError ? e.message : "Invalid date.");
    }
    const input = parse(leaveRequestSchema, { ...args, startDate: start, endDate: end, isPaid: args.leaveType !== "unpaid" });
    const holidays = (await hr(() => svc.getPublicHolidays(scope.companyId))).map((h) => h.date);
    const n = calculateLeaveDays(input.startDate, input.endDate, holidays, input.halfDayOption);
    // The HR day counter never returns less than 1, so a weekend or holiday-only period would be charged a day.
    if (n <= 0 || !hasWorkingDay(input.startDate, input.endDate, holidays)) throw new AppError("VALIDATION_ERROR", "That period has no working days (weekends and public holidays are not counted).");
    const existing = await hr(() => svc.getLeaveRequests({ employeeId: emp.id }, scope.companyId));
    const clash = existing.find((r) => ["approved", "pending", "taken"].includes(r.status) && r.startDate <= input.endDate && r.endDate >= input.startDate);
    if (clash) throw new AppError("CONFLICT", `${emp.fullName} already has a ${clash.status} request from ${clash.startDate} to ${clash.endDate}.`);
    const bal = await available(ctx, emp.id, Number(input.startDate.slice(0, 4)));
    if (input.isPaid && n > bal) throw new AppError("VALIDATION_ERROR", `${n} days exceed the ${days(bal)} available days of ${emp.fullName}. Submit as unpaid leave or shorten it.`);
    return {
      context: { input, days: n },
      summary: `Submit a ${input.isPaid ? "paid" : "unpaid"} leave request for ${emp.fullName}: ${input.startDate} to ${input.endDate}, ${days(n)} working day${n === 1 ? "" : "s"}. It stays pending until approved.`,
      details: [
        { label: "Employee", after: emp.fullName },
        { label: "Type", after: `${input.leaveType.replace("_", " ")} (${input.isPaid ? "paid" : "unpaid"})` },
        { label: "Dates", after: `${input.startDate} to ${input.endDate}${input.halfDayOption ? `, ${input.halfDayOption} only` : ""}` },
        { label: "Working days", after: days(n) },
        ...(input.isPaid ? [{ label: "Balance", before: `${days(bal)} days available`, after: "unchanged until approved" }] : []),
        { label: "Reason", after: input.reason },
      ],
    };
  },
  async run(ctx, _a, { access }, context) {
    const scope = await adminScope(ctx, access);
    const r = await hr(() => svc.createLeaveRequest(context.input as Parameters<typeof svc.createLeaveRequest>[0], scope.companyId));
    return { summary: `Submitted the leave request for ${r.employeeName} (${days(r.days)} days, pending).`, data: { id: r.id } };
  },
});

async function loadRequest(ctx: WorkspaceContext, scope: HrScope, id: string) {
  const r = (await hr(() => svc.getLeaveRequests({}, scope.companyId))).find((x) => x.id === id);
  if (!r) throw new AppError("NOT_FOUND", "Leave request not found.");
  return r;
}
const requestFp = (r: { status: string; days: number; startDate: string; endDate: string; isPaid: boolean }) => [r.status, r.days, r.startDate, r.endDate, r.isPaid];

export const cancelLeaveTool = defineTool({
  name: "hr_cancel_leave_request",
  module: "hr",
  operation: "edit",
  kind: "write",
  risk: "sensitive",
  permission: A,
  description: "Propose cancelling a PENDING or APPROVED leave request. Cancelling an approved paid leave releases the reserved days. reason (at least 3 characters) must come from the person.",
  input: z.object({ requestId: objectIdSchema, reason: z.string().min(3).max(300) }).strict(),
  async prepare(ctx, args, { access }) {
    const scope = await adminScope(ctx, access);
    const r = await loadRequest(ctx, scope, args.requestId);
    if (r.status !== "pending" && r.status !== "approved") throw new AppError("INVALID_TRANSITION", `That request is ${r.status} and cannot be cancelled.`);
    return {
      context: { fp: requestFp(r), name: r.employeeName },
      summary: `Cancel the ${r.status} leave of ${r.employeeName} (${r.startDate} to ${r.endDate}).`,
      details: [{ label: "Employee", after: r.employeeName }, { label: "Dates", after: `${r.startDate} to ${r.endDate}, ${days(r.days)} days` }, { label: "Status", before: r.status, after: "cancelled" }, ...(r.status === "approved" && r.isPaid ? [{ label: "Balance", after: `${days(r.days)} reserved days are released` }] : []), { label: "Reason", after: args.reason }],
    };
  },
  async run(ctx, args, { access }, context) {
    const scope = await adminScope(ctx, access);
    same(context.fp, requestFp(await loadRequest(ctx, scope, args.requestId)), `The leave request of ${String(context.name)}`);
    await hr(() => svc.cancelLeaveRequest(args.requestId, args.reason, ctx.userId.toHexString(), scope.companyId, { isAdmin: true, employeeId: scope.selfId }));
    return { summary: `Cancelled the leave of ${String(context.name)}.` };
  },
});

async function decide(ctx: WorkspaceContext, access: Parameters<typeof hrScope>[1], args: { requestId: string; adminComment?: string; overrideReason?: string }, action: "approve" | "reject") {
  const scope = await adminScope(ctx, access);
  const r = await loadRequest(ctx, scope, args.requestId);
  if (r.status !== "pending") throw new AppError("INVALID_TRANSITION", `That request is ${r.status}. Only pending requests can be decided.`);
  parse(leaveReviewSchema, { requestId: args.requestId, action, adminComment: args.adminComment, overrideReason: args.overrideReason });
  const bal = r.isPaid && action === "approve" ? await available(ctx, r.employeeId, Number(r.startDate.slice(0, 4))) : null;
  return { scope, r, bal };
}

export const approveLeaveTool = defineTool({
  name: "hr_approve_leave_request",
  module: "hr",
  operation: "approve",
  kind: "write",
  risk: "financial",
  permission: A,
  description: "Propose APPROVING a PENDING leave request. Paid leave reserves days from the balance. If the balance is too low an overrideReason from the person is mandatory and the overdraft is recorded. Needs the employee's name typed to confirm.",
  input: z.object({ requestId: objectIdSchema, adminComment: optText(300), overrideReason: optText(300) }).strict(),
  async prepare(ctx, args, { access }) {
    const { r, bal } = await decide(ctx, access, args, "approve");
    const over = bal !== null && r.days > bal;
    if (over && !(args.overrideReason ?? "").trim()) throw new AppError("VALIDATION_ERROR", `${r.employeeName} has ${days(bal!)} days available but this request needs ${days(r.days)}. Approving it would be an overdraft, which needs an override reason from you.`);
    return {
      context: { fp: [...requestFp(r), bal], name: r.employeeName },
      summary: `Approve the ${r.isPaid ? "paid" : "unpaid"} leave of ${r.employeeName}: ${r.startDate} to ${r.endDate}, ${days(r.days)} days.`,
      details: [
        { label: "Employee", after: r.employeeName },
        { label: "Dates", after: `${r.startDate} to ${r.endDate}` },
        { label: "Days", after: days(r.days) },
        ...(bal !== null ? [{ label: "Available balance", before: `${days(bal)} days`, after: `${days(bal - r.days)} days${over ? " (overdraft)" : ""}` }] : [{ label: "Balance", after: "unpaid leave: no balance used" }]),
        ...(over ? [{ label: "Override reason", after: String(args.overrideReason).trim() }] : []),
      ],
      typedPhrase: r.employeeName,
    };
  },
  async run(ctx, args, { access }, context) {
    const { scope, r, bal } = await decide(ctx, access, args, "approve");
    same(context.fp, [...requestFp(r), bal], `The leave request of ${String(context.name)}`);
    await hr(() => svc.reviewLeaveRequest({ requestId: args.requestId, action: "approve", adminComment: args.adminComment, overrideReason: args.overrideReason }, `AI: ${ctx.userId.toHexString()}`, scope.companyId, { isAdmin: true }));
    return { summary: `Approved the leave of ${String(context.name)}.` };
  },
});

export const rejectLeaveTool = defineTool({
  name: "hr_reject_leave_request",
  module: "hr",
  operation: "approve",
  kind: "write",
  risk: "sensitive",
  permission: A,
  description: "Propose REJECTING a PENDING leave request. adminComment (why) should come from the person.",
  input: z.object({ requestId: objectIdSchema, adminComment: optText(300) }).strict(),
  async prepare(ctx, args, { access }) {
    const { r } = await decide(ctx, access, args, "reject");
    return {
      context: { fp: requestFp(r), name: r.employeeName },
      summary: `Reject the leave of ${r.employeeName}: ${r.startDate} to ${r.endDate}.`,
      details: [{ label: "Employee", after: r.employeeName }, { label: "Dates", after: `${r.startDate} to ${r.endDate}, ${days(r.days)} days` }, { label: "Status", before: "pending", after: "rejected" }, ...(args.adminComment ? [{ label: "Comment", after: args.adminComment }] : [])],
    };
  },
  async run(ctx, args, { access }, context) {
    const { scope, r } = await decide(ctx, access, args, "reject");
    same(context.fp, requestFp(r), `The leave request of ${String(context.name)}`);
    await hr(() => svc.reviewLeaveRequest({ requestId: args.requestId, action: "reject", adminComment: args.adminComment }, `AI: ${ctx.userId.toHexString()}`, scope.companyId, { isAdmin: true }));
    return { summary: `Rejected the leave of ${String(context.name)}.` };
  },
});

const adjustDays = z.union([z.string().max(8), z.number()]).transform((v) => String(v));

export const adjustLeaveTool = defineTool({
  name: "hr_adjust_leave_balance",
  module: "hr",
  operation: "approve",
  kind: "write",
  risk: "financial",
  permission: A,
  description: "Propose a MANUAL adjustment of an employee's paid leave balance. days is signed, in whole or half days (+2, -0.5), never zero, within 60. reason (at least 3 characters) is mandatory and must come from the person. Needs the signed days typed to confirm.",
  input: z.object({ employeeId: objectIdSchema, days: adjustDays, reason: z.string().min(3).max(300) }).strict(),
  async prepare(ctx, args, { access }) {
    const scope = await adminScope(ctx, access);
    const emp = await employeeOr404(ctx, args.employeeId);
    if (!/^[+-]?\d{1,2}(\.(0|5))?$/.test(args.days.trim()) && !/^[+-]?\.5$/.test(args.days.trim())) throw new AppError("VALIDATION_ERROR", "Days must be whole or half days, like +2 or -0.5.");
    const n = Number(args.days);
    if (n === 0 || Math.abs(n) > 60) throw new AppError("VALIDATION_ERROR", "Days cannot be zero or more than 60.");
    parse(leaveAdjustmentSchema, { employeeId: emp.id, days: n, reason: args.reason });
    const bal = await available(ctx, emp.id);
    const signed = `${n > 0 ? "+" : "-"}${days(Math.abs(n))}`;
    return {
      context: { fp: [bal], days: n, name: emp.fullName, scopeCompany: scope.companyId },
      summary: `Adjust the leave balance of ${emp.fullName} by ${signed} days.`,
      details: [{ label: "Employee", after: emp.fullName }, { label: "Adjustment", after: `${signed} days` }, { label: "Available balance", before: `${days(bal)} days`, after: `${days(bal + n)} days` }, { label: "Reason", after: args.reason }],
      typedPhrase: `${signed} days`,
    };
  },
  async run(ctx, args, { access }, context) {
    const scope = await adminScope(ctx, access);
    same(context.fp, [await available(ctx, args.employeeId)], `The leave balance of ${String(context.name)}`);
    await hr(() => svc.createManualAdjustment({ employeeId: args.employeeId, days: Number(context.days), reason: args.reason }, ctx.userId.toHexString(), `AI on behalf of ${ctx.userId.toHexString()}`, scope.companyId, { isAdmin: true }));
    return { summary: `Adjusted the leave balance of ${String(context.name)} by ${String(context.days)} days.` };
  },
});

export const HR_TOOLS = [
  listEmployeesTool,
  getEmployeeTool,
  listDepartmentsTool,
  listJobTitlesTool,
  dashboardTool,
  listLeaveTypesTool,
  leaveBalanceTool,
  listLeaveRequestsTool,
  todayAttendanceTool,
  listAttendanceTool,
  listPayslipsTool,
  getPayslipTool,
  payrollSummaryTool,
  previewPayrollTool,
  createDepartmentTool,
  updateDepartmentTool,
  createJobTitleTool,
  updateJobTitleTool,
  updateEmployeeTool,
  submitLeaveTool,
  cancelLeaveTool,
  approveLeaveTool,
  rejectLeaveTool,
  adjustLeaveTool,
];
