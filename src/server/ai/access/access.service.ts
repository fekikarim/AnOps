import "server-only";
import { ObjectId, type Db } from "mongodb";
import { isAiKillSwitchOn } from "@/server/ai/platform";
import { aiCompanyPending, aiRetentionWriter, aiScope, aiScopeForMember, type AiScopeContext } from "@/server/ai/data/scope";
import {
  AI_MODULES,
  AI_OPERATIONS,
  ceilingFor,
  emptyModuleGrant,
  roleAllows,
  violations,
} from "@/server/ai/access/capabilities";
import { recordAudit } from "@/server/audit/audit.service";
import { getEntitlements } from "@/server/platform/subscription.service";
import { COLLECTIONS, type AiAccessGrantDoc, type AiSettingsDoc } from "@/server/db/documents";
import { withTransaction, type Tx } from "@/server/db/transactions";
import {
  PERMISSIONS,
  permissionsForRole,
  workspaceRoleFor,
  type Permission,
  type WorkspaceRole,
} from "@/server/security/permissions";
import type { CompanyRole } from "@/features/company/types";
import {
  aiSettingsInputSchema,
  memberGrantInputSchema,
  type AiSettingsInput,
  type MemberGrantInput,
} from "@/features/ai/schemas/ai.schema";
import type { AiModuleGrant, AiModuleKey, AiModules, AiOperation } from "@/shared/domain/ai";
import { AppError } from "@/shared/lib/errors";
import { toFieldErrors } from "@/shared/lib/validation";

/** What every AI service needs from the caller: the trusted ids from resolveWorkspace, nothing more. */
export type AiActorContext = AiScopeContext & { requestId: string };

export const DEFAULT_RETENTION_DAYS = 90;
export const DEFAULT_COMPANY_DAILY_TOKENS = 500_000;
export const DEFAULT_USER_DAILY_TOKENS = 50_000;

export type LiveMember = {
  companyRole: CompanyRole;
  role: WorkspaceRole;
  permissions: ReadonlySet<Permission>;
};

/**
 * Re-reads the member and the account from the database, on every call. This is what makes a
 * revocation, a role change, a ban or a removal take effect immediately, even in the middle of a
 * conversation: nothing about the member is cached from the start of a request or a stream.
 */
export async function loadLiveMember(db: Db, companyId: ObjectId, userId: ObjectId): Promise<LiveMember | null> {
  const [member, user] = await Promise.all([
    db.collection(COLLECTIONS.companyMembers).findOne({ companyId, userId }, { projection: { role: 1, status: 1 } }),
    db.collection("users").findOne({ _id: userId }, { projection: { status: 1, emailVerified: 1 } }),
  ]);
  if (!member || member.status !== "active") return null;
  if (!user || user.status === "banned" || user.status === "unverified" || !user.emailVerified) return null;
  const companyRole = member.role as CompanyRole;
  const role = workspaceRoleFor(companyRole);
  return { companyRole, role, permissions: permissionsForRole(role) };
}

export type AiSettingsView = {
  enabled: boolean;
  retentionDays: number;
  dailyTokenBudget: number;
  defaultUserDailyTokenCap: number;
  version: number;
};

function settingsView(doc: AiSettingsDoc | null): AiSettingsView {
  return {
    enabled: doc?.enabled ?? false,
    retentionDays: doc?.retentionDays ?? DEFAULT_RETENTION_DAYS,
    dailyTokenBudget: doc?.dailyTokenBudget ?? DEFAULT_COMPANY_DAILY_TOKENS,
    defaultUserDailyTokenCap: doc?.defaultUserDailyTokenCap ?? DEFAULT_USER_DAILY_TOKENS,
    version: doc?.version ?? 0,
  };
}

export async function getAiSettings(ctx: AiActorContext): Promise<AiSettingsView> {
  return settingsView(await aiScope(ctx).settings.findOne());
}

export type AiGrantView = {
  enabled: boolean;
  modules: AiModules;
  canAuditTranscripts: boolean;
  canViewSensitiveHr: boolean;
  dailyTokenCap: number | null;
  version: number;
  /** True for the owner's built-in access, which exists until an owner saves an explicit grant. */
  isDefault: boolean;
};

function grantView(doc: AiAccessGrantDoc): AiGrantView {
  return {
    enabled: doc.enabled,
    modules: doc.modules,
    canAuditTranscripts: doc.canAuditTranscripts,
    canViewSensitiveHr: doc.canViewSensitiveHr,
    dailyTokenCap: doc.dailyTokenCap,
    version: doc.version,
    isDefault: false,
  };
}

/** The owner's access before anyone saves a grant: enabled, every module open up to the role ceiling, no audit or sensitive flags. */
function ownerDefaultGrant(member: LiveMember): AiGrantView {
  return {
    enabled: true,
    modules: ceilingFor(member.permissions),
    canAuditTranscripts: false,
    canViewSensitiveHr: false,
    dailyTokenCap: null,
    version: 0,
    isDefault: true,
  };
}

const NO_GRANT: AiGrantView = {
  enabled: false,
  modules: {},
  canAuditTranscripts: false,
  canViewSensitiveHr: false,
  dailyTokenCap: null,
  version: 0,
  isDefault: false,
};

export type AiAccessState = "ready" | "platform_disabled" | "plan_excluded" | "company_disabled" | "not_granted" | "inactive";

export type AiAccess = {
  state: AiAccessState;
  member: LiveMember | null;
  settings: AiSettingsView;
  grant: AiGrantView;
  /** Per-member token ceiling per UTC day after applying the company default. 0 means none. */
  tokenCap: number;
  /** True only when AI is ready AND the grant AND the role both allow the operation. */
  can(module: AiModuleKey, operation: AiOperation): boolean;
};

/**
 * The single answer to "what may this member do with AI right now?". Called at the start of every
 * chat turn, before every tool step, and again when a pending action is confirmed.
 */
export async function resolveAiAccess(ctx: AiActorContext): Promise<AiAccess> {
  const scope = aiScope(ctx);
  const [settingsDoc, grantDoc, member, entitlements] = await Promise.all([
    scope.settings.findOne(),
    scope.grants.findOne({ userId: ctx.userId }),
    loadLiveMember(ctx.db, ctx.companyId, ctx.userId),
    getEntitlements(ctx.db, ctx.companyId),
  ]);
  const settings = settingsView(settingsDoc);

  let grant = grantDoc ? grantView(grantDoc) : NO_GRANT;
  if (!grantDoc && member?.companyRole === "owner") grant = ownerDefaultGrant(member);

  let state: AiAccessState = "ready";
  // The platform switch (AI_KILL_SWITCH) wins over everything and is read on every call, so it takes effect on the next request.
  if (isAiKillSwitchOn()) state = "platform_disabled";
  // Subscription entitlement: OneOps and AllOps never include AI features (MaxOps, Custom + AI add-on, or a trial do).
  else if (!entitlements.aiFeatures) state = "plan_excluded";
  else if (!member) state = "inactive";
  else if (!settings.enabled) state = "company_disabled";
  else if (!grant.enabled) state = "not_granted";

  const tokenCap = grant.dailyTokenCap ?? settings.defaultUserDailyTokenCap;

  return {
    state,
    member,
    settings,
    grant,
    tokenCap,
    can(module, operation) {
      if (state !== "ready" || !member) return false;
      return grant.modules[module]?.[operation] === true && roleAllows(member.permissions, module, operation);
    },
  };
}

/** Throws FORBIDDEN with a message that tells the person which switch is off. */
export function assertAiReady(access: AiAccess): void {
  if (access.state === "ready") return;
  const messages: Record<Exclude<AiAccessState, "ready">, string> = {
    platform_disabled: "AI is temporarily switched off for the whole platform. Try again later.",
    plan_excluded: "AI features are not included in your organization's plan. They are part of MaxOps and the Custom AI add-on.",
    company_disabled: "AI is not enabled for this company. Ask an owner or administrator.",
    not_granted: "AI access is not enabled for your account. Ask an owner or administrator.",
    inactive: "Your account is not active in this company.",
  };
  throw new AppError("FORBIDDEN", messages[access.state]);
}

/** Loads the live member and requires ai.access.manage. */
async function requireManager(ctx: AiActorContext): Promise<LiveMember> {
  const member = await loadLiveMember(ctx.db, ctx.companyId, ctx.userId);
  if (!member || !member.permissions.has(PERMISSIONS.AI_ACCESS_MANAGE)) {
    throw new AppError("FORBIDDEN", "You do not have permission to manage AI access.");
  }
  return member;
}

function parseOrThrow<T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: import("zod").ZodError } }, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  throw new AppError("VALIDATION_ERROR", result.error.issues[0]?.message ?? "The submitted data is invalid.", toFieldErrors(result.error));
}

/** Company settings. Optimistic concurrency: a stale expectedVersion is a CONFLICT, never a silent overwrite. */
export async function updateAiSettings(ctx: AiActorContext, rawSettings: unknown, expectedVersion: number): Promise<AiSettingsView> {
  await requireManager(ctx);
  const input: AiSettingsInput = parseOrThrow(aiSettingsInputSchema, rawSettings);

  await withTransaction(ctx.db, async (tx) => {
    const scope = aiScope(ctx);
    const now = new Date();
    if (expectedVersion === 0) {
      await scope.settings.insertOne(
        { _id: new ObjectId(), ...input, version: 1, updatedBy: ctx.userId, updatedAt: now },
        { session: tx.session }
      );
      tx.onRollback(() => scope.settings.deleteOne({ version: 1 }));
    } else {
      const result = await scope.settings.updateOne(
        { version: expectedVersion },
        { $set: { ...input, updatedBy: ctx.userId, updatedAt: now }, $inc: { version: 1 } },
        { session: tx.session }
      );
      if (result.matchedCount === 0) throw new AppError("CONFLICT", "AI settings changed since you opened them. Reload and try again.");
    }
    await recordAudit(
      ctx.db,
      {
        companyId: ctx.companyId,
        actorUserId: ctx.userId,
        action: "ai.settings.updated",
        entityType: "ai_settings",
        entityId: ctx.companyId.toHexString(),
        requestId: ctx.requestId,
        metadata: {
          enabled: input.enabled,
          retentionDays: input.retentionDays,
          dailyTokenBudget: input.dailyTokenBudget,
          defaultUserDailyTokenCap: input.defaultUserDailyTokenCap,
        },
      },
      tx
    );
  });
  await aiRetentionWriter(ctx).reapply(input.retentionDays);
  // Switching AI off ends every open proposal of the company, so turning it back on never revives stale intent.
  if (!input.enabled) {
    await aiCompanyPending(ctx).updateMany({ status: "pending" }, { $set: { status: "cancelled", statusReason: "ai_disabled", resolvedAt: new Date() } });
  }
  return getAiSettings(ctx);
}

export type AccessMemberDto = {
  userId: string;
  name: string;
  email: string;
  companyRole: CompanyRole;
  isSelf: boolean;
  /** Whether the caller may edit this member's grant. */
  editable: boolean;
  editBlockedReason: string | null;
  /** Cells the member's role allows at all. The editor disables everything else. */
  ceiling: Record<AiModuleKey, AiModuleGrant>;
  grant: AiGrantView;
};

function editability(manager: LiveMember, managerUserId: ObjectId, targetUserId: ObjectId, targetRole: CompanyRole) {
  if (manager.companyRole === "owner") return { editable: true, reason: null as string | null };
  if (managerUserId.equals(targetUserId)) return { editable: false, reason: "You cannot change your own AI access." };
  if (targetRole === "owner" || targetRole === "admin") {
    return { editable: false, reason: "Only an owner can manage an owner's or administrator's AI access." };
  }
  return { editable: true, reason: null as string | null };
}

export async function listAccessMembers(ctx: AiActorContext): Promise<AccessMemberDto[]> {
  const manager = await requireManager(ctx);
  const members = await ctx.db
    .collection(COLLECTIONS.companyMembers)
    .find({ companyId: ctx.companyId, status: "active" })
    .sort({ createdAt: 1 })
    .limit(500)
    .toArray();
  if (members.length === 0) return [];
  const userIds = members.map((m) => m.userId as ObjectId);
  const [users, grants] = await Promise.all([
    ctx.db.collection("users").find({ _id: { $in: userIds } }, { projection: { name: 1, email: 1 } }).toArray(),
    aiScope(ctx).grants.find({ userId: { $in: userIds } }).toArray(),
  ]);
  const userById = new Map(users.map((u) => [u._id.toHexString(), u]));
  const grantByUser = new Map(grants.map((g) => [g.userId.toHexString(), g]));

  return members.map((m) => {
    const userId = m.userId as ObjectId;
    const companyRole = m.role as CompanyRole;
    const permissions = permissionsForRole(workspaceRoleFor(companyRole));
    const doc = grantByUser.get(userId.toHexString());
    const live: LiveMember = { companyRole, role: workspaceRoleFor(companyRole), permissions };
    const grant = doc ? grantView(doc) : companyRole === "owner" ? ownerDefaultGrant(live) : NO_GRANT;
    const edit = editability(manager, ctx.userId, userId, companyRole);
    const user = userById.get(userId.toHexString());
    return {
      userId: userId.toHexString(),
      name: (user?.name as string | undefined) || "Team member",
      email: (user?.email as string | undefined) || "",
      companyRole,
      isSelf: userId.equals(ctx.userId),
      editable: edit.editable,
      editBlockedReason: edit.reason,
      ceiling: ceilingFor(permissions),
      grant,
    };
  });
}

function changedCells(prev: AiModules, next: AiModules): string[] {
  const out: string[] = [];
  for (const mod of AI_MODULES) {
    for (const operation of AI_OPERATIONS) {
      const before = prev[mod]?.[operation] === true;
      const after = next[mod]?.[operation] === true;
      if (before !== after) out.push(`${mod}.${operation}:${after ? "on" : "off"}`);
    }
  }
  return out;
}

function normalizeModules(modules: AiModules): AiModules {
  const out: AiModules = {};
  for (const mod of AI_MODULES) {
    const grant = modules[mod];
    if (!grant) continue;
    const full = emptyModuleGrant();
    for (const operation of AI_OPERATIONS) full[operation] = grant[operation] === true;
    if (AI_OPERATIONS.some((op) => full[op])) out[mod] = full;
  }
  return out;
}

/** True when `next` removes anything `prev` allowed. Reductions cancel the member's pending actions. */
function reducesAccess(prev: AiGrantView, next: MemberGrantInput & { modules: AiModules }): boolean {
  if (prev.enabled && !next.enabled) return true;
  if (changedCells(prev.modules, next.modules).some((c) => c.endsWith(":off"))) return true;
  if (prev.canAuditTranscripts && !next.canAuditTranscripts) return true;
  return false;
}

/** Cancels every open pending action of one member. Idempotent. Returns how many were cancelled. */
export async function cancelPendingForMember(
  ctx: Pick<AiActorContext, "db" | "companyId">,
  memberUserId: ObjectId,
  reason: string,
  tx?: Tx
): Promise<number> {
  const result = await aiScopeForMember(ctx, memberUserId).pending.updateMany(
    { status: "pending" },
    { $set: { status: "cancelled", statusReason: reason, resolvedAt: new Date() } },
    { session: tx?.session }
  );
  return result.modifiedCount;
}

/**
 * Saves one member's grant. Rules, all enforced here and never in the client:
 * - the caller must hold ai.access.manage (live, not from the request);
 * - admins cannot touch their own grant, an owner's, or another administrator's. Only owners can;
 * - no cell may exceed the target member's role ceiling (rejected, not silently trimmed);
 * - audit and sensitive-HR switches are owner-only, and audit may only go to an owner or administrator;
 * - the write is version-checked, so two administrators cannot overwrite each other unnoticed;
 * - a reduction cancels the member's pending actions in the same unit of work.
 */
export async function saveMemberGrant(
  ctx: AiActorContext,
  targetUserIdRaw: string,
  rawGrant: unknown,
  expectedVersion: number
): Promise<AiGrantView> {
  const manager = await requireManager(ctx);
  const input = parseOrThrow(memberGrantInputSchema, rawGrant);
  if (!ObjectId.isValid(targetUserIdRaw)) throw new AppError("NOT_FOUND", "Member not found.");
  const targetUserId = new ObjectId(targetUserIdRaw);

  const targetMember = await ctx.db
    .collection(COLLECTIONS.companyMembers)
    .findOne({ companyId: ctx.companyId, userId: targetUserId, status: "active" }, { projection: { role: 1 } });
  if (!targetMember) throw new AppError("NOT_FOUND", "Member not found.");
  const targetRole = targetMember.role as CompanyRole;

  const edit = editability(manager, ctx.userId, targetUserId, targetRole);
  if (!edit.editable) throw new AppError("FORBIDDEN", edit.reason ?? "You cannot manage this member's AI access.");

  const targetPermissions = permissionsForRole(workspaceRoleFor(targetRole));
  const modules = normalizeModules(input.modules);
  const over = violations(modules, targetPermissions);
  if (over.length > 0) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Some access is above what this member's role allows in AnOps.",
      Object.fromEntries(over.map((cell) => [cell, "Not allowed by this member's role."]))
    );
  }

  const live: LiveMember = { companyRole: targetRole, role: workspaceRoleFor(targetRole), permissions: targetPermissions };
  const existing = await aiScope(ctx).grants.findOne({ userId: targetUserId });
  const previous: AiGrantView = existing ? grantView(existing) : targetRole === "owner" ? ownerDefaultGrant(live) : NO_GRANT;

  const flagsChanged =
    input.canAuditTranscripts !== previous.canAuditTranscripts || input.canViewSensitiveHr !== previous.canViewSensitiveHr;
  if (flagsChanged && manager.companyRole !== "owner") {
    throw new AppError("FORBIDDEN", "Only an owner can change transcript-audit and sensitive-data access.");
  }
  if (input.canAuditTranscripts && targetRole !== "owner" && targetRole !== "admin") {
    throw new AppError("VALIDATION_ERROR", "Transcript audit can only be given to an owner or administrator.", {
      canAuditTranscripts: "Not available for this role.",
    });
  }

  const reduces = reducesAccess(previous, { ...input, modules });
  const cells = changedCells(previous.modules, modules);

  await withTransaction(ctx.db, async (tx) => {
    const scope = aiScope(ctx);
    const now = new Date();
    const fields = {
      enabled: input.enabled,
      modules,
      canAuditTranscripts: input.canAuditTranscripts,
      canViewSensitiveHr: input.canViewSensitiveHr,
      dailyTokenCap: input.dailyTokenCap,
      updatedBy: ctx.userId,
      updatedAt: now,
    };

    if (!existing) {
      if (expectedVersion !== 0) throw new AppError("CONFLICT", "This member's AI access changed. Reload and try again.");
      await scope.grants.insertOne({ _id: new ObjectId(), userId: targetUserId, ...fields, version: 1 }, { session: tx.session });
      tx.onRollback(() => scope.grants.deleteOne({ userId: targetUserId, version: 1 }));
    } else {
      const result = await scope.grants.updateOne(
        { userId: targetUserId, version: expectedVersion },
        { $set: fields, $inc: { version: 1 } },
        { session: tx.session }
      );
      if (result.matchedCount === 0) throw new AppError("CONFLICT", "This member's AI access changed. Reload and try again.");
      tx.onRollback(() => scope.grants.updateOne({ userId: targetUserId }, { $set: { ...previousFields(existing) } }));
    }

    const cancelled = reduces ? await cancelPendingForMember(ctx, targetUserId, "access_changed", tx) : 0;

    await recordAudit(
      ctx.db,
      {
        companyId: ctx.companyId,
        actorUserId: ctx.userId,
        action: "ai.access.updated",
        entityType: "ai_access_grant",
        entityId: targetUserId.toHexString(),
        requestId: ctx.requestId,
        metadata: {
          enabled: input.enabled,
          changedCells: cells.slice(0, 20).join(","),
          canAuditTranscripts: input.canAuditTranscripts,
          canViewSensitiveHr: input.canViewSensitiveHr,
          cancelledPendingActions: cancelled,
        },
      },
      tx
    );
  });

  const saved = await aiScope(ctx).grants.findOne({ userId: targetUserId });
  if (!saved) throw new AppError("INTERNAL", "Something went wrong. Please try again.");
  return grantView(saved);
}

function previousFields(doc: AiAccessGrantDoc) {
  return {
    enabled: doc.enabled,
    modules: doc.modules,
    canAuditTranscripts: doc.canAuditTranscripts,
    canViewSensitiveHr: doc.canViewSensitiveHr,
    dailyTokenCap: doc.dailyTokenCap,
    updatedBy: doc.updatedBy,
    updatedAt: doc.updatedAt,
    version: doc.version,
  };
}
