import "server-only";

/**
 * Platform-level AI switches, read from the environment on every call so a change takes effect on the next request
 * without a code change. Nothing here is per company: company switches live in AI settings.
 */

const TRUE = new Set(["1", "true", "yes", "on"]);

/** AI_KILL_SWITCH=true blocks every AI execution for every company: chat, commands, drafts, confirmations and the legacy AI features. */
export function isAiKillSwitchOn(): boolean {
  return TRUE.has((process.env.AI_KILL_SWITCH ?? "").trim().toLowerCase());
}

export type AiPricing = { per1kTokens: number; currency: string };

/**
 * Optional estimate price. AI_PRICE_PER_1K_TOKENS is the cost of 1,000 measured tokens in AI_PRICE_CURRENCY (default USD).
 * Providers on a free tier have no price, so without it no cost is ever shown. Anything derived from it is an estimate.
 */
export function aiPricing(): AiPricing | null {
  const price = Number(process.env.AI_PRICE_PER_1K_TOKENS);
  if (!Number.isFinite(price) || price <= 0) return null;
  const currency = (process.env.AI_PRICE_CURRENCY ?? "USD").trim().toUpperCase().slice(0, 3) || "USD";
  return { per1kTokens: price, currency };
}

/** Estimated cost of a measured token count, or null when no price is configured. */
export function estimateCost(tokens: number): { amount: number; currency: string } | null {
  const pricing = aiPricing();
  if (!pricing) return null;
  return { amount: Math.round((tokens / 1000) * pricing.per1kTokens * 10_000) / 10_000, currency: pricing.currency };
}

/**
 * Optional company-wide daily spending cap in the price currency (AI_COMPANY_DAILY_COST_LIMIT). It only applies when a price is
 * set, and it is enforced as the equivalent number of tokens, so it works with the same atomic budget as the token limit.
 */
export function companyCostLimitAsTokens(): number {
  const pricing = aiPricing();
  const limit = Number(process.env.AI_COMPANY_DAILY_COST_LIMIT);
  if (!pricing || !Number.isFinite(limit) || limit <= 0) return 0;
  return Math.max(1, Math.floor((limit / pricing.per1kTokens) * 1000));
}

/** Most provider calls one chat turn may make (steps x structured-completion calls), so a loop cannot burn the budget. */
export const MAX_PROVIDER_CALLS_PER_TURN = 8;

/** Shown in conversation history in place of cards that carry payroll or payslip figures. The person still sees them live. */
export const SENSITIVE_PLACEHOLDER = "HR data was shown here. It is not kept in conversation history.";
