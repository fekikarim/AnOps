import "server-only";
import { createHash, randomBytes } from "crypto";

/**
 * Opaque single-use tokens. Only the SHA-256 hash is stored, so a database read never reveals a
 * usable link. Tokens carry no organization or user identifiers.
 */
export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Tokens are 43 base64url characters; reject anything else before touching the database. */
export function isWellFormedToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}
