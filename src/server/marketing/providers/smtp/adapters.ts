import "server-only";
import { createHash } from "crypto";
import {
  sendSmtpMessage,
  verifySmtpTransport,
  type SmtpMessageInput,
  type SmtpMessageResult,
} from "@/server/email/client";
import { ProviderError, type MessageProvider, type OutboundMessage } from "@/server/marketing/providers/types";
import { getSmtpState, mailboxAddress, type SmtpConfig } from "@/server/marketing/providers/smtp/config";

/**
 * Gmail/SMTP marketing adapter.
 *
 * It shares the low-level transport with authentication mail but contains its own
 * marketing policy: recipient validation, a controlled-recipient allowlist,
 * deterministic Message-IDs, conservative pacing and SMTP error classification.
 * It never renders or imports authentication templates.
 */

/** Gmail accepts far more than this, but a conservative pace keeps one worker from bursting. */
export const SMTP_MIN_INTERVAL_MS = 1_000;
export const SMTP_MESSAGE_TIMEOUT_MS = 15_000;
const MAX_SUBJECT_LENGTH = 998;

type SmtpSender = (input: SmtpMessageInput) => Promise<SmtpMessageResult>;

export function deterministicMessageId(idempotencyKey: string, fromAddress: string): string {
  const domain = fromAddress.split("@")[1] || "localhost";
  const digest = createHash("sha256").update(`anops.marketing.email:${idempotencyKey}`).digest("hex").slice(0, 32);
  return `<${digest}@${domain}>`;
}

/** A recipient must be a bare address. Display-name forms are rejected, not silently rewritten. */
export function normalizeEmailRecipient(raw: string): string {
  if (/[<>]/.test(raw)) {
    throw new ProviderError("INVALID_DESTINATION", "The recipient email address is not valid.", false);
  }
  const address = mailboxAddress(raw);
  if (!address) {
    throw new ProviderError("INVALID_DESTINATION", "The recipient email address is not valid.", false);
  }
  return address;
}

/** Rejects empty or header-injecting content before any SMTP connection is opened. */
export function validateEmailContent(message: OutboundMessage): { subject: string; text: string; html: string | undefined } {
  const subject = message.subject.replace(/\r?\n/g, " ").trim();
  if (subject === "") {
    throw new ProviderError("CONTENT_INVALID", "The email subject is empty.", false);
  }
  if (subject.length > MAX_SUBJECT_LENGTH) {
    throw new ProviderError("CONTENT_INVALID", "The email subject is too long.", false);
  }
  if (/[\r\n]/.test(message.subject) || /[\r\n]/.test(message.to)) {
    throw new ProviderError("CONTENT_INVALID", "The email contains an invalid line break.", false);
  }
  if (message.text.trim() === "") {
    throw new ProviderError("CONTENT_INVALID", "The email body is empty.", false);
  }
  return { subject, text: message.text, html: message.html ?? undefined };
}

function assertAllowed(allowlist: string[] | null, destination: string): void {
  if (allowlist && !allowlist.includes(destination.toLowerCase())) {
    throw new ProviderError("NOT_ALLOWLISTED", "This recipient is not on the controlled-recipient list.", false);
  }
}

type SmtpErrorShape = {
  code?: string;
  responseCode?: number;
  response?: string;
};

/**
 * Maps nodemailer/SMTP failures onto the dispatcher's contract:
 * - `retryable: true` only when the server certainly did not accept the message
 *   (SMTP 4xx, or a connection that was never established).
 * - Permanent SMTP rejections fail immediately.
 * - Timeouts and mid-stream disconnects are ambiguous and must not be retried.
 * Messages never contain the password, the request body or the response body.
 */
export function smtpErrorToProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  const shape = (error ?? {}) as SmtpErrorShape;
  const code = typeof shape.code === "string" ? shape.code : "";
  const responseCode = typeof shape.responseCode === "number" ? shape.responseCode : undefined;

  if (responseCode !== undefined) {
    if (responseCode === 421 || responseCode === 450 || responseCode === 451 || responseCode === 452 || responseCode === 454) {
      return new ProviderError("SMTP_TEMPORARY_FAILURE", `The SMTP server asked us to retry later (${responseCode}).`, true);
    }
    if (responseCode >= 500) {
      if (responseCode >= 530 && responseCode <= 539) {
        return new ProviderError("SMTP_AUTH_REJECTED", `The SMTP server rejected authentication (${responseCode}).`, false);
      }
      if (responseCode >= 550 && responseCode <= 559) {
        return new ProviderError("SMTP_RECIPIENT_REJECTED", `The SMTP server rejected the recipient (${responseCode}).`, false);
      }
      return new ProviderError("SMTP_REJECTED", `The SMTP server rejected the message (${responseCode}).`, false);
    }
    if (responseCode >= 400) {
      return new ProviderError("SMTP_TEMPORARY_FAILURE", `The SMTP server could not accept the message yet (${responseCode}).`, true);
    }
  }

  switch (code) {
    case "EAUTH":
      return new ProviderError("AUTH_REJECTED", "The SMTP server rejected the credentials.", false);
    case "EENVELOPE":
      return new ProviderError("REQUEST_REJECTED", "The SMTP server rejected the envelope.", false);
    case "EMESSAGE":
      return new ProviderError("CONTENT_INVALID", "The message could not be encoded.", false);
    case "ECONNREFUSED":
    case "ENOTFOUND":
    case "EAI_AGAIN":
    case "EDNS":
      return new ProviderError("NETWORK_UNAVAILABLE", "The SMTP server could not be reached.", true);
    case "ETIMEDOUT":
    case "ESOCKET":
    case "ECONNECTION":
    case "ECONNRESET":
    case "EPIPE":
      // The message may already have been accepted before the connection broke.
      return new ProviderError("NETWORK_OR_TIMEOUT", "The SMTP request did not complete.", false);
    default:
      return new ProviderError("SMTP_ERROR", "The SMTP server did not confirm acceptance.", false);
  }
}

function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new ProviderError("NETWORK_OR_TIMEOUT", "The SMTP request timed out.", false));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new ProviderError("NETWORK_OR_TIMEOUT", "The SMTP request timed out.", false));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export function createSmtpEmailProvider(
  config: SmtpConfig,
  deps: { send?: SmtpSender } = {}
): MessageProvider {
  const send = deps.send ?? sendSmtpMessage;

  return {
    name: "smtp-email",
    channel: "email",
    minIntervalMs: SMTP_MIN_INTERVAL_MS,
    async send(message: OutboundMessage, options: { signal: AbortSignal }) {
      const to = normalizeEmailRecipient(message.to);
      assertAllowed(config.sendAllowlist, to);
      const content = validateEmailContent(message);

      if (options.signal.aborted) {
        throw new ProviderError("NETWORK_OR_TIMEOUT", "The SMTP request timed out.", false);
      }

      const messageId = deterministicMessageId(message.idempotencyKey, config.fromAddress);
      try {
        const result = await raceWithAbort(
          send({
            to,
            subject: content.subject,
            text: content.text,
            html: content.html,
            messageId,
          }),
          options.signal
        );
        if (result.accepted.length === 0) {
          throw new ProviderError("SMTP_NOT_ACCEPTED", "The SMTP server did not accept the message.", false);
        }
        return { providerMessageId: result.messageId || messageId };
      } catch (error) {
        throw smtpErrorToProviderError(error);
      }
    },
  };
}

export type SmtpVerification = { ok: true } | { ok: false; errorCode: string };

/** Opens and authenticates the SMTP connection without sending a message. */
export async function verifySmtpEmailProvider(): Promise<SmtpVerification> {
  const state = getSmtpState();
  if (!state.configured) return { ok: false, errorCode: "PROVIDER_NOT_CONFIGURED" };
  try {
    await verifySmtpTransport();
    return { ok: true };
  } catch (error) {
    return { ok: false, errorCode: smtpErrorToProviderError(error).code };
  }
}
