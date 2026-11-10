import "server-only";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { ObjectId } from "mongodb";
import clientPromise from "@/server/db/client";
import type {
  Department,
  JobTitle,
  Employee,
  HRDashboardStats,
  EmployeeFilterParams,
  LeaveRequest,
  LeaveBalance,
  LeaveType,
  LeaveStatus,
  AttendanceRecord,
  TodayAttendanceSummary,
  PayslipRecord,
  PayrollSummary,
  AIChatMessage,
  LeaveTypeRecord,
  LeavePolicyRecord,
  EmployeeLeavePolicyRecord,
  LeaveTransactionRecord,
  PublicHolidayRecord,
  SoldeDeConge,
  EmployeeCategory,
} from "@/features/hr/types";
import type {
  EmployeeInput,
  LeaveRequestInput,
  LeaveReviewInput,
  LeaveAdjustmentInput,
  LeavePolicyInput,
  PublicHolidayInput,
} from "@/features/hr/schemas/hr.schema";
import { COMPANY_POLICIES } from "@/features/hr/policies/company-policies";
import DEFAULT_STRUCTURE from "@/features/hr/defaults/company-structure.json";
import {
  calculateBusinessDays,
  calculateLeaveDays,
  calculateAge,
  getAgeCategory,
  formatDateYMD,
} from "@/features/hr/utils/date-utils";

/** Names and titles come from people (and now from AI drafts): they are matched literally, never as a pattern. */
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const DEFAULT_DEPARTMENTS = DEFAULT_STRUCTURE.departments;

const DEFAULT_JOB_TITLES = DEFAULT_STRUCTURE.jobTitles;

async function getDb() {
  const client = await clientPromise;
  return client.db();
}


/**
 * Every HR query is scoped to one company. The caller must pass the company it resolved from the
 * active tenant (server/tenant/context.ts). There is no unscoped fallback.
 */
function requireCompanyId(companyId: string): ObjectId {
  if (!companyId || !ObjectId.isValid(companyId)) {
    throw new Error("A valid company is required for this operation.");
  }
  return new ObjectId(companyId);
}

/**
 * Seeds default departments and job titles for a newly created company organization.
 */
export async function seedHrDefaultsForCompany(companyId: string): Promise<void> {
  if (!ObjectId.isValid(companyId)) return;
  const db = await getDb();
  const cId = new ObjectId(companyId);

  // 1. Departments
  const deptCount = await db.collection("departments").countDocuments({ companyId: cId });
  if (deptCount === 0) {
    const docs = DEFAULT_DEPARTMENTS.map((d) => ({
      ...d,
      companyId: cId,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    await db.collection("departments").insertMany(docs);
  }

  const allDepts = await db.collection("departments").find({ companyId: cId }).toArray();
  const deptMapByName = new Map<string, ObjectId>();
  allDepts.forEach((d) => deptMapByName.set(d.name, d._id as ObjectId));

  // 2. Predefined Job Titles
  const titleCount = await db.collection("job_titles").countDocuments({ companyId: cId });
  if (titleCount === 0) {
    const titleDocs = DEFAULT_JOB_TITLES.map((t) => ({
      title: t.title,
      departmentId: deptMapByName.get(t.deptName)?.toString() ?? "",
      companyId: cId,
      isPredefined: true,
      createdAt: new Date(),
    }));
    await db.collection("job_titles").insertMany(titleDocs);
  }

  // 3. Default Tunisian Leave Types (Solde de congé system)
  const leaveTypesCount = await db.collection("leave_types").countDocuments({ companyId: cId });
  if (leaveTypesCount === 0) {
    const defaultTypes = [
      {
        name: "Congés Payés (Annual Paid Leave)",
        code: "CP",
        isPaid: true,
        requiresApproval: true,
        requiresDocument: false,
        isActive: true,
        companyId: cId,
        createdAt: new Date(),
      },
      {
        name: "Congé Maladie (Sick Leave)",
        code: "SICK",
        isPaid: true,
        requiresApproval: true,
        requiresDocument: true,
        isActive: true,
        companyId: cId,
        createdAt: new Date(),
      },
      {
        name: "Congé Événements Familiaux (Exceptional)",
        code: "EXCEPTIONAL",
        isPaid: true,
        requiresApproval: true,
        requiresDocument: true,
        isActive: true,
        companyId: cId,
        createdAt: new Date(),
      },
      {
        name: "Congé Sans Solde (Unpaid Leave)",
        code: "UNPAID",
        isPaid: false,
        requiresApproval: true,
        requiresDocument: false,
        isActive: true,
        companyId: cId,
        createdAt: new Date(),
      },
    ];
    await db.collection("leave_types").insertMany(defaultTypes);
  }

  // 4. Default Tunisian Leave Policies (Labour Code Art. 113-114)
  const policyCount = await db.collection("leave_policies").countDocuments({ companyId: cId });
  if (policyCount === 0) {
    const defaultPolicies = [
      {
        name: "Standard Adult Policy (Code du Travail Art. 113-114)",
        country: "TN",
        employeeCategory: "adult",
        accrualRate: 1.0, // 1 day per month of effective work
        accrualPeriod: "monthly",
        annualCap: 15, // 15 calendar days (12 working days)
        referencePeriodType: "calendar_year",
        calculationMethod: "standard_monthly",
        roundingRule: "half_day",
        effectiveFrom: "2024-01-01",
        legalReference: "Code du Travail Art. 113-114 (Vérifier avec RH/Juridique)",
        isActive: true,
        companyId: cId,
        createdAt: new Date(),
      },
      {
        name: "Young Adult Policy 18-20 ans (Code du Travail Art. 114)",
        country: "TN",
        employeeCategory: "young_adult",
        accrualRate: 1.5, // 1.5 days per month of effective work
        accrualPeriod: "monthly",
        annualCap: 22.5, // 22.5 calendar days (18 working days)
        referencePeriodType: "calendar_year",
        calculationMethod: "standard_monthly",
        roundingRule: "half_day",
        effectiveFrom: "2024-01-01",
        legalReference: "Code du Travail Art. 114 (Vérifier avec RH/Juridique)",
        isActive: true,
        companyId: cId,
        createdAt: new Date(),
      },
      {
        name: "Under 18 Policy (Code du Travail Art. 114)",
        country: "TN",
        employeeCategory: "under_18",
        accrualRate: 2.0, // 2.0 days per month of effective work
        accrualPeriod: "monthly",
        annualCap: 30, // 30 calendar days (24 working days)
        referencePeriodType: "calendar_year",
        calculationMethod: "standard_monthly",
        roundingRule: "half_day",
        effectiveFrom: "2024-01-01",
        legalReference: "Code du Travail Art. 114 (Vérifier avec RH/Juridique)",
        isActive: true,
        companyId: cId,
        createdAt: new Date(),
      },
    ];
    await db.collection("leave_policies").insertMany(defaultPolicies);
  }

  // 5. Default Tunisian Public Holidays
  const holidaysCount = await db.collection("public_holidays").countDocuments({ companyId: cId });
  if (holidaysCount === 0) {
    const currentYear = new Date().getFullYear();
    const defaultHolidays = [
      { name: "Nouvel An (New Year)", date: `${currentYear}-01-01`, isHalfDay: false, companyId: cId },
      { name: "Fête de la Révolution", date: `${currentYear}-01-14`, isHalfDay: false, companyId: cId },
      { name: "Fête de l'Indépendance", date: `${currentYear}-03-20`, isHalfDay: false, companyId: cId },
      { name: "Fête des Martyrs", date: `${currentYear}-04-09`, isHalfDay: false, companyId: cId },
      { name: "Fête du Travail", date: `${currentYear}-05-01`, isHalfDay: false, companyId: cId },
      { name: "Fête de la République", date: `${currentYear}-07-25`, isHalfDay: false, companyId: cId },
      { name: "Fête de la Femme", date: `${currentYear}-08-13`, isHalfDay: false, companyId: cId },
      { name: "Fête de l'Évacuation", date: `${currentYear}-10-15`, isHalfDay: false, companyId: cId },
    ];
    await db.collection("public_holidays").insertMany(defaultHolidays);
  }
}


export async function getDepartments(companyId: string): Promise<Department[]> {
  const db = await getDb();
  const cId = requireCompanyId(companyId);
  const filter = { companyId: cId };


  const [departments, employees] = await Promise.all([
    db.collection("departments").find(filter).sort({ name: 1 }).toArray(),
    db.collection("employees").find(filter).toArray(),
  ]);

  const countsByDeptId = new Map<string, number>();
  employees.forEach((emp) => {
    if (emp.status === "active" && emp.departmentId) {
      countsByDeptId.set(emp.departmentId, (countsByDeptId.get(emp.departmentId) ?? 0) + 1);
    }
  });

  return departments.map((d) => ({
    id: (d._id as ObjectId).toString(),
    name: d.name as string,
    description: (d.description as string) ?? undefined,
    employeeCount: countsByDeptId.get((d._id as ObjectId).toString()) ?? 0,
    createdAt: d.createdAt ? (d.createdAt as Date).toISOString() : undefined,
  }));
}

export async function createDepartment(name: string, description: string | undefined, companyId: string): Promise<Department> {
  const db = await getDb();
  const cId = requireCompanyId(companyId);
  const filter = { companyId: cId };
  const trimmed = name.trim();

  const existing = await db.collection("departments").findOne({
    ...filter,
    name: { $regex: new RegExp(`^${escapeRegExp(trimmed)}$`, "i") },
  });
  if (existing) {
    throw new Error(`Department "${trimmed}" already exists.`);
  }

  const result = await db.collection("departments").insertOne({
    name: trimmed,
    description: description?.trim() || "",
    ...({ companyId: cId }),
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return {
    id: result.insertedId.toString(),
    name: trimmed,
    description: description?.trim() || undefined,
    employeeCount: 0,
    createdAt: new Date().toISOString(),
  };
}

export async function updateDepartment(id: string, name: string, description: string | undefined, companyId: string): Promise<Department> {
  const db = await getDb();
  if (!ObjectId.isValid(id)) throw new Error("Invalid department ID.");
  const objId = new ObjectId(id);
  const cId = requireCompanyId(companyId);
  const filter = { companyId: cId };
  const trimmed = name.trim();

  const duplicate = await db.collection("departments").findOne({
    _id: { $ne: objId },
    ...filter,
    name: { $regex: new RegExp(`^${escapeRegExp(trimmed)}$`, "i") },
  });
  if (duplicate) {
    throw new Error(`Department "${trimmed}" already exists.`);
  }

  await db.collection("departments").updateOne(
    { _id: objId, ...filter },
    { $set: { name: trimmed, description: description?.trim() ?? "", updatedAt: new Date() } }
  );

  await db.collection("employees").updateMany(
    { departmentId: id, ...filter },
    { $set: { departmentName: trimmed, updatedAt: new Date() } }
  );

  const updated = await db.collection("departments").findOne({ _id: objId, ...filter });
  return {
    id,
    name: trimmed,
    description: updated?.description as string | undefined,
    employeeCount: await db.collection("employees").countDocuments({ departmentId: id, status: "active", ...filter }),
    createdAt: updated?.createdAt ? (updated.createdAt as Date).toISOString() : undefined,
  };
}

export async function deleteDepartment(id: string, companyId: string): Promise<void> {
  const db = await getDb();
  if (!ObjectId.isValid(id)) throw new Error("Invalid department ID.");
  const objId = new ObjectId(id);
  const cId = requireCompanyId(companyId);
  const filter = { companyId: cId };

  const dept = await db.collection("departments").findOne({ _id: objId, ...filter });
  if (!dept) throw new Error("Department not found.");

  const empCount = await db.collection("employees").countDocuments({ departmentId: id, ...filter });
  if (empCount > 0) {
    throw new Error(
      `Cannot delete "${dept.name}" — it has ${empCount} employee(s) assigned. Reassign them first.`
    );
  }

  await db.collection("departments").deleteOne({ _id: objId, ...filter });
}

export async function getEmployeesByDepartment(departmentId: string, companyId: string): Promise<Employee[]> {
  const db = await getDb();
  const cId = requireCompanyId(companyId);
  const filter = { companyId: cId };

  const docs = await db.collection("employees")
    .find({ departmentId, ...filter })
    .sort({ status: 1, fullName: 1 })
    .toArray();

  return docs.map((doc) => ({
    id: (doc._id as ObjectId).toString(),
    fullName: (doc.fullName as string) || (doc.name as string) || "Unnamed Staff",
    email: (doc.email as string) || "",
    phone: (doc.phone as string) || undefined,
    jobTitle: (doc.jobTitle as string) || "Staff Member",
    departmentId: (doc.departmentId as string) || "",
    departmentName: (doc.departmentName as string) || "General",
    hireDate: (doc.hireDate as string) || "2024-01-01",
    dateOfBirth: (doc.dateOfBirth as string) || undefined,
    baseSalary: Number(doc.baseSalary) || 0,
    status: (doc.status as "active" | "inactive") || "active",
    role: (doc.role as "employee" | "manager" | "hr_admin") || "employee",
    leaveAllowance: Number(doc.leaveAllowance) || 25,
    createdAt: doc.createdAt ? (doc.createdAt as Date).toISOString() : undefined,
    updatedAt: doc.updatedAt ? (doc.updatedAt as Date).toISOString() : undefined,
  }));
}

// ==========================================
// Job Title Service Methods
// ==========================================

export async function getJobTitles(companyId: string): Promise<JobTitle[]> {
  const db = await getDb();
  const cId = requireCompanyId(companyId);
  const filter = { companyId: cId };


  const [jobTitles, employees] = await Promise.all([
    db.collection("job_titles").find(filter).sort({ isPredefined: -1, title: 1 }).toArray(),
    db.collection("employees").find(filter).toArray(),
  ]);

  const countsByTitle = new Map<string, number>();
  employees.forEach((emp) => {
    if (emp.status === "active" && emp.jobTitle) {
      const normalized = emp.jobTitle.trim().toLowerCase();
      countsByTitle.set(normalized, (countsByTitle.get(normalized) ?? 0) + 1);
    }
  });

  return jobTitles.map((t) => {
    const normalized = (t.title as string).trim().toLowerCase();
    return {
      id: (t._id as ObjectId).toString(),
      title: t.title as string,
      departmentId: (t.departmentId as string) || undefined,
      isPredefined: Boolean(t.isPredefined),
      employeeCount: countsByTitle.get(normalized) ?? 0,
      createdAt: t.createdAt ? (t.createdAt as Date).toISOString() : undefined,
    };
  });
}

export async function ensureJobTitle(title: string, departmentId: string | undefined, isPredefined: boolean, companyId: string): Promise<JobTitle> {
  const db = await getDb();
  const cId = requireCompanyId(companyId);
  const filter = { companyId: cId };
  const trimmed = title.trim();
  if (!trimmed) {
    throw new Error("Job title cannot be empty.");
  }

  const existing = await db.collection("job_titles").findOne({
    ...filter,
    title: { $regex: new RegExp(`^${escapeRegExp(trimmed)}$`, "i") },
  });

  if (existing) {
    return {
      id: (existing._id as ObjectId).toString(),
      title: existing.title as string,
      departmentId: (existing.departmentId as string) || undefined,
      isPredefined: Boolean(existing.isPredefined),
    };
  }

  const insertResult = await db.collection("job_titles").insertOne({
    title: trimmed,
    departmentId: departmentId || "",
    ...({ companyId: cId }),
    isPredefined,
    createdAt: new Date(),
  });

  return {
    id: insertResult.insertedId.toString(),
    title: trimmed,
    departmentId: departmentId || undefined,
    isPredefined,
    createdAt: new Date().toISOString(),
  };
}

export async function updateJobTitle(id: string, title: string, departmentId: string | undefined, companyId: string): Promise<JobTitle> {
  const db = await getDb();
  if (!ObjectId.isValid(id)) throw new Error("Invalid job title ID.");
  const objId = new ObjectId(id);
  const cId = requireCompanyId(companyId);
  const filter = { companyId: cId };

  const existing = await db.collection("job_titles").findOne({ _id: objId, ...filter });
  if (!existing) throw new Error("Job title not found.");
  if (existing.isPredefined) throw new Error("Predefined job titles cannot be renamed.");

  const trimmed = title.trim();

  const dup = await db.collection("job_titles").findOne({
    _id: { $ne: objId },
    ...filter,
    title: { $regex: new RegExp(`^${escapeRegExp(trimmed)}$`, "i") },
  });
  if (dup) throw new Error(`A job title "${trimmed}" already exists.`);

  const oldTitle = existing.title as string;
  await db.collection("job_titles").updateOne(
    { _id: objId, ...filter },
    { $set: { title: trimmed, departmentId: departmentId ?? existing.departmentId, updatedAt: new Date() } }
  );

  await db.collection("employees").updateMany(
    { jobTitle: { $regex: new RegExp(`^${escapeRegExp(oldTitle)}$`, "i") }, ...filter },
    { $set: { jobTitle: trimmed, updatedAt: new Date() } }
  );

  return {
    id,
    title: trimmed,
    departmentId: (departmentId ?? (existing.departmentId as string)) || undefined,
    isPredefined: false,
    createdAt: existing.createdAt ? (existing.createdAt as Date).toISOString() : undefined,
  };
}

export async function deleteJobTitle(id: string, companyId: string): Promise<void> {
  const db = await getDb();
  const objId = new ObjectId(id);
  const cId = requireCompanyId(companyId);
  const filter = { companyId: cId };

  const titleDoc = await db.collection("job_titles").findOne({ _id: objId, ...filter });

  if (!titleDoc) {
    throw new Error("Job title not found.");
  }

  if (titleDoc.isPredefined) {
    throw new Error("Predefined system job titles cannot be deleted.");
  }

  const assignedEmployees = await db.collection("employees").countDocuments({
    jobTitle: titleDoc.title,
    status: "active",
    ...filter,
  });
  if (assignedEmployees > 0) {
    throw new Error(
      `Cannot delete "${titleDoc.title}" — it is currently held by ${assignedEmployees} active employee(s).`
    );
  }

  await db.collection("job_titles").deleteOne({ _id: objId, ...filter });
}


export async function getEmployeesByJobTitle(title: string, companyId: string): Promise<Employee[]> {
  const db = await getDb();
  // Always company-scoped: a title is a label, and every company has its own "Manager".
  const cId = requireCompanyId(companyId);
  const docs = await db
    .collection("employees")
    .find({ companyId: cId, jobTitle: { $regex: new RegExp(`^${escapeRegExp(title)}$`, "i") } })
    .sort({ status: 1, fullName: 1 })
    .toArray();

  return docs.map((doc) => ({
    id: (doc._id as ObjectId).toString(),
    fullName: (doc.fullName as string) || (doc.name as string) || "Unnamed Staff",
    email: (doc.email as string) || "",
    phone: (doc.phone as string) || undefined,
    jobTitle: (doc.jobTitle as string) || title,
    departmentId: (doc.departmentId as string) || "",
    departmentName: (doc.departmentName as string) || "General",
    hireDate: (doc.hireDate as string) || "2024-01-01",
    dateOfBirth: (doc.dateOfBirth as string) || undefined,
    baseSalary: Number(doc.baseSalary) || 0,
    status: (doc.status as "active" | "inactive") || "active",
    role: (doc.role as "employee" | "manager" | "hr_admin") || "employee",
    leaveAllowance: Number(doc.leaveAllowance) || 25,
    createdAt: doc.createdAt ? (doc.createdAt as Date).toISOString() : undefined,
    updatedAt: doc.updatedAt ? (doc.updatedAt as Date).toISOString() : undefined,
  }));
}

// ==========================================
// Employee Service Methods
// ==========================================

export async function getEmployees(filters: EmployeeFilterParams, companyId: string): Promise<Employee[]> {
  const db = await getDb();
  const cId = requireCompanyId(companyId);
  const query: Record<string, unknown> = { companyId: cId };

  if (filters.status && filters.status !== "all") {
    query.status = filters.status;
  }

  if (filters.departmentId) {
    query.departmentId = filters.departmentId;
  }

  if (filters.search && filters.search.trim()) {
    const term = filters.search.trim();
    query.$or = [
      { fullName: { $regex: escapeRegExp(term), $options: "i" } },
      { email: { $regex: escapeRegExp(term), $options: "i" } },
      { jobTitle: { $regex: escapeRegExp(term), $options: "i" } },
    ];
  }

  const docs = await db.collection("employees").find(query).sort({ fullName: 1 }).toArray();

  return docs.map((doc) => ({
    id: (doc._id as ObjectId).toString(),
    fullName: (doc.fullName as string) || (doc.name as string) || "Unnamed Staff",
    email: (doc.email as string) || "",
    phone: (doc.phone as string) || undefined,
    jobTitle: (doc.jobTitle as string) || "Staff Member",
    departmentId: (doc.departmentId as string) || "",
    departmentName: (doc.departmentName as string) || "General",
    hireDate: (doc.hireDate as string) || "2024-01-01",
    dateOfBirth: (doc.dateOfBirth as string) || undefined,
    baseSalary: Number(doc.baseSalary) || 0,
    status: (doc.status as "active" | "inactive") || "active",
    role: (doc.role as "employee" | "manager" | "hr_admin") || "employee",
    leaveAllowance: Number(doc.leaveAllowance) || 25,
    createdAt: doc.createdAt ? (doc.createdAt as Date).toISOString() : undefined,
    updatedAt: doc.updatedAt ? (doc.updatedAt as Date).toISOString() : undefined,
  }));
}

export async function getEmployeeById(id: string, companyId: string): Promise<Employee | null> {
  const db = await getDb();
  if (!ObjectId.isValid(id)) return null;

  const cId = requireCompanyId(companyId);
  const filter = { _id: new ObjectId(id), companyId: cId };

  const doc = await db.collection("employees").findOne(filter);
  if (!doc) return null;

  return {
    id: (doc._id as ObjectId).toString(),
    fullName: (doc.fullName as string) || (doc.name as string) || "Unnamed Staff",
    email: (doc.email as string) || "",
    phone: (doc.phone as string) || undefined,
    jobTitle: (doc.jobTitle as string) || "Staff Member",
    departmentId: (doc.departmentId as string) || "",
    departmentName: (doc.departmentName as string) || "General",
    hireDate: (doc.hireDate as string) || "2024-01-01",
    dateOfBirth: (doc.dateOfBirth as string) || undefined,
    baseSalary: Number(doc.baseSalary) || 0,
    status: (doc.status as "active" | "inactive") || "active",
    role: (doc.role as "employee" | "manager" | "hr_admin") || "employee",
    leaveAllowance: Number(doc.leaveAllowance) || 25,
    createdAt: doc.createdAt ? (doc.createdAt as Date).toISOString() : undefined,
    updatedAt: doc.updatedAt ? (doc.updatedAt as Date).toISOString() : undefined,
  };
}

export async function getEmployeeByEmail(email: string, companyId: string): Promise<Employee | null> {
  const db = await getDb();
  const normalized = email.toLowerCase().trim();
  const cId = requireCompanyId(companyId);
  const filter = { email: normalized, companyId: cId };

  const doc = await db.collection("employees").findOne(filter);
  if (!doc) return null;

  return {
    id: (doc._id as ObjectId).toString(),
    fullName: (doc.fullName as string) || (doc.name as string) || "Unnamed Staff",
    email: (doc.email as string) || "",
    phone: (doc.phone as string) || undefined,
    jobTitle: (doc.jobTitle as string) || "Staff Member",
    departmentId: (doc.departmentId as string) || "",
    departmentName: (doc.departmentName as string) || "General",
    hireDate: (doc.hireDate as string) || "2024-01-01",
    dateOfBirth: (doc.dateOfBirth as string) || undefined,
    baseSalary: Number(doc.baseSalary) || 0,
    status: (doc.status as "active" | "inactive") || "active",
    role: (doc.role as "employee" | "manager" | "hr_admin") || "employee",
    leaveAllowance: Number(doc.leaveAllowance) || 25,
    createdAt: doc.createdAt ? (doc.createdAt as Date).toISOString() : undefined,
    updatedAt: doc.updatedAt ? (doc.updatedAt as Date).toISOString() : undefined,
  };
}

export async function createEmployee(data: EmployeeInput, companyId: string): Promise<Employee & { tempPassword: string }> {
  const db = await getDb();
  const normalizedEmail = data.email.toLowerCase().trim();
  const cId = requireCompanyId(companyId);

  const existingFilter = { email: normalizedEmail, companyId: cId };
  const existing = await db.collection("employees").findOne(existingFilter);
  if (existing) {
    throw new Error(`An employee with email "${normalizedEmail}" already exists in this organization.`);
  }

  let deptName = "General";
  if (ObjectId.isValid(data.departmentId)) {
    const dept = await db.collection("departments").findOne({
      _id: new ObjectId(data.departmentId),
      ...({ companyId: cId }),
    });
    if (!dept) throw new Error("Choose a department that belongs to this company.");
    deptName = dept.name as string;
  }

  await ensureJobTitle(data.jobTitle, data.departmentId, false, cId?.toString());

  const newDoc = {
    fullName: data.fullName.trim(),
    email: normalizedEmail,
    phone: data.phone?.trim() || "",
    jobTitle: data.jobTitle.trim(),
    departmentId: data.departmentId,
    departmentName: deptName,
    hireDate: data.hireDate,
    dateOfBirth: data.dateOfBirth?.trim() || undefined,
    baseSalary: data.baseSalary,
    role: data.role,
    status: data.status,
    leaveAllowance: data.leaveAllowance,
    ...({ companyId: cId }),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const result = await db.collection("employees").insertOne(newDoc);
  const empId = result.insertedId.toString();

  // Auto-seed defaults (leave types, policies, public holidays) if new company
  await seedHrDefaultsForCompany(companyId);

  // Auto-assign Tunisian leave policy based on age
  const category = getAgeCategory(data.dateOfBirth, new Date(data.hireDate || Date.now()));
  const policy = (await db.collection("leave_policies").findOne({
    companyId: cId,
    employeeCategory: category,
    isActive: true,
  })) || (await db.collection("leave_policies").findOne({
    companyId: cId,
    isActive: true,
  }));

  if (policy) {
    await db.collection("employee_leave_policies").insertOne({
      companyId: cId,
      employeeId: empId,
      leavePolicyId: policy._id.toString(),
      policyName: policy.name,
      effectiveFrom: data.hireDate,
      assignedBy: "system_auto_age",
      assignedAt: new Date(),
    });

    // Initial accrual upon onboarding for months worked in the current year
    const hire = new Date(data.hireDate);
    const now = new Date();
    if (hire <= now && hire.getFullYear() === now.getFullYear()) {
      const monthsWorked = Math.max(1, (now.getMonth() - hire.getMonth()) + 1);
      const accrualRate = Number(policy.accrualRate) || 1.0;
      const initialDays = Math.min(Number(policy.annualCap) || 15, Math.round(monthsWorked * accrualRate * 2) / 2);

      const cpType = await db.collection("leave_types").findOne({ companyId: cId, code: "CP" });
      await db.collection("leave_transactions").insertOne({
        companyId: cId,
        employeeId: empId,
        employeeName: newDoc.fullName,
        leaveTypeId: cpType?._id?.toString(),
        leaveTypeCode: "CP",
        transactionType: "ACCRUAL",
        days: initialDays,
        effectiveDate: data.hireDate,
        description: `Initial accrual upon onboarding (${monthsWorked} month(s) effective work @ ${accrualRate}d/mo)`,
        createdBy: "system",
        createdAt: new Date(),
      });
    }
  }

  // Auto-provision a users account for the new employee
  const tempPassword = crypto.randomBytes(9).toString("base64url").slice(0, 12);
  const hashedPassword = await bcrypt.hash(tempPassword, 12);
  const userUpsert = await db.collection("users").findOneAndUpdate(
    { email: normalizedEmail },
    {
      $setOnInsert: {
        email: normalizedEmail,
        name: data.fullName.trim(),
        password: hashedPassword,
        status: "active",
        forcePasswordReset: true,
        emailVerified: new Date(), // skip email verification for HR-provisioned accounts
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    },
    { upsert: true, returnDocument: "after" }
  );

  // Add user as member to company_members if company is known
  if (cId && userUpsert && "_id" in userUpsert && userUpsert._id) {
    const memberRole = data.role === "hr_admin" ? "admin" : (data.role === "manager" ? "manager" : "employee");
    await db.collection("company_members").updateOne(
      { companyId: cId, userId: userUpsert._id as ObjectId },
      {
        $setOnInsert: {
          companyId: cId,
          userId: userUpsert._id as ObjectId,
          role: memberRole,
          status: "active",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );
  }

  return {
    id: result.insertedId.toString(),
    fullName: newDoc.fullName,
    email: newDoc.email,
    phone: newDoc.phone || undefined,
    jobTitle: newDoc.jobTitle,
    departmentId: newDoc.departmentId,
    departmentName: newDoc.departmentName,
    hireDate: newDoc.hireDate,
    baseSalary: newDoc.baseSalary,
    role: newDoc.role,
    status: newDoc.status,
    leaveAllowance: newDoc.leaveAllowance,
    createdAt: newDoc.createdAt.toISOString(),
    updatedAt: newDoc.updatedAt.toISOString(),
    tempPassword, // shown once to HR admin
  };
}

export async function updateEmployee(id: string, data: EmployeeInput, companyId: string): Promise<Employee> {
  const db = await getDb();
  if (!ObjectId.isValid(id)) {
    throw new Error("Invalid employee ID.");
  }
  const objId = new ObjectId(id);
  const normalizedEmail = data.email.toLowerCase().trim();
  const cId = requireCompanyId(companyId);
  const compFilter = { companyId: cId };

  const existingWithEmail = await db.collection("employees").findOne({
    _id: { $ne: objId },
    email: normalizedEmail,
    ...compFilter,
  });
  if (existingWithEmail) {
    throw new Error(`An employee with email "${normalizedEmail}" already exists in this organization.`);
  }

  let deptName = "General";
  if (ObjectId.isValid(data.departmentId)) {
    const dept = await db.collection("departments").findOne({ _id: new ObjectId(data.departmentId), ...compFilter });
    if (!dept) throw new Error("Choose a department that belongs to this company.");
    deptName = dept.name as string;
  }

  await ensureJobTitle(data.jobTitle, data.departmentId, false, cId?.toString());

  const updateFields = {
    fullName: data.fullName.trim(),
    email: normalizedEmail,
    phone: data.phone?.trim() || "",
    jobTitle: data.jobTitle.trim(),
    departmentId: data.departmentId,
    departmentName: deptName,
    hireDate: data.hireDate,
    dateOfBirth: data.dateOfBirth?.trim() || undefined,
    baseSalary: data.baseSalary,
    role: data.role,
    status: data.status,
    leaveAllowance: data.leaveAllowance,
    updatedAt: new Date(),
  };

  await db.collection("employees").updateOne({ _id: objId, ...compFilter }, { $set: updateFields });

  const updated = await getEmployeeById(id, cId?.toString());
  if (!updated) {
    throw new Error("Employee not found after update.");
  }
  return updated;
}

export async function toggleEmployeeStatus(id: string, companyId: string): Promise<{ id: string; newStatus: "active" | "inactive" }> {
  const db = await getDb();
  if (!ObjectId.isValid(id)) {
    throw new Error("Invalid employee ID.");
  }
  const objId = new ObjectId(id);
  const cId = requireCompanyId(companyId);
  const compFilter = { companyId: cId };

  const emp = await db.collection("employees").findOne({ _id: objId, ...compFilter });
  if (!emp) {
    throw new Error("Employee not found.");
  }

  const newStatus: "active" | "inactive" = emp.status === "active" ? "inactive" : "active";
  await db.collection("employees").updateOne(
    { _id: objId, ...compFilter },
    { $set: { status: newStatus, updatedAt: new Date() } }
  );

  return { id, newStatus };
}

export async function getHRDashboardStats(companyId: string): Promise<HRDashboardStats> {
  const db = await getDb();
  const cId = requireCompanyId(companyId);


  const filter = { companyId: cId };

  const [employees, departments, jobTitles] = await Promise.all([
    db.collection("employees").find(filter).toArray(),
    db.collection("departments").countDocuments(filter),
    db.collection("job_titles").countDocuments(filter),
  ]);

  const total = employees.length;
  let active = 0;
  let salarySum = 0;

  employees.forEach((e) => {
    if (e.status === "active") {
      active++;
      salarySum += Number(e.baseSalary) || 0;
    }
  });

  const inactive = total - active;
  const avgSalary = active > 0 ? Math.round(salarySum / active) : 0;

  return {
    totalEmployees: total,
    activeEmployees: active,
    inactiveEmployees: inactive,
    departmentCount: departments,
    jobTitleCount: jobTitles,
    averageSalary: avgSalary,
    monthlyPayrollGross: salarySum,
  };
}

// ==========================================
// Feature 2: Leave & Time-off Service Methods
// ==========================================

// ==========================================
// Feature 2: Solde de Congé & Leave Service Methods
// ==========================================

export async function getLeaveTypes(companyId: string): Promise<LeaveTypeRecord[]> {
  const db = await getDb();
  const cId = requireCompanyId(companyId);
  await seedHrDefaultsForCompany(companyId);

  const docs = await db.collection("leave_types").find({ companyId: cId, isActive: true }).sort({ code: 1 }).toArray();
  return docs.map((d) => ({
    id: (d._id as ObjectId).toString(),
    companyId: companyId,
    name: d.name as string,
    code: d.code as string,
    isPaid: Boolean(d.isPaid),
    requiresApproval: Boolean(d.requiresApproval),
    requiresDocument: Boolean(d.requiresDocument),
    isActive: Boolean(d.isActive),
    createdAt: d.createdAt ? (d.createdAt as Date).toISOString() : new Date().toISOString(),
  }));
}

export async function getLeavePolicies(companyId: string): Promise<LeavePolicyRecord[]> {
  const db = await getDb();
  const cId = requireCompanyId(companyId);
  await seedHrDefaultsForCompany(companyId);

  const docs = await db.collection("leave_policies").find({ companyId: cId, isActive: true }).sort({ employeeCategory: 1 }).toArray();
  return docs.map((d) => ({
    id: (d._id as ObjectId).toString(),
    companyId: companyId,
    name: d.name as string,
    country: (d.country as string) || "TN",
    employeeCategory: d.employeeCategory as EmployeeCategory,
    accrualRate: Number(d.accrualRate) || 1.0,
    accrualPeriod: "monthly",
    annualCap: Number(d.annualCap) || 15,
    referencePeriodType: "calendar_year",
    calculationMethod: "standard_monthly",
    roundingRule: "half_day",
    effectiveFrom: (d.effectiveFrom as string) || "2024-01-01",
    effectiveTo: (d.effectiveTo as string) || undefined,
    legalReference: (d.legalReference as string) || "Code du Travail Art. 113-114",
    isActive: Boolean(d.isActive),
    createdAt: d.createdAt ? (d.createdAt as Date).toISOString() : new Date().toISOString(),
  }));
}

export async function getEmployeeLeavePolicy(
  employeeId: string,
  companyId: string,
  asOfDateStr?: string
): Promise<LeavePolicyRecord | null> {
  const db = await getDb();
  const cId = requireCompanyId(companyId);
  await seedHrDefaultsForCompany(companyId);

  const asOf = asOfDateStr || formatDateYMD(new Date());

  // Check specific employee policy assignment
  const assignment = await db.collection("employee_leave_policies").findOne({
    companyId: cId,
    employeeId,
    effectiveFrom: { $lte: asOf },
    $or: [{ effectiveTo: { $exists: false } }, { effectiveTo: "" }, { effectiveTo: { $gte: asOf } }],
  });

  if (assignment && ObjectId.isValid(assignment.leavePolicyId)) {
    const policyDoc = await db.collection("leave_policies").findOne({
      _id: new ObjectId(assignment.leavePolicyId as string),
      companyId: cId,
    });
    if (policyDoc) {
      return {
        id: (policyDoc._id as ObjectId).toString(),
        companyId,
        name: policyDoc.name as string,
        country: (policyDoc.country as string) || "TN",
        employeeCategory: policyDoc.employeeCategory as EmployeeCategory,
        accrualRate: Number(policyDoc.accrualRate) || 1.0,
        accrualPeriod: "monthly",
        annualCap: Number(policyDoc.annualCap) || 15,
        referencePeriodType: "calendar_year",
        calculationMethod: "standard_monthly",
        roundingRule: "half_day",
        effectiveFrom: (policyDoc.effectiveFrom as string) || "2024-01-01",
        effectiveTo: (policyDoc.effectiveTo as string) || undefined,
        legalReference: (policyDoc.legalReference as string) || "Code du Travail Art. 113-114",
        isActive: Boolean(policyDoc.isActive),
        createdAt: policyDoc.createdAt ? (policyDoc.createdAt as Date).toISOString() : new Date().toISOString(),
      };
    }
  }

  // Fallback: auto-match by employee age category
  const emp = await getEmployeeById(employeeId, companyId);
  const category = getAgeCategory(emp?.dateOfBirth, new Date(asOf));
  const defaultPolicy = (await db.collection("leave_policies").findOne({
    companyId: cId,
    employeeCategory: category,
    isActive: true,
  })) || (await db.collection("leave_policies").findOne({ companyId: cId, isActive: true }));

  if (!defaultPolicy) return null;

  return {
    id: (defaultPolicy._id as ObjectId).toString(),
    companyId,
    name: defaultPolicy.name as string,
    country: (defaultPolicy.country as string) || "TN",
    employeeCategory: defaultPolicy.employeeCategory as EmployeeCategory,
    accrualRate: Number(defaultPolicy.accrualRate) || 1.0,
    accrualPeriod: "monthly",
    annualCap: Number(defaultPolicy.annualCap) || 15,
    referencePeriodType: "calendar_year",
    calculationMethod: "standard_monthly",
    roundingRule: "half_day",
    effectiveFrom: (defaultPolicy.effectiveFrom as string) || "2024-01-01",
    effectiveTo: (defaultPolicy.effectiveTo as string) || undefined,
    legalReference: (defaultPolicy.legalReference as string) || "Code du Travail Art. 113-114",
    isActive: Boolean(defaultPolicy.isActive),
    createdAt: defaultPolicy.createdAt ? (defaultPolicy.createdAt as Date).toISOString() : new Date().toISOString(),
  };
}

export async function getPublicHolidays(companyId: string): Promise<PublicHolidayRecord[]> {
  const db = await getDb();
  const cId = requireCompanyId(companyId);
  await seedHrDefaultsForCompany(companyId);

  const docs = await db.collection("public_holidays").find({ companyId: cId }).sort({ date: 1 }).toArray();
  return docs.map((d) => ({
    id: (d._id as ObjectId).toString(),
    companyId,
    name: d.name as string,
    date: d.date as string,
    isHalfDay: Boolean(d.isHalfDay),
  }));
}

// ==========================================
// Append-Only Leave Transaction Ledger
// ==========================================

export async function createLeaveTransaction(
  data: Omit<LeaveTransactionRecord, "id" | "createdAt">,
  companyId: string
): Promise<LeaveTransactionRecord> {
  const db = await getDb();
  const cId = requireCompanyId(companyId);

  const doc = {
    ...data,
    companyId: cId,
    createdAt: new Date(),
  };

  const res = await db.collection("leave_transactions").insertOne(doc);

  return {
    id: res.insertedId.toString(),
    companyId,
    employeeId: data.employeeId,
    employeeName: data.employeeName,
    leaveTypeId: data.leaveTypeId,
    leaveTypeCode: data.leaveTypeCode,
    transactionType: data.transactionType,
    days: data.days,
    effectiveDate: data.effectiveDate,
    referenceId: data.referenceId,
    description: data.description,
    createdBy: data.createdBy,
    createdAt: doc.createdAt.toISOString(),
  };
}

export async function getLeaveTransactions(
  filter: { employeeId?: string; leaveTypeId?: string } = {},
  companyId: string
): Promise<LeaveTransactionRecord[]> {
  const db = await getDb();
  const cId = requireCompanyId(companyId);

  const query: Record<string, unknown> = { companyId: cId };
  if (filter.employeeId) query.employeeId = filter.employeeId;
  if (filter.leaveTypeId) query.leaveTypeId = filter.leaveTypeId;

  const docs = await db.collection("leave_transactions").find(query).sort({ effectiveDate: -1, createdAt: -1 }).toArray();

  return docs.map((d) => ({
    id: (d._id as ObjectId).toString(),
    companyId,
    employeeId: d.employeeId as string,
    employeeName: d.employeeName as string | undefined,
    leaveTypeId: d.leaveTypeId as string | undefined,
    leaveTypeCode: d.leaveTypeCode as string | undefined,
    transactionType: d.transactionType as LeaveTransactionRecord["transactionType"],
    days: Number(d.days) || 0,
    effectiveDate: d.effectiveDate as string,
    referenceId: d.referenceId as string | undefined,
    description: d.description as string,
    createdBy: d.createdBy as string,
    createdAt: d.createdAt ? (d.createdAt as Date).toISOString() : new Date().toISOString(),
  }));
}

// ==========================================
// Solde de Congé Derived Balance Calculation
// ==========================================

export async function getSoldeDeConge(
  employeeId: string,
  year = new Date().getFullYear(),
  companyId: string,
  asOfDateStr?: string
): Promise<SoldeDeConge> {
  const db = await getDb();
  const cId = requireCompanyId(companyId);
  const emp = await getEmployeeById(employeeId, companyId);
  const employeeName = emp?.fullName || "Employee";

  // Ensure defaults are available
  await seedHrDefaultsForCompany(companyId);

  // Sync any approved leaves whose end date passed into confirmed TAKEN transactions
  await syncTakenLeaveRequests(companyId);

  const asOf = asOfDateStr || formatDateYMD(new Date());
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  // Fetch transactions for employee
  // Reservations and releases are commitments made today for leave that may start later, so they count immediately.
  // Filtering them by their effective date hid every approved future leave from the balance (and a release of one
  // then cancelled a different reservation). Accruals, taken days and adjustments stay as-of the date.
  const txDocs = await db.collection("leave_transactions").find({
    companyId: cId,
    employeeId,
    $or: [{ effectiveDate: { $lte: asOf } }, { transactionType: { $in: ["RESERVATION", "RELEASE"] } }],
  }).toArray();

  // If no transactions exist, auto-bootstrap initial accrual from hire date
  if (txDocs.length === 0 && emp) {
    const hire = new Date(emp.hireDate);
    const now = new Date(asOf);
    const monthsWorked = hire.getFullYear() === year ? Math.max(1, (now.getMonth() - hire.getMonth()) + 1) : 12;
    const policy = await getEmployeeLeavePolicy(employeeId, companyId, asOf);
    const rate = policy?.accrualRate ?? 1.0;
    const cap = policy?.annualCap ?? 15;
    const initialDays = Math.min(cap, Math.round(monthsWorked * rate * 2) / 2);

    const cpType = await db.collection("leave_types").findOne({ companyId: cId, code: "CP" });
    const bootTx = {
      _id: new ObjectId(),
      companyId: cId,
      employeeId,
      employeeName,
      leaveTypeId: cpType?._id?.toString(),
      leaveTypeCode: "CP",
      transactionType: "ACCRUAL" as const,
      days: initialDays,
      effectiveDate: emp.hireDate,
      description: `Opening accrual (${monthsWorked} month(s) effective work @ ${rate}d/mo)`,
      createdBy: "system_bootstrap",
      createdAt: new Date(),
    };
    await db.collection("leave_transactions").insertOne(bootTx);
    txDocs.push(bootTx);
  }

  let earned = 0;
  let taken = 0;
  let reserved = 0;
  let adjustments = 0;

  for (const tx of txDocs) {
    const days = Number(tx.days) || 0;
    switch (tx.transactionType) {
      case "ACCRUAL":
        earned += days;
        break;
      case "TAKEN":
        taken += days;
        break;
      case "RESERVATION":
        reserved += days;
        break;
      case "RELEASE":
        reserved -= days; // reduces active reservation
        break;
      case "ADJUSTMENT":
      case "REVERSAL":
      case "COMPENSATION":
        adjustments += days;
        break;
      default:
        break;
    }
  }

  // Ensure active reservations do not fall below zero
  reserved = Math.max(0, Math.round(reserved * 100) / 100);
  earned = Math.round(earned * 100) / 100;
  taken = Math.round(taken * 100) / 100;
  adjustments = Math.round(adjustments * 100) / 100;

  const available = Math.max(0, Math.round((earned - taken - reserved + adjustments) * 100) / 100);

  // Compute unpaid days taken for payroll deduction
  const unpaidRequests = await db.collection("leave_requests").find({
    companyId: cId,
    employeeId,
    status: { $in: ["approved", "taken"] },
    isPaid: false,
    startDate: { $gte: yearStart, $lte: yearEnd },
  }).toArray();

  let unpaidDaysTaken = 0;
  unpaidRequests.forEach((r) => {
    unpaidDaysTaken += Number(r.days) || 0;
  });

  const activePolicy = await getEmployeeLeavePolicy(employeeId, companyId, asOf);

  return {
    employeeId,
    employeeName,
    year,
    earned,
    taken,
    reserved,
    adjustments,
    available,
    unpaidDaysTaken,
    asOfDate: asOf,
    policySummary: activePolicy
      ? {
          name: activePolicy.name,
          accrualRate: activePolicy.accrualRate,
          annualCap: activePolicy.annualCap,
          legalReference: activePolicy.legalReference,
        }
      : undefined,
  };
}

/**
 * Backwards-compatible leave balance lookup, backed by the Solde de Congé ledger
 */
export async function getLeaveBalance(
  employeeId: string,
  year = new Date().getFullYear(),
  companyId: string
): Promise<LeaveBalance> {
  const solde = await getSoldeDeConge(employeeId, year, companyId);

  return {
    employeeId,
    employeeName: solde.employeeName,
    year,
    allowance: solde.earned,
    usedPaidDays: solde.taken,
    remainingDays: solde.available,
    unpaidDaysTaken: solde.unpaidDaysTaken,
    earned: solde.earned,
    taken: solde.taken,
    reserved: solde.reserved,
    adjustments: solde.adjustments,
    available: solde.available,
    policySummary: solde.policySummary,
  };
}

// ==========================================
// Monthly Accrual Engine (Idempotent)
// ==========================================

export async function runMonthlyAccrual(
  companyId: string,
  periodDateStr?: string,
  adminUserId = "admin"
): Promise<{ processed: number; accruedEmployees: string[] }> {
  const db = await getDb();
  const cId = requireCompanyId(companyId);
  await seedHrDefaultsForCompany(companyId);

  const date = periodDateStr ? new Date(periodDateStr) : new Date();
  const periodMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  const effectiveDate = periodDateStr || formatDateYMD(date);

  const activeEmployees = await db.collection("employees").find({
    companyId: cId,
    status: "active",
  }).toArray();

  const cpType = await db.collection("leave_types").findOne({ companyId: cId, code: "CP" });
  const accruedEmployees: string[] = [];

  for (const empDoc of activeEmployees) {
    const empId = (empDoc._id as ObjectId).toString();
    const empName = (empDoc.fullName as string) || "Staff";

    // Check idempotency: avoid double-posting for same month and employee
    const alreadyAccrued = await db.collection("leave_transactions").findOne({
      companyId: cId,
      employeeId: empId,
      transactionType: "ACCRUAL",
      $or: [
        { referenceId: `ACCRUAL_${periodMonth}` },
        { description: { $regex: new RegExp(`P[eé]riod(e)? ${periodMonth}`, "i") } },
      ],
    });

    if (alreadyAccrued) continue;

    const policy = await getEmployeeLeavePolicy(empId, companyId, effectiveDate);
    if (!policy) continue;

    // Check annual cap
    const solde = await getSoldeDeConge(empId, date.getFullYear(), companyId, effectiveDate);
    const rate = policy.accrualRate;
    const remainingToCap = Math.max(0, policy.annualCap - solde.earned);
    const daysToAccrue = Math.min(rate, remainingToCap);

    if (daysToAccrue <= 0) continue;

    await createLeaveTransaction(
      {
        companyId,
        employeeId: empId,
        employeeName: empName,
        leaveTypeId: cpType?._id?.toString(),
        leaveTypeCode: "CP",
        transactionType: "ACCRUAL",
        days: daysToAccrue,
        effectiveDate,
        referenceId: `ACCRUAL_${periodMonth}`,
        description: `Monthly leave accrual — Period ${periodMonth} (+${daysToAccrue}d)`,
        createdBy: adminUserId,
      },
      companyId
    );

    accruedEmployees.push(empName);
  }

  return {
    processed: activeEmployees.length,
    accruedEmployees,
  };
}

// ==========================================
// Manual Adjustments & Reversals
// ==========================================

export async function createManualAdjustment(
  input: LeaveAdjustmentInput,
  adminUserId: string,
  adminName: string,
  companyId: string,
  actor?: HrActor
): Promise<LeaveTransactionRecord> {
  if (actor && !actor.isAdmin) throw new Error("Forbidden: Only HR administrators can adjust leave balances.");
  const cId = requireCompanyId(companyId);
  const emp = await getEmployeeById(input.employeeId, companyId);
  if (!emp) throw new Error("Employee not found.");

  if (!input.reason || input.reason.trim().length < 3) {
    throw new Error("A mandatory reason (at least 3 characters) is required for any manual balance adjustment.");
  }

  const db = await getDb();
  let leaveTypeCode = "CP";
  if (input.leaveTypeId && ObjectId.isValid(input.leaveTypeId)) {
    const lt = await db.collection("leave_types").findOne({ _id: new ObjectId(input.leaveTypeId), companyId: cId });
    if (lt) leaveTypeCode = lt.code as string;
  }

  return await createLeaveTransaction(
    {
      companyId,
      employeeId: input.employeeId,
      employeeName: emp.fullName,
      leaveTypeId: input.leaveTypeId,
      leaveTypeCode,
      transactionType: "ADJUSTMENT",
      days: Number(input.days),
      effectiveDate: formatDateYMD(new Date()),
      description: `Ajustement manuel: ${input.reason.trim()} (par ${adminName})`,
      createdBy: adminUserId,
    },
    companyId
  );
}

export async function reverseLeaveTransaction(
  transactionId: string,
  reason: string,
  adminUserId: string,
  companyId: string
): Promise<LeaveTransactionRecord> {
  const db = await getDb();
  if (!ObjectId.isValid(transactionId)) throw new Error("Invalid transaction ID.");
  const cId = requireCompanyId(companyId);

  const tx = await db.collection("leave_transactions").findOne({
    _id: new ObjectId(transactionId),
    companyId: cId,
  });

  if (!tx) throw new Error("Transaction not found.");

  const reversedDays = -Number(tx.days);

  return await createLeaveTransaction(
    {
      companyId,
      employeeId: tx.employeeId as string,
      employeeName: tx.employeeName as string | undefined,
      leaveTypeId: tx.leaveTypeId as string | undefined,
      leaveTypeCode: tx.leaveTypeCode as string | undefined,
      transactionType: "REVERSAL",
      days: reversedDays,
      effectiveDate: formatDateYMD(new Date()),
      referenceId: transactionId,
      description: `Reversal of transaction #${transactionId.slice(-6)}: ${reason.trim()}`,
      createdBy: adminUserId,
    },
    companyId
  );
}

// ==========================================
// Leave Request Lifecycle & Sync
// ==========================================

export async function getLeaveRequests(
  filter: { employeeId?: string; status?: string } = {},
  companyId: string
): Promise<LeaveRequest[]> {
  const db = await getDb();
  const cId = requireCompanyId(companyId);

  const query: Record<string, unknown> = { companyId: cId };
  if (filter.employeeId) {
    query.employeeId = filter.employeeId;
  }
  if (filter.status && filter.status !== "all") {
    query.status = filter.status;
  }

  const docs = await db.collection("leave_requests").find(query).sort({ createdAt: -1 }).toArray();

  return docs.map((doc) => ({
    id: (doc._id as ObjectId).toString(),
    employeeId: doc.employeeId as string,
    employeeName: (doc.employeeName as string) || "Staff",
    departmentName: (doc.departmentName as string) || "General",
    leaveType: doc.leaveType as LeaveType,
    leaveTypeId: doc.leaveTypeId as string | undefined,
    isPaid: Boolean(doc.isPaid),
    startDate: doc.startDate as string,
    endDate: doc.endDate as string,
    days: Number(doc.days) || 1,
    requestedDays: Number(doc.requestedDays) || Number(doc.days) || 1,
    approvedDays: doc.approvedDays ? Number(doc.approvedDays) : undefined,
    halfDayOption: doc.halfDayOption as "morning" | "afternoon" | undefined,
    supportingDocumentUrl: doc.supportingDocumentUrl as string | undefined,
    cancellationReason: doc.cancellationReason as string | undefined,
    reason: doc.reason as string,
    status: doc.status as LeaveStatus,
    adminComment: doc.adminComment as string | undefined,
    reviewedBy: doc.reviewedBy as string | undefined,
    reviewedAt: doc.reviewedAt ? (doc.reviewedAt as Date).toISOString() : undefined,
    createdAt: doc.createdAt ? (doc.createdAt as Date).toISOString() : new Date().toISOString(),
    updatedAt: doc.updatedAt ? (doc.updatedAt as Date).toISOString() : undefined,
  }));
}

export type LeaveAssessment = {
  days: number;
  isPaid: boolean;
  holidaysInRange: string[];
  /** Null for unpaid leave, which does not touch the balance. */
  balanceBefore: number | null;
  balanceAfter: number | null;
  /** Rule violations, most fundamental first. Empty means the request can be submitted. */
  errors: string[];
};

/**
 * Read-only check of a leave request: working days, overlap and balance.
 * The single source of these rules: `createLeaveRequest` and the HR Copilot both use it.
 */
export async function assessLeaveRequest(
  data: Pick<LeaveRequestInput, "employeeId" | "leaveType" | "leaveTypeId" | "startDate" | "endDate" | "halfDayOption" | "isPaid">,
  companyId: string
): Promise<LeaveAssessment> {
  const db = await getDb();
  const cId = requireCompanyId(companyId);
  const errors: string[] = [];

  // Public holidays exclusion
  const holidays = await getPublicHolidays(companyId);
  const holidayDates = holidays.map((h) => h.date);

  const days = calculateLeaveDays(data.startDate, data.endDate, holidayDates, data.halfDayOption);
  if (days <= 0) {
    errors.push("Calculated duration cannot be zero working days.");
  }

  // Check overlapping requests
  const overlap = await db.collection("leave_requests").findOne({
    employeeId: data.employeeId,
    status: { $in: ["approved", "pending", "taken"] },
    companyId: cId,
    $or: [{ startDate: { $lte: data.endDate }, endDate: { $gte: data.startDate } }],
  });

  if (overlap) {
    errors.push(
      `An existing ${overlap.status} leave request already overlaps with dates ${data.startDate} to ${data.endDate}.`
    );
  }

  // Determine if paid or unpaid based on leaveType or selected leaveTypeId
  let isPaid = data.leaveType === "unpaid" ? false : (data.isPaid ?? true);
  if (data.leaveTypeId && ObjectId.isValid(data.leaveTypeId)) {
    const lt = await db.collection("leave_types").findOne({ _id: new ObjectId(data.leaveTypeId), companyId: cId });
    if (lt) isPaid = Boolean(lt.isPaid);
  }

  let balanceBefore: number | null = null;
  let balanceAfter: number | null = null;
  if (isPaid) {
    const currentYear = new Date(data.startDate).getFullYear();
    const solde = await getSoldeDeConge(data.employeeId, currentYear, companyId);
    balanceBefore = solde.available;
    balanceAfter = Math.round((solde.available - days) * 100) / 100;
    if (days > solde.available) {
      errors.push(
        `Requested duration (${days} days) exceeds available Solde de congé (${solde.available} days available of ${solde.earned} earned). Submit as unpaid leave or reduce duration.`
      );
    }
  }

  return {
    days,
    isPaid,
    holidaysInRange: holidayDates.filter((date) => date >= data.startDate && date <= data.endDate),
    balanceBefore,
    balanceAfter,
    errors,
  };
}

export async function createLeaveRequest(data: LeaveRequestInput, companyId: string): Promise<LeaveRequest> {
  const db = await getDb();
  const cId = requireCompanyId(companyId);
  const emp = await getEmployeeById(data.employeeId, companyId);
  if (!emp) {
    throw new Error("Employee not found.");
  }

  const { days, isPaid, errors } = await assessLeaveRequest(data, companyId);
  if (errors.length > 0) {
    throw new Error(errors[0]);
  }

  const doc = {
    employeeId: data.employeeId,
    employeeName: emp.fullName,
    departmentName: emp.departmentName,
    leaveType: data.leaveType,
    leaveTypeId: data.leaveTypeId,
    isPaid,
    startDate: data.startDate,
    endDate: data.endDate,
    days,
    requestedDays: days,
    halfDayOption: data.halfDayOption,
    supportingDocumentUrl: data.supportingDocumentUrl,
    reason: data.reason.trim(),
    status: "pending" as LeaveStatus,
    companyId: cId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const res = await db.collection("leave_requests").insertOne(doc);

  return {
    id: res.insertedId.toString(),
    employeeId: doc.employeeId,
    employeeName: doc.employeeName,
    departmentName: doc.departmentName,
    leaveType: doc.leaveType as LeaveType,
    leaveTypeId: doc.leaveTypeId,
    isPaid: doc.isPaid,
    startDate: doc.startDate,
    endDate: doc.endDate,
    days: doc.days,
    requestedDays: doc.days,
    halfDayOption: doc.halfDayOption,
    supportingDocumentUrl: doc.supportingDocumentUrl,
    reason: doc.reason,
    status: doc.status,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

/**
 * Who is asking, for callers that act on someone's behalf (the AI Command Center). Optional so existing callers
 * (server actions, which check roles themselves) are unchanged; when given, the service enforces it too.
 */
export type HrActor = { isAdmin: boolean; employeeId?: string | null };

export async function reviewLeaveRequest(
  input: LeaveReviewInput,
  reviewerName = "HR Administrator",
  companyId: string,
  actor?: HrActor
): Promise<LeaveRequest> {
  if (actor && !actor.isAdmin) throw new Error("Forbidden: Only HR administrators can review leave requests.");
  const db = await getDb();
  if (!ObjectId.isValid(input.requestId)) {
    throw new Error("Invalid leave request ID.");
  }
  const objId = new ObjectId(input.requestId);
  const cId = requireCompanyId(companyId);
  const filter = { _id: objId, companyId: cId };

  const existing = await db.collection("leave_requests").findOne(filter);
  if (!existing) {
    throw new Error("Leave request not found.");
  }

  // Only a pending request can be decided. Without this a second approval posted a second reservation and deducted the leave twice.
  if (existing.status !== "pending") {
    throw new Error(`Only pending requests can be reviewed. This one is ${String(existing.status)}.`);
  }

  const newStatus: LeaveStatus = input.action === "approve" ? "approved" : "rejected";
  const days = Number(existing.days) || 1;
  const isPaid = Boolean(existing.isPaid);
  let overdraftDays = 0;

  if (input.action === "approve" && isPaid) {
    const currentYear = new Date(existing.startDate as string).getFullYear();
    const solde = await getSoldeDeConge(existing.employeeId as string, currentYear, companyId);

    // Overdraft check
    if (days > solde.available) {
      if (!input.overrideReason || input.overrideReason.trim().length < 3) {
        throw new Error(
          `Insufficient Solde de congé: Requested ${days} days but only ${solde.available} days are available. An admin override reason is mandatory to approve an overdraft.`
        );
      }
      overdraftDays = days - solde.available;
    }
  }

  // Claim the decision atomically: of two concurrent reviews exactly one wins.
  const claim = await db.collection("leave_requests").updateOne(
    { ...filter, status: "pending" },
    {
      $set: {
        status: newStatus,
        adminComment: input.adminComment?.trim() || undefined,
        reviewedBy: reviewerName,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      },
    }
  );
  if (claim.matchedCount === 0) throw new Error("This request was already decided by someone else.");

  if (input.action === "approve" && isPaid) {
    try {
      if (overdraftDays > 0) {
        await createLeaveTransaction(
          {
            companyId,
            employeeId: existing.employeeId as string,
            employeeName: existing.employeeName as string,
            leaveTypeId: existing.leaveTypeId as string | undefined,
            transactionType: "ADJUSTMENT",
            days: overdraftDays,
            effectiveDate: formatDateYMD(new Date()),
            referenceId: input.requestId,
            description: `Exceptional overdraft approval: ${(input.overrideReason ?? "").trim()}`,
            createdBy: reviewerName,
          },
          companyId
        );
      }
      // Post RESERVATION transaction to lock the balance
      await createLeaveTransaction(
        {
          companyId,
          employeeId: existing.employeeId as string,
          employeeName: existing.employeeName as string,
          leaveTypeId: existing.leaveTypeId as string | undefined,
          transactionType: "RESERVATION",
          days,
          effectiveDate: existing.startDate as string,
          referenceId: input.requestId,
          description: `Reservation for leave request #${input.requestId.slice(-6)} (${existing.startDate} → ${existing.endDate})`,
          createdBy: reviewerName,
        },
        companyId
      );
    } catch (error) {
      // The ledger could not be written, so the decision must not stand.
      await db.collection("leave_requests").updateOne(filter, { $set: { status: "pending", updatedAt: new Date() }, $unset: { reviewedBy: "", reviewedAt: "" } });
      throw error;
    }
  }

  const updated = await db.collection("leave_requests").findOne(filter);
  if (!updated) throw new Error("Could not load updated leave request.");

  return {
    id: updated._id.toString(),
    employeeId: updated.employeeId as string,
    employeeName: updated.employeeName as string,
    departmentName: updated.departmentName as string,
    leaveType: updated.leaveType as LeaveType,
    leaveTypeId: updated.leaveTypeId as string | undefined,
    isPaid: Boolean(updated.isPaid),
    startDate: updated.startDate as string,
    endDate: updated.endDate as string,
    days: Number(updated.days) || 1,
    reason: updated.reason as string,
    status: updated.status as LeaveStatus,
    adminComment: updated.adminComment as string | undefined,
    reviewedBy: updated.reviewedBy as string | undefined,
    reviewedAt: updated.reviewedAt ? (updated.reviewedAt as Date).toISOString() : undefined,
    createdAt: (updated.createdAt as Date).toISOString(),
    updatedAt: (updated.updatedAt as Date).toISOString(),
  };
}

export async function cancelLeaveRequest(
  requestId: string,
  reason: string,
  actorName = "Employee",
  companyId: string,
  actor?: HrActor
): Promise<LeaveRequest> {
  const db = await getDb();
  if (!ObjectId.isValid(requestId)) throw new Error("Invalid leave request ID.");
  const objId = new ObjectId(requestId);
  const cId = requireCompanyId(companyId);
  const filter = { _id: objId, companyId: cId };

  const existing = await db.collection("leave_requests").findOne(filter);
  if (!existing) throw new Error("Leave request not found.");

  if (existing.status === "cancelled") throw new Error("Request is already cancelled.");
  // Own-record rule: a non-admin can cancel only their own request.
  if (actor && !actor.isAdmin && existing.employeeId !== actor.employeeId) throw new Error("Forbidden: You may only cancel your own leave requests.");
  // Rejected requests have nothing to cancel, and a taken one has already been consumed and posted to the ledger.
  if (existing.status !== "pending" && existing.status !== "approved") throw new Error(`A ${String(existing.status)} request cannot be cancelled.`);

  // Claim the cancellation atomically, then release the reservation, so two cancels can never release it twice.
  const claim = await db.collection("leave_requests").updateOne(
    { ...filter, status: existing.status },
    { $set: { status: "cancelled", cancellationReason: reason, updatedAt: new Date() } }
  );
  if (claim.matchedCount === 0) throw new Error("This request changed while you were cancelling it. Open it again.");

  // If request was approved and paid, release the reservation transaction
  if (existing.status === "approved" && existing.isPaid) {
    const days = Number(existing.days) || 1;
    try {
      await createLeaveTransaction(
        {
          companyId,
          employeeId: existing.employeeId as string,
          employeeName: existing.employeeName as string,
          leaveTypeId: existing.leaveTypeId as string | undefined,
          transactionType: "RELEASE",
          days,
          effectiveDate: formatDateYMD(new Date()),
          referenceId: requestId,
          description: `Release reservation (request cancelled): ${reason}`,
          createdBy: actorName,
        },
        companyId
      );
    } catch (error) {
      await db.collection("leave_requests").updateOne(filter, { $set: { status: existing.status, updatedAt: new Date() }, $unset: { cancellationReason: "" } });
      throw error;
    }
  }

  const updated = await db.collection("leave_requests").findOne(filter);
  return {
    id: updated!._id.toString(),
    employeeId: updated!.employeeId as string,
    employeeName: updated!.employeeName as string,
    departmentName: updated!.departmentName as string,
    leaveType: updated!.leaveType as LeaveType,
    isPaid: Boolean(updated!.isPaid),
    startDate: updated!.startDate as string,
    endDate: updated!.endDate as string,
    days: Number(updated!.days) || 1,
    reason: updated!.reason as string,
    status: "cancelled",
    cancellationReason: reason,
    createdAt: (updated!.createdAt as Date).toISOString(),
    updatedAt: (updated!.updatedAt as Date).toISOString(),
  };
}

/**
 * Converts passed approved reservations into TAKEN ledger records
 */
export async function syncTakenLeaveRequests(companyId: string): Promise<number> {
  const db = await getDb();
  const cId = requireCompanyId(companyId);
  const todayYMD = formatDateYMD(new Date());

  const pastApproved = await db.collection("leave_requests").find({
    companyId: cId,
    status: "approved",
    endDate: { $lt: todayYMD },
  }).toArray();

  let count = 0;

  for (const req of pastApproved) {
    const reqId = req._id.toString();
    const days = Number(req.days) || 1;

    if (req.isPaid) {
      // Check if TAKEN is already posted
      const alreadyTaken = await db.collection("leave_transactions").findOne({
        companyId: cId,
        referenceId: reqId,
        transactionType: "TAKEN",
      });

      if (!alreadyTaken) {
        // Release reservation and post confirmed TAKEN
        await createLeaveTransaction(
          {
            companyId,
            employeeId: req.employeeId as string,
            employeeName: req.employeeName as string,
            leaveTypeId: req.leaveTypeId as string | undefined,
            transactionType: "RELEASE",
            days,
            effectiveDate: req.endDate as string,
            referenceId: reqId,
            description: `Confirmed taken leave — Release reservation #${reqId.slice(-6)}`,
            createdBy: "system_scheduler",
          },
          companyId
        );

        await createLeaveTransaction(
          {
            companyId,
            employeeId: req.employeeId as string,
            employeeName: req.employeeName as string,
            leaveTypeId: req.leaveTypeId as string | undefined,
            transactionType: "TAKEN",
            days,
            effectiveDate: req.endDate as string,
            referenceId: reqId,
            description: `Paid leave taken #${reqId.slice(-6)} (${req.startDate} → ${req.endDate})`,
            createdBy: "system_scheduler",
          },
          companyId
        );
      }
    }

    await db.collection("leave_requests").updateOne(
      { _id: req._id, companyId: cId },
      { $set: { status: "taken", updatedAt: new Date() } }
    );
    count++;
  }

  return count;
}

// ==========================================
// Departure / Unused Leave Review (Feature H)
// ==========================================

export async function calculateDepartureUnusedLeave(employeeId: string, companyId: string) {
  const emp = await getEmployeeById(employeeId, companyId);
  if (!emp) throw new Error("Employee not found.");

  const solde = await getSoldeDeConge(employeeId, new Date().getFullYear(), companyId);
  const potentialCompensationDays = Math.max(0, solde.earned - solde.taken);

  return {
    employee: emp,
    earned: solde.earned,
    taken: solde.taken,
    potentialCompensationDays,
    warning:
      "Important: Compensation for unused paid leave depends on the termination reason (e.g. gross misconduct exception, Art. 120 of Tunisian Labour Code) and applicable collective agreements. Verify with Legal/HR before payout.",
  };
}

export async function confirmDepartureCompensation(
  employeeId: string,
  approvedDays: number,
  reason: string,
  adminUserId: string,
  companyId: string
): Promise<LeaveTransactionRecord> {
  const emp = await getEmployeeById(employeeId, companyId);
  if (!emp) throw new Error("Employee not found.");

  return await createLeaveTransaction(
    {
      companyId,
      employeeId,
      employeeName: emp.fullName,
      transactionType: "COMPENSATION",
      days: -Math.abs(approvedDays), // decreases solde upon settlement
      effectiveDate: formatDateYMD(new Date()),
      description: `Unused leave compensation approved at departure: ${reason.trim()} (${approvedDays}d)`,
      createdBy: adminUserId,
    },
    companyId
  );
}

// ==========================================
// Feature 3: Attendance Tracking Service Methods
// ==========================================

export async function getTodayAttendance(companyId: string): Promise<TodayAttendanceSummary> {
  const db = await getDb();
  const cId = requireCompanyId(companyId);


  const todayStr = formatDateYMD(new Date());
  const empFilter = { status: "active", companyId: cId };
  const attFilter = { date: todayStr, companyId: cId };

  const [activeEmployees, records] = await Promise.all([
    db.collection("employees").find(empFilter).toArray(),
    db.collection("attendance").find(attFilter).sort({ checkIn: -1 }).toArray(),
  ]);

  const activeEmpMap = new Map<string, string>();
  activeEmployees.forEach((e) => activeEmpMap.set((e._id as ObjectId).toString(), e.fullName as string));

  // Deduplicate by employeeId to guarantee each employee appears AT MOST ONCE in today's roster
  const latestByEmployee = new Map<string, (typeof records)[0]>();
  for (const doc of records) {
    const empId = doc.employeeId as string;
    if (!latestByEmployee.has(empId)) {
      latestByEmployee.set(empId, doc);
    }
  }
  const deduplicatedRecords = Array.from(latestByEmployee.values());

  const attendanceRecords: AttendanceRecord[] = deduplicatedRecords.map((doc) => ({
    id: (doc._id as ObjectId).toString(),
    employeeId: doc.employeeId as string,
    employeeName: (doc.employeeName as string) || activeEmpMap.get(doc.employeeId) || "Staff",
    departmentName: (doc.departmentName as string) || "General",
    date: doc.date as string,
    checkIn: (doc.checkIn as Date).toISOString(),
    checkOut: doc.checkOut ? (doc.checkOut as Date).toISOString() : undefined,
    hoursWorked: Number(doc.hoursWorked) || 0,
    status: (doc.status as "present" | "checked_out") || "present",
    createdAt: doc.createdAt ? (doc.createdAt as Date).toISOString() : new Date().toISOString(),
  }));

  const presentCount = attendanceRecords.filter((r) => r.status === "present").length;
  const checkedOutCount = attendanceRecords.filter((r) => r.status === "checked_out").length;
  const totalActive = activeEmployees.length;
  const loggedIds = new Set(attendanceRecords.map((r) => r.employeeId));
  const absentCount = Math.max(0, totalActive - loggedIds.size);

  return {
    totalActive,
    presentCount,
    checkedOutCount,
    absentCount,
    records: attendanceRecords,
  };
}

export async function getEmployeeTodayAttendance(employeeId: string, companyId: string): Promise<AttendanceRecord | null> {
  const db = await getDb();
  const cId = requireCompanyId(companyId);
  const todayStr = formatDateYMD(new Date());
  const filter = {
    employeeId,
    date: todayStr,
    ...({ companyId: cId }),
  };

  const doc = await db.collection("attendance").findOne(filter);
  if (!doc) return null;

  return {
    id: (doc._id as ObjectId).toString(),
    employeeId: doc.employeeId as string,
    employeeName: doc.employeeName as string,
    departmentName: doc.departmentName as string,
    date: doc.date as string,
    checkIn: (doc.checkIn as Date).toISOString(),
    checkOut: doc.checkOut ? (doc.checkOut as Date).toISOString() : undefined,
    hoursWorked: Number(doc.hoursWorked) || 0,
    status: doc.status as "present" | "checked_out",
    createdAt: (doc.createdAt as Date).toISOString(),
  };
}

export async function checkInEmployee(employeeId: string, companyId: string): Promise<AttendanceRecord> {
  const db = await getDb();
  const cId = requireCompanyId(companyId);
  const todayStr = formatDateYMD(new Date());

  const emp = await getEmployeeById(employeeId, cId?.toString());
  if (!emp) throw new Error("Employee not found.");

  const existing = await db.collection("attendance").findOne({
    employeeId,
    date: todayStr,
    ...({ companyId: cId }),
  });

  if (existing) {
    if (existing.status === "present") {
      throw new Error(`You are already checked in for today (${todayStr}).`);
    } else {
      throw new Error(`You have already completed attendance for today and checked out.`);
    }
  }

  const now = new Date();
  const newRecord = {
    employeeId,
    employeeName: emp.fullName,
    departmentName: emp.departmentName,
    date: todayStr,
    checkIn: now,
    checkOut: null,
    hoursWorked: 0,
    status: "present",
    ...({ companyId: cId }),
    createdAt: now,
    updatedAt: now,
  };

  const res = await db.collection("attendance").insertOne(newRecord);

  return {
    id: res.insertedId.toString(),
    employeeId: newRecord.employeeId,
    employeeName: newRecord.employeeName,
    departmentName: newRecord.departmentName,
    date: newRecord.date,
    checkIn: newRecord.checkIn.toISOString(),
    hoursWorked: 0,
    status: "present",
    createdAt: newRecord.createdAt.toISOString(),
  };
}

export async function checkOutEmployee(employeeId: string, companyId: string): Promise<AttendanceRecord> {
  const db = await getDb();
  const cId = requireCompanyId(companyId);
  const todayStr = formatDateYMD(new Date());

  const existing = await db.collection("attendance").findOne({
    employeeId,
    date: todayStr,
    ...({ companyId: cId }),
  });

  if (!existing) {
    throw new Error("Cannot check out without checking in first today.");
  }

  if (existing.status === "checked_out") {
    throw new Error("You have already checked out for today.");
  }

  const checkOutTime = new Date();
  const checkInTime = new Date(existing.checkIn);
  const diffHours = (checkOutTime.getTime() - checkInTime.getTime()) / (1000 * 60 * 60);
  const roundedHours = Math.round(Math.max(0.1, diffHours) * 10) / 10;

  await db.collection("attendance").updateOne(
    { _id: existing._id },
    {
      $set: {
        checkOut: checkOutTime,
        hoursWorked: roundedHours,
        status: "checked_out",
        updatedAt: checkOutTime,
      },
    }
  );

  return {
    id: existing._id.toString(),
    employeeId: existing.employeeId as string,
    employeeName: existing.employeeName as string,
    departmentName: existing.departmentName as string,
    date: existing.date as string,
    checkIn: (existing.checkIn as Date).toISOString(),
    checkOut: checkOutTime.toISOString(),
    hoursWorked: roundedHours,
    status: "checked_out",
    createdAt: (existing.createdAt as Date).toISOString(),
  };
}

export async function getAttendanceHistory(
  filter: {
    employeeId?: string;
    startDate?: string;
    endDate?: string;
  } = {},
  companyId: string
): Promise<AttendanceRecord[]> {
  const db = await getDb();
  const cId = requireCompanyId(companyId);
  const query: Record<string, unknown> = { companyId: cId };

  if (filter.employeeId) query.employeeId = filter.employeeId;
  if (filter.startDate || filter.endDate) {
    query.date = {};
    if (filter.startDate) (query.date as Record<string, unknown>).$gte = filter.startDate;
    if (filter.endDate) (query.date as Record<string, unknown>).$lte = filter.endDate;
  }

  const docs = await db.collection("attendance").find(query).sort({ date: -1, checkIn: -1 }).toArray();

  return docs.map((doc) => ({
    id: (doc._id as ObjectId).toString(),
    employeeId: doc.employeeId as string,
    employeeName: doc.employeeName as string,
    departmentName: doc.departmentName as string,
    date: doc.date as string,
    checkIn: (doc.checkIn as Date).toISOString(),
    checkOut: doc.checkOut ? (doc.checkOut as Date).toISOString() : undefined,
    hoursWorked: Number(doc.hoursWorked) || 0,
    status: doc.status as "present" | "checked_out",
    createdAt: (doc.createdAt as Date).toISOString(),
  }));
}

// ==========================================
// Feature 4: Payroll Generator Service Methods
// ==========================================

export async function calculateEmployeePayrollPreview(
  employeeId: string,
  period: string, // YYYY-MM
  workingDaysInMonth = 22,
  companyId: string
) {
  const db = await getDb();
  const cId = requireCompanyId(companyId);
  const emp = await getEmployeeById(employeeId, cId?.toString());
  if (!emp) throw new Error("Employee not found.");

  // Find all approved unpaid leaves overlapping this month
  const monthStart = `${period}-01`;
  const [yearStr, monthNum] = period.split("-");
  const lastDayOfMonth = new Date(Number(yearStr), Number(monthNum), 0).getDate();
  const monthEnd = `${period}-${String(lastDayOfMonth).padStart(2, "0")}`;

  const unpaidLeaves = await db
    .collection("leave_requests")
    .find({
      employeeId,
      // "taken" is an approved request whose dates have passed (set by syncTakenLeaveRequests); it is still unpaid leave.
      status: { $in: ["approved", "taken"] },
      isPaid: false,
      ...({ companyId: cId }),
      // Any overlap with the month, including a leave that starts before it and ends after it.
      startDate: { $lte: monthEnd },
      endDate: { $gte: monthStart },
    })
    .toArray();

  let unpaidLeaveDays = 0;
  unpaidLeaves.forEach((leave) => {
    // Clamp to current period if spans across months
    const s = leave.startDate < monthStart ? monthStart : leave.startDate;
    const e = leave.endDate > monthEnd ? monthEnd : leave.endDate;
    unpaidLeaveDays += calculateBusinessDays(s, e);
  });

  const baseSalary = emp.baseSalary;
  const dailyRate = Math.round((baseSalary / workingDaysInMonth) * 100) / 100;
  const deduction = Math.round((dailyRate * unpaidLeaveDays) * 100) / 100;
  const netSalary = Math.max(0, Math.round((baseSalary - deduction) * 100) / 100);

  return {
    employee: emp,
    period,
    baseSalary,
    workingDaysInMonth,
    dailyRate,
    unpaidLeaveDays,
    deduction,
    netSalary,
    currency: "TND",
  };
}

/**
 * Generates (or refreshes) payslips. A payslip already marked paid is never touched, so regenerating a month cannot
 * downgrade a paid payslip or change what was paid. The one controlled correction path is `allowPaidCorrection`: it
 * recomputes the amounts of a paid payslip, keeps it marked paid, and records when it was corrected.
 */
export async function generatePayslips(
  period: string,
  employeeIds: string[] | undefined,
  workingDaysInMonth: number,
  companyId: string,
  options: { allowPaidCorrection?: boolean } = {}
): Promise<PayslipRecord[]> {
  const db = await getDb();
  const cId = requireCompanyId(companyId);
  const query: Record<string, unknown> = {
    status: "active",
    ...({ companyId: cId }),
  };
  if (employeeIds && employeeIds.length > 0) {
    query._id = { $in: employeeIds.map((id) => new ObjectId(id)) };
  }

  const activeEmployees = await db.collection("employees").find(query).toArray();
  const generated: PayslipRecord[] = [];

  for (const doc of activeEmployees) {
    const empId = (doc._id as ObjectId).toString();
    const calculation = await calculateEmployeePayrollPreview(empId, period, workingDaysInMonth, cId?.toString());

    const payslipDoc = {
      employeeId: empId,
      employeeName: calculation.employee.fullName,
      jobTitle: calculation.employee.jobTitle,
      departmentName: calculation.employee.departmentName,
      period,
      baseSalary: calculation.baseSalary,
      workingDaysInMonth: calculation.workingDaysInMonth,
      dailyRate: calculation.dailyRate,
      unpaidLeaveDays: calculation.unpaidLeaveDays,
      deduction: calculation.deduction,
      netSalary: calculation.netSalary,
      currency: "TND",
      status: "generated" as const,
      ...({ companyId: cId }),
      generatedAt: new Date(),
    };

    const already = await db.collection("payslips").findOne({ employeeId: empId, period, ...({ companyId: cId }) });
    if (already?.status === "paid" && !options.allowPaidCorrection) {
      const [existing] = await getPayslips({ period, employeeId: empId }, cId.toString());
      if (existing) generated.push(existing);
      continue;
    }
    const correcting = already?.status === "paid";
    if (correcting) {
      (payslipDoc as Record<string, unknown>).status = "paid";
      (payslipDoc as Record<string, unknown>).correctedAt = new Date();
    }

    // Upsert payslip for same employee & period to avoid duplicates
    const res = await db.collection("payslips").findOneAndUpdate(
      {
        employeeId: empId,
        period,
        ...({ companyId: cId }),
      },
      { $set: payslipDoc },
      { upsert: true, returnDocument: "after" }
    );

    const payslipId = res && "_id" in res && res._id ? (res._id as ObjectId).toString() : empId;
    generated.push({
      id: payslipId,
      employeeId: payslipDoc.employeeId,
      employeeName: payslipDoc.employeeName,
      jobTitle: payslipDoc.jobTitle,
      departmentName: payslipDoc.departmentName,
      period: payslipDoc.period,
      baseSalary: payslipDoc.baseSalary,
      workingDaysInMonth: payslipDoc.workingDaysInMonth,
      dailyRate: payslipDoc.dailyRate,
      unpaidLeaveDays: payslipDoc.unpaidLeaveDays,
      deduction: payslipDoc.deduction,
      netSalary: payslipDoc.netSalary,
      currency: payslipDoc.currency,
      status: payslipDoc.status,
      generatedAt: (payslipDoc.generatedAt as Date).toISOString(),
    });
  }

  return generated;
}

export async function getPayslips(
  filter: { period?: string; employeeId?: string } = {},
  companyId: string
): Promise<PayslipRecord[]> {
  const db = await getDb();
  const cId = requireCompanyId(companyId);
  const query: Record<string, unknown> = { companyId: cId };

  if (filter.period) query.period = filter.period;
  if (filter.employeeId) query.employeeId = filter.employeeId;

  const docs = await db.collection("payslips").find(query).sort({ employeeName: 1 }).toArray();

  return docs.map((doc) => ({
    id: (doc._id as ObjectId).toString(),
    employeeId: doc.employeeId as string,
    employeeName: doc.employeeName as string,
    jobTitle: doc.jobTitle as string,
    departmentName: doc.departmentName as string,
    period: doc.period as string,
    baseSalary: Number(doc.baseSalary) || 0,
    workingDaysInMonth: Number(doc.workingDaysInMonth) || 22,
    dailyRate: Number(doc.dailyRate) || 0,
    unpaidLeaveDays: Number(doc.unpaidLeaveDays) || 0,
    deduction: Number(doc.deduction) || 0,
    netSalary: Number(doc.netSalary) || 0,
    currency: (doc.currency as string) || "TND",
    status: (doc.status as "generated" | "paid") || "generated",
    generatedAt: doc.generatedAt ? (doc.generatedAt as Date).toISOString() : new Date().toISOString(),
  }));
}

export async function getPayslipById(id: string, companyId: string): Promise<PayslipRecord | null> {
  const db = await getDb();
  if (!ObjectId.isValid(id)) return null;
  const cId = requireCompanyId(companyId);
  const filter = { _id: new ObjectId(id), companyId: cId };

  const doc = await db.collection("payslips").findOne(filter);
  if (!doc) return null;

  return {
    id: (doc._id as ObjectId).toString(),
    employeeId: doc.employeeId as string,
    employeeName: doc.employeeName as string,
    jobTitle: doc.jobTitle as string,
    departmentName: doc.departmentName as string,
    period: doc.period as string,
    baseSalary: Number(doc.baseSalary) || 0,
    workingDaysInMonth: Number(doc.workingDaysInMonth) || 22,
    dailyRate: Number(doc.dailyRate) || 0,
    unpaidLeaveDays: Number(doc.unpaidLeaveDays) || 0,
    deduction: Number(doc.deduction) || 0,
    netSalary: Number(doc.netSalary) || 0,
    currency: (doc.currency as string) || "TND",
    status: (doc.status as "generated" | "paid") || "generated",
    generatedAt: doc.generatedAt ? (doc.generatedAt as Date).toISOString() : new Date().toISOString(),
  };
}

export async function getPayrollSummary(period: string, companyId: string): Promise<PayrollSummary> {
  const cId = requireCompanyId(companyId);
  const payslips = await getPayslips({ period }, cId?.toString());
  const empFilter = { status: "active", companyId: cId };
  const totalEmployees = await (await getDb()).collection("employees").countDocuments(empFilter);

  let totalGross = 0;
  let totalDeductions = 0;
  let totalNet = 0;

  payslips.forEach((p) => {
    totalGross += p.baseSalary;
    totalDeductions += p.deduction;
    totalNet += p.netSalary;
  });

  return {
    period,
    totalGross: Math.round(totalGross * 100) / 100,
    totalDeductions: Math.round(totalDeductions * 100) / 100,
    totalNet: Math.round(totalNet * 100) / 100,
    totalEmployees,
    payslipsGenerated: payslips.length,
  };
}

// ==========================================
// Feature 5: AI HR Assistant Engine
// ==========================================

export async function askHRAssistant(
  promptText: string,
  employeeId: string,
  companyId: string,
  authUser?: { role?: string; isAdmin?: boolean; employeeId?: string; fullName?: string }
): Promise<AIChatMessage> {
  const query = promptText.trim().toLowerCase();
  const cId = requireCompanyId(companyId);
  const currentYear = new Date().getFullYear();
  const messageId = "msg-" + Date.now();
  const timestamp = new Date().toISOString();

  const db = await getDb();
  const companyEmployees = await db.collection("employees").find({ companyId: cId }).toArray();
  const isRequesterAdmin = Boolean(authUser?.isAdmin || authUser?.role === "hr_admin");

  // Check if an employee is mentioned in the query
  let matchedEmpDoc = companyEmployees.find((e) => query.includes((e.fullName as string).toLowerCase()));
  if (!matchedEmpDoc) {
    // Check parts of name
    for (const e of companyEmployees) {
      const parts = (e.fullName as string).toLowerCase().split(/\s+/).filter((p) => p.length >= 3);
      if (parts.some((p) => new RegExp(`\\b${p}\\b`, "i").test(query))) {
        matchedEmpDoc = e;
        break;
      }
    }
  }

  // Check if a name was asked for that does NOT exist
  let notFoundName: string | null = null;
  if (!matchedEmpDoc) {
    const patterns = [
      /(?:about|for|employee|check|status of|balance of|leave for|info on)\s+([A-Z][a-zA-Z\s'-]{2,25})/i,
      /([A-Z][a-zA-Z\s'-]{2,25})'s\s+(?:leave|balance|salary|payslip|data|status|conge)/i,
    ];
    for (const pat of patterns) {
      const m = promptText.match(pat);
      if (m && m[1]) {
        const candidate = m[1].trim();
        const blacklist = ["the", "my", "our", "anops", "leave", "balance", "solde", "unpaid", "sick", "holiday", "policy", "salary", "payroll"];
        if (!blacklist.includes(candidate.toLowerCase())) {
          notFoundName = candidate;
          break;
        }
      }
    }
  }

  // RBAC: Non-admin inquiring about another person
  if (!isRequesterAdmin && (matchedEmpDoc && matchedEmpDoc._id.toString() !== authUser?.employeeId || notFoundName !== null)) {
    return {
      id: messageId,
      role: "assistant",
      content: `⛔ **Access Denied**: In accordance with AnOps security and privacy policies (docs/ROLES_AND_PERMISSIONS.md), you are only authorized to view your own personal HR records, leave balances, and payslips. You do not have permission to view records for other employees. Please contact an HR Administrator if you require assistance.`,
      timestamp,
    };
  }

  // Admin query: Employee Not Found
  if (isRequesterAdmin && notFoundName && !matchedEmpDoc) {
    return {
      id: messageId,
      role: "assistant",
      content: `🔍 **Employee Not Found**: Employee **'${notFoundName}'** was not found in company records. Please verify the spelling or check the Employees directory to ensure they are registered in this organization.`,
      timestamp,
    };
  }

  // Target employee resolution
  const targetId = isRequesterAdmin && matchedEmpDoc ? matchedEmpDoc._id.toString() : (authUser?.employeeId || employeeId);
  const emp = await getEmployeeById(targetId, cId?.toString());
  const employeeName = emp?.fullName || "Employee";

  // Check for step-by-step counting derivation query
  const isCountingQuery =
    query.includes("how was it counted") ||
    query.includes("how is it counted") ||
    query.includes("how it was counted") ||
    query.includes("counted") ||
    query.includes("step-by-step") ||
    query.includes("calculation") ||
    query.includes("derivation");

  if (isCountingQuery || query.includes("solde")) {
    const solde = await getSoldeDeConge(targetId, currentYear, companyId);
    const policy = await getEmployeeLeavePolicy(targetId, companyId);
    const dailyRate = emp ? Math.round((emp.baseSalary / 22) * 100) / 100 : 150;
    const unusedDays = Math.max(0, solde.earned - solde.taken);
    const compVal = Math.round(unusedDays * dailyRate * 100) / 100;

    let responseContent = `### Step-by-Step Leave Balance (Solde de Congé) Derivation for **${employeeName}** (${currentYear})\n\n`;
    responseContent += `Here is the verified arithmetic calculation based on your personnel ledger and **${policy?.name || "Standard Adult Policy"}** (${policy?.legalReference || "Code du Travail Art. 113-114"}):\n\n`;
    responseContent += `1. **Step 1 — Monthly Accrual (Acquis)**: **${solde.earned} days**\n`;
    responseContent += `   - Monthly rate: \`${policy?.accrualRate ?? 1.0} day(s)/month\` of effective work.\n`;
    responseContent += `   - Formula: \`effective_months × ${policy?.accrualRate ?? 1.0}d/mo = ${solde.earned} days\` (Statutory cap: ${policy?.annualCap ?? 15} days).\n\n`;
    responseContent += `2. **Step 2 — Consumed Leave (Pris)**: **${solde.taken} days**\n`;
    responseContent += `   - Approved leave days where dates have already elapsed.\n\n`;
    responseContent += `3. **Step 3 — Active Reservations (Réservé)**: **${solde.reserved} days**\n`;
    responseContent += `   - Approved upcoming leave requests currently locking the balance.\n\n`;
    if (solde.adjustments !== 0) {
      responseContent += `4. **Step 4 — Discretionary Adjustments**: **${solde.adjustments > 0 ? "+" : ""}${solde.adjustments} days**\n\n`;
    }
    responseContent += `5. **Step 5 — Available Balance (Disponible)**: **${solde.available} days**\n`;
    responseContent += `   - Equation: \`Earned (${solde.earned}) - Taken (${solde.taken}) - Reserved (${solde.reserved}) + Adjustments (${solde.adjustments}) = ${solde.available} days\`\n\n`;
    responseContent += `6. **Departure Compensation (Indemnité compensatrice Art. 120)**:\n`;
    responseContent += `   - \`${unusedDays} unused days\` (${solde.earned} - ${solde.taken}) × Daily Rate (${dailyRate.toFixed(2)} TND) = **${compVal.toLocaleString()} TND** (payable upon termination, subject to Art. 120 gross misconduct exceptions).\n`;

    return {
      id: messageId,
      role: "assistant",
      content: responseContent,
      timestamp,
      toolData: {
        type: "leave_balance",
        data: {
          employeeName,
          earned: solde.earned,
          taken: solde.taken,
          reserved: solde.reserved,
          adjustments: solde.adjustments,
          available: solde.available,
          unpaidDaysTaken: solde.unpaidDaysTaken,
          policyName: policy?.name,
          legalReference: policy?.legalReference,
        },
      },
    };
  }

  // 1. Tool check: Leave balance query
  const isLeaveBalanceQuery =
    query.includes("leave balance") ||
    query.includes("days do i have") ||
    query.includes("remaining leave") ||
    query.includes("how many days") ||
    query.includes("vacation days") ||
    query.includes("balance");

  if (isLeaveBalanceQuery) {
    const balance = await getLeaveBalance(targetId, currentYear, cId?.toString());
    const myRequests = await getLeaveRequests({ employeeId: targetId }, cId?.toString());
    const pendingCount = myRequests.filter((r) => r.status === "pending").length;

    let responseContent = `Hello **${employeeName}**, here is your real-time leave balance for **${currentYear}**:\n\n`;
    responseContent += `- **Annual Allowance**: ${balance.allowance} paid days\n`;
    responseContent += `- **Approved Paid Leave Used**: ${balance.usedPaidDays} days\n`;
    responseContent += `- **Available Balance**: **${balance.remainingDays} days** remaining\n`;
    if (balance.unpaidDaysTaken > 0) {
      responseContent += `- **Unpaid Leave Taken**: ${balance.unpaidDaysTaken} days (deducted in payroll)\n`;
    }
    if (pendingCount > 0) {
      responseContent += `\n*Note*: You currently have **${pendingCount} pending request(s)** awaiting admin review.`;
    }
    responseContent += `\n\n> *Tip*: To submit a new request, open the **Time-Off & Leave** tab and click **Request Leave**.`;

    return {
      id: messageId,
      role: "assistant",
      content: responseContent,
      timestamp,
      toolData: {
        type: "leave_balance",
        data: {
          employeeName,
          allowance: balance.allowance,
          usedPaidDays: balance.usedPaidDays,
          remainingDays: balance.remainingDays,
          unpaidDaysTaken: balance.unpaidDaysTaken,
        },
      },
    };
  }

  // 2. Tool check: Unpaid leave deduction & Payroll calculation formula
  const isPayrollDeductionQuery =
    query.includes("unpaid") ||
    query.includes("deduct") ||
    query.includes("salary") ||
    query.includes("formula") ||
    query.includes("payroll");

  if (isPayrollDeductionQuery) {
    const baseSalary = emp?.baseSalary ?? 3500;
    const dailyRate = Math.round((baseSalary / 22) * 100) / 100;

    let responseContent = `### AnOps Salary & Unpaid Leave Deduction Formula\n\n`;
    responseContent += `Yes, **unpaid leave is directly deducted from your monthly salary**.\n\n`;
    responseContent += `The company applies the following standard formula:\n`;
    responseContent += `\`\`\`text\n`;
    responseContent += `daily_rate  = base_salary / 22 working days\n`;
    responseContent += `deduction   = daily_rate * unpaid_leave_days\n`;
    responseContent += `net_salary  = base_salary - deduction\n`;
    responseContent += `\`\`\`\n\n`;
    responseContent += `**Your Personalized Example** (based on your contract base of **${baseSalary.toLocaleString()} TND**):\n`;
    responseContent += `- Your daily rate is **${dailyRate.toFixed(2)} TND / day**.\n`;
    responseContent += `- If you take **1 unpaid day**, your deduction is **${dailyRate.toFixed(2)} TND**.\n`;
    responseContent += `- If you take **2 unpaid days**, your deduction is **${(dailyRate * 2).toFixed(2)} TND**.\n\n`;
    responseContent += `*Policy Citation: AnOps Payroll & Compensation Guidelines (Section 2).*`;

    return {
      id: messageId,
      role: "assistant",
      content: responseContent,
      timestamp,
      toolData: {
        type: "payroll_calculation",
        data: { baseSalary, dailyRate, workingDays: 22 },
      },
    };
  }

  // 3. Sick leave / medical procedure query
  if (query.includes("sick") || query.includes("doctor") || query.includes("illness") || query.includes("medical")) {
    const sickPolicy = COMPANY_POLICIES.find((p) => p.id === "policy-leave-sick-unpaid");
    let responseContent = `### AnOps Sick Leave Guidelines & Procedure\n\n`;
    responseContent += `1. **Entitlement**: Employees are entitled to up to **10 days of paid sick leave** per year.\n`;
    responseContent += `2. **Notice**: Please notify your manager and HR by **9:00 AM** on the morning of absence.\n`;
    responseContent += `3. **Medical Certificate**: Required for any absence exceeding **2 consecutive business days**. It must be submitted to HR within 48 hours of return.\n`;
    responseContent += `4. **Submission**: Log into the HR Portal -> **Time-Off & Leave** -> Choose Leave Type **Sick Leave**.\n\n`;
    responseContent += `*Policy Citation: Sick Leave, Unpaid Leave & Special Absence Policy.*`;

    return {
      id: messageId,
      role: "assistant",
      content: responseContent,
      timestamp,
      toolData: {
        type: "policy_excerpt",
        data: { policyId: sickPolicy?.id, title: sickPolicy?.title },
      },
    };
  }

  // 4. Working hours & attendance punch query
  if (
    query.includes("working hour") ||
    query.includes("hours") ||
    query.includes("attendance") ||
    query.includes("check-in") ||
    query.includes("punch") ||
    query.includes("arrival") ||
    query.includes("late")
  ) {
    const todayRec = await getEmployeeTodayAttendance(employeeId, cId?.toString());
    let responseContent = `### AnOps Working Hours & Attendance Policy\n\n`;
    responseContent += `- **Standard Work Week**: 40 hours per week, Monday through Friday.\n`;
    responseContent += `- **Standard Schedule**: 8:00 AM to 5:00 PM (includes 1-hour lunch break).\n`;
    responseContent += `- **Flexible Arrival Window**: You may arrive between **8:30 AM and 9:30 AM** (adjusted shift ends between 5:30 PM and 6:30 PM).\n`;
    responseContent += `- **Punch System**: You must record attendance daily using the **HR Punch Clock**.\n\n`;

    if (todayRec) {
      responseContent += `**Your Status Today (${todayRec.date})**:\n`;
      responseContent += `- Checked In: **${new Date(todayRec.checkIn).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}**\n`;
      if (todayRec.checkOut) {
        responseContent += `- Checked Out: **${new Date(todayRec.checkOut).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}** (${todayRec.hoursWorked} hrs logged)\n`;
      } else {
        responseContent += `- Currently **Active / Present**.\n`;
      }
    } else {
      responseContent += `> *Notice*: You haven't checked in yet today. Head over to the **Attendance** tab to punch in!`;
    }

    return {
      id: messageId,
      role: "assistant",
      content: responseContent,
      timestamp,
      toolData: {
        type: "attendance",
        data: { todayRecord: todayRec },
      },
    };
  }

  // 5. Maternity / Paternity / Bereavement
  if (query.includes("maternity") || query.includes("paternity") || query.includes("bereavement") || query.includes("death")) {
    let responseContent = `### AnOps Special Family Leave Allowances\n\n`;
    responseContent += `- **Maternity Leave**: **60 calendar days** fully paid.\n`;
    responseContent += `- **Paternity Leave**: **5 business days** fully paid upon child birth.\n`;
    responseContent += `- **Bereavement Leave**: **3 business days** fully paid for immediate family members (spouse, child, parent, sibling).\n\n`;
    responseContent += `To apply, submit a request under **Time-Off & Leave** and select the corresponding leave category.`;

    return {
      id: messageId,
      role: "assistant",
      content: responseContent,
      timestamp,
    };
  }

  // 6. Generic policy search / RAG across COMPANY_POLICIES
  const matches = COMPANY_POLICIES.filter(
    (p) =>
      p.title.toLowerCase().includes(query) ||
      p.summary.toLowerCase().includes(query) ||
      p.content.toLowerCase().includes(query)
  );

  if (matches.length > 0) {
    const topMatch = matches[0];
    let responseContent = `### ${topMatch.title}\n\n${topMatch.summary}\n\n`;
    const snippet = topMatch.content.split("\n").slice(2, 12).join("\n");
    responseContent += snippet + "\n\n";
    responseContent += `*Source: AnOps HR Knowledge Base (${topMatch.title}).*`;

    return {
      id: messageId,
      role: "assistant",
      content: responseContent,
      timestamp,
      toolData: {
        type: "policy_excerpt",
        data: { policyId: topMatch.id, title: topMatch.title },
      },
    };
  }

  // 7. Strict Guardrail: Safe refusal for unknown or out-of-scope questions
  const safeRefusal =
    `I don't have enough verified HR policy information to answer that accurately. ` +
    `Please contact the HR Department directly at **hr@anops.internal** or check with your manager.\n\n` +
    `*Guardrail Note: As your AI HR Assistant, I only provide answers strictly grounded in official AnOps company policies and your verified personnel records.*`;

  return {
    id: messageId,
    role: "assistant",
    content: safeRefusal,
    timestamp,
  };
}
