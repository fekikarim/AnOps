"use server";

import { z } from "zod";
import { randomUUID } from "crypto";
import clientPromise from "@/server/db/client";
import { ensureIndexes } from "@/server/db/indexes";
import { confirmUnsubscribe, type UnsubscribeResult } from "@/server/marketing/unsubscribe.service";
import { consumeRateLimit } from "@/server/security/rate-limit";
import { AppError, isAppError, type ActionResult } from "@/shared/lib/errors";

const tokenSchema = z.string().min(20).max(600);

/**
 * Public opt-out. The signed token is the credential, so no session is required. The request is
 * rate-limited per token to stop automated replay bursts.
 */
export async function confirmUnsubscribeAction(token: unknown): Promise<ActionResult<{ outcome: UnsubscribeResult }>> {
  const requestId = randomUUID();
  try {
    const parsed = tokenSchema.safeParse(token);
    if (!parsed.success) throw new AppError("VALIDATION_ERROR", "This link is not valid.");
    consumeRateLimit(`unsubscribe:${parsed.data.slice(-24)}`, 10, 60_000);
    const db = (await clientPromise).db();
    await ensureIndexes(db);
    const outcome = await confirmUnsubscribe(db, parsed.data, requestId);
    if (outcome === "invalid") throw new AppError("NOT_FOUND", "This link is not valid.");
    return { ok: true, data: { outcome } };
  } catch (error) {
    if (isAppError(error)) {
      return { ok: false, error: { code: error.code, message: error.message, requestId } };
    }
    console.error("[marketing] unsubscribe failed");
    return { ok: false, error: { code: "INTERNAL", message: "Something went wrong. Please try again.", requestId } };
  }
}
