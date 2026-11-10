import type { Metadata } from "next";
import { PERMISSIONS } from "@/server/security/permissions";
import { getPageWorkspace } from "@/server/tenancy/workspace";
import { resolveAiAccess } from "@/server/ai/access/access.service";
import { commandRegistry } from "@/server/ai/commands";
import { listConversations } from "@/server/ai/conversation.service";
import { listMyNotices } from "@/server/ai/transcript-audit.service";
import { getMyUsageToday } from "@/server/ai/usage.service";
import { AI_MODULES, AI_OPERATIONS } from "@/server/ai/access/capabilities";
import { AiWorkspace } from "@/features/ai/components/ai-workspace";
import type { AiWorkspaceState } from "@/features/ai/types";

export const metadata: Metadata = { title: "AnOps AI | AnOps ERP" };

export default async function AiPage() {
  const ctx = await getPageWorkspace();
  const access = await resolveAiAccess(ctx);
  const ready = access.state === "ready";
  const [conversations, notices, usage] = ready
    ? await Promise.all([listConversations(ctx), listMyNotices(ctx), getMyUsageToday(ctx)])
    : [[], [], { tokens: 0, requests: 0 }];

  const initial: AiWorkspaceState = {
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

  return <AiWorkspace initial={initial} />;
}
