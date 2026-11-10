import "server-only";
import { createHash, randomBytes } from "crypto";
import { ObjectId, type Db } from "mongodb";
import { z } from "zod";
import {
  MARKETING_COLLECTIONS,
  type ContactDoc,
  type DeliveryDoc,
  type DeliveryEventDoc,
  type TelegramLinkTokenDoc,
  type TelegramSubscriptionDoc,
  type ConsentStateDoc,
} from "@/server/marketing/documents";
import type { TelegramSubscriptionStatus } from "@/features/marketing/types/constants";
import { recordAudit } from "@/server/audit/audit.service";
import type { WorkspaceContext } from "@/server/tenancy/workspace";
import { AppError } from "@/shared/lib/errors";
import { PERMISSIONS } from "@/server/security/permissions";
import { companyName, requireMarketing, scopeOf, toObjectId } from "@/server/marketing/common";
import { appendConsentEvent } from "@/server/marketing/consent.service";
import { suppress } from "@/server/marketing/delivery-events";
import { getTelegramState, telegramDeepLink } from "@/server/marketing/providers/telegram/config";
import { sendTelegramMessage } from "@/server/marketing/providers/telegram/client";
import { handleStaffMessage, isFinanceChat, type StaffOutcome } from "@/server/finance/telegram-receipts.service";

/**
 * Telegram subscriptions: how a customer's chat becomes a destination for exactly one contact of one company.
 *
 * Ownership is proven only by the webhook. An operator creates a single-use token for a contact; the customer
 * presses Start in the bot; Telegram sends `/start <token>`; the token resolves the company and contact. A chat
 * id never comes from a browser request and a company id never comes from a Telegram payload.
 *
 * Connecting is not consent. Marketing consent stays a separate, explicit record (see consent.service.ts).
 */
export const LINK_TOKEN_TTL_MS = 15 * 60_000;
const HISTORY_LIMIT = 30;

export type TelegramHistoryType = "connected" | "reconnected" | "disconnected" | "blocked" | "unblocked" | "stopped";
const HISTORY_LABELS: Record<TelegramHistoryType, string> = {
  connected: "Connected through the bot",
  reconnected: "Reconnected with a new chat",
  disconnected: "Disconnected by a team member",
  blocked: "Bot blocked or chat unreachable",
  unblocked: "Bot unblocked by the customer",
  stopped: "Customer sent /stop",
};

type SubscriptionWithHistory = TelegramSubscriptionDoc & { history?: { at: Date; type: TelegramHistoryType }[] };

export type TelegramConnectionDto = {
  status: TelegramSubscriptionStatus | "not_connected";
  username: string | null;
  /** Last four digits of the chat id. The full id is never sent to the browser. */
  chatHint: string | null;
  connectedAt: string | null;
  disconnectedAt: string | null;
  blockedAt: string | null;
  lastErrorCode: string | null;
  history: { type: TelegramHistoryType; label: string; at: string }[];
};

export type TelegramLinkDto = { url: string; expiresAt: string };

export const hashLinkToken = (token: string): string => createHash("sha256").update(token).digest("hex");
export const generateLinkToken = (): string => randomBytes(32).toString("base64url");
const LINK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function toConnectionDto(doc: SubscriptionWithHistory | null): TelegramConnectionDto {
  if (!doc) {
    return { status: "not_connected", username: null, chatHint: null, connectedAt: null, disconnectedAt: null, blockedAt: null, lastErrorCode: null, history: [] };
  }
  return {
    status: doc.status,
    username: doc.username,
    chatHint: `••••${doc.chatId.slice(-4)}`,
    connectedAt: doc.connectedAt.toISOString(),
    disconnectedAt: doc.disconnectedAt?.toISOString() ?? null,
    blockedAt: doc.blockedAt?.toISOString() ?? null,
    lastErrorCode: doc.lastErrorCode,
    history: [...(doc.history ?? [])]
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .map((item) => ({ type: item.type, label: HISTORY_LABELS[item.type], at: item.at.toISOString() })),
  };
}

function subscriptions(db: Db) {
  return db.collection<SubscriptionWithHistory>(MARKETING_COLLECTIONS.telegramSubscriptions);
}

function historyPush(type: TelegramHistoryType, at: Date) {
  return { history: { $each: [{ at, type }], $slice: -HISTORY_LIMIT } };
}

async function loadContact(db: Db, companyId: ObjectId, contactId: ObjectId): Promise<ContactDoc> {
  const contact = await db.collection<ContactDoc>(MARKETING_COLLECTIONS.contacts).findOne({ _id: contactId, companyId });
  if (!contact) throw new AppError("NOT_FOUND", "Contact not found");
  return contact;
}

export async function getTelegramConnection(ctx: WorkspaceContext, contactIdRaw: string): Promise<TelegramConnectionDto> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_READ);
  const contactId = toObjectId(contactIdRaw);
  await loadContact(ctx.db, ctx.companyId, contactId);
  return toConnectionDto(await subscriptions(ctx.db).findOne({ ...scopeOf(ctx), contactId }));
}

/**
 * Creates a fresh single-use deep link for one contact. Earlier unused links for the same contact are
 * revoked, so regenerating invalidates what was shared before.
 */
export async function createTelegramLink(ctx: WorkspaceContext, contactIdRaw: string): Promise<TelegramLinkDto> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_CONTACT_MANAGE);
  const state = getTelegramState();
  if (!state.configured) {
    throw new AppError("PROVIDER_NOT_CONFIGURED", "The Telegram bot is not configured on this server. Ask an administrator to finish the setup.");
  }
  const contactId = toObjectId(contactIdRaw);
  const contact = await loadContact(ctx.db, ctx.companyId, contactId);
  if (!contact.isActive || contact.lifecycleStage === "inactive") {
    throw new AppError("VALIDATION_ERROR", "Reactivate this contact before connecting Telegram");
  }

  const tokens = ctx.db.collection<TelegramLinkTokenDoc>(MARKETING_COLLECTIONS.telegramLinkTokens);
  await tokens.deleteMany({ companyId: ctx.companyId, contactId, consumedAt: null });
  const token = generateLinkToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LINK_TOKEN_TTL_MS);
  await tokens.insertOne({ _id: hashLinkToken(token), companyId: ctx.companyId, contactId, createdBy: ctx.userId, createdAt: now, expiresAt, consumedAt: null });
  await recordAudit(ctx.db, {
    companyId: ctx.companyId,
    actorUserId: ctx.userId,
    action: "marketing.telegram.link_created",
    entityType: "marketing_contact",
    entityId: contactIdRaw,
    requestId: ctx.requestId,
  });
  return { url: telegramDeepLink(state.config.botUsername, token), expiresAt: expiresAt.toISOString() };
}

/** Removes the chat link. Nothing is sent to the customer. Marketing consent is left as recorded. */
export async function disconnectTelegram(ctx: WorkspaceContext, contactIdRaw: string): Promise<void> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_CONTACT_MANAGE);
  const contactId = toObjectId(contactIdRaw);
  await loadContact(ctx.db, ctx.companyId, contactId);
  const now = new Date();
  const result = await subscriptions(ctx.db).updateOne(
    { ...scopeOf(ctx), contactId, status: { $in: ["active", "blocked"] } },
    { $set: { status: "disconnected", disconnectedAt: now, updatedAt: now }, $inc: { version: 1 }, $push: historyPush("disconnected", now) }
  );
  if (result.matchedCount === 0) throw new AppError("INVALID_TRANSITION", "This contact is not connected to Telegram.");
  await ctx.db
    .collection<TelegramLinkTokenDoc>(MARKETING_COLLECTIONS.telegramLinkTokens)
    .deleteMany({ companyId: ctx.companyId, contactId, consumedAt: null });
  await recordAudit(ctx.db, {
    companyId: ctx.companyId,
    actorUserId: ctx.userId,
    action: "marketing.telegram.disconnected",
    entityType: "marketing_contact",
    entityId: contactIdRaw,
    requestId: ctx.requestId,
  });
}

// ---------------------------------------------------------------------------------------------
// Webhook / polling updates
// ---------------------------------------------------------------------------------------------

/** Only the fields the integration reads. Everything else Telegram sends is ignored. */
export const telegramUpdateSchema = z
  .object({
    update_id: z.number().int().nonnegative(),
    message: z
      .object({
        text: z.string().max(4096).optional(),
        // Read only for staff receipt capture (Finance); customer chats never use them.
        caption: z.string().max(1024).optional(),
        photo: z
          .array(z.object({ file_id: z.string().max(256), file_unique_id: z.string().max(128), file_size: z.number().optional(), width: z.number().optional(), height: z.number().optional() }).passthrough())
          .max(10)
          .optional(),
        document: z
          .object({ file_id: z.string().max(256), file_unique_id: z.string().max(128), file_name: z.string().max(256).optional(), mime_type: z.string().max(128).optional(), file_size: z.number().optional() })
          .passthrough()
          .optional(),
        chat: z.object({ id: z.number().int(), type: z.string() }).passthrough(),
        from: z.object({ id: z.number().int(), is_bot: z.boolean().optional(), username: z.string().max(64).optional() }).passthrough().optional(),
      })
      .passthrough()
      .optional(),
    my_chat_member: z
      .object({
        chat: z.object({ id: z.number().int(), type: z.string() }).passthrough(),
        new_chat_member: z.object({ status: z.string() }).passthrough(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;
export type TelegramUpdateOutcome = "duplicate" | "connected" | "link_invalid" | "link_conflict" | "stopped" | "welcome" | "chat_blocked" | "chat_unblocked" | "ignored" | StaffOutcome;

const REPLIES = {
  welcome:
    "Welcome to AnOps Notifications. To connect your account, open the personal link your business gave you and press Start. Send /stop at any time to stop marketing messages.",
  invalid: "This connection link is invalid, has expired or was already used. Ask the business for a new link.",
  conflict: "This Telegram account is already connected to another contact at this business. Ask the business to review it.",
  stopped: "You will not receive marketing messages any more. Send a new connection link from the business if you change your mind.",
  stopNothing: "There is nothing to stop: no business has connected this chat yet.",
} as const;

async function reply(token: string, chatId: number, text: string): Promise<void> {
  try {
    await sendTelegramMessage(token, String(chatId), text, AbortSignal.timeout(8_000));
  } catch {
    // A failed courtesy reply must never fail or repeat the update.
  }
}

/**
 * Processes one update exactly once. The update id is claimed first, so a retry from Telegram is a no-op. If
 * handling throws, the claim is released so Telegram's retry is processed.
 */
export async function processTelegramUpdate(db: Db, raw: unknown, requestId: string): Promise<TelegramUpdateOutcome> {
  const state = getTelegramState();
  const parsed = telegramUpdateSchema.safeParse(raw);
  if (!state.configured || !parsed.success) return "ignored";
  const update = parsed.data;
  const updates = db.collection<{ _id: number; receivedAt: Date }>(MARKETING_COLLECTIONS.telegramUpdates);
  try {
    await updates.insertOne({ _id: update.update_id, receivedAt: new Date() });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return "duplicate";
    throw error;
  }
  try {
    return await handleUpdate(db, update, state.config.botToken, requestId);
  } catch (error) {
    await updates.deleteOne({ _id: update.update_id });
    throw error;
  }
}

async function handleUpdate(db: Db, update: TelegramUpdate, botToken: string, requestId: string): Promise<TelegramUpdateOutcome> {
  if (update.my_chat_member) {
    const chat = update.my_chat_member.chat;
    if (chat.type !== "private") return "ignored";
    const status = update.my_chat_member.new_chat_member.status;
    if (status === "kicked" || status === "left") {
      await markChatReachable(db, String(chat.id), false, requestId);
      return "chat_blocked";
    }
    if (status === "member") {
      await markChatReachable(db, String(chat.id), true, requestId);
      return "chat_unblocked";
    }
    return "ignored";
  }

  const message = update.message;
  if (!message || message.chat.type !== "private" || message.from?.is_bot) return "ignored";
  // Staff receipt capture: a Finance link token, or any message from a chat linked to a staff member.
  // /stop stays with Marketing so a person who is also a customer can always stop marketing messages.
  const isStop = /^\/stop(?:@\w+)?\s*$/i.test(message.text?.trim() ?? "");
  if (!isStop && (await isFinanceChat(db, message.chat.id, message.text))) {
    return handleStaffMessage(
      db,
      { chatId: message.chat.id, username: message.from?.username ?? null, text: message.text, caption: message.caption, photo: message.photo, document: message.document },
      requestId
    );
  }
  if (!message.text) return "ignored";
  const chatId = message.chat.id;
  const text = message.text.trim();
  const command = /^\/(start|stop)(?:@\w+)?(?:\s+(\S+))?\s*$/i.exec(text);
  if (!command) return "ignored";

  if (command[1].toLowerCase() === "stop") {
    const stopped = await stopMarketing(db, String(chatId), requestId);
    await reply(botToken, chatId, stopped > 0 ? REPLIES.stopped : REPLIES.stopNothing);
    return "stopped";
  }

  const payload = command[2];
  if (!payload) {
    await reply(botToken, chatId, REPLIES.welcome);
    return "welcome";
  }
  const outcome = await connectWithToken(db, payload, String(chatId), message.from?.username ?? null, requestId);
  if (outcome.kind === "connected") {
    await reply(
      botToken,
      chatId,
      `You are connected to ${outcome.company || "the business"} on AnOps Notifications. Marketing messages are only sent if you agreed to receive them. Send /stop at any time to stop them.`
    );
    return "connected";
  }
  await reply(botToken, chatId, outcome.kind === "conflict" ? REPLIES.conflict : REPLIES.invalid);
  return outcome.kind === "conflict" ? "link_conflict" : "link_invalid";
}

type ConnectOutcome = { kind: "connected"; company: string } | { kind: "invalid" } | { kind: "conflict" };

/**
 * Consumes a link token atomically and attaches the chat to the contact it was issued for. A second use of
 * the same token, an expired token and an unknown token are indistinguishable to the caller.
 */
export async function connectWithToken(db: Db, token: string, chatId: string, username: string | null, requestId: string): Promise<ConnectOutcome> {
  if (!LINK_TOKEN_PATTERN.test(token)) return { kind: "invalid" };
  const now = new Date();
  const consumed = await db
    .collection<TelegramLinkTokenDoc>(MARKETING_COLLECTIONS.telegramLinkTokens)
    .findOneAndUpdate({ _id: hashLinkToken(token), consumedAt: null, expiresAt: { $gt: now } }, { $set: { consumedAt: now } }, { returnDocument: "after" });
  if (!consumed) return { kind: "invalid" };

  const { companyId, contactId } = consumed;
  const contact = await db.collection<ContactDoc>(MARKETING_COLLECTIONS.contacts).findOne({ _id: contactId, companyId });
  if (!contact || !contact.isActive || contact.lifecycleStage === "inactive") return { kind: "invalid" };

  const other = await subscriptions(db).findOne({ companyId, chatId, contactId: { $ne: contactId } }, { projection: { _id: 1 } });
  if (other) return { kind: "conflict" };

  const existing = await subscriptions(db).findOne({ companyId, contactId });
  const type: TelegramHistoryType = existing && existing.chatId !== chatId ? "reconnected" : "connected";
  try {
    await subscriptions(db).updateOne(
      { companyId, contactId },
      {
        $set: { chatId, username: username ? username.slice(0, 64) : null, status: "active", connectedAt: now, disconnectedAt: null, blockedAt: null, lastErrorCode: null, updatedAt: now },
        $setOnInsert: { _id: new ObjectId(), companyId, contactId, createdAt: now },
        $inc: { version: 1 },
        $push: historyPush(type, now),
      },
      { upsert: true }
    );
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return { kind: "conflict" };
    throw error;
  }
  await recordAudit(db, {
    companyId,
    actorUserId: consumed.createdBy,
    action: "marketing.telegram.connected",
    entityType: "marketing_contact",
    entityId: contactId.toHexString(),
    requestId,
    metadata: { reconnected: type === "reconnected" },
  });
  return { kind: "connected", company: await companyName(db, companyId) };
}

/**
 * /stop from a chat withdraws Telegram marketing consent for every contact linked to that chat. The bot is
 * shared across companies and the customer cannot name one, so the safe reading is "stop all marketing".
 * The destination is also suppressed so no later campaign can reach it until consent is granted again.
 */
export async function stopMarketing(db: Db, chatId: string, requestId: string): Promise<number> {
  const rows = await subscriptions(db).find({ chatId, status: { $in: ["active", "blocked"] } }).toArray();
  const now = new Date();
  for (const row of rows) {
    const { companyId, contactId } = row;
    const state = await db
      .collection<ConsentStateDoc>(MARKETING_COLLECTIONS.consentStates)
      .findOne({ companyId, contactId, channel: "telegram", purpose: "marketing" }, { projection: { status: 1 } });
    if (state?.status !== "withdrawn") {
      await appendConsentEvent(db, { companyId, contactId, channel: "telegram", status: "withdrawn", source: "telegram_stop", occurredAt: now, recordedBy: null, requestId });
    }
    await suppress(db, { companyId, channel: "telegram", destination: chatId, contactId }, "unsubscribed", now);
    await subscriptions(db).updateOne({ _id: row._id }, { $set: { updatedAt: now }, $push: historyPush("stopped", now) });
    await attributeUnsubscribe(db, companyId, contactId, now);
    const contact = await db.collection<ContactDoc>(MARKETING_COLLECTIONS.contacts).findOne({ _id: contactId, companyId }, { projection: { updatedBy: 1 } });
    if (contact) {
      await recordAudit(db, {
        companyId,
        actorUserId: contact.updatedBy,
        action: "marketing.telegram.stopped",
        entityType: "marketing_contact",
        entityId: contactId.toHexString(),
        requestId,
        metadata: { via: "telegram_stop_command" },
      });
    }
  }
  return rows.length;
}

/** Attributes the opt-out to the most recent Telegram campaign delivery, so the report counts it once. */
async function attributeUnsubscribe(db: Db, companyId: ObjectId, contactId: ObjectId, now: Date): Promise<void> {
  const delivery = await db
    .collection<DeliveryDoc>(MARKETING_COLLECTIONS.deliveries)
    .find({ companyId, contactId, channel: "telegram", sentAt: { $ne: null } }, { projection: { _id: 1, campaignId: 1 } })
    .sort({ sentAt: -1 })
    .limit(1)
    .next();
  if (!delivery) return;
  try {
    await db.collection<DeliveryEventDoc>(MARKETING_COLLECTIONS.deliveryEvents).insertOne({
      _id: new ObjectId(),
      companyId,
      campaignId: delivery.campaignId,
      deliveryId: delivery._id,
      type: "unsubscribed",
      providerName: "telegram-bot",
      providerEventId: `unsubscribe:${contactId.toHexString()}:telegram:${delivery.campaignId.toHexString()}`,
      occurredAt: now,
      receivedAt: now,
    });
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
  }
}

/** The customer blocked or unblocked the bot. A blocked chat is unreachable, so it stops being a destination. */
async function markChatReachable(db: Db, chatId: string, reachable: boolean, requestId: string): Promise<void> {
  const now = new Date();
  const filter = reachable ? { chatId, status: "blocked" as const } : { chatId, status: "active" as const };
  const rows = await subscriptions(db).find(filter, { projection: { _id: 1, companyId: 1, contactId: 1 } }).toArray();
  for (const row of rows) {
    await subscriptions(db).updateOne(
      { _id: row._id, status: filter.status },
      reachable
        ? { $set: { status: "active", blockedAt: null, lastErrorCode: null, updatedAt: now }, $inc: { version: 1 }, $push: historyPush("unblocked", now) }
        : { $set: { status: "blocked", blockedAt: now, lastErrorCode: "TELEGRAM_BOT_BLOCKED", updatedAt: now }, $inc: { version: 1 }, $push: historyPush("blocked", now) }
    );
    await auditSystem(db, row.companyId, row.contactId, reachable ? "marketing.telegram.unblocked" : "marketing.telegram.blocked", requestId);
  }
}

/** Called by dispatch when Telegram says the chat cannot be reached. Later campaigns skip it. */
export async function markTelegramUnreachable(db: Db, companyId: ObjectId, contactId: ObjectId, code: string, requestId: string): Promise<void> {
  const now = new Date();
  const result = await subscriptions(db).updateOne(
    { companyId, contactId, status: "active" },
    { $set: { status: "blocked", blockedAt: now, lastErrorCode: code, updatedAt: now }, $inc: { version: 1 }, $push: historyPush("blocked", now) }
  );
  if (result.modifiedCount > 0) await auditSystem(db, companyId, contactId, "marketing.telegram.blocked", requestId);
}

async function auditSystem(db: Db, companyId: ObjectId, contactId: ObjectId, action: string, requestId: string): Promise<void> {
  const contact = await db.collection<ContactDoc>(MARKETING_COLLECTIONS.contacts).findOne({ _id: contactId, companyId }, { projection: { updatedBy: 1 } });
  if (!contact) return;
  await recordAudit(db, { companyId, actorUserId: contact.updatedBy, action, entityType: "marketing_contact", entityId: contactId.toHexString(), requestId, metadata: { via: "telegram" } });
}
