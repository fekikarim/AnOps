import type { Metadata } from "next";
import { getPageWorkspace } from "@/server/tenancy/workspace";
import { PageHeader } from "@/shared/components/data-display/page-header";
import { StatusBadge, type BadgeTone } from "@/shared/components/data-display/status-badge";
import { getConfiguredProviders } from "@/server/marketing/providers";
import { getBrevoState } from "@/server/marketing/providers/brevo/config";
import { getSmtpState } from "@/server/marketing/providers/smtp/config";
import { getSocialConfig, getWebhookSecret, getWorkerSecret } from "@/server/marketing/config";
import { env, getAppUrl, isLocalOnlyUrl } from "@/config/env";
import {
  classifyIntegration,
  EMAIL_INTEGRATION_CHECK_ID,
  TELEGRAM_INTEGRATION_CHECK_ID,
  TELEGRAM_WEBHOOK_CHECK_ID,
  loadIntegrationCheck,
  type IntegrationCapabilityState,
} from "@/server/marketing/integration-status";
import { EmailIntegrationTestButton } from "@/features/marketing/components/integration-test-button";
import { TelegramIntegrationActions } from "@/features/marketing/components/telegram-integration-actions";
import { getTelegramState, telegramWebhookUrl } from "@/server/marketing/providers/telegram/config";
import { formatDateTime } from "@/shared/lib/format";
import { ai } from "@/server/ai";
import { PERMISSIONS } from "@/server/security/permissions";
import { PermissionDenied } from "@/shared/components/data-display/permission-denied";

export const metadata: Metadata = { title: "Integrations | AnOps ERP" };

type Row = {
  name: string;
  state: IntegrationCapabilityState;
  detail: string;
  setup?: string[] | null;
  action?: "test-email";
  telegram?: { facts: { label: string; value: string }[]; canTest: boolean; canRegisterWebhook: boolean };
};

/**
 * Shows which integrations are configured, which have actually been tested, and
 * which are unavailable. Only booleans and variable NAMES are shown. No value,
 * length or hint of a secret ever reaches the page.
 */
export default async function IntegrationsPage() {
  const ctx = await getPageWorkspace();
  if (!ctx.permissions.has(PERMISSIONS.MARKETING_READ)) {
    return <PermissionDenied backHref="/marketing" backLabel="Back to marketing" />;
  }

  const providers = getConfiguredProviders();
  const smtp = getSmtpState();
  const brevo = getBrevoState();
  const social = getSocialConfig();
  const aiProviders = ai.status();
  const aiAvailable = aiProviders.filter((provider) => provider.available).map((provider) => provider.name);

  const smtpIsActiveEmail = providers.email?.name === "smtp-email";
  const emailCheck = smtpIsActiveEmail ? await loadIntegrationCheck(ctx.db, EMAIL_INTEGRATION_CHECK_ID) : null;
  const emailStatus = classifyIntegration({
    configured: Boolean(providers.email),
    providerName: providers.email?.name ?? null,
    missing: smtp.configured ? undefined : smtp.missing,
    reason: smtp.configured ? undefined : smtp.reason,
    check: emailCheck,
  });

  const smsStatus = classifyIntegration({
    configured: Boolean(providers.sms),
    providerName: providers.sms?.name ?? null,
    missing: brevo.configured ? undefined : brevo.missing,
    reason: "SMS delivery is not configured. SMS campaigns cannot be scheduled.",
    check: null,
  });

  const telegramState = getTelegramState();
  const [telegramCheck, webhookCheck] = telegramState.configured
    ? await Promise.all([loadIntegrationCheck(ctx.db, TELEGRAM_INTEGRATION_CHECK_ID), loadIntegrationCheck(ctx.db, TELEGRAM_WEBHOOK_CHECK_ID)])
    : [null, null];
  const telegramStatus = classifyIntegration({
    configured: telegramState.configured,
    providerName: "the Telegram Bot API",
    missing: telegramState.configured ? undefined : telegramState.missing,
    reason: telegramState.configured ? undefined : telegramState.reason,
    check: telegramCheck,
  });
  const webhookTarget = telegramWebhookUrl();
  const webhookFact = !telegramState.configured
    ? "Not applicable until the bot is configured"
    : webhookCheck?.ok
      ? `Registered and confirmed ${formatDateTime(webhookCheck.checkedAt.toISOString())}`
      : webhookCheck
        ? `Not confirmed (${webhookCheck.errorCode ?? "UNKNOWN"}) on ${formatDateTime(webhookCheck.checkedAt.toISOString())}`
        : webhookTarget.url
          ? "Not registered from this page yet"
          : "Local address: customers cannot be reached by webhook. Use npm run telegram:poll";
  const canDispatch = ctx.permissions.has(PERMISSIONS.MARKETING_CAMPAIGN_DISPATCH);

  const rows: Row[] = [
    {
      name: "Email delivery",
      state: emailStatus.state,
      detail: emailStatus.detail,
      setup: emailStatus.missing,
      action: smtpIsActiveEmail && ctx.permissions.has(PERMISSIONS.MARKETING_CAMPAIGN_DISPATCH) ? "test-email" : undefined,
    },
    {
      name: "Public links",
      state: isLocalOnlyUrl(getAppUrl()) ? (env.NODE_ENV === "production" ? "unavailable" : "unverified") : "configured",
      detail: isLocalOnlyUrl(getAppUrl())
        ? `Emailed links point at ${getAppUrl()}. Only this machine can open them, so unsubscribe links will not work for recipients.`
        : `Emailed links use ${getAppUrl()}.`,
      setup: isLocalOnlyUrl(getAppUrl()) ? ["APP_URL (public HTTPS address)"] : undefined,
    },
    {
      name: "SMS delivery",
      state: smsStatus.state,
      detail: smsStatus.detail,
      setup: smsStatus.missing,
    },
    {
      name: "Telegram bot",
      state: telegramStatus.state,
      detail: telegramStatus.detail,
      setup: telegramStatus.missing,
      telegram: {
        canTest: telegramState.configured && canDispatch,
        canRegisterWebhook: telegramState.configured && canDispatch && Boolean(webhookTarget.url),
        facts: telegramState.configured
          ? [
              { label: "Bot name", value: String(telegramCheck?.details?.botName ?? "Run a test to read it from Telegram") },
              { label: "Username", value: `@${telegramState.config.botUsername}` },
              { label: "Last test", value: telegramCheck ? `${telegramCheck.ok ? "Succeeded" : `Failed (${telegramCheck.errorCode ?? "UNKNOWN"})`} · ${formatDateTime(telegramCheck.checkedAt.toISOString())}` : "Never run" },
              { label: "Webhook", value: webhookFact },
            ]
          : [],
      },
    },
    {
      name: "Facebook Pages",
      state: social.configured ? "configured" : "unavailable",
      detail: social.configured
        ? "OAuth and publishing are configured but not verified against a live Meta app. Connect a Page from Social."
        : social.reason,
      setup: social.configured ? undefined : social.missing,
    },
    {
      name: "AI copywriter",
      state: aiAvailable.length > 0 ? "configured" : "unavailable",
      detail:
        aiAvailable.length > 0
          ? `Available through: ${aiAvailable.join(", ")}. Not exercised by an integration test.`
          : "No AI provider key is configured. Generation is disabled.",
      setup: aiAvailable.length > 0 ? undefined : ["GROQ_API_KEYS", "OPENROUTER_API_KEY", "GEMINI_API_KEYS (any one)"],
    },
    {
      name: "Background worker",
      state: getWorkerSecret() ? "unverified" : "unavailable",
      detail: getWorkerSecret()
        ? "The worker endpoint is enabled. A scheduler must call it every minute; this page cannot verify that it does."
        : "The worker endpoint is disabled. Scheduled campaigns and posts will not run.",
      setup: getWorkerSecret() ? undefined : ["MARKETING_WORKER_SECRET (32+ characters)"],
    },
    {
      name: "Delivery webhooks",
      state: getWebhookSecret() ? "unverified" : "unavailable",
      detail: getWebhookSecret()
        ? "Signed receiver enabled. Opening and bounce reporting stays unverified until a provider sends signed events."
        : "The receiver is disabled, so bounces and opens will not be recorded.",
      setup: getWebhookSecret() ? undefined : ["MARKETING_WEBHOOK_SECRET (32+ characters)"],
    },
  ];

  const tone: Record<IntegrationCapabilityState, BadgeTone> = {
    tested: "success",
    configured: "info",
    unverified: "warning",
    unavailable: "neutral",
  };
  const label: Record<IntegrationCapabilityState, string> = {
    tested: "Tested",
    configured: "Configured",
    unverified: "Unverified",
    unavailable: "Setup needed",
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Integrations"
        description="What is configured, what has been tested, and what is still needed. Secret values are never shown."
      />
      <ul className="divide-y divide-[var(--color-border-subtle)] rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
        {rows.map((row) => (
          <li key={row.name} className="space-y-2 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-base font-semibold">{row.name}</h2>
              <div className="flex flex-wrap items-center gap-2">
                {row.action === "test-email" && <EmailIntegrationTestButton />}
                {row.telegram?.canTest && <TelegramIntegrationActions canRegisterWebhook={row.telegram.canRegisterWebhook} />}
                <StatusBadge label={label[row.state]} tone={tone[row.state]} />
              </div>
            </div>
            <p className="text-sm text-[var(--color-text-secondary)]">{row.detail}</p>
            {row.telegram && row.telegram.facts.length > 0 && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
                {row.telegram.facts.map((fact) => (
                  <div key={fact.label} className="contents">
                    <dt className="text-[var(--color-text-secondary)]">{fact.label}</dt>
                    <dd className="break-words">{fact.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {row.setup && row.setup.length > 0 && (
              <p className="text-xs text-[var(--color-text-secondary)]">
                Needed: <span className="font-mono">{row.setup.join(", ")}</span>
              </p>
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs text-[var(--color-text-secondary)]">
        Email campaigns use the same <span className="font-mono">EMAIL_SERVER_*</span> and{" "}
        <span className="font-mono">EMAIL_FROM</span> account as sign-in email. Testing checks the SMTP handshake and
        login only; it does not send a message.
      </p>
    </div>
  );
}
