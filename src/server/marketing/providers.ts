import "server-only";
import type { MarketingChannel } from "@/features/marketing/types/constants";
import { getBrevoState, type BrevoState } from "@/server/marketing/providers/brevo/config";
import { createBrevoEmailProvider, createBrevoSmsProvider } from "@/server/marketing/providers/brevo/adapters";
import { createSmtpEmailProvider, verifySmtpEmailProvider } from "@/server/marketing/providers/smtp/adapters";
import { getSmtpState, type SmtpState } from "@/server/marketing/providers/smtp/config";
import { createTelegramProvider } from "@/server/marketing/providers/telegram/adapters";
import { getTelegramState, type TelegramState } from "@/server/marketing/providers/telegram/config";
import type { MessageProviders } from "@/server/marketing/providers/types";

export { ProviderError } from "@/server/marketing/providers/types";
export type { MessageProvider, MessageProviders, OutboundMessage } from "@/server/marketing/providers/types";

/**
 * Builds the provider registry from already-resolved configuration states.
 * SMTP (the existing Gmail/SMTP account) is preferred for email; Brevo email is
 * only a fallback when SMTP is not configured. SMS remains Brevo-only. Telegram uses the Bot API and is
 * independent of both.
 */
export function selectConfiguredProviders(smtp: SmtpState, brevo: BrevoState, telegram?: TelegramState): MessageProviders {
  const providers: MessageProviders = {};

  if (telegram?.configured) providers.telegram = createTelegramProvider(telegram.config);

  if (brevo.configured) {
    const sms = createBrevoSmsProvider(brevo.config);
    if (sms) providers.sms = sms;
  }

  if (smtp.configured) {
    providers.email = createSmtpEmailProvider(smtp.config);
  } else if (brevo.configured) {
    const email = createBrevoEmailProvider(brevo.config);
    if (email) providers.email = email;
  }

  return providers;
}

/**
 * Registered delivery providers. A channel is returned only when its adapter has
 * every setting it needs. Anything missing returns no adapter, so scheduling is
 * refused and nothing is ever reported as sent.
 */
export function getConfiguredProviders(): MessageProviders {
  return selectConfiguredProviders(getSmtpState(), getBrevoState(), getTelegramState());
}

export type EmailProviderTest = { ok: boolean; errorCode: string | null; providerName: string | null };

/**
 * Tests the active email provider without sending a message. Only SMTP exposes a
 * connection/authentication check; API providers report NOT_TESTABLE.
 */
export async function testEmailProvider(): Promise<EmailProviderTest> {
  const provider = getConfiguredProviders().email;
  if (!provider) return { ok: false, errorCode: "PROVIDER_NOT_CONFIGURED", providerName: null };
  if (provider.name !== "smtp-email") return { ok: false, errorCode: "NOT_TESTABLE", providerName: provider.name };
  const result = await verifySmtpEmailProvider();
  return result.ok
    ? { ok: true, errorCode: null, providerName: provider.name }
    : { ok: false, errorCode: result.errorCode, providerName: provider.name };
}

export type ConfiguredChannel = MarketingChannel;
