import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MongoClient, ObjectId } from "mongodb";

/**
 * Only the owner of a leave request, or an HR admin of the same company, may cancel it.
 * Run with a disposable instance: MONGODB_TEST_URI=mongodb://127.0.0.1:27017
 */
const BASE_URI = process.env.MONGODB_TEST_URI ?? "mongodb://127.0.0.1:27018/?replicaSet=rs0&directConnection=true";
const DB_NAME = `anops_hr_cancel_test_${new ObjectId().toHexString()}`;
const url = new URL(BASE_URI);
url.pathname = `/${DB_NAME}`;
process.env.MONGODB_URI = url.toString();
process.env.AUTH_SECRET ??= "hr-cancel-test-secret-0123456789abcdef";

const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/server/auth/rbac", () => ({ requireAuthUser: async () => session.current }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

type Hr = typeof import("@/server/services/hr.service");
type LeaveActions = typeof import("@/features/hr/actions/leave.action");

let hr: Hr;
let actions: LeaveActions;
let client: MongoClient;
let companyA: string;
let companyB: string;
let ownerId: string;
let colleagueId: string;
let requestId: string;

function asUser(role: "employee" | "manager" | "hr_admin", employeeId: string | null, companyId = companyA) {
  session.current = {
    userId: new ObjectId().toHexString(),
    email: "user@cancel.test",
    role,
    isAdmin: role === "hr_admin",
    companyId,
    employee: employeeId ? { id: employeeId, fullName: "Test User" } : null,
  };
}

async function makeEmployee(fullName: string, companyId: string): Promise<string> {
  const departmentId = (await hr.getDepartments(companyId))[0].id;
  const employee = await hr.createEmployee(
    {
      fullName,
      email: `${new ObjectId().toHexString()}@cancel.test`,
      phone: "",
      departmentId,
      jobTitle: "Software Engineer",
      isCustomJobTitle: false,
      hireDate: "2025-01-06",
      baseSalary: 2200,
      role: "employee",
      status: "active",
      leaveAllowance: 25,
    },
    companyId
  );
  return employee.id;
}

const requestStatus = async () =>
  (await client.db(DB_NAME).collection("leave_requests").findOne({ _id: new ObjectId(requestId) }))?.status;

beforeAll(async () => {
  client = new MongoClient(BASE_URI, { serverSelectionTimeoutMS: 5000 });
  hr = await import("@/server/services/hr.service");
  actions = await import("@/features/hr/actions/leave.action");
  const companies = await import("@/server/services/company.service");
  companyA = (await companies.createCompany(new ObjectId().toHexString(), { name: "Cancel A" })).id;
  companyB = (await companies.createCompany(new ObjectId().toHexString(), { name: "Cancel B" })).id;
  ownerId = await makeEmployee("Owner Tester", companyA);
  colleagueId = await makeEmployee("Colleague Tester", companyA);
});

afterAll(async () => {
  await client.db(DB_NAME).dropDatabase().catch(() => undefined);
  await client.close();
});

beforeEach(async () => {
  await client.db(DB_NAME).collection("leave_requests").deleteMany({});
  const created = await hr.createLeaveRequest(
    { employeeId: ownerId, leaveType: "unpaid", startDate: "2030-03-04", endDate: "2030-03-04", reason: "Trip", isPaid: false },
    companyA
  );
  requestId = created.id;
});

describe("cancelLeaveRequestAction", () => {
  it.each([
    ["a colleague", "employee" as const, () => colleagueId],
    ["a manager who does not own it", "manager" as const, () => colleagueId],
    ["a member with no employee record", "employee" as const, () => null],
  ])("refuses %s", async (_label, role, employee) => {
    asUser(role, employee());
    const result = await actions.cancelLeaveRequestAction(requestId, "Not mine");
    expect(result.error).toContain("Forbidden");
    expect(await requestStatus()).toBe("pending");
  });

  it("lets the owner cancel their own request", async () => {
    asUser("employee", ownerId);
    expect((await actions.cancelLeaveRequestAction(requestId, "Plans changed")).success).toBe(true);
    expect(await requestStatus()).toBe("cancelled");
  });

  it("lets an HR admin of the same company cancel it", async () => {
    asUser("hr_admin", null);
    expect((await actions.cancelLeaveRequestAction(requestId, "Admin correction")).success).toBe(true);
    expect(await requestStatus()).toBe("cancelled");
  });

  it("does not let an HR admin of another company cancel it", async () => {
    asUser("hr_admin", null, companyB);
    const result = await actions.cancelLeaveRequestAction(requestId, "Wrong company");
    expect(result.error).toBeTruthy();
    expect(await requestStatus()).toBe("pending");
  });
});
