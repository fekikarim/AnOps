import "server-only";

import { GroqProvider } from "@/server/ai/providers/groq.provider";
import { OpenRouterProvider } from "@/server/ai/providers/openrouter.provider";
import { GeminiProvider } from "@/server/ai/providers/gemini.provider";
import { routeChat } from "@/server/ai/routing";
import type { AiAttachment, AiProvider, AiChatOptions, AiChatResult, AiCompletionOptions, AiCompletionResult } from "@/server/ai/types";
import { AiProviderError } from "@/server/ai/types";

/**
 * AI Provider Master Router
 * ─────────────────────────
 * Central hub for all AI completions in AnOps.
 *
 * Priority order (highest → lowest):
 *   1. Groq        — fast, generous free tier, multi-key rotation
 *   2. OpenRouter  — broad model selection, free tier
 *   3. Gemini      — Google Gemma family, reliable free tier
 *
 * The router tries each available provider in order. If a provider
 * fails with a retryable error (429, network) it falls back to the
 * next one automatically. Non-retryable errors (auth, bad request)
 * cause the router to skip that provider and log a warning.
 *
 * Usage:
 *   import { ai } from "@/server/ai";
 *   const result = await ai.complete({ messages: [...] });
 */

class AiMaster {
  private providers: AiProvider[];

  constructor() {
    // Instantiated once per server lifetime (module singleton)
    this.providers = [
      new GroqProvider(),
      new OpenRouterProvider(),
      new GeminiProvider(),
    ];
  }

  /**
   * Returns providers that are configured (have at least one key).
   */
  get availableProviders(): AiProvider[] {
    return this.providers.filter((p) => p.isAvailable);
  }

  /**
   * Run a chat completion using the best available provider.
   * Falls back through the provider priority list on failure.
   *
   * @throws Error when ALL configured providers fail.
   */
  async complete(options: AiCompletionOptions): Promise<AiCompletionResult> {
    let candidates = this.availableProviders;

    if (candidates.length === 0) {
      throw new Error(
        "[AiMaster] No AI providers are configured. " +
        "Set GROQ_API_KEYS, OPENROUTER_API_KEY, or GEMINI_API_KEYS in your .env."
      );
    }

    // 0. Attachments (images, PDFs) go only to providers that can read them, Gemini first: it reads
    //    both images and PDFs natively. A provider that cannot see the file is never asked to guess.
    const attachments: AiAttachment[] = options.messages.flatMap((m) => m.attachments ?? []);
    if (attachments.length) {
      candidates = candidates
        .filter((p) => p.supportsAttachments?.(attachments))
        .sort((a, b) => Number(b.name === "Gemini") - Number(a.name === "Gemini"));
      if (candidates.length === 0) {
        throw new AiProviderError("AiMaster", "No configured AI provider can read this file type", false);
      }
    }

    // 1. If a specific provider was explicitly selected (e.g. "groq", "gemini", "openrouter"):
    if (options.provider && options.provider.toLowerCase() !== "auto") {
      const target = candidates.find(
        (p) => p.name.toLowerCase() === options.provider?.toLowerCase()
      );
      if (!target) {
        throw new Error(
          `[AiMaster] Provider "${options.provider}" is not configured. ` +
          `Available providers: ${candidates.map((c) => c.name).join(", ")}`
        );
      }

      console.info(`[AiMaster] Using explicitly selected provider: ${target.name} (model: ${options.model ?? "default"})`);
      return await target.complete(options);
    }

    // 2. If a specific model was selected without an explicit provider, prioritize the matching provider
    if (options.model) {
      const matched = candidates.find((p) =>
        p.freeModels.includes(options.model!) ||
        (p.name === "OpenRouter" && options.model!.includes(":free")) ||
        (p.name === "Gemini" && options.model!.startsWith("gemini")) ||
        (p.name === "Groq" && (options.model!.startsWith("openai/") || options.model!.startsWith("qwen/") || options.model!.startsWith("allam-")))
      );
      if (matched) {
        candidates = [matched, ...candidates.filter((p) => p !== matched)];
      }
    }

    const errors: string[] = [];
    let currentOptions = { ...options };

    for (const provider of candidates) {
      try {
        console.info(`[AiMaster] Trying provider: ${provider.name} (model: ${currentOptions.model ?? "default"})`);
        const result = await provider.complete(currentOptions);
        console.info(
          `[AiMaster] Success via ${provider.name} / ${result.model}` +
          (result.usage?.totalTokens ? ` (${result.usage.totalTokens} tokens)` : "")
        );
        return result;
      } catch (err) {
        const msg = err instanceof AiProviderError
          ? err.message
          : `${provider.name}: ${(err as Error).message}`;

        console.warn(`[AiMaster] Provider failed — ${msg}`);
        errors.push(msg);

        // For the next fallback provider, reset specific model & provider so it uses its own free defaults
        currentOptions = { ...currentOptions, model: undefined, provider: undefined };
      }
    }

    throw new Error(
      `[AiMaster] All providers failed:\n  • ${errors.join("\n  • ")}`
    );
  }

  /**
   * Task-routed completion with tool calling and a normalized result.
   * Each task type has its own provider order (see `src/server/ai/routing.ts`).
   *
   * @throws Error when every provider in the task's chain fails.
   */
  chat(options: AiChatOptions): Promise<AiChatResult> {
    return routeChat(this.providers, options);
  }

  /**
   * Convenience: quick single-turn prompt.
   *
   * @example
   *   const text = await ai.ask("Summarise this attendance report: ...");
   */
  async ask(
    userPrompt: string,
    systemPrompt?: string,
    options?: Omit<AiCompletionOptions, "messages">
  ): Promise<string> {
    const messages: AiCompletionOptions["messages"] = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content: userPrompt });

    const result = await this.complete({ ...options, messages });
    return result.text;
  }

  /**
   * Returns a summary of which providers are ready to use.
   * Useful for health checks / admin dashboards.
   */
  status(): Array<{ name: string; available: boolean; models: string[] }> {
    return this.providers.map((p) => ({
      name: p.name,
      available: p.isAvailable,
      models: p.freeModels,
    }));
  }
}

// Module-level singleton — one instance for the entire server lifetime.
export const ai = new AiMaster();

// Re-export types for convenience
export type {
  AiChatOptions,
  AiChatResult,
  AiCompletionOptions,
  AiCompletionResult,
  AiMessage,
  AiTaskType,
  AiToolCall,
  AiToolDefinition,
} from "@/server/ai/types";
