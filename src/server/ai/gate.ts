import "server-only";
import { ai } from "@/server/ai";
import { assertAiReady, resolveAiAccess, type AiAccess } from "@/server/ai/access/access.service";
import { reserveTokens, settleTokens, trackCalls } from "@/server/ai/usage.service";
import type { AiChatOptions, AiChatResult, AiCompletionOptions, AiCompletionResult } from "@/server/ai/types";
import { consumeSharedRateLimit } from "@/server/security/shared-rate-limit";
import type { WorkspaceContext } from "@/server/tenancy/workspace";
import type { AiModuleKey, AiOperation } from "@/shared/domain/ai";
import { AppError } from "@/shared/lib/errors";

/**
 * The one door to a model for every feature that is not the chat orchestrator or the draft engine (which apply the same
 * controls themselves): the HR assistant, Community summaries and replies, receipt OCR, replenishment rationale and Marketing
 * copy. A test fails if any other file calls the model directly.
 *
 * Before the model is called it requires, in this order: the platform switch and the company switch (resolveAiAccess), the
 * member's own AI grant for the module and operation the feature belongs to, the sensitive-HR switch where salary data is
 * involved, the shared per-user and per-company rate limits, and a reservation against the member's and the company's daily
 * token budget. The measured usage (provider, model, tokens) is settled afterwards, whatever the outcome.
 */
export type GateSpec = {
  module: AiModuleKey;
  operation: AiOperation;
  /** Names the feature in logs and limits, for example "hr.assistant". */
  feature: string;
  /** The prompt carries salary or payroll data, so the member needs the sensitive-HR switch too. */
  sensitiveHr?: boolean;
};

export const MODEL_RATE = { perUser: { limit: 30, windowMs: 60_000 }, perCompany: { limit: 300, windowMs: 60_000 } };

/** Checks everything except the budget. Throws FORBIDDEN, RATE_LIMITED or PROVIDER_NOT_CONFIGURED. Returns the live access. */
export async function authorizeAiUse(ctx: WorkspaceContext, spec: GateSpec, options: { requireProvider?: boolean } = {}): Promise<AiAccess> {
  const access = await resolveAiAccess(ctx);
  assertAiReady(access);
  if (!access.can(spec.module, spec.operation)) throw new AppError("FORBIDDEN", "You do not have AI access for that.");
  if (spec.sensitiveHr && !access.grant.canViewSensitiveHr) throw new AppError("FORBIDDEN", "You do not have access to sensitive HR data through AI.");
  if (options.requireProvider !== false && !ai.status().some((p) => p.available)) {
    throw new AppError("PROVIDER_NOT_CONFIGURED", "AI is not configured on this server. Ask an administrator to add a provider.");
  }
  await consumeSharedRateLimit(ctx.db, `user:${ctx.userId.toHexString()}:ai.model`, MODEL_RATE.perUser.limit, MODEL_RATE.perUser.windowMs, "You are using AI very quickly. Wait a moment and try again.");
  await consumeSharedRateLimit(ctx.db, `company:${ctx.companyId.toHexString()}:ai.model`, MODEL_RATE.perCompany.limit, MODEL_RATE.perCompany.windowMs, "Your company is using AI very quickly. Wait a moment and try again.");
  return access;
}

export async function gatedComplete(
  ctx: WorkspaceContext,
  spec: GateSpec,
  options: Omit<AiCompletionOptions, "signal">,
  deps: { complete?: (o: AiCompletionOptions) => Promise<AiCompletionResult> } = {}
): Promise<AiCompletionResult> {
  const access = await authorizeAiUse(ctx, spec, { requireProvider: !deps.complete });
  // An image or PDF page costs roughly 1,500 input tokens on the vision models.
  const attachmentTokens = options.messages.reduce((n, m) => n + (m.attachments?.length ?? 0), 0) * 1500;
  const estimate = Math.ceil(options.messages.reduce((n, m) => n + m.content.length, 0) / 4) + attachmentTokens + (options.maxTokens ?? 1024);
  const reservation = await reserveTokens(ctx, access, estimate);
  const tracked = trackCalls(deps.complete ?? ((o) => ai.complete(o)));
  let errors = 0;
  try {
    return await tracked.complete(options);
  } catch (error) {
    errors = 1;
    throw error;
  } finally {
    const measured = tracked.calls.length ? tracked.calls.reduce((n, c) => n + c.tokens, 0) : null;
    await settleTokens(ctx, reservation, { actualTokens: errors && measured === null ? null : measured, errors, calls: tracked.calls }).catch(() => undefined);
  }
}

/** The task-routed variant (`ai.chat`): same gate, same budget, same measured usage. */
export async function gatedChat(
  ctx: WorkspaceContext,
  spec: GateSpec,
  options: Omit<AiChatOptions, "signal">,
  deps: { chat?: (o: AiChatOptions) => Promise<AiChatResult> } = {}
): Promise<AiChatResult> {
  const access = await authorizeAiUse(ctx, spec, { requireProvider: !deps.chat });
  const estimate = Math.ceil(options.messages.reduce((n, m) => n + (m.content?.length ?? 0), 0) / 4) + (options.maxTokens ?? 1024);
  const reservation = await reserveTokens(ctx, access, estimate);
  let calls: { provider: string; model: string; tokens: number }[] = [];
  let errors = 0;
  try {
    const result = await (deps.chat ?? ((o) => ai.chat(o)))(options);
    calls = [{ provider: result.provider, model: result.model, tokens: result.usage?.totalTokens ?? 0 }];
    return result;
  } catch (error) {
    errors = 1;
    throw error;
  } finally {
    const measured = calls.length ? calls[0].tokens : null;
    await settleTokens(ctx, reservation, { actualTokens: measured, errors, calls }).catch(() => undefined);
  }
}
