import { afterEach, describe, expect, it, vi } from "vitest";
import { validSmsSender, parseAllowlist } from "@/server/marketing/providers/brevo/config";
import { sendBrevoEmail, sendBrevoSms } from "@/server/marketing/providers/brevo/client";
import { createBrevoEmailProvider, createBrevoSmsProvider, smsRecipient } from "@/server/marketing/providers/brevo/adapters";
import { normalizeBrevoEvent } from "@/server/marketing/providers/brevo/events";
import { classifySendFailure } from "@/server/marketing/dispatch";
import { ProviderError } from "@/server/marketing/providers/types";
import type { BrevoConfig } from "@/server/marketing/providers/brevo/config";

const KEY = "xkeysib-TEST-KEY-NEVER-REAL-000000000000000000000000000000";
const config: BrevoConfig = {
  apiKey: KEY,
  emailSender: { email: "news@example.test", name: "Northwind" },
  smsSender: "Northwind",
  webhookToken: "t".repeat(40),
  emailMarketingApproved: true,
  sendAllowlist: null,
};
const signal = new AbortController().signal;

afterEach(() => vi.unstubAllGlobals());

function stubFetch(response: () => Response | Promise<Response>) {
  const spy = vi.fn(async () => response());
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("sender and recipient rules", () => {
  it("accepts alphanumeric senders up to 11 characters and numeric senders up to 15", () => {
    expect(validSmsSender("Northwind")).toBe("Northwind");
    expect(validSmsSender("216123456789012")).toBe("216123456789012");
    expect(validSmsSender("Northwind-Tunis")).toBeNull();
    expect(validSmsSender("ThisSenderIsTooLong")).toBeNull();
    expect(validSmsSender("")).toBeNull();
  });

  it("normalizes SMS recipients to digits with the country code, and rejects other shapes", () => {
    expect(smsRecipient("+21620123456")).toBe("21620123456");
    expect(() => smsRecipient("20123")).toThrow(ProviderError);
    expect(() => smsRecipient("+216 call me")).toThrow(ProviderError);
  });

  it("parses the controlled-recipient allowlist", () => {
    expect(parseAllowlist(undefined)).toBeNull();
    expect(parseAllowlist(" A@x.test, +21620123456 ")).toEqual(["a@x.test", "+21620123456"]);
  });
});

describe("adapter gating (unconfigured channels are not offered)", () => {
  it("offers no SMS adapter without a sender or without a webhook token", () => {
    expect(createBrevoSmsProvider({ ...config, smsSender: null })).toBeNull();
    expect(createBrevoSmsProvider({ ...config, webhookToken: null })).toBeNull();
    expect(createBrevoSmsProvider(config)?.channel).toBe("sms");
  });

  it("offers no email adapter until marketing use is explicitly approved", () => {
    expect(createBrevoEmailProvider({ ...config, emailMarketingApproved: false })).toBeNull();
    expect(createBrevoEmailProvider({ ...config, emailSender: null })).toBeNull();
    expect(createBrevoEmailProvider(config)?.channel).toBe("email");
  });

  it("refuses non-allowlisted recipients before any request is made", async () => {
    const spy = stubFetch(() => new Response("{}", { status: 201 }));
    const provider = createBrevoSmsProvider({ ...config, sendAllowlist: ["+21620123456"] });
    await expect(
      provider!.send({ idempotencyKey: "d1", to: "+21699999999", subject: "", text: "hi", html: null }, { signal })
    ).rejects.toMatchObject({ code: "NOT_ALLOWLISTED", retryable: false });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("Brevo client", () => {
  it("sends the api-key header and returns the SMS messageId as a string", async () => {
    const spy = stubFetch(() => Response.json({ messageId: 1511882900100020 }, { status: 201 }));
    const id = await sendBrevoSms(KEY, { sender: "Northwind", recipient: "21620123456", content: "hi", webUrl: "https://x.test/h", tag: "t" }, signal);
    expect(id).toBe("1511882900100020");
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.brevo.com/v3/transactionalSMS/send");
    expect((init.headers as Record<string, string>)["api-key"]).toBe(KEY);
    expect(JSON.parse(String(init.body)).type).toBe("marketing");
  });

  it("returns the email messageId from the documented endpoint", async () => {
    const spy = stubFetch(() => Response.json({ messageId: "<201798300811.5787683@relay.test>" }, { status: 201 }));
    const id = await sendBrevoEmail(KEY, { sender: { email: "a@b.test", name: "A" }, to: [{ email: "c@d.test" }], subject: "s", textContent: "t", tags: [] }, signal);
    expect(id).toBe("<201798300811.5787683@relay.test>");
    expect((spy.mock.calls[0] as unknown as [string])[0]).toBe("https://api.brevo.com/v3/smtp/email");
  });

  it("classifies HTTP 429 as not processed (retryable)", async () => {
    stubFetch(() => new Response("slow down", { status: 429 }));
    await expect(sendBrevoSms(KEY, { sender: "N", recipient: "21620123456", content: "x", webUrl: "u", tag: "t" }, signal))
      .rejects.toMatchObject({ code: "RATE_LIMITED", retryable: true });
  });

  it("classifies 5xx and network failures as possibly processed (not retryable)", async () => {
    stubFetch(() => new Response("boom", { status: 503 }));
    await expect(sendBrevoEmail(KEY, { sender: { email: "a@b.test", name: "A" }, to: [{ email: "c@d.test" }], subject: "s", textContent: "t", tags: [] }, signal))
      .rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", retryable: false });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("socket hang up"); }));
    await expect(sendBrevoSms(KEY, { sender: "N", recipient: "21620123456", content: "x", webUrl: "u", tag: "t" }, signal))
      .rejects.toMatchObject({ code: "NETWORK_OR_TIMEOUT", retryable: false });
  });

  it("classifies 400 and 401 as definite rejections", async () => {
    stubFetch(() => new Response("bad", { status: 400 }));
    await expect(sendBrevoSms(KEY, { sender: "N", recipient: "21620123456", content: "x", webUrl: "u", tag: "t" }, signal))
      .rejects.toMatchObject({ code: "REQUEST_REJECTED", retryable: false });
    stubFetch(() => new Response("no", { status: 401 }));
    await expect(sendBrevoSms(KEY, { sender: "N", recipient: "21620123456", content: "x", webUrl: "u", tag: "t" }, signal))
      .rejects.toMatchObject({ code: "AUTH_REJECTED" });
  });

  it("never echoes the response body, the request body or the key into an error", async () => {
    stubFetch(() => new Response(`echo ${KEY} +21620123456 secret-body`, { status: 400 }));
    try {
      await sendBrevoSms(KEY, { sender: "N", recipient: "21620123456", content: "x", webUrl: "u", tag: "t" }, signal);
      throw new Error("expected failure");
    } catch (error) {
      const text = `${(error as Error).message} ${(error as Error).name}`;
      expect(text).not.toContain(KEY);
      expect(text).not.toContain("secret-body");
      expect(text).not.toContain("21620123456");
    }
  });

  it("rejects a reply whose messageId is missing", async () => {
    stubFetch(() => Response.json({ ok: true }, { status: 201 }));
    await expect(sendBrevoSms(KEY, { sender: "N", recipient: "21620123456", content: "x", webUrl: "u", tag: "t" }, signal))
      .rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});

describe("send failure classification (duplicate-send safety)", () => {
  it("retries only when the provider did not process the request", () => {
    expect(classifySendFailure(new ProviderError("RATE_LIMITED", "x", true), false, true)).toEqual({ kind: "retry", code: "RATE_LIMITED" });
  });
  it("fails ambiguous outcomes instead of retrying them", () => {
    expect(classifySendFailure(new ProviderError("PROVIDER_UNAVAILABLE", "x", false), false, true).code).toBe("AMBIGUOUS_SEND");
    expect(classifySendFailure(new Error("socket reset"), false, true).code).toBe("AMBIGUOUS_SEND");
    // A timeout that fires after a retryable error must still not be retried.
    expect(classifySendFailure(new ProviderError("RATE_LIMITED", "x", true), true, true).code).toBe("AMBIGUOUS_SEND");
  });
  it("fails definite rejections without retrying", () => {
    expect(classifySendFailure(new ProviderError("REQUEST_REJECTED", "x", false), false, true)).toEqual({ kind: "fail", code: "REQUEST_REJECTED" });
  });
  it("fails content errors that happen before the provider is called", () => {
    expect(classifySendFailure(new Error("too long"), false, false)).toEqual({ kind: "fail", code: "CONTENT_INVALID" });
  });
});

describe("Brevo event normalization", () => {
  it("maps email transactional events, and dedupes identical events to one id", () => {
    const event = { event: "hard_bounce", "message-id": "<m1@relay>", email: "a@b.test", ts_event: 1790000000, id: 5 };
    const first = normalizeBrevoEvent(event);
    const second = normalizeBrevoEvent({ ...event });
    expect(first).toMatchObject({ kind: "delivery", input: { type: "bounced", providerMessageId: "<m1@relay>" } });
    expect(first).toEqual(second);
  });

  it("maps spam, opens, clicks and unsubscribes", () => {
    expect(normalizeBrevoEvent({ event: "spam", "message-id": "<m>" })).toMatchObject({ input: { type: "complained" } });
    expect(normalizeBrevoEvent({ event: "unique_opened", "message-id": "<m>" })).toMatchObject({ input: { type: "opened" } });
    expect(normalizeBrevoEvent({ event: "click", "message-id": "<m>" })).toMatchObject({ input: { type: "clicked" } });
    expect(normalizeBrevoEvent({ event: "unsubscribed", "message-id": "<m>" })).toMatchObject({ kind: "unsubscribed", providerMessageId: "<m>" });
  });

  it("maps SMS events by status and ignores unknown or incomplete payloads", () => {
    expect(normalizeBrevoEvent({ messageId: 42, status: "delivered", id: 1 })).toMatchObject({ kind: "delivery", input: { type: "delivered", providerMessageId: "42" } });
    expect(normalizeBrevoEvent({ messageId: 42, status: "someUnknownStatus" })).toEqual({ kind: "ignored" });
    expect(normalizeBrevoEvent({ event: "soft_bounce", "message-id": "<m>" })).toEqual({ kind: "ignored" });
    expect(normalizeBrevoEvent(["not", "an", "event"])).toEqual({ kind: "ignored" });
    expect(normalizeBrevoEvent({ event: "delivered" })).toEqual({ kind: "ignored" });
  });

  it("does not take a company from the payload", () => {
    const normalized = normalizeBrevoEvent({ event: "delivered", "message-id": "<m>", companyId: "64b000000000000000000001" });
    expect(JSON.stringify(normalized)).not.toContain("companyId");
  });
});
