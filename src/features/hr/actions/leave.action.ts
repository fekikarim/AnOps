"use server";

import { revalidatePath } from "next/cache";
import { leaveRequestSchema, leaveReviewSchema } from "@/features/hr/schemas/hr.schema";
import {
  createLeaveRequest,
  reviewLeaveRequest,
  cancelLeaveRequest,
  getLeaveRequests,
  getLeaveBalance,
  getSoldeDeConge,
  getLeaveTransactions,
  createManualAdjustment,
  reverseLeaveTransaction,
  runMonthlyAccrual,
  getLeaveTypes,
  getLeavePolicies,
  calculateDepartureUnusedLeave,
  confirmDepartureCompensation,
} from "@/server/services/hr.service";
import type {
  LeaveRequest,
  LeaveBalance,
  SoldeDeConge,
  LeaveTransactionRecord,
  LeaveTypeRecord,
  LeavePolicyRecord,
} from "@/features/hr/types";
import { leaveAdjustmentSchema } from "@/features/hr/schemas/hr.schema";
import type { ActionResult } from "./employee.action";

import { requireAuthUser } from "@/server/auth/rbac";

export async function submitLeaveRequestAction(rawData: unknown): Promise<ActionResult<LeaveRequest>> {
  try {
    const authUser = await requireAuthUser("hr-payroll");
    const parsed = leaveRequestSchema.safeParse(rawData);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0]?.message || "Invalid leave request parameters.";
      return { error: firstIssue };
    }

    // Backend restriction: non-admins can only request leave for themselves
    if (!authUser.isAdmin && authUser.employee && parsed.data.employeeId !== authUser.employee.id) {
      return { error: "You can only submit leave requests for yourself." };
    }

    const leaveRequest = await createLeaveRequest(parsed.data, authUser.companyId);
    revalidatePath("/hr");
    return { success: true, data: leaveRequest };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to submit leave request.";
    return { error: message };
  }
}

export async function reviewLeaveRequestAction(
  rawData: unknown,
  reviewerName?: string
): Promise<ActionResult<LeaveRequest>> {
  try {
    const authUser = await requireAuthUser("hr-payroll");
    if (authUser.role !== "hr_admin" && authUser.role !== "manager") {
      return { error: "Forbidden: Only HR administrators or managers can review leave requests." };
    }

    const parsed = leaveReviewSchema.safeParse(rawData);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0]?.message || "Invalid review parameters.";
      return { error: firstIssue };
    }

    const actualReviewer = reviewerName || authUser.employee?.fullName || authUser.email;
    const reviewed = await reviewLeaveRequest(parsed.data, actualReviewer, authUser.companyId);
    revalidatePath("/hr");
    return { success: true, data: reviewed };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to review leave request.";
    return { error: message };
  }
}

export async function getLeaveBalanceAction(employeeId: string): Promise<ActionResult<LeaveBalance>> {
  try {
    const authUser = await requireAuthUser("hr-payroll");
    // Non-admin can only inspect their own leave balance
    if (!authUser.isAdmin && authUser.employee && employeeId !== authUser.employee.id) {
      return { error: "Forbidden: You may only view your own leave balance." };
    }

    const balance = await getLeaveBalance(employeeId, 2026, authUser.companyId);
    return { success: true, data: balance };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch leave balance.";
    return { error: message };
  }
}

export async function fetchLeaveRequestsAction(filter: {
  employeeId?: string;
  status?: string;
}): Promise<ActionResult<LeaveRequest[]>> {
  try {
    const authUser = await requireAuthUser("hr-payroll");
    // Non-admin can only fetch their own leave requests
    const effectiveFilter = !authUser.isAdmin && authUser.employee
      ? { ...filter, employeeId: authUser.employee.id }
      : filter;

    const requests = await getLeaveRequests(effectiveFilter, authUser.companyId);
    return { success: true, data: requests };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch leave requests.";
    return { error: message };
  }
}

export async function getSoldeDeCongeAction(employeeId?: string): Promise<ActionResult<SoldeDeConge>> {
  try {
    const authUser = await requireAuthUser("hr-payroll");
    const targetEmpId = employeeId || authUser.employee?.id;
    if (!targetEmpId) {
      return { error: "Employee context not found." };
    }

    if (!authUser.isAdmin && authUser.employee && targetEmpId !== authUser.employee.id) {
      return { error: "Forbidden: You may only view your own leave balance." };
    }

    const solde = await getSoldeDeConge(targetEmpId, new Date().getFullYear(), authUser.companyId);
    return { success: true, data: solde };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch leave balance.";
    return { error: message };
  }
}

export async function fetchLeaveTransactionsAction(filter: {
  employeeId?: string;
  leaveTypeId?: string;
}): Promise<ActionResult<LeaveTransactionRecord[]>> {
  try {
    const authUser = await requireAuthUser("hr-payroll");
    const targetEmpId = !authUser.isAdmin && authUser.employee ? authUser.employee.id : filter.employeeId;

    const txs = await getLeaveTransactions({ ...filter, employeeId: targetEmpId }, authUser.companyId);
    return { success: true, data: txs };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch leave transactions.";
    return { error: message };
  }
}

export async function createManualAdjustmentAction(rawData: unknown): Promise<ActionResult<LeaveTransactionRecord>> {
  try {
    const authUser = await requireAuthUser("hr-payroll");
    if (authUser.role !== "hr_admin" && authUser.role !== "manager") {
      return { error: "Forbidden: Only HR administrators can create manual leave adjustments." };
    }

    const parsed = leaveAdjustmentSchema.safeParse(rawData);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message || "Invalid adjustment data." };
    }

    const adminName = authUser.employee?.fullName || authUser.email;
    const tx = await createManualAdjustment(parsed.data, authUser.userId, adminName, authUser.companyId);
    revalidatePath("/hr");
    return { success: true, data: tx };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to record adjustment.";
    return { error: message };
  }
}

export async function reverseLeaveTransactionAction(
  transactionId: string,
  reason: string
): Promise<ActionResult<LeaveTransactionRecord>> {
  try {
    const authUser = await requireAuthUser("hr-payroll");
    if (authUser.role !== "hr_admin") {
      return { error: "Forbidden: Only HR administrators can reverse transactions." };
    }

    if (!reason || reason.trim().length < 3) {
      return { error: "A valid reason is required for reversal." };
    }

    const tx = await reverseLeaveTransaction(transactionId, reason, authUser.userId, authUser.companyId);
    revalidatePath("/hr");
    return { success: true, data: tx };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to reverse transaction.";
    return { error: message };
  }
}

export async function cancelLeaveRequestAction(
  requestId: string,
  reason: string
): Promise<ActionResult<LeaveRequest>> {
  try {
    const authUser = await requireAuthUser("hr-payroll");

    // HR admins may cancel any request in their company. Everyone else, only their own.
    if (!authUser.isAdmin) {
      const ownRequests = authUser.employee
        ? await getLeaveRequests({ employeeId: authUser.employee.id }, authUser.companyId)
        : [];
      if (!ownRequests.some((r) => r.id === requestId)) {
        return { error: "Forbidden: You may only cancel your own leave requests." };
      }
    }

    const actorName = authUser.employee?.fullName || authUser.email;
    const cancelled = await cancelLeaveRequest(requestId, reason, actorName, authUser.companyId, { isAdmin: authUser.isAdmin, employeeId: authUser.employee?.id ?? null });
    revalidatePath("/hr");
    return { success: true, data: cancelled };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to cancel leave request.";
    return { error: message };
  }
}

export async function runMonthlyAccrualAction(periodDateStr?: string): Promise<ActionResult<{ processed: number; accruedEmployees: string[] }>> {
  try {
    const authUser = await requireAuthUser("hr-payroll");
    if (authUser.role !== "hr_admin") {
      return { error: "Forbidden: Only HR administrators can run leave accruals." };
    }

    const actorName = authUser.employee?.fullName || "HR Administrator";
    const result = await runMonthlyAccrual(authUser.companyId, periodDateStr, actorName);
    revalidatePath("/hr");
    return { success: true, data: result };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to run accrual.";
    return { error: message };
  }
}

export async function fetchLeaveTypesAction(): Promise<ActionResult<LeaveTypeRecord[]>> {
  try {
    const authUser = await requireAuthUser("hr-payroll");
    const types = await getLeaveTypes(authUser.companyId);
    return { success: true, data: types };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch leave types.";
    return { error: message };
  }
}

export async function fetchLeavePoliciesAction(): Promise<ActionResult<LeavePolicyRecord[]>> {
  try {
    const authUser = await requireAuthUser("hr-payroll");
    const policies = await getLeavePolicies(authUser.companyId);
    return { success: true, data: policies };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch leave policies.";
    return { error: message };
  }
}

export async function getDepartureReviewAction(employeeId: string) {
  try {
    const authUser = await requireAuthUser("hr-payroll");
    if (authUser.role !== "hr_admin") {
      return { error: "Forbidden: Only HR administrators can review departure compensations." };
    }
    const review = await calculateDepartureUnusedLeave(employeeId, authUser.companyId);
    return { success: true, data: review };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to calculate departure compensation.";
    return { error: message };
  }
}

export async function confirmDepartureCompensationAction(
  employeeId: string,
  approvedDays: number,
  reason: string
): Promise<ActionResult<LeaveTransactionRecord>> {
  try {
    const authUser = await requireAuthUser("hr-payroll");
    if (authUser.role !== "hr_admin") {
      return { error: "Forbidden: Only HR administrators can confirm departure compensations." };
    }
    const tx = await confirmDepartureCompensation(employeeId, approvedDays, reason, authUser.userId, authUser.companyId);
    revalidatePath("/hr");
    return { success: true, data: tx };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to confirm compensation.";
    return { error: message };
  }
}
