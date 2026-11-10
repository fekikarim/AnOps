"use server";

import { revalidatePath } from "next/cache";
import { payrollGenerateSchema } from "@/features/hr/schemas/hr.schema";
import {
  generatePayslips,
  getPayslips,
  getPayslipById,
  getPayrollSummary,
  calculateEmployeePayrollPreview,
} from "@/server/services/hr.service";
import type { PayslipRecord, PayrollSummary } from "@/features/hr/types";
import type { ActionResult } from "./employee.action";

import { requireAdminUser, requireAuthUser } from "@/server/auth/rbac";

export async function generatePayslipsAction(rawData: unknown): Promise<ActionResult<PayslipRecord[]>> {
  try {
    const admin = await requireAdminUser("hr-payroll");
    const parsed = payrollGenerateSchema.safeParse(rawData);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0]?.message || "Invalid payroll generation parameters.";
      return { error: firstIssue };
    }

    const { period, employeeIds, workingDaysInMonth, correctPaid } = parsed.data;
    const records = await generatePayslips(period, employeeIds, workingDaysInMonth, admin.companyId, { allowPaidCorrection: correctPaid === true });
    revalidatePath("/hr");
    return { success: true, data: records };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to generate payslips.";
    return { error: message };
  }
}

export async function getPayslipsAction(period: string): Promise<ActionResult<PayslipRecord[]>> {
  try {
    const authUser = await requireAuthUser("hr-payroll");
    const records = await getPayslips(
      {
        period,
        ...(!authUser.isAdmin && authUser.employee ? { employeeId: authUser.employee.id } : {}),
      },
      authUser.companyId
    );
    return { success: true, data: records };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load payslips.";
    return { error: message };
  }
}

export async function getPayslipByIdAction(id: string): Promise<ActionResult<PayslipRecord | null>> {
  try {
    const authUser = await requireAuthUser("hr-payroll");
    const record = await getPayslipById(id, authUser.companyId);
    if (record && !authUser.isAdmin && authUser.employee && record.employeeId !== authUser.employee.id) {
      return { error: "Forbidden: You may only access your own payslip." };
    }
    return { success: true, data: record };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load payslip detail.";
    return { error: message };
  }
}

export async function getPayrollSummaryAction(period: string): Promise<ActionResult<PayrollSummary>> {
  try {
    const admin = await requireAdminUser("hr-payroll");
    const summary = await getPayrollSummary(period, admin.companyId);
    return { success: true, data: summary };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load payroll summary.";
    return { error: message };
  }
}

export async function previewEmployeePayrollAction(
  employeeId: string,
  period: string
): Promise<ActionResult<Awaited<ReturnType<typeof calculateEmployeePayrollPreview>>>> {
  try {
    const authUser = await requireAuthUser("hr-payroll");
    if (!authUser.isAdmin && authUser.employee && employeeId !== authUser.employee.id) {
      return { error: "Forbidden: You may only preview your own payroll." };
    }

    const preview = await calculateEmployeePayrollPreview(employeeId, period, 22, authUser.companyId);
    return { success: true, data: preview };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to calculate payroll preview.";
    return { error: message };
  }
}
