import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import clientPromise from "@/server/db/client";
import { ensureIndexes } from "@/server/db/indexes";
import { getWebhookSecret } from "@/server/marketing/config";
import { applyDeliveryEvent } from "@/server/marketing/delivery-events";
import { verifyWebhookSignature } from "@/server/marketing/webhook-signature";
import { deliveryWebhookSchema } from "@/features/marketing/schemas/marketing.schema";

/**
 * Delivery event receiver. Requests must carry a valid HMAC signature. The company is resolved from the
 * stored delivery, never from the payload. The raw body is read once and verified before it is parsed.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 16 * 1024;
const PROVIDER_NAME = "signed-webhook";

export async function POST(request: Request) {
  const requestId = randomUUID();
  const secret = getWebhookSecret();
  if (!secret) {
    return NextResponse.json({ error: { code: "NOT_CONFIGURED", message: "Webhooks are not configured.", requestId } }, { status: 503 });
  }

  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json({ error: { code: "PAYLOAD_TOO_LARGE", message: "Payload too large.", requestId } }, { status: 413 });
  }
  if (!verifyWebhookSignature(raw, request.headers.get("x-anops-signature"), secret)) {
    return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Invalid signature.", requestId } }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Malformed JSON.", requestId } }, { status: 400 });
  }
  const parsed = deliveryWebhookSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid event.", requestId } }, { status: 400 });
  }

  try {
    const db = (await clientPromise).db();
    await ensureIndexes(db);
    const outcome = await applyDeliveryEvent(db, parsed.data, PROVIDER_NAME);
    const status = outcome === "unmatched" ? 202 : 200;
    return NextResponse.json({ data: { outcome }, meta: { requestId } }, { status });
  } catch {
    console.error("[marketing] webhook processing failed");
    return NextResponse.json({ error: { code: "INTERNAL", message: "Processing failed; the sender should retry.", requestId } }, { status: 500 });
  }
}
