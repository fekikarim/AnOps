"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuthUser, type CurrentAuthContext } from "@/server/auth/rbac";
import { resolveAiAccess, assertAiReady } from "@/server/ai/access/access.service";
import { gatedChat } from "@/server/ai/gate";
import { resolveWorkspace } from "@/server/tenancy/workspace";
import { assertWorkspaceAppAccess } from "@/server/platform/access";
import { isAppError } from "@/shared/lib/errors";
import { consumeSharedRateLimit } from "@/server/security/shared-rate-limit";
import { cancelPendingAction, confirmPendingAction } from "@/server/services/hr-ai.service";
import { runCopilotTurn } from "@/features/hr/ai/hr-copilot";
import type { ToolContext } from "@/features/hr/ai/tool-registry";
import type { AiActionResult, ConfirmationCard, CopilotSources } from "@/features/hr/ai/types";

const CHAT_LIMIT_PER_MINUTE = 20;
const UNAVAILABLE = "AI is temporarily unavailable. Please try again.";

const chatSchema = z.object({
  userMessage: z.string().trim().min(1).max(2000),
  conversationId: z.string().max(64).optional(),
  uiLanguage: z.string().max(20).optional(),
  /** Model and provider chosen in the UI selector. Omit for task routing. The provider must be a known one; the gate still applies. */
  model: z.string().regex(/^[\w./:-]{1,120}$/).optional(),
  provider: z.enum(["auto", "groq", "openrouter", "gemini"]).optional(),
  history: z
    .array(z.object({ role: z.string().max(20), content: z.string().max(20_000) }))
    .max(100)
    .optional()
    .default([]),
});

export type CopilotChatResult =
  | {
      ok: true;
      text: string;
      provider?: string;
      model?: string;
      cards: ConfirmationCard[];
      sources: CopilotSources;
      balanceCard?: Record<string, unknown>;
    }
  | { ok: false; error: string };

/** Identity, company and role come from the session only. The client never supplies them. */
function toolContext(authUser: CurrentAuthContext, conversationId?: string): ToolContext {
  return {
    userId: authUser.userId,
    employeeId: authUser.employee?.id,
    companyId: authUser.companyId,
    role: authUser.role,
    actorName: authUser.employee?.fullName || authUser.email,
    conversationId,
  };
}

export async function chatWithHRAssistantAction(rawData: unknown): Promise<CopilotChatResult> {
  try {
    const authUser = await requireAuthUser("hr-payroll");
    const ws = await resolveWorkspace();
    await assertWorkspaceAppAccess(ws, "hr-payroll");
    await consumeSharedRateLimit(ws.db, `user:${ws.userId.toHexString()}:hr-copilot`, CHAT_LIMIT_PER_MINUTE, 60_000);

    const parsed = chatSchema.safeParse(rawData);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
    }

    const { userMessage, conversationId, uiLanguage, model, provider, history } = parsed.data;
    // Every model call of the copilot goes through the AI gate. Payroll tools exist only with the sensitive-HR switch.
    const access = await resolveAiAccess(ws);
    assertAiReady(access);
    const reply = await runCopilotTurn(toolContext(authUser, conversationId), {
      chat: (options) => gatedChat(ws, { module: "hr", operation: "view", feature: "hr.copilot" }, options),
      includePayroll: access.grant.canViewSensitiveHr,
      message: userMessage,
      history,
      uiLanguage,
      model,
      provider,
    });

    console.info(`[hr-copilot] turn used ${reply.tokens} tokens (${reply.provider ?? "no LLM"})`);
    return {
      ok: true,
      text: reply.text,
      provider: reply.provider,
      model: reply.model,
      cards: reply.cards,
      sources: reply.sources,
      balanceCard: reply.balanceCard,
    };
  } catch (err) {
    // Refusals by the AI gate (no access, switched off, limits) are shown as they are; anything else is a fixed message.
    if (isAppError(err)) return { ok: false, error: err.message };
    console.error("[chatWithHRAssistantAction]", err instanceof Error ? err.message : "unknown");
    return { ok: false, error: UNAVAILABLE };
  }
}

const actionIdSchema = z.string().min(1).max(64);

/** Executes a confirmed action. Takes only its id: the stored, validated payload is what runs. */
export async function confirmAiActionAction(actionId: unknown): Promise<AiActionResult> {
  try {
    const authUser = await requireAuthUser("hr-payroll");
    // A change proposed by the copilot is an AI execution: it stops with the kill switch and the company switch.
    assertAiReady(await resolveAiAccess(await resolveWorkspace()));
    const id = actionIdSchema.safeParse(actionId);
    if (!id.success) return { ok: false, error: "Action not found." };
    const result = await confirmPendingAction(id.data, toolContext(authUser));
    if (result.ok) revalidatePath("/hr");
    return result;
  } catch (err) {
    if (isAppError(err)) return { ok: false, error: err.message };
    console.error("[confirmAiActionAction]", err instanceof Error ? err.name : "unknown");
    return { ok: false, error: "The action could not be completed. Please try again." };
  }
}

export async function cancelAiActionAction(actionId: unknown): Promise<AiActionResult> {
  try {
    const authUser = await requireAuthUser("hr-payroll");
    const id = actionIdSchema.safeParse(actionId);
    if (!id.success) return { ok: false, error: "Action not found." };
    return await cancelPendingAction(id.data, toolContext(authUser));
  } catch (err) {
    console.error("[cancelAiActionAction]", err instanceof Error ? err.name : "unknown");
    return { ok: false, error: "The action could not be cancelled. Please try again." };
  }
}
