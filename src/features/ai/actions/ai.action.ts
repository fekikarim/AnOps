"use server";

import { revalidatePath } from "next/cache";
import { parseInput, runAction } from "@/server/actions/run-action";
import {
  assertAiReady,
  getAiSettings,
  listAccessMembers,
  resolveAiAccess,
  saveMemberGrant,
  updateAiSettings,
  type AccessMemberDto,
  type AiGrantView,
  type AiSettingsView,
} from "@/server/ai/access/access.service";
import { commandRegistry } from "@/server/ai/commands";
import { runCommandStep } from "@/server/ai/command-runner";
import type { CommandResult } from "@/server/ai/commands";
import {
  deleteConversation,
  getConversation,
  listConversations,
  renameConversation,
  type ConversationDto,
  type ConversationSummaryDto,
} from "@/server/ai/conversation.service";
import { cancelPendingAction, confirmAction, type ConfirmResult } from "@/server/ai/pending-actions.service";
import { aiToolRegistry } from "@/server/ai/tools";
import {
  auditListConversations,
  auditReadConversation,
  listMyNotices,
  markNoticesRead,
} from "@/server/ai/transcript-audit.service";
import { getCompanyUsageSummary, getMyUsageToday, type UsageSummaryDto } from "@/server/ai/usage.service";
import { AI_MODULES, AI_OPERATIONS } from "@/server/ai/access/capabilities";
import { objectIdSchema } from "@/shared/lib/schema-primitives";
import { z } from "zod";
import { confirmActionSchema, saveMemberGrantSchema, saveSettingsSchema } from "@/features/ai/schemas/ai.schema";
import type { AiWorkspaceState } from "@/features/ai/types";
import type { ActionResult } from "@/shared/lib/errors";
import { PERMISSIONS } from "@/server/security/permissions";

function refreshAccess(): void {
  revalidatePath("/ai/access");
}

/** First-paint state for /ai. Works even when AI is off, so the page can explain why. */
export async function getAiWorkspaceAction(): Promise<ActionResult<AiWorkspaceState>> {
  return runAction("ai.workspace", async (ctx) => {
    const access = await resolveAiAccess(ctx);
    const ready = access.state === "ready";
    const [conversations, notices, usage] = ready
      ? await Promise.all([listConversations(ctx), listMyNotices(ctx), getMyUsageToday(ctx)])
      : [[], [], { tokens: 0, requests: 0 }];
    return {
      state: access.state,
      canManageAccess: access.member?.permissions.has(PERMISSIONS.AI_ACCESS_MANAGE) ?? false,
      canAuditTranscripts: access.grant.canAuditTranscripts,
      commands: ready ? commandRegistry.listFor(access) : [],
      conversations,
      notices,
      modules: AI_MODULES.map((module) => ({ module, operations: AI_OPERATIONS.filter((op) => access.can(module, op)) })).filter(
        (entry) => entry.operations.length > 0
      ),
      tokenCap: access.tokenCap,
      usedToday: usage.tokens,
    };
  });
}

async function ready(ctx: Parameters<Parameters<typeof runAction>[1]>[0]): Promise<void> {
  assertAiReady(await resolveAiAccess(ctx));
}

export async function listConversationsAction(): Promise<ActionResult<ConversationSummaryDto[]>> {
  return runAction("ai.conversations.list", async (ctx) => {
    await ready(ctx);
    return listConversations(ctx);
  });
}

export async function getConversationAction(id: unknown): Promise<ActionResult<ConversationDto>> {
  return runAction("ai.conversations.get", async (ctx) => {
    await ready(ctx);
    return getConversation(ctx, parseInput(objectIdSchema, id));
  });
}

export async function renameConversationAction(id: unknown, title: unknown): Promise<ActionResult<null>> {
  return runAction("ai.conversations.rename", async (ctx) => {
    await ready(ctx);
    await renameConversation(ctx, parseInput(objectIdSchema, id), parseInput(z.string().max(200), title));
    return null;
  });
}

export async function deleteConversationAction(id: unknown): Promise<ActionResult<null>> {
  return runAction("ai.conversations.delete", async (ctx) => {
    await ready(ctx);
    await deleteConversation(ctx, parseInput(objectIdSchema, id));
    return null;
  });
}

export async function confirmAiActionAction(raw: unknown): Promise<ActionResult<ConfirmResult>> {
  return runAction(
    "ai.action.confirm",
    async (ctx) => confirmAction(ctx, aiToolRegistry, parseInput(confirmActionSchema, raw)),
    { rateLimit: { limit: 30, windowMs: 60_000 } }
  );
}

export async function cancelAiActionAction(id: unknown): Promise<ActionResult<null>> {
  return runAction("ai.action.cancel", async (ctx) => {
    await cancelPendingAction(ctx, parseInput(objectIdSchema, id));
    return null;
  });
}

export async function markNoticesReadAction(): Promise<ActionResult<null>> {
  return runAction("ai.notices.read", async (ctx) => {
    await markNoticesRead(ctx);
    return null;
  });
}

/** One click in a guided flow: a table row, a page change, a card button or a submitted form. */
export async function runAiCommandAction(raw: unknown): Promise<ActionResult<CommandResult>> {
  return runAction("ai.command", (ctx) => runCommandStep(ctx, raw));
}

// ─── Access management (owners and administrators) ─────────────────────────────

export async function getAccessAdminAction(): Promise<ActionResult<{ settings: AiSettingsView; members: AccessMemberDto[]; isOwner: boolean }>> {
  return runAction("ai.access.list", async (ctx) => {
    const members = await listAccessMembers(ctx);
    const settings = await getAiSettings(ctx);
    const self = members.find((m) => m.isSelf);
    return { settings, members, isOwner: self?.companyRole === "owner" };
  });
}

export async function saveMemberGrantAction(raw: unknown): Promise<ActionResult<AiGrantView>> {
  return runAction(
    "ai.access.save",
    async (ctx) => {
      const input = parseInput(saveMemberGrantSchema, raw);
      const saved = await saveMemberGrant(ctx, input.userId, input.grant, input.expectedVersion);
      refreshAccess();
      return saved;
    },
    { rateLimit: { limit: 60, windowMs: 60_000 } }
  );
}

export async function saveAiSettingsAction(raw: unknown): Promise<ActionResult<AiSettingsView>> {
  return runAction(
    "ai.settings.save",
    async (ctx) => {
      const input = parseInput(saveSettingsSchema, raw);
      const saved = await updateAiSettings(ctx, input.settings, input.expectedVersion);
      refreshAccess();
      return saved;
    },
    { rateLimit: { limit: 20, windowMs: 60_000 } }
  );
}

export async function getUsageSummaryAction(): Promise<ActionResult<UsageSummaryDto>> {
  return runAction("ai.usage.summary", async (ctx) => {
    const settings = await getAiSettings(ctx);
    return getCompanyUsageSummary(ctx, settings.dailyTokenBudget);
  });
}

// ─── Transcript audit (explicit permission only) ──────────────────────────────

export async function auditListConversationsAction(userId: unknown): Promise<ActionResult<ConversationSummaryDto[]>> {
  return runAction("ai.audit.list", async (ctx) => auditListConversations(ctx, parseInput(objectIdSchema, userId)), {
    rateLimit: { limit: 30, windowMs: 60_000 },
  });
}

export async function auditReadConversationAction(raw: unknown): Promise<ActionResult<ConversationDto>> {
  return runAction(
    "ai.audit.read",
    async (ctx) => {
      const input = parseInput(z.object({ userId: objectIdSchema, conversationId: objectIdSchema, reason: z.string().max(300) }).strict(), raw);
      return auditReadConversation(ctx, input.userId, input.conversationId, input.reason);
    },
    { rateLimit: { limit: 30, windowMs: 60_000 } }
  );
}
