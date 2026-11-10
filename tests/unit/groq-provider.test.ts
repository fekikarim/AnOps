import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiProviderError } from "@/server/ai/types";

/**
 * The Groq SDK is replaced by a fake whose `create` is scripted per test. No network is used.
 * Error objects mirror the SDK shape the provider relies on: a numeric `status` or a class `name`.
 */
const { createMock, clientKeys } = vi.hoisted(() => ({ createMock: vi.fn(), clientKeys: [] as string[] }));

vi.mock("groq-sdk", () => {
  class Groq {
    chat = { completions: { create: createMock } };
    constructor(options: { apiKey: string; timeout?: number; maxRetries?: number }) {
      clientKeys.push(options.apiKey);
      expect(options.maxRetries).toBe(0);
      expect(options.timeout).toBe(20_000);
    }
  }
  return { default: Groq };
});

import { GroqProvider } from "@/server/ai/providers/groq.provider";

function completion(content: string | null | undefined, extra: Record<string, unknown> = {}) {
  return {
    choices: content === undefined ? [] : [{ message: { content } }],
    usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 },
    ...extra,
  };
}

function apiError(status: number, message = "provider body with request content") {
  return Object.assign(new Error(message), { status, name: "APIError" });
}

const messages = [{ role: "user" as const, content: "Summarise stock" }];

beforeEach(() => {
  createMock.mockReset();
  clientKeys.length = 0;
  vi.stubEnv("GROQ_API_KEYS", "");
  vi.stubEnv("GROQ_API_KEY", "");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GroqProvider configuration", () => {
  it("is unavailable without any key", () => {
    expect(new GroqProvider().isAvailable).toBe(false);
  });

  it("accepts the single GROQ_API_KEY documented in .env", () => {
    vi.stubEnv("GROQ_API_KEY", "gsk_test_single");
    expect(new GroqProvider().isAvailable).toBe(true);
  });

  it("prefers GROQ_API_KEYS when both are set", async () => {
    vi.stubEnv("GROQ_API_KEYS", "gsk_list_a,gsk_list_b");
    vi.stubEnv("GROQ_API_KEY", "gsk_single");
    createMock.mockResolvedValueOnce(completion("ok"));
    await new GroqProvider().complete({ messages });
    expect(clientKeys).toEqual(["gsk_list_a"]);
  });
});

describe("GroqProvider.complete", () => {
  beforeEach(() => {
    vi.stubEnv("GROQ_API_KEYS", "gsk_key_one,gsk_key_two");
  });

  it("returns text, model and usage from a well-formed response", async () => {
    createMock.mockResolvedValueOnce(completion("hello"));
    const result = await new GroqProvider().complete({ messages, maxTokens: 300 });
    expect(result).toMatchObject({
      text: "hello",
      provider: "Groq",
      model: "openai/gpt-oss-120b",
      usage: { promptTokens: 5, completionTokens: 7, totalTokens: 12 },
    });
    const request = createMock.mock.calls[0][0];
    expect(request).toMatchObject({ max_completion_tokens: 300, messages });
    expect(request).not.toHaveProperty("max_tokens");
    expect(request).not.toHaveProperty("response_format");
  });

  it("requests JSON mode only when asked", async () => {
    createMock.mockResolvedValueOnce(completion("{}"));
    await new GroqProvider().complete({ messages, jsonObject: true });
    expect(createMock.mock.calls[0][0]).toMatchObject({ response_format: { type: "json_object" } });
  });

  it("rejects a response with no choices as a non-retryable malformed response", async () => {
    createMock.mockResolvedValueOnce(completion(undefined));
    const error = await new GroqProvider().complete({ messages }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(AiProviderError);
    expect(error).toMatchObject({ retryable: false });
    expect((error as Error).message).toContain("Malformed response");
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a response whose content is null", async () => {
    createMock.mockResolvedValueOnce(completion(null));
    await expect(new GroqProvider().complete({ messages })).rejects.toMatchObject({ retryable: false });
  });

  it("rotates to the next key on 429 and succeeds", async () => {
    createMock.mockRejectedValueOnce(apiError(429)).mockResolvedValueOnce(completion("after rotation"));
    const result = await new GroqProvider().complete({ messages });
    expect(result.text).toBe("after rotation");
    expect(clientKeys).toEqual(["gsk_key_one", "gsk_key_two"]);
  });

  it("reports a retryable failure when every key is rate limited", async () => {
    createMock.mockRejectedValue(apiError(429));
    const error = await new GroqProvider().complete({ messages }).catch((err: unknown) => err);
    expect(error).toMatchObject({ retryable: true });
    expect(createMock.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("retries a timeout with backoff and then succeeds", async () => {
    const timeout = Object.assign(new Error("Request timed out."), { name: "APIConnectionTimeoutError" });
    createMock.mockRejectedValueOnce(timeout).mockResolvedValueOnce(completion("recovered"));
    const result = await new GroqProvider().complete({ messages });
    expect(result.text).toBe("recovered");
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after bounded attempts on persistent 5xx and marks the failure retryable", async () => {
    createMock.mockRejectedValue(apiError(503));
    const error = await new GroqProvider().complete({ messages }).catch((err: unknown) => err);
    expect(error).toMatchObject({ retryable: true });
    expect(createMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry a 400 and does not forward the provider message", async () => {
    createMock.mockRejectedValueOnce(apiError(400, "secret echo of the prompt"));
    const error = await new GroqProvider().complete({ messages }).catch((err: unknown) => err);
    expect(error).toMatchObject({ retryable: false });
    expect((error as Error).message).toBe("[Groq] API error (HTTP 400)");
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("retries once with the default model when an override is not found", async () => {
    createMock.mockRejectedValueOnce(apiError(404)).mockResolvedValueOnce(completion("default model"));
    const result = await new GroqProvider().complete({ messages, model: "openai/gpt-oss-20b" });
    expect(result).toMatchObject({ text: "default model", model: "openai/gpt-oss-120b" });
    expect(createMock.mock.calls[1][0]).toMatchObject({ model: "openai/gpt-oss-120b" });
  });

  it("refuses models that belong to other providers without calling Groq", async () => {
    await expect(new GroqProvider().complete({ messages, model: "gemini-1.5-flash" })).rejects.toMatchObject({
      retryable: false,
    });
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe("GroqProvider reasoning budget and rejection logging", () => {
  it("asks gpt-oss models for low reasoning effort, so thinking cannot use up the reply budget", async () => {
    vi.stubEnv("GROQ_API_KEYS", "gsk_test_one");
    createMock.mockResolvedValueOnce(completion("{}"));
    // Economy mode is the caller's choice (extraction and routing do not need deep reasoning); without it the model decides.
    await new GroqProvider().complete({ messages, jsonObject: true, economy: true });
    expect(createMock.mock.calls[0][0]).toMatchObject({ model: "openai/gpt-oss-120b", reasoning_effort: "low", response_format: { type: "json_object" } });
    createMock.mockResolvedValueOnce(completion("{}"));
    await new GroqProvider().complete({ messages, jsonObject: true });
    expect(createMock.mock.calls[1][0]).not.toHaveProperty("reasoning_effort");
    createMock.mockResolvedValueOnce(completion("{}"));
    await new GroqProvider().complete({ messages, model: "allam-2-7b", economy: true });
    expect(createMock.mock.calls[2][0]).not.toHaveProperty("reasoning_effort");
  });

  it("keeps only the short machine code of a rejection in the error, never the provider's message or the request", async () => {
    vi.stubEnv("GROQ_API_KEYS", "gsk_test_one");
    createMock.mockRejectedValueOnce(Object.assign(apiError(400, "echoed secret request text"), { error: { error: { code: "json_validate_failed", message: "echoed secret request text" } } }));
    const failure = await new GroqProvider().complete({ messages }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(AiProviderError);
    expect((failure as Error).message).toContain("HTTP 400, json_validate_failed");
    expect((failure as Error).message).not.toContain("echoed secret");
  });
});
