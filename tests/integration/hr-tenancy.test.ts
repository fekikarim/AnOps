import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoClient, ObjectId } from "mongodb";

/**
 * HR is company-scoped: every employee, department, job title and attendance record belongs to one
 * company, and no HR query may return or change another company's data.
 *
 * The HR and company services connect through the shared client when they load, so the test database
 * is chosen before they are imported. Use a disposable MongoDB instance (MONGODB_TEST_URI).
 */
const BASE_URI = process.env.MONGODB_TEST_URI ?? "mongodb://127.0.0.1:27018/?replicaSet=rs0&directConnection=true";
const DB_NAME = `anops_hr_test_${new ObjectId().toHexString()}`;
const url = new URL(BASE_URI);
url.pathname = `/${DB_NAME}`;
process.env.MONGODB_URI = url.toString();
process.env.AUTH_SECRET ??= "hr-tenancy-test-secret-0123456789abcdef";

type HrService = typeof import("@/server/services/hr.service");
type CompanyService = typeof import("@/server/services/company.service");

let hr: HrService;
let companies: CompanyService;
let cleanupClient: MongoClient;
let companyA: string;
let companyB: string;
let departmentA: string;

const ownerA = new ObjectId().toHexString();
const ownerB = new ObjectId().toHexString();

beforeAll(async () => {
  cleanupClient = new MongoClient(BASE_URI, { serverSelectionTimeoutMS: 5000 });
  hr = await import("@/server/services/hr.service");
  companies = await import("@/server/services/company.service");
  companyA = (await companies.createCompany(ownerA, { name: "Acme Tech" })).id;
  companyB = (await companies.createCompany(ownerB, { name: "MedGlobal" })).id;
  departmentA = (await hr.getDepartments(companyA))[0].id;
});

afterAll(async () => {
  await cleanupClient.db(DB_NAME).dropDatabase().catch(() => undefined);
  await cleanupClient.close();
});

function employeeInput(email: string, departmentId: string) {
  return {
    fullName: "Ali Tenant",
    email,
    phone: "",
    departmentId,
    jobTitle: "Software Engineer",
    isCustomJobTitle: false,
    hireDate: "2026-01-05",
    baseSalary: 1000,
    role: "employee" as const,
    status: "active" as const,
    leaveAllowance: 25,
  };
}

describe("company-scoped HR data", () => {
  it("seeds departments per company and never shares them", async () => {
    const depsA = await hr.getDepartments(companyA);
    const depsB = await hr.getDepartments(companyB);
    expect(depsA.length).toBeGreaterThan(0);
    expect(depsB.length).toBeGreaterThan(0);
    const idsA = new Set(depsA.map((d) => d.id));
    expect(depsB.some((d) => idsA.has(d.id))).toBe(false);
  });

  it("hides another company's employees from lists and lookups", async () => {
    const employee = await hr.createEmployee(employeeInput("ali.tenant@acme.test", departmentA), companyA);

    expect((await hr.getEmployees({ status: "all" }, companyA)).some((e) => e.id === employee.id)).toBe(true);
    expect(await hr.getEmployees({ status: "all" }, companyB)).toHaveLength(0);
    expect(await hr.getEmployeeById(employee.id, companyB)).toBeNull();
  });

  it("refuses to create an employee in another company's department", async () => {
    const departmentB = (await hr.getDepartments(companyB))[0].id;
    await expect(hr.createEmployee(employeeInput("cross.dept@acme.test", departmentB), companyA)).rejects.toThrow();
  });

  it("records attendance only for the employee's own company", async () => {
    const employee = (await hr.getEmployees({ status: "all" }, companyA))[0];
    await expect(hr.checkInEmployee(employee.id, companyB)).rejects.toThrow();

    await hr.checkInEmployee(employee.id, companyA);
    const today = await hr.getTodayAttendance(companyB);
    expect(today.records ?? []).toHaveLength(0);
  });

  it("refuses HR queries that do not name a company", async () => {
    await expect(hr.getEmployees({ status: "all" }, "")).rejects.toThrow(/company/i);
    await expect(hr.getDepartments("not-an-id")).rejects.toThrow(/company/i);
  });
});
