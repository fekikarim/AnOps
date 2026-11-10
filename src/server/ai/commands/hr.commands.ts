import "server-only";
import { callTool, field, form, nonEmpty, proposeTool } from "@/server/ai/commands/helpers";
import { ARGS, need, noText, pickCommand, requireCell, searchText } from "@/server/ai/commands/shared";
import type { CommandArgs, CommandDefinition, CommandEnv, DraftCandidate, DraftCurrent } from "@/server/ai/commands/types";
import { withAssist } from "@/server/ai/draft/assist";
import { todayTunis } from "@/server/ai/finance/money";
import { hr, hrScope, requireHrAdmin } from "@/server/ai/hr/access";
import type { AiFormField } from "@/server/db/documents";
import * as svc from "@/server/services/hr.service";
import { PERMISSIONS } from "@/server/security/permissions";
import { AppError } from "@/shared/lib/errors";

/**
 * HR commands. Reads reuse the read tools; writes build a form (manual or AI-drafted from the SAME field builders) and hand the
 * values to the write tool. Forms and drafts never carry salary, date of birth or role: they are not editable here, so they never
 * reach a form value or the model. Writes are owner/admin only; payroll is a preview that needs the sensitive switch.
 */
const MODULE = "hr" as const;
type Values = Record<string, string | boolean> | null;
const v = (cur: Values, key: string, fallback: string | boolean): string | boolean => (cur && cur[key] !== undefined ? cur[key] : fallback);
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const has = (ref: string, ...hay: (string | undefined)[]) => {
  const t = norm(ref);
  return t !== "" && hay.some((h) => norm(h ?? "").includes(t));
};
const page = (a: CommandArgs) => ({ page: Number(a.page ?? 1) });
const company = (env: CommandEnv) => env.ctx.companyId.toHexString();

const read = (name: string, description: string, tool: string, pick: (a: CommandArgs) => Record<string, unknown>, opts: { hidden?: boolean; sensitive?: boolean } = {}): CommandDefinition => ({
  name,
  description,
  example: `/${name}`,
  module: MODULE,
  operation: "view",
  permission: PERMISSIONS.HR_READ,
  hidden: opts.hidden,
  sensitive: opts.sensitive ? "hr" : undefined,
  args: ARGS,
  fromText: searchText,
  async start(env, args) {
    const r = await callTool(env, tool, pick(args));
    // A read with nothing to draw (no check-in today) still answers in words.
    return r.parts?.length ? { parts: r.parts } : { parts: [], text: r.summary };
  },
});

const LEAVE_WORDS = ["pending", "approved", "rejected", "cancelled", "taken"];
const employees = read("employees", "Browse and search employees.", "hr_list_employees", (a) => ({ q: String(a.q ?? ""), ...page(a) }));
const employee = read("employee", "Show one employee.", "hr_get_employee", (a) => ({ employeeId: need(a, "employeeId") }), { hidden: true });
const departments = read("departments", "List departments.", "hr_list_departments", () => ({}));
const jobtitles = read("jobtitles", "List job titles.", "hr_list_job_titles", () => ({}));
const hrdashboard = read("hrdashboard", "HR headcount overview (admins).", "hr_get_dashboard", () => ({}));
const leaverequests = read("leaverequests", "List leave requests (try /leaverequests pending).", "hr_list_leave_requests", (a) => ({
  ...(LEAVE_WORDS.includes(String(a.status ?? a.q ?? "").toLowerCase()) ? { status: String(a.status ?? a.q).toLowerCase() } : {}),
  ...(a.employeeId ? { employeeId: need(a, "employeeId") } : {}),
  ...page(a),
}));
const leavebalance = read("leavebalance", "Leave balance (yours, or an employee's for admins).", "hr_get_leave_balance", (a) => (a.employeeId ? { employeeId: need(a, "employeeId") } : {}));
const attendance = read("attendance", "Attendance today.", "hr_today_attendance", () => ({}));
const payslips = read("payslips", "Payslips (sensitive HR access).", "hr_list_payslips", (a) => ({ ...(/^\d{4}-\d{2}$/.test(String(a.q ?? "")) ? { period: String(a.q) } : {}), ...page(a) }), { sensitive: true });
payslips.start = async (env, a) => ({
  parts: (a.payslipId ? await callTool(env, "hr_get_payslip", { payslipId: need(a, "payslipId") }) : await callTool(env, "hr_list_payslips", { ...(/^\d{4}-\d{2}$/.test(String(a.q ?? "")) ? { period: String(a.q) } : {}), ...page(a) })).parts ?? [],
});

// ─── Lookups ──────────────────────────────────────────────────────────────────

async function activeEmployees(env: CommandEnv) {
  return (await hr(() => svc.getEmployees({ status: "active" }, company(env)))).slice(0, 500);
}
async function employeeOptions(env: CommandEnv) {
  return [{ value: "", label: "Choose an employee" }, ...(await activeEmployees(env)).map((e) => ({ value: e.id, label: e.fullName }))];
}
const employeeRef = {
  async find(env: CommandEnv, words: string): Promise<DraftCandidate[]> {
    const all = await activeEmployees(env);
    let hits = all.filter((e) => has(words, e.fullName));
    if (hits.length === 0) {
      const token = words.split(/\s+/).find((t) => t.length >= 3);
      if (token) hits = all.filter((e) => has(token, e.fullName));
    }
    return hits.slice(0, 8).map((e) => ({ id: e.id, label: e.fullName, detail: `${e.jobTitle} · ${e.departmentName}` }));
  },
  async byId(env: CommandEnv, id: string): Promise<DraftCandidate | null> {
    const e = await hr(() => svc.getEmployeeById(id, company(env)));
    return e && e.status === "active" ? { id: e.id, label: e.fullName, detail: `${e.jobTitle} · ${e.departmentName}` } : null;
  },
};
async function departmentOptions(env: CommandEnv, blank: string) {
  return [{ value: "", label: blank }, ...(await hr(() => svc.getDepartments(company(env)))).map((d) => ({ value: d.id, label: d.name }))];
}

/** Every HR write command is for owners and admins: checked here, in the tool, and again at confirmation. */
async function adminOnly(env: CommandEnv) {
  requireCell(env, MODULE, "view");
  requireHrAdmin(await hrScope(env.ctx, env.access));
}

// ─── Departments and job titles ───────────────────────────────────────────────

const departmentFields = (cur: Values): AiFormField[] => [
  field({ name: "name", label: "Name", kind: "text", required: true, value: v(cur, "name", "") }),
  field({ name: "description", label: "Description", kind: "text", value: v(cur, "description", "") }),
];
async function loadDepartment(env: CommandEnv, id: string): Promise<DraftCurrent> {
  const d = (await hr(() => svc.getDepartments(company(env)))).find((x) => x.id === id);
  if (!d) throw new AppError("NOT_FOUND", "Department not found.");
  return { id: d.id, label: d.name, values: { name: d.name, description: d.description ?? "" } };
}
async function searchDepartments(env: CommandEnv, text: string): Promise<DraftCandidate[]> {
  return (await hr(() => svc.getDepartments(company(env)))).filter((d) => text.trim() === "" || has(text, d.name)).slice(0, 8).map((d) => ({ id: d.id, label: d.name, detail: `${d.employeeCount ?? 0} active` }));
}

const newdepartment = withAssist(
  {
    name: "newdepartment",
    description: "Create a department (admins).",
    example: "/newdepartment",
    module: MODULE,
    operation: "create",
    permission: PERMISSIONS.HR_ADMIN,
    args: ARGS,
    fromText: noText,
    async start(env) {
      await adminOnly(env);
      return { parts: [form({ title: "New department", command: "newdepartment", context: {}, submitLabel: "Review", fields: departmentFields(null) })] };
    },
    submit: (env, _a, values) => proposeTool(env, "hr_create_department", nonEmpty(values)),
  },
  { kind: "create", noun: "department", examples: ["A department called Logistics for transport and warehousing staff"], tool: "hr_create_department", criticalFields: [], fields: async () => departmentFields(null) }
);

const editdepartmentBase = pickCommand({
  name: "editdepartment",
  description: "Rename or describe a department (admins).",
  example: "/editdepartment logistics",
  module: MODULE,
  operation: "edit",
  permission: PERMISSIONS.HR_ADMIN,
  title: "Choose a department to edit",
  key: "departmentId",
  list: async (env) => (await callTool(env, "hr_list_departments", {})).parts ?? [],
  async select(env, a) {
    await adminOnly(env);
    const c = await loadDepartment(env, need(a, "departmentId"));
    return { parts: [form({ title: `Edit ${c.label}`, command: "editdepartment", context: { departmentId: c.id }, submitLabel: "Review changes", fields: departmentFields(c.values) })] };
  },
});
editdepartmentBase.submit = (env, a, values) => proposeTool(env, "hr_update_department", { ...nonEmpty(values, ["description"]), departmentId: need(a, "departmentId") });
const editdepartment = withAssist(editdepartmentBase, {
  kind: "edit",
  noun: "department",
  examples: ["Rename the Logistics department to Supply Chain"],
  tool: "hr_update_department",
  criticalFields: [],
  target: { label: "department", key: "departmentId", search: searchDepartments, load: loadDepartment },
  fields: async (_e, cur) => departmentFields(cur?.values ?? null),
  context: (cur) => ({ departmentId: cur.id }),
});

const jobTitleFields = async (env: CommandEnv, cur: Values): Promise<AiFormField[]> => [
  field({ name: "title", label: "Title", kind: "text", required: true, value: v(cur, "title", "") }),
  field({ name: "departmentId", label: "Department", kind: "select", value: v(cur, "departmentId", ""), options: await departmentOptions(env, "Any department") }),
];
async function loadJobTitle(env: CommandEnv, id: string): Promise<DraftCurrent> {
  const t = (await hr(() => svc.getJobTitles(company(env)))).find((x) => x.id === id);
  if (!t) throw new AppError("NOT_FOUND", "Job title not found.");
  return { id: t.id, label: t.title, values: { title: t.title, departmentId: t.departmentId ?? "" } };
}
async function searchJobTitles(env: CommandEnv, text: string): Promise<DraftCandidate[]> {
  return (await hr(() => svc.getJobTitles(company(env)))).filter((t) => text.trim() === "" || has(text, t.title)).slice(0, 8).map((t) => ({ id: t.id, label: t.title, detail: `${t.employeeCount ?? 0} active` }));
}

const newjobtitle = withAssist(
  {
    name: "newjobtitle",
    description: "Create a job title (admins).",
    example: "/newjobtitle",
    module: MODULE,
    operation: "create",
    permission: PERMISSIONS.HR_ADMIN,
    args: ARGS,
    fromText: noText,
    async start(env) {
      await adminOnly(env);
      return { parts: [form({ title: "New job title", command: "newjobtitle", context: {}, submitLabel: "Review", fields: await jobTitleFields(env, null) })] };
    },
    submit: (env, _a, values) => proposeTool(env, "hr_create_job_title", nonEmpty(values)),
  },
  { kind: "create", noun: "job title", examples: ["A job title Warehouse Supervisor in the Logistics department"], tool: "hr_create_job_title", criticalFields: [], fields: (env) => jobTitleFields(env, null) }
);

const editjobtitleBase = pickCommand({
  name: "editjobtitle",
  description: "Rename a job title or move it to a department (admins).",
  example: "/editjobtitle supervisor",
  module: MODULE,
  operation: "edit",
  permission: PERMISSIONS.HR_ADMIN,
  title: "Choose a job title to edit",
  key: "jobTitleId",
  list: async (env) => (await callTool(env, "hr_list_job_titles", {})).parts ?? [],
  async select(env, a) {
    await adminOnly(env);
    const c = await loadJobTitle(env, need(a, "jobTitleId"));
    return { parts: [form({ title: `Edit ${c.label}`, description: "Renaming a title renames it on everyone who holds it.", command: "editjobtitle", context: { jobTitleId: c.id }, submitLabel: "Review changes", fields: await jobTitleFields(env, c.values) })] };
  },
});
editjobtitleBase.submit = (env, a, values) => proposeTool(env, "hr_update_job_title", { ...nonEmpty(values), jobTitleId: need(a, "jobTitleId") });
const editjobtitle = withAssist(editjobtitleBase, {
  kind: "edit",
  noun: "job title",
  examples: ["Rename the job title Supervisor to Team Lead"],
  tool: "hr_update_job_title",
  criticalFields: [],
  target: { label: "job title", key: "jobTitleId", search: searchJobTitles, load: loadJobTitle },
  fields: (env, cur) => jobTitleFields(env, cur?.values ?? null),
  context: (cur) => ({ jobTitleId: cur.id }),
});

// ─── Employees (edit only: creation stays manual because it provisions a login) ─

async function employeeFields(env: CommandEnv, cur: Values): Promise<AiFormField[]> {
  const titles = await hr(() => svc.getJobTitles(company(env)));
  return [
    field({ name: "fullName", label: "Full name", kind: "text", required: true, value: v(cur, "fullName", "") }),
    field({ name: "phone", label: "Phone", kind: "text", value: v(cur, "phone", "") }),
    field({ name: "jobTitle", label: "Job title", kind: "select", required: true, value: v(cur, "jobTitle", ""), options: titles.map((t) => ({ value: t.title, label: t.title })) }),
    field({ name: "departmentId", label: "Department", kind: "select", required: true, value: v(cur, "departmentId", ""), options: await departmentOptions(env, "Choose a department") }),
  ];
}
async function loadEmployee(env: CommandEnv, id: string): Promise<DraftCurrent> {
  const e = await hr(() => svc.getEmployeeById(id, company(env)));
  if (!e) throw new AppError("NOT_FOUND", "Employee not found.");
  // Only the four editable fields are ever put in a form or shown to the model.
  return { id: e.id, label: e.fullName, values: { fullName: e.fullName, phone: e.phone ?? "", jobTitle: e.jobTitle, departmentId: e.departmentId } };
}
async function searchEmployees(env: CommandEnv, text: string): Promise<DraftCandidate[]> {
  return (await hr(() => svc.getEmployees({ status: "all" }, company(env)))).filter((e) => text.trim() === "" || has(text, e.fullName, e.jobTitle)).slice(0, 8).map((e) => ({ id: e.id, label: e.fullName, detail: `${e.jobTitle} · ${e.departmentName}` }));
}

const editemployeeBase = pickCommand({
  name: "editemployee",
  description: "Edit an employee's name, phone, job title or department (admins).",
  example: "/editemployee sarra",
  module: MODULE,
  operation: "edit",
  permission: PERMISSIONS.HR_ADMIN,
  title: "Choose an employee to edit",
  key: "employeeId",
  list: async (env, a) => (await callTool(env, "hr_list_employees", { q: String(a.q ?? ""), ...page(a) })).parts ?? [],
  async select(env, a) {
    await adminOnly(env);
    const c = await loadEmployee(env, need(a, "employeeId"));
    return { parts: [form({ title: `Edit ${c.label}`, description: "Salary, role, email and status are changed in HR, not here.", command: "editemployee", context: { employeeId: c.id }, submitLabel: "Review changes", fields: await employeeFields(env, c.values) })] };
  },
});
editemployeeBase.submit = (env, a, values) => proposeTool(env, "hr_update_employee", { ...nonEmpty(values, ["phone"]), employeeId: need(a, "employeeId") });
const editemployee = withAssist(editemployeeBase, {
  kind: "edit",
  noun: "employee",
  examples: ["Change Sarra Ben Ali's job title to Team Lead and her phone to 20 123 456"],
  tool: "hr_update_employee",
  criticalFields: [],
  target: { label: "employee", key: "employeeId", search: searchEmployees, load: loadEmployee },
  fields: (env, cur) => employeeFields(env, cur?.values ?? null),
  context: (cur) => ({ employeeId: cur.id }),
});

// ─── Leave ────────────────────────────────────────────────────────────────────

const LEAVE_TYPES = [
  { value: "", label: "Choose a type" },
  { value: "annual", label: "Annual (paid)" },
  { value: "sick", label: "Sick (paid)" },
  { value: "unpaid", label: "Unpaid" },
  { value: "maternity_paternity", label: "Maternity or paternity (paid)" },
  { value: "bereavement", label: "Bereavement (paid)" },
  { value: "other", label: "Other (paid)" },
];

async function leaveFields(env: CommandEnv, cur: Values): Promise<AiFormField[]> {
  return [
    field({ name: "employeeId", label: "Employee", kind: "select", required: true, value: v(cur, "employeeId", ""), options: await employeeOptions(env) }),
    field({ name: "leaveType", label: "Type", kind: "select", required: true, value: v(cur, "leaveType", ""), options: LEAVE_TYPES }),
    field({ name: "startDate", label: "First day", kind: "text", required: true, value: v(cur, "startDate", ""), placeholder: "YYYY-MM-DD" }),
    field({ name: "endDate", label: "Last day", kind: "text", required: true, value: v(cur, "endDate", ""), placeholder: "YYYY-MM-DD" }),
    field({ name: "halfDayOption", label: "Half day", kind: "select", value: v(cur, "halfDayOption", ""), options: [{ value: "", label: "Full days" }, { value: "morning", label: "Morning only" }, { value: "afternoon", label: "Afternoon only" }] }),
    field({ name: "reason", label: "Reason", kind: "textarea", required: true, value: v(cur, "reason", "") }),
  ];
}

const submitleave = withAssist(
  {
    name: "submitleave",
    description: "Submit a leave request for an employee (admins). It stays pending until approved.",
    example: "/submitleave",
    module: MODULE,
    operation: "create",
    permission: PERMISSIONS.HR_ADMIN,
    args: ARGS,
    fromText: noText,
    async start(env, args) {
      await adminOnly(env);
      return { parts: [form({ title: "New leave request", description: "The system counts the working days and checks the balance on the next step.", command: "submitleave", context: {}, submitLabel: "Review", fields: await leaveFields(env, args.employeeId ? { employeeId: String(args.employeeId) } : null) })] };
    },
    submit: (env, _a, values) => proposeTool(env, "hr_submit_leave_request", nonEmpty(values)),
  },
  {
    kind: "create",
    noun: "leave request",
    examples: ["Sarra Ben Ali needs annual leave from 2026-12-21 to 2026-12-24 for a family trip"],
    tool: "hr_submit_leave_request",
    criticalFields: ["employeeId", "leaveType", "startDate", "endDate"],
    refFields: { employeeId: employeeRef },
    fields: (env, cur) => leaveFields(env, cur?.values ?? null),
  }
);

const requestPicker = (name: string, description: string, status: string | undefined, operation: CommandDefinition["operation"], title: string) =>
  pickCommand({
    name,
    description,
    example: `/${name}`,
    module: MODULE,
    operation,
    permission: PERMISSIONS.HR_ADMIN,
    title,
    key: "requestId",
    list: async (env, a) => (await callTool(env, "hr_list_leave_requests", { ...(status ? { status } : {}), ...page(a) })).parts ?? [],
    select: async () => ({ parts: [] }),
  });

const reasonForm = (title: string, description: string, command: string, requestId: string, label: string, required: boolean, extra: AiFormField[] = []) =>
  form({ title, description, command, context: { requestId }, submitLabel: "Review", fields: [...extra, field({ name: "reason", label, kind: "textarea", required, value: "" })] });

const approveleave = requestPicker("approveleave", "Approve a pending leave request (typed confirmation).", "pending", "approve", "Choose a request to approve");
approveleave.select = async (env, a) => {
  await adminOnly(env);
  const id = need(a, "requestId");
  const r = (await hr(() => svc.getLeaveRequests({ status: "pending" }, company(env)))).find((x) => x.id === id);
  if (!r) throw new AppError("NOT_FOUND", "That request is not pending.");
  if (r.isPaid) {
    const bal = (await hr(() => svc.getSoldeDeConge(r.employeeId, Number(r.startDate.slice(0, 4)), company(env)))).available;
    if (r.days > bal) {
      return { parts: [reasonForm(`Approve ${r.employeeName}`, `Needs ${r.days} days but only ${bal} are available. Approving is an overdraft and needs a reason.`, "approveleave", id, "Override reason", true)] };
    }
  }
  return proposeTool(env, "hr_approve_leave_request", { requestId: id });
};
approveleave.submit = (env, a, values) => proposeTool(env, "hr_approve_leave_request", { requestId: need(a, "requestId"), overrideReason: String(values.reason ?? "") });

const rejectleave = requestPicker("rejectleave", "Reject a pending leave request.", "pending", "approve", "Choose a request to reject");
rejectleave.select = async (env, a) => {
  await adminOnly(env);
  return { parts: [reasonForm("Reject leave request", "Say why, so the employee knows.", "rejectleave", need(a, "requestId"), "Comment", false)] };
};
rejectleave.submit = (env, a, values) => proposeTool(env, "hr_reject_leave_request", { requestId: need(a, "requestId"), ...(values.reason ? { adminComment: String(values.reason) } : {}) });

const cancelleave = requestPicker("cancelleave", "Cancel a pending or approved leave request.", undefined, "edit", "Choose a request to cancel");
cancelleave.select = async (env, a) => {
  await adminOnly(env);
  return { parts: [reasonForm("Cancel leave request", "Cancelling an approved paid leave releases its reserved days.", "cancelleave", need(a, "requestId"), "Reason", true)] };
};
cancelleave.submit = (env, a, values) => proposeTool(env, "hr_cancel_leave_request", { requestId: need(a, "requestId"), reason: String(values.reason ?? "") });

const adjustFields = async (env: CommandEnv, cur: Values): Promise<AiFormField[]> => [
  field({ name: "employeeId", label: "Employee", kind: "select", required: true, value: v(cur, "employeeId", ""), options: await employeeOptions(env) }),
  field({ name: "days", label: "Days to add or remove", kind: "text", required: true, value: v(cur, "days", ""), placeholder: "+2 or -0.5", hint: "Whole or half days. A minus removes days." }),
  field({ name: "reason", label: "Reason", kind: "textarea", required: true, value: v(cur, "reason", ""), hint: "Mandatory. It is recorded with the adjustment." }),
];
const adjustleave = withAssist(
  {
    name: "adjustleave",
    description: "Manually adjust an employee's leave balance (typed confirmation, admins).",
    example: "/adjustleave",
    module: MODULE,
    operation: "approve",
    permission: PERMISSIONS.HR_ADMIN,
    args: ARGS,
    fromText: noText,
    async start(env) {
      await adminOnly(env);
      return { parts: [form({ title: "Adjust leave balance", command: "adjustleave", context: {}, submitLabel: "Review", fields: await adjustFields(env, null) })] };
    },
    submit: (env, _a, values) => proposeTool(env, "hr_adjust_leave_balance", nonEmpty(values)),
  },
  {
    kind: "create",
    action: "Adjust leave balance",
    noun: "leave balance adjustment",
    examples: ["Give Sarra Ben Ali 2 extra days because she worked on a public holiday"],
    tool: "hr_adjust_leave_balance",
    criticalFields: ["employeeId", "days"],
    refFields: { employeeId: employeeRef },
    fields: (env, cur) => adjustFields(env, cur?.values ?? null),
  }
);

// ─── Payroll preview (sensitive, read only) ───────────────────────────────────

const payrollpreviewBase = pickCommand({
  name: "payrollpreview",
  description: "Preview one employee's payroll for a month (sensitive HR access, preview only).",
  example: "/payrollpreview",
  module: MODULE,
  operation: "view",
  permission: PERMISSIONS.HR_READ,
  title: "Choose an employee to preview",
  key: "employeeId",
  list: async (env, a) => (await callTool(env, "hr_list_employees", { q: String(a.q ?? ""), ...page(a) })).parts ?? [],
  async select(env, a) {
    return {
      parts: [
        form({
          title: "Payroll preview",
          description: "Calculated by the payroll service. Nothing is generated or paid.",
          command: "payrollpreview",
          context: { employeeId: need(a, "employeeId") },
          submitLabel: "Preview",
          fields: [
            field({ name: "period", label: "Month", kind: "text", required: true, value: todayTunis().slice(0, 7), placeholder: "YYYY-MM" }),
            field({ name: "workingDays", label: "Working days in the month", kind: "text", value: "22", hint: "1 to 31. The HR default is 22." }),
          ],
        }),
      ],
    };
  },
});
payrollpreviewBase.sensitive = "hr";
payrollpreviewBase.submit = async (env, a, values) => {
  const wd = Number(values.workingDays || 22);
  if (!Number.isInteger(wd)) throw new AppError("VALIDATION_ERROR", "Working days must be a whole number.");
  return { parts: (await callTool(env, "hr_preview_payroll", { employeeId: need(a, "employeeId"), period: String(values.period ?? ""), workingDays: wd })).parts ?? [] };
};
const payrollpreview = payrollpreviewBase;

export const HR_COMMANDS: CommandDefinition[] = [
  hrdashboard,
  employees,
  employee,
  editemployee,
  departments,
  newdepartment,
  editdepartment,
  jobtitles,
  newjobtitle,
  editjobtitle,
  leaverequests,
  leavebalance,
  submitleave,
  approveleave,
  rejectleave,
  cancelleave,
  adjustleave,
  attendance,
  payslips,
  payrollpreview,
];
