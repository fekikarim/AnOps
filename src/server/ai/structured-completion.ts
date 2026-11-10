import "server-only";
import { ai } from "@/server/ai";
import type { AiCompletionOptions, AiCompletionResult, AiMessage } from "@/server/ai/types";
import { AiProviderError } from "@/server/ai/types";
import { AppError } from "@/shared/lib/errors";

/**
 * One reliable way to ask a model for a JSON object. Used by AI-assisted drafts and by chat.
 *
 *  1. First call is pinned to Groq in JSON mode (the only adapter that honours it).
 *  2. If the provider call itself fails (rate limit, outage, timeout), ONE fallback call goes through
 *     the normal provider chain, so another provider can answer. A request the provider rejected outright
 *     (HTTP 400, typically JSON mode failing) is retried without JSON mode.
 *  3. If the reply is not valid JSON for the expected shape, ONE repair call shows the model its own
 *     reply and asks again.
 *  4. At most three calls in total, then a typed error. Token use from every call is summed.
 *
 * Nothing a provider says is ever returned: failures are classified here and the caller shows its own
 * wording. Logging is by error name only.
 */
export type CompleteFn = (options: AiCompletionOptions) => Promise<AiCompletionResult>;

export type FailureKind = "unreadable" | "busy" | "unavailable";

export class StructuredCompletionError extends Error {
  constructor(
    readonly kind: FailureKind,
    readonly totalTokens: number
  ) {
    super(kind);
    this.name = "StructuredCompletionError";
  }

  /** A person-facing error that leaks nothing about the provider. */
  toAppError(subject = "that"): AppError {
    if (this.kind === "busy") return new AppError("RATE_LIMITED", "The AI service is busy right now. Try again in a minute, or use the manual form.");
    if (this.kind === "unreadable") return new AppError("VALIDATION_ERROR", `I could not understand the AI's answer for ${subject}. Try describing it again, or use the manual form.`);
    return new AppError("INTERNAL", "The AI service is not available right now. Try again shortly, or use the manual form.");
  }
}

const MAX_CALLS = 3;
const REPAIR_NOTE = 'Your previous reply could not be used. Reply again with exactly one valid JSON object in the format described, and nothing else.';

function classify(error: unknown): FailureKind {
  if (error instanceof AiProviderError && error.retryable) return "busy";
  return "unavailable";
}

export type StructuredOptions<T> = {
  messages: AiMessage[];
  maxTokens: number;
  temperature?: number;
  parse: (text: string) => T | null;
  complete?: CompleteFn;
  /** Where to log from, for example "draft". */
  label: string;
};

export async function completeStructured<T>(options: StructuredOptions<T>): Promise<{ value: T; totalTokens: number; provider: string }> {
  const complete: CompleteFn = options.complete ?? ((o) => ai.complete(o));
  let messages = options.messages;
  let tokens = 0;
  let pinned = true;
  let jsonMode = true;
  let repaired = false;
  let lastFailure: FailureKind = "unavailable";

  for (let call = 0; call < MAX_CALLS; call++) {
    let result: AiCompletionResult;
    try {
      result = await complete({
        messages,
        maxTokens: options.maxTokens,
        temperature: options.temperature ?? 0.1,
        jsonObject: jsonMode,
        // Extraction and routing need no deep reasoning; hidden thinking would count against the small reply budget.
        economy: true,
        ...(pinned ? { provider: "groq" } : {}),
      });
    } catch (error) {
      lastFailure = classify(error);
      console.error(`[ai] ${options.label} provider call failed: ${error instanceof Error ? error.name : "unknown"}`);
      if (error instanceof AiProviderError && error.retryable) {
        // Rate limit or outage: one fallback through the normal provider chain, then stop.
        if (!pinned) break;
        pinned = false;
        continue;
      }
      // The provider REJECTED the request. With JSON mode that is usually the model failing to produce valid JSON
      // (or reaching for a native tool call), which is chance rather than a fault in the request. Try the other
      // mode: prompt-only JSON, then JSON mode again, within the same three-call bound.
      jsonMode = !jsonMode;
      pinned = false;
      continue;
    }
    tokens += result.usage?.totalTokens ?? 0;
    const value = options.parse(result.text);
    if (value !== null) return { value, totalTokens: tokens, provider: result.provider };

    lastFailure = "unreadable";
    if (repaired) break;
    repaired = true;
    messages = [...options.messages, { role: "assistant", content: result.text.slice(0, 500) }, { role: "user", content: REPAIR_NOTE }];
  }
  throw new StructuredCompletionError(lastFailure, tokens);
}
