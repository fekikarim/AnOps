import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { unsubscribeSigningKey } from "@/server/marketing/config";

/**
 * Unsubscribe links carry a signed payload: company, contact, channel and optional campaign. The HMAC
 * makes the link unforgeable, so it cannot be guessed or edited to target another contact. Links do not
 * expire, because a recipient must always be able to opt out. Revoking the link is done by consent state,
 * not by the token.
 */
export type UnsubscribePayload = {
  companyId: string;
  contactId: string;
  channel: "email" | "sms";
  campaignId: string | null;
};

function sign(body: string): string {
  return createHmac("sha256", unsubscribeSigningKey()).update(body).digest("base64url");
}

export function createUnsubscribeToken(payload: UnsubscribePayload): string {
  const body = Buffer.from(JSON.stringify({ c: payload.companyId, k: payload.contactId, ch: payload.channel, g: payload.campaignId }), "utf8").toString("base64url");
  return `${body}.${sign(body)}`;
}

export function verifyUnsubscribeToken(token: string): UnsubscribePayload | null {
  const parts = token.split(".");
  if (parts.length !== 2 || token.length > 600) return null;
  const [body, signature] = parts;
  const expected = Buffer.from(sign(body));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
      c?: unknown;
      k?: unknown;
      ch?: unknown;
      g?: unknown;
    };
    const valid =
      typeof data.c === "string" && /^[a-f0-9]{24}$/.test(data.c) &&
      typeof data.k === "string" && /^[a-f0-9]{24}$/.test(data.k) &&
      (data.ch === "email" || data.ch === "sms") &&
      (data.g === null || (typeof data.g === "string" && /^[a-f0-9]{24}$/.test(data.g)));
    if (!valid) return null;
    return {
      companyId: data.c as string,
      contactId: data.k as string,
      channel: data.ch as "email" | "sms",
      campaignId: (data.g as string | null) ?? null,
    };
  } catch {
    return null;
  }
}
