import "server-only";
import { ProviderError } from "@/server/marketing/providers/types";
import { deleteWebhook, getWebhookInfo, setWebhook } from "@/server/marketing/providers/telegram/client";
import { getTelegramState, telegramWebhookUrl } from "@/server/marketing/providers/telegram/config";
import { verifyTelegramBot } from "@/server/marketing/providers/telegram/adapters";
import { AppError } from "@/shared/lib/errors";

export type TelegramBotTestResult = {
  ok: boolean;
  errorCode: string | null;
  botName: string | null;
  botUsername: string | null;
};

/** Calls getMe. No message is sent to any chat, so testing cannot reach a customer. */
export async function testTelegramBot(): Promise<TelegramBotTestResult> {
  const result = await verifyTelegramBot();
  return result.ok
    ? { ok: true, errorCode: null, botName: result.bot.name, botUsername: result.bot.username }
    : { ok: false, errorCode: result.errorCode, botName: null, botUsername: null };
}

export type TelegramWebhookResult = { ok: boolean; errorCode: string | null; registeredUrl: string | null; pendingUpdates: number };

/**
 * Registers `${APP_URL}/api/v1/marketing/webhooks/telegram` with Telegram and the secret token, then reads it
 * back so "registered" means Telegram reports exactly this address, not merely that the call returned ok.
 */
export async function configureTelegramWebhook(): Promise<TelegramWebhookResult> {
  const state = getTelegramState();
  if (!state.configured) throw new AppError("PROVIDER_NOT_CONFIGURED", "The Telegram bot is not configured on this server.");
  const target = telegramWebhookUrl();
  if (!target.url) throw new AppError("VALIDATION_ERROR", target.reason ?? "The webhook address is not valid.");
  try {
    await setWebhook(state.config.botToken, target.url, state.config.webhookSecret);
    const info = await getWebhookInfo(state.config.botToken);
    const matches = info.url === target.url;
    return { ok: matches, errorCode: matches ? null : "WEBHOOK_URL_MISMATCH", registeredUrl: info.url || null, pendingUpdates: info.pendingUpdates };
  } catch (error) {
    return { ok: false, errorCode: error instanceof ProviderError ? error.code : "TELEGRAM_ERROR", registeredUrl: null, pendingUpdates: 0 };
  }
}

/** Reads what Telegram currently has registered. Used by the local poller to refuse to run beside a webhook. */
export async function currentWebhookUrl(): Promise<string | null> {
  const state = getTelegramState();
  if (!state.configured) return null;
  const info = await getWebhookInfo(state.config.botToken);
  return info.url || null;
}

export async function removeTelegramWebhook(): Promise<void> {
  const state = getTelegramState();
  if (state.configured) await deleteWebhook(state.config.botToken);
}
