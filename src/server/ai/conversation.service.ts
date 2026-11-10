import "server-only";
import { randomUUID } from "crypto";
import { ObjectId } from "mongodb";
import { getAiSettings, type AiActorContext } from "@/server/ai/access/access.service";
import { aiScope } from "@/server/ai/data/scope";
import type { AiConversationDoc, AiMessageDoc, AiMessagePart } from "@/server/db/documents";
import { withTransaction } from "@/server/db/transactions";
import { AppError } from "@/shared/lib/errors";

export const MAX_MESSAGES_PER_CONVERSATION = 200;
export const MAX_TEXT_PART_CHARS = 8_000;
export const CONVERSATION_LIST_LIMIT = 50;
const DAY_MS = 86_400_000;

export type ConversationSummaryDto = { id: string; title: string; updatedAt: string; messageCount: number };
export type MessageDto = { id: string; role: "user" | "assistant"; parts: AiMessagePart[]; createdAt: string };
export type ConversationDto = { id: string; title: string; messages: MessageDto[]; updatedAt: string };

function titleFrom(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 60 ? `${clean.slice(0, 57)}...` : clean || "New conversation";
}

function clampPart(part: AiMessagePart): AiMessagePart {
  return part.type === "text" ? { ...part, text: part.text.slice(0, MAX_TEXT_PART_CHARS) } : part;
}

export function toMessageDto(message: AiMessageDoc): MessageDto {
  return { id: message.id, role: message.role, parts: message.parts, createdAt: message.createdAt.toISOString() };
}

function toDto(doc: AiConversationDoc): ConversationDto {
  return { id: doc._id.toHexString(), title: doc.title, messages: doc.messages.map(toMessageDto), updatedAt: doc.updatedAt.toISOString() };
}

async function expiryFor(ctx: AiActorContext, from: Date): Promise<Date> {
  const { retentionDays } = await getAiSettings(ctx);
  return new Date(from.getTime() + retentionDays * DAY_MS);
}

/** Conversations belong to one member of one company. Every query below runs through aiScope(ctx), which pins both. */
export async function createConversation(ctx: AiActorContext, firstUserText: string): Promise<ObjectId> {
  const now = new Date();
  const doc: AiConversationDoc = {
    _id: new ObjectId(),
    companyId: ctx.companyId,
    userId: ctx.userId,
    title: titleFrom(firstUserText),
    messages: [],
    messageCount: 0,
    createdAt: now,
    updatedAt: now,
    expiresAt: await expiryFor(ctx, now),
  };
  await aiScope(ctx).conversations.insertOne(doc);
  return doc._id;
}

export function newMessage(role: "user" | "assistant", parts: AiMessagePart[]): AiMessageDoc {
  return { id: randomUUID(), role, parts: parts.map(clampPart), createdAt: new Date() };
}

/** Appends messages only if the conversation is the caller's and has room. Returns false when it does not exist for them. */
export async function appendMessages(ctx: AiActorContext, conversationId: ObjectId, messages: AiMessageDoc[]): Promise<boolean> {
  const now = new Date();
  const result = await aiScope(ctx).conversations.updateOne(
    { _id: conversationId, [`messages.${MAX_MESSAGES_PER_CONVERSATION - messages.length}`]: { $exists: false } },
    { $push: { messages: { $each: messages } }, $inc: { messageCount: messages.length }, $set: { updatedAt: now, expiresAt: await expiryFor(ctx, now) } }
  );
  return result.matchedCount === 1;
}

export async function listConversations(ctx: AiActorContext): Promise<ConversationSummaryDto[]> {
  const docs = await aiScope(ctx)
    .conversations.find({}, { sort: { updatedAt: -1 }, limit: CONVERSATION_LIST_LIMIT, projection: { title: 1, updatedAt: 1, messageCount: 1 } })
    .toArray();
  return docs.map((d) => ({
    id: d._id.toHexString(),
    title: d.title,
    updatedAt: d.updatedAt.toISOString(),
    messageCount: d.messageCount ?? 0,
  }));
}

export async function getConversation(ctx: AiActorContext, idRaw: string): Promise<ConversationDto> {
  if (!ObjectId.isValid(idRaw)) throw new AppError("NOT_FOUND", "Conversation not found.");
  const doc = await aiScope(ctx).conversations.findOne({ _id: new ObjectId(idRaw) });
  if (!doc) throw new AppError("NOT_FOUND", "Conversation not found.");
  return toDto(doc);
}

export async function renameConversation(ctx: AiActorContext, idRaw: string, title: string): Promise<void> {
  const clean = title.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!clean) throw new AppError("VALIDATION_ERROR", "Give the conversation a name.", { title: "Required" });
  if (!ObjectId.isValid(idRaw)) throw new AppError("NOT_FOUND", "Conversation not found.");
  const result = await aiScope(ctx).conversations.updateOne({ _id: new ObjectId(idRaw) }, { $set: { title: clean } });
  if (result.matchedCount === 0) throw new AppError("NOT_FOUND", "Conversation not found.");
}

/**
 * Deletes the conversation AND ends its open proposals in one unit of work. A proposal belongs to the conversation that
 * produced it: once that is gone, nothing it proposed may still be confirmable.
 */
export async function deleteConversation(ctx: AiActorContext, idRaw: string): Promise<void> {
  if (!ObjectId.isValid(idRaw)) throw new AppError("NOT_FOUND", "Conversation not found.");
  const id = new ObjectId(idRaw);
  await withTransaction(ctx.db, async (tx) => {
    const scope = aiScope(ctx);
    const result = await scope.conversations.deleteOne({ _id: id }, { session: tx.session });
    if (result.deletedCount === 0) throw new AppError("NOT_FOUND", "Conversation not found.");
    await scope.pending.updateMany(
      { conversationId: id, status: "pending" },
      { $set: { status: "cancelled", statusReason: "conversation_deleted", resolvedAt: new Date() } },
      { session: tx.session }
    );
  });
}
