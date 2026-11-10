import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * Signed webhook contract. Header: `x-anops-signature: t=<unix seconds>,v1=<hex HMAC-SHA256>`, where the
 * HMAC covers `<t>.<raw body>`. A timestamp outside the tolerance window is rejected, which limits replay.
 * Duplicate events are also rejected by the event store, so a replay inside the window is harmless.
 */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

export function signWebhookPayload(rawBody: string, secret: string, timestampSeconds: number): string {
  const signature = createHmac("sha256", secret).update(`${timestampSeconds}.${rawBody}`).digest("hex");
  return `t=${timestampSeconds},v1=${signature}`;
}

export function verifyWebhookSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): boolean {
  if (!header || header.length > 300) return false;
  const parts = Object.fromEntries(
    header.split(",").map((part) => {
      const index = part.indexOf("=");
      return [part.slice(0, index).trim(), part.slice(index + 1).trim()];
    })
  );
  const timestamp = Number(parts.t);
  const received = parts.v1 ?? "";
  if (!Number.isInteger(timestamp) || Math.abs(nowSeconds - timestamp) > WEBHOOK_TOLERANCE_SECONDS) return false;
  if (!/^[a-f0-9]{64}$/.test(received)) return false;
  const expected = Buffer.from(signWebhookPayload(rawBody, secret, timestamp).split("v1=")[1], "hex");
  const actual = Buffer.from(received, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
