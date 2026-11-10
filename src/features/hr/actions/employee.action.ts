"use server";

import { revalidatePath } from "next/cache";
import { employeeSchema } from "@/features/hr/schemas/hr.schema";
import {
  createEmployee,
  updateEmployee,
  toggleEmployeeStatus,
  getEmployees,
} from "@/server/services/hr.service";
import type { Employee, EmployeeFilterParams } from "@/features/hr/types";

import { requireAdminUser, requireAuthUser } from "@/server/auth/rbac";

export type ActionResult<T = unknown> = {
  success?: boolean;
  data?: T;
  error?: string;
  tempPassword?: string; // returned once after employee creation
};

export async function createEmployeeAction(rawData: unknown): Promise<ActionResult<Employee>> {
  try {
    const admin = await requireAdminUser("hr-payroll");
    const parsed = employeeSchema.safeParse(rawData);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0]?.message || "Invalid employee data.";
      return { error: firstIssue };
    }

    const result = await createEmployee(parsed.data, admin.companyId);
    const { tempPassword, ...employee } = result;
    revalidatePath("/hr");
    return { success: true, data: employee, tempPassword };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create employee.";
    return { error: message };
  }
}

export async function updateEmployeeAction(id: string, rawData: unknown): Promise<ActionResult<Employee>> {
  try {
    const admin = await requireAdminUser("hr-payroll");
    const parsed = employeeSchema.safeParse(rawData);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0]?.message || "Invalid employee data.";
      return { error: firstIssue };
    }

    const employee = await updateEmployee(id, parsed.data, admin.companyId);
    revalidatePath("/hr");
    return { success: true, data: employee };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update employee.";
    return { error: message };
  }
}

export async function toggleEmployeeStatusAction(id: string): Promise<ActionResult<{ id: string; newStatus: "active" | "inactive" }>> {
  try {
    const admin = await requireAdminUser("hr-payroll");
    const result = await toggleEmployeeStatus(id, admin.companyId);
    revalidatePath("/hr");
    return { success: true, data: result };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update employee status.";
    return { error: message };
  }
}

export async function filterEmployeesAction(filters: EmployeeFilterParams): Promise<ActionResult<Employee[]>> {
  try {
    const authUser = await requireAuthUser("hr-payroll");
    // Non-admins can only see active employee directory cards (or their own)
    const employees = await getEmployees(filters, authUser.companyId);
    if (!authUser.isAdmin) {
      // Strip sensitive payroll info (baseSalary) for regular employees
      const sanitized = employees
        .filter((e) => e.status === "active" || e.id === authUser.employee?.id)
        .map((e) => (e.id === authUser.employee?.id ? e : { ...e, baseSalary: 0 }));
      return { success: true, data: sanitized };
    }
    return { success: true, data: employees };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch employees.";
    return { error: message };
  }
}
