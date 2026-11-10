import { describe, expect, it, vi } from "vitest";
import { GeminiImageProvider, ImageProviderError } from "@/server/ai/image/gemini-image.provider";
import { jpegBytes } from "../helpers/images";

const key = (n: number) => `AQ.Ab8RN6${String(n).repeat(40)}`;
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const imageResponse = (bytes = jpegBytes()) => json({ id: "i1", steps: [{ type: "model_output", content: [{ type: "text", text: "Here it is" }, { type: "image", mime_type: "image/jpeg", data: bytes.toString("base64") }] }] });

function provider(responses: Array<Response | Error>, keys = `${key(1)},${key(2)}`) {
  const calls: Array<{ key: string; body: Record<string, unknown> }> = [];
  const queue = [...responses];
  const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push({ key: String((init?.headers as Record<string, string>)["x-goog-api-key"]), body: JSON.parse(String(init?.body)) });
    const next = queue.shift();
    if (!next) throw new Error("no more mocked responses");
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  const sleeps: number[] = [];
  return { p: new GeminiImageProvider({ keys, model: "test-model", fetchImpl, sleep: async (ms) => void sleeps.push(ms), timeoutMs: 1000 }), calls, sleeps };
}
const fail = async (promise: Promise<unknown>) => promise.then(() => null, (error: ImageProviderError) => error);

describe("Gemini image provider", () => {
  it("sends the brief, asks for an image, and returns the decoded picture", async () => {
    const { p, calls } = provider([imageResponse()]);
    const out = await p.generate({ prompt: "a logo" });
    expect(out.mimeType).toBe("image/jpeg");
    expect(out.model).toBe("test-model");
    expect(calls[0].body.model).toBe("test-model");
    expect((calls[0].body.input as Array<{ type: string }>)[0]).toEqual({ type: "text", text: "a logo" });
    expect(calls[0].body.response_format).toMatchObject({ type: "image", mime_type: "image/jpeg", aspect_ratio: "1:1" });
  });

  it("sends the source image when editing", async () => {
    const { p, calls } = provider([imageResponse()]);
    await p.generate({ prompt: "make it blue", image: { mimeType: "image/png", dataBase64: "QUJD" } });
    expect((calls[0].body.input as Array<Record<string, string>>)[1]).toEqual({ type: "image", mime_type: "image/png", data: "QUJD" });
  });

  it("accepts the other response shapes (output_image, inline data)", async () => {
    const data = jpegBytes().toString("base64");
    expect((await provider([json({ output_image: { data } })]).p.generate({ prompt: "x" })).bytes.length).toBeGreaterThan(0);
    expect((await provider([json({ candidates: [{ content: { parts: [{ inlineData: { data } }] } }] })]).p.generate({ prompt: "x" })).bytes.length).toBeGreaterThan(0);
  });

  it("skips a key Google rejects and uses the next one", async () => {
    const { p, calls } = provider([json({ error: { message: "API key not valid" } }, 400), imageResponse()]);
    await p.generate({ prompt: "x" });
    expect(calls.map((c) => c.key)).toEqual([key(1), key(2)]);
    // The rejected key is remembered: the next request goes straight to the good one.
    const again = provider([json({ error: {} }, 403), imageResponse(), imageResponse()]);
    await again.p.generate({ prompt: "x" });
    await again.p.generate({ prompt: "x" });
    expect(again.calls.map((c) => c.key)).toEqual([key(1), key(2), key(2)]);
  });

  it("reports invalid credentials when every key is rejected, without echoing any key", async () => {
    const { p, calls } = provider([json({ error: {} }, 401), json({ error: {} }, 403)]);
    const error = await fail(p.generate({ prompt: "x" }));
    expect(error?.kind).toBe("invalid_credentials");
    expect(calls).toHaveLength(2);
    expect(JSON.stringify([error?.message, error?.detail, p.status()])).not.toContain("AQ.Ab8RN6");
  });

  it("does not hide a rate limit by switching keys: one attempt, with the wait time", async () => {
    const { p, calls, sleeps } = provider([json({ error: { message: "Too many requests" } }, 429, { "retry-after": "42" })]);
    const error = await fail(p.generate({ prompt: "x" }));
    expect(error?.kind).toBe("rate_limited");
    expect(error?.retryAfterSeconds).toBe(42);
    expect(calls).toHaveLength(1);
    expect(sleeps).toHaveLength(0);
  });

  it("recognises a plan with no image quota (free tier, limit 0) as a billing problem, not a busy moment", async () => {
    const { p } = provider([json({ error: { message: "Rate limit exceeded (limit: 0 requests per day on Free Tier)" } }, 429)]);
    expect((await fail(p.generate({ prompt: "x" })))?.kind).toBe("billing_required");
  });

  it("keeps saying 'billing' (not 'busy') for the next requests while the key cools down", async () => {
    const { p, calls } = provider([json({ error: { message: "limit: 0 requests per day on Free Tier" } }, 429)], key(1));
    expect((await fail(p.generate({ prompt: "x" })))?.kind).toBe("billing_required");
    expect((await fail(p.generate({ prompt: "x" })))?.kind).toBe("billing_required");
    expect(calls).toHaveLength(1); // the second answer came from memory: nothing more was sent to Google
  });

  it("retries transient server errors a bounded number of times with growing backoff", async () => {
    const { p, calls, sleeps } = provider([json({}, 503), json({}, 500), json({}, 502)]);
    const error = await fail(p.generate({ prompt: "x" }));
    expect(error?.kind).toBe("unavailable");
    expect(calls).toHaveLength(3); // 1 try + 2 retries, never more
    expect(sleeps).toHaveLength(2);
    expect(sleeps[1]).toBeGreaterThan(sleeps[0]);
  });

  it("recovers when a retry succeeds", async () => {
    const { p, calls } = provider([json({}, 503), imageResponse()]);
    expect((await p.generate({ prompt: "x" })).bytes.length).toBeGreaterThan(0);
    expect(calls).toHaveLength(2);
  });

  it("retries network failures and reports a timeout as such", async () => {
    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    const { p, calls } = provider([timeout, timeout, timeout]);
    expect((await fail(p.generate({ prompt: "x" })))?.kind).toBe("timeout");
    expect(calls).toHaveLength(3);
    expect((await fail(provider([new Error("ECONNRESET"), new Error("ECONNRESET"), new Error("ECONNRESET")]).p.generate({ prompt: "x" })))?.kind).toBe("unavailable");
  });

  it("never retries a bad request or a refusal", async () => {
    const bad = provider([json({ error: { message: "invalid argument" } }, 400)]);
    expect((await fail(bad.p.generate({ prompt: "x" })))?.kind).toBe("invalid_request");
    expect(bad.calls).toHaveLength(1);
    const blocked = provider([json({ error: { message: "blocked by safety policy" } }, 400)]);
    expect((await fail(blocked.p.generate({ prompt: "x" })))?.kind).toBe("blocked");
    expect(blocked.calls).toHaveLength(1);
  });

  it("explains an unknown model", async () => {
    const error = await fail(provider([json({ error: {} }, 404)]).p.generate({ prompt: "x" }));
    expect(error?.kind).toBe("not_configured");
    expect(error?.message).toContain("GEMINI_IMAGE_MODEL");
  });

  it("rejects responses that are not a usable image", async () => {
    expect((await fail(provider([json({ steps: [] })]).p.generate({ prompt: "x" })))?.kind).toBe("bad_response");
    expect((await fail(provider([json({ steps: [{ content: [{ type: "image", data: Buffer.from("<svg/>").toString("base64") }] }] })]).p.generate({ prompt: "x" })))?.kind).toBe("bad_response");
    expect((await fail(provider([new Response("not json", { status: 200 })]).p.generate({ prompt: "x" })))?.kind).toBe("bad_response");
    expect((await fail(provider([json({ steps: [{ content: [{ type: "text", text: "I cannot create that because of safety policy" }] }] })]).p.generate({ prompt: "x" })))?.kind).toBe("blocked");
  });

  it("says clearly when no valid key is configured", async () => {
    const none = new GeminiImageProvider({ keys: "" });
    expect(none.configured).toBe(false);
    expect((await fail(none.generate({ prompt: "x" })))?.kind).toBe("not_configured");
    const joined = new GeminiImageProvider({ keys: `${key(1)}${key(2)}` });
    expect(joined.status()).toMatchObject({ configured: false, malformedEntries: 1 });
    expect((await fail(joined.generate({ prompt: "x" })))?.message).toContain("comma");
  });
});
