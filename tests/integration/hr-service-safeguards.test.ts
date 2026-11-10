import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createHarness, type TestHarness } from "../helpers/workspace";
import { employeeSchema } from "@/features/hr/schemas/hr.schema";
import * as hr from "@/server/services/hr.service";

const shared = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/server/db/client", () => ({ default: Promise.resolve({ db: () => shared.db }) }));

let h: TestHarness;
let C: string;
let D: string;
let ana: string;
let ben: string;
const ledger = async (type: string, referenceId?: string) => h.db.collection("leave_transactions").countDocuments({ companyId: h.ctx().companyId, transactionType: type, ...(referenceId ? { referenceId } : {}) });
const code = async (p: Promise<unknown>) => (await p.then(() => "OK", (e: Error) => e.message));

async function mkEmployee(name: string, salary: number) {
  const input = employeeSchema.parse({ fullName: name, email: `${name.toLowerCase().replace(/\W+/g, ".")}@svc.test`, phone: "", departmentId: D, jobTitle: "Analyst", hireDate: "2026-01-05", dateOfBirth: "1990-04-02", baseSalary: salary, role: "employee", status: "active", leaveAllowance: 25 });
  return (await hr.createEmployee(input, C)).id;
}
const request = (employeeId: string, startDate: string, endDate: string, extra: object = {}) =>
  hr.createLeaveRequest({ employeeId, leaveType: "annual", startDate, endDate, reason: "Family event", isPaid: true, ...extra } as never, C);

beforeAll(async () => {
  h = await createHarness();
  shared.db = h.db;
  C = h.ctx().companyId.toHexString();
  await hr.seedHrDefaultsForCompany(C);
  D = (await hr.getDepartments(C))[0].id;
  ana = await mkEmployee("Ana Service", 2200);
  ben = await mkEmployee("Ben Service", 1500);
  await hr.createManualAdjustment({ employeeId: ana, days: 30, reason: "Test balance" }, "u", "Test", C);
});
afterAll(async () => {
  await h.cleanup();
});

describe("leave review is decided exactly once", () => {
  it("a second approval or a later rejection is refused and reserves nothing more", async () => {
    const r = await request(ana, "2026-12-14", "2026-12-15");
    await hr.reviewLeaveRequest({ requestId: r.id, action: "approve" }, "Admin", C);
    expect(await ledger("RESERVATION", r.id)).toBe(1);
    expect(await code(hr.reviewLeaveRequest({ requestId: r.id, action: "approve" }, "Admin", C))).toMatch(/Only pending/);
    expect(await code(hr.reviewLeaveRequest({ requestId: r.id, action: "reject" }, "Admin", C))).toMatch(/Only pending/);
    expect(await ledger("RESERVATION", r.id)).toBe(1);
    expect((await hr.getLeaveRequests({ employeeId: ana }, C)).find((x) => x.id === r.id)?.status).toBe("approved");
  });

  it("two concurrent approvals: exactly one wins and exactly one reservation is posted", async () => {
    const r = await request(ana, "2026-12-21", "2026-12-22");
    const results = await Promise.all([1, 2, 3].map(() => hr.reviewLeaveRequest({ requestId: r.id, action: "approve" }, "Admin", C).then(() => "OK", () => "REFUSED")));
    expect(results.filter((x) => x === "OK")).toHaveLength(1);
    expect(await ledger("RESERVATION", r.id)).toBe(1);
  });

  it("a non-admin actor cannot review or adjust, and the record is untouched", async () => {
    const r = await request(ana, "2027-01-11", "2027-01-12");
    expect(await code(hr.reviewLeaveRequest({ requestId: r.id, action: "approve" }, "Mgr", C, { isAdmin: false }))).toMatch(/Forbidden/);
    expect(await code(hr.createManualAdjustment({ employeeId: ana, days: 1, reason: "nope nope" }, "u", "Mgr", C, { isAdmin: false }))).toMatch(/Forbidden/);
    expect((await hr.getLeaveRequests({ employeeId: ana }, C)).find((x) => x.id === r.id)?.status).toBe("pending");
  });
});

describe("leave cancellation", () => {
  it("releases an approved paid reservation once, even when cancelled repeatedly", async () => {
    const r = await request(ana, "2027-02-08", "2027-02-09");
    await hr.reviewLeaveRequest({ requestId: r.id, action: "approve" }, "Admin", C);
    const results = await Promise.all([1, 2, 3].map(() => hr.cancelLeaveRequest(r.id, "Plans changed", "Admin", C).then(() => "OK", () => "REFUSED")));
    expect(results.filter((x) => x === "OK")).toHaveLength(1);
    expect(await ledger("RELEASE", r.id)).toBe(1);
  });

  it("rejected and taken requests cannot be cancelled", async () => {
    const rejected = await request(ana, "2027-03-08", "2027-03-09");
    await hr.reviewLeaveRequest({ requestId: rejected.id, action: "reject" }, "Admin", C);
    expect(await code(hr.cancelLeaveRequest(rejected.id, "why not", "Admin", C))).toMatch(/cannot be cancelled/);
    await h.db.collection("leave_requests").updateOne({ _id: new ObjectId(rejected.id) }, { $set: { status: "taken" } });
    expect(await code(hr.cancelLeaveRequest(rejected.id, "why not", "Admin", C))).toMatch(/cannot be cancelled/);
  });

  it("a non-admin can cancel only their own request", async () => {
    const mine = await request(ben, "2027-04-05", "2027-04-06", { leaveType: "unpaid", isPaid: false });
    expect(await code(hr.cancelLeaveRequest(mine.id, "not mine", "Ana", C, { isAdmin: false, employeeId: ana }))).toMatch(/only cancel your own/);
    expect(await code(hr.cancelLeaveRequest(mine.id, "my own plan", "Ben", C, { isAdmin: false, employeeId: ben }))).toBe("OK");
  });
});

describe("payroll preview counts all the unpaid leave of the month", () => {
  const unpaid = (employeeId: string, startDate: string, endDate: string, status: string) =>
    h.db.collection("leave_requests").insertOne({ employeeId, employeeName: "x", departmentName: "x", leaveType: "unpaid", isPaid: false, startDate, endDate, days: 1, reason: "seed", status, companyId: h.ctx().companyId, createdAt: new Date(), updatedAt: new Date() });

  it("deducts approved and already-taken unpaid leave, prorated by the service's own daily rate", async () => {
    await unpaid(ben, "2026-05-04", "2026-05-05", "approved"); // Mon-Tue: 2 days
    await unpaid(ben, "2026-05-11", "2026-05-11", "taken"); // 1 day, already marked taken
    await unpaid(ben, "2026-05-18", "2026-05-18", "pending"); // not decided: no deduction
    await unpaid(ben, "2026-05-19", "2026-05-19", "rejected");
    const p = await hr.calculateEmployeePayrollPreview(ben, "2026-05", 22, C);
    expect(p.unpaidLeaveDays).toBe(3);
    expect(p.dailyRate).toBe(68.18); // 1500 / 22
    expect(p.deduction).toBe(204.54);
    expect(p.netSalary).toBe(1295.46);
  });

  it("a leave that starts before the month and ends after it still counts for the days inside", async () => {
    await unpaid(ana, "2026-08-20", "2026-10-10", "approved");
    const p = await hr.calculateEmployeePayrollPreview(ana, "2026-09", 22, C);
    expect(p.unpaidLeaveDays).toBe(22); // every business day of September 2026
  });

  it("paid leave never reduces pay", async () => {
    const r = await request(ana, "2026-12-28", "2026-12-29");
    await hr.reviewLeaveRequest({ requestId: r.id, action: "approve" }, "Admin", C);
    expect((await hr.calculateEmployeePayrollPreview(ana, "2026-12", 22, C)).unpaidLeaveDays).toBe(0);
  });
});

describe("generating payslips twice does not duplicate them", () => {
  it("one payslip per employee and period (generation itself stays a manual HR operation)", async () => {
    await hr.generatePayslips("2026-06", [ben], 22, C);
    await hr.generatePayslips("2026-06", [ben], 22, C);
    expect((await hr.getPayslips({ period: "2026-06", employeeId: ben }, C))).toHaveLength(1);
  });
});

describe("names are matched literally, not as patterns", () => {
  it("job titles and departments with regex characters work and cannot match others", async () => {
    const t = await hr.ensureJobTitle("C++ Engineer (II)", D, false, C);
    expect(t.title).toBe("C++ Engineer (II)");
    expect((await hr.ensureJobTitle("C++ Engineer (II)", D, false, C)).id).toBe(t.id);
    await expect(hr.createDepartment("R&D (.*)", undefined, C)).resolves.toBeTruthy();
    expect((await hr.getEmployees({ search: ".*" }, C)).length).toBe(0); // a literal ".*", not "match everything"
    expect((await hr.getEmployees({ search: "ana service" }, C)).length).toBe(1);
  });
});

describe("approved future leave is reserved from the balance immediately", () => {
  const avail = async (id: string) => (await hr.getSoldeDeConge(id, 2027, C)).available;
  it("a reservation counts on approval, a release gives exactly its own days back, and one reservation never cancels another", async () => {
    const who = await mkEmployee("Carl Ledger", 1800);
    await hr.createManualAdjustment({ employeeId: who, days: 20, reason: "Test balance" }, "u", "Test", C);
    const start = await avail(who);
    const a = await request(who, "2027-09-06", "2027-09-08"); // 3 days
    const b = await request(who, "2027-10-04", "2027-10-05"); // 2 days
    await hr.reviewLeaveRequest({ requestId: a.id, action: "approve" }, "Admin", C);
    expect(await avail(who)).toBe(start - 3);
    await hr.reviewLeaveRequest({ requestId: b.id, action: "approve" }, "Admin", C);
    expect(await avail(who)).toBe(start - 5);
    await hr.cancelLeaveRequest(a.id, "Plans changed", "Admin", C);
    expect(await avail(who)).toBe(start - 2); // only a's 3 days came back, b stays reserved
  });

  it("the overdraft check sees leave that is already approved for later dates", async () => {
    const who = await mkEmployee("Dora Ledger", 1800);
    const first = await avail(who);
    const big = await request(who, "2027-11-01", "2027-11-05"); // 5 working days
    await hr.createManualAdjustment({ employeeId: who, days: 5 - first, reason: "Exactly five days" }, "u", "Test", C);
    await hr.reviewLeaveRequest({ requestId: big.id, action: "approve" }, "Admin", C);
    expect(await avail(who)).toBe(0);
    const another = await h.db.collection("leave_requests").insertOne({ employeeId: who, employeeName: "Dora Ledger", departmentName: "x", leaveType: "annual", isPaid: true, startDate: "2027-12-06", endDate: "2027-12-06", days: 1, reason: "Second leave", status: "pending", companyId: h.ctx().companyId, createdAt: new Date(), updatedAt: new Date() });
    expect(await code(hr.reviewLeaveRequest({ requestId: another.insertedId.toString(), action: "approve" }, "Admin", C))).toMatch(/Insufficient/);
  });
});

describe("job-title lookups are company-scoped", () => {
  it("employees of another company with the same title never appear, and the company id is required", async () => {
    const other = h.otherTenant().companyId.toHexString();
    await hr.seedHrDefaultsForCompany(other);
    const depB = (await hr.getDepartments(other))[0].id;
    await hr.createEmployee(employeeSchema.parse({ fullName: "Bella Other", email: "bella@other.svc.test", phone: "", departmentId: depB, jobTitle: "Analyst", hireDate: "2026-01-05", dateOfBirth: "1980-01-01", baseSalary: 9999, role: "employee", status: "active", leaveAllowance: 25 }), other);
    const mine = await hr.getEmployeesByJobTitle("Analyst", C);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.map((e) => e.fullName)).not.toContain("Bella Other");
    expect((await hr.getEmployeesByJobTitle("analyst", other)).map((e) => e.fullName)).toEqual(["Bella Other"]);
    await expect(hr.getEmployeesByJobTitle("Analyst", "not-an-id")).rejects.toThrow();
  });
});

describe("paid payslips are protected", () => {
  it("regenerating a period leaves a paid payslip exactly as it was, and still refreshes unpaid ones", async () => {
    const paid = await mkEmployee("Paula Paid", 2000);
    const open = await mkEmployee("Olga Open", 2000);
    await hr.generatePayslips("2026-03", [paid, open], 22, C);
    await h.db.collection("payslips").updateOne({ employeeId: paid, period: "2026-03" }, { $set: { status: "paid" } });
    await h.db.collection("employees").updateOne({ _id: new ObjectId(paid) }, { $set: { baseSalary: 2500 } });
    await h.db.collection("employees").updateOne({ _id: new ObjectId(open) }, { $set: { baseSalary: 2500 } });
    const again = await hr.generatePayslips("2026-03", [paid, open], 22, C);
    const slip = (await hr.getPayslips({ period: "2026-03", employeeId: paid }, C))[0];
    expect(slip).toMatchObject({ status: "paid", baseSalary: 2000 });
    expect(again.find((p) => p.employeeId === paid)).toMatchObject({ status: "paid", baseSalary: 2000 });
    expect((await hr.getPayslips({ period: "2026-03", employeeId: open }, C))[0].baseSalary).toBe(2500);
    expect(await hr.getPayslips({ period: "2026-03", employeeId: paid }, C)).toHaveLength(1);
  });

  it("the explicit correction path recomputes the amounts, keeps the payslip paid and records the correction", async () => {
    const paid = await mkEmployee("Pia Paid", 2000);
    await hr.generatePayslips("2026-04", [paid], 22, C);
    await h.db.collection("payslips").updateOne({ employeeId: paid, period: "2026-04" }, { $set: { status: "paid" } });
    await h.db.collection("employees").updateOne({ _id: new ObjectId(paid) }, { $set: { baseSalary: 2600 } });
    await hr.generatePayslips("2026-04", [paid], 22, C, { allowPaidCorrection: true });
    const slip = (await hr.getPayslips({ period: "2026-04", employeeId: paid }, C))[0];
    expect(slip).toMatchObject({ status: "paid", baseSalary: 2600 });
    expect((await h.db.collection("payslips").findOne({ employeeId: paid, period: "2026-04" }))?.correctedAt).toBeInstanceOf(Date);
  });
});

describe("weekend-only leave is not charged a day", () => {
  it("a weekend-only request is refused; weekday and month-spanning requests count real working days", async () => {
    const who = await mkEmployee("Walt Weekend", 1800);
    expect(await code(request(who, "2027-06-05", "2027-06-06"))).toMatch(/zero working days/);
    expect(await code(request(who, "2027-06-05", "2027-06-05", { halfDayOption: "morning" }))).toMatch(/zero working days/);
    const normal = await request(who, "2027-06-14", "2027-06-16");
    expect(normal.days).toBe(3);
    const span = await request(who, "2027-06-30", "2027-07-06", { leaveType: "unpaid", isPaid: false }); // Wed..Tue across a month end
    expect(span.days).toBe(5);
  });
});
