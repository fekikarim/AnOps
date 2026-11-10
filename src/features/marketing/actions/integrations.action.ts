"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/server/actions/run-action";
import { PERMISSIONS } from "@/server/security/permissions";
import { requireMarketing } from "@/server/marketing/common";
import { testEmailProvider } from "@/server/marketing/providers";
import { configureTelegramWebhook, testTelegramBot } from "@/server/marketing/telegram-integration";
import {
  EMAIL_INTEGRATION_CHECK_ID,
  TELEGRAM_INTEGRATION_CHECK_ID,
  TELEGRAM_WEBHOOK_CHECK_ID,
  recordIntegrationCheck,
  type IntegrationCheck,
} from "@/server/marketing/integration-status";
import type { ActionResult } from "@/shared/lib/errors";

export type EmailIntegrationTestResult = {
  ok: boolean;
  errorCode: string | null;
  providerName: string | null;
  checkedAt: string;
};

/**
 * Verifies the SMTP handshake and login without sending a message. Testing is
 * limited to roles that can dispatch campaigns, and the result is recorded so the
 * Integrations page can distinguish configured from tested.
 */
export async function testEmailIntegrationAction(): Promise<ActionResult<EmailIntegrationTestResult>> {
  return runAction(
    "marketing.integration.test-email",
    async (ctx) => {
      requireMarketing(ctx, PERMISSIONS.MARKETING_CAMPAIGN_DISPATCH);
      const result = await testEmailProvider();
      const check: IntegrationCheck = await recordIntegrationCheck(
        ctx.db,
        EMAIL_INTEGRATION_CHECK_ID,
        { ok: result.ok, errorCode: result.errorCode },
        ctx.userId
      );
      revalidatePath("/marketing/integrations");
      return { ...result, checkedAt: check.checkedAt.toISOString() };
    },
    { rateLimit: { limit: 3, windowMs: 60_000 } }
  );
}

export type TelegramIntegrationTestResult = {
  ok: boolean;
  errorCode: string | null;
  botName: string | null;
  botUsername: string | null;
  checkedAt: string;
};

/** Calls getMe with the configured token. Nothing is sent to any chat. */
export async function testTelegramIntegrationAction(): Promise<ActionResult<TelegramIntegrationTestResult>> {
  return runAction(
    "marketing.integration.test-telegram",
    async (ctx) => {
      requireMarketing(ctx, PERMISSIONS.MARKETING_CAMPAIGN_DISPATCH);
      const result = await testTelegramBot();
      const check = await recordIntegrationCheck(
        ctx.db,
        TELEGRAM_INTEGRATION_CHECK_ID,
        { ok: result.ok, errorCode: result.errorCode, details: { botName: result.botName, botUsername: result.botUsername } },
        ctx.userId
      );
      revalidatePath("/marketing/integrations");
      return { ...result, checkedAt: check.checkedAt.toISOString() };
    },
    { rateLimit: { limit: 5, windowMs: 60_000 } }
  );
}

export type TelegramWebhookActionResult = { ok: boolean; errorCode: string | null; registeredUrl: string | null; checkedAt: string };

/** Registers the webhook with Telegram and verifies Telegram reports the same address back. */
export async function configureTelegramWebhookAction(): Promise<ActionResult<TelegramWebhookActionResult>> {
  return runAction(
    "marketing.integration.telegram-webhook",
    async (ctx) => {
      requireMarketing(ctx, PERMISSIONS.MARKETING_CAMPAIGN_DISPATCH);
      const result = await configureTelegramWebhook();
      const check = await recordIntegrationCheck(
        ctx.db,
        TELEGRAM_WEBHOOK_CHECK_ID,
        { ok: result.ok, errorCode: result.errorCode, details: { registeredUrl: result.registeredUrl, pendingUpdates: result.pendingUpdates } },
        ctx.userId
      );
      revalidatePath("/marketing/integrations");
      return { ok: result.ok, errorCode: result.errorCode, registeredUrl: result.registeredUrl, checkedAt: check.checkedAt.toISOString() };
    },
    { rateLimit: { limit: 5, windowMs: 60_000 } }
  );
}
