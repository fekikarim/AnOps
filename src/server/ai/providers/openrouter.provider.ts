import "server-only";

import type { AiProvider, AiCompletionOptions, AiCompletionResult } from "@/server/ai/types";
import { AiProviderError } from "@/server/ai/types";
import { fromOpenAiToolCalls, toOpenAiMessages, toOpenAiTools } from "@/server/ai/openai-wire";

/**
 * Free models available on OpenRouter (identified by the ":free" suffix).
 * Full list: https://openrouter.ai/models?q=free
 * First entry is the default.
 */
const FREE_MODELS = [
  "nvidia/nemotron-3.5-lightning:free",
  "liquid/lfm-2.5-2.6b:free",
  "thinkingmachines/inkling-small:free",
  "poolside/laguna-s-2.1:free",
  "recursive/flint-v1.0:free",
  "google/gemma-4-26b-a4b-it:free",
];

const REQUEST_TIMEOUT_MS = 20_000;
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1/chat/completions";

export class OpenRouterProvider implements AiProvider {
  readonly name = "OpenRouter";
  readonly freeModels = FREE_MODELS;

  private apiKey: string | undefined;

  constructor() {
    this.apiKey = process.env.OPENROUTER_API_KEY?.trim() || undefined;
  }

  get isAvailable(): boolean {
    return !!this.apiKey;
  }

  async complete(options: AiCompletionOptions): Promise<AiCompletionResult> {
    if (!this.apiKey) {
      throw new AiProviderError(this.name, "OPENROUTER_API_KEY is not set.", false);
    }

    // If a model is specifically meant for another provider, skip OpenRouter
    if (
      options.model &&
      (options.model.startsWith("gemini") ||
        options.model.startsWith("models/") ||
        options.model.startsWith("allam-") ||
        options.model.startsWith("openai/gpt-oss-"))
    ) {
      throw new AiProviderError(this.name, `Model ${options.model} is not supported by OpenRouter`, false);
    }

    const model = options.model ?? FREE_MODELS[0];

    const body = {
      model,
      messages: toOpenAiMessages(options.messages),
      max_tokens: options.maxTokens ?? 1024,
      temperature: options.temperature ?? 0.7,
      ...(options.jsonObject ? { response_format: { type: "json_object" } } : {}),
      // require_parameters makes OpenRouter pick an endpoint that really supports tool calling.
      ...(options.tools?.length
        ? { tools: toOpenAiTools(options.tools), tool_choice: "auto", provider: { require_parameters: true } }
        : {}),
    };

    let response: Response;
    try {
      response = await fetch(OPENROUTER_BASE_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": process.env.NEXTAUTH_URL ?? "http://localhost:3000",
          "X-Title": "AnOps",
        },
        body: JSON.stringify(body),
        // A fallback provider must never hang a request: bounded like the primary, and cancelled with the caller.
        signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new AiProviderError(
        this.name,
        `Network error: ${(err as Error).message}`,
        true
      );
    }

    if (response.status === 429) {
      throw new AiProviderError(this.name, "Rate limited (429).", true);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");

      // If a model override returned 404 (e.g. no longer free), recover with the default free model
      if (response.status === 404 && model !== FREE_MODELS[0]) {
        console.warn(`[OpenRouter] Model "${model}" returned 404, recovering with ${FREE_MODELS[0]}`);
        return await this.complete({ ...options, model: FREE_MODELS[0] });
      }

      throw new AiProviderError(
        this.name,
        `HTTP ${response.status}: ${text.slice(0, 200)}`,
        response.status >= 500
      );
    }

    const json = await response.json() as {
      choices: Array<{
        message: {
          content: string | null;
          tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
        };
      }>;
      model?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    const text = json.choices?.[0]?.message?.content ?? "";
    const toolCalls = fromOpenAiToolCalls(json.choices?.[0]?.message?.tool_calls);
    return {
      text,
      ...(toolCalls ? { toolCalls } : {}),
      provider: this.name,
      model: json.model ?? model,
      usage: {
        promptTokens: json.usage?.prompt_tokens,
        completionTokens: json.usage?.completion_tokens,
        totalTokens: json.usage?.total_tokens,
      },
    };
  }
}
