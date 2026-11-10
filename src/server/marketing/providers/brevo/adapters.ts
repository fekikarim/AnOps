import "server-only";
import { ProviderError, type MessageProvider, type OutboundMessage } from "@/server/marketing/providers/types";
import { sendBrevoEmail, sendBrevoSms } from "@/server/marketing/providers/brevo/client";
import { brevoWebhookUrl, type BrevoConfig } from "@/server/marketing/providers/brevo/config";

/** Pacing between sends. Brevo's limits depend on the plan, so this is conservative and tunable here. */
const MIN_INTERVAL_MS = 200;
const SMS_TAG = "anops-campaign";

/**
 * Controlled-recipient gate. When MARKETING_SEND_ALLOWLIST is set, any destination not on it is refused
 * before a request leaves the server. Use this for the first live test sends.
 */
function assertAllowed(allowlist: string[] | null, destination: string): void {
  if (allowlist && !allowlist.includes(destination.toLowerCase())) {
    throw new ProviderError("NOT_ALLOWLISTED", "This recipient is not on the controlled-recipient list.", false);
  }
}

/** Brevo SMS takes digits only, with the country code, and no leading plus. */
export function smsRecipient(destination: string): string {
  const digits = destination.replace(/^\+/, "");
  if (!/^\d{6,15}$/.test(digits)) {
    throw new ProviderError("INVALID_DESTINATION", "The phone number is not valid for SMS.", false);
  }
  return digits;
}

export function createBrevoSmsProvider(config: BrevoConfig): MessageProvider | null {
  // Without a webhook token, delivery events cannot be received, so SMS is not offered at all.
  if (!config.smsSender || !config.webhookToken) return null;
  const sender = config.smsSender;
  const webhookToken = config.webhookToken;
  return {
    name: "brevo-sms",
    channel: "sms",
    minIntervalMs: MIN_INTERVAL_MS,
    async send(message: OutboundMessage, options: { signal: AbortSignal }) {
      const recipient = smsRecipient(message.to);
      assertAllowed(config.sendAllowlist, `+${recipient}`);
      const providerMessageId = await sendBrevoSms(
        config.apiKey,
        { sender, recipient, content: message.text, webUrl: brevoWebhookUrl(webhookToken), tag: SMS_TAG },
        options.signal
      );
      return { providerMessageId };
    },
  };
}

export function createBrevoEmailProvider(config: BrevoConfig): MessageProvider | null {
  // Marketing mail through the transactional endpoint is not enabled until the operator confirms the policy.
  if (!config.emailSender || !config.emailMarketingApproved) return null;
  const sender = config.emailSender;
  return {
    name: "brevo-email",
    channel: "email",
    minIntervalMs: MIN_INTERVAL_MS,
    async send(message: OutboundMessage, options: { signal: AbortSignal }) {
      assertAllowed(config.sendAllowlist, message.to);
      const providerMessageId = await sendBrevoEmail(
        config.apiKey,
        {
          sender,
          to: [{ email: message.to }],
          subject: message.subject,
          htmlContent: message.html ?? undefined,
          textContent: message.text,
          tags: [SMS_TAG],
        },
        options.signal
      );
      return { providerMessageId };
    },
  };
}
