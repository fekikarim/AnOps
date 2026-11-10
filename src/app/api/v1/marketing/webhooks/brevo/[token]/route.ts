import { randomUUID, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import clientPromise from "@/server/db/client";
import { ensureIndexes } from "@/server/db/indexes";
import { getBrevoState } from "@/server/marketing/providers/brevo/config";
import { normalizeBrevoEvent } from "@/server/marketing/providers/brevo/events";
import { applyDeliveryEvent, applyProviderUnsubscribe } from "@/server/marketing/delivery-events";

/**
 * Brevo event receiver. Brevo does not sign webhook requests, so the URL path carries a long random token
 * (BREVO_WEBHOOK_TOKEN) that is compared in constant time. Treat the full URL as a secret: anyone who sees it
 * can post events. Rotate the token if it leaks.
 *
 * The company is never taken from the payload. Events are matched to a stored delivery by provider message id.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 64 * 1024;
const MAX_EVENTS_PER_REQUEST = 100;

function tokenMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const requestId = randomUUID();
  const state = getBrevoState();
  if (!state.configured || !state.config.webhookToken) {
    return NextResponse.json({ error: { code: "NOT_CONFIGURED", message: "Webhooks are not configured.", requestId } }, { status: 503 });
  }
  const { token } = await context.params;
  if (!tokenMatches(token, state.config.webhookToken)) {
    return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Not found.", requestId } }, { status: 404 });
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
  const events = (Array.isArray(payload) ? payload : [payload]).slice(0, MAX_EVENTS_PER_REQUEST);

  const counts = { recorded: 0, duplicate: 0, unmatched: 0, ignored: 0 };
  try {
    const db = (await clientPromise).db();
    await ensureIndexes(db);
    for (const item of events) {
      const normalized = normalizeBrevoEvent(item);
      if (normalized.kind === "ignored") {
        counts.ignored += 1;
        continue;
      }
      const outcome =
        normalized.kind === "delivery"
          ? await applyDeliveryEvent(db, normalized.input, "brevo")
          : await applyProviderUnsubscribe(db, normalized, requestId);
      counts[outcome] += 1;
    }
    return NextResponse.json({ data: counts, meta: { requestId } });
  } catch {
    console.error("[marketing] brevo webhook processing failed");
    return NextResponse.json({ error: { code: "INTERNAL", message: "Processing failed; Brevo should retry.", requestId } }, { status: 500 });
  }
}
