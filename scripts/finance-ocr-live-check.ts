/**
 * Live check of receipt OCR against the configured AI providers (real API calls, real keys from .env).
 * Writes only to a throwaway database on the local test replica set, never to MONGODB_URI's database.
 *
 *   npx vite-node -c vitest.config.mts scripts/finance-ocr-live-check.ts -- <receipt.jpg|pdf>
 */
import { existsSync, readFileSync } from "node:fs";
import { ObjectId } from "mongodb";

type ProcessWithEnvFile = typeof process & { loadEnvFile?: (path?: string) => void };
if (existsSync(".env")) (process as ProcessWithEnvFile).loadEnvFile?.(".env");
const dbName = `anops_ocr_check_${Date.now()}`;
process.env.MONGODB_URI = `mongodb://127.0.0.1:27018/${dbName}?replicaSet=rs0&directConnection=true`;

const file = process.argv.slice(2).find((a) => a !== "--");
if (!file) {
  console.error("Usage: finance-ocr-live-check.ts <receipt file>");
  process.exit(1);
}

const { default: clientPromise } = await import("@/server/db/client");
const { ai } = await import("@/server/ai");
const { permissionsForRole } = await import("@/server/security/permissions");
const { scanReceipt } = await import("@/server/finance/receipt-ocr.service");

const client = await clientPromise;
const db = client.db();
const ctx = { db, requestId: "ocr-live-check", userId: new ObjectId(), companyId: new ObjectId(), role: "owner" as const, currencyCode: "TND", permissions: permissionsForRole("owner") };

console.log("Providers:", ai.status().filter((p) => p.available).map((p) => p.name).join(", ") || "none");
const started = Date.now();
try {
  // Straight to the provider router: the AI gate needs company AI settings this throwaway database does not have.
  const scan = await scanReceipt(ctx, { bytes: new Uint8Array(readFileSync(file)), originalName: file.split(/[\\/]/).pop(), source: "upload" }, { complete: (o) => ai.complete(o) });
  console.log(JSON.stringify({ seconds: (Date.now() - started) / 1000, provider: scan.provider, model: scan.model, proposed: scan.proposed, warnings: scan.warnings }, null, 2));
} catch (e) {
  console.error("FAILED:", e instanceof Error ? `${e.name}: ${e.message}` : e);
  process.exitCode = 1;
} finally {
  await db.dropDatabase();
  await client.close();
}
