import "server-only";
import { ObjectId } from "mongodb";
import { loadLiveMember, type AiAccess, type AiActorContext } from "@/server/ai/access/access.service";
import type { AiCompletionOptions, AiCompletionResult } from "@/server/ai/types";
import { aiScope } from "@/server/ai/data/scope";
import { aiPricing, companyCostLimitAsTokens, estimateCost } from "@/server/ai/platform";
import { PERMISSIONS } from "@/server/security/permissions";
import { AppError } from "@/shared/lib/errors";

const MONGO_DUPLICATE_KEY = 11000;
const USAGE_ROW_RETENTION_DAYS = 400;
const DAY_MS = 86_400_000;

export function utcDay(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export type TokenReservation = { day: string; estimate: number };

/**
 * Adds `estimate` tokens to one day row, but only while the row stays within `cap` (0 = no cap).
 * The check and the increment are one atomic update, so two concurrent requests cannot both pass
 * a cap that only has room for one.
 */
async function reserveRow(
  rows: ReturnType<typeof aiScope>["usage"],
  day: string,
  estimate: number,
  cap: number
): Promise<boolean> {
  if (cap > 0 && estimate > cap) return false;
  const filter = cap > 0 ? { day, tokens: { $lte: cap - estimate } } : { day };
  const update = { $inc: { tokens: estimate, requests: 1 }, $set: { updatedAt: new Date() } };
  try {
    await rows.updateOne(filter, { ...update, $setOnInsert: { _id: new ObjectId(), toolCalls: 0, errors: 0, expiresAt: new Date(Date.now() + USAGE_ROW_RETENTION_DAYS * DAY_MS) } }, { upsert: true });
    return true;
  } catch (error) {
    if ((error as { code?: number } | null)?.code !== MONGO_DUPLICATE_KEY) throw error;
    // The upsert tried to insert a row that already exists. Either another request created today's row a
    // moment ago (there may be room), or the cap really is exhausted (the filter missed). A plain
    // conditional update tells the two apart without creating anything.
    const retry = await rows.updateOne(filter, update);
    return retry.matchedCount === 1;
  }
}

/**
 * Reserves an estimate against the member's daily cap and the company's daily budget before the
 * model is called. If the company budget refuses, the member's reservation is returned.
 */
export async function reserveTokens(ctx: AiActorContext, access: AiAccess, estimate: number): Promise<TokenReservation> {
  const day = utcDay();
  const scope = aiScope(ctx);
  const memberOk = await reserveRow(scope.usage, day, estimate, access.tokenCap);
  if (!memberOk) throw new AppError("RATE_LIMITED", "You have reached your daily AI limit. It resets at midnight UTC, or ask an administrator to raise it.");
  // The company limit is the tighter of the configured token budget and the optional daily spending cap (as tokens).
  const budgets = [access.settings.dailyTokenBudget, companyCostLimitAsTokens()].filter((n) => n > 0);
  const companyOk = await reserveRow(scope.companyUsage, day, estimate, budgets.length ? Math.min(...budgets) : 0);
  if (!companyOk) {
    await scope.usage.updateOne({ day }, { $inc: { tokens: -estimate, requests: -1 } });
    throw new AppError("RATE_LIMITED", "Your company has reached its daily AI limit. Try again tomorrow or ask an administrator.");
  }
  return { day, estimate };
}

/** Replaces the estimate with the real count once the provider answered, and records tool calls and errors. */
export async function settleTokens(
  ctx: AiActorContext,
  reservation: TokenReservation,
  outcome: { actualTokens: number | null; toolCalls?: number; errors?: number; calls?: { provider: string; model: string; tokens: number }[] }
): Promise<void> {
  const diff = (outcome.actualTokens ?? reservation.estimate) - reservation.estimate;
  const scope = aiScope(ctx);
  const set = { $set: { updatedAt: new Date() } };
  await scope.usage.updateOne(
    { day: reservation.day },
    { $inc: { tokens: diff, toolCalls: outcome.toolCalls ?? 0, errors: outcome.errors ?? 0 }, ...set }
  );
  await scope.companyUsage.updateOne({ day: reservation.day }, { $inc: { tokens: diff }, ...set });
  // Measured usage per provider and model: only what the provider reported, never an estimate.
  for (const call of outcome.calls ?? []) {
    if (!(call.tokens > 0)) continue;
    await scope.usageModels.updateOne(
      { day: reservation.day, provider: call.provider, model: call.model },
      { $inc: { tokens: call.tokens, calls: 1 }, $set: { updatedAt: new Date(), expiresAt: new Date(Date.now() + USAGE_ROW_RETENTION_DAYS * DAY_MS) }, $setOnInsert: { _id: new ObjectId() } },
      { upsert: true }
    ).catch(() => undefined);
  }
}

export async function getMyUsageToday(ctx: AiActorContext): Promise<{ tokens: number; requests: number }> {
  const row = await aiScope(ctx).usage.findOne({ day: utcDay() });
  return { tokens: row?.tokens ?? 0, requests: row?.requests ?? 0 };
}

export type UsageSummaryDto = {
  today: { tokens: number; requests: number; budget: number; /** Estimate from the configured price. null when no price is set. */ estimatedCost: { amount: number; currency: string } | null };
  /** Measured tokens per provider and model over the last 7 days. */
  byModel: { provider: string; model: string; tokens: number; calls: number }[];
  /** True when AI_PRICE_PER_1K_TOKENS is configured: any cost shown is an estimate from that price, not a bill. */
  priced: boolean;
  members: { userId: string; tokens: number; requests: number; toolCalls: number; errors: number }[];
  last7Days: { day: string; tokens: number }[];
};

/** Counters only, never content. Requires ai.usage.view, checked against the live role. */
export async function getCompanyUsageSummary(ctx: AiActorContext, budget: number): Promise<UsageSummaryDto> {
  const member = await loadLiveMember(ctx.db, ctx.companyId, ctx.userId);
  if (!member || !member.permissions.has(PERMISSIONS.AI_USAGE_VIEW)) {
    throw new AppError("FORBIDDEN", "You do not have permission to view AI usage.");
  }
  const scope = aiScope(ctx);
  const today = utcDay();
  const since = utcDay(new Date(Date.now() - 6 * 86_400_000));
  const [companyRows, memberRows, modelRows] = await Promise.all([
    scope.companyUsage.find({ day: { $gte: since } }, { sort: { day: 1 } }).toArray(),
    scope.usageForAdmin.find({ day: today }, { sort: { tokens: -1 }, limit: 100 }).toArray(),
    scope.usageModels.find({ day: { $gte: since } }).toArray(),
  ]);
  const byModel = new Map<string, { provider: string; model: string; tokens: number; calls: number }>();
  for (const r of modelRows) {
    const key = `${r.provider}/${r.model}`;
    const row = byModel.get(key) ?? { provider: r.provider, model: r.model, tokens: 0, calls: 0 };
    row.tokens += r.tokens;
    row.calls += r.calls;
    byModel.set(key, row);
  }
  const todayRow = companyRows.find((r) => r.day === today);
  return {
    today: { tokens: todayRow?.tokens ?? 0, requests: todayRow?.requests ?? 0, budget, estimatedCost: estimateCost(todayRow?.tokens ?? 0) },
    byModel: [...byModel.values()].sort((a, b) => b.tokens - a.tokens),
    priced: aiPricing() !== null,
    members: memberRows.map((r) => ({
      userId: r.userId!.toHexString(),
      tokens: r.tokens,
      requests: r.requests,
      toolCalls: r.toolCalls,
      errors: r.errors,
    })),
    last7Days: companyRows.map((r) => ({ day: r.day, tokens: r.tokens })),
  };
}

/** Wraps a completion function so every provider call's measured usage is kept. Nothing is estimated here. */
export function trackCalls(complete: (options: AiCompletionOptions) => Promise<AiCompletionResult>) {
  const calls: { provider: string; model: string; tokens: number }[] = [];
  return {
    calls,
    complete: async (options: AiCompletionOptions): Promise<AiCompletionResult> => {
      const result = await complete(options);
      calls.push({ provider: result.provider, model: result.model, tokens: result.usage?.totalTokens ?? 0 });
      return result;
    },
  };
}
