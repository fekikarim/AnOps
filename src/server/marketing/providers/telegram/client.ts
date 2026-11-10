import "server-only";
import { z } from "zod";
import { ProviderError } from "@/server/marketing/providers/types";

/**
 * Minimal Telegram Bot API client. Documented methods only:
 *   getMe, sendMessage, setWebhook, deleteWebhook, getWebhookInfo, getUpdates
 *
 * Failure classes, which decide whether dispatch may retry:
 *   - 429: Telegram did not process the request and says how long to wait (parameters.retry_after). Retryable.
 *   - 403 (blocked / deactivated user), 400 (chat not found, bad request), 401/404 (bad token): definite rejection.
 *   - Network error, timeout, 5xx, unreadable reply: the message may already have been accepted. Not retryable.
 * Error messages never include the request URL (it contains the token), the request body or the response body.
 */
export const TELEGRAM_API = "https://api.telegram.org";
export const TELEGRAM_TIMEOUT_MS = 10_000;

const envelope = z
  .object({
    ok: z.boolean(),
    result: z.unknown().optional(),
    error_code: z.number().optional(),
    description: z.string().optional(),
    parameters: z.object({ retry_after: z.number().optional() }).passthrough().optional(),
  })
  .passthrough();

type Raw = { ok: boolean; status: number; result: unknown; description: string; retryAfterSeconds: number | null };

async function call(token: string, method: string, body: unknown, signal?: AbortSignal): Promise<Raw> {
  let response: Response;
  try {
    response = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: signal ?? AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new ProviderError("NETWORK_OR_TIMEOUT", "The Telegram request did not complete.", false);
  }
  if (response.status >= 500) {
    throw new ProviderError("PROVIDER_UNAVAILABLE", "Telegram failed while handling the request.", false);
  }
  let parsed: z.infer<typeof envelope>;
  try {
    const json = envelope.safeParse(await response.json());
    if (!json.success) throw new Error("shape");
    parsed = json.data;
  } catch {
    // A 2xx whose body cannot be read may still have been processed. Treated as ambiguous by the caller.
    throw new ProviderError("INVALID_RESPONSE", "Telegram returned an unreadable response.", false);
  }
  return {
    ok: parsed.ok && response.ok,
    status: parsed.error_code ?? response.status,
    result: parsed.result,
    description: parsed.description ?? "",
    retryAfterSeconds: parsed.parameters?.retry_after ?? null,
  };
}

/** Maps a rejected Bot API reply to a ProviderError. Nothing from the description is echoed back. */
export function classifyTelegramRejection(status: number, description: string, retryAfterSeconds: number | null): ProviderError {
  const text = description.toLowerCase();
  if (status === 429) {
    const wait = Math.max(1, retryAfterSeconds ?? 1) * 1000;
    return new ProviderError("TELEGRAM_RATE_LIMITED", "Telegram asked the sender to slow down.", true, wait);
  }
  if (status === 401 || status === 404) return new ProviderError("AUTH_REJECTED", "Telegram rejected the bot token.", false);
  if (status === 403) {
    return new ProviderError("TELEGRAM_BOT_BLOCKED", "The recipient blocked the bot or deactivated the account.", false);
  }
  if (status === 400 && (text.includes("chat not found") || text.includes("user not found"))) {
    return new ProviderError("TELEGRAM_CHAT_NOT_FOUND", "Telegram does not know this chat.", false);
  }
  if (status === 400 && (text.includes("can't parse") || text.includes("message is too long") || text.includes("message text is empty"))) {
    return new ProviderError("CONTENT_INVALID", "Telegram rejected the message content.", false);
  }
  return new ProviderError("REQUEST_REJECTED", `Telegram rejected the request (HTTP ${status}).`, false);
}

const botUser = z.object({ id: z.number(), is_bot: z.boolean(), first_name: z.string(), username: z.string().optional() }).passthrough();
const sentMessage = z.object({ message_id: z.number().int().positive() }).passthrough();

export type TelegramBotInfo = { id: number; name: string; username: string | null };

/** Verifies the token. Sends nothing to any chat. */
export async function getMe(token: string): Promise<TelegramBotInfo> {
  const reply = await call(token, "getMe", {});
  if (!reply.ok) throw classifyTelegramRejection(reply.status, reply.description, reply.retryAfterSeconds);
  const parsed = botUser.safeParse(reply.result);
  if (!parsed.success || !parsed.data.is_bot) {
    throw new ProviderError("INVALID_RESPONSE", "Telegram returned an unexpected bot description.", false);
  }
  return { id: parsed.data.id, name: parsed.data.first_name, username: parsed.data.username ?? null };
}

/**
 * Sends plain text. No parse_mode is set on purpose: text is never interpreted as HTML or Markdown, so
 * customer-supplied values cannot inject markup.
 */
export async function sendTelegramMessage(token: string, chatId: string, text: string, signal: AbortSignal): Promise<{ messageId: number }> {
  const reply = await call(token, "sendMessage", { chat_id: chatId, text, link_preview_options: { is_disabled: true } }, signal);
  if (!reply.ok) throw classifyTelegramRejection(reply.status, reply.description, reply.retryAfterSeconds);
  const parsed = sentMessage.safeParse(reply.result);
  // Telegram said ok but gave no message id: the message was probably sent, so this is ambiguous, never "sent".
  if (!parsed.success) throw new ProviderError("INVALID_RESPONSE", "Telegram accepted the request but returned no message id.", false);
  return { messageId: parsed.data.message_id };
}

export async function setWebhook(token: string, url: string, secret: string): Promise<void> {
  const reply = await call(token, "setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: ["message", "my_chat_member"],
    drop_pending_updates: false,
  });
  if (!reply.ok) throw classifyTelegramRejection(reply.status, reply.description, reply.retryAfterSeconds);
}

export async function deleteWebhook(token: string): Promise<void> {
  const reply = await call(token, "deleteWebhook", { drop_pending_updates: false });
  if (!reply.ok) throw classifyTelegramRejection(reply.status, reply.description, reply.retryAfterSeconds);
}

const webhookInfo = z
  .object({
    url: z.string(),
    pending_update_count: z.number().optional(),
    last_error_date: z.number().optional(),
    last_error_message: z.string().optional(),
  })
  .passthrough();

export type TelegramWebhookInfo = { url: string; pendingUpdates: number; lastErrorAt: Date | null };

export async function getWebhookInfo(token: string): Promise<TelegramWebhookInfo> {
  const reply = await call(token, "getWebhookInfo", {});
  if (!reply.ok) throw classifyTelegramRejection(reply.status, reply.description, reply.retryAfterSeconds);
  const parsed = webhookInfo.safeParse(reply.result);
  if (!parsed.success) throw new ProviderError("INVALID_RESPONSE", "Telegram returned unexpected webhook details.", false);
  return {
    url: parsed.data.url,
    pendingUpdates: parsed.data.pending_update_count ?? 0,
    lastErrorAt: parsed.data.last_error_date ? new Date(parsed.data.last_error_date * 1000) : null,
  };
}

const fileInfo = z.object({ file_id: z.string(), file_path: z.string().optional(), file_size: z.number().optional() }).passthrough();

/**
 * Downloads a file a user sent to the bot (a receipt photo or PDF). Bots can fetch files up to 20 MB;
 * `maxBytes` is checked on the reported size and again while reading, so a large file is never buffered.
 */
export async function downloadTelegramFile(token: string, fileId: string, maxBytes: number): Promise<Uint8Array> {
  const reply = await call(token, "getFile", { file_id: fileId });
  if (!reply.ok) throw classifyTelegramRejection(reply.status, reply.description, reply.retryAfterSeconds);
  const parsed = fileInfo.safeParse(reply.result);
  if (!parsed.success || !parsed.data.file_path) throw new ProviderError("INVALID_RESPONSE", "Telegram returned no file path.", false);
  if ((parsed.data.file_size ?? 0) > maxBytes) throw new ProviderError("PAYLOAD_TOO_LARGE", "The file is too large.", false);

  let response: Response;
  try {
    response = await fetch(`${TELEGRAM_API}/file/bot${token}/${parsed.data.file_path}`, { signal: AbortSignal.timeout(30_000), cache: "no-store" });
  } catch {
    throw new ProviderError("NETWORK_OR_TIMEOUT", "The Telegram file download did not complete.", false);
  }
  if (!response.ok || !response.body) throw new ProviderError("PROVIDER_UNAVAILABLE", "Telegram did not return the file.", false);
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) {
      await reader.cancel();
      throw new ProviderError("PAYLOAD_TOO_LARGE", "The file is too large.", false);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** Long-poll fetch used by the local-development poller only. Never run together with a webhook. */
export async function getUpdates(token: string, offset: number, timeoutSeconds: number): Promise<unknown[]> {
  const reply = await call(
    token,
    "getUpdates",
    { offset, timeout: timeoutSeconds, allowed_updates: ["message", "my_chat_member"] },
    AbortSignal.timeout((timeoutSeconds + 10) * 1000)
  );
  if (!reply.ok) throw classifyTelegramRejection(reply.status, reply.description, reply.retryAfterSeconds);
  return Array.isArray(reply.result) ? reply.result : [];
}
