import "server-only";
import type { Db, ObjectId } from "mongodb";

/**
 * Integration health reporting.
 *
 * "Configured" means every setting an adapter needs is present. It does not prove
 * the provider accepts our credentials. "Tested" means a connection check
 * succeeded recently. A failed or stale check is reported as "unverified", never
 * as ready. Only SMTP supports a connection test (it verifies the handshake and
 * login without sending a message).
 */
export type IntegrationCapabilityState = "tested" | "configured" | "unverified" | "unavailable";

export type IntegrationCheck = {
  ok: boolean;
  checkedAt: Date;
  errorCode: string | null;
  /** Small non-secret facts from the check, for example the bot's display name. */
  details?: Record<string, string | number | boolean | null>;
};

export type IntegrationStatus = {
  state: IntegrationCapabilityState;
  detail: string;
  missing: string[] | null;
};

export const INTEGRATION_CHECKS_COLLECTION = "marketing_integration_checks";
export const EMAIL_INTEGRATION_CHECK_ID = "email_delivery";
export const TELEGRAM_INTEGRATION_CHECK_ID = "telegram_bot";
export const TELEGRAM_WEBHOOK_CHECK_ID = "telegram_webhook";
export const INTEGRATION_CHECK_FRESH_MS = 7 * 86_400_000;

export function classifyIntegration(input: {
  configured: boolean;
  providerName: string | null;
  missing?: string[];
  reason?: string;
  check: IntegrationCheck | null;
  now?: Date;
}): IntegrationStatus {
  if (!input.configured) {
    return {
      state: "unavailable",
      detail: input.reason ?? "No delivery provider is configured. Campaigns cannot be scheduled and nothing is sent.",
      missing: input.missing && input.missing.length > 0 ? input.missing : null,
    };
  }

  const now = input.now ?? new Date();
  const label = input.providerName ?? "a delivery provider";

  if (!input.check) {
    return {
      state: "configured",
      detail: `Configured with ${label}. No connection test has been recorded, so acceptance is unverified.`,
      missing: null,
    };
  }

  const age = now.getTime() - input.check.checkedAt.getTime();
  if (input.check.ok && age <= INTEGRATION_CHECK_FRESH_MS) {
    return {
      state: "tested",
      detail: `Configured with ${label}. The last connection test succeeded on ${input.check.checkedAt.toISOString()}.`,
      missing: null,
    };
  }

  if (!input.check.ok) {
    return {
      state: "unverified",
      detail: `Configured with ${label}, but the last connection test failed (${input.check.errorCode ?? "UNKNOWN"}) on ${input.check.checkedAt.toISOString()}.`,
      missing: null,
    };
  }

  return {
    state: "unverified",
    detail: `Configured with ${label}, but the last successful test is stale (${input.check.checkedAt.toISOString()}). Run it again.`,
    missing: null,
  };
}

export type IntegrationCheckDoc = {
  _id: string;
  checkedAt: Date;
  ok: boolean;
  errorCode: string | null;
  checkedBy: ObjectId | null;
  details?: IntegrationCheck["details"];
};

export async function loadIntegrationCheck(db: Db, id: string): Promise<IntegrationCheck | null> {
  const doc = await db
    .collection<IntegrationCheckDoc>(INTEGRATION_CHECKS_COLLECTION)
    .findOne({ _id: id }, { projection: { ok: 1, checkedAt: 1, errorCode: 1, details: 1 } });
  return doc ? { ok: doc.ok, checkedAt: doc.checkedAt, errorCode: doc.errorCode, details: doc.details } : null;
}

export async function recordIntegrationCheck(
  db: Db,
  id: string,
  result: { ok: boolean; errorCode: string | null; details?: IntegrationCheck["details"] },
  checkedBy: ObjectId
): Promise<IntegrationCheck> {
  const checkedAt = new Date();
  await db.collection<IntegrationCheckDoc>(INTEGRATION_CHECKS_COLLECTION).updateOne(
    { _id: id },
    { $set: { checkedAt, ok: result.ok, errorCode: result.errorCode, checkedBy, details: result.details ?? {} } },
    { upsert: true }
  );
  return { ok: result.ok, checkedAt, errorCode: result.errorCode, details: result.details };
}
