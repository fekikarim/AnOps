import "server-only";

import { z } from "zod";
import type { AiToolDefinition } from "@/server/ai/types";
import { compactToolSchema } from "@/features/hr/ai/context-compression";
import type { ConfirmationCard } from "@/features/hr/ai/types";

/**
 * Identity and permissions, set by the backend from the session on every request.
 * Tool arguments come from the LLM and can never change these.
 */
export type ToolContext = {
  userId: string;
  employeeId?: string;
  companyId: string;
  role: "employee" | "manager" | "hr_admin";
  actorName: string;
  conversationId?: string;
};

export type ToolResult = {
  /** Small, structured data for the model. Never raw database documents. */
  data: Record<string, unknown>;
  /** What the UI should show as "Data used", when the tool read company data. */
  dataSource?: string;
  /** Policy sections this result drew from, for the Sources line. */
  policies?: Array<{ title: string; section: string }>;
  /** Set by write tools: the user must confirm this before anything happens. */
  card?: ConfirmationCard;
  /** Structured balance shown in the chat's leave card. */
  balanceCard?: Record<string, unknown>;
};

export type HrTool<Schema extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  kind: "read" | "write";
  allowedRoles: ReadonlyArray<ToolContext["role"]>;
  /** The tool acts on the caller's own employee record, so callers without one do not get it. */
  needsEmployee?: boolean;
  parameters: Schema;
  handler: (ctx: ToolContext, args: z.infer<Schema>) => Promise<ToolResult>;
};

/** Keeps each handler's `args` typed from its own schema while the registry holds a plain list. */
export function defineTool<Schema extends z.ZodType>(tool: HrTool<Schema>): HrTool {
  return tool as unknown as HrTool;
}

/** The tools this caller gets. A tool left out here does not exist for the model. */
export function toolsForContext(tools: HrTool[], ctx: Pick<ToolContext, "role" | "employeeId">): HrTool[] {
  return tools.filter(
    (tool) => tool.allowedRoles.includes(ctx.role) && (!tool.needsEmployee || Boolean(ctx.employeeId))
  );
}

export function toToolDefinitions(tools: HrTool[]): AiToolDefinition[] {
  return tools.map((tool) => {
    const parameters = compactToolSchema(z.toJSONSchema(tool.parameters) as Record<string, unknown>);
    return { name: tool.name, description: tool.description, parameters };
  });
}

export type ToolExecution =
  | { status: "ok"; result: ToolResult }
  | { status: "unknown_tool" | "invalid_arguments" | "failed"; error: string };

/** Runs one model-requested call. Never throws: errors go back to the model so it can retry or ask the user. */
export async function executeTool(
  tools: HrTool[],
  ctx: ToolContext,
  name: string,
  rawArguments: string
): Promise<ToolExecution> {
  // Scoped again here, so a tool outside the caller's role cannot run whatever list was passed in.
  const tool = toolsForContext(tools, ctx).find((t) => t.name === name);
  if (!tool) {
    return { status: "unknown_tool", error: `Tool "${name}" is not available to this user.` };
  }

  let json: unknown;
  try {
    json = JSON.parse(rawArguments || "{}");
  } catch {
    return { status: "invalid_arguments", error: "Arguments were not valid JSON." };
  }

  const parsed = tool.parameters.safeParse(json);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".") || "arguments"}: ${i.message}`).join("; ");
    return { status: "invalid_arguments", error: detail };
  }

  try {
    return { status: "ok", result: await tool.handler(ctx, parsed.data) };
  } catch (err) {
    console.error(`[hr-copilot] tool ${name} failed`, err instanceof Error ? err.name : "unknown");
    return { status: "failed", error: "The tool could not complete. Tell the user to try again." };
  }
}
