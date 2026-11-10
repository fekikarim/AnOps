import { ObjectId, type Db } from "mongodb";
import type { CompanyRole } from "@/features/company/types";
import type { AiActorContext } from "@/server/ai/access/access.service";
import { COLLECTIONS } from "@/server/db/documents";
import type { TestHarness } from "./workspace";
import type { AiModuleGrant, AiModuleKey } from "@/shared/domain/ai";

export type SeededMember = { userId: ObjectId; companyId: ObjectId; role: CompanyRole };

/** Creates a verified user and an active membership, the way the live resolver expects to find them. */
export async function seedMember(db: Db, companyId: ObjectId, role: CompanyRole, userId = new ObjectId()): Promise<SeededMember> {
  await db.collection("users").insertOne({
    _id: userId,
    name: `${role} ${userId.toHexString().slice(-4)}`,
    email: `${userId.toHexString()}@example.test`,
    status: "active",
    emailVerified: new Date(),
  });
  await db.collection(COLLECTIONS.companyMembers).insertOne({
    _id: new ObjectId(),
    companyId,
    userId,
    role,
    status: "active",
    createdAt: new Date(),
  });
  return { userId, companyId, role };
}

export function actorOf(h: TestHarness, member: SeededMember): AiActorContext {
  return { db: h.db, companyId: member.companyId, userId: member.userId, requestId: `test-${new ObjectId().toHexString()}` };
}

/** Two companies, each with members of every role, so isolation tests have something to cross. */
export async function seedTenants(h: TestHarness) {
  const a = h.ctx().companyId;
  const b = h.otherTenant().companyId;
  const A = {
    owner: await seedMember(h.db, a, "owner"),
    admin: await seedMember(h.db, a, "admin"),
    admin2: await seedMember(h.db, a, "admin"),
    manager: await seedMember(h.db, a, "manager"),
    employee: await seedMember(h.db, a, "employee"),
  };
  const B = {
    owner: await seedMember(h.db, b, "owner"),
    admin: await seedMember(h.db, b, "admin"),
    employee: await seedMember(h.db, b, "employee"),
  };
  return { A, B, companyA: a, companyB: b };
}

import { permissionsForRole, workspaceRoleFor } from "@/server/security/permissions";
import type { WorkspaceContext } from "@/server/tenancy/workspace";

/** A WorkspaceContext for a seeded member, shaped exactly as resolveWorkspace would build it. */
export function wsOf(h: TestHarness, member: SeededMember): WorkspaceContext {
  const role = workspaceRoleFor(member.role);
  return {
    db: h.db,
    requestId: `test-${new ObjectId().toHexString()}`,
    userId: member.userId,
    companyId: member.companyId,
    role,
    currencyCode: "TND",
    permissions: permissionsForRole(role),
  };
}

/**
 * Gives a workspace's user live AI access: an active user and membership, the company's AI switch on, and an AI grant for the
 * given modules. For tests of model-backed features that run behind the AI gate with a context built by the harness.
 */
export async function enableAi(h: TestHarness, ctx: WorkspaceContext, modules: Partial<Record<AiModuleKey, Partial<AiModuleGrant>>>, extra: { canViewSensitiveHr?: boolean; dailyTokenCap?: number | null } = {}) {
  const companyRole = ctx.role === "owner" ? "owner" : ctx.role === "admin" ? "admin" : ctx.role === "operator" ? "manager" : "employee";
  const now = new Date();
  await h.db.collection("users").updateOne(
    { _id: ctx.userId },
    { $setOnInsert: { name: `${companyRole} ${ctx.userId.toHexString().slice(-4)}`, email: `${ctx.userId.toHexString()}@example.test`, status: "active", emailVerified: now } },
    { upsert: true }
  );
  await h.db.collection(COLLECTIONS.companyMembers).updateOne(
    { companyId: ctx.companyId, userId: ctx.userId },
    { $set: { role: companyRole, status: "active" }, $setOnInsert: { _id: new ObjectId(), createdAt: now } },
    { upsert: true }
  );
  await h.db.collection(COLLECTIONS.aiSettings).updateOne(
    { companyId: ctx.companyId },
    { $setOnInsert: { _id: new ObjectId(), enabled: true, retentionDays: 90, dailyTokenBudget: 0, defaultUserDailyTokenCap: 0, version: 1, updatedBy: ctx.userId, updatedAt: now } },
    { upsert: true }
  );
  const cells = Object.fromEntries(Object.entries(modules).map(([m, c]) => [m, { view: false, create: false, edit: false, delete: false, approve: false, ...c }]));
  await h.db.collection(COLLECTIONS.aiAccessGrants).updateOne(
    { companyId: ctx.companyId, userId: ctx.userId },
    { $set: { enabled: true, modules: cells, canAuditTranscripts: false, canViewSensitiveHr: extra.canViewSensitiveHr ?? false, dailyTokenCap: extra.dailyTokenCap ?? null, updatedBy: ctx.userId, updatedAt: now }, $setOnInsert: { _id: new ObjectId(), version: 1 } },
    { upsert: true }
  );
}
