/**
 * Local-development Telegram poller. Use it instead of a webhook when the app is not reachable from the
 * internet. It reads updates with getUpdates and hands each one to the same processor the webhook uses.
 *
 * Telegram refuses getUpdates while a webhook is set, and this script also checks first, so polling and a
 * webhook are never active together. Remove a registered webhook with: npm run telegram:poll -- --delete-webhook
 *
 * Run: npm run telegram:poll
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

type ProcessWithEnvFile = typeof process & { loadEnvFile?: (path?: string) => void };
if (!process.env.MONGODB_URI && existsSync(".env")) {
  (process as ProcessWithEnvFile).loadEnvFile?.(".env");
}

async function main(): Promise<void> {
  const { default: clientPromise } = await import("@/server/db/client");
  const { ensureIndexes } = await import("@/server/db/indexes");
  const { getTelegramState } = await import("@/server/marketing/providers/telegram/config");
  const { getUpdates } = await import("@/server/marketing/providers/telegram/client");
  const { currentWebhookUrl, removeTelegramWebhook } = await import("@/server/marketing/telegram-integration");
  const { processTelegramUpdate } = await import("@/server/marketing/telegram.service");

  const state = getTelegramState();
  if (!state.configured) {
    console.error(`Telegram is not configured. Missing or invalid: ${state.missing.join(", ")}`);
    process.exit(1);
  }
  if (process.argv.includes("--delete-webhook")) {
    await removeTelegramWebhook();
    console.log("Webhook removed. You can poll now.");
    return;
  }
  const webhook = await currentWebhookUrl();
  if (webhook) {
    console.error("A webhook is registered with Telegram. Polling and a webhook must not run together.");
    console.error("Run `npm run telegram:poll -- --delete-webhook` first, or keep using the webhook.");
    process.exit(1);
  }

  const db = (await clientPromise).db();
  await ensureIndexes(db);
  console.log("Polling Telegram for updates. Press Ctrl+C to stop.");
  let offset = 0;
  for (;;) {
    try {
      const updates = await getUpdates(state.config.botToken, offset, 25);
      for (const update of updates) {
        const id = (update as { update_id?: number }).update_id;
        const outcome = await processTelegramUpdate(db, update, randomUUID());
        console.log(`update ${id}: ${outcome}`);
        if (typeof id === "number") offset = id + 1;
      }
    } catch (error) {
      console.error("poll failed:", error instanceof Error ? error.name : "error");
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
}

void main();
