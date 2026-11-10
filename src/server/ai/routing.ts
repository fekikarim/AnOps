import "server-only";

import { aiDisabledProviders, aiRouteOverride } from "@/server/ai/config";
import type {
  AiChatOptions,
  AiChatResult,
  AiCompletionResult,
  AiProvider,
  AiProviderFallback,
  AiTaskType,
} from "@/server/ai/types";
import { AiProviderError } from "@/server/ai/types";

/** Default provider order per task. Override with AI_ROUTE_COPILOT_CHAT, AI_ROUTE_ADVISOR_JSON, AI_ROUTE_POLICY_QA. */
const DEFAULT_ROUTES: Record<AiTaskType, string[]> = {
  copilot_chat: ["groq", "openrouter", "gemini"],
  advisor_json: ["gemini", "groq", "openrouter"],
  policy_qa: ["gemini", "groq", "openrouter"],
};

const DEFAULT_TIMEOUT_MS = 25_000;
/** Attempts per provider: the first try plus one retry. */
const ATTEMPTS_PER_PROVIDER = 2;

/** Orders the configured providers for a task. A provider the caller explicitly prefers goes first. */
export function resolveChain(providers: AiProvider[], taskType: AiTaskType, preferred?: string): AiProvider[] {
  const disabled = aiDisabledProviders();
  const order = aiRouteOverride(taskType) ?? DEFAULT_ROUTES[taskType];
  const wanted = preferred && preferred !== "auto" ? [preferred.toLowerCase(), ...order] : order;

  const chain: AiProvider[] = [];
  for (const name of wanted) {
    const provider = providers.find((p) => p.name.toLowerCase() === name);
    if (provider && provider.isAvailable && !disabled.includes(name) && !chain.includes(provider)) {
      chain.push(provider);
    }
  }
  return chain;
}

/**
 * Runs a completion along the task's provider chain.
 * Timeouts, 429/5xx and empty or malformed responses move to the next provider.
 *
 * @throws Error when every provider in the chain fails.
 */
export async function routeChat(providers: AiProvider[], options: AiChatOptions): Promise<AiChatResult> {
  const { taskType, timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = options;
  const chain = resolveChain(providers, taskType, rest.provider);
  if (chain.length === 0) {
    throw new Error(`[AiRouter] No AI provider is available for task "${taskType}".`);
  }

  const started = Date.now();
  const fallbacks: AiProviderFallback[] = [];

  for (const [index, provider] of chain.entries()) {
    // A model id belongs to one provider, so only the first provider in the chain receives it.
    const attemptOptions = { ...rest, provider: undefined, model: index === 0 ? rest.model : undefined };

    for (let attempt = 1; attempt <= ATTEMPTS_PER_PROVIDER; attempt++) {
      try {
        const result = await withTimeout(provider.complete(attemptOptions), timeoutMs, provider.name);
        assertUsable(result, provider.name);
        return { ...result, latencyMs: Date.now() - started, fallbacks };
      } catch (err) {
        const reason = classifyFailure(err);
        // A rate limit will not clear in a moment, so that provider is not retried.
        const retryable = err instanceof AiProviderError && err.retryable && reason !== "rate_limited";
        if (retryable && attempt < ATTEMPTS_PER_PROVIDER) continue;
        const detail = err instanceof Error ? err.message.match(/HTTP \d{3}(?:, [a-z0-9_]+)?/i)?.[0] : undefined;
        console.warn(`[AiRouter] ${provider.name} failed for ${taskType}: ${reason}${detail ? ` (${detail})` : ""}`);
        fallbacks.push({ provider: provider.name, reason });
        break;
      }
    }
  }

  throw new Error(
    `[AiRouter] All providers failed for "${taskType}": ${fallbacks.map((f) => `${f.provider} (${f.reason})`).join(", ")}`
  );
}

function assertUsable(result: AiCompletionResult, providerName: string): void {
  if (!result.text.trim() && !result.toolCalls?.length) {
    throw new AiProviderError(providerName, "Invalid response: empty", true);
  }
  for (const call of result.toolCalls ?? []) {
    try {
      JSON.parse(call.arguments);
    } catch {
      throw new AiProviderError(providerName, "Invalid response: malformed tool arguments", true);
    }
  }
}

function withTimeout<T>(work: Promise<T>, ms: number, providerName: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AiProviderError(providerName, "Timed out", false)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** Maps a failure to a fixed reason. Provider messages can echo request content, so they are never kept. */
function classifyFailure(err: unknown): AiProviderFallback["reason"] {
  const message = err instanceof Error ? err.message : "";
  if (/timed out|timeout/i.test(message)) return "timeout";
  if (/429|rate.?limit|resource_exhausted/i.test(message)) return "rate_limited";
  if (/invalid response|malformed/i.test(message)) return "invalid_response";
  return "provider_error";
}
