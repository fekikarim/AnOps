import "server-only";
import { createHash } from "crypto";
import type { DeliveryWebhookInput } from "@/features/marketing/schemas/marketing.schema";

/**
 * Brevo event normalizer. Pure: no I/O, so every mapping is unit-tested.
 *
 * Email events (transactional webhook) carry `event`, `message-id`, `email`, `ts_event`, `id`.
 * SMS events carry `messageId`, `status` / `msg_status`, `to`, `date`, `id`.
 *
 * Brevo documents no per-event unique id for these payloads. The dedupe key is a SHA-256 over the stable
 * fields of the event, so a repeated delivery of the same event is stored once.
 *
 * SMS status strings are mapped from Brevo's documented event names. Confirm them against a real payload
 * from your account before relying on SMS delivery reporting. Unknown values are ignored, never guessed.
 */
export type NormalizedEvent =
  | { kind: "delivery"; input: DeliveryWebhookInput }
  | { kind: "unsubscribed"; providerMessageId: string; eventId: string; occurredAt: string }
  | { kind: "ignored" };

const EMAIL_MAP: Record<string, DeliveryWebhookInput["type"] | "unsubscribed"> = {
  delivered: "delivered",
  hard_bounce: "bounced",
  spam: "complained",
  invalid_email: "failed",
  blocked: "failed",
  opened: "opened",
  unique_opened: "opened",
  proxy_open: "opened",
  unique_proxy_open: "opened",
  click: "clicked",
  unsubscribed: "unsubscribed",
};

const SMS_MAP: Record<string, DeliveryWebhookInput["type"] | "unsubscribed"> = {
  delivered: "delivered",
  hard_bounce: "bounced",
  hardbounce: "bounced",
  rejected: "failed",
  blacklisted: "failed",
  unsubscribe: "unsubscribed",
};

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 300 ? value : null;
}

function num(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : null;
}

/** Raw field value as a string, for building the dedupe key. Numbers and strings are both accepted. */
function raw(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.length > 0 && value.length <= 300) return value;
  return null;
}

/**
 * Event time. Numbers are Unix seconds (or milliseconds when large). Strings are parsed as dates. The
 * receipt time is the last resort, so occurredAt is never missing. It is not used for the dedupe key.
 */
function isoTime(...candidates: unknown[]): string {
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0) {
      return new Date(candidate < 1e12 ? candidate * 1000 : candidate).toISOString();
    }
    if (typeof candidate === "string") {
      const time = Date.parse(candidate);
      if (!Number.isNaN(time)) return new Date(time).toISOString();
    }
  }
  return new Date().toISOString();
}

function digest(parts: (string | null)[]): string {
  return createHash("sha256").update(parts.map((part) => part ?? "").join("|")).digest("hex");
}

export function normalizeBrevoEvent(payload: unknown): NormalizedEvent {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return { kind: "ignored" };
  const event = payload as Record<string, unknown>;

  // Email: present when the payload has a message-id and an event name.
  const emailEvent = str(event.event);
  const emailMessage = str(event["message-id"]);
  if (emailEvent && emailMessage) {
    const mapped = EMAIL_MAP[emailEvent];
    if (!mapped) return { kind: "ignored" };
    const occurredAt = isoTime(event.ts_event, event.date);
    const eventId = digest(["email", emailEvent, emailMessage, str(event.email), raw(event.ts_event) ?? raw(event.date), raw(event.id)]);
    if (mapped === "unsubscribed") return { kind: "unsubscribed", providerMessageId: emailMessage, eventId, occurredAt };
    return { kind: "delivery", input: { eventId, type: mapped, providerMessageId: emailMessage, occurredAt } };
  }

  // SMS: present when the payload has a numeric or string messageId and a status.
  const smsMessage = str(event.messageId) ?? num(event.messageId);
  const smsStatus = (str(event.status) ?? str(event.msg_status) ?? "").toLowerCase();
  if (smsMessage && smsStatus) {
    const mapped = SMS_MAP[smsStatus];
    if (!mapped) return { kind: "ignored" };
    const occurredAt = isoTime(event.ts_event, event.date);
    const eventId = digest(["sms", smsMessage, smsStatus, str(event.to), raw(event.date), raw(event.id)]);
    if (mapped === "unsubscribed") return { kind: "unsubscribed", providerMessageId: smsMessage, eventId, occurredAt };
    return { kind: "delivery", input: { eventId, type: mapped, providerMessageId: smsMessage, occurredAt } };
  }

  return { kind: "ignored" };
}
