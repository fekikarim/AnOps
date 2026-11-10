import "server-only";
import { z } from "zod";
import type { CommandArgs, CommandDefinition, CommandEnv, CommandResult } from "@/server/ai/commands/types";
import type { AiMessagePart } from "@/server/db/documents";
import type { AiModuleKey, AiOperation } from "@/shared/domain/ai";
import { AppError } from "@/shared/lib/errors";
import { objectIdSchema } from "@/shared/lib/schema-primitives";

/** Helpers shared by module command files. Inventory predates this file and keeps its own copies. */
export const ARGS = z
  .record(z.string().max(40), z.union([z.string().max(600), z.number(), z.boolean()]))
  .refine((v) => Object.keys(v).length <= 8, "Too many arguments");

export const searchText = (rest: string) => ({ q: rest.trim().slice(0, 80) });
export const noText = () => ({});

export function need(args: CommandArgs, key: string): string {
  const parsed = objectIdSchema.safeParse(args[key]);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Select a record first.");
  return parsed.data;
}

export function requireCell(env: CommandEnv, module: AiModuleKey, op: AiOperation): void {
  if (!env.access.can(module, op)) throw new AppError("FORBIDDEN", "You do not have AI access for that.");
}

/** Converts a list table into a picker: every row gets one Select action that continues `command`. */
export function asPicker(parts: AiMessagePart[] | undefined, command: string, key: string, title: string): AiMessagePart[] {
  return (parts ?? []).map((part) => {
    if (part.type !== "record_table") return part;
    return {
      ...part,
      title,
      rows: part.rows.map((r) => ({ ...r, actions: [{ label: "Select", command, args: { [key]: r.id.split(":")[0] }, step: "select" as const }] })),
      paging: part.paging ? { ...part.paging, command } : undefined,
    };
  });
}

type Pick = {
  name: string;
  description: string;
  example: string;
  module: AiModuleKey;
  operation: AiOperation;
  permission: CommandDefinition["permission"];
  title: string;
  key: string;
  list: (env: CommandEnv, args: CommandArgs) => Promise<AiMessagePart[]>;
  select: NonNullable<CommandDefinition["select"]>;
};

/** A command that lists records as a picker and continues with the chosen one. */
export function pickCommand(def: Pick): CommandDefinition {
  return {
    name: def.name,
    description: def.description,
    example: def.example,
    module: def.module,
    operation: def.operation,
    permission: def.permission,
    args: ARGS,
    fromText: searchText,
    async start(env, args): Promise<CommandResult> {
      requireCell(env, def.module, "view");
      return { parts: asPicker(await def.list(env, args), def.name, def.key, def.title) };
    },
    select: def.select,
  };
}
