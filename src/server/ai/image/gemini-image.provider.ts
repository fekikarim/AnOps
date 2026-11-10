import "server-only";
import { KeyPool } from "@/server/ai/key-pool";
import { parseGeminiKeys } from "@/server/ai/image/gemini-keys";

/**
 * Gemini image generation and editing through the Interactions API (server side only: keys never leave this module).
 * Docs: https://aistudio.google.com/docs/image-generation
 *
 * - POST https://generativelanguage.googleapis.com/v1beta/interactions, header `x-goog-api-key`, `Api-Revision`.
 * - `input` is a list of parts: text, optionally an `image` part (base64) when editing.
 * - `response_format: { type: "image", ... }` asks for an image; the image comes back as a base64 `image` content block.
 * - Model: GEMINI_IMAGE_MODEL (default `gemini-nano-banana-2.1`, Google's recommended model for new projects).
 *
 * Failure handling is explicit: each failure is classified, only transient ones are retried (bounded, exponential backoff
 * with jitter), a key Google rejects is skipped and the next key is used, but a rate limit or quota error is NOT answered
 * by switching keys - a quota usually belongs to the shared project, so rotating would only hide the limit.
 */

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com";

/** GEMINI_API_BASE_URL lets a staging proxy or a local fake stand in for Google. Only https, or http to this machine, is accepted. */
function endpoint(): string {
  const configured = (process.env.GEMINI_API_BASE_URL ?? "").trim().replace(/\/+$/, "");
  const safe = /^https:\/\/[^\s/]+(\/[^\s]*)?$/.test(configured) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(configured);
  return `${safe ? configured : DEFAULT_BASE_URL}/v1beta/interactions`;
}
const API_REVISION = "2026-05-20";
export const DEFAULT_IMAGE_MODEL = "gemini-nano-banana-2.1";
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_TRANSIENT_RETRIES = 2;
const BACKOFF_BASE_MS = 600;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

export type ImageFailureKind =
  | "not_configured" //   no usable key, or the model is not available to this project
  | "invalid_credentials" // every configured key was rejected
  | "billing_required" // the project's plan has no image quota at all ("limit: 0", free tier): retrying cannot help
  | "rate_limited" //     429 / quota: try again later
  | "blocked" //          the request or the result was refused by Gemini's safety rules
  | "invalid_request" //  the request itself is wrong; retrying cannot help
  | "timeout"
  | "unavailable" //      network failure or Gemini 5xx after the bounded retries
  | "bad_response"; //    Gemini answered, but not with a usable image

export class ImageProviderError extends Error {
  constructor(
    readonly kind: ImageFailureKind,
    message: string,
    readonly retryAfterSeconds?: number,
    /** Upstream explanation (never a key), for server logs and operators only. Not shown to the person using the studio. */
    readonly detail?: string
  ) {
    super(message);
    this.name = "ImageProviderError";
  }
}

export type ImagePart = { mimeType: string; dataBase64: string };
export type GenerateImageRequest = { prompt: string; image?: ImagePart };
export type GeneratedImage = { bytes: Buffer; mimeType: "image/png" | "image/jpeg" | "image/webp"; model: string };

type Deps = {
  keys?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
};

export function sniffImage(bytes: Uint8Array): GeneratedImage["mimeType"] | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}

/** Finds base64 image blocks anywhere in the response (steps[].content[], output_image, inline data). Last one wins. */
function collectImages(node: unknown, found: string[] = [], depth = 0): string[] {
  if (depth > 8 || node === null || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    for (const item of node) collectImages(item, found, depth + 1);
    return found;
  }
  const record = node as Record<string, unknown>;
  if (record.type === "image" && typeof record.data === "string") found.push(record.data);
  const inline = (record.inline_data ?? record.inlineData) as Record<string, unknown> | undefined;
  if (inline && typeof inline.data === "string") found.push(inline.data);
  if (typeof record.output_image === "object" && record.output_image) {
    const out = record.output_image as Record<string, unknown>;
    if (typeof out.data === "string") found.push(out.data);
  }
  for (const value of Object.values(record)) if (typeof value === "object") collectImages(value, found, depth + 1);
  return found;
}

function collectText(node: unknown, parts: string[] = [], depth = 0): string[] {
  if (depth > 8 || node === null || typeof node !== "object") return parts;
  if (Array.isArray(node)) {
    for (const item of node) collectText(item, parts, depth + 1);
    return parts;
  }
  const record = node as Record<string, unknown>;
  if (record.type === "text" && typeof record.text === "string") parts.push(record.text);
  for (const value of Object.values(record)) if (typeof value === "object") collectText(value, parts, depth + 1);
  return parts;
}

function retryAfter(response: Response): number | undefined {
  const raw = response.headers.get("retry-after");
  const seconds = raw ? Number(raw) : NaN;
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(Math.ceil(seconds), 3600) : undefined;
}

export class GeminiImageProvider {
  private pool: KeyPool;
  /** When a "no image quota on this plan" answer was last seen: while its cooldown lasts, say that again instead of "busy". */
  private billingUntil = 0;
  private readonly invalidEntries: number;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;

  constructor(deps: Deps = {}) {
    const parsed = parseGeminiKeys(deps.keys ?? process.env.GEMINI_API_KEYS);
    this.pool = new KeyPool(parsed.keys.join(","));
    this.invalidEntries = parsed.invalidCount;
    this.model = (deps.model ?? process.env.GEMINI_IMAGE_MODEL ?? DEFAULT_IMAGE_MODEL).trim() || DEFAULT_IMAGE_MODEL;
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.timeoutMs = deps.timeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  get configured(): boolean {
    return this.pool.hasKeys;
  }

  /** Counts only: safe to show to an administrator. */
  status(): { configured: boolean; usableKeys: number; malformedEntries: number; model: string } {
    return { configured: this.pool.hasKeys, usableKeys: this.pool.availableCount, malformedEntries: this.invalidEntries, model: this.model };
  }

  async generate(request: GenerateImageRequest): Promise<GeneratedImage> {
    if (!this.pool.hasKeys) {
      throw new ImageProviderError(
        "not_configured",
        this.invalidEntries > 0
          ? "GEMINI_API_KEYS has no valid key. Each key must be separated by a comma (a missing comma joins two keys into one invalid entry)."
          : "No Gemini API key is configured (GEMINI_API_KEYS)."
      );
    }
    const body = JSON.stringify({
      model: this.model,
      input: [{ type: "text", text: request.prompt }, ...(request.image ? [{ type: "image", mime_type: request.image.mimeType, data: request.image.dataBase64 }] : [])],
      response_format: { type: "image", mime_type: "image/jpeg", aspect_ratio: "1:1", image_size: "1K" },
    });

    let transientFailures = 0;
    let credentialFailures = 0;
    for (;;) {
      let key: string;
      try {
        key = this.pool.next();
      } catch {
        if (this.billingUntil > Date.now()) throw new ImageProviderError("billing_required", "This Google project has no image-generation quota on its current plan.");
        throw credentialFailures > 0
          ? new ImageProviderError("invalid_credentials", "Gemini rejected the configured API key(s).")
          : new ImageProviderError("rate_limited", "The image service is cooling down after a rate limit.", Math.max(1, this.pool.secondsUntilAvailable));
      }

      let response: Response;
      try {
        response = await this.fetchImpl(endpoint(), {
          method: "POST",
          headers: { "x-goog-api-key": key, "Content-Type": "application/json", "Api-Revision": API_REVISION },
          body,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        if (transientFailures >= MAX_TRANSIENT_RETRIES) {
          throw timedOut
            ? new ImageProviderError("timeout", "Image generation took too long.")
            : new ImageProviderError("unavailable", "The image service could not be reached.");
        }
        await this.backoff(transientFailures++);
        continue;
      }

      if (response.ok) return this.parse(await response.text());

      const status = response.status;
      const errorBody = await response.text().catch(() => "");
      const message = errorBody.slice(0, 600).toLowerCase();

      // Google reports a bad key as 400 "API key not valid" as well as 401/403.
      if (status === 401 || status === 403 || (status === 400 && /api key not valid|api_key_invalid|expired/.test(message))) {
        this.pool.markInvalid(key);
        credentialFailures++;
        continue; // the next key, if there is one; the pool throws when none is left
      }
      if (status === 429 || /resource_exhausted|quota/.test(message)) {
        // "limit: 0 ... on Free Tier" is a plan limit, not a busy moment: say so instead of inviting retries.
        if (/limit: 0\b|free tier/.test(message)) {
          this.pool.markRateLimited(key, 5 * 60_000);
          this.billingUntil = Date.now() + 5 * 60_000;
          throw new ImageProviderError("billing_required", "This Google project has no image-generation quota on its current plan.", undefined, errorBody.slice(0, 400));
        }
        const seconds = retryAfter(response);
        this.pool.markRateLimited(key, (seconds ?? 60) * 1000);
        throw new ImageProviderError("rate_limited", "The image service is busy or the quota is used up. Try again later.", seconds ?? 60, errorBody.slice(0, 400));
      }
      if (status === 404) {
        throw new ImageProviderError("not_configured", `The image model "${this.model}" is not available for this API key. Set GEMINI_IMAGE_MODEL to a supported model.`);
      }
      if (status === 400 || status === 422) {
        if (/safety|blocked|prohibited|policy/.test(message)) throw new ImageProviderError("blocked", "Gemini declined this request. Rephrase the description and try again.", undefined, errorBody.slice(0, 400));
        throw new ImageProviderError("invalid_request", "Gemini could not process this request.", undefined, errorBody.slice(0, 400));
      }
      if (status >= 500 || status === 408) {
        if (transientFailures >= MAX_TRANSIENT_RETRIES) throw new ImageProviderError("unavailable", "The image service is temporarily unavailable.");
        await this.backoff(transientFailures++);
        continue;
      }
      throw new ImageProviderError("unavailable", "The image service returned an unexpected error.");
    }
  }

  private async backoff(attempt: number): Promise<void> {
    await this.sleep(BACKOFF_BASE_MS * 2 ** attempt + Math.floor(Math.random() * 250));
  }

  private parse(text: string): GeneratedImage {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new ImageProviderError("bad_response", "The image service sent an unreadable response.");
    }
    const images = collectImages(json);
    if (images.length === 0) {
      const said = collectText(json).join(" ").toLowerCase();
      if (/safety|cannot|can't|unable|policy|not able/.test(said)) throw new ImageProviderError("blocked", "Gemini declined to create this image. Rephrase the description and try again.");
      throw new ImageProviderError("bad_response", "Gemini did not return an image. Try again.");
    }
    const bytes = Buffer.from(images[images.length - 1], "base64");
    const mimeType = sniffImage(bytes);
    if (!mimeType || bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) throw new ImageProviderError("bad_response", "Gemini returned a file that is not a usable image.");
    return { bytes, mimeType, model: this.model };
  }
}

let shared: GeminiImageProvider | null = null;
/** One provider per server process, so key cooldowns are remembered between requests. */
export function getGeminiImageProvider(): GeminiImageProvider {
  shared ??= new GeminiImageProvider();
  return shared;
}
