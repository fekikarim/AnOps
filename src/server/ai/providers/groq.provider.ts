import "server-only";

import Groq from "groq-sdk";
import type { ChatCompletion } from "groq-sdk/resources/chat/completions";
import { KeyPool } from "@/server/ai/key-pool";
import { groqApiKeyList } from "@/server/ai/config";
import { fromOpenAiToolCalls, toOpenAiMessages, toOpenAiTools } from "@/server/ai/openai-wire";
import type { AiAttachment, AiProvider, AiCompletionOptions, AiCompletionResult } from "@/server/ai/types";
import { AiProviderError } from "@/server/ai/types";

/**
 * Free Groq models.
 * First entry is the default. Full list: https://console.groq.com/docs/models
 */
const FREE_MODELS = [
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "qwen/qwen3.8-27b",
  "allam-2-7b",
];

/** Total attempts per call across keys and transient failures. */
const MAX_ATTEMPTS = 3;
/** Per-request ceiling. The SDK's own retries are disabled; this class owns retry policy. */
const REQUEST_TIMEOUT_MS = 20_000;
const BACKOFF_BASE_MS = 300;

/** Groq vision: images only (no PDF), and Groq caps a base64 image request at 4 MB. */
// Checked live on 2026-11-07: the llama-4 vision models are gone from Groq; Qwen 3.8 reads images.
const VISION_MODEL = process.env.GROQ_VISION_MODEL || "qwen/qwen3.8-27b";
const VISION_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_VISION_BASE64 = 4 * 1024 * 1024;

const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_TEMPERATURE = 0.7;

type ChatResult = Pick<AiCompletionResult, "text" | "model" | "usage" | "toolCalls">;
type GroqCreateParams = Parameters<Groq["chat"]["completions"]["create"]>[0];

export class GroqProvider implements AiProvider {
  readonly name = "Groq";
  readonly freeModels = FREE_MODELS;

  private pool: KeyPool;

  constructor() {
    this.pool = new KeyPool(groqApiKeyList());
  }

  get isAvailable(): boolean {
    return this.pool.hasKeys;
  }

  supportsAttachments(attachments: AiAttachment[]): boolean {
    const total = attachments.reduce((n, a) => n + a.dataBase64.length, 0);
    return attachments.length <= 5 && total <= MAX_VISION_BASE64 && attachments.every((a) => VISION_MIME.has(a.mimeType));
  }

  async complete(options: AiCompletionOptions): Promise<AiCompletionResult> {
    // If a non-Groq model was explicitly requested, bail early so the router reaches the right provider
    if (
      options.model &&
      (options.model.includes(":free") ||
        options.model.startsWith("gemini") ||
        options.model.startsWith("models/") ||
        options.model.startsWith("nvidia/"))
    ) {
      throw new AiProviderError(this.name, `Model ${options.model} is not supported by Groq`, false);
    }

    const hasAttachments = options.messages.some((m) => m.attachments?.length);
    const model = options.model ?? (hasAttachments ? VISION_MODEL : FREE_MODELS[0]);
    let lastFailure = "no attempt made";

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (options.signal?.aborted) throw new AiProviderError(this.name, "Request cancelled", false);
      let apiKey: string;
      try {
        apiKey = this.pool.next();
      } catch (err) {
        // All keys exhausted: transient, the caller may retry later.
        throw new AiProviderError(this.name, (err as Error).message, true);
      }

      const client = new Groq({ apiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: 0 });

      let response: ChatCompletion;
      try {
        response = (await client.chat.completions.create(buildRequest(model, options), options.signal ? { signal: options.signal } : undefined)) as ChatCompletion;
      } catch (err: unknown) {
        const status = errorStatus(err);

        if (status === 429) {
          // Rate-limited: cool this key down and rotate immediately.
          this.pool.markRateLimited(apiKey);
          lastFailure = "rate limited";
          console.warn(`[Groq] 429 on key ...${apiKey.slice(-6)}, rotating (attempt ${attempt + 1}/${MAX_ATTEMPTS})`);
          continue;
        }

        if (isTransient(err, status)) {
          // Timeouts, network errors and 5xx are retried with a short backoff.
          lastFailure = status ? `HTTP ${status}` : "network or timeout";
          await sleep(BACKOFF_BASE_MS * 2 ** attempt);
          continue;
        }

        // If the model was not found (404) and was an override, try the default free model once.
        if (status === 404 && model !== FREE_MODELS[0] && !hasAttachments) {
          console.warn(`[Groq] Model "${model}" not found (404), recovering with ${FREE_MODELS[0]}`);
          try {
            const fallback = (await client.chat.completions.create(buildRequest(FREE_MODELS[0], options))) as ChatCompletion;
            return { ...toResult(fallback, FREE_MODELS[0]), provider: this.name };
          } catch (fallbackErr: unknown) {
            throw new AiProviderError(this.name, `API error (HTTP ${errorStatus(fallbackErr) ?? "unknown"})`, false);
          }
        }

        // Non-retryable. Never forward the provider's message: it can echo request content.
        // The error code is a fixed identifier, so it is safe to keep for diagnosis.
        const code = errorCode(err);
        throw new AiProviderError(this.name, `API error (HTTP ${status ?? "unknown"}${code ? `, ${code}` : ""})`, false);
      }

      return { ...toResult(response, model), provider: this.name };
    }

    throw new AiProviderError(this.name, `All attempts exhausted: ${lastFailure}`, true);
  }
}

function buildRequest(model: string, options: AiCompletionOptions): GroqCreateParams {
  return {
    model,
    messages: toOpenAiMessages(options.messages),
    max_completion_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: options.temperature ?? DEFAULT_TEMPERATURE,
    ...(options.jsonObject ? { response_format: { type: "json_object" as const } } : {}),
    ...(options.economy && model.startsWith("openai/gpt-oss") ? { reasoning_effort: "low" as const } : {}),
    // Qwen 3.x reasons by default; "none" answers in about half the time with the same reading of a receipt.
    ...(options.economy && model.startsWith("qwen/") ? { reasoning_effort: "none" } : {}),
    ...(options.tools?.length ? { tools: toOpenAiTools(options.tools), tool_choice: "auto" as const } : {}),
  } as GroqCreateParams;
}

/** Validates the provider response before it is trusted. A malformed response is a non-retryable failure. */
function toResult(response: ChatCompletion, model: string): ChatResult {
  const message = response.choices?.[0]?.message;
  const toolCalls = fromOpenAiToolCalls(message?.tool_calls);
  const content = message?.content;
  if (typeof content !== "string" && !toolCalls) {
    throw new AiProviderError("Groq", "Malformed response: no message content", false);
  }
  return {
    text: content ?? "",
    ...(toolCalls ? { toolCalls } : {}),
    model,
    usage: {
      promptTokens: response.usage?.prompt_tokens,
      completionTokens: response.usage?.completion_tokens,
      totalTokens: response.usage?.total_tokens,
    },
  };
}

function errorCode(err: unknown): string | undefined {
  const code = (err as { error?: { error?: { code?: unknown } } })?.error?.error?.code;
  return typeof code === "string" && /^[a-z0-9_]{1,60}$/i.test(code) ? code : undefined;
}

function errorStatus(err: unknown): number | undefined {
  const status = (err as { status?: unknown })?.status;
  return typeof status === "number" ? status : undefined;
}

function isTransient(err: unknown, status: number | undefined): boolean {
  if (status !== undefined) return status >= 500 && status <= 599;
  // The SDK's connection and timeout errors report name "Error", so match the class name too.
  const transient = new Set(["APIConnectionError", "APIConnectionTimeoutError"]);
  const e = err as { name?: string; message?: string; constructor?: { name?: string } } | null;
  // Class names can be minified in production bundles; the SDK's own messages are fixed text.
  return transient.has(e?.name ?? "") || transient.has(e?.constructor?.name ?? "") || /^(Request timed out\.|Connection error\.)$/.test(e?.message ?? "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
