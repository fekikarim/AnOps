import "server-only";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { assertAiReady, resolveAiAccess, type AiAccess } from "@/server/ai/access/access.service";
import { commandRegistry, isCommandAvailable, type CommandRegistry } from "@/server/ai/commands";
import type { CommandArgs, CommandDefinition, CommandEnv, CommandResult } from "@/server/ai/commands/types";
import { appendMessages, getConversation, newMessage } from "@/server/ai/conversation.service";
import { aiToolRegistry } from "@/server/ai/tools";
import { runDraft, type CompleteFn } from "@/server/ai/draft/draft-engine";
import type { ToolRegistry } from "@/server/ai/tools/registry";
import { consumeSharedRateLimit } from "@/server/security/shared-rate-limit";
import { SENSITIVE_PLACEHOLDER } from "@/server/ai/platform";
import type { WorkspaceContext } from "@/server/tenancy/workspace";
import { AppError } from "@/shared/lib/errors";
import { toFieldErrors } from "@/shared/lib/validation";

const COMMAND_RATE = { limit: 90, windowMs: 60_000 };

export type CommandStep = "start" | "manual" | "select" | "submit" | "draft";

export const commandRequestSchema = z
  .object({
    command: z.string().regex(/^[a-z]{2,24}$/),
    step: z.enum(["start", "manual", "select", "submit", "draft"]),
    args: z.record(z.string().max(40), z.union([z.string().max(600), z.number(), z.boolean()])).default({}),
    values: z.record(z.string().max(40), z.union([z.string().max(2000), z.number(), z.boolean()])).default({}),
    conversationId: z.string().regex(/^[a-f0-9]{24}$/i).optional(),
    /** AI-assisted steps: the description and, when refining, where each current value came from. */
    draft: z
      .object({
        text: z.string().max(2000),
        provenance: z.record(z.string().max(40), z.enum(["you", "found", "inferred", "default"])).default({}),
        lineProvenance: z.record(z.string().max(40), z.array(z.record(z.string().max(40), z.enum(["you", "found", "inferred", "default"]))).max(100)).optional(),
      })
      .strict()
      .optional(),
    /** What the person did, shown in their own history ("Selected Steel bolt"). */
    label: z.string().max(120).optional(),
  })
  .strict();

export type CommandRequest = z.infer<typeof commandRequestSchema>;

export type CommandDeps = { commands?: CommandRegistry; registry?: ToolRegistry; complete?: CompleteFn };

function liveEnv(ctx: WorkspaceContext, access: AiAccess, registry: ToolRegistry, conversationId: ObjectId | null): CommandEnv {
  return { ctx: { ...ctx, role: access.member!.role, permissions: access.member!.permissions }, access, registry, conversationId };
}

function checkArgs(def: CommandDefinition, raw: unknown): CommandArgs {
  const parsed = def.args.safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "The request is invalid.", toFieldErrors(parsed.error));
  return parsed.data;
}

/**
 * Runs one step of one command for the live member. Called for typed commands (step "start") and for
 * every click in a guided flow. Nothing the client sends is trusted: the command must exist, the
 * member's access is re-resolved from the database, the command must be available under it, and
 * every argument is validated again before a service is reached.
 */
export async function executeCommand(
  ctx: WorkspaceContext,
  access: AiAccess,
  request: {
    name: string;
    step: CommandStep;
    args: unknown;
    values?: Record<string, string | number | boolean>;
    draft?: { text: string; provenance: Record<string, "you" | "found" | "inferred" | "default">; lineProvenance?: Record<string, Record<string, "you" | "found" | "inferred" | "default">[]> };
    conversationId: ObjectId | null;
  },
  deps: CommandDeps = {}
): Promise<CommandResult> {
  const commands = deps.commands ?? commandRegistry;
  const def = commands.get(request.name);
  if (!def || !isCommandAvailable(def, access)) throw new AppError("FORBIDDEN", "That command is not available to you.");
  const env = liveEnv(ctx, access, deps.registry ?? aiToolRegistry, request.conversationId);
  const args = checkArgs(def, request.args);

  if (request.step === "manual") {
    if (!def.manual) throw new AppError("NOT_FOUND", "That step does not exist.");
    return def.manual(env, args);
  }
  if (request.step === "draft" || (request.step === "start" && def.draft?.kind === "create" && String(args.text ?? "").trim().length >= 8)) {
    if (!def.draft) throw new AppError("NOT_FOUND", "That step does not exist.");
    // Drafting reads real records (options, the record being changed), so it needs the same view access as the manual form.
    if (def.module !== "core" && !access.can(def.module, "view")) throw new AppError("FORBIDDEN", "You also need view access in this module to use AI-assisted entry.");
    return runDraft(env, def, args, { text: request.draft?.text ?? String(args.text ?? ""), values: request.values ?? {}, provenance: request.draft?.provenance ?? {}, lineProvenance: request.draft?.lineProvenance }, { complete: deps.complete });
  }
  if (request.step === "start") return def.start(env, args);
  if (request.step === "select") {
    if (!def.select) throw new AppError("NOT_FOUND", "That step does not exist.");
    return def.select(env, args);
  }
  if (!def.submit) throw new AppError("NOT_FOUND", "That step does not exist.");
  return def.submit(env, args, request.values ?? {});
}

/** The path behind clicks in the workspace: resolves access, runs the step, and records it in the member's own history. */
export async function runCommandStep(ctx: WorkspaceContext, rawRequest: unknown, deps: CommandDeps = {}): Promise<CommandResult> {
  const parsed = commandRequestSchema.safeParse(rawRequest);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "The request is invalid.", toFieldErrors(parsed.error));
  const request = parsed.data;

  const access = await resolveAiAccess(ctx);
  assertAiReady(access);
  await consumeSharedRateLimit(ctx.db, `user:${ctx.userId.toHexString()}:ai.command`, COMMAND_RATE.limit, COMMAND_RATE.windowMs);

  // The conversation must be the caller's own; getConversation is scoped to company and user.
  const conversationId = request.conversationId ? new ObjectId((await getConversation(ctx, request.conversationId)).id) : null;

  const result = await executeCommand(ctx, access, { name: request.command, step: request.step, args: request.args, values: request.values, draft: request.draft, conversationId }, deps);

  if (conversationId) {
    // Commands that show payroll data are kept in history as a neutral line, not as the figures.
    const sensitive = (deps.commands ?? commandRegistry).get(request.command)?.sensitive === "hr" && result.parts.length > 0;
    const parts = sensitive ? [{ type: "text" as const, text: SENSITIVE_PLACEHOLDER }] : [...(result.text ? [{ type: "text" as const, text: result.text }] : []), ...result.parts];
    await appendMessages(ctx, conversationId, [
      newMessage("user", [{ type: "text", text: request.label || `/${request.command}` }]),
      newMessage("assistant", parts),
    ]);
  }
  return result;
}
