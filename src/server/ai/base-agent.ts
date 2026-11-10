import "server-only";

import type {
  AiCompletionOptions,
  AiCompletionResult,
  AiMessage,
} from "@/server/ai/types";

/**
 * A single turn in an agent's conversation.
 * Stored/passed around on the client side as serialisable JSON.
 */
export type AgentMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  /** Arbitrary structured data the agent can attach (tool results, cards, etc.) */
  metadata?: Record<string, unknown>;
};

/**
 * What the agent returns for each chat turn.
 */
export type AgentResponse = {
  message: AgentMessage;
  /** Which provider handled this response */
  provider: string;
  /** Which model was used */
  model: string;
  usage?: AiCompletionResult["usage"];
};

/**
 * Context the caller can inject to give the agent real data.
 * Subclasses define their own typed context via generics.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AgentContext = Record<string, any>;

/**
 * Configuration a subclass must provide.
 */
export type AgentConfig = {
  /** Display name for the agent (shown in UI) */
  name: string;
  /** One-line description */
  description: string;
  /**
   * Base system prompt — the agent's identity and rules.
   * Subclasses can override `buildSystemPrompt()` to make it dynamic.
   */
  systemPrompt: string;
  /** Default generation settings */
  defaults?: {
    maxTokens?: number;
    temperature?: number;
    model?: string;
  };
};

/**
 * BaseAgent — the abstract foundation every AnOps AI agent extends.
 *
 * Responsibilities:
 * - Owns the conversation history for one session
 * - Converts `AgentMessage[]` to the `AiMessage[]` format the master expects
 * - Provides `chat()` as the main entry point
 * - Exposes lifecycle hooks: `buildSystemPrompt()`, `enrichContext()`,
 *   `beforeComplete()`, `afterComplete()`
 *
 * Usage (server action):
 * ```ts
 * const agent = new MyAgent();
 * const response = await agent.chat(history, userMessage, context);
 * ```
 */
/**
 * How an agent reaches a model. It is always supplied by the caller and is always a gated call (see server/ai/gate.ts), so an
 * agent cannot run without the access checks, the kill switch, the rate limits and the token budget.
 */
export type AgentComplete = (options: AiCompletionOptions) => Promise<AiCompletionResult>;

/** One system prompt and one user prompt through the supplied gated call, returning the reply text. */
export async function askWith(complete: AgentComplete, userPrompt: string, systemPrompt: string, options: Omit<AiCompletionOptions, "messages"> = {}): Promise<string> {
  return (await complete({ ...options, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }] })).text;
}

export abstract class BaseAgent {
  readonly name: string;
  readonly description: string;
  protected readonly config: AgentConfig;

  constructor(config: AgentConfig) {
    this.config = config;
    this.name = config.name;
    this.description = config.description;
  }

  // ─────────────────────────────────────────────
  // Hooks — override in subclasses
  // ─────────────────────────────────────────────

  /**
   * Build the system prompt (may be async, can use context).
   * Override to make the prompt dynamic based on real data.
   */
  protected async buildSystemPrompt(
    _context?: AgentContext
  ): Promise<string> {
    return this.config.systemPrompt;
  }

  /**
   * Enrich the context before it's fed to the prompt.
   * Override to load additional DB data, format it as text, etc.
   * Return extra content to *prepend* to the final user message, or null.
   */
  protected async enrichContext(
    _userMessage: string,
    _context?: AgentContext
  ): Promise<string | null> {
    return null;
  }

  /**
   * Called just before sending to the AI master.
   * Override to inspect / mutate the message array.
   */
  protected async beforeComplete(
    messages: AiMessage[],
    _context?: AgentContext
  ): Promise<AiMessage[]> {
    return messages;
  }

  /**
   * Called after a successful AI response.
   * Override to post-process text, log, or extract structured data.
   */
  protected async afterComplete(
    result: AiCompletionResult,
    _context?: AgentContext
  ): Promise<AiCompletionResult> {
    return result;
  }

  // ─────────────────────────────────────────────
  // Core — the main entry point
  // ─────────────────────────────────────────────

  /**
   * Process one conversation turn.
   *
   * @param history          Previous messages in this session (user + assistant turns)
   * @param userText         The new user message
   * @param context          Optional domain data the agent can use to enrich the prompt
   * @param complete         The gated model call supplied by the caller (see server/ai/gate.ts)
   */
  async chat(
    history: AgentMessage[],
    userText: string,
    context: AgentContext | undefined,
    complete: AgentComplete
  ): Promise<AgentResponse> {
    // 1. Build the system prompt (may be dynamic)
    const systemPrompt = await this.buildSystemPrompt(context);

    // 2. Optionally enrich the user message with context data
    const contextPrefix = await this.enrichContext(userText, context);
    const enrichedUserText = contextPrefix
      ? `${contextPrefix}\n\n---\n\n${userText}`
      : userText;

    // 3. Convert history to AiMessage format
    const historyMessages: AiMessage[] = history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

    // 4. Assemble the full message list
    let messages: AiMessage[] = [
      { role: "system", content: systemPrompt },
      ...historyMessages,
      { role: "user", content: enrichedUserText },
    ];

    // 5. Pre-completion hook
    const options: AiCompletionOptions = {
      messages: [],
      maxTokens: this.config.defaults?.maxTokens ?? 1024,
      temperature: this.config.defaults?.temperature ?? 0.7,
      // The provider and model are chosen on the server (agent default, then the router). A caller cannot pick them.
      model: this.config.defaults?.model,
    };
    messages = await this.beforeComplete(messages, context);
    options.messages = messages;

    // 6. Call the AI master (handles provider fallback internally)
    let result = await complete(options);

    // 7. Post-completion hook
    result = await this.afterComplete(result, context);

    // 8. Return a structured AgentResponse
    const responseMessage: AgentMessage = {
      id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      role: "assistant",
      content: result.text,
      timestamp: new Date().toISOString(),
      metadata: result.metadata ?? context?._metadata,
    };

    return {
      message: responseMessage,
      provider: result.provider,
      model: result.model,
      usage: result.usage,
    };
  }
}
