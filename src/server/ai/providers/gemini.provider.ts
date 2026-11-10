import "server-only";

import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Content, FunctionDeclaration, FunctionDeclarationSchema, Tool } from "@google/generative-ai";
import { KeyPool } from "@/server/ai/key-pool";
import type { AiAttachment, AiMessage, AiProvider, AiCompletionOptions, AiCompletionResult, AiToolDefinition } from "@/server/ai/types";
import { AiProviderError } from "@/server/ai/types";

const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Free Gemini models (Gemini flash variants + Gemma family).
 * Full list: https://ai.google.dev/gemini-api/docs/models/gemini
 * First entry is the default.
 */
const FREE_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-1.5-flash",
  "gemini-flash-latest",
  "gemini-2.5-flash-lite",
  "gemma-4-26b-a4b-it",
  "gemma-4-31b-it",
];

const MAX_RETRIES_PER_CALL = 3;

/** Gemini reads these inline. The whole request must stay under 20 MB, so files are capped well below it. */
const VISION_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"]);
const MAX_INLINE_BASE64 = 14 * 1024 * 1024;
/** Model used when a request carries attachments. Gemma models do not read PDFs. */
const VISION_MODEL = process.env.GEMINI_VISION_MODEL || "gemini-2.5-flash";

export class GeminiProvider implements AiProvider {
  readonly name = "Gemini";
  readonly freeModels = FREE_MODELS;

  private pool: KeyPool;

  constructor() {
    this.pool = new KeyPool(process.env.GEMINI_API_KEYS);
  }

  get isAvailable(): boolean {
    return this.pool.hasKeys;
  }

  supportsAttachments(attachments: AiAttachment[]): boolean {
    const total = attachments.reduce((n, a) => n + a.dataBase64.length, 0);
    return total <= MAX_INLINE_BASE64 && attachments.every((a) => VISION_MIME.has(a.mimeType));
  }

  async complete(options: AiCompletionOptions): Promise<AiCompletionResult> {
    // If a model is specifically meant for another provider, skip Gemini
    if (
      options.model &&
      (options.model.includes(":free") ||
        options.model.startsWith("openai/") ||
        options.model.startsWith("qwen/") ||
        options.model.startsWith("allam-") ||
        options.model.startsWith("nvidia/"))
    ) {
      throw new AiProviderError(this.name, `Model ${options.model} is not supported by Gemini`, false);
    }

    const hasAttachments = options.messages.some((m) => m.attachments?.length);
    const model = options.model ?? (hasAttachments ? VISION_MODEL : FREE_MODELS[0]);
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES_PER_CALL; attempt++) {
      let apiKey: string;
      try {
        apiKey = this.pool.next();
      } catch (err) {
        throw new AiProviderError(this.name, (err as Error).message, true);
      }

      try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const gemModel = genAI.getGenerativeModel({
          model,
          generationConfig: {
            maxOutputTokens: options.maxTokens ?? 1024,
            temperature: options.temperature ?? 0.7,
            ...(options.jsonObject ? { responseMimeType: "application/json" } : {}),
            // Not yet in this SDK's types. Without it, hidden thinking uses up maxOutputTokens.
            ...(options.economy && model.startsWith("gemini-2.5")
              ? ({ thinkingConfig: { thinkingBudget: 0 } } as object)
              : {}),
          },
        });

        // Separate system prompt from the conversation
        const systemMsg = options.messages.find((m) => m.role === "system");

        const result = await gemModel.generateContent({
          contents: toGeminiContents(options.messages),
          ...(systemMsg
            ? {
                systemInstruction: {
                  role: "user",
                  parts: [{ text: systemMsg.content }],
                },
              }
            : {}),
          ...(options.tools?.length ? { tools: toGeminiTools(options.tools) } : {}),
        }, { timeout: REQUEST_TIMEOUT_MS, ...(options.signal ? { signal: options.signal } : {}) });
        const text = result.response.text();
        const toolCalls = result.response.functionCalls()?.map((call, index) => ({
          id: `gemini-call-${index}`,
          name: call.name,
          arguments: JSON.stringify(call.args ?? {}),
        }));

        return {
          text,
          ...(toolCalls?.length ? { toolCalls } : {}),
          provider: this.name,
          model,
          // Gemini SDK returns usage in usageMetadata
          usage: {
            promptTokens: result.response.usageMetadata?.promptTokenCount,
            completionTokens: result.response.usageMetadata?.candidatesTokenCount,
            totalTokens: result.response.usageMetadata?.totalTokenCount,
          },
        };
      } catch (err: unknown) {
        const message = (err as Error).message ?? "";
        // 429 / RESOURCE_EXHAUSTED
        const isRateLimit =
          (err as { status?: number })?.status === 429 ||
          message.includes("429") ||
          message.toUpperCase().includes("RESOURCE_EXHAUSTED");

        if (isRateLimit) {
          this.pool.markRateLimited(apiKey!);
          lastError = err as Error;
          console.warn(`[Gemini] Rate-limited on key ...${apiKey!.slice(-6)}, rotating (attempt ${attempt + 1}/${MAX_RETRIES_PER_CALL})`);
          continue;
        }

        // If a model override returned 404 (not found), recover with the default free model
        if ((message.includes("404") || message.includes("not found")) && model !== FREE_MODELS[0] && !hasAttachments) {
          console.warn(`[Gemini] Model "${model}" not found (404), recovering with ${FREE_MODELS[0]}`);
          return await this.complete({ ...options, model: FREE_MODELS[0] });
        }

        throw new AiProviderError(
          this.name,
          `API error: ${message}`,
          false
        );
      }
    }

    throw new AiProviderError(
      this.name,
      `All retries exhausted: ${lastError?.message}`,
      true
    );
  }
}

/** Maps normalized messages to Gemini turns. Consecutive tool results share one "function" turn, as Gemini requires. */
function toGeminiContents(messages: AiMessage[]): Content[] {
  const contents: Content[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "tool") {
      const part = { functionResponse: { name: m.toolName ?? "", response: { result: m.content } } };
      const last = contents[contents.length - 1];
      if (last?.role === "function") last.parts.push(part);
      else contents.push({ role: "function", parts: [part] });
      continue;
    }
    if (m.role === "assistant") {
      contents.push({
        role: "model",
        parts: [
          ...(m.content ? [{ text: m.content }] : []),
          ...(m.toolCalls ?? []).map((call) => ({
            functionCall: { name: call.name, args: parseArgs(call.arguments) },
          })),
        ],
      });
      continue;
    }
    contents.push({
      role: "user",
      parts: [
        ...(m.attachments ?? []).map((a) => ({ inlineData: { mimeType: a.mimeType, data: a.dataBase64 } })),
        { text: m.content },
      ],
    });
  }
  return contents;
}

function parseArgs(json: string): object {
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function toGeminiTools(tools: AiToolDefinition[]): Tool[] {
  const functionDeclarations: FunctionDeclaration[] = tools.map((tool) => {
    const parameters = toGeminiSchema(tool.parameters);
    const hasProperties = Object.keys((parameters.properties as object | undefined) ?? {}).length > 0;
    return {
      name: tool.name,
      description: tool.description,
      // Gemini rejects an object schema with no properties, so a no-argument tool omits it.
      ...(hasProperties ? { parameters: parameters as unknown as FunctionDeclarationSchema } : {}),
    };
  });
  return [{ functionDeclarations }];
}

/** Gemini accepts only part of JSON schema: keep type, description, enum, items, properties and required. */
function toGeminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ["type", "description", "enum", "required"]) {
    if (schema[key] !== undefined) out[key] = schema[key];
  }
  if (schema.items && typeof schema.items === "object") {
    out.items = toGeminiSchema(schema.items as Record<string, unknown>);
  }
  if (schema.properties && typeof schema.properties === "object") {
    out.properties = Object.fromEntries(
      Object.entries(schema.properties as Record<string, Record<string, unknown>>).map(([name, value]) => [
        name,
        toGeminiSchema(value),
      ])
    );
  }
  return out;
}
