import "server-only";
import { createHash } from "crypto";
import { ObjectId } from "mongodb";
import { assertAiReady, resolveAiAccess, type AiAccess } from "@/server/ai/access/access.service";
import { aiScope } from "@/server/ai/data/scope";
import { isToolAvailable, requireTool, type ToolRegistry } from "@/server/ai/tools/registry";
import type { ToolResult } from "@/server/ai/tools/define-tool";
import { recordAudit } from "@/server/audit/audit.service";
import type { AiDiffRow, AiMessagePart, AiPendingActionDoc } from "@/server/db/documents";
import type { WorkspaceContext } from "@/server/tenancy/workspace";
import type { AiRisk } from "@/shared/domain/ai";
import { AppError, isAppError } from "@/shared/lib/errors";
import { toFieldErrors } from "@/shared/lib/validation";

/** A proposal lives ten minutes. After that the person has to ask again, so stale intent never executes. */
export const PENDING_TTL_MS = 10 * 60 * 1000;
export const MAX_OPEN_PENDING_PER_MEMBER = 10;
const MAX_ARGS_CHARS = 8_000;
/** Upper bound for one confirmed execution. The service call is not interrupted; the caller stops waiting. */
export const EXECUTION_TIMEOUT_MS = 30_000;

export type PendingActionView = {
  id: string;
  tool: string;
  risk: AiRisk;
  summary: string;
  requiresTyped: boolean;
  /** Shown to the person so they know what to type. */
  typedPhrase: string | null;
  details: AiDiffRow[];
  expiresAt: string;
};

/** The card the workspace renders for a stored proposal. Built from server data only. */
export function confirmationPart(pending: PendingActionView): AiMessagePart {
  return {
    type: "confirmation",
    actionId: pending.id,
    tool: pending.tool,
    risk: pending.risk,
    summary: pending.summary,
    requiresTyped: pending.requiresTyped,
    typedPhrase: pending.typedPhrase,
    details: pending.details,
  };
}

function view(doc: AiPendingActionDoc): PendingActionView {
  return {
    id: doc._id.toHexString(),
    tool: doc.toolName,
    risk: doc.risk,
    summary: doc.summary,
    requiresTyped: doc.requiresTyped,
    typedPhrase: doc.typedPhrase,
    details: doc.details,
    expiresAt: doc.expiresAt.toISOString(),
  };
}

/** Canonical JSON: keys sorted at every level, so the hash does not depend on property order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function hashArgs(args: unknown): string {
  return createHash("sha256").update(canonical(args)).digest("hex");
}

function normalizeTyped(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Stores a write the model asked for. Nothing runs. The summary shown to the person is built here
 * from the validated arguments, never taken from model text, and the arguments are hashed so
 * tampering between proposal and confirmation is detectable.
 */
export async function proposeAction(
  ctx: WorkspaceContext,
  access: AiAccess,
  registry: ToolRegistry,
  input: { toolName: string; rawArgs: unknown; conversationId: ObjectId | null }
): Promise<PendingActionView> {
  assertAiReady(access);
  const tool = requireTool(registry, input.toolName);
  if (tool.kind !== "write") throw new AppError("VALIDATION_ERROR", "Only changes need confirmation.");
  if (!isToolAvailable(tool, access)) throw new AppError("FORBIDDEN", "You do not have access to that action through AI.");

  const parsed = tool.input.safeParse(input.rawArgs);
  if (!parsed.success) {
    throw new AppError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "The request is incomplete.", toFieldErrors(parsed.error));
  }
  // Store the RAW proposed arguments, not the schema's output: confirmation parses them again from
  // scratch, so what runs is exactly what was validated here, and parsing never has to be idempotent.
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(JSON.stringify(input.rawArgs ?? {})) as Record<string, unknown>;
  } catch {
    throw new AppError("VALIDATION_ERROR", "The request is invalid.");
  }
  if (JSON.stringify(args).length > MAX_ARGS_CHARS) throw new AppError("VALIDATION_ERROR", "The request is too large.");

  const scope = aiScope(ctx);
  const now = new Date();
  const tooMany = () => new AppError("RATE_LIMITED", "You have several changes waiting for confirmation. Confirm or cancel them first.");
  if ((await scope.pending.countDocuments({ status: "pending", expiresAt: { $gt: now } })) >= MAX_OPEN_PENDING_PER_MEMBER) throw tooMany();

  // Prepared with the LIVE role and permissions, through the module's own services.
  const liveCtx: WorkspaceContext = { ...ctx, role: access.member!.role, permissions: access.member!.permissions };
  const prepared = tool.prepare
    ? await tool.prepare(liveCtx, parsed.data, { access })
    : { context: {}, summary: tool.summarize!(parsed.data), details: [], typedPhrase: tool.typedPhrase ? tool.typedPhrase(parsed.data) : null };
  const phrase = prepared.typedPhrase ?? null;
  if ((tool.risk === "destructive" || tool.risk === "financial") && !phrase) {
    throw new AppError("INTERNAL", "Something went wrong. Please try again.");
  }
  const context = prepared.context;
  const doc: AiPendingActionDoc = {
    _id: new ObjectId(),
    companyId: ctx.companyId,
    userId: ctx.userId,
    conversationId: input.conversationId,
    toolName: tool.name,
    module: tool.module,
    operation: tool.operation,
    risk: tool.risk,
    args,
    argsHash: hashArgs({ args, context }),
    summary: prepared.summary.slice(0, 600),
    requiresTyped: phrase !== null,
    typedPhrase: phrase,
    context,
    details: (prepared.details ?? []).slice(0, 20),
    grantVersion: access.grant.version,
    status: "pending",
    statusReason: null,
    createdAt: now,
    expiresAt: new Date(now.getTime() + PENDING_TTL_MS),
    resolvedAt: null,
  };
  await scope.pending.insertOne(doc);
  // Count AFTER inserting: two proposals created at the same moment cannot both slip under the cap, because each one sees the
  // other. The loser is withdrawn (at worst both are, which is the safe side).
  if ((await scope.pending.countDocuments({ status: "pending", expiresAt: { $gt: now } })) > MAX_OPEN_PENDING_PER_MEMBER) {
    await scope.pending.deleteOne({ _id: doc._id });
    throw tooMany();
  }
  await recordAudit(ctx.db, {
    companyId: ctx.companyId,
    actorUserId: ctx.userId,
    action: "ai.action.proposed",
    entityType: "ai_pending_action",
    entityId: doc._id.toHexString(),
    requestId: ctx.requestId,
    metadata: { source: "ai", tool: tool.name, module: tool.module, risk: tool.risk },
  });
  return view(doc);
}

export async function listPendingActions(ctx: WorkspaceContext): Promise<PendingActionView[]> {
  const docs = await aiScope(ctx)
    .pending.find({ status: "pending", expiresAt: { $gt: new Date() } }, { sort: { createdAt: -1 }, limit: MAX_OPEN_PENDING_PER_MEMBER })
    .toArray();
  return docs.map(view);
}

export async function cancelPendingAction(ctx: WorkspaceContext, actionIdRaw: string): Promise<void> {
  if (!ObjectId.isValid(actionIdRaw)) throw new AppError("NOT_FOUND", "That change is no longer pending.");
  const result = await aiScope(ctx).pending.updateOne(
    { _id: new ObjectId(actionIdRaw), status: "pending" },
    { $set: { status: "cancelled", statusReason: "user_cancelled", resolvedAt: new Date() } }
  );
  if (result.matchedCount === 0) throw new AppError("NOT_FOUND", "That change is no longer pending.");
}

export type ConfirmResult = { summary: string; parts: ToolResult["parts"] };

/**
 * Executes a confirmed proposal at most once.
 *
 * Order matters:
 *  1. Look the proposal up in the caller's own scope and give a precise answer for every dead end.
 *  2. Check the typed phrase before claiming, so a typo does not burn the proposal.
 *  3. CLAIM it with one conditional update (pending -> executing). Only one confirmation can win,
 *     so a double click, a retry or two tabs can never run the change twice.
 *  4. Re-resolve the member's live access and the tool's availability AFTER the claim. A revocation
 *     that landed earlier is seen here; one that lands later is bounded by the service's own
 *     permission assertion, which runs with the live role.
 *  5. Verify the stored arguments still match their hash, then run the existing service.
 */
export async function confirmAction(
  ctx: WorkspaceContext,
  registry: ToolRegistry,
  input: { actionId: string; typedConfirmation?: string }
): Promise<ConfirmResult> {
  if (!ObjectId.isValid(input.actionId)) throw new AppError("NOT_FOUND", "That change was not found.");
  const id = new ObjectId(input.actionId);
  const scope = aiScope(ctx);
  const now = new Date();

  const doc = await scope.pending.findOne({ _id: id });
  if (!doc) throw new AppError("NOT_FOUND", "That change was not found.");
  if (doc.status === "executed") throw new AppError("CONFLICT", "This change was already made.");
  if (doc.status === "executing") throw new AppError("CONFLICT", "This change is already being made.");
  if (doc.status === "cancelled") throw new AppError("CONFLICT", "This change was cancelled. Ask again if you still need it.");
  if (doc.status === "failed") throw new AppError("CONFLICT", "This change failed earlier. Ask again to retry it.");
  if (doc.status === "expired" || doc.expiresAt <= now) {
    await scope.pending.updateOne({ _id: id, status: "pending" }, { $set: { status: "expired", statusReason: "expired", resolvedAt: now } });
    throw new AppError("CONFLICT", "This change expired. Ask again if you still need it.");
  }

  if (doc.requiresTyped) {
    const typed = normalizeTyped(input.typedConfirmation ?? "");
    if (!doc.typedPhrase || typed !== normalizeTyped(doc.typedPhrase)) {
      throw new AppError("VALIDATION_ERROR", "Type the confirmation text exactly as shown.", { typedConfirmation: "Does not match." });
    }
  }

  const claimed = await scope.pending.findOneAndUpdate(
    { _id: id, status: "pending", expiresAt: { $gt: now } },
    { $set: { status: "executing", statusReason: null } }
  );
  if (!claimed) throw new AppError("CONFLICT", "This change was already handled.");

  const fail = async (status: "cancelled" | "failed", reason: string) => {
    await scope.pending.updateOne({ _id: id, status: "executing" }, { $set: { status, statusReason: reason, resolvedAt: new Date() } });
  };

  const access = await resolveAiAccess(ctx);
  const tool = registry.get(claimed.toolName);
  if (!tool || tool.kind !== "write" || !isToolAvailable(tool, access)) {
    await fail("cancelled", "access_revoked");
    await recordAudit(ctx.db, {
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: "ai.action.blocked",
      entityType: "ai_pending_action",
      entityId: id.toHexString(),
      requestId: ctx.requestId,
      metadata: { source: "ai", tool: claimed.toolName, reason: "access_revoked" },
    });
    throw new AppError("FORBIDDEN", "Your AI access changed, so this change was not made.");
  }

  if (hashArgs({ args: claimed.args, context: claimed.context ?? {} }) !== claimed.argsHash) {
    await fail("cancelled", "args_changed");
    throw new AppError("CONFLICT", "This change no longer matches what was proposed, so it was not made.");
  }
  const reparsed = tool.input.safeParse(claimed.args);
  if (!reparsed.success) {
    await fail("cancelled", "args_invalid");
    throw new AppError("VALIDATION_ERROR", "This change is no longer valid, so it was not made.");
  }

  // The service is called with the LIVE role and permissions, so its own assertions use current rights.
  const liveCtx: WorkspaceContext = { ...ctx, role: access.member!.role, permissions: access.member!.permissions };
  try {
    const result = await withTimeout(tool.run(liveCtx, reparsed.data, { access }, claimed.context ?? {}), EXECUTION_TIMEOUT_MS);
    await scope.pending.updateOne(
      { _id: id, status: "executing" },
      { $set: { status: "executed", statusReason: result.summary.slice(0, 300), resolvedAt: new Date() } }
    );
    await recordAudit(ctx.db, {
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: "ai.action.executed",
      entityType: "ai_pending_action",
      entityId: id.toHexString(),
      requestId: ctx.requestId,
      metadata: { source: "ai", tool: tool.name, module: tool.module, risk: tool.risk, conversation: claimed.conversationId?.toHexString() ?? "" },
    });
    return { summary: result.summary, parts: result.parts };
  } catch (error) {
    const timedOut = error instanceof ExecutionTimeout;
    // A timeout leaves the outcome unknown: keep it "executing" so it is never retried automatically.
    if (!timedOut) await fail("failed", isAppError(error) ? error.code : "INTERNAL");
    await recordAudit(ctx.db, {
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: timedOut ? "ai.action.unknown_outcome" : "ai.action.failed",
      entityType: "ai_pending_action",
      entityId: id.toHexString(),
      requestId: ctx.requestId,
      metadata: { source: "ai", tool: tool.name, code: isAppError(error) ? error.code : timedOut ? "TIMEOUT" : "INTERNAL" },
    });
    if (timedOut) throw new AppError("CONFLICT", "This change is taking longer than expected. Check the record before trying again.");
    throw error;
  }
}

class ExecutionTimeout extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ExecutionTimeout()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
