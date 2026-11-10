"use server";

import { revalidatePath } from "next/cache";
import { jobTitleSchema } from "@/features/hr/schemas/hr.schema";
import {
  getJobTitles,
  ensureJobTitle,
  deleteJobTitle,
  seedHrDefaultsForCompany,
  updateJobTitle,
  getEmployeesByJobTitle,
} from "@/server/services/hr.service";
import type { JobTitle, Employee } from "@/features/hr/types";
import type { ActionResult } from "./employee.action";
import { requireAuthUser } from "@/server/auth/rbac";

import { requireAdminUser } from "@/server/auth/rbac";

export async function createJobTitleAction(title: string, departmentId?: string): Promise<ActionResult<JobTitle>> {
  try {
    const admin = await requireAdminUser("hr-payroll");
    const parsed = jobTitleSchema.safeParse({ title, departmentId });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message || "Invalid job title." };
    }

    const jobTitle = await ensureJobTitle(parsed.data.title, parsed.data.departmentId, false, admin.companyId);
    revalidatePath("/hr");
    return { success: true, data: jobTitle };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create job title.";
    return { error: message };
  }
}

export async function updateJobTitleAction(id: string, title: string, departmentId?: string): Promise<ActionResult<JobTitle>> {
  try {
    const admin = await requireAdminUser("hr-payroll");
    const parsed = jobTitleSchema.safeParse({ title, departmentId });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message || "Invalid job title." };
    }

    const updated = await updateJobTitle(id, parsed.data.title, parsed.data.departmentId, admin.companyId);
    revalidatePath("/hr");
    return { success: true, data: updated };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update job title.";
    return { error: message };
  }
}

export async function deleteJobTitleAction(id: string): Promise<ActionResult<{ id: string }>> {
  try {
    const admin = await requireAdminUser("hr-payroll");
    await deleteJobTitle(id, admin.companyId);
    revalidatePath("/hr");
    return { success: true, data: { id } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to delete job title.";
    return { error: message };
  }
}

export async function fetchJobTitlesAction(): Promise<ActionResult<JobTitle[]>> {
  try {
    const user = await requireAuthUser("hr-payroll");
    const titles = await getJobTitles(user.companyId);
    return { success: true, data: titles };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load job titles.";
    return { error: message };
  }
}

export async function reseedDefaultsAction(): Promise<ActionResult<boolean>> {
  try {
    const admin = await requireAdminUser("hr-payroll");
    await seedHrDefaultsForCompany(admin.companyId);
    revalidatePath("/hr");
    return { success: true, data: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to seed HR defaults.";
    return { error: message };
  }
}

export async function fetchJobTitleStaffAction(title: string): Promise<ActionResult<Employee[]>> {
  try {
    const user = await requireAuthUser("hr-payroll");
    // Colleagues' names only: salary is stripped for everyone but HR administrators.
    const all = await getEmployeesByJobTitle(title, user.companyId);
    const employees = user.isAdmin ? all : all.filter((e) => e.status === "active").map((e) => ({ ...e, baseSalary: 0, dateOfBirth: undefined }));
    return { success: true, data: employees };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load staff for this title.";
    return { error: message };
  }
}
