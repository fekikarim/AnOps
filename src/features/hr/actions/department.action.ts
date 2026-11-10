"use server";

import { revalidatePath } from "next/cache";
import { departmentSchema } from "@/features/hr/schemas/hr.schema";
import {
  createDepartment,
  getDepartments,
  updateDepartment,
  deleteDepartment,
  getEmployeesByDepartment,
} from "@/server/services/hr.service";
import type { Department, Employee } from "@/features/hr/types";
import type { ActionResult } from "./employee.action";

import { requireAdminUser, requireAuthUser } from "@/server/auth/rbac";

export async function createDepartmentAction(name: string, description?: string): Promise<ActionResult<Department>> {
  try {
    const admin = await requireAdminUser("hr-payroll");
    const parsed = departmentSchema.safeParse({ name, description });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message || "Invalid department name." };
    }

    const dept = await createDepartment(parsed.data.name, parsed.data.description, admin.companyId);
    revalidatePath("/hr");
    return { success: true, data: dept };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create department.";
    return { error: message };
  }
}

export async function updateDepartmentAction(id: string, name: string, description?: string): Promise<ActionResult<Department>> {
  try {
    const admin = await requireAdminUser("hr-payroll");
    const parsed = departmentSchema.safeParse({ name, description });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message || "Invalid department name." };
    }

    const dept = await updateDepartment(id, parsed.data.name, parsed.data.description, admin.companyId);
    revalidatePath("/hr");
    return { success: true, data: dept };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update department.";
    return { error: message };
  }
}

export async function deleteDepartmentAction(id: string): Promise<ActionResult<{ id: string }>> {
  try {
    const admin = await requireAdminUser("hr-payroll");
    await deleteDepartment(id, admin.companyId);
    revalidatePath("/hr");
    return { success: true, data: { id } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to delete department.";
    return { error: message };
  }
}

export async function fetchDepartmentsAction(): Promise<ActionResult<Department[]>> {
  try {
    const user = await requireAuthUser("hr-payroll");
    const departments = await getDepartments(user.companyId);
    return { success: true, data: departments };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load departments.";
    return { error: message };
  }
}

export async function fetchDepartmentStaffAction(departmentId: string): Promise<ActionResult<Employee[]>> {
  try {
    const user = await requireAuthUser("hr-payroll");
    const employees = await getEmployeesByDepartment(departmentId, user.companyId);
    return { success: true, data: employees };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load department staff.";
    return { error: message };
  }
}
