import "server-only";
import { ObjectId } from "mongodb";
import clientPromise from "@/server/db/client";
import type { Company, CompanyMember, CompanyRole, CreateCompanyInput } from "@/features/company/types";
import { seedHrDefaultsForCompany } from "./hr.service";

async function getDb() {
  const client = await clientPromise;
  return client.db();
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Creates a new Company organization for a user, registers them as owner,
 * and seeds initial default departments and job titles for that company.
 */
export async function createCompany(
  userId: string,
  data: CreateCompanyInput
): Promise<Company> {
  const db = await getDb();
  const trimmedName = data.name.trim();

  const baseSlug = slugify(trimmedName) || "company";
  let uniqueSlug = baseSlug;
  let counter = 1;

  while (await db.collection("companies").findOne({ slug: uniqueSlug })) {
    uniqueSlug = `${baseSlug}-${counter}`;
    counter++;
  }

  const now = new Date();
  const companyDoc = {
    name: trimmedName,
    slug: uniqueSlug,
    ownerId: new ObjectId(userId),
    currency: data.currency || "TND",
    industry: data.industry?.trim() || "General",
    createdAt: now,
    updatedAt: now,
  };

  const insertResult = await db.collection("companies").insertOne(companyDoc);
  const companyId = insertResult.insertedId;

  // Add user as Company Owner
  await db.collection("company_members").insertOne({
    companyId,
    userId: new ObjectId(userId),
    role: "owner",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });

  // Every new organization gets a subscription record. Without a plan chosen at /trial it starts with
  // "choose a plan" (the free OneOps choice stays available), so no organization gets free paid access.
  await db.collection("organization_subscriptions").updateOne(
    { companyId },
    {
      $setOnInsert: {
        companyId,
        plan: null,
        status: "lapsed",
        freeAppId: null,
        trialAppIds: [],
        trialStartedAt: null,
        trialEndsAt: null,
        customAppIds: [],
        aiAddon: false,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        pastDueSince: null,
        billingCurrency: (data.currency || "TND") === "USD" ? "usd" : "eur",
        billingInterval: null,
        billingEmail: null,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        stripeStatus: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
      },
    },
    { upsert: true }
  );

  // Seed default HR data (departments, job titles, demo staff) for this new company
  await seedHrDefaultsForCompany(companyId.toString());

  return {
    id: companyId.toString(),
    name: companyDoc.name,
    slug: companyDoc.slug,
    ownerId: userId,
    currency: companyDoc.currency,
    industry: companyDoc.industry,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

/**
 * Returns all companies that a user owns or is a member of.
 */
export async function getUserCompanies(userId: string): Promise<Company[]> {
  const db = await getDb();
  if (!ObjectId.isValid(userId)) return [];

  const memberships = await db
    .collection("company_members")
    .find({ userId: new ObjectId(userId), status: "active" })
    .toArray();

  if (memberships.length === 0) {
    return [];
  }

  const companyIds = memberships.map((m) => m.companyId as ObjectId);
  // Organizations that were not activated in time are invisible immediately, even before cleanup runs.
  const companyDocs = await db
    .collection("companies")
    .find({
      _id: { $in: companyIds },
      activationStatus: { $ne: "expiring" },
      $or: [{ activationStatus: { $ne: "pending" } }, { activationDeadline: { $gt: new Date() } }],
    })
    .toArray();

  return companyDocs.map((doc) => ({
    id: doc._id.toString(),
    name: doc.name as string,
    slug: doc.slug as string,
    ownerId: doc.ownerId.toString(),
    currency: (doc.currency as string) || "TND",
    industry: doc.industry as string | undefined,
    logoUrl: doc.logoUrl as string | undefined,
    activationStatus: doc.activationStatus === "pending" ? "pending" : "active",
    activationDeadline: doc.activationDeadline instanceof Date ? doc.activationDeadline.toISOString() : undefined,
    createdAt: doc.createdAt ? (doc.createdAt as Date).toISOString() : undefined,
    updatedAt: doc.updatedAt ? (doc.updatedAt as Date).toISOString() : undefined,
  }));
}

/**
 * Fetches a single company by ID.
 */
export async function getCompanyById(companyId: string): Promise<Company | null> {
  const db = await getDb();
  if (!ObjectId.isValid(companyId)) return null;

  const doc = await db.collection("companies").findOne({ _id: new ObjectId(companyId) });
  if (!doc) return null;

  return {
    id: doc._id.toString(),
    name: doc.name as string,
    slug: doc.slug as string,
    ownerId: doc.ownerId.toString(),
    currency: (doc.currency as string) || "TND",
    industry: doc.industry as string | undefined,
    logoUrl: doc.logoUrl as string | undefined,
    createdAt: doc.createdAt ? (doc.createdAt as Date).toISOString() : undefined,
    updatedAt: doc.updatedAt ? (doc.updatedAt as Date).toISOString() : undefined,
  };
}

/**
 * Checks a user's membership and role in a specific company.
 */
export async function getCompanyMember(
  companyId: string,
  userId: string
): Promise<CompanyMember | null> {
  const db = await getDb();
  if (!ObjectId.isValid(companyId) || !ObjectId.isValid(userId)) return null;

  const doc = await db.collection("company_members").findOne({
    companyId: new ObjectId(companyId),
    userId: new ObjectId(userId),
    status: "active",
  });

  if (!doc) return null;

  return {
    id: doc._id.toString(),
    companyId: doc.companyId.toString(),
    userId: doc.userId.toString(),
    role: doc.role,
    status: doc.status,
    createdAt: doc.createdAt ? (doc.createdAt as Date).toISOString() : undefined,
    updatedAt: doc.updatedAt ? (doc.updatedAt as Date).toISOString() : undefined,
  };
}

/**
 * Updates company settings (name, industry, currency).
 */
export async function updateCompany(
  companyId: string,
  data: { name?: string; industry?: string; currency?: string }
): Promise<Company> {
  const db = await getDb();
  if (!ObjectId.isValid(companyId)) throw new Error("Invalid company ID.");

  const updateFields: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (data.name && data.name.trim()) {
    updateFields.name = data.name.trim();
  }
  if (data.industry) {
    updateFields.industry = data.industry.trim();
  }
  if (data.currency) {
    updateFields.currency = data.currency.trim();
  }

  await db.collection("companies").updateOne(
    { _id: new ObjectId(companyId) },
    { $set: updateFields }
  );

  const updated = await getCompanyById(companyId);
  if (!updated) throw new Error("Company not found after update.");
  return updated;
}

/**
 * Retrieves all members of a company with joined user name and email.
 */
export async function getCompanyMembers(companyId: string): Promise<CompanyMember[]> {
  const db = await getDb();
  if (!ObjectId.isValid(companyId)) return [];

  const cObjId = new ObjectId(companyId);

  const members = await db
    .collection("company_members")
    .find({ companyId: cObjId })
    .sort({ createdAt: 1 })
    .toArray();

  if (members.length === 0) return [];

  const userIds = members.map((m) => m.userId as ObjectId);
  const users = await db
    .collection("users")
    .find({ _id: { $in: userIds } })
    .toArray();

  const userMap = new Map<string, { name?: string; email?: string }>();
  users.forEach((u) => {
    userMap.set(u._id.toString(), {
      name: u.name as string | undefined,
      email: u.email as string | undefined,
    });
  });

  return members.map((m) => {
    const uInfo = userMap.get(m.userId.toString());
    return {
      id: m._id.toString(),
      companyId: m.companyId.toString(),
      userId: m.userId.toString(),
      role: m.role as CompanyRole,
      status: m.status as "active" | "invited",
      userName: uInfo?.name || "Staff Member",
      userEmail: uInfo?.email || "",
      createdAt: m.createdAt ? (m.createdAt as Date).toISOString() : undefined,
      updatedAt: m.updatedAt ? (m.updatedAt as Date).toISOString() : undefined,
    };
  });
}

/**
 * Adds a new member to the company. If user account does not exist, provisions one.
 */
export async function addCompanyMember(
  companyId: string,
  email: string,
  role: "admin" | "manager" | "employee",
  fullName?: string
): Promise<{ member: CompanyMember; tempPassword?: string }> {
  const db = await getDb();
  if (!ObjectId.isValid(companyId)) throw new Error("Invalid company ID.");

  const cObjId = new ObjectId(companyId);
  const normalizedEmail = email.toLowerCase().trim();

  let tempPassword: string | undefined = undefined;

  let user = await db.collection("users").findOne({ email: normalizedEmail });

  if (!user) {
    const crypto = await import("crypto");
    const bcrypt = await import("bcryptjs");
    tempPassword = crypto.randomBytes(9).toString("base64url").slice(0, 12);
    const hashedPassword = await bcrypt.hash(tempPassword, 12);

    const insertUser = await db.collection("users").insertOne({
      name: fullName?.trim() || normalizedEmail.split("@")[0],
      email: normalizedEmail,
      password: hashedPassword,
      status: "active",
      forcePasswordReset: true,
      emailVerified: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    user = {
      _id: insertUser.insertedId,
      name: fullName?.trim() || normalizedEmail.split("@")[0],
      email: normalizedEmail,
    };
  }

  const existingMember = await db.collection("company_members").findOne({
    companyId: cObjId,
    userId: user._id as ObjectId,
  });

  if (existingMember) {
    throw new Error(`User "${normalizedEmail}" is already a member of this company.`);
  }

  const now = new Date();
  const insertMember = await db.collection("company_members").insertOne({
    companyId: cObjId,
    userId: user._id as ObjectId,
    role,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });

  return {
    member: {
      id: insertMember.insertedId.toString(),
      companyId,
      userId: (user._id as ObjectId).toString(),
      role,
      status: "active",
      userName: (user.name as string) || normalizedEmail.split("@")[0],
      userEmail: normalizedEmail,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
    tempPassword,
  };
}

/**
 * Updates a company member's role.
 */
export async function updateCompanyMemberRole(
  companyId: string,
  memberId: string,
  newRole: "admin" | "manager" | "employee",
  actingUserId: string
): Promise<CompanyMember> {
  const db = await getDb();
  if (!ObjectId.isValid(companyId) || !ObjectId.isValid(memberId)) {
    throw new Error("Invalid company or member ID.");
  }

  const member = await db.collection("company_members").findOne({
    _id: new ObjectId(memberId),
    companyId: new ObjectId(companyId),
  });

  if (!member) throw new Error("Member not found in this company.");
  if (member.role === "owner") throw new Error("The organization owner's role cannot be modified.");

  if (member.userId.toString() === actingUserId) {
    throw new Error("You cannot change your own role.");
  }

  await db.collection("company_members").updateOne(
    { _id: new ObjectId(memberId) },
    { $set: { role: newRole, updatedAt: new Date() } }
  );

  const updated = await db.collection("company_members").findOne({ _id: new ObjectId(memberId) });
  const user = await db.collection("users").findOne({ _id: member.userId as ObjectId });

  return {
    id: updated!._id.toString(),
    companyId: updated!.companyId.toString(),
    userId: updated!.userId.toString(),
    role: updated!.role as CompanyRole,
    status: updated!.status as "active" | "invited",
    userName: (user?.name as string) || "Staff",
    userEmail: (user?.email as string) || "",
    createdAt: updated!.createdAt ? (updated!.createdAt as Date).toISOString() : undefined,
    updatedAt: updated!.updatedAt ? (updated!.updatedAt as Date).toISOString() : undefined,
  };
}

/**
 * Removes a member from a company.
 */
export async function removeCompanyMember(
  companyId: string,
  memberId: string,
  actingUserId: string
): Promise<void> {
  const db = await getDb();
  if (!ObjectId.isValid(companyId) || !ObjectId.isValid(memberId)) {
    throw new Error("Invalid company or member ID.");
  }

  const member = await db.collection("company_members").findOne({
    _id: new ObjectId(memberId),
    companyId: new ObjectId(companyId),
  });

  if (!member) throw new Error("Member not found.");
  if (member.role === "owner") throw new Error("The organization owner cannot be removed.");
  if (member.userId.toString() === actingUserId) {
    throw new Error("You cannot remove yourself from the organization.");
  }

  await db.collection("company_members").deleteOne({ _id: new ObjectId(memberId) });
}

/**
 * Aggregates company overview statistics.
 */
export async function getCompanyStats(companyId: string) {
  const db = await getDb();
  if (!ObjectId.isValid(companyId)) {
    return { membersCount: 0, employeesCount: 0, departmentsCount: 0, jobTitlesCount: 0 };
  }

  const cObjId = new ObjectId(companyId);

  const [membersCount, employeesCount, departmentsCount, jobTitlesCount] = await Promise.all([
    db.collection("company_members").countDocuments({ companyId: cObjId }),
    db.collection("employees").countDocuments({ companyId: cObjId }),
    db.collection("departments").countDocuments({ companyId: cObjId }),
    db.collection("job_titles").countDocuments({ companyId: cObjId }),
  ]);

  return {
    membersCount,
    employeesCount,
    departmentsCount,
    jobTitlesCount,
  };
}
