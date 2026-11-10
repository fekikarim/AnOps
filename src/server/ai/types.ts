import "server-only";

/**
 * Shared types for the AnOps AI provider system.
 * Every provider adapter must implement the AiProvider interface.
 */

/** A tool call requested by a model, normalized across providers. `arguments` is a JSON string. */
export type AiToolCall = {
  id: string;
  name: string;
  arguments: string;
};

/** A tool offered to the model. `parameters` is a JSON schema object. */
export type AiToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

/** A file shown to a vision model (receipt photo, scanned PDF). User turns only. */
export type AiAttachment = {
  mimeType: string;
  /** The file's bytes, base64-encoded (no data: prefix). */
  dataBase64: string;
};

export type AiMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** User turns only: images or PDFs the model must look at. Only vision-capable providers are used. */
  attachments?: AiAttachment[];
  /** Assistant turns only: the tool calls the model asked for. */
  toolCalls?: AiToolCall[];
  /** Tool turns only: the call this result answers, and the tool's name (Gemini needs the name). */
  toolCallId?: string;
  toolName?: string;
};

export type AiCompletionOptions = {
  /** Conversation history / prompt messages */
  messages: AiMessage[];
  /** Max tokens to generate (default: 1024) */
  maxTokens?: number;
  /** Temperature 0–1 (default: 0.7) */
  temperature?: number;
  /**
   * Override the model for this call.
   * If omitted, the provider uses its default free model.
   */
  model?: string;
  /**
   * Preferred provider (e.g. "groq", "openrouter", "gemini").
   * If set, AiMaster routes to this provider first.
   */
  provider?: string;
  /** Ask the provider for JSON output. Callers must still validate the result. */
  jsonObject?: boolean;
  /** Spend as little as possible on hidden reasoning, which otherwise counts as output tokens. */
  economy?: boolean;
  /** Tools the model may call. Results come back in `AiCompletionResult.toolCalls`. */
  tools?: AiToolDefinition[];
  /** Aborts the provider request, for example when the person closes the stream. */
  signal?: AbortSignal;
};

export type AiCompletionResult = {
  /** The generated text */
  text: string;
  /** Which provider actually handled this call */
  provider: string;
  /** Which model was used */
  model: string;
  /** Approximate token usage if the API reported it */
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  /** Optional metadata attached by agent hooks or context */
  metadata?: Record<string, unknown>;
  /** Tool calls the model requested, if any. `text` may be empty when this is set. */
  toolCalls?: AiToolCall[];
};

/** Tasks with their own provider order. See `src/server/ai/routing.ts`. */
export type AiTaskType = "copilot_chat" | "advisor_json" | "policy_qa";

export type AiChatOptions = AiCompletionOptions & {
  taskType: AiTaskType;
  /** Per-attempt ceiling in milliseconds. */
  timeoutMs?: number;
};

export type AiProviderFallback = {
  provider: string;
  reason: "timeout" | "rate_limited" | "invalid_response" | "provider_error";
};

export type AiChatResult = AiCompletionResult & {
  latencyMs: number;
  /** Providers that failed before this one answered. Reasons never carry provider text. */
  fallbacks: AiProviderFallback[];
};

/**
 * Contract every provider adapter must satisfy.
 */
export interface AiProvider {
  /** Human-readable name for logging */
  readonly name: string;
  /** True when the provider has at least one valid API key configured */
  readonly isAvailable: boolean;
  /** List of free model IDs this provider exposes (first = default) */
  readonly freeModels: string[];
  /** Run a chat completion and return the result */
  complete(options: AiCompletionOptions): Promise<AiCompletionResult>;
  /** True when this provider can read these attachments. Providers without it never receive attachments. */
  supportsAttachments?(attachments: AiAttachment[]): boolean;
}

/**
 * Errors thrown by individual providers; caught by the master router.
 */
export class AiProviderError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
    public readonly retryable: boolean = false
  ) {
    super(`[${provider}] ${message}`);
    this.name = "AiProviderError";
  }
}
