import "server-only";

/**
 * Reads the Groq key list. `GROQ_API_KEYS` (comma-separated, rotated on 429) is preferred;
 * `GROQ_API_KEY` (single key, as documented in .env) is accepted so a one-key setup works.
 * Returns undefined when neither is set. Keys are never logged or returned to the browser.
 */
export function groqApiKeyList(): string | undefined {
  return process.env.GROQ_API_KEYS?.trim() || process.env.GROQ_API_KEY?.trim() || undefined;
}

/**
 * Optional Groq model override (`GROQ_MODEL`). Undefined uses the provider's default free model.
 * An id Groq does not serve returns 404, and the Groq adapter then retries once with its default model.
 */
export function groqModelOverride(): string | undefined {
  return process.env.GROQ_MODEL?.trim() || undefined;
}

function parseProviderList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
}

/** Optional provider order for a task, e.g. `AI_ROUTE_COPILOT_CHAT=groq,gemini`. Undefined uses the default. */
export function aiRouteOverride(taskType: string): string[] | undefined {
  const list = parseProviderList(process.env[`AI_ROUTE_${taskType.toUpperCase()}`]);
  return list.length ? list : undefined;
}

/** Providers skipped by task routing, e.g. `AI_DISABLED_PROVIDERS=groq`. Used to rehearse a provider outage. */
export function aiDisabledProviders(): string[] {
  return parseProviderList(process.env.AI_DISABLED_PROVIDERS);
}
