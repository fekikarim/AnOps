import "server-only";

/**
 * GEMINI_API_KEYS="key1,key2,key3". Every entry is validated before use: a mistyped list (a missing comma joins two keys
 * into one long string) must not be sent to Google as a "key", and nothing about a key's value is ever shown or logged.
 */
const KEY_SHAPE = /^[A-Za-z0-9._-]{20,100}$/;
const MULTIPLE_KEYS = /(AQ\.|AIza).+(AQ\.|AIza)/;

export type ParsedKeys = { keys: string[]; invalidCount: number };

export function parseGeminiKeys(raw: string | undefined): ParsedKeys {
  const entries = (raw ?? "")
    .split(",")
    .map((entry) => entry.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
  const keys: string[] = [];
  let invalidCount = 0;
  for (const entry of entries) {
    if (KEY_SHAPE.test(entry) && !MULTIPLE_KEYS.test(entry)) keys.push(entry);
    else invalidCount++;
  }
  // The same key twice is one key: duplicates would only multiply attempts against the same quota.
  return { keys: [...new Set(keys)], invalidCount };
}
