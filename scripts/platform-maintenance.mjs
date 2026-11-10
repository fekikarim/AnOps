/**
 * Calls the platform maintenance endpoint (organization activation expiry + trial lapse).
 * Production: run every 5 minutes from cron or the platform scheduler. Local: `npm run platform:maintenance[:watch]`.
 */
import { existsSync } from "node:fs";

if (!process.env.PLATFORM_CRON_SECRET && existsSync(".env")) process.loadEnvFile?.(".env");

const secret = process.env.PLATFORM_CRON_SECRET;
const baseUrl = (process.env.PLATFORM_MAINTENANCE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const intervalMs = Number(process.env.PLATFORM_MAINTENANCE_INTERVAL_MS ?? 300_000);
const once = process.argv.includes("--once");

if (!secret) {
  console.error("PLATFORM_CRON_SECRET is not set (32+ characters). Add it to .env before running maintenance.");
  process.exit(1);
}

async function runOnce() {
  try {
    const response = await fetch(`${baseUrl}/api/v1/platform/maintenance`, { method: "POST", headers: { authorization: `Bearer ${secret}` } });
    const body = await response.json().catch(() => ({}));
    console.log(`[${new Date().toISOString()}] ${response.status}`, JSON.stringify(body.data ?? body.error ?? {}));
  } catch (error) {
    console.error(`[${new Date().toISOString()}] request failed: ${error instanceof Error ? error.message : error}`);
  }
}

await runOnce();
if (!once) setInterval(runOnce, Math.max(intervalMs, 30_000));
