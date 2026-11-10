import { isAppError } from "@/shared/lib/errors";

/**
 * Loads list data for a page so a failed request can render an error state instead of looking like an empty table.
 * Authorization and not-found errors still propagate to the framework's own handling.
 */
export async function safeLoad<T>(load: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false }> {
  try {
    return { ok: true, data: await load() };
  } catch (error) {
    // Next.js control-flow signals (redirect, notFound) must keep propagating.
    if (typeof (error as { digest?: unknown } | null)?.digest === "string") throw error;
    if (isAppError(error) && ["UNAUTHENTICATED", "NO_COMPANY", "FORBIDDEN", "NOT_FOUND"].includes(error.code)) throw error;
    console.error("List request failed", error instanceof Error ? error.message : error);
    return { ok: false };
  }
}
