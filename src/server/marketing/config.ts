import "server-only";
import { createHmac } from "crypto";
import { env, getBrevoEnv } from "@/config/env";
import { parseAllowlist } from "@/server/marketing/providers/brevo/config";

/**
 * Marketing integration configuration. Every integration reports its own state. A missing or invalid
 * value marks that integration unavailable and never stops unrelated application features.
 * Error messages name variables but never print their values.
 */

export type IntegrationState =
  | { configured: true }
  | { configured: false; reason: string; missing: string[] };

export type SocialConfig = IntegrationState & {
  appId?: string;
  appSecret?: string;
  encryptionKey?: Buffer;
};

/** Meta Graph API version used for OAuth and publishing. Verify against Meta's current version before enabling. */
export const META_GRAPH_VERSION = "v21.0";

/** Facebook Page permissions only. Instagram publishing needs separate review and is not requested. */
export const META_PAGE_SCOPES = ["pages_show_list", "pages_manage_posts", "pages_read_engagement"] as const;

export function getSocialConfig(): SocialConfig {
  const missing: string[] = [];
  if (!env.FACEBOOK_APP_ID) missing.push("FACEBOOK_APP_ID");
  if (!env.FACEBOOK_APP_SECRET) missing.push("FACEBOOK_APP_SECRET");
  if (!env.SOCIAL_TOKEN_ENCRYPTION_KEY) missing.push("SOCIAL_TOKEN_ENCRYPTION_KEY");
  if (missing.length > 0) {
    return { configured: false, reason: "Social integration is not configured.", missing };
  }

  const encryptionKey = parseEncryptionKey(env.SOCIAL_TOKEN_ENCRYPTION_KEY as string);
  if (!encryptionKey) {
    return {
      configured: false,
      reason: "SOCIAL_TOKEN_ENCRYPTION_KEY must be 32 random bytes encoded as base64 or 64 hex characters.",
      missing: ["SOCIAL_TOKEN_ENCRYPTION_KEY (invalid format)"],
    };
  }

  return {
    configured: true,
    appId: env.FACEBOOK_APP_ID,
    appSecret: env.FACEBOOK_APP_SECRET,
    encryptionKey,
  };
}

/** Accepts exactly 32 bytes, as base64 (44 characters) or hex (64 characters). Anything else is rejected. */
export function parseEncryptionKey(raw: string): Buffer | null {
  const value = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, "hex");
  if (/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    const decoded = Buffer.from(value, "base64");
    return decoded.length === 32 ? decoded : null;
  }
  return null;
}

/** Webhook signing secret. Must be long enough to resist guessing. */
export function getWebhookSecret(): string | null {
  const secret = env.MARKETING_WEBHOOK_SECRET;
  return secret && secret.length >= 32 ? secret : null;
}

export function getWorkerSecret(): string | null {
  const secret = env.MARKETING_WORKER_SECRET;
  return secret && secret.length >= 32 ? secret : null;
}

/**
 * Key for unsubscribe tokens. Derived from AUTH_SECRET so no new secret is required, and separated from
 * other uses of that secret by a fixed label.
 */
export function unsubscribeSigningKey(): Buffer {
  return createHmac("sha256", env.AUTH_SECRET).update("anops.marketing.unsubscribe.v1").digest();
}

/**
 * The controlled-recipient list (MARKETING_SEND_ALLOWLIST), shared by every channel: email addresses, phone numbers
 * with their plus sign, and Telegram chat ids. Null means no list is set. Read when called, never cached.
 */
export function getSendAllowlist(): string[] | null {
  return parseAllowlist(getBrevoEnv().value.MARKETING_SEND_ALLOWLIST);
}

/** True only in a production deployment. Read when called. */
export function isProductionDeployment(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * The central send policy, applied to every channel and provider:
 *  - list set: only listed destinations may receive a message (a list that parses to nothing allows nobody);
 *  - list unset, production: every eligible destination may receive one (the normal live behaviour, intentional);
 *  - list unset, anywhere else: nobody, so a development or test run can never reach arbitrary real recipients.
 */
export function isAllowlistedDestination(channel: "email" | "sms" | "telegram", destination: string): boolean {
  const list = getSendAllowlist();
  if (!list) return isProductionDeployment();
  const value = destination.trim().toLowerCase();
  const key = channel === "sms" && !value.startsWith("+") ? `+${value}` : value;
  return list.includes(key);
}
