import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createHarness, type TestHarness } from "../helpers/workspace";
import { actorOf, seedMember, seedTenants, type SeededMember } from "../helpers/ai";
import { code, flow, formValues, fieldValue, kind, llm, stated } from "../helpers/ai-flow";
import { saveMemberGrant, updateAiSettings } from "@/server/ai/access/access.service";
import { commandRegistry } from "@/server/ai/commands";
import { employeeSchema } from "@/features/hr/schemas/hr.schema";
import * as hr from "@/server/services/hr.service";
import type { AiModules } from "@/shared/domain/ai";

const shared = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/server/db/client", () => ({ default: Promise.resolve({ db: () => shared.db }) }));

let h: TestHarness;
let T: Awaited<ReturnType<typeof seedTenants>>;
let C: string;
let D1: string;
let D2: string;
const f = flow(() => h);
const SAL = { admin: "4137.5", mgr: "3071.5", emp: "1789.5", zed: "2653.5" };
const DOB = { admin: "1987-03-09", mgr: "1984-07-21", emp: "1992-11-30", zed: "1990-05-17" };
const ALL = { view: true, create: true, edit: true, delete: true, approve: true };
const VIEW = { view: true, create: false, edit: false, delete: false, approve: false };
const grant = (modules: AiModules, sensitive: boolean) => ({ enabled: true, modules, canAuditTranscripts: false, canViewSensitiveHr: sensitive, dailyTokenCap: null });

const M: Record<string, SeededMember> = {};
const E: Record<string, string> = {}; // employee ids by key
let zed: string;
let B: { employee: string; department: string };

async function emp(member: SeededMember, name: string, salary: string, dob: string, role = "employee", email?: string) {
  const user = await h.db.collection("users").findOne({ _id: member.userId });
  const input = employeeSchema.parse({ fullName: name, email: email ?? user!.email, phone: "20 000 000", departmentId: D1, jobTitle: "Analyst", hireDate: "2026-01-05", dateOfBirth: dob, baseSalary: Number(salary), role, status: "active", leaveAllowance: 25 });
  return (await hr.createEmployee(input, C)).id;
}
const everything = (r: { data?: unknown; parts?: unknown }) => JSON.stringify([r.data, r.parts]);
const hasSensitive = (text: string, ...keys: (keyof typeof SAL)[]) => keys.some((k) => text.includes(SAL[k]) || text.includes(SAL[k].replace(".5", ".50")) || text.includes(DOB[k]));
const pendingDocs = () => h.db.collection("ai_pending_actions").find({}).toArray();
const bal = async (id: string, year = new Date().getFullYear()) => (await hr.getSoldeDeConge(id, year, C)).available;
const days = (a: string, b: string) => Number(a.length > 0) && b;
void days;

beforeAll(async () => {
  h = await createHarness();
  shared.db = h.db;
  T = await seedTenants(h);
  C = T.companyA.toHexString();
  for (const o of [T.A.owner, T.B.owner]) await updateAiSettings(actorOf(h, o), { enabled: true, retentionDays: 90, dailyTokenBudget: 0, defaultUserDailyTokenCap: 0 }, 0);
  await hr.seedHrDefaultsForCompany(C);
  const deps = await hr.getDepartments(C);
  D1 = deps[0].id;
  D2 = deps[1].id;
  const owner = actorOf(h, T.A.owner);
  const mk = async (key: string, role: "admin" | "manager" | "employee", modules: AiModules, sensitive: boolean) => {
    M[key] = await seedMember(h.db, T.companyA, role);
    await saveMemberGrant(owner, M[key].userId.toHexString(), grant(modules, sensitive), 0);
  };
  await mk("adminS", "admin", { hr: ALL }, true);
  await mk("adminN", "admin", { hr: ALL }, false);
  await mk("mgrS", "manager", { hr: VIEW }, true);
  await mk("mgrN", "manager", { hr: VIEW }, false);
  await mk("empS", "employee", { hr: VIEW }, true);
  await mk("empN", "employee", { hr: VIEW }, false);
  E.adminS = await emp(M.adminS, "Adam Admin", SAL.admin, DOB.admin, "hr_admin");
  E.mgrS = await emp(M.mgrS, "Mona Manager", SAL.mgr, DOB.mgr, "manager");
  E.empS = await emp(M.empS, "Emna Employee", SAL.emp, DOB.emp);
  E.adminN = await emp(M.adminN, "Nadia Admin", "3900", "1983-01-02", "hr_admin");
  E.mgrN = await emp(M.mgrN, "Karim Manager", "3050", "1985-02-03", "manager");
  E.empN = await emp(M.empN, "Sami Employee", "1700", "1991-04-05");
  zed = await emp(M.empN, "Zed Colleague", SAL.zed, DOB.zed, "employee", "zed@hr.test");
  await hr.createManualAdjustment({ employeeId: E.empS, days: 30, reason: "Test balance" }, "u", "Test", C);

  const idB = T.companyB.toHexString();
  await hr.seedHrDefaultsForCompany(idB);
  const depB = (await hr.getDepartments(idB))[0].id;
  B = {
    department: depB,
    employee: (await hr.createEmployee(employeeSchema.parse({ fullName: "Bella Other", email: "bella@other.test", phone: "", departmentId: depB, jobTitle: "Analyst", hireDate: "2026-01-05", dateOfBirth: "1980-12-12", baseSalary: 9999, role: "employee", status: "active", leaveAllowance: 25 }), idB)).id,
  };
});
afterAll(async () => {
  await h.cleanup();
});

describe("sensitive data never reaches the model unless the switch is on AND the role allows it", () => {
  it("an admin without the switch gets no salary or date of birth anywhere: lists, records, dashboard, cards", async () => {
    for (const [tool, args] of [["hr_list_employees", {}], ["hr_get_employee", { employeeId: E.adminS }], ["hr_get_dashboard", {}], ["hr_list_employees", { q: "adam" }]] as const) {
      const r = await f.read(M.adminN, tool, args);
      const text = everything(r);
      expect(hasSensitive(text, "admin", "mgr", "emp", "zed"), tool).toBe(false);
      expect(text, tool).not.toMatch(/baseSalary|dateOfBirth|Base salary|Date of birth|averageBaseSalary|Monthly gross/);
    }
  });

  it("an admin with the switch sees salary and date of birth of everyone, and payroll figures on the dashboard", async () => {
    const list = everything(await f.read(M.adminS, "hr_list_employees", {}));
    expect(hasSensitive(list, "admin", "mgr", "emp", "zed")).toBe(true);
    expect(everything(await f.read(M.adminS, "hr_get_employee", { employeeId: zed }))).toContain(DOB.zed);
    expect(everything(await f.read(M.adminS, "hr_get_dashboard", {}))).toContain("Monthly gross");
  });

  it("a manager or employee WITH the switch sees only their own salary, never a colleague's or an admin's", async () => {
    for (const [key, own, others] of [["mgrS", "mgr", ["admin", "emp", "zed"]], ["empS", "emp", ["admin", "mgr", "zed"]]] as const) {
      const list = everything(await f.read(M[key], "hr_list_employees", {}));
      expect(hasSensitive(list, own), key).toBe(true);
      expect(hasSensitive(list, ...others), key).toBe(false);
      const colleague = everything(await f.read(M[key], "hr_get_employee", { employeeId: zed }));
      expect(colleague).toContain("Zed Colleague");
      expect(hasSensitive(colleague, "zed"), key).toBe(false);
      expect(colleague).not.toMatch(/email|phone|hireDate|leaveAllowance/i);
    }
  });

  it("without the switch a manager or employee sees no salary at all, not even their own", async () => {
    for (const key of ["mgrN", "empN"]) {
      const list = everything(await f.read(M[key], "hr_list_employees", {}));
      expect(hasSensitive(list, "admin", "mgr", "emp", "zed"), key).toBe(false);
      expect(list).not.toMatch(/baseSalary|dateOfBirth/);
    }
  });

  it("employees can be filtered by department NAME, so nobody has to know an id", async () => {
    const dept = (await hr.getDepartments(C)).find((d) => d.id === D1)!.name;
    const hit = (await f.read(M.adminN, "hr_list_employees", { department: dept.toUpperCase().slice(0, 4) })).data as { total: number };
    expect(hit.total).toBeGreaterThan(0);
    expect(((await f.read(M.adminN, "hr_list_employees", { department: "no such department" })).data as { total: number }).total).toBe(0);
  });

  it("the dashboard is for admins only, and inactive staff are not listed to non-admins", async () => {
    expect(await code(f.read(M.mgrS, "hr_get_dashboard", {}))).toBe("FORBIDDEN");
    await h.db.collection("employees").updateOne({ _id: new ObjectId(zed) }, { $set: { status: "inactive" } });
    expect(everything(await f.read(M.empN, "hr_list_employees", {}))).not.toContain("Zed Colleague");
    expect(await code(f.read(M.empN, "hr_get_employee", { employeeId: zed }))).toBe("NOT_FOUND");
    expect(everything(await f.read(M.adminN, "hr_list_employees", {}))).toContain("Zed Colleague");
    await h.db.collection("employees").updateOne({ _id: new ObjectId(zed) }, { $set: { status: "active" } });
  });

  it("errors never carry salary or date of birth", async () => {
    const errors: string[] = [];
    for (const [member, tool, args] of [[M.mgrS, "hr_preview_payroll", { employeeId: zed, period: "2026-09" }], [M.empN, "hr_get_employee", { employeeId: B.employee }], [M.mgrS, "hr_list_payslips", { employeeId: zed }]] as const) {
      try {
        await f.read(member, tool, args);
      } catch (e) {
        errors.push(String((e as Error).message));
      }
    }
    expect(errors.length).toBeGreaterThan(0);
    expect(hasSensitive(errors.join(" "), "admin", "mgr", "emp", "zed")).toBe(false);
  });
});

describe("payslips and payroll", () => {
  it("sensitive reads are unavailable without the switch, for every role", async () => {
    for (const key of ["adminN", "mgrN", "empN"]) {
      for (const tool of ["hr_list_payslips", "hr_get_payslip", "hr_payroll_summary", "hr_preview_payroll"]) expect(await code(f.read(M[key], tool, { period: "2026-09", payslipId: new ObjectId().toHexString() })), `${key} ${tool}`).toBe("UNAVAILABLE");
    }
  });

  it("an admin previews any employee; the figures are the payroll service's own, and nothing is generated", async () => {
    await h.db.collection("leave_requests").insertOne({ employeeId: E.empS, employeeName: "Emna Employee", departmentName: "x", leaveType: "unpaid", isPaid: false, startDate: "2026-09-07", endDate: "2026-09-08", days: 2, reason: "seed", status: "approved", companyId: T.companyA, createdAt: new Date(), updatedAt: new Date() });
    const direct = await hr.calculateEmployeePayrollPreview(E.empS, "2026-09", 22, C);
    const r = await f.read(M.adminS, "hr_preview_payroll", { employeeId: E.empS, period: "2026-09" });
    const d = r.data as { base: string; deduction: string; net: string; unpaidLeaveDays: string; existingPayslip: unknown };
    expect(d.base).toBe(`${direct.baseSalary.toFixed(2)} TND`);
    expect(d.deduction).toBe(`${direct.deduction.toFixed(2)} TND`);
    expect(d.net).toBe(`${direct.netSalary.toFixed(2)} TND`);
    expect(d.unpaidLeaveDays).toBe("2");
    expect(direct.unpaidLeaveDays).toBe(2);
    expect(await h.db.collection("payslips").countDocuments({})).toBe(0);
    // A bad period or working-day count never reaches the service: the tool schema rejects it (the test helper surfaces the raw schema error).
    expect(await code(f.read(M.adminS, "hr_preview_payroll", { employeeId: E.empS, period: "2026-13" }))).not.toBe("OK");
    expect(await code(f.read(M.adminS, "hr_preview_payroll", { employeeId: E.empS, period: "2026-09", workingDays: 40 }))).not.toBe("OK");
  });

  it("a manager or employee with the switch may preview and read only their own payroll", async () => {
    expect(await code(f.read(M.empS, "hr_preview_payroll", { period: "2026-09" }))).toBe("OK");
    expect(await code(f.read(M.empS, "hr_preview_payroll", { employeeId: E.empS, period: "2026-09" }))).toBe("OK");
    expect(await code(f.read(M.empS, "hr_preview_payroll", { employeeId: E.adminS, period: "2026-09" }))).toBe("FORBIDDEN");
    expect(await code(f.read(M.mgrS, "hr_preview_payroll", { employeeId: zed, period: "2026-09" }))).toBe("FORBIDDEN");
    expect(await code(f.read(M.empS, "hr_payroll_summary", { period: "2026-09" }))).toBe("FORBIDDEN");
  });

  it("payslips: own only for employees, all for admins, and an existing payslip is noted on the preview", async () => {
    await hr.generatePayslips("2026-08", [E.empS, E.mgrS], 22, C);
    const own = (await f.read(M.empS, "hr_list_payslips", { period: "2026-08" })).data as { payslips: { employee: string }[] };
    expect(own.payslips.map((p) => p.employee)).toEqual(["Emna Employee"]);
    const all = (await f.read(M.adminS, "hr_list_payslips", { period: "2026-08" })).data as { total: number };
    expect(all.total).toBe(2);
    const others = (await hr.getPayslips({ period: "2026-08", employeeId: E.mgrS }, C))[0];
    expect(await code(f.read(M.empS, "hr_get_payslip", { payslipId: others.id }))).toBe("NOT_FOUND");
    expect(await code(f.read(M.adminS, "hr_get_payslip", { payslipId: others.id }))).toBe("OK");
    const preview = (await f.read(M.adminS, "hr_preview_payroll", { employeeId: E.empS, period: "2026-08" })).data as { existingPayslip: { net: string } };
    expect(preview.existingPayslip.net).toBe(`${(await hr.getPayslips({ period: "2026-08", employeeId: E.empS }, C))[0].netSalary.toFixed(2)} TND`);
    const summary = (await f.read(M.adminS, "hr_payroll_summary", { period: "2026-08" })).data as { payslipsGenerated: number };
    expect(summary.payslipsGenerated).toBe(2);
  });

  it("there is no tool or command that generates, pays or deletes payroll", async () => {
    const names = (await import("@/server/ai/tools")).aiToolRegistry.all().map((t) => t.name).filter((n) => n.startsWith("hr_"));
    expect(names.filter((n) => /generate|pay_|mark|delete|create_employee|account|password/.test(n))).toEqual([]);
    expect(commandRegistry.all().filter((c) => c.module === "hr").map((c) => c.name).filter((n) => /generate|newemployee|createemployee|payrun|account/.test(n))).toEqual([]);
  });
});

describe("tenant isolation", () => {
  it("another company's employees, departments and payslips are not found, listed or editable", async () => {
    expect(await code(f.read(M.adminS, "hr_get_employee", { employeeId: B.employee }))).toBe("NOT_FOUND");
    expect(await code(f.read(M.adminS, "hr_get_leave_balance", { employeeId: B.employee }))).toBe("NOT_FOUND");
    expect(await code(f.read(M.adminS, "hr_preview_payroll", { employeeId: B.employee, period: "2026-09" }))).toBe("NOT_FOUND");
    expect(everything(await f.read(M.adminS, "hr_list_employees", {}))).not.toContain("Bella");
    expect(await code(f.propose(M.adminS, "hr_update_employee", { employeeId: B.employee, phone: "1" }))).toBe("NOT_FOUND");
    expect(await code(f.propose(M.adminS, "hr_update_department", { departmentId: B.department, name: "Hacked Dept" }))).toBe("NOT_FOUND");
    expect(await code(f.propose(M.adminS, "hr_submit_leave_request", { employeeId: B.employee, leaveType: "unpaid", startDate: "2026-12-14", endDate: "2026-12-15", reason: "Cross tenant" }))).toBe("NOT_FOUND");
    expect(await code(f.propose(M.adminS, "hr_update_employee", { employeeId: E.empS, departmentId: B.department }))).toBe("NOT_FOUND");
  });
});

describe("own-record reads", () => {
  it("leave balance, requests and attendance: employees see only their own, admins anyone", async () => {
    expect(await code(f.read(M.empN, "hr_get_leave_balance", { employeeId: E.empS }))).toBe("FORBIDDEN");
    expect(await code(f.read(M.empS, "hr_get_leave_balance", {}))).toBe("OK");
    expect(await code(f.read(M.adminS, "hr_get_leave_balance", { employeeId: E.empS }))).toBe("OK");
    await hr.createLeaveRequest({ employeeId: E.empS, leaveType: "annual", startDate: "2026-12-07", endDate: "2026-12-07", reason: "Own request", isPaid: true } as never, C);
    await hr.createLeaveRequest({ employeeId: E.mgrS, leaveType: "unpaid", startDate: "2026-12-07", endDate: "2026-12-07", reason: "Other request", isPaid: false } as never, C);
    const mine = (await f.read(M.empS, "hr_list_leave_requests", {})).data as { requests: { employee: string }[] };
    expect(mine.requests.every((r) => r.employee === "Emna Employee")).toBe(true);
    expect(mine.requests.length).toBeGreaterThan(0);
  });

  it("a non-admin asking for another employee's leave requests or attendance is refused", async () => {
    expect(await code(f.read(M.empS, "hr_list_leave_requests", { employeeId: E.mgrS }))).toBe("FORBIDDEN");
    expect(await code(f.read(M.empS, "hr_list_attendance", { employeeId: E.mgrS }))).toBe("FORBIDDEN");
    await hr.checkInEmployee(E.mgrS, C);
    const today = (await f.read(M.empS, "hr_today_attendance", {})).data as { today: unknown };
    expect(today.today).toBeNull();
    const roster = (await f.read(M.adminS, "hr_today_attendance", {})).data as { present: number };
    expect(roster.present).toBeGreaterThanOrEqual(1);
  });
});

describe("who can write", () => {
  it("managers and employees cannot propose any HR write, and their AI grant cannot even be saved with write cells", async () => {
    const writes = ["hr_create_department", "hr_update_employee", "hr_submit_leave_request", "hr_approve_leave_request", "hr_adjust_leave_balance"];
    const args: Record<string, unknown> = { hr_create_department: { name: "Nope Dept" }, hr_update_employee: { employeeId: E.empS, phone: "1" }, hr_submit_leave_request: { employeeId: E.mgrS, leaveType: "unpaid", startDate: "2026-12-10", endDate: "2026-12-11", reason: "Nope nope" }, hr_approve_leave_request: { requestId: new ObjectId().toHexString() }, hr_adjust_leave_balance: { employeeId: E.mgrS, days: 5, reason: "Nope nope" } };
    for (const key of ["mgrS", "mgrN", "empS", "empN"]) for (const w of writes) expect(await code(f.propose(M[key], w, args[w])), `${key} ${w}`).toBe("FORBIDDEN");
    const owner = actorOf(h, T.A.owner);
    const manager = await seedMember(h.db, T.companyA, "manager");
    expect(await code(saveMemberGrant(owner, manager.userId.toHexString(), grant({ hr: { ...VIEW, create: true } }, false), 0))).not.toBe("OK");
    expect(await code(saveMemberGrant(owner, manager.userId.toHexString(), grant({ hr: { ...VIEW, approve: true } }, false), 0))).not.toBe("OK");
    for (const cmd of ["newdepartment", "editemployee", "submitleave", "approveleave", "adjustleave"]) expect(await code(f.step(M.mgrS, { command: cmd, step: "start", args: {} })), cmd).not.toBe("OK");
  });

  it("an admin without any HR write grant cell cannot propose either", async () => {
    const view = await seedMember(h.db, T.companyA, "admin");
    await saveMemberGrant(actorOf(h, T.A.owner), view.userId.toHexString(), grant({ hr: VIEW }, false), 0);
    expect(await code(f.propose(view, "hr_create_department", { name: "Nope Dept" }))).toBe("FORBIDDEN");
  });

  it("employee creation is not possible through AI at all", async () => {
    expect(commandRegistry.get("newemployee")).toBeUndefined();
    expect(await code(f.propose(M.adminS, "hr_create_employee", { fullName: "Ghost Person" }))).not.toBe("OK");
    const before = await h.db.collection("users").countDocuments({});
    expect(before).toBeGreaterThan(0);
  });
});

describe("employees: only four fields can change, and the rest of the record is never touched or stored", () => {
  it("edits name, phone, job title and department with a precise diff; salary, role, email, dob and status stay as they were", async () => {
    const before = (await hr.getEmployeeById(E.empS, C))!;
    const p = await f.propose(M.adminS, "hr_update_employee", { employeeId: E.empS, fullName: "Emna Employee-Ben", phone: "20 999 999", departmentId: D2 });
    expect(p.details.map((d) => d.label)).toEqual(["Name", "Phone", "Department"]);
    expect(p.details[0]).toMatchObject({ before: "Emna Employee", after: "Emna Employee-Ben" });
    const stored = JSON.stringify(await pendingDocs());
    expect(hasSensitive(stored, "admin", "mgr", "emp", "zed")).toBe(false); // salary and date of birth are not in the proposal
    await f.confirm(M.adminS, p.id);
    const after = (await hr.getEmployeeById(E.empS, C))!;
    expect(after).toMatchObject({ fullName: "Emna Employee-Ben", phone: "20 999 999", departmentId: D2, baseSalary: before.baseSalary, role: before.role, email: before.email, status: before.status, dateOfBirth: before.dateOfBirth, hireDate: before.hireDate, leaveAllowance: before.leaveAllowance });
  });

  it("refuses fields it does not own, unknown titles and departments, and no-ops", async () => {
    for (const extra of [{ baseSalary: 9000 }, { role: "hr_admin" }, { email: "x@y.test" }, { status: "inactive" }, { dateOfBirth: "2000-01-01" }, { password: "x" }]) expect(await code(f.propose(M.adminS, "hr_update_employee", { employeeId: E.empS, ...extra })), JSON.stringify(extra)).toBe("VALIDATION_ERROR");
    expect(await code(f.propose(M.adminS, "hr_update_employee", { employeeId: E.empS, jobTitle: "Chief Wizard" }))).toBe("VALIDATION_ERROR");
    expect(await code(f.propose(M.adminS, "hr_update_employee", { employeeId: E.empS, departmentId: new ObjectId().toHexString() }))).toBe("NOT_FOUND");
    expect(await code(f.propose(M.adminS, "hr_update_employee", { employeeId: E.empS, phone: "20 999 999" }))).toBe("VALIDATION_ERROR");
  });

  it("a record changed after the proposal is not overwritten", async () => {
    const p = await f.propose(M.adminS, "hr_update_employee", { employeeId: E.mgrS, phone: "20 111 111" });
    await hr.updateEmployee(E.mgrS, employeeSchema.parse({ ...(await hr.getEmployeeById(E.mgrS, C)), dateOfBirth: DOB.mgr, phone: "20 222 222", isCustomJobTitle: false }), C);
    expect(await code(f.confirm(M.adminS, p.id))).toBe("CONFLICT");
    expect((await hr.getEmployeeById(E.mgrS, C))?.phone).toBe("20 222 222");
  });

  it("the edit form and AI draft never contain salary or date of birth", async () => {
    const form = kind(await f.parts(M.adminS, { command: "editemployee", step: "select", args: { employeeId: E.empS } }), "form");
    expect(form.fields.map((x) => x.name)).toEqual(["fullName", "phone", "jobTitle", "departmentId"]);
    expect(hasSensitive(JSON.stringify(form), "admin", "mgr", "emp", "zed")).toBe(false);
    const { complete, calls } = llm({ target: { search: "Emna" }, values: { phone: stated("20 555 555", "20 555 555") } });
    const draft = kind(await f.parts(M.adminS, { command: "editemployee", step: "draft", args: {}, draft: { text: "Change Emna's phone to 20 555 555", provenance: {} } }, complete), "form");
    expect(fieldValue(draft, "phone")).toBe("20 555 555");
    expect(hasSensitive(JSON.stringify(draft) + JSON.stringify(calls.mock.calls), "admin", "mgr", "emp", "zed")).toBe(false); // not in the model prompt either
  });
});

describe("departments and job titles", () => {
  it("create and rename go through a preview; duplicates, stale edits and literal names are handled", async () => {
    expect(await code(f.propose(M.adminS, "hr_create_department", { name: (await hr.getDepartments(C))[0].name.toUpperCase() }))).toBe("CONFLICT");
    const p = await f.propose(M.adminS, "hr_create_department", { name: "Field Ops (EMEA) [new]", description: "Regional teams" });
    await f.confirm(M.adminS, p.id);
    const dep = (await hr.getDepartments(C)).find((d) => d.name === "Field Ops (EMEA) [new]")!;
    const edit = await f.propose(M.adminS, "hr_update_department", { departmentId: dep.id, name: "Field Operations" });
    expect(edit.details).toEqual([{ label: "Name", before: "Field Ops (EMEA) [new]", after: "Field Operations" }]);
    await hr.updateDepartment(dep.id, "Changed Elsewhere", "x", C);
    expect(await code(f.confirm(M.adminS, edit.id))).toBe("CONFLICT");
    expect((await hr.getDepartments(C)).some((d) => d.name === "Changed Elsewhere")).toBe(true);
  });

  it("a job title rename warns how many people it renames; an unknown department is refused", async () => {
    await f.confirm(M.adminS, (await f.propose(M.adminS, "hr_create_job_title", { title: "Data Steward", departmentId: D1 })).id);
    const title = (await hr.getJobTitles(C)).find((t) => t.title === "Data Steward")!;
    const analyst = (await hr.getJobTitles(C)).find((t) => t.title === "Analyst")!;
    const p = await f.propose(M.adminS, "hr_update_job_title", { jobTitleId: analyst.id, title: "Senior Analyst" });
    expect(p.details.some((d) => d.label === "Staff affected")).toBe(true);
    expect(await code(f.propose(M.adminS, "hr_update_job_title", { jobTitleId: title.id, departmentId: B.department }))).toBe("NOT_FOUND");
    expect(await code(f.propose(M.adminS, "hr_create_job_title", { title: "data steward" }))).toBe("CONFLICT");
  });
});

describe("leave workflow", () => {
  const submit = (extra: object = {}) => ({ employeeId: E.empS, leaveType: "annual", startDate: "2027-03-15", endDate: "2027-03-17", reason: "Family trip", ...extra });

  it("submit: working days are counted by the service, the preview shows the balance, overlap and overdraft are refused", async () => {
    const before = await bal(E.empS, 2027);
    const p = await f.propose(M.adminS, "hr_submit_leave_request", submit());
    expect(p.requiresTyped).toBe(false);
    expect(p.details.find((d) => d.label === "Working days")?.after).toBe("3");
    expect(p.details.find((d) => d.label === "Balance")?.before).toBe(`${before} days available`);
    await f.confirm(M.adminS, p.id);
    const created = (await hr.getLeaveRequests({ employeeId: E.empS, status: "pending" }, C)).find((r) => r.startDate === "2027-03-15")!;
    expect(created).toMatchObject({ days: 3, isPaid: true, status: "pending" });
    expect(await bal(E.empS, 2027)).toBe(before); // a pending request reserves nothing
    expect(await code(f.propose(M.adminS, "hr_submit_leave_request", submit({ startDate: "2027-03-16", endDate: "2027-03-18" })))).toBe("CONFLICT");
    expect(await code(f.propose(M.adminS, "hr_submit_leave_request", submit({ startDate: "2027-05-03", endDate: "2027-12-31" })))).toBe("VALIDATION_ERROR"); // more than the balance
    expect(await code(f.propose(M.adminS, "hr_submit_leave_request", submit({ startDate: "2027-02-30", endDate: "2027-03-01" })))).toBe("VALIDATION_ERROR");
    expect(await code(f.propose(M.adminS, "hr_submit_leave_request", submit({ startDate: "2027-06-10", endDate: "2027-06-01" })))).toBe("VALIDATION_ERROR");
    expect(await code(f.propose(M.adminS, "hr_submit_leave_request", submit({ startDate: "2027-06-05", endDate: "2027-06-06" })))).toBe("VALIDATION_ERROR"); // a weekend
  });

  it("approve: typed with the employee's name, reserves exactly the days, and cannot be repeated or concurrent", async () => {
    const req = (await hr.getLeaveRequests({ employeeId: E.empS, status: "pending" }, C)).find((r) => r.startDate === "2027-03-15")!;
    const before = await bal(E.empS, 2027);
    const p = await f.propose(M.adminS, "hr_approve_leave_request", { requestId: req.id });
    expect(p).toMatchObject({ risk: "financial", requiresTyped: true, typedPhrase: "Emna Employee-Ben" });
    expect(p.details.find((d) => d.label === "Available balance")).toMatchObject({ before: `${before} days`, after: `${before - 3} days` });
    expect(await code(f.confirm(M.adminS, p.id, "someone else"))).toBe("VALIDATION_ERROR");
    const results = await Promise.all([1, 2, 3].map(() => code(f.confirm(M.adminS, p.id, "Emna Employee-Ben"))));
    expect(results.filter((r) => r === "OK")).toHaveLength(1);
    expect(await bal(E.empS, 2027)).toBe(before - 3);
    expect(await code(f.propose(M.adminS, "hr_approve_leave_request", { requestId: req.id }))).toBe("INVALID_TRANSITION");
    expect(await code(f.propose(M.adminS, "hr_reject_leave_request", { requestId: req.id }))).toBe("INVALID_TRANSITION");
  });

  it("a request decided elsewhere after the proposal stops the confirmation; nothing is reserved twice", async () => {
    const r = await hr.createLeaveRequest({ employeeId: E.empS, leaveType: "annual", startDate: "2027-04-12", endDate: "2027-04-12", reason: "Appointment", isPaid: true } as never, C);
    const p = await f.propose(M.adminS, "hr_approve_leave_request", { requestId: r.id });
    await hr.reviewLeaveRequest({ requestId: r.id, action: "approve" }, "Someone", C);
    const before = await bal(E.empS, 2027);
    expect(await code(f.confirm(M.adminS, p.id, p.typedPhrase!))).not.toBe("OK");
    expect(await bal(E.empS, 2027)).toBe(before);
  });

  it("an overdraft needs an override reason from the person, then is recorded", async () => {
    const r = await hr.createLeaveRequest({ employeeId: E.mgrS, leaveType: "annual", startDate: "2027-05-10", endDate: "2027-05-10", reason: "Moving house", isPaid: true } as never, C);
    await h.db.collection("leave_transactions").insertOne({ companyId: T.companyA, employeeId: E.mgrS, transactionType: "ADJUSTMENT", days: -1000, effectiveDate: "2026-01-01", description: "drain", createdBy: "test", createdAt: new Date() });
    const room = await bal(E.mgrS, 2027);
    await h.db.collection("leave_requests").updateOne({ _id: new ObjectId(r.id) }, { $set: { days: Math.max(1, room + 2) } });
    expect(await code(f.propose(M.adminS, "hr_approve_leave_request", { requestId: r.id }))).toBe("VALIDATION_ERROR");
    const p = await f.propose(M.adminS, "hr_approve_leave_request", { requestId: r.id, overrideReason: "Director approved an advance" });
    expect(p.details.some((d) => d.label === "Override reason")).toBe(true);
    await f.confirm(M.adminS, p.id, p.typedPhrase!);
    expect((await hr.getLeaveRequests({ employeeId: E.mgrS }, C)).find((x) => x.id === r.id)?.status).toBe("approved");
    expect(await h.db.collection("leave_transactions").countDocuments({ referenceId: r.id, transactionType: "ADJUSTMENT" })).toBe(1);
  });

  it("reject and cancel: rejecting changes nothing in the balance, cancelling an approved paid leave releases its days", async () => {
    const r = await hr.createLeaveRequest({ employeeId: E.empS, leaveType: "annual", startDate: "2027-06-14", endDate: "2027-06-14", reason: "Not needed", isPaid: true } as never, C);
    const before = await bal(E.empS, 2027);
    const reject = await f.propose(M.adminS, "hr_reject_leave_request", { requestId: r.id, adminComment: "Busy period" });
    expect(reject.requiresTyped).toBe(false);
    await f.confirm(M.adminS, reject.id);
    expect(await bal(E.empS, 2027)).toBe(before);
    expect(await code(f.propose(M.adminS, "hr_cancel_leave_request", { requestId: r.id, reason: "too late" }))).toBe("INVALID_TRANSITION");

    const approved = (await hr.getLeaveRequests({ employeeId: E.empS, status: "approved" }, C)).find((x) => x.startDate === "2027-03-15")!;
    const reserved = await bal(E.empS, 2027);
    const cancel = await f.propose(M.adminS, "hr_cancel_leave_request", { requestId: approved.id, reason: "Trip postponed" });
    expect(cancel.details.some((d) => d.label === "Balance" && d.after.includes("released"))).toBe(true);
    await f.confirm(M.adminS, cancel.id);
    expect(await bal(E.empS, 2027)).toBe(reserved + 3);
    expect(await code(f.propose(M.adminS, "hr_cancel_leave_request", { requestId: approved.id, reason: "again" }))).toBe("INVALID_TRANSITION");
  });

  it("the guided flow: approve picker offers pending requests only and asks for the override reason only when needed", async () => {
    const r = await hr.createLeaveRequest({ employeeId: E.empS, leaveType: "unpaid", startDate: "2027-07-12", endDate: "2027-07-12", reason: "Personal", isPaid: false } as never, C);
    const picker = await f.parts(M.adminS, { command: "approveleave", step: "start", args: {} });
    expect(JSON.stringify(picker)).toContain(r.id);
    const review = kind(await f.parts(M.adminS, { command: "approveleave", step: "select", args: { requestId: r.id } }), "confirmation");
    expect(review).toMatchObject({ risk: "financial", requiresTyped: true });
  });
});

describe("manual leave adjustments", () => {
  it("typed with the signed days; before and after are shown; bounds and stale balances are enforced", async () => {
    const before = await bal(E.empS);
    const p = await f.propose(M.adminS, "hr_adjust_leave_balance", { employeeId: E.empS, days: "+2", reason: "Worked a public holiday" });
    expect(p).toMatchObject({ risk: "financial", requiresTyped: true, typedPhrase: "+2 days" });
    expect(p.details.find((d) => d.label === "Available balance")).toMatchObject({ before: `${before} days`, after: `${before + 2} days` });
    expect(await code(f.confirm(M.adminS, p.id, "2 days"))).toBe("VALIDATION_ERROR");
    await f.confirm(M.adminS, p.id, "+2 days");
    expect(await bal(E.empS)).toBe(before + 2);
    const tx = (await hr.getLeaveTransactions({ employeeId: E.empS }, C)).find((t) => t.description.includes("Worked a public holiday"))!;
    expect(tx).toMatchObject({ transactionType: "ADJUSTMENT", days: 2 });

    const stale = await f.propose(M.adminS, "hr_adjust_leave_balance", { employeeId: E.empS, days: -1, reason: "Correction needed" });
    await hr.createManualAdjustment({ employeeId: E.empS, days: 1, reason: "Another admin" }, "u", "Other", C);
    expect(await code(f.confirm(M.adminS, stale.id, stale.typedPhrase!))).toBe("CONFLICT");

    const bad = (days: unknown, reason = "A good reason") => code(f.propose(M.adminS, "hr_adjust_leave_balance", { employeeId: E.empS, days, reason }));
    expect(await bad(0)).toBe("VALIDATION_ERROR");
    expect(await bad("1.3")).toBe("VALIDATION_ERROR");
    expect(await bad(61)).toBe("VALIDATION_ERROR");
    expect(await bad("abc")).toBe("VALIDATION_ERROR");
    expect(await bad(1, "no")).toBe("VALIDATION_ERROR");
    expect(await code(f.propose(M.adminS, "hr_adjust_leave_balance", { employeeId: B.employee, days: 1, reason: "Cross tenant" }))).toBe("NOT_FOUND");
  });
});

describe("AI-assisted entry and revocation", () => {
  it("a leave request described in words: the employee is found, dates are stated, an assumed type is asked about", async () => {
    const { complete } = llm({
      values: { employeeId: stated("Emna", "Emna"), startDate: stated("2027-08-02", "2027-08-02"), endDate: stated("2027-08-03", "2027-08-03"), reason: stated("Family wedding", "family wedding"), leaveType: { value: "annual", basis: "assumed" } },
    });
    const draft = kind(await f.parts(M.adminS, { command: "submitleave", step: "draft", args: {}, draft: { text: "Emna needs leave 2027-08-02 to 2027-08-03 for a family wedding", provenance: {} } }, complete), "form");
    expect(fieldValue(draft, "employeeId")).toBe(E.empS);
    expect(draft.draft!.provenance.employeeId).toBe("found");
    expect(fieldValue(draft, "leaveType")).toBe("");
    expect(draft.draft!.questions.some((q) => q.field === "leaveType")).toBe(true);
    const ok = { ...formValues(draft), leaveType: "annual" };
    const review = kind(await f.parts(M.adminS, { command: "submitleave", step: "submit", args: draft.context, values: ok }), "confirmation");
    expect(review.summary).toContain("2 working days");
  });

  it("a balance adjustment in words: the days must be stated; the employee is never assumed", async () => {
    const { complete } = llm({ values: { employeeId: { value: "Emna", basis: "assumed" }, days: { value: 3, basis: "assumed" }, reason: stated("overtime", "overtime") } });
    const draft = kind(await f.parts(M.adminS, { command: "adjustleave", step: "draft", args: {}, draft: { text: "give some days for overtime", provenance: {} } }, complete), "form");
    expect(fieldValue(draft, "employeeId")).toBe("");
    expect(fieldValue(draft, "days")).toBe("");
    expect(draft.draft!.questions.map((q) => q.field)).toEqual(expect.arrayContaining(["employeeId", "days"]));
  });

  it("revoking the approve cell after a proposal cancels the confirmation", async () => {
    const r = await hr.createLeaveRequest({ employeeId: E.empS, leaveType: "unpaid", startDate: "2027-09-06", endDate: "2027-09-06", reason: "Revocation test", isPaid: false } as never, C);
    const p = await f.propose(M.adminS, "hr_approve_leave_request", { requestId: r.id });
    const owner = actorOf(h, T.A.owner);
    const cur = await h.db.collection("ai_access_grants").findOne({ userId: M.adminS.userId });
    await saveMemberGrant(owner, M.adminS.userId.toHexString(), grant({ hr: { ...ALL, approve: false } }, true), Number(cur?.version ?? 0));
    expect(await code(f.confirm(M.adminS, p.id, p.typedPhrase!))).not.toBe("OK");
    expect((await hr.getLeaveRequests({ employeeId: E.empS }, C)).find((x) => x.id === r.id)?.status).toBe("pending");
    const again = await h.db.collection("ai_access_grants").findOne({ userId: M.adminS.userId });
    await saveMemberGrant(owner, M.adminS.userId.toHexString(), grant({ hr: ALL }, true), Number(again?.version ?? 0));
  });

  it("revoking the sensitive switch removes payroll commands and tools at the next step", async () => {
    const owner = actorOf(h, T.A.owner);
    expect(await code(f.step(M.adminS, { command: "payrollpreview", step: "start", args: {} }))).toBe("OK");
    const cur = await h.db.collection("ai_access_grants").findOne({ userId: M.adminS.userId });
    await saveMemberGrant(owner, M.adminS.userId.toHexString(), grant({ hr: ALL }, false), Number(cur?.version ?? 0));
    expect(await code(f.step(M.adminS, { command: "payrollpreview", step: "start", args: {} }))).not.toBe("OK");
    expect(await code(f.read(M.adminS, "hr_preview_payroll", { employeeId: E.empS, period: "2026-09" }))).toBe("UNAVAILABLE");
    const again = await h.db.collection("ai_access_grants").findOne({ userId: M.adminS.userId });
    await saveMemberGrant(owner, M.adminS.userId.toHexString(), grant({ hr: ALL }, true), Number(again?.version ?? 0));
  });
});
