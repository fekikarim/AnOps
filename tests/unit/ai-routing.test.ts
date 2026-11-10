import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveChain, routeChat } from "@/server/ai/routing";
import { AiProviderError, type AiProvider, type AiCompletionResult } from "@/server/ai/types";

function provider(name: string, complete: AiProvider["complete"], isAvailable = true): AiProvider {
  return { name, isAvailable, freeModels: [`${name}-model`], complete };
}

function answer(name: string, text = "hello", extra: Partial<AiCompletionResult> = {}) {
  return vi.fn(async () => ({ text, provider: name, model: `${name}-model`, ...extra }));
}

const messages = [{ role: "user" as const, content: "hi" }];

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveChain", () => {
  const all = [provider("Groq", answer("Groq")), provider("OpenRouter", answer("OpenRouter")), provider("Gemini", answer("Gemini"))];

  it("orders providers per task", () => {
    expect(resolveChain(all, "copilot_chat").map((p) => p.name)).toEqual(["Groq", "OpenRouter", "Gemini"]);
    expect(resolveChain(all, "advisor_json").map((p) => p.name)).toEqual(["Gemini", "Groq", "OpenRouter"]);
    expect(resolveChain(all, "policy_qa").map((p) => p.name)).toEqual(["Gemini", "Groq", "OpenRouter"]);
  });

  it("honours env overrides and disabled providers", () => {
    vi.stubEnv("AI_ROUTE_COPILOT_CHAT", "gemini, groq");
    expect(resolveChain(all, "copilot_chat").map((p) => p.name)).toEqual(["Gemini", "Groq"]);
    vi.stubEnv("AI_DISABLED_PROVIDERS", "gemini");
    expect(resolveChain(all, "copilot_chat").map((p) => p.name)).toEqual(["Groq"]);
  });

  it("skips unconfigured providers and puts a preferred provider first", () => {
    const partial = [provider("Groq", answer("Groq"), false), ...all.slice(1)];
    expect(resolveChain(partial, "copilot_chat").map((p) => p.name)).toEqual(["OpenRouter", "Gemini"]);
    expect(resolveChain(all, "copilot_chat", "gemini").map((p) => p.name)).toEqual(["Gemini", "Groq", "OpenRouter"]);
  });
});

describe("routeChat", () => {
  it("falls back when the primary provider fails, and reports it without provider text", async () => {
    const groq = provider("Groq", async () => {
      throw new AiProviderError("Groq", "API error (HTTP 400) secret request content", false);
    });
    const openRouter = answer("OpenRouter");
    const result = await routeChat([groq, provider("OpenRouter", openRouter)], { taskType: "copilot_chat", messages });

    expect(result.provider).toBe("OpenRouter");
    expect(result.fallbacks).toEqual([{ provider: "Groq", reason: "provider_error" }]);
    expect(JSON.stringify(result.fallbacks)).not.toContain("secret");
  });

  it("retries a transient failure once on the same provider, then moves on", async () => {
    const groq = vi.fn(async () => {
      throw new AiProviderError("Groq", "Network error", true);
    });
    const gemini = answer("Gemini");
    const result = await routeChat([provider("Groq", groq), provider("Gemini", gemini)], { taskType: "copilot_chat", messages });

    expect(groq).toHaveBeenCalledTimes(2);
    expect(result.provider).toBe("Gemini");
  });

  it("does not retry a rate limited provider", async () => {
    const groq = vi.fn(async () => {
      throw new AiProviderError("Groq", "Rate limited (429).", true);
    });
    const result = await routeChat([provider("Groq", groq), provider("Gemini", answer("Gemini"))], { taskType: "copilot_chat", messages });

    expect(groq).toHaveBeenCalledTimes(1);
    expect(result.fallbacks[0].reason).toBe("rate_limited");
  });

  it("treats an empty response as a failure", async () => {
    const empty = vi.fn(async () => ({ text: "  ", provider: "Groq", model: "m" }));
    const result = await routeChat([provider("Groq", empty), provider("Gemini", answer("Gemini"))], {
      taskType: "copilot_chat",
      messages,
    });
    expect(empty).toHaveBeenCalledTimes(2);
    expect(result.fallbacks[0]).toEqual({ provider: "Groq", reason: "invalid_response" });
  });

  it("treats malformed tool arguments as a failure", async () => {
    const bad = async () => ({
      text: "",
      provider: "Groq",
      model: "m",
      toolCalls: [{ id: "1", name: "x", arguments: "{not json" }],
    });
    const result = await routeChat([provider("Groq", bad), provider("Gemini", answer("Gemini"))], {
      taskType: "copilot_chat",
      messages,
    });
    expect(result.provider).toBe("Gemini");
  });

  it("times out a hanging provider and moves on", async () => {
    const hanging = () => new Promise<AiCompletionResult>(() => undefined);
    const result = await routeChat([provider("Groq", hanging), provider("Gemini", answer("Gemini"))], {
      taskType: "copilot_chat",
      messages,
      timeoutMs: 20,
    });
    expect(result.provider).toBe("Gemini");
    expect(result.fallbacks[0].reason).toBe("timeout");
  });

  it("gives a chosen model only to the first provider", async () => {
    const groq = vi.fn(async () => {
      throw new AiProviderError("Groq", "bad", false);
    });
    const gemini = vi.fn(answer("Gemini"));
    await routeChat([provider("Groq", groq), provider("Gemini", gemini)], { taskType: "copilot_chat", messages, model: "groq-only" });
    expect(groq.mock.calls[0]).toMatchObject([{ model: "groq-only" }]);
    expect(gemini.mock.calls[0]).toMatchObject([{ model: undefined }]);
  });

  it("throws when every provider fails or none is available", async () => {
    const down = provider("Groq", async () => {
      throw new AiProviderError("Groq", "down", false);
    });
    await expect(routeChat([down], { taskType: "copilot_chat", messages })).rejects.toThrow(/All providers failed/);
    await expect(routeChat([], { taskType: "copilot_chat", messages })).rejects.toThrow(/No AI provider/);
  });
});
