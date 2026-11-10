import "server-only";
import { ProviderError, type MessageProvider, type OutboundMessage } from "@/server/marketing/providers/types";
import { getMe, sendTelegramMessage, type TelegramBotInfo } from "@/server/marketing/providers/telegram/client";
import { getTelegramState, type TelegramConfig } from "@/server/marketing/providers/telegram/config";

/**
 * Telegram allows about 30 messages per second for broadcasts and one per second to the same chat. Sends are
 * sequential, so 50 ms keeps the worker near 20 per second, below the documented limit.
 */
const MIN_INTERVAL_MS = 50;

/** Telegram private-chat ids are positive integers. Anything else is refused before a request is made. */
export function isValidChatId(value: string): boolean {
  return /^\d{1,20}$/.test(value);
}

export function createTelegramProvider(config: TelegramConfig): MessageProvider {
  return {
    name: "telegram-bot",
    channel: "telegram",
    minIntervalMs: MIN_INTERVAL_MS,
    async send(message: OutboundMessage, options: { signal: AbortSignal }) {
      if (!isValidChatId(message.to)) {
        throw new ProviderError("INVALID_DESTINATION", "The Telegram chat is not valid.", false);
      }
      if (config.sendAllowlist && !config.sendAllowlist.includes(message.to)) {
        throw new ProviderError("NOT_ALLOWLISTED", "This recipient is not on the controlled-recipient list.", false);
      }
      const { messageId } = await sendTelegramMessage(config.botToken, message.to, message.text, options.signal);
      // Message ids are only unique per chat, and the delivery table requires a globally unique id.
      return { providerMessageId: `${message.to}:${messageId}` };
    },
  };
}

export type TelegramConnectionTest =
  | { ok: true; bot: TelegramBotInfo; usernameMatches: boolean }
  | { ok: false; errorCode: string };

/** Calls getMe. Verifies the token and that it belongs to the configured bot. Sends nothing to any chat. */
export async function verifyTelegramBot(): Promise<TelegramConnectionTest> {
  const state = getTelegramState();
  if (!state.configured) return { ok: false, errorCode: "PROVIDER_NOT_CONFIGURED" };
  try {
    const bot = await getMe(state.config.botToken);
    const usernameMatches = (bot.username ?? "").toLowerCase() === state.config.botUsername.toLowerCase();
    return usernameMatches ? { ok: true, bot, usernameMatches } : { ok: false, errorCode: "USERNAME_MISMATCH" };
  } catch (error) {
    return { ok: false, errorCode: error instanceof ProviderError ? error.code : "TELEGRAM_ERROR" };
  }
}
