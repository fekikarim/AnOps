import "server-only";
import { headers } from "next/headers";
import type { Db } from "mongodb";
import { consumeSharedRateLimit } from "@/server/security/shared-rate-limit";
import { isAppError } from "@/shared/lib/errors";

const MINUTE = 60_000;

/** Best-effort caller address (first hop of x-forwarded-for, set by the platform proxy). Used only for throttling keys. */
export function ipFromHeaders(h: { get(name: string): string | null }): string {
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim().slice(0, 64);
}

export async function requestIp(): Promise<string> {
  return ipFromHeaders(await headers());
}

/**
 * Limits for the public, unauthenticated entry points. Counters live in MongoDB (shared by every instance).
 * Returns false when any limit is exceeded, so callers can answer generically without revealing which key tripped.
 * Both the address+account pair and the account alone are limited, so one attacker cannot lock a victim out
 * from everywhere with a single address, yet a distributed guessing run still hits the account ceiling.
 */
export async function allowAuthAttempt(
  db: Db,
  scope: "login" | "password-reset" | "register" | "verify-resend",
  ip: string,
  email: string,
  limits: { pair: number; account: number; ip: number; windowMs?: number }
): Promise<boolean> {
  const windowMs = limits.windowMs ?? 15 * MINUTE;
  try {
    await consumeSharedRateLimit(db, `${scope}:pair:${ip}:${email}`, limits.pair, windowMs);
    await consumeSharedRateLimit(db, `${scope}:account:${email}`, limits.account, windowMs);
    await consumeSharedRateLimit(db, `${scope}:ip:${ip}`, limits.ip, windowMs);
    return true;
  } catch (error) {
    if (isAppError(error) && error.code === "RATE_LIMITED") return false;
    throw error;
  }
}
