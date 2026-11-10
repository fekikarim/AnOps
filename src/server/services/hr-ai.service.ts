import "server-only";

import { ObjectId, type Filter, type Document } from "mongodb";
import clientPromise from "@/server/db/client";
import { ensureIndexes } from "@/server/db/indexes";
import { HR_AI_COLLECTIONS } from "@/server/services/hr-ai.indexes";
import { cancelLeaveRequest, createLeaveRequest, getLeaveRequests } from "@/server/services/hr.service";
import { formatDateYMD } from "@/features/hr/utils/date-utils";
import type { LeaveRequest } from "@/features/hr/types";
import type { AiActionResult, AiAuditEntry, AiAuditEventType, ConfirmationCard } from "@/features/hr/ai/types";

/** How long a confirmation card stays valid. */
const PENDING_ACTION_TTL_MS = 15 * 60 * 1000;
/** Free-text arguments can hold personal details (a medical reason), so the audit log never stores them. */
const REDACTED_ARGUMENT_KEYS = new Set(["reason", "message", "query"]);

export type AiActor = {
  userId: string;
  employeeId?: string;
  companyId: string;
  role: string;
  actorName: string;
  conversationId?: string;
};

async function getDb() {
  const client = await clientPromise;
  const db = client.db();
  await ensureIndexes(db);
  return db;
}

function companyObjectId(companyId: string): ObjectId {
  if (!companyId || !ObjectId.isValid(companyId)) {
    throw new Error("A valid company is required.");
  }
  return new ObjectId(companyId);
}

// ─── Audit log (append-only: this module has no update or delete path for it) ─────────────────

export function sanitizeAuditArguments(args: unknown): Record<string, unknown> | undefined {
  if (!args || typeof args !== "object") return undefined;
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args).slice(0, 12)) {
    if (REDACTED_ARGUMENT_KEYS.has(key)) clean[key] = "[redacted]";
    else if (typeof value === "string") clean[key] = value.slice(0, 80);
    else if (typeof value === "number" || typeof value === "boolean") clean[key] = value;
  }
  return clean;
}

export type AiAuditInput = {
  eventType: AiAuditEventType;
  toolName?: string;
  arguments?: unknown;
  resultStatus: string;
  provider?: string;
  model?: string;
  latencyMs?: number;
};

/** Records one AI event. An audit outage is logged and never breaks the user's request. */
export async function logAiEvent(actor: AiActor, event: AiAuditInput): Promise<void> {
  try {
    const db = await getDb();
    await db.collection(HR_AI_COLLECTIONS.auditLog).insertOne({
      companyId: companyObjectId(actor.companyId),
      userId: actor.userId,
      actorName: actor.actorName,
      role: actor.role,
      conversationId: actor.conversationId,
      eventType: event.eventType,
      toolName: event.toolName,
      arguments: sanitizeAuditArguments(event.arguments),
      resultStatus: event.resultStatus,
      provider: event.provider,
      model: event.model,
      latencyMs: event.latencyMs,
      createdAt: new Date(),
    });
  } catch (err) {
    console.error("[hr-ai] audit write failed", err instanceof Error ? err.name : "unknown");
  }
}

export type AiAuditFilter = {
  eventType?: AiAuditEventType;
  toolName?: string;
  provider?: string;
  actorName?: string;
  from?: string;
  to?: string;
  /** Id of the last row of the previous page. */
  before?: string;
};

const AUDIT_PAGE_SIZE = 50;

export async function listAiAuditEntries(
  filter: AiAuditFilter,
  companyId: string
): Promise<{ entries: AiAuditEntry[]; nextCursor: string | null; actorNames: string[] }> {
  const db = await getDb();
  const cId = companyObjectId(companyId);
  const query: Filter<Document> = { companyId: cId };
  if (filter.eventType) query.eventType = filter.eventType;
  if (filter.toolName) query.toolName = filter.toolName;
  if (filter.provider) query.provider = filter.provider;
  if (filter.actorName) query.actorName = filter.actorName;
  if (filter.from || filter.to) {
    query.createdAt = {
      ...(filter.from ? { $gte: new Date(`${filter.from}T00:00:00.000Z`) } : {}),
      ...(filter.to ? { $lte: new Date(`${filter.to}T23:59:59.999Z`) } : {}),
    };
  }
  if (filter.before && ObjectId.isValid(filter.before)) {
    query._id = { $lt: new ObjectId(filter.before) };
  }

  const collection = db.collection(HR_AI_COLLECTIONS.auditLog);
  const [docs, actorNames] = await Promise.all([
    collection.find(query).sort({ _id: -1 }).limit(AUDIT_PAGE_SIZE + 1).toArray(),
    collection.distinct("actorName", { companyId: cId }),
  ]);
  const page = docs.slice(0, AUDIT_PAGE_SIZE);

  return {
    entries: page.map((doc) => ({
      id: doc._id.toString(),
      userId: doc.userId as string,
      actorName: doc.actorName as string,
      role: doc.role as string,
      conversationId: doc.conversationId as string | undefined,
      eventType: doc.eventType as AiAuditEventType,
      toolName: doc.toolName as string | undefined,
      arguments: doc.arguments as Record<string, unknown> | undefined,
      resultStatus: doc.resultStatus as string,
      provider: doc.provider as string | undefined,
      model: doc.model as string | undefined,
      latencyMs: doc.latencyMs as number | undefined,
      createdAt: (doc.createdAt as Date).toISOString(),
    })),
    nextCursor: docs.length > AUDIT_PAGE_SIZE ? page[page.length - 1]._id.toString() : null,
    actorNames: (actorNames as string[]).sort(),
  };
}

// ─── Pending actions ──────────────────────────────────────────────────────────────────────────

export type LeaveDraftPayload = {
  employeeId: string;
  leaveType: "annual" | "sick" | "unpaid" | "maternity_paternity" | "bereavement" | "other";
  startDate: string;
  endDate: string;
  halfDayOption?: "morning" | "afternoon";
  reason: string;
};

export type CancelLeavePayload = {
  employeeId: string;
  requestId: string;
  reason: string;
};

type PendingAction =
  | { toolName: "create_leave_draft"; payload: LeaveDraftPayload }
  | { toolName: "cancel_my_leave_request"; payload: CancelLeavePayload };

/**
 * Stores a validated write as PENDING and returns the card the user must confirm.
 * This is the only thing a write tool does: nothing touches leave data until confirmation.
 */
export async function createPendingAction(
  actor: AiActor,
  action: PendingAction,
  card: Pick<ConfirmationCard, "title" | "summary" | "details" | "warnings">
): Promise<ConfirmationCard> {
  const db = await getDb();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PENDING_ACTION_TTL_MS);
  const res = await db.collection(HR_AI_COLLECTIONS.pendingActions).insertOne({
    companyId: companyObjectId(actor.companyId),
    userId: actor.userId,
    conversationId: actor.conversationId,
    toolName: action.toolName,
    payload: action.payload,
    summary: card.summary,
    status: "PENDING",
    expiresAt,
    createdAt: now,
  });
  await logAiEvent(actor, {
    eventType: "ACTION_CREATED",
    toolName: action.toolName,
    arguments: action.payload,
    resultStatus: "PENDING",
  });
  return { type: "confirmation_card", actionId: res.insertedId.toString(), ...card, expiresAt: expiresAt.toISOString() };
}

/** A request can be cancelled through the copilot if it is the caller's, still open, and not yet started. */
export function cancellationBlocker(
  request: Pick<LeaveRequest, "status" | "startDate"> | undefined,
  today = formatDateYMD(new Date())
): string | null {
  if (!request) return "Leave request not found among your requests.";
  if (request.status !== "pending" && request.status !== "approved") {
    return `This request is already ${request.status} and cannot be cancelled.`;
  }
  if (request.startDate <= today) return "This leave has already started and can no longer be cancelled here.";
  return null;
}

async function executeAction(action: PendingAction, actor: AiActor): Promise<{ message: string; resultRef: string }> {
  // Identity comes from the session at confirm time, and must still match what was drafted.
  if (!actor.employeeId || action.payload.employeeId !== actor.employeeId) {
    throw new Error("This action belongs to a different employee profile.");
  }

  if (action.toolName === "create_leave_draft") {
    // createLeaveRequest re-checks overlap and balance against current data.
    const created = await createLeaveRequest({ ...action.payload, isPaid: action.payload.leaveType !== "unpaid" }, actor.companyId);
    return {
      message: `Demande de congé submitted: ${created.days} day(s), ${created.startDate} to ${created.endDate}. Status: pending admin approval.`,
      resultRef: created.id,
    };
  }

  const requests = await getLeaveRequests({ employeeId: actor.employeeId }, actor.companyId);
  const blocker = cancellationBlocker(requests.find((r) => r.id === action.payload.requestId));
  if (blocker) throw new Error(blocker);
  const cancelled = await cancelLeaveRequest(action.payload.requestId, action.payload.reason, actor.actorName, actor.companyId);
  return {
    message: `Leave request for ${cancelled.startDate} to ${cancelled.endDate} is cancelled.`,
    resultRef: cancelled.id,
  };
}

/**
 * Confirms a pending action. Runs the stored payload, never client data and never the LLM.
 * The atomic PENDING → CONFIRMED claim means concurrent clicks execute it at most once.
 */
export async function confirmPendingAction(actionId: string, actor: AiActor): Promise<AiActionResult> {
  if (!ObjectId.isValid(actionId)) return { ok: false, error: "Action not found." };
  const db = await getDb();
  const collection = db.collection(HR_AI_COLLECTIONS.pendingActions);
  const owned = { _id: new ObjectId(actionId), companyId: companyObjectId(actor.companyId), userId: actor.userId };
  const now = new Date();

  const claimed = await collection.findOneAndUpdate(
    { ...owned, status: "PENDING", expiresAt: { $gt: now } },
    { $set: { status: "CONFIRMED", confirmedAt: now } }
  );

  if (!claimed) {
    const current = await collection.findOne(owned);
    if (!current) return { ok: false, error: "Action not found." };
    if (current.status === "CONFIRMED") {
      return {
        ok: true,
        alreadyConfirmed: true,
        message: "This action was already confirmed.",
        resultRef: current.resultRef as string | undefined,
      };
    }
    if (current.status === "PENDING") {
      await collection.updateOne({ ...owned, status: "PENDING" }, { $set: { status: "EXPIRED" } });
      await logAiEvent(actor, { eventType: "ACTION_CONFIRMED", toolName: current.toolName as string, resultStatus: "EXPIRED" });
      return { ok: false, error: "This confirmation expired. Please ask again to create a new one." };
    }
    if (current.status === "EXPIRED") return { ok: false, error: "This confirmation expired. Please ask again to create a new one." };
    if (current.status === "CANCELLED") return { ok: false, error: "This action was cancelled." };
    return { ok: false, error: (current.failureReason as string) || "This action failed. Please ask again." };
  }

  const action = { toolName: claimed.toolName, payload: claimed.payload } as PendingAction;
  try {
    const { message, resultRef } = await executeAction(action, actor);
    await collection.updateOne(owned, { $set: { resultRef } });
    await logAiEvent(actor, {
      eventType: "ACTION_CONFIRMED",
      toolName: action.toolName,
      arguments: action.payload,
      resultStatus: "CONFIRMED",
    });
    return { ok: true, message, resultRef };
  } catch (err) {
    const failureReason = err instanceof Error ? err.message : "The action could not be completed.";
    await collection.updateOne(owned, { $set: { status: "FAILED", failureReason } });
    await logAiEvent(actor, {
      eventType: "ACTION_CONFIRMED",
      toolName: action.toolName,
      arguments: action.payload,
      resultStatus: "FAILED",
    });
    return { ok: false, error: failureReason };
  }
}

export async function cancelPendingAction(actionId: string, actor: AiActor): Promise<AiActionResult> {
  if (!ObjectId.isValid(actionId)) return { ok: false, error: "Action not found." };
  const db = await getDb();
  const owned = { _id: new ObjectId(actionId), companyId: companyObjectId(actor.companyId), userId: actor.userId };
  const collection = db.collection(HR_AI_COLLECTIONS.pendingActions);
  const updated = await collection.findOneAndUpdate(
    { ...owned, status: "PENDING" },
    { $set: { status: "CANCELLED", cancelledAt: new Date() } }
  );
  if (!updated) {
    const current = await collection.findOne(owned);
    return current
      ? { ok: false, error: `This action is already ${String(current.status).toLowerCase()}.` }
      : { ok: false, error: "Action not found." };
  }
  await logAiEvent(actor, { eventType: "ACTION_CANCELLED", toolName: updated.toolName as string, resultStatus: "CANCELLED" });
  return { ok: true, message: "Cancelled. Nothing was changed." };
}
