import "server-only";
import type { AiAccess } from "@/server/ai/access/access.service";
import type { Employee } from "@/features/hr/types";
import type { WorkspaceContext } from "@/server/tenancy/workspace";
import { AppError } from "@/shared/lib/errors";

/**
 * Who the member is to the HR data, resolved live from the database on every call.
 *
 *  - admin: owner or admin. The same people the HR server actions treat as HR administrators. Only they may write.
 *  - selfId: the employee record linked to the member's login email in this company, if there is one.
 *  - sensitive: the separate sensitive-HR switch from the member's AI grant. It never widens a role: a manager
 *    with the switch still sees only their own salary, payslips and date of birth.
 *
 * The HR service itself has no caller checks, so every AI HR tool starts here.
 */
export type HrScope = { admin: boolean; sensitive: boolean; selfId: string | null; companyId: string };

export async function hrScope(ctx: WorkspaceContext, access: AiAccess): Promise<HrScope> {
  const admin = ctx.role === "owner" || ctx.role === "admin";
  let selfId: string | null = null;
  const user = await ctx.db.collection("users").findOne({ _id: ctx.userId }, { projection: { email: 1 } });
  const email = typeof user?.email === "string" ? user.email.toLowerCase().trim() : "";
  if (email) {
    const emp = await ctx.db.collection("employees").findOne({ companyId: ctx.companyId, email }, { projection: { _id: 1 } });
    selfId = emp ? emp._id.toString() : null;
  }
  return { admin, sensitive: access.grant.canViewSensitiveHr === true, selfId, companyId: ctx.companyId.toHexString() };
}

export function requireHrAdmin(scope: HrScope): void {
  if (!scope.admin) throw new AppError("FORBIDDEN", "Only owners and administrators can change HR records.");
}

/** A non-admin may name only themselves. Returns the employee id to use. */
export function ownOrAdmin(scope: HrScope, requested?: string): string {
  const id = requested ?? scope.selfId ?? "";
  if (!id) throw new AppError("VALIDATION_ERROR", "Say which employee. You have no employee record linked to your login.");
  if (!scope.admin && id !== scope.selfId) throw new AppError("FORBIDDEN", "You can only view your own HR records.");
  return id;
}

/** What the model and the person may see of an employee. Sensitive fields are absent, not blanked, unless allowed. */
export type EmployeeView = {
  id: string;
  fullName: string;
  jobTitle: string;
  departmentId: string;
  departmentName: string;
  status: "active" | "inactive";
  email?: string;
  phone?: string;
  hireDate?: string;
  leaveAllowance?: number;
  baseSalary?: number;
  dateOfBirth?: string;
};

export function employeeView(e: Employee, scope: HrScope): EmployeeView {
  const isSelf = e.id === scope.selfId;
  const base: EmployeeView = { id: e.id, fullName: e.fullName, jobTitle: e.jobTitle, departmentId: e.departmentId, departmentName: e.departmentName, status: e.status };
  if (!scope.admin && !isSelf) return base; // the directory: who they are and where they work
  const full: EmployeeView = { ...base, email: e.email, phone: e.phone, hireDate: e.hireDate, leaveAllowance: e.leaveAllowance };
  if (scope.sensitive) {
    full.baseSalary = e.baseSalary;
    if (e.dateOfBirth) full.dateOfBirth = e.dateOfBirth;
  }
  return full;
}

/** Whether a non-admin may see this employee at all (active colleagues and themselves). */
export const visibleTo = (e: Employee, scope: HrScope) => scope.admin || e.status === "active" || e.id === scope.selfId;

/** Service errors are plain Errors with business wording; unknown ones are never passed on. */
const BUSINESS = /^(Forbidden|Only |Employee not found|Leave request not found|Invalid|An existing|Calculated|Requested|Insufficient|A mandatory|Choose|An employee with email|Department|Job title|This request|A \w+ request|Request is|Cannot|Name|Title|Payslip)/;
export async function hr<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof AppError) throw error;
    const message = error instanceof Error ? error.message : "";
    if (/^Forbidden/.test(message)) throw new AppError("FORBIDDEN", message);
    if (/not found/i.test(message) && BUSINESS.test(message)) throw new AppError("NOT_FOUND", message);
    if (BUSINESS.test(message)) throw new AppError("VALIDATION_ERROR", message.slice(0, 300));
    throw new AppError("INTERNAL", "Something went wrong. Please try again.");
  }
}
