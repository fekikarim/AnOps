import "server-only";

/**
 * Round-robin key pool with automatic failover on 429.
 *
 * Parses a comma-separated env string (e.g. GROQ_API_KEYS="k1,k2,k3")
 * and tracks which index to try next. When a key hits a 429 it is
 * temporarily marked as rate-limited for COOLDOWN_MS and the pool
 * moves to the next available key.
 */

const COOLDOWN_MS = 60_000; // 1 minute cooldown per key after 429
const INVALID_COOLDOWN_MS = 30 * 60_000; // a rejected key is skipped for 30 minutes

type KeyState = {
  key: string;
  rateLimitedUntil: number; // epoch ms; 0 = available
};

export class KeyPool {
  private keys: KeyState[];
  private cursor = 0;

  constructor(envValue: string | undefined) {
    const raw = (envValue ?? "")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);

    this.keys = raw.map((key) => ({ key, rateLimitedUntil: 0 }));
  }

  /** True if at least one key is configured (may still be rate-limited). */
  get hasKeys(): boolean {
    return this.keys.length > 0;
  }

  /**
   * Returns the next available API key, cycling from the last used index.
   * Throws if all keys are currently rate-limited.
   */
  next(): string {
    const now = Date.now();
    const total = this.keys.length;

    for (let i = 0; i < total; i++) {
      const idx = (this.cursor + i) % total;
      const state = this.keys[idx];

      if (state.rateLimitedUntil <= now) {
        // Advance cursor so the NEXT call picks the following key
        this.cursor = (idx + 1) % total;
        return state.key;
      }
    }

    const soonestMs = Math.min(...this.keys.map((k) => k.rateLimitedUntil));
    const waitSec = Math.ceil((soonestMs - now) / 1000);
    throw new Error(
      `All ${total} API key(s) are rate-limited. Retry in ~${waitSec}s.`
    );
  }

  /**
   * Mark the given key as rate-limited for COOLDOWN_MS.
   * Call this when you receive a 429 response.
   */
  markRateLimited(key: string, cooldownMs: number = COOLDOWN_MS): void {
    const state = this.keys.find((k) => k.key === key);
    if (state) {
      state.rateLimitedUntil = Date.now() + cooldownMs;
      console.warn(
        `[KeyPool] Key ...${key.slice(-6)} rate-limited for ${Math.round(cooldownMs / 1000)}s`
      );
    }
  }

  /** A key the provider rejected as invalid or not permitted: skipped for a long time instead of being retried on every request. */
  markInvalid(key: string, cooldownMs: number = INVALID_COOLDOWN_MS): void {
    const state = this.keys.find((k) => k.key === key);
    if (state) {
      state.rateLimitedUntil = Date.now() + cooldownMs;
      console.warn(`[KeyPool] Key ...${key.slice(-4)} rejected by the provider; skipped for ${Math.round(cooldownMs / 60_000)} min`);
    }
  }

  /** Seconds until the soonest key is usable again (0 when one is usable now). */
  get secondsUntilAvailable(): number {
    if (this.keys.length === 0 || this.availableCount > 0) return 0;
    return Math.max(1, Math.ceil((Math.min(...this.keys.map((k) => k.rateLimitedUntil)) - Date.now()) / 1000));
  }

  /** True when every key is currently unavailable. */
  get exhausted(): boolean {
    return this.keys.length > 0 && this.availableCount === 0;
  }

  /** How many keys are currently available (not rate-limited). */
  get availableCount(): number {
    const now = Date.now();
    return this.keys.filter((k) => k.rateLimitedUntil <= now).length;
  }
}
