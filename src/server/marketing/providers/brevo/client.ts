import "server-only";
import { z } from "zod";
import { ProviderError } from "@/server/marketing/providers/types";

/**
 * Minimal Brevo API client. Only documented endpoints are called:
 *   POST https://api.brevo.com/v3/transactionalSMS/send   (SMS, `type: "marketing"` allowed)
 *   POST https://api.brevo.com/v3/smtp/email               (email)
 * Authentication: the `api-key` header.
 *
 * Failure classes, which decide whether dispatch may retry:
 *   - 429 Too Many Requests: Brevo did not process the request. Retryable.
 *   - Network error, timeout, 5xx, unreadable response: the provider may already have accepted the message.
 *     Not retryable here. The delivery is marked failed for review, so a retry cannot send a duplicate.
 *   - Other 4xx: rejected. Not retryable.
 * Error messages never include the response body, the request body, or the key.
 */
export const BREVO_BASE_URL = "https://api.brevo.com";
export const BREVO_TIMEOUT_MS = 10_000;

const smsResponse = z.object({ messageId: z.union([z.number(), z.string()]) }).passthrough();
const emailResponse = z.object({ messageId: z.string().min(1).max(300) }).passthrough();

async function brevoPost(apiKey: string, path: string, body: unknown, signal: AbortSignal): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${BREVO_BASE_URL}${path}`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", "api-key": apiKey },
      body: JSON.stringify(body),
      signal,
      cache: "no-store",
    });
  } catch {
    throw new ProviderError("NETWORK_OR_TIMEOUT", "The Brevo request did not complete.", false);
  }
  if (response.status === 429) {
    throw new ProviderError("RATE_LIMITED", "Brevo rate limit reached.", true);
  }
  if (response.status >= 500) {
    throw new ProviderError("PROVIDER_UNAVAILABLE", "Brevo failed while handling the request.", false);
  }
  if (response.status === 401 || response.status === 403) {
    throw new ProviderError("AUTH_REJECTED", "Brevo rejected the API key or permissions.", false);
  }
  if (!response.ok) {
    throw new ProviderError("REQUEST_REJECTED", `Brevo rejected the request (HTTP ${response.status}).`, false);
  }
  try {
    return await response.json();
  } catch {
    throw new ProviderError("INVALID_RESPONSE", "Brevo returned an unreadable response.", false);
  }
}

export async function sendBrevoSms(
  apiKey: string,
  payload: { sender: string; recipient: string; content: string; webUrl: string; tag: string },
  signal: AbortSignal
): Promise<string> {
  const body = await brevoPost(apiKey, "/v3/transactionalSMS/send", { ...payload, type: "marketing" }, signal);
  const parsed = smsResponse.safeParse(body);
  if (!parsed.success) throw new ProviderError("INVALID_RESPONSE", "Brevo returned an unexpected response.", false);
  return String(parsed.data.messageId);
}

export async function sendBrevoEmail(
  apiKey: string,
  payload: {
    sender: { email: string; name: string };
    to: { email: string }[];
    subject: string;
    htmlContent?: string;
    textContent: string;
    tags: string[];
  },
  signal: AbortSignal
): Promise<string> {
  const body = await brevoPost(apiKey, "/v3/smtp/email", payload, signal);
  const parsed = emailResponse.safeParse(body);
  if (!parsed.success) throw new ProviderError("INVALID_RESPONSE", "Brevo returned an unexpected response.", false);
  return parsed.data.messageId;
}
