import { z } from "zod";

const booleanString = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const envSchema = z.object({
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  AUTH_SECRET: z.string().min(1, "AUTH_SECRET is required"),
  /**
   * Public base URL used in every emailed link (verification, password reset, unsubscribe).
   * Falls back to NEXTAUTH_URL so existing deployments keep working.
   */
  APP_URL: z.string().url().optional(),
  NEXTAUTH_URL: z.string().url().optional(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  // Email / SMTP (optional; when unset, dev falls back to console logging)
  EMAIL_SERVER_HOST: z
    .string()
    .min(1)
    .refine(
      (value) => !value.includes("://"),
      "EMAIL_SERVER_HOST must be a hostname (e.g. smtp.gmail.com), not a URL"
    )
    .optional(),
  EMAIL_SERVER_PORT: z.coerce.number().int().positive().optional(),
  EMAIL_SERVER_SECURE: booleanString.optional(),
  EMAIL_SERVER_USER: z.string().optional(),
  EMAIL_SERVER_PASSWORD: z.string().optional(),
  EMAIL_FROM: z.string().min(1).optional(),
  EMAIL_LOGO_URL: z.string().url().optional(),

  // Marketing. All optional: a missing value makes only its integration unavailable, never the app.
  // Formats are validated where each integration is used (server/marketing/config.ts).
  FACEBOOK_APP_ID: z.string().min(1).optional(),
  FACEBOOK_APP_SECRET: z.string().min(1).optional(),
  SOCIAL_TOKEN_ENCRYPTION_KEY: z.string().min(1).optional(),
  MARKETING_WEBHOOK_SECRET: z.string().min(1).optional(),
  MARKETING_WORKER_SECRET: z.string().min(1).optional(),
  MARKETING_SEND_ALLOWLIST: z.string().max(2000).optional(),

  // Platform lifecycle and billing. All optional: a missing value disables only that feature.
  PLATFORM_CRON_SECRET: z.string().min(1).optional(),
  STRIPE_API_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
});
export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse({
    MONGODB_URI: process.env.MONGODB_URI,
    AUTH_SECRET: process.env.AUTH_SECRET,
    APP_URL: process.env.APP_URL,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    NODE_ENV: process.env.NODE_ENV,
    EMAIL_SERVER_HOST: process.env.EMAIL_SERVER_HOST,
    EMAIL_SERVER_PORT: process.env.EMAIL_SERVER_PORT,
    EMAIL_SERVER_SECURE: process.env.EMAIL_SERVER_SECURE,
    EMAIL_SERVER_USER: process.env.EMAIL_SERVER_USER,
    EMAIL_SERVER_PASSWORD: process.env.EMAIL_SERVER_PASSWORD,
    EMAIL_FROM: process.env.EMAIL_FROM,
    EMAIL_LOGO_URL: process.env.EMAIL_LOGO_URL,
    FACEBOOK_APP_ID: process.env.FACEBOOK_APP_ID,
    FACEBOOK_APP_SECRET: process.env.FACEBOOK_APP_SECRET,
    SOCIAL_TOKEN_ENCRYPTION_KEY: process.env.SOCIAL_TOKEN_ENCRYPTION_KEY,
    MARKETING_WEBHOOK_SECRET: process.env.MARKETING_WEBHOOK_SECRET,
    MARKETING_WORKER_SECRET: process.env.MARKETING_WORKER_SECRET,
    MARKETING_SEND_ALLOWLIST: process.env.MARKETING_SEND_ALLOWLIST,
    PLATFORM_CRON_SECRET: process.env.PLATFORM_CRON_SECRET,
    STRIPE_API_KEY: process.env.STRIPE_API_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  });

  if (!parsed.success) {
    console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment variables");
  }

  return parsed.data;
}

export const env = loadEnv();

/**
 * Resolves the base URL used in emailed links. A dedicated APP_URL wins, so a deployment can
 * expose a public address even when NextAuth is configured with an internal one. The value is
 * normalized to have no trailing slash, because callers append paths.
 */
export function resolveAppUrl(input: { appUrl?: string; nextAuthUrl?: string } = { appUrl: env.APP_URL, nextAuthUrl: env.NEXTAUTH_URL }): string {
  // Order: APP_URL, NEXTAUTH_URL, the host the platform assigns (Vercel), then local development.
  const platformHost = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  const chosen = input.appUrl?.trim() || input.nextAuthUrl?.trim() || (platformHost ? `https://${platformHost}` : "") || "http://localhost:3000";
  return chosen.replace(/\/+$/, "");
}

export function getAppUrl(): string {
  return resolveAppUrl({ appUrl: env.APP_URL, nextAuthUrl: env.NEXTAUTH_URL });
}

/**
 * True when a URL cannot be opened by an email recipient on the public internet: loopback,
 * link-local, RFC1918 private addresses, `.local` names, or an unparseable value.
 * Used to stop production campaigns from shipping a dead unsubscribe link.
 */
export function isLocalOnlyUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
    if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) return true;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
      const [a, b] = host.split(".").map(Number);
      if (a === 0 || a === 10 || a === 127) return true;
      if (a === 192 && b === 168) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 169 && b === 254) return true;
    }
    return false;
  } catch {
    return true;
  }
}

export function isEmailConfigured(): boolean {
  return Boolean(env.EMAIL_SERVER_HOST && env.EMAIL_FROM);
}

/**
 * Brevo and marketing-delivery settings. Validated lazily on first use, not at startup, so a malformed
 * value disables only the delivery integration and never stops sign-in or unrelated features.
 * Errors name variables and rules, never values.
 */
const brevoEnvSchema = z.object({
  BREVO_API_key: z.string().min(1).optional(),
  BREVO_SENDER_EMAIL: z.string().email().max(254).optional(),
  BREVO_SENDER_NAME: z.string().min(1).max(80).optional(),
  BREVO_SMS_SENDER: z.string().max(15).optional(),
  BREVO_WEBHOOK_TOKEN: z.string().min(1).optional(),
  BREVO_EMAIL_MARKETING_APPROVED: booleanString.optional(),
  MARKETING_SEND_ALLOWLIST: z.string().max(2000).optional(),
});

export type BrevoEnv = z.infer<typeof brevoEnvSchema>;

let brevoEnvCache: { value: BrevoEnv; issues: string[] } | null = null;

export function getBrevoEnv(): { value: BrevoEnv; issues: string[] } {
  if (brevoEnvCache) return brevoEnvCache;
  const parsed = brevoEnvSchema.safeParse({
    BREVO_API_key: process.env.BREVO_API_key,
    BREVO_SENDER_EMAIL: process.env.BREVO_SENDER_EMAIL,
    BREVO_SENDER_NAME: process.env.BREVO_SENDER_NAME,
    BREVO_SMS_SENDER: process.env.BREVO_SMS_SENDER,
    BREVO_WEBHOOK_TOKEN: process.env.BREVO_WEBHOOK_TOKEN,
    BREVO_EMAIL_MARKETING_APPROVED: process.env.BREVO_EMAIL_MARKETING_APPROVED,
    MARKETING_SEND_ALLOWLIST: process.env.MARKETING_SEND_ALLOWLIST,
    PLATFORM_CRON_SECRET: process.env.PLATFORM_CRON_SECRET,
    STRIPE_API_KEY: process.env.STRIPE_API_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  });
  brevoEnvCache = parsed.success
    ? { value: parsed.data, issues: [] }
    : {
        value: {},
        issues: parsed.error.issues.map((issue) => `${String(issue.path[0])}: ${issue.message}`),
      };
  return brevoEnvCache;
}

/**
 * Telegram bot settings. Validated lazily like the Brevo settings, so a malformed value disables only the
 * Telegram channel. Errors name variables and rules, never values. These are server-only: no NEXT_PUBLIC_ name.
 */
const telegramEnvSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().regex(/^\d{5,20}:[A-Za-z0-9_-]{30,80}$/, "must look like <bot id>:<secret>").optional(),
  TELEGRAM_BOT_USERNAME: z
    .string()
    .regex(/^@?[A-Za-z][A-Za-z0-9_]{4,31}$/, "must be a Telegram username such as AnOpsNotificationsBot")
    .optional(),
  TELEGRAM_WEBHOOK_SECRET: z
    .string()
    .regex(/^[A-Za-z0-9_-]{32,256}$/, "must be 32-256 characters of letters, digits, _ or -")
    .optional(),
});

export type TelegramEnv = z.infer<typeof telegramEnvSchema>;

let telegramEnvCache: { value: TelegramEnv; issues: string[] } | null = null;

export function getTelegramEnv(): { value: TelegramEnv; issues: string[] } {
  if (telegramEnvCache) return telegramEnvCache;
  const blank = (value: string | undefined) => (value && value.trim() !== "" ? value.trim() : undefined);
  const parsed = telegramEnvSchema.safeParse({
    TELEGRAM_BOT_TOKEN: blank(process.env.TELEGRAM_BOT_TOKEN),
    TELEGRAM_BOT_USERNAME: blank(process.env.TELEGRAM_BOT_USERNAME),
    TELEGRAM_WEBHOOK_SECRET: blank(process.env.TELEGRAM_WEBHOOK_SECRET),
  });
  telegramEnvCache = parsed.success
    ? { value: parsed.data, issues: [] }
    : { value: {}, issues: parsed.error.issues.map((issue) => `${String(issue.path[0])}: ${issue.message}`) };
  return telegramEnvCache;
}
