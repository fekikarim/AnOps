import "server-only";
import { getBrevoEnv, getTelegramEnv } from "@/config/env";
import { getAppUrl, isLocalOnlyUrl } from "@/config/env";
import { parseAllowlist } from "@/server/marketing/providers/brevo/config";

/**
 * Telegram configuration, read from server-side variables only. Nothing here is returned to a client, logged,
 * or placed in an error message. The bot is central: one token serves every company.
 */
export type TelegramConfig = {
  botToken: string;
  /** Without the leading "@". Needed to build t.me deep links. */
  botUsername: string;
  webhookSecret: string;
  sendAllowlist: string[] | null;
};

export type TelegramState =
  | { configured: true; config: TelegramConfig }
  | { configured: false; missing: string[]; reason: string };

export function getTelegramState(): TelegramState {
  const { value, issues } = getTelegramEnv();
  if (issues.length > 0) {
    return { configured: false, missing: issues, reason: "One or more Telegram settings are invalid." };
  }
  const missing: string[] = [];
  if (!value.TELEGRAM_BOT_TOKEN) missing.push("TELEGRAM_BOT_TOKEN");
  if (!value.TELEGRAM_BOT_USERNAME) missing.push("TELEGRAM_BOT_USERNAME");
  if (!value.TELEGRAM_WEBHOOK_SECRET) missing.push("TELEGRAM_WEBHOOK_SECRET");
  if (missing.length > 0) {
    return { configured: false, missing, reason: "The Telegram bot is not configured." };
  }
  return {
    configured: true,
    config: {
      botToken: value.TELEGRAM_BOT_TOKEN as string,
      botUsername: (value.TELEGRAM_BOT_USERNAME as string).replace(/^@/, ""),
      webhookSecret: value.TELEGRAM_WEBHOOK_SECRET as string,
      sendAllowlist: parseAllowlist(getBrevoEnv().value.MARKETING_SEND_ALLOWLIST),
    },
  };
}

/** Deep link a customer opens to start the bot. The token is single-use and expires quickly. */
export function telegramDeepLink(botUsername: string, token: string): string {
  return `https://t.me/${botUsername}?start=${token}`;
}

/** Public HTTPS address Telegram posts updates to. Telegram only accepts HTTPS URLs. */
export function telegramWebhookUrl(): { url: string | null; reason: string | null } {
  const base = getAppUrl();
  if (isLocalOnlyUrl(base)) {
    return { url: null, reason: "APP_URL must be a public HTTPS address before Telegram can reach this server. Use polling locally." };
  }
  if (!base.startsWith("https://")) {
    return { url: null, reason: "Telegram only delivers webhooks to HTTPS addresses." };
  }
  return { url: `${base}/api/v1/marketing/webhooks/telegram`, reason: null };
}
