import "server-only";
import type { ZodType } from "zod";
import type { AiAccess } from "@/server/ai/access/access.service";
import type { AiDiffRow, AiMessagePart } from "@/server/db/documents";
import type { Permission } from "@/server/security/permissions";
import type { WorkspaceContext } from "@/server/tenancy/workspace";
import type { AiModuleKey, AiOperation, AiRisk } from "@/shared/domain/ai";

/**
 * A tool is the only way the model can touch AnOps. It is a thin, typed wrapper over an existing
 * service function. Its input schema never contains tenant or identity fields: the company, the user
 * and the permissions come from the server-resolved context passed to run().
 */
export type ToolEnv = {
  /** The live access snapshot taken for this call. */
  access: AiAccess;
};

export type ToolResult = {
  /** One line shown in the tool-status chip and recorded in the audit trail. */
  summary: string;
  /** Structured parts rendered for the user (tables, cards). */
  parts?: AiMessagePart[];
  /** JSON given back to the model. Passed through sanitize(): wrapped as untrusted and size-capped. */
  data?: unknown;
};

/**
 * What a write tool computes on the server before a proposal is stored: the facts the run step will
 * rely on (current version, names), the summary and diff shown to the person, and, for permanent or
 * financial changes, the phrase they must type. Reads happen through the existing services, so
 * company scope and permissions apply exactly as they do on the module's own pages.
 */
export type PreparedWrite = {
  context: Record<string, unknown>;
  summary: string;
  details?: AiDiffRow[];
  typedPhrase?: string | null;
};

export type AiToolDefinition<Input = unknown> = {
  name: string;
  /** "core" tools need no module grant; they exist for every member with AI access. */
  module: AiModuleKey | "core";
  operation: AiOperation;
  kind: "read" | "write";
  risk: AiRisk;
  /** The exact AnOps permission the underlying service asserts, checked here as well. null for core tools. */
  permission: Permission | null;
  /** Needs the separate sensitive-HR switch. */
  sensitive?: "hr";
  description: string;
  input: ZodType<Input>;
  /** Writes only. Built from the validated args on the server; shown to the user before confirmation. Not needed when prepare() is set. */
  summarize?: (args: Input) => string;
  /** Writes only. Async server-side preparation; its result is stored with the proposal and hashed with the args. */
  prepare?: (ctx: WorkspaceContext, args: Input, env: ToolEnv) => Promise<PreparedWrite>;
  /** Destructive and financial writes only. The text the user must type to confirm. */
  typedPhrase?: (args: Input) => string;
  run: (ctx: WorkspaceContext, args: Input, env: ToolEnv, context: Record<string, unknown>) => Promise<ToolResult>;
};

export function defineTool<Input>(tool: AiToolDefinition<Input>): AiToolDefinition<Input> {
  return tool;
}
