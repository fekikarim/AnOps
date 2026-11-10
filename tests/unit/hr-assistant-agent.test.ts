import { describe, expect, it, vi, beforeEach } from "vitest";
import { askHRAssistant } from "@/server/services/hr.service";

// Mock mongodb db client
const mockEmployees = [
  {
    _id: "507f1f77bcf86cd799439011",
    fullName: "Nour Khemir",
    email: "nour@example.com",
    jobTitle: "DevOps Engineer",
    departmentName: "Engineering",
    hireDate: "2024-01-15",
    baseSalary: 4400,
    role: "employee",
  },
  {
    _id: "507f1f77bcf86cd799439012",
    fullName: "Sarah Ben Salem",
    email: "sarah@example.com",
    jobTitle: "HR Specialist",
    departmentName: "Human Resources",
    hireDate: "2023-05-01",
    baseSalary: 3800,
    role: "hr_admin",
  },
];

vi.mock("@/server/db/client", () => {
  return {
    default: Promise.resolve({
      db: () => ({
        collection: (name: string) => ({
          find: () => ({
            toArray: async () => {
              if (name === "employees") return mockEmployees;
              if (name === "leave_transactions") {
                return [
                  { transactionType: "ACCRUAL", days: 11, effectiveDate: "2026-11-01" },
                  { transactionType: "TAKEN", days: 3, effectiveDate: "2026-07-15" },
                  { transactionType: "RESERVATION", days: 2, effectiveDate: "2026-12-24" },
                ];
              }
              if (name === "leave_requests") return [];
              return [];
            },
            sort: () => ({
              toArray: async () => [],
            }),
          }),
          findOne: async (q: { _id?: { toString(): string } | string }) => {
            if (name === "employees") {
              return mockEmployees.find((e) => e._id === (typeof q._id === "string" ? q._id : q._id?.toString()));
            }
            if (name === "leave_types") return { _id: "lt-1", code: "CP", name: "Annual Paid Leave" };
            if (name === "leave_policies") return { _id: "pol-1", name: "Standard Adult Policy", accrualRate: 1.0, annualCap: 15, legalReference: "Code du Travail Art. 113-114" };
            return null;
          },
          countDocuments: async () => 1,
          insertOne: async () => ({ insertedId: "mock-id" }),
          updateMany: async () => ({ modifiedCount: 0 }),
        }),
      }),
    }),
  };
});

describe("AI HR Assistant - Solde de Congé Counting Derivation & RBAC", () => {
  const companyId = "6add71b55559a1c72e7bbba9";

  it("explains step-by-step how Solde de Congé was counted with formulas and legal citations", async () => {
    const res = await askHRAssistant(
      "Explain how my leave balance was counted step-by-step",
      "507f1f77bcf86cd799439011",
      companyId,
      {
        role: "employee",
        isAdmin: false,
        employeeId: "507f1f77bcf86cd799439011",
        fullName: "Nour Khemir",
      }
    );

    expect(res.role).toBe("assistant");
    expect(res.content).toContain("Step-by-Step Leave Balance (Solde de Congé) Derivation");
    expect(res.content).toContain("Nour Khemir");
    expect(res.content).toContain("Step 1 — Monthly Accrual (Acquis)");
    expect(res.content).toContain("Step 2 — Consumed Leave (Pris)");
    expect(res.content).toContain("Step 3 — Active Reservations (Réservé)");
    expect(res.content).toContain("Step 5 — Available Balance (Disponible)");
    expect(res.content).toContain("Code du Travail Art. 113-114");
    expect(res.content).toContain("Indemnité compensatrice Art. 120");
    expect(res.toolData?.type).toBe("leave_balance");
  });

  it("strictly REFUSES when a standard employee queries another employee's records (Access Denied)", async () => {
    // Nour (standard employee) asks about Sarah Ben Salem
    const res = await askHRAssistant(
      "What is Sarah Ben Salem's leave balance?",
      "507f1f77bcf86cd799439011",
      companyId,
      {
        role: "employee",
        isAdmin: false,
        employeeId: "507f1f77bcf86cd799439011",
        fullName: "Nour Khemir",
      }
    );

    expect(res.content).toContain("Access Denied");
    expect(res.content).toContain("ROLES_AND_PERMISSIONS.md");
    expect(res.content).not.toContain("Sarah Ben Salem's Leave Balance");
  });

  it("allows HR Admins to query any existing employee and returns their derivation", async () => {
    // Sarah (HR admin) queries Nour Khemir
    const res = await askHRAssistant(
      "What is Nour Khemir's leave balance and how was it counted?",
      "507f1f77bcf86cd799439012",
      companyId,
      {
        role: "hr_admin",
        isAdmin: true,
        employeeId: "507f1f77bcf86cd799439012",
        fullName: "Sarah Ben Salem",
      }
    );

    expect(res.content).not.toContain("Access Denied");
    expect(res.content).toContain("Nour Khemir");
    expect(res.content).toContain("Step 1 — Monthly Accrual (Acquis)");
    expect(res.toolData?.data?.employeeName).toBe("Nour Khemir");
  });

  it("reports Employee Not Found when an HR Admin queries a non-existent worker", async () => {
    // Sarah (HR admin) queries a non-existent employee
    const res = await askHRAssistant(
      "Check leave for John Doe",
      "507f1f77bcf86cd799439012",
      companyId,
      {
        role: "hr_admin",
        isAdmin: true,
        employeeId: "507f1f77bcf86cd799439012",
        fullName: "Sarah Ben Salem",
      }
    );

    expect(res.content).toContain("Employee Not Found");
    expect(res.content).toContain("John Doe");
    expect(res.content).toContain("was not found in company records");
  });

  it("ensures responses use clean markdown and zero raw LaTeX delimiters", async () => {
    const res = await askHRAssistant(
      "How is my leave balance counted and what is the formula?",
      "507f1f77bcf86cd799439011",
      companyId,
      {
        role: "employee",
        isAdmin: false,
        employeeId: "507f1f77bcf86cd799439011",
        fullName: "Nour Khemir",
      }
    );

    expect(res.content).not.toContain("\\[");
    expect(res.content).not.toContain("\\]");
    expect(res.content).not.toContain("\\textbf{");
    expect(res.content).not.toContain("\\text{");
    expect(res.content).not.toContain("\\sum");
    expect(res.content).not.toContain("\\boxed{");
  });
});
