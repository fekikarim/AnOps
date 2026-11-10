import type { AiAccessState } from "@/server/ai/access/access.service";
import type { CommandDto } from "@/server/ai/commands";
import type { ConversationSummaryDto } from "@/server/ai/conversation.service";
import type { AuditNoticeDto } from "@/server/ai/transcript-audit.service";
import type { AiModuleKey, AiOperation } from "@/shared/domain/ai";

export type { AccessMemberDto, AiAccessState, AiGrantView, AiSettingsView } from "@/server/ai/access/access.service";
export type { CommandDto } from "@/server/ai/commands";
export type { ConversationDto, ConversationSummaryDto, MessageDto } from "@/server/ai/conversation.service";
export type { PendingActionView } from "@/server/ai/pending-actions.service";
export type { AuditNoticeDto } from "@/server/ai/transcript-audit.service";
export type { UsageSummaryDto } from "@/server/ai/usage.service";

/** Everything the /ai page needs for first paint, resolved on the server. */
export type AiWorkspaceState = {
  state: AiAccessState;
  canManageAccess: boolean;
  canAuditTranscripts: boolean;
  commands: CommandDto[];
  conversations: ConversationSummaryDto[];
  notices: AuditNoticeDto[];
  modules: { module: AiModuleKey; operations: AiOperation[] }[];
  tokenCap: number;
  usedToday: number;
};
