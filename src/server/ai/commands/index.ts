import "server-only";
import type { AiAccess } from "@/server/ai/access/access.service";
import { accessCommand, helpCommand } from "@/server/ai/commands/core";
import { INVENTORY_COMMANDS } from "@/server/ai/commands/inventory.commands";
import { PURCHASING_COMMANDS } from "@/server/ai/commands/purchasing.commands";
import { MANUFACTURING_COMMANDS } from "@/server/ai/commands/manufacturing.commands";
import { FINANCE_COMMANDS } from "@/server/ai/commands/finance.commands";
import { HR_COMMANDS } from "@/server/ai/commands/hr.commands";
import { MARKETING_COMMANDS } from "@/server/ai/commands/marketing.commands";
import { COMMUNITY_COMMANDS } from "@/server/ai/commands/community.commands";
import type { CommandDefinition } from "@/server/ai/commands/types";
import type { ToolRegistry } from "@/server/ai/tools/registry";

export type { CommandArgs, CommandDefinition, CommandEnv, CommandResult } from "@/server/ai/commands/types";

/** What the palette shows. */
export type CommandDto = { command: string; description: string; example: string; module: string };

/**
 * A command is available only when the live access allows its module and operation AND the member's
 * role holds the exact permission the underlying service asserts. The same test runs again for every
 * step of a guided flow, so a revocation ends the flow at the next click.
 */
export function isCommandAvailable(def: CommandDefinition, access: AiAccess): boolean {
  if (access.state !== "ready" || !access.member) return false;
  if (def.module === "core") return true;
  if (!access.can(def.module, def.operation)) return false;
  if (def.sensitive === "hr" && !access.grant.canViewSensitiveHr) return false;
  return def.permission ? access.member.permissions.has(def.permission) : true;
}

export type CommandRegistry = {
  all(): readonly CommandDefinition[];
  get(name: string): CommandDefinition | undefined;
  /** Palette entries for this member. Hidden (row-action-only) commands are never listed. */
  listFor(access: AiAccess, _registry?: ToolRegistry): CommandDto[];
  /** The command that offers AI-assisted entry for a write tool, if any. */
  byDraftTool(toolName: string): CommandDefinition | undefined;
  /** "/products bolt" -> the definition and the text after the command; "unknown" for a slash word nobody defines. */
  parse(text: string): { def: CommandDefinition; rest: string } | "unknown" | null;
};

export function createCommandRegistry(defs: readonly CommandDefinition[]): CommandRegistry {
  const byName = new Map<string, CommandDefinition>();
  for (const def of defs) {
    if (!/^[a-z]{2,24}$/.test(def.name)) throw new Error(`Invalid command name: ${def.name}`);
    if (byName.has(def.name)) throw new Error(`Duplicate command: ${def.name}`);
    if ((def.select || def.submit) && def.module !== "core" && !def.permission) throw new Error(`Command ${def.name} needs a permission`);
    byName.set(def.name, def);
  }
  return {
    all: () => [...byName.values()],
    get: (name) => byName.get(name),
    listFor: (access) =>
      [...byName.values()]
        .filter((d) => !d.hidden && isCommandAvailable(d, access))
        .map((d) => ({ command: `/${d.name}`, description: d.description, example: d.example, module: d.module })),
    byDraftTool: (toolName) => [...byName.values()].find((d) => d.draft?.tool === toolName),
    parse(text) {
      if (!text.startsWith("/")) return null;
      const [word, ...rest] = text.split(/\s+/);
      const def = byName.get(word.slice(1).toLowerCase());
      return def ? { def, rest: rest.join(" ") } : "unknown";
    },
  };
}

const help = helpCommand(
  () => commandRegistry.all(),
  (def, access) => isCommandAvailable(def, access)
);

export const commandRegistry: CommandRegistry = createCommandRegistry([help, accessCommand, ...INVENTORY_COMMANDS, ...PURCHASING_COMMANDS, ...MANUFACTURING_COMMANDS, ...FINANCE_COMMANDS, ...HR_COMMANDS, ...MARKETING_COMMANDS, ...COMMUNITY_COMMANDS]);
