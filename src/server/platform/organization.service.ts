import "server-only";
import { ObjectId } from "mongodb";
import { recordAudit } from "@/server/audit/audit.service";
import { listAccessMembers } from "@/server/ai/access/access.service";
import type { OrgAccess } from "@/server/platform/access";
import { getEntitlements } from "@/server/platform/subscription.service";
import { getUserCompanies, getCompanyStats } from "@/server/services/company.service";
import { PLANS } from "@/shared/domain/plans";
import type { Db } from "mongodb";
import { organizationProfileSchema } from "@/features/platform/schemas";
import { isApplicationId, type ApplicationId } from "@/shared/domain/applications";
import { organizationCompletion, type Completion } from "@/shared/domain/profile";
import type { CompanyRole } from "@/features/company/types";
import { AppError } from "@/shared/lib/errors";
import { toFieldErrors } from "@/shared/lib/validation";

export type OrganizationProfileView = {
  id: string;
  name: string;
  slug: string;
  website: string | null;
  industry: string | null;
  size: string | null;
  primaryInterest: string | null;
  country: string | null;
  address: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  currency: string;
  createdAt: string | null;
  activatedAt: string | null;
  activationStatus: "pending" | "active";
  completion: Completion;
  membersCount: number;
  pendingInvitations: number;
};

const str = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);

function requireManager(access: OrgAccess) {
  if (access.companyRole !== "owner" && access.companyRole !== "admin") throw new AppError("FORBIDDEN", "Only owners and administrators can do this.");
}

export async function getOrganizationProfile(access: OrgAccess): Promise<OrganizationProfileView> {
  const { db, companyId } = access.ctx;
  const [company, membersCount, pendingInvitations] = await Promise.all([
    db.collection("companies").findOne({ _id: companyId }),
    db.collection("company_members").countDocuments({ companyId, status: { $in: ["active", "suspended"] } }),
    db.collection("organization_invitations").countDocuments({ companyId, status: "pending", expiresAt: { $gt: new Date() } }),
  ]);
  if (!company) throw new AppError("NOT_FOUND", "Organization not found.");
  return {
    id: companyId.toHexString(),
    name: String(company.name ?? ""),
    slug: String(company.slug ?? ""),
    website: str(company.website),
    // Legacy companies default "General", which is not a real answer.
    industry: str(company.industry) === "General" ? null : str(company.industry),
    size: str(company.size),
    primaryInterest: str(company.primaryInterest),
    country: str(company.country),
    address: str(company.address),
    contactEmail: str(company.contactEmail),
    contactPhone: str(company.contactPhone),
    currency: String(company.currency ?? "TND"),
    createdAt: company.createdAt instanceof Date ? company.createdAt.toISOString() : null,
    activatedAt: company.activatedAt instanceof Date ? company.activatedAt.toISOString() : null,
    activationStatus: company.activationStatus === "pending" ? "pending" : "active",
    completion: organizationCompletion({ ...company, industry: company.industry === "General" ? null : company.industry }, companyId.toHexString()),
    membersCount,
    pendingInvitations,
  };
}

export async function updateOrganizationProfile(access: OrgAccess, raw: unknown): Promise<void> {
  requireManager(access);
  const parsed = organizationProfileSchema.safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Check the form.", toFieldErrors(parsed.error));
  const { db, companyId, userId, requestId } = access.ctx;
  const before = await db.collection("companies").findOne({ _id: companyId }, { projection: { currency: 1 } });
  await db.collection("companies").updateOne({ _id: companyId }, { $set: { ...parsed.data, updatedAt: new Date() } });
  await recordAudit(db, {
    companyId,
    actorUserId: userId,
    action: "organization.profile_updated",
    entityType: "organization",
    entityId: companyId.toHexString(),
    requestId,
    metadata: before?.currency !== parsed.data.currency ? { currencyChanged: `${before?.currency}->${parsed.data.currency}` } : {},
  });
}

// ───────────────────────── Members ─────────────────────────

export type MemberView = {
  id: string;
  userId: string;
  name: string;
  email: string;
  phone: string | null;
  jobTitle: string | null;
  role: CompanyRole;
  status: "active" | "suspended";
  appAccess: ApplicationId[] | null;
  aiEnabled: boolean;
  joinedAt: string | null;
  emailVerified: boolean;
  isSelf: boolean;
};

export async function listMembers(access: OrgAccess): Promise<MemberView[]> {
  const { db, companyId, userId } = access.ctx;
  const members = await db.collection("company_members").find({ companyId, status: { $in: ["active", "suspended"] } }).sort({ createdAt: 1 }).toArray();
  const userIds = members.map((m) => m.userId as ObjectId);
  const manager = access.companyRole === "owner" || access.companyRole === "admin";
  const [users, aiMembers] = await Promise.all([
    db.collection("users").find({ _id: { $in: userIds } }, { projection: { name: 1, email: 1, phone: 1, jobTitle: 1, emailVerified: 1 } }).toArray(),
    // AI grants are read through the AI access layer (the only door to AI collections). Managers only.
    manager ? listAccessMembers(access.ctx).catch(() => []) : Promise.resolve([]),
  ]);
  const userMap = new Map(users.map((u) => [u._id.toHexString(), u]));
  const grantMap = new Map(aiMembers.map((m) => [m.userId, Boolean(m.grant.enabled)]));
  return members.map((m) => {
    const key = (m.userId as ObjectId).toHexString();
    const user = userMap.get(key);
    const role = m.role as CompanyRole;
    return {
      id: (m._id as ObjectId).toHexString(),
      userId: key,
      name: String(user?.name ?? "Member"),
      email: String(user?.email ?? ""),
      phone: str(user?.phone),
      jobTitle: str(user?.jobTitle),
      role,
      status: m.status === "suspended" ? "suspended" : "active",
      appAccess: Array.isArray(m.appAccess) ? (m.appAccess as unknown[]).filter(isApplicationId) : null,
      // Owners have AI by default once the company enables it (see ai/access); others need an explicit grant.
      aiEnabled: grantMap.get(key) ?? false,
      joinedAt: (m.joinedAt ?? m.createdAt) instanceof Date ? ((m.joinedAt ?? m.createdAt) as Date).toISOString() : null,
      emailVerified: Boolean(user?.emailVerified),
      isSelf: key === userId.toHexString(),
    };
  });
}

async function loadTarget(access: OrgAccess, memberId: string) {
  if (!ObjectId.isValid(memberId)) throw new AppError("NOT_FOUND", "Member not found.");
  const member = await access.ctx.db.collection("company_members").findOne({ _id: new ObjectId(memberId), companyId: access.ctx.companyId });
  if (!member) throw new AppError("NOT_FOUND", "Member not found.");
  return member;
}

/**
 * Shared rules for any change to another member: managers only; never yourself; never the owner;
 * administrators cannot act on other administrators (only the owner can).
 */
function assertCanManage(access: OrgAccess, target: Record<string, unknown>) {
  requireManager(access);
  if ((target.userId as ObjectId).equals(access.ctx.userId)) throw new AppError("FORBIDDEN", "You cannot change your own membership here.");
  if (target.role === "owner") throw new AppError("FORBIDDEN", "The organization owner cannot be changed or removed.");
  if (target.role === "admin" && access.companyRole !== "owner") throw new AppError("FORBIDDEN", "Only the owner can manage administrators.");
}

export async function changeMemberRole(access: OrgAccess, memberId: string, role: unknown): Promise<void> {
  if (role !== "admin" && role !== "manager" && role !== "employee") throw new AppError("VALIDATION_ERROR", "Choose a valid role.");
  const target = await loadTarget(access, memberId);
  assertCanManage(access, target);
  if (role === "admin" && access.companyRole !== "owner") throw new AppError("FORBIDDEN", "Only the owner can appoint administrators.");
  await access.ctx.db.collection("company_members").updateOne({ _id: target._id, companyId: access.ctx.companyId, role: { $ne: "owner" } }, { $set: { role, updatedAt: new Date() } });
  await recordAudit(access.ctx.db, { companyId: access.ctx.companyId, actorUserId: access.ctx.userId, action: "member.role_changed", entityType: "member", entityId: memberId, requestId: access.ctx.requestId, metadata: { from: String(target.role), to: role } });
}

export async function setMemberSuspended(access: OrgAccess, memberId: string, suspended: boolean): Promise<void> {
  const target = await loadTarget(access, memberId);
  assertCanManage(access, target);
  await access.ctx.db.collection("company_members").updateOne({ _id: target._id, role: { $ne: "owner" } }, { $set: { status: suspended ? "suspended" : "active", updatedAt: new Date() } });
  await recordAudit(access.ctx.db, { companyId: access.ctx.companyId, actorUserId: access.ctx.userId, action: suspended ? "member.suspended" : "member.reactivated", entityType: "member", entityId: memberId, requestId: access.ctx.requestId });
}

export async function removeMember(access: OrgAccess, memberId: string): Promise<void> {
  const target = await loadTarget(access, memberId);
  assertCanManage(access, target);
  await access.ctx.db.collection("company_members").deleteOne({ _id: target._id, role: { $ne: "owner" } });
  await recordAudit(access.ctx.db, { companyId: access.ctx.companyId, actorUserId: access.ctx.userId, action: "member.removed", entityType: "member", entityId: memberId, requestId: access.ctx.requestId });
}

/** null = every application the organization is entitled to. Owners and administrators always see everything. */
export async function setMemberAppAccess(access: OrgAccess, memberId: string, raw: unknown): Promise<void> {
  const target = await loadTarget(access, memberId);
  assertCanManage(access, target);
  let appAccess: ApplicationId[] | null = null;
  if (raw !== null) {
    if (!Array.isArray(raw) || !raw.every(isApplicationId)) throw new AppError("VALIDATION_ERROR", "Choose valid applications.");
    appAccess = [...new Set(raw)];
  }
  await access.ctx.db.collection("company_members").updateOne({ _id: target._id }, { $set: { appAccess, updatedAt: new Date() } });
  await recordAudit(access.ctx.db, { companyId: access.ctx.companyId, actorUserId: access.ctx.userId, action: "member.app_access_changed", entityType: "member", entityId: memberId, requestId: access.ctx.requestId, metadata: { apps: appAccess ? appAccess.join(",") : "all" } });
}

// ───────────────────────── Audit log ─────────────────────────

export type AuditView = { id: string; action: string; entityType: string; actorName: string; occurredAt: string; details: string };

export async function listAuditEvents(access: OrgAccess, before?: string): Promise<{ items: AuditView[]; next: string | null }> {
  requireManager(access);
  const { db, companyId } = access.ctx;
  const filter: Record<string, unknown> = { companyId };
  if (before && ObjectId.isValid(before)) filter._id = { $lt: new ObjectId(before) };
  const docs = await db.collection("audit_events").find(filter).sort({ _id: -1 }).limit(51).toArray();
  const page = docs.slice(0, 50);
  const actors = await db.collection("users").find({ _id: { $in: [...new Set(page.map((d) => d.actorUserId as ObjectId))] } }, { projection: { name: 1, email: 1 } }).toArray();
  const names = new Map(actors.map((a) => [a._id.toHexString(), String(a.name ?? a.email ?? "Unknown")]));
  return {
    items: page.map((d) => ({
      id: (d._id as ObjectId).toHexString(),
      action: String(d.action),
      entityType: String(d.entityType),
      actorName: names.get((d.actorUserId as ObjectId)?.toHexString?.() ?? "") ?? "System",
      occurredAt: (d.occurredAt as Date).toISOString(),
      details: Object.entries((d.metadata as Record<string, unknown>) ?? {})
        .map(([k, v]) => `${k}: ${String(v)}`)
        .join(" · "),
    })),
    next: docs.length > 50 ? (page.at(-1)?._id as ObjectId).toHexString() : null,
  };
}

// ───────────────────────── Organizations of a person (multi-tenancy) ─────────────────────────

export type MyOrganization = {
  id: string;
  name: string;
  slug: string;
  role: CompanyRole;
  plan: string;
  appCount: number;
  currency: string;
  active: boolean;
  pendingActivation: boolean;
  logoUrl: string | null;
};

/** Every organization the person actively belongs to, with their role and the organization's current plan. */
export async function listMyOrganizations(db: Db, userId: ObjectId, activeId: string): Promise<MyOrganization[]> {
  const companies = await getUserCompanies(userId.toHexString());
  const members = await db.collection("company_members").find({ userId, status: "active", companyId: { $in: companies.map((c) => new ObjectId(c.id)) } }, { projection: { companyId: 1, role: 1 } }).toArray();
  const roles = new Map(members.map((m) => [(m.companyId as ObjectId).toHexString(), m.role as CompanyRole]));
  return Promise.all(
    companies.map(async (company) => {
      const ent = await getEntitlements(db, new ObjectId(company.id));
      const plan =
        ent.kind === "trial" ? `Trial · ${ent.trialDaysLeft}d left` : ent.kind === "legacy" ? "Full access" : ent.plan ? PLANS[ent.plan].name : ent.kind === "trial_expired" ? "Trial ended" : "Choose a plan";
      return {
        id: company.id,
        name: company.name,
        slug: company.slug,
        role: roles.get(company.id) ?? "employee",
        plan,
        appCount: ent.appIds.length,
        currency: company.currency,
        active: company.id === activeId,
        pendingActivation: company.activationStatus === "pending",
        logoUrl: company.logoUrl ?? null,
      };
    })
  );
}

export type OrganizationStats = { staff: number; departments: number; jobTitles: number };

/** HR-side counters shown on the overview (they come from the HR & Payroll data of this organization only). */
export async function getOrganizationStats(access: OrgAccess): Promise<OrganizationStats> {
  const stats = await getCompanyStats(access.ctx.companyId.toHexString());
  return { staff: stats.employeesCount, departments: stats.departmentsCount, jobTitles: stats.jobTitlesCount };
}

/** A non-owner leaves the organization. The owner must hand over or delete the organization instead (not offered here). */
export async function leaveOrganization(access: OrgAccess): Promise<void> {
  if (access.companyRole === "owner") throw new AppError("FORBIDDEN", "The owner cannot leave the organization.");
  const { db, companyId, userId, requestId } = access.ctx;
  const result = await db.collection("company_members").deleteOne({ companyId, userId, role: { $ne: "owner" } });
  if (result.deletedCount !== 1) throw new AppError("NOT_FOUND", "Membership not found.");
  await recordAudit(db, { companyId, actorUserId: userId, action: "member.left", entityType: "member", entityId: userId.toHexString(), requestId });
}
