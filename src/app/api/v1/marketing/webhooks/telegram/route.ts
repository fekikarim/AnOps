import { randomUUID, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import clientPromise from "@/server/db/client";
import { ensureIndexes } from "@/server/db/indexes";
import { getTelegramState } from "@/server/marketing/providers/telegram/config";
import { processTelegramUpdate } from "@/server/marketing/telegram.service";

/**
 * Telegram update receiver. Telegram echoes the secret given to setWebhook in X-Telegram-Bot-Api-Secret-Token,
 * which is compared in constant time. The company is never read from the payload: it is resolved from the
 * stored connection token or subscription.
 *
 * Responses: 503 when the bot is not configured, 401 for a wrong or missing secret, 413/400 for bad bodies,
 * 200 once the update was handled or recognised as a repeat, 500 when processing failed so Telegram retries.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 64 * 1024;

function secretMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const requestId = randomUUID();
  const state = getTelegramState();
  if (!state.configured) {
    return NextResponse.json({ error: { code: "NOT_CONFIGURED", message: "Telegram is not configured.", requestId } }, { status: 503 });
  }
  const given = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!secretMatches(given, state.config.webhookSecret)) {
    return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Not authorised.", requestId } }, { status: 401 });
  }

  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json({ error: { code: "PAYLOAD_TOO_LARGE", message: "Payload too large.", requestId } }, { status: 413 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Malformed JSON.", requestId } }, { status: 400 });
  }

  try {
    const db = (await clientPromise).db();
    await ensureIndexes(db);
    const outcome = await processTelegramUpdate(db, payload, requestId);
    return NextResponse.json({ data: { outcome }, meta: { requestId } });
  } catch {
    // No update content in the log: it can hold a customer's name and chat id.
    console.error("[marketing] telegram webhook processing failed");
    return NextResponse.json({ error: { code: "INTERNAL", message: "Processing failed; Telegram should retry.", requestId } }, { status: 500 });
  }
}
