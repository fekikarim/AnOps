import "server-only";
import type { MarketingChannel } from "@/features/marketing/types/constants";

/**
 * Provider contract types. `ProviderError.retryable` means only one thing: the provider certainly did NOT
 * process the request (for example HTTP 429). Any other failure may mean the message was accepted, so the
 * dispatcher must not retry it automatically.
 */
export class ProviderError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  /** Minimum wait the provider asked for (for example Telegram's retry_after). Dispatch never retries sooner. */
  readonly retryAfterMs: number | null;

  constructor(code: string, message: string, retryable: boolean, retryAfterMs: number | null = null) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

export type OutboundMessage = {
  /** Stable per delivery. Providers that support idempotency keys must use it to deduplicate retries. */
  idempotencyKey: string;
  to: string;
  subject: string;
  text: string;
  html: string | null;
};

export interface MessageProvider {
  readonly name: string;
  readonly channel: MarketingChannel;
  /** Minimum delay between two sends through this provider. This is the provider rate limit. */
  readonly minIntervalMs: number;
  /** Must honour the abort signal. Resolves only when the provider has accepted the message. */
  send(message: OutboundMessage, options: { signal: AbortSignal }): Promise<{ providerMessageId: string }>;
}

export type MessageProviders = Partial<Record<MarketingChannel, MessageProvider>>;

