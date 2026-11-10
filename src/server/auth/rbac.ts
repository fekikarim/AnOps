import "server-only";
import { auth } from "@/server/auth";
import clientPromise from "@/server/db/client";
import type { EmployeeRole } from "@/server/auth/types";
import type { Employee } from "@/features/hr/types";

import { ObjectId } from "mongodb";
import { getActiveTenant } from "@/server/tenant/context";
import { assertAppAccessFor } from "@/server/platform/access";
import type { ApplicationId } from "@/shared/domain/applications";
import type { Company } from "@/features/company/types";

export type CurrentAuthContext = {
  userId: string;
  email: string;
  role: EmployeeRole;
  employee: Employee | null;
  isAdmin: boolean;
  companyId: string;
  company: Company;
};

/**
 * Resolves the currently authenticated user along with their active company tenant,
 * linked Employee record in that company, and HR role permissions.
 */
export async function getCurrentAuthUser(app?: ApplicationId): Promise<CurrentAuthContext | null> {
  const session = await auth();
  if (!session?.user?.email || !session?.user?.id) {
    return null;
  }

  const tenant = await getActiveTenant();
  if (!tenant) {
    return null;
  }

  const email = session.user.email.toLowerCase().trim();
  const client = await clientPromise;
  const db = client.db();
  // The page layouts only guard navigation. Server actions must verify plan and per-member access themselves.
  if (app) await assertAppAccessFor(db, new ObjectId(tenant.companyId), new ObjectId(session.user.id), app);

  // Find linked employee in this active company
  const empDoc = await db.collection("employees").findOne({
    companyId: new ObjectId(tenant.companyId),
    email,
  });

  let role: EmployeeRole = "employee";
  if (tenant.isAdmin) {
    role = "hr_admin";
  } else if (tenant.role === "manager" || empDoc?.role === "manager") {
    role = "manager";
  } else if (empDoc?.role) {
    role = empDoc.role as EmployeeRole;
  }

  let employee: Employee | null = null;
  if (empDoc) {
    employee = {
      id: empDoc._id.toString(),
      fullName: empDoc.fullName as string,
      email: empDoc.email as string,
      phone: empDoc.phone as string | undefined,
      jobTitle: empDoc.jobTitle as string,
      departmentId: empDoc.departmentId ? empDoc.departmentId.toString() : "",
      departmentName: (empDoc.departmentName || empDoc.deptName || "General") as string,
      hireDate: empDoc.hireDate as string,
      baseSalary: (empDoc.baseSalary as number) || 0,
      role: (empDoc.role as EmployeeRole) || role,
      status: empDoc.status as "active" | "inactive",
      leaveAllowance: (empDoc.leaveAllowance as number) || 25,
      createdAt: empDoc.createdAt ? (empDoc.createdAt as Date).toISOString() : new Date().toISOString(),
      updatedAt: empDoc.updatedAt ? (empDoc.updatedAt as Date).toISOString() : new Date().toISOString(),
    };
  }

  return {
    userId: session.user.id,
    email,
    role,
    employee,
    isAdmin: role === "hr_admin",
    companyId: tenant.companyId,
    company: tenant.company,
  };
}

/**
 * Throws or returns an error if the request is unauthenticated.
 */
export async function requireAuthUser(app?: ApplicationId): Promise<CurrentAuthContext> {
  const user = await getCurrentAuthUser(app);
  if (!user) {
    throw new Error("Unauthorized. Please log in to continue.");
  }
  return user;
}

/**
 * Throws or returns an error if the request is not from an HR Administrator.
 */
export async function requireAdminUser(app?: ApplicationId): Promise<CurrentAuthContext> {
  const user = await requireAuthUser(app);
  if (!user.isAdmin) {
    throw new Error("Forbidden: This action requires HR Administrator permissions.");
  }
  return user;
}
