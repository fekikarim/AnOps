import { afterEach, describe, expect, it, vi } from "vitest";
import { classifySendFailure } from "@/server/marketing/dispatch";
import { ProviderError } from "@/server/marketing/providers/types";
import { getMe, sendTelegramMessage, classifyTelegramRejection } from "@/server/marketing/providers/telegram/client";
import { createTelegramProvider, isValidChatId } from "@/server/marketing/providers/telegram/adapters";
import type { TelegramConfig } from "@/server/marketing/providers/telegram/config";
import { renderMessage } from "@/server/marketing/message";
import { campaignInputSchema, templateInputSchema } from "@/features/marketing/schemas/marketing.schema";
import { TELEGRAM_BODY_MAX, TELEGRAM_MESSAGE_MAX, TELEGRAM_OPT_OUT_FOOTER } from "@/features/marketing/utils/template";
import { generateLinkToken, hashLinkToken } from "@/server/marketing/telegram.service";
import { classifyIntegration } from "@/server/marketing/integration-status";
import { parseCopyOutput } from "@/server/marketing/ai/copy.service";

const TOKEN = "123456789:TEST_TOKEN_abcdefghijklmnopqrstuvwxyz012";
const config: TelegramConfig = { botToken: TOKEN, botUsername: "AnOpsNotificationsBot", webhookSecret: "s".repeat(40), sendAllowlist: null };
const signal = new AbortController().signal;
const values = { first_name: "Amina", last_name: "Ben Ali", email: "", company_name: "Northwind", unsubscribe_url: "" };

afterEach(() => vi.unstubAllGlobals());

function reply(status: number, body: unknown) {
  const spy = vi.fn(async (_url?: unknown, _init?: unknown) => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("Telegram Bot API client", () => {
  it("tests the token with getMe and sends nothing to any chat", async () => {
    const spy = reply(200, { ok: true, result: { id: 1, is_bot: true, first_name: "AnOps Notifications", username: "AnOpsNotificationsBot" } });
    await expect(getMe(TOKEN)).resolves.toEqual({ id: 1, name: "AnOps Notifications", username: "AnOpsNotificationsBot" });
    expect(String(spy.mock.calls[0][0])).toBe(`https://api.telegram.org/bot${TOKEN}/getMe`);
  });

  it("maps an invalid token to AUTH_REJECTED without echoing the token", async () => {
    reply(401, { ok: false, error_code: 401, description: "Unauthorized" });
    const error = await getMe(TOKEN).catch((e: ProviderError) => e);
    expect(error).toMatchObject({ code: "AUTH_REJECTED", retryable: false });
    expect((error as Error).message).not.toContain(TOKEN);
  });

  it("sends plain text with no parse_mode and returns the message id", async () => {
    const spy = reply(200, { ok: true, result: { message_id: 42 } });
    await expect(sendTelegramMessage(TOKEN, "555", "Hello <b>Amina</b> *x*", signal)).resolves.toEqual({ messageId: 42 });
    const body = JSON.parse(String((spy.mock.calls[0][1] as RequestInit).body));
    expect(body).toMatchObject({ chat_id: "555", text: "Hello <b>Amina</b> *x*" });
    expect(body).not.toHaveProperty("parse_mode");
  });

  it("classifies blocked bots, unknown chats and bad content as definite rejections", () => {
    expect(classifyTelegramRejection(403, "Forbidden: bot was blocked by the user", null)).toMatchObject({ code: "TELEGRAM_BOT_BLOCKED", retryable: false });
    expect(classifyTelegramRejection(400, "Bad Request: chat not found", null)).toMatchObject({ code: "TELEGRAM_CHAT_NOT_FOUND", retryable: false });
    expect(classifyTelegramRejection(400, "Bad Request: message is too long", null)).toMatchObject({ code: "CONTENT_INVALID", retryable: false });
  });

  it("treats HTTP 429 as retryable and keeps Telegram's retry_after", async () => {
    reply(429, { ok: false, error_code: 429, description: "Too Many Requests: retry after 7", parameters: { retry_after: 7 } });
    const error = await sendTelegramMessage(TOKEN, "555", "x", signal).catch((e: ProviderError) => e);
    expect(error).toMatchObject({ code: "TELEGRAM_RATE_LIMITED", retryable: true, retryAfterMs: 7000 });
  });

  it("treats 5xx, network failures and unreadable replies as ambiguous, never retryable", async () => {
    reply(502, { ok: false });
    await expect(sendTelegramMessage(TOKEN, "555", "x", signal)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", retryable: false });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("socket hang up"); }));
    await expect(sendTelegramMessage(TOKEN, "555", "x", signal)).rejects.toMatchObject({ code: "NETWORK_OR_TIMEOUT", retryable: false });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { status: 200 })));
    await expect(sendTelegramMessage(TOKEN, "555", "x", signal)).rejects.toMatchObject({ code: "INVALID_RESPONSE", retryable: false });
  });

  it("never reports success when Telegram returns no message id", async () => {
    reply(200, { ok: true, result: {} });
    await expect(sendTelegramMessage(TOKEN, "555", "x", signal)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});

describe("Telegram adapter", () => {
  it("accepts only numeric private-chat ids", () => {
    expect(isValidChatId("123456789")).toBe(true);
    for (const bad of ["", "-100123", "@channel", "12 34", "1".repeat(21)]) expect(isValidChatId(bad)).toBe(false);
  });

  it("returns a globally unique provider message id (chat id + message id)", async () => {
    reply(200, { ok: true, result: { message_id: 9 } });
    const provider = createTelegramProvider(config);
    expect(provider.channel).toBe("telegram");
    await expect(provider.send({ idempotencyKey: "d1", to: "555", subject: "", text: "hi", html: null }, { signal })).resolves.toEqual({ providerMessageId: "555:9" });
  });

  it("refuses a chat that is not on the controlled-recipient list before any request", async () => {
    const spy = reply(200, { ok: true, result: { message_id: 1 } });
    const provider = createTelegramProvider({ ...config, sendAllowlist: ["999"] });
    await expect(provider.send({ idempotencyKey: "d1", to: "555", subject: "", text: "hi", html: null }, { signal })).rejects.toMatchObject({ code: "NOT_ALLOWLISTED" });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("dispatch classification for Telegram", () => {
  it("retries only the rate limit, fails definite rejections and flags everything else as ambiguous", () => {
    expect(classifySendFailure(new ProviderError("TELEGRAM_RATE_LIMITED", "x", true, 1000), false, true)).toEqual({ kind: "retry", code: "TELEGRAM_RATE_LIMITED" });
    expect(classifySendFailure(new ProviderError("TELEGRAM_BOT_BLOCKED", "x", false), false, true)).toEqual({ kind: "fail", code: "TELEGRAM_BOT_BLOCKED" });
    expect(classifySendFailure(new ProviderError("TELEGRAM_CHAT_NOT_FOUND", "x", false), false, true)).toEqual({ kind: "fail", code: "TELEGRAM_CHAT_NOT_FOUND" });
    expect(classifySendFailure(new ProviderError("INVALID_RESPONSE", "x", false), false, true)).toEqual({ kind: "fail", code: "AMBIGUOUS_SEND" });
    expect(classifySendFailure(new ProviderError("TELEGRAM_RATE_LIMITED", "x", true), true, true)).toEqual({ kind: "fail", code: "AMBIGUOUS_SEND" });
  });
});

describe("Telegram message validation and rendering", () => {
  const base = { name: "Promo", channel: "telegram", design: "plain", subject: "", body: "Hello {{first_name}}", isActive: true };

  it("accepts a plain message and rejects a subject, a design, an unsupported variable and an oversized body", () => {
    expect(templateInputSchema.safeParse(base).success).toBe(true);
    expect(templateInputSchema.safeParse({ ...base, subject: "Hi" }).success).toBe(false);
    expect(templateInputSchema.safeParse({ ...base, design: "promo" }).success).toBe(false);
    expect(templateInputSchema.safeParse({ ...base, body: "Opt out {{unsubscribe_url}}" }).success).toBe(false);
    expect(templateInputSchema.safeParse({ ...base, body: "Mail {{email}}" }).success).toBe(false);
    expect(templateInputSchema.safeParse({ ...base, body: "x".repeat(TELEGRAM_BODY_MAX) }).success).toBe(true);
    expect(templateInputSchema.safeParse({ ...base, body: "x".repeat(TELEGRAM_BODY_MAX + 1) }).success).toBe(false);
  });

  it("validates campaigns with the same rules", () => {
    const campaign = { name: "C", channel: "telegram", design: "plain", audienceId: "a".repeat(24), templateId: null, subject: "", body: "Hi" };
    expect(campaignInputSchema.safeParse(campaign).success).toBe(true);
    expect(campaignInputSchema.safeParse({ ...campaign, body: "x".repeat(TELEGRAM_BODY_MAX + 1) }).success).toBe(false);
  });

  it("keeps SMS and email rules unchanged", () => {
    const sms = { name: "S", channel: "sms", design: "plain", subject: "", body: "x".repeat(480), isActive: true };
    expect(templateInputSchema.safeParse(sms).success).toBe(false);
    expect(templateInputSchema.safeParse({ ...sms, body: "Hi {{first_name}}" }).success).toBe(true);
    expect(templateInputSchema.safeParse({ name: "E", channel: "email", design: "plain", subject: "Hi", body: "Bye {{unsubscribe_url}}", isActive: true }).success).toBe(true);
  });

  it("renders plain text with the /stop line and never as markup", () => {
    const rendered = renderMessage("telegram", { subject: "", body: "Hi {{first_name}} <b>now</b>" }, values);
    expect(rendered.html).toBeNull();
    expect(rendered.text).toBe(`Hi Amina <b>now</b>\n\n${TELEGRAM_OPT_OUT_FOOTER}`);
  });

  it("rejects a rendered message over Telegram's limit instead of cutting it", () => {
    const long = { ...values, first_name: "A".repeat(200) };
    expect(() => renderMessage("telegram", { subject: "", body: `{{first_name}}${"x".repeat(TELEGRAM_BODY_MAX - 5)}` }, long)).toThrow(/exceeds/);
    expect(TELEGRAM_MESSAGE_MAX).toBe(4096);
  });
});

describe("connection tokens", () => {
  it("generates unguessable URL-safe tokens that Telegram accepts as start payloads", () => {
    const a = generateLinkToken();
    const b = generateLinkToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it("stores only a hash that cannot be turned back into the token", () => {
    const token = generateLinkToken();
    expect(hashLinkToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashLinkToken(token)).not.toContain(token);
    expect(hashLinkToken(token)).toBe(hashLinkToken(token));
  });
});

describe("AI output for Telegram", () => {
  it("validates structured output and refuses oversized or empty copy", () => {
    expect(parseCopyOutput('{"subject":"","body":"Hello"}', "telegram")).toEqual({ subject: "", body: "Hello" });
    expect(() => parseCopyOutput(`{"subject":"","body":"${"x".repeat(1600)}"}`, "telegram")).toThrow();
    expect(() => parseCopyOutput('{"subject":"","body":""}', "telegram")).toThrow();
  });
});

describe("integration status", () => {
  const now = new Date("2026-11-03T10:00:00Z");
  it("reports setup needed, configured, tested and unverified for the Telegram card", () => {
    expect(classifyIntegration({ configured: false, providerName: null, missing: ["TELEGRAM_BOT_TOKEN"], check: null, now }).state).toBe("unavailable");
    expect(classifyIntegration({ configured: true, providerName: "the Telegram Bot API", check: null, now }).state).toBe("configured");
    expect(classifyIntegration({ configured: true, providerName: "x", check: { ok: true, checkedAt: new Date("2026-11-02T10:00:00Z"), errorCode: null }, now }).state).toBe("tested");
    expect(classifyIntegration({ configured: true, providerName: "x", check: { ok: false, checkedAt: now, errorCode: "AUTH_REJECTED" }, now }).state).toBe("unverified");
  });
});
