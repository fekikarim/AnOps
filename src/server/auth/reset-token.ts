import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "crypto";

export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

/** 256 bits from the operating system's CSPRNG, URL-safe. Only the hash below is ever stored. */
export function generateResetToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 of the token as sent to the user. A database leak then reveals nothing that can be replayed. */
export function hashResetToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Constant-time string comparison (both sides are hashed first so lengths never leak). */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

/** "jane.doe@example.com" → "j***@example.com": enough to correlate a log line, not enough to harvest addresses. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "***";
  return `${email[0]}***${email.slice(at)}`;
}
