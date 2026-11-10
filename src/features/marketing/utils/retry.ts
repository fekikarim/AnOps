/**
 * Exponential backoff with full jitter, capped. `attempt` starts at 1 for the first retry.
 * The random source is injectable so tests stay deterministic.
 */
export function retryDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = 5_000;
  const cap = 60 * 60 * 1000;
  const exponential = Math.min(cap, base * 2 ** Math.max(0, attempt - 1));
  return Math.floor(random() * exponential);
}
