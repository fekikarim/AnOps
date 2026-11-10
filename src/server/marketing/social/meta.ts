import "server-only";
import { createHash, randomBytes } from "crypto";
import { z } from "zod";
import { META_GRAPH_VERSION, META_PAGE_SCOPES, type SocialConfig } from "@/server/marketing/config";

/**
 * Meta (Facebook Pages) Graph API adapter. Scope is deliberately limited to Facebook Pages: Instagram
 * publishing needs its own app review and account linkage, so it is not requested.
 *
 * Tokens travel only in Authorization headers, except the OAuth code exchange, which Meta requires as query
 * parameters over HTTPS. Error values never contain request or response bodies, so tokens cannot leak
 * into logs through an error message.
 */
const GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
const DIALOG = `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`;
export const META_TIMEOUT_MS = 10_000;

export class MetaApiError extends Error {
  readonly code: string;
  /** True only when the provider certainly did not process the request (for example HTTP 429). */
  readonly notProcessed: boolean;
  readonly reauthorize: boolean;

  constructor(code: string, message: string, options: { notProcessed: boolean; reauthorize?: boolean }) {
    super(message);
    this.name = "MetaApiError";
    this.code = code;
    this.notProcessed = options.notProcessed;
    this.reauthorize = options.reauthorize ?? false;
  }
}

/** High-entropy, single-use state. Only its SHA-256 is stored server-side. */
export function generateOauthState(): string {
  return randomBytes(32).toString("base64url");
}

export function hashOauthState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

export function buildAuthorizationUrl(config: { appId: string }, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: config.appId,
    redirect_uri: redirectUri,
    state,
    response_type: "code",
    scope: META_PAGE_SCOPES.join(","),
  });
  return `${DIALOG}?${params.toString()}`;
}

const tokenResponse = z.object({ access_token: z.string().min(1).max(4096) }).passthrough();
const pagesResponse = z
  .object({
    data: z
      .array(
        z
          .object({
            id: z.string().regex(/^\d{1,30}$/),
            name: z.string().max(200),
            access_token: z.string().min(1).max(4096),
            tasks: z.array(z.string()).optional(),
          })
          .passthrough()
      )
      .max(200),
  })
  .passthrough();
const postResponse = z.object({ id: z.string().min(1).max(200) }).passthrough();

async function call(url: string, init: RequestInit & { label: string }): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(META_TIMEOUT_MS) });
  } catch {
    throw new MetaApiError("NETWORK_OR_TIMEOUT", `${init.label} did not complete`, { notProcessed: false });
  }
  if (response.status === 429) {
    throw new MetaApiError("RATE_LIMITED", `${init.label} was rate limited`, { notProcessed: true });
  }
  if (response.status >= 500) {
    throw new MetaApiError("PROVIDER_UNAVAILABLE", `${init.label} failed on the provider side`, { notProcessed: false });
  }
  if (!response.ok) {
    const reauthorize = response.status === 401 || response.status === 403;
    throw new MetaApiError(reauthorize ? "AUTHORIZATION_REJECTED" : "REQUEST_REJECTED", `${init.label} was rejected`, {
      notProcessed: true,
      reauthorize,
    });
  }
  try {
    return await response.json();
  } catch {
    throw new MetaApiError("INVALID_RESPONSE", `${init.label} returned an unreadable response`, { notProcessed: false });
  }
}

function parse<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new MetaApiError("INVALID_RESPONSE", `${label} returned an unexpected response`, { notProcessed: false });
  return result.data;
}

export async function exchangeCodeForToken(config: SocialConfig, redirectUri: string, code: string): Promise<string> {
  const params = new URLSearchParams({
    client_id: config.appId ?? "",
    client_secret: config.appSecret ?? "",
    redirect_uri: redirectUri,
    code,
  });
  const body = await call(`${GRAPH}/oauth/access_token?${params.toString()}`, { method: "GET", label: "Token exchange" });
  return parse(tokenResponse, body, "Token exchange").access_token;
}

/** Exchanges a short-lived user token for a long-lived one. Page tokens derived from it do not expire unless revoked. */
export async function exchangeForLongLivedToken(config: SocialConfig, shortToken: string): Promise<string> {
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: config.appId ?? "",
    client_secret: config.appSecret ?? "",
    fb_exchange_token: shortToken,
  });
  const body = await call(`${GRAPH}/oauth/access_token?${params.toString()}`, { method: "GET", label: "Token upgrade" });
  return parse(tokenResponse, body, "Token upgrade").access_token;
}

export async function listManagedPages(userToken: string): Promise<{ id: string; name: string; accessToken: string; tasks: string[] }[]> {
  const body = await call(`${GRAPH}/me/accounts?fields=id,name,access_token,tasks`, {
    method: "GET",
    label: "Page listing",
    headers: { Authorization: `Bearer ${userToken}` },
  });
  return parse(pagesResponse, body, "Page listing").data.map((page) => ({
    id: page.id,
    name: page.name,
    accessToken: page.access_token,
    tasks: page.tasks ?? [],
  }));
}

/** Publishes a text post to a Facebook Page. Meta offers no idempotency key here, which is why the caller never retries ambiguous results. */
export async function publishPagePost(pageId: string, pageToken: string, message: string): Promise<{ externalPostId: string }> {
  const body = await call(`${GRAPH}/${encodeURIComponent(pageId)}/feed`, {
    method: "POST",
    label: "Page publishing",
    headers: { Authorization: `Bearer ${pageToken}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ message }).toString(),
  });
  return { externalPostId: parse(postResponse, body, "Page publishing").id };
}
