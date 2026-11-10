import "server-only";
import { z } from "zod";
import { AI_MODULES } from "@/server/ai/access/capabilities";
import { callTool } from "@/server/ai/commands/helpers";
import type { CommandDefinition, CommandEnv } from "@/server/ai/commands/types";

const NONE = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));

export const accessCommand: CommandDefinition = {
  name: "access",
  description: "Show what the assistant can do for you right now.",
  example: "/access",
  module: "core",
  operation: "view",
  permission: null,
  args: NONE,
  fromText: () => ({}),
  async start(env) {
    const result = await callTool(env, "show_my_access", {});
    return { parts: result.parts ?? [] };
  },
};

/** Lists the commands this member can run, grouped by module. Built from the live access snapshot. */
export function helpCommand(all: () => readonly CommandDefinition[], available: (def: CommandDefinition, access: CommandEnv["access"]) => boolean): CommandDefinition {
  return {
    name: "help",
    description: "Show the commands and actions available to you.",
    example: "/help",
    module: "core",
    operation: "view",
    permission: null,
    args: NONE,
    fromText: () => ({}),
    async start(env) {
      const visible = all().filter((c) => !c.hidden && available(c, env.access));
      const groups = ["core", ...AI_MODULES].map((module) => ({ module, items: visible.filter((c) => c.module === module) })).filter((g) => g.items.length > 0);
      const lines = groups.flatMap((g) => [`**${g.module === "core" ? "General" : g.module[0].toUpperCase() + g.module.slice(1)}**`, ...g.items.map((c) => `- \`/${c.name}\`: ${c.description}`), ""]);
      return { parts: [], text: [...lines, "You can also describe what you need in plain English or French. Changes are always shown for your confirmation first."].join("\n") };
    },
  };
}
