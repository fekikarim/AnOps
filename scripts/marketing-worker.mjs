/**
 * Development helper for the marketing worker.
 *
 * The Next.js process never runs scheduled marketing jobs by itself: scheduling only writes a `queued`
 * row to `marketing_jobs`. Something must call `POST /api/v1/marketing/worker` on a schedule. In
 * production that is a cron job or a platform scheduler. This script is the local equivalent.
 *
 * Usage:
 *   npm run marketing:worker          # one run, then exit
 *   npm run marketing:worker:watch    # run now, then every 60 seconds
 *
 * It only talks to a local or explicitly configured URL, so it cannot accidentally drive a deployed
 * environment. The worker itself enforces `MARKETING_SEND_ALLOWLIST`.
 */
import { existsSync } from "node:fs";

if (!process.env.MARKETING_WORKER_SECRET && existsSync(".env")) {
  process.loadEnvFile?.(".env");
}

const secret = process.env.MARKETING_WORKER_SECRET;
const baseUrl = (process.env.MARKETING_WORKER_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const intervalMs = Number(process.env.MARKETING_WORKER_INTERVAL_MS ?? 60_000);
const once = process.argv.includes("--once");

if (!secret) {
  console.error("MARKETING_WORKER_SECRET is not set. Add it to .env before starting the worker.");
  process.exit(1);
}
if (!Number.isFinite(intervalMs) || intervalMs < 5_000) {
  console.error("MARKETING_WORKER_INTERVAL_MS must be at least 5000.");
  process.exit(1);
}

async function runOnce() {
  const startedAt = new Date().toISOString();
  try {
    const response = await fetch(`${baseUrl}/api/v1/marketing/worker`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(180_000),
    });
    const body = await response.text();
    console.log(`${startedAt} ${response.status} ${body}`);
    if (!response.ok) process.exitCode = 1;
  } catch (error) {
    console.error(`${startedAt} worker call failed:`, error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

await runOnce();
if (!once) {
  console.log(`Watching ${baseUrl} every ${Math.round(intervalMs / 1000)}s. Press Ctrl+C to stop.`);
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    await runOnce();
  }
}
