import "server-only";
import { ObjectId, type Db } from "mongodb";
import { MARKETING_COLLECTIONS, type ContactDoc, type TelegramSubscriptionDoc } from "@/server/marketing/documents";
import { isStillEligible } from "@/server/marketing/eligibility";
import { getTelegramState } from "@/server/marketing/providers/telegram/config";
import { sendTelegramMessage } from "@/server/marketing/providers/telegram/client";
import { ProviderError } from "@/server/marketing/providers/types";
import { recordAudit } from "@/server/audit/audit.service";
import { AppError } from "@/shared/lib/errors";
import { TELEGRAM_MESSAGE_MAX, TELEGRAM_OPT_OUT_FOOTER } from "@/features/marketing/utils/template";
import { markTelegramUnreachable } from "@/server/marketing/telegram.service";

/**
 * Reusable one-to-one Telegram notification for other AnOps modules.
 *
 * - The destination is looked up from the stored subscription of (company, contact). Callers cannot pass a
 *   chat id, so nothing can be sent to an arbitrary chat or across tenants.
 * - `purpose: "transactional"` is for service messages the customer expects (order ready, invoice due). It
 *   needs an active chat link but no marketing consent, and never carries the marketing opt-out line.
 * - `purpose: "marketing"` runs the full campaign eligibility rules (consent, suppression, active contact)
 *   and appends the opt-out line.
 * - The outcome is audited without the message text.
 */
export type TelegramNotificationInput = {
  companyId: ObjectId;
  contactId: ObjectId;
  /** Plain text. It is sent without parse_mode, so it is never interpreted as markup. */
  message: string;
  purpose: "transactional" | "marketing";
  /** The user or system actor responsible for the notification, for the audit trail. */
  actorUserId: ObjectId;
  requestId: string;
};

export type TelegramNotificationResult = { providerMessageId: string };

export async function sendTelegramNotification(db: Db, input: TelegramNotificationInput): Promise<TelegramNotificationResult> {
  const state = getTelegramState();
  if (!state.configured) throw new AppError("PROVIDER_NOT_CONFIGURED", "The Telegram bot is not configured on this server.");

  const text = input.purpose === "marketing" ? `${input.message.trim()}\n\n${TELEGRAM_OPT_OUT_FOOTER}` : input.message.trim();
  if (text.trim() === "") throw new AppError("VALIDATION_ERROR", "The notification message is empty");
  if (text.length > TELEGRAM_MESSAGE_MAX) {
    throw new AppError("VALIDATION_ERROR", `Telegram messages are limited to ${TELEGRAM_MESSAGE_MAX} characters. Shorten the message; it is never truncated.`);
  }

  const scope = { companyId: input.companyId };
  const contact = await db.collection<ContactDoc>(MARKETING_COLLECTIONS.contacts).findOne({ _id: input.contactId, ...scope });
  if (!contact) throw new AppError("NOT_FOUND", "Contact not found");

  let chatId: string;
  if (input.purpose === "marketing") {
    const eligibility = await isStillEligible(db, input.companyId, "telegram", contact);
    if (!eligibility.eligible) throw new AppError("FORBIDDEN", "This contact has not agreed to Telegram marketing messages.");
    chatId = eligibility.destination;
  } else {
    const subscription = await db
      .collection<TelegramSubscriptionDoc>(MARKETING_COLLECTIONS.telegramSubscriptions)
      .findOne({ ...scope, contactId: input.contactId, status: "active" }, { projection: { chatId: 1 } });
    if (!subscription) throw new AppError("VALIDATION_ERROR", "This contact is not connected to Telegram.");
    chatId = subscription.chatId;
  }
  if (state.config.sendAllowlist && !state.config.sendAllowlist.includes(chatId)) {
    throw new AppError("FORBIDDEN", "This recipient is not on the controlled-recipient list.");
  }

  const audit = (action: string, extra: Record<string, string | number | boolean> = {}) =>
    recordAudit(db, {
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      action,
      entityType: "marketing_contact",
      entityId: input.contactId.toHexString(),
      requestId: input.requestId,
      metadata: { purpose: input.purpose, ...extra },
    });

  try {
    const { messageId } = await sendTelegramMessage(state.config.botToken, chatId, text, AbortSignal.timeout(15_000));
    await audit("marketing.telegram.notification_sent");
    return { providerMessageId: `${chatId}:${messageId}` };
  } catch (error) {
    const code = error instanceof ProviderError ? error.code : "TELEGRAM_ERROR";
    if (code === "TELEGRAM_BOT_BLOCKED" || code === "TELEGRAM_CHAT_NOT_FOUND") {
      await markTelegramUnreachable(db, input.companyId, input.contactId, code, input.requestId);
    }
    await audit("marketing.telegram.notification_failed", { errorCode: code });
    throw new AppError("INTERNAL", "Telegram did not accept the notification.");
  }
}
