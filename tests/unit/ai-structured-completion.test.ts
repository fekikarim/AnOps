import { describe, expect, it, vi } from "vitest";
import { completeStructured, StructuredCompletionError, type CompleteFn } from "@/server/ai/structured-completion";
import { AiProviderError } from "@/server/ai/types";

const parse = (t: string) => {
  try {
    const v = JSON.parse(t);
    return typeof v?.ok === "boolean" ? (v as { ok: boolean }) : null;
  } catch {
    return null;
  }
};
const reply = (text: string, tokens = 10) => ({ text, provider: "Groq", model: "m", usage: { totalTokens: tokens } });
function scripted(...steps: (string | Error)[]) {
  let i = 0;
  const calls = vi.fn();
  const complete: CompleteFn = async (o) => {
    calls(o);
    const s = steps[Math.min(i++, steps.length - 1)];
    if (s instanceof Error) throw s;
    return reply(s);
  };
  return { complete, calls };
}
const base = { messages: [{ role: "user" as const, content: "hi" }], maxTokens: 100, parse, label: "test" };

describe("completeStructured", () => {
  it("first call is pinned to Groq in JSON mode and returns the parsed value with token use", async () => {
    const { complete, calls } = scripted('{"ok":true}');
    const r = await completeStructured({ ...base, complete });
    expect(r).toMatchObject({ value: { ok: true }, totalTokens: 10, provider: "Groq" });
    expect(calls.mock.calls[0][0]).toMatchObject({ provider: "groq", jsonObject: true });
  });

  it("a provider failure falls back once to the normal provider chain", async () => {
    const { complete, calls } = scripted(new AiProviderError("Groq", "rate limited", true) as Error, '{"ok":true}');
    const r = await completeStructured({ ...base, complete });
    expect(r.value.ok).toBe(true);
    expect(calls).toHaveBeenCalledTimes(2);
    expect(calls.mock.calls[0][0].provider).toBe("groq");
    expect(calls.mock.calls[1][0].provider).toBeUndefined();
  });

  it("a request the provider rejects (JSON mode failing) is retried once without JSON mode, while a rate limit keeps it", async () => {
    const rejected = scripted(new AiProviderError("Groq", "API error (HTTP 400)", false) as Error, '{"ok":true}');
    const a = await completeStructured({ ...base, complete: rejected.complete });
    expect(a.value.ok).toBe(true);
    expect(rejected.calls.mock.calls[0][0]).toMatchObject({ provider: "groq", jsonObject: true });
    expect(rejected.calls.mock.calls[1][0].jsonObject).toBe(false);
    // Chance failures alternate the mode within the three-call bound, then give up with a typed error.
    const flaky = scripted(new AiProviderError("Groq", "API error (HTTP 400)", false) as Error, new AiProviderError("Groq", "API error (HTTP 400)", false) as Error, '{"ok":true}');
    expect((await completeStructured({ ...base, complete: flaky.complete })).value.ok).toBe(true);
    expect(flaky.calls.mock.calls.map((c) => c[0].jsonObject)).toEqual([true, false, true]);
    const dead = scripted(new AiProviderError("Groq", "API error (HTTP 400)", false) as Error);
    await expect(completeStructured({ ...base, complete: dead.complete })).rejects.toMatchObject({ kind: "unavailable" });
    expect(dead.calls).toHaveBeenCalledTimes(3);
    const limited = scripted(new AiProviderError("Groq", "rate limited", true) as Error, '{"ok":true}');
    await completeStructured({ ...base, complete: limited.complete });
    expect(limited.calls.mock.calls[1][0].jsonObject).toBe(true);
  });

  it("an unreadable reply gets exactly one repair call that shows the model its own reply", async () => {
    const { complete, calls } = scripted("garbage", '{"ok":false}');
    const r = await completeStructured({ ...base, complete });
    expect(r.value.ok).toBe(false);
    expect(calls).toHaveBeenCalledTimes(2);
    const repair = JSON.stringify(calls.mock.calls[1][0].messages);
    expect(repair).toContain("garbage");
    expect(repair).toContain("could not be used");
  });

  it("gives up with a typed error after repair fails, summing tokens, and never more than three calls", async () => {
    const { complete, calls } = scripted("nope", "still nope", "never reached");
    const err = await completeStructured({ ...base, complete }).catch((e) => e);
    expect(err).toBeInstanceOf(StructuredCompletionError);
    expect(err.kind).toBe("unreadable");
    expect(err.totalTokens).toBe(20);
    expect(calls.mock.calls.length).toBeLessThanOrEqual(3);
    expect(err.toAppError().code).toBe("VALIDATION_ERROR");
  });

  it("classifies a retryable provider failure as busy and any other as unavailable, without leaking provider text", async () => {
    const busy = await completeStructured({ ...base, complete: scripted(new AiProviderError("Groq", "all keys exhausted gsk_SECRET", true) as Error).complete }).catch((e) => e);
    expect(busy.kind).toBe("busy");
    expect(busy.toAppError().code).toBe("RATE_LIMITED");
    const down = await completeStructured({ ...base, complete: scripted(new Error("401 invalid api key gsk_SECRET123")).complete }).catch((e) => e);
    expect(down.kind).toBe("unavailable");
    const app = down.toAppError();
    expect(app.code).toBe("INTERNAL");
    expect(`${app.message} ${JSON.stringify(app)}`).not.toContain("gsk_SECRET");
  });

  it("a repaired reply after a provider fallback still succeeds within the call budget", async () => {
    const { complete, calls } = scripted(new Error("boom"), "not json", '{"ok":true}');
    expect((await completeStructured({ ...base, complete })).value.ok).toBe(true);
    expect(calls).toHaveBeenCalledTimes(3);
  });
});
