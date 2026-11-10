import { describe, expect, it, vi } from "vitest";
import type { SmtpMessageInput, SmtpMessageResult } from "@/server/email/client";
import { ProviderError } from "@/server/marketing/providers/types";
import { parseSmtpState, isValidEmailAddress, mailboxAddress, type SmtpConfig } from "@/server/marketing/providers/smtp/config";
import {
  createSmtpEmailProvider,
  deterministicMessageId,
  normalizeEmailRecipient,
  smtpErrorToProviderError,
  validateEmailContent,
} from "@/server/marketing/providers/smtp/adapters";
import { selectConfiguredProviders } from "@/server/marketing/providers";
import { classifyIntegration } from "@/server/marketing/integration-status";
import type { BrevoState } from "@/server/marketing/providers/brevo/config";
import type { SmtpState } from "@/server/marketing/providers/smtp/config";

const config: SmtpConfig = {
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  user: "news@example.test",
  password: "app-password",
  from: "Northwind <news@example.test>",
  fromAddress: "news@example.test",
  sendAllowlist: null,
};

const message = {
  idempotencyKey: "delivery-1",
  to: "Customer@Example.TEST",
  subject: "Hello",
  text: "Body",
  html: "<p>Body</p>",
};
const signal = new AbortController().signal;

function smtpState(overrides: Partial<SmtpConfig> = {}): SmtpState {
  return { configured: true, config: { ...config, ...overrides } };
}

function fakeSend(result: Partial<SmtpMessageResult> = {}) {
  return vi.fn(async (input: SmtpMessageInput): Promise<SmtpMessageResult> => {
    void input;
    return {
      messageId: "<server@example.test>",
      response: "250 OK",
      accepted: ["customer@example.test"],
      ...result,
    };
  });
}

const brevoConfigured: BrevoState = {
  configured: true,
  config: {
    apiKey: "xkeysib-TEST",
    emailSender: { email: "news@example.test", name: "Northwind" },
    smsSender: "Northwind",
    webhookToken: "t".repeat(40),
    emailMarketingApproved: true,
    sendAllowlist: null,
  },
};

describe("SMTP configuration", () => {
  it("reports missing host and sender", () => {
    const state = parseSmtpState({});
    expect(state.configured).toBe(false);
    if (state.configured) throw new Error("expected unconfigured");
    expect(state.missing).toEqual(["EMAIL_SERVER_HOST", "EMAIL_FROM"]);
  });

  it("rejects a URL host, an invalid sender and half-configured credentials", () => {
    const state = parseSmtpState({
      host: "smtp://smtp.gmail.com",
      port: 0,
      user: "news@example.test",
      password: "",
      from: "not-an-address",
    });
    expect(state.configured).toBe(false);
    if (state.configured) throw new Error("expected unconfigured");
    expect(state.missing.join(" ")).toContain("EMAIL_SERVER_HOST");
    expect(state.missing.join(" ")).toContain("EMAIL_SERVER_PORT");
    expect(state.missing.join(" ")).toContain("EMAIL_SERVER_PASSWORD");
    expect(state.missing.join(" ")).toContain("EMAIL_FROM");
  });

  it("accepts a complete configuration and parses the allowlist", () => {
    const state = parseSmtpState({
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      user: "news@example.test",
      password: "secret",
      from: "Northwind <news@example.test>",
      sendAllowlist: " A@Example.test , +21620123456 ",
    });
    expect(state.configured).toBe(true);
    if (!state.configured) throw new Error("expected configured");
    expect(state.config.fromAddress).toBe("news@example.test");
    expect(state.config.sendAllowlist).toEqual(["a@example.test", "+21620123456"]);
  });

  it("validates addresses and extracts mailboxes without accepting header injection", () => {
    expect(isValidEmailAddress("a.b+tag@example.test")).toBe(true);
    expect(isValidEmailAddress("a@b")).toBe(false);
    expect(isValidEmailAddress("a@@example.test")).toBe(false);
    expect(isValidEmailAddress("a\r\nBcc: x@y.test")).toBe(false);
    expect(mailboxAddress("Northwind <news@example.test>")).toBe("news@example.test");
    expect(mailboxAddress("bad <news@example.test>\r\nBcc: x@y.test")).toBeNull();
  });
});

describe("message validation", () => {
  it("rejects display-name recipients and malformed addresses before any connection", () => {
    expect(() => normalizeEmailRecipient("Customer <customer@example.test>")).toThrow(ProviderError);
    expect(() => normalizeEmailRecipient("not-an-address")).toThrow(ProviderError);
    expect(normalizeEmailRecipient("Customer@Example.TEST")).toBe("customer@example.test");
  });

  it("rejects empty content and header injection", () => {
    expect(() => validateEmailContent({ ...message, subject: "   " })).toThrow(ProviderError);
    expect(() => validateEmailContent({ ...message, text: "  " })).toThrow(ProviderError);
    expect(() => validateEmailContent({ ...message, subject: "Hello\r\nBcc: x@y.test" })).toThrow(ProviderError);
  });

  it("derives the same Message-ID for a retry and a different one for another delivery", () => {
    const first = deterministicMessageId("delivery-1", "news@example.test");
    expect(first).toBe(deterministicMessageId("delivery-1", "news@example.test"));
    expect(first).not.toBe(deterministicMessageId("delivery-2", "news@example.test"));
    expect(first.endsWith("@example.test>")).toBe(true);
  });
});

describe("SMTP adapter", () => {
  it("returns the provider message id and sends normalised content", async () => {
    const send = fakeSend();
    const provider = createSmtpEmailProvider(config, { send });
    const result = await provider.send(message, { signal });
    expect(result.providerMessageId).toBe("<server@example.test>");
    expect(provider.name).toBe("smtp-email");
    expect(provider.channel).toBe("email");
    const input = send.mock.calls[0][0];
    expect(input.to).toBe("customer@example.test");
    expect(input.subject).toBe("Hello");
    expect(input.messageId).toBe(deterministicMessageId("delivery-1", "news@example.test"));
  });

  it("uses the deterministic Message-ID when the transport does not return one", async () => {
    const provider = createSmtpEmailProvider(config, { send: fakeSend({ messageId: "" }) });
    const result = await provider.send(message, { signal });
    expect(result.providerMessageId).toBe(deterministicMessageId("delivery-1", "news@example.test"));
  });

  it("treats an envelope with no accepted recipient as not accepted", async () => {
    const provider = createSmtpEmailProvider(config, { send: fakeSend({ accepted: [] }) });
    await expect(provider.send(message, { signal })).rejects.toMatchObject({ code: "SMTP_NOT_ACCEPTED", retryable: false });
  });

  it("refuses a non-allowlisted recipient without calling the transport", async () => {
    const send = fakeSend();
    const provider = createSmtpEmailProvider({ ...config, sendAllowlist: ["someone@example.test"] }, { send });
    await expect(provider.send(message, { signal })).rejects.toMatchObject({ code: "NOT_ALLOWLISTED" });
    expect(send).not.toHaveBeenCalled();
  });

  it("does not call the transport when the signal is already aborted", async () => {
    const send = fakeSend();
    const provider = createSmtpEmailProvider(config, { send });
    const controller = new AbortController();
    controller.abort();
    await expect(provider.send(message, { signal: controller.signal })).rejects.toMatchObject({ code: "NETWORK_OR_TIMEOUT" });
    expect(send).not.toHaveBeenCalled();
  });

  it("wraps transport failures in a classified ProviderError", async () => {
    const provider = createSmtpEmailProvider(config, {
      send: async () => {
        throw Object.assign(new Error("mailbox unavailable"), { responseCode: 550 });
      },
    });
    await expect(provider.send(message, { signal })).rejects.toMatchObject({ code: "SMTP_RECIPIENT_REJECTED", retryable: false });
  });
});

describe("SMTP error classification", () => {
  it("retries only temporary SMTP failures and unreachable servers", () => {
    expect(smtpErrorToProviderError({ responseCode: 451 })).toMatchObject({ code: "SMTP_TEMPORARY_FAILURE", retryable: true });
    expect(smtpErrorToProviderError({ responseCode: 421 })).toMatchObject({ retryable: true });
    expect(smtpErrorToProviderError({ code: "ECONNREFUSED" })).toMatchObject({ code: "NETWORK_UNAVAILABLE", retryable: true });
    expect(smtpErrorToProviderError({ code: "ENOTFOUND" })).toMatchObject({ retryable: true });
  });

  it("treats permanent rejections as final", () => {
    expect(smtpErrorToProviderError({ responseCode: 535 })).toMatchObject({ code: "SMTP_AUTH_REJECTED", retryable: false });
    expect(smtpErrorToProviderError({ responseCode: 550 })).toMatchObject({ code: "SMTP_RECIPIENT_REJECTED", retryable: false });
    expect(smtpErrorToProviderError({ responseCode: 500 })).toMatchObject({ code: "SMTP_REJECTED", retryable: false });
    expect(smtpErrorToProviderError({ code: "EAUTH" })).toMatchObject({ code: "AUTH_REJECTED", retryable: false });
    expect(smtpErrorToProviderError({ code: "EENVELOPE" })).toMatchObject({ code: "REQUEST_REJECTED", retryable: false });
  });

  it("treats timeouts and disconnects as ambiguous, never retryable", () => {
    expect(smtpErrorToProviderError({ code: "ETIMEDOUT" })).toMatchObject({ code: "NETWORK_OR_TIMEOUT", retryable: false });
    expect(smtpErrorToProviderError({ code: "ECONNRESET" })).toMatchObject({ retryable: false });
    expect(smtpErrorToProviderError(new Error("unknown"))).toMatchObject({ code: "SMTP_ERROR", retryable: false });
  });

  it("passes an already-classified ProviderError through unchanged", () => {
    const original = new ProviderError("RATE_LIMITED", "slow down", true);
    expect(smtpErrorToProviderError(original)).toBe(original);
  });
});

describe("provider registry", () => {
  it("prefers SMTP for email when it is configured", () => {
    const providers = selectConfiguredProviders(smtpState(), brevoConfigured);
    expect(providers.email?.name).toBe("smtp-email");
    expect(providers.sms?.name).toBe("brevo-sms");
  });

  it("falls back to Brevo email only when SMTP is unavailable", () => {
    const providers = selectConfiguredProviders({ configured: false, missing: ["EMAIL_SERVER_HOST"], reason: "missing" }, brevoConfigured);
    expect(providers.email?.name).toBe("brevo-email");
    expect(providers.sms?.name).toBe("brevo-sms");
  });

  it("offers nothing when neither configuration is complete", () => {
    const providers = selectConfiguredProviders(
      { configured: false, missing: ["EMAIL_SERVER_HOST"], reason: "missing" },
      { configured: false, missing: ["BREVO_API_key"], reason: "missing" }
    );
    expect(providers).toEqual({});
  });
});

describe("integration status reporting", () => {
  const now = new Date("2026-10-26T12:00:00.000Z");

  it("reports unavailable when the provider is not configured", () => {
    expect(classifyIntegration({ configured: false, providerName: null, missing: ["EMAIL_SERVER_HOST"], check: null, now })).toMatchObject({
      state: "unavailable",
      missing: ["EMAIL_SERVER_HOST"],
    });
  });

  it("reports configured when no test has been recorded", () => {
    expect(classifyIntegration({ configured: true, providerName: "smtp-email", check: null, now }).state).toBe("configured");
  });

  it("reports tested only for a recent successful check", () => {
    expect(
      classifyIntegration({
        configured: true,
        providerName: "smtp-email",
        check: { ok: true, checkedAt: new Date("2026-10-25T12:00:00.000Z"), errorCode: null },
        now,
      }).state
    ).toBe("tested");
  });

  it("reports unverified after a failed or stale check", () => {
    expect(
      classifyIntegration({
        configured: true,
        providerName: "smtp-email",
        check: { ok: false, checkedAt: new Date("2026-10-25T12:00:00.000Z"), errorCode: "AUTH_REJECTED" },
        now,
      }).state
    ).toBe("unverified");
    expect(
      classifyIntegration({
        configured: true,
        providerName: "smtp-email",
        check: { ok: true, checkedAt: new Date("2026-09-01T12:00:00.000Z"), errorCode: null },
        now,
      }).state
    ).toBe("unverified");
  });
});
