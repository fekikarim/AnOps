import "server-only";
import { getBrevoEnv } from "@/config/env";
import { getAppUrl } from "@/config/env";

/**
 * Brevo configuration, read from server-side variables only. Nothing here is returned to a client or logged.
 * An integration is "configured" only when every value it needs is present and valid. Otherwise the
 * `missing` list names the variables, and dispatch is refused before any campaign is scheduled.
 */
export type BrevoConfig = {
  apiKey: string;
  emailSender: { email: string; name: string } | null;
  smsSender: string | null;
  webhookToken: string | null;
  emailMarketingApproved: boolean;
  sendAllowlist: string[] | null;
};

export type BrevoState =
  | { configured: true; config: BrevoConfig }
  | { configured: false; missing: string[]; reason: string };

export function getBrevoState(): BrevoState {
  const { value, issues } = getBrevoEnv();
  if (!value.BREVO_API_key) {
    return { configured: false, missing: ["BREVO_API_key"], reason: "The Brevo API key is not set." };
  }
  if (issues.length > 0) {
    return { configured: false, missing: issues, reason: "One or more Brevo settings are invalid." };
  }
  return {
    configured: true,
    config: {
      apiKey: value.BREVO_API_key,
      emailSender:
        value.BREVO_SENDER_EMAIL && value.BREVO_SENDER_NAME
          ? { email: value.BREVO_SENDER_EMAIL, name: value.BREVO_SENDER_NAME }
          : null,
      smsSender: value.BREVO_SMS_SENDER ? validSmsSender(value.BREVO_SMS_SENDER) : null,
      webhookToken: value.BREVO_WEBHOOK_TOKEN && value.BREVO_WEBHOOK_TOKEN.length >= 32 ? value.BREVO_WEBHOOK_TOKEN : null,
      emailMarketingApproved: value.BREVO_EMAIL_MARKETING_APPROVED === true,
      sendAllowlist: parseAllowlist(value.MARKETING_SEND_ALLOWLIST),
    },
  };
}

/**
 * Brevo SMS sender rules: up to 11 letters and digits (alphanumeric), or up to 15 digits (numeric).
 * Returns null for anything else, which leaves SMS unconfigured instead of sending with a bad sender.
 */
export function validSmsSender(value: string): string | null {
  if (/^\d{1,15}$/.test(value)) return value;
  if (/^[A-Za-z0-9]{1,11}$/.test(value)) return value;
  return null;
}

/** Comma-separated controlled recipients. When set, providers refuse every other destination. */
export function parseAllowlist(raw: string | undefined): string[] | null {
  if (!raw || raw.trim() === "") return null;
  return raw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);
}

/** Public URL Brevo calls for events. The token is part of the path because Brevo does not sign webhooks. */
export function brevoWebhookUrl(token: string): string {
  return `${getAppUrl()}/api/v1/marketing/webhooks/brevo/${token}`;
}
