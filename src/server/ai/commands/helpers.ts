import "server-only";
import { z } from "zod";
import { proposeAction, confirmationPart } from "@/server/ai/pending-actions.service";
import { isToolAvailable } from "@/server/ai/tools/registry";
import type { CommandEnv, CommandResult } from "@/server/ai/commands/types";
import type { AiFormField, AiFormPart } from "@/server/db/documents";
import { AppError } from "@/shared/lib/errors";
import { toFieldErrors } from "@/shared/lib/validation";

/** Runs a READ tool for the live member. Availability and input validation are the tool registry's, as in chat. */
export async function callTool(env: CommandEnv, name: string, rawInput: unknown): Promise<Awaited<ReturnType<NonNullable<ReturnType<CommandEnv["registry"]["get"]>>["run"]>>> {
  const tool = env.registry.get(name);
  if (!tool || tool.kind !== "read" || !isToolAvailable(tool, env.access)) throw new AppError("FORBIDDEN", "That is not available to you.");
  const parsed = tool.input.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "The request is invalid.", toFieldErrors(parsed.error));
  return tool.run(env.ctx, parsed.data, { access: env.access }, {});
}

/** Turns form values into a stored proposal and returns the confirmation card. Nothing is changed yet. */
export async function proposeTool(env: CommandEnv, name: string, rawInput: unknown): Promise<CommandResult> {
  const pending = await proposeAction(env.ctx, env.access, env.registry, { toolName: name, rawArgs: rawInput, conversationId: env.conversationId });
  return { parts: [confirmationPart(pending)] };
}

export const text = (max: number) => z.string().max(max);

/** Strips empty strings from a values object so optional fields fall back to their defaults. */
export function nonEmpty(values: Record<string, string | number | boolean>, keep: string[] = []): Record<string, string | number | boolean> {
  return Object.fromEntries(Object.entries(values).filter(([k, v]) => keep.includes(k) || v !== ""));
}

export function form(part: Omit<AiFormPart, "type">): AiFormPart {
  return { type: "form", ...part };
}

export const field = (f: AiFormField): AiFormField => f;
