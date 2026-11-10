import "server-only";
import { ObjectId } from "mongodb";
import { loadLiveMember, type AiActorContext } from "@/server/ai/access/access.service";
import { aiAuditReader, aiScope, aiScopeForMember } from "@/server/ai/data/scope";
import { toMessageDto, type ConversationDto, type ConversationSummaryDto } from "@/server/ai/conversation.service";
import { recordAudit } from "@/server/audit/audit.service";
import { COLLECTIONS } from "@/server/db/documents";
import { withTransaction } from "@/server/db/transactions";
import { AppError } from "@/shared/lib/errors";

const DAY_MS = 86_400_000;
const NOTICE_RETENTION_DAYS = 365;
const MIN_REASON_CHARS = 8;

/**
 * Company-wide transcript auditing. Conversations are private to the person who had them; this is
 * the one deliberate exception, and it is narrow:
 *  - the caller needs the explicit audit switch on their own grant (an owner has to turn it on for
 *    themselves too), AND must be an owner or administrator;
 *  - an administrator cannot audit an owner's or another administrator's transcripts;
 *  - it is read-only, requires a written reason, writes an audit event, and notifies the person;
 *  - the audit trail and the notice are written BEFORE any content is returned, so a failed audit
 *    write means nothing is disclosed.
 */
async function requireAuditor(ctx: AiActorContext) {
  const member = await loadLiveMember(ctx.db, ctx.companyId, ctx.userId);
  if (!member || (member.companyRole !== "owner" && member.companyRole !== "admin")) {
    throw new AppError("FORBIDDEN", "You do not have permission to audit AI conversations.");
  }
  const grant = await aiScope(ctx).grants.findOne({ userId: ctx.userId });
  if (!grant?.canAuditTranscripts) {
    throw new AppError("FORBIDDEN", "You do not have permission to audit AI conversations.");
  }
  return member;
}

async function assertMayAudit(ctx: AiActorContext, auditorRole: string, targetUserId: ObjectId): Promise<void> {
  const target = await ctx.db
    .collection(COLLECTIONS.companyMembers)
    .findOne({ companyId: ctx.companyId, userId: targetUserId }, { projection: { role: 1 } });
  // Departed members have no membership row; their transcripts stay auditable until retention removes them.
  if (target && auditorRole !== "owner" && (target.role === "owner" || target.role === "admin")) {
    throw new AppError("FORBIDDEN", "Only an owner can audit an owner's or administrator's conversations.");
  }
  if (ctx.userId.equals(targetUserId)) {
    throw new AppError("VALIDATION_ERROR", "Open your own conversations from your history.");
  }
}

export async function auditListConversations(ctx: AiActorContext, targetUserIdRaw: string): Promise<ConversationSummaryDto[]> {
  const auditor = await requireAuditor(ctx);
  if (!ObjectId.isValid(targetUserIdRaw)) throw new AppError("NOT_FOUND", "Member not found.");
  const targetUserId = new ObjectId(targetUserIdRaw);
  await assertMayAudit(ctx, auditor.companyRole, targetUserId);

  await recordAudit(ctx.db, {
    companyId: ctx.companyId,
    actorUserId: ctx.userId,
    action: "ai.transcript.listed",
    entityType: "ai_conversation",
    entityId: targetUserId.toHexString(),
    requestId: ctx.requestId,
    metadata: { source: "ai", target: targetUserId.toHexString() },
  });
  const docs = await aiAuditReader(ctx, targetUserId)
    .conversations.find({}, { sort: { updatedAt: -1 }, limit: 50, projection: { title: 1, updatedAt: 1, messageCount: 1 } })
    .toArray();
  return docs.map((d) => ({ id: d._id.toHexString(), title: d.title, updatedAt: d.updatedAt.toISOString(), messageCount: d.messageCount ?? 0 }));
}

export async function auditReadConversation(
  ctx: AiActorContext,
  targetUserIdRaw: string,
  conversationIdRaw: string,
  reason: string
): Promise<ConversationDto> {
  const auditor = await requireAuditor(ctx);
  const cleanReason = reason.replace(/\s+/g, " ").trim();
  if (cleanReason.length < MIN_REASON_CHARS) {
    throw new AppError("VALIDATION_ERROR", "Write a short reason for opening this conversation.", { reason: "Required" });
  }
  if (!ObjectId.isValid(targetUserIdRaw) || !ObjectId.isValid(conversationIdRaw)) throw new AppError("NOT_FOUND", "Conversation not found.");
  const targetUserId = new ObjectId(targetUserIdRaw);
  const conversationId = new ObjectId(conversationIdRaw);
  await assertMayAudit(ctx, auditor.companyRole, targetUserId);

  const reader = aiAuditReader(ctx, targetUserId);
  const doc = await reader.conversations.findOne({ _id: conversationId });
  if (!doc) throw new AppError("NOT_FOUND", "Conversation not found.");

  await withTransaction(ctx.db, async (tx) => {
    const now = new Date();
    await aiScopeForMember(ctx, targetUserId).notices.insertOne(
      {
        _id: new ObjectId(),
        kind: "transcript_audited",
        byUserId: ctx.userId,
        conversationId,
        createdAt: now,
        readAt: null,
        expiresAt: new Date(now.getTime() + NOTICE_RETENTION_DAYS * DAY_MS),
      },
      { session: tx.session }
    );
    await recordAudit(
      ctx.db,
      {
        companyId: ctx.companyId,
        actorUserId: ctx.userId,
        action: "ai.transcript.accessed",
        entityType: "ai_conversation",
        entityId: conversationId.toHexString(),
        requestId: ctx.requestId,
        metadata: { source: "ai", target: targetUserId.toHexString(), reason: cleanReason.slice(0, 200) },
      },
      tx
    );
  });

  return {
    id: doc._id.toHexString(),
    title: doc.title,
    messages: doc.messages.map(toMessageDto),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export type AuditNoticeDto = { id: string; kind: "transcript_audited"; createdAt: string; read: boolean };

/** The affected person's view of the notices addressed to them. */
export async function listMyNotices(ctx: AiActorContext): Promise<AuditNoticeDto[]> {
  const docs = await aiScope(ctx).notices.find({}, { sort: { createdAt: -1 }, limit: 20 }).toArray();
  return docs.map((n) => ({ id: n._id.toHexString(), kind: n.kind, createdAt: n.createdAt.toISOString(), read: n.readAt !== null }));
}

export async function markNoticesRead(ctx: AiActorContext): Promise<void> {
  await aiScope(ctx).notices.updateMany({ readAt: null }, { $set: { readAt: new Date() } });
}
