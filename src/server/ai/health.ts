import "server-only";
import type { Db } from "mongodb";
import { ai } from "@/server/ai";
import { aiPricing, companyCostLimitAsTokens, isAiKillSwitchOn } from "@/server/ai/platform";
import { supportsTransactions } from "@/server/db/transactions";

/** Yes/no facts an operator needs before and during a release. Never a key, a host or a value. */
export type AiHealth = {
  ok: boolean;
  killSwitchOn: boolean;
  providers: { name: string; configured: boolean }[];
  anyProviderConfigured: boolean;
  priceConfigured: boolean;
  companyCostLimitConfigured: boolean;
  transactionsSupported: boolean;
  problems: string[];
};

export async function getAiHealth(db: Db): Promise<AiHealth> {
  const providers = ai.status().map((p) => ({ name: p.name, configured: p.available }));
  const transactionsSupported = await supportsTransactions(db);
  const killSwitchOn = isAiKillSwitchOn();
  const problems: string[] = [];
  if (!providers.some((p) => p.configured)) problems.push("No AI provider is configured (set GROQ_API_KEYS, OPENROUTER_API_KEY or GEMINI_API_KEYS).");
  if (!transactionsSupported) problems.push("MongoDB does not support transactions. AI access changes, conversation deletion and several module workflows need a replica set.");
  if (killSwitchOn) problems.push("AI_KILL_SWITCH is on: all AI is blocked.");
  if (companyCostLimitAsTokens() > 0 && !aiPricing()) problems.push("AI_COMPANY_DAILY_COST_LIMIT needs AI_PRICE_PER_1K_TOKENS.");
  return {
    ok: problems.length === 0,
    killSwitchOn,
    providers,
    anyProviderConfigured: providers.some((p) => p.configured),
    priceConfigured: aiPricing() !== null,
    companyCostLimitConfigured: companyCostLimitAsTokens() > 0,
    transactionsSupported,
    problems,
  };
}

/**
 * What an organization's owner or admin may see: whether AI can run right now. No provider names, no variable names,
 * no limits or database facts: those are for the platform operator (use getAiHealth in scripts, never over HTTP).
 */
export type TenantAiHealth = { available: boolean; paused: boolean };

export function toTenantHealth(health: AiHealth): TenantAiHealth {
  return { available: health.anyProviderConfigured && !health.killSwitchOn, paused: health.killSwitchOn };
}
