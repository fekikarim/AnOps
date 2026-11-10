import "server-only";
import { z } from "zod";
import type { AiAccess } from "@/server/ai/access/access.service";
import { FORBIDDEN_TOOL_INPUT_KEYS } from "@/server/ai/access/capabilities";
import type { AiToolDefinition } from "@/server/ai/tools/define-tool";
import { AppError } from "@/shared/lib/errors";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTool = AiToolDefinition<any>;

const NAME = /^[a-z][a-z0-9_]{2,47}$/;

/** Every property name that appears anywhere in a JSON schema, so nested inputs cannot smuggle identity fields. */
function propertyNames(node: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(node)) {
    for (const item of node) propertyNames(item, out);
  } else if (node && typeof node === "object") {
    const record = node as Record<string, unknown>;
    if (record.properties && typeof record.properties === "object") {
      for (const key of Object.keys(record.properties as object)) out.add(key);
    }
    for (const value of Object.values(record)) propertyNames(value, out);
  }
  return out;
}

export type ToolRegistry = {
  all(): readonly AnyTool[];
  get(name: string): AnyTool | undefined;
  /** The tools this member may use right now. Evaluated against a live access snapshot. */
  availableFor(access: AiAccess): AnyTool[];
};

/** Whether one tool is usable under a live access snapshot. Also used again when a call or a confirmation arrives. */
export function isToolAvailable(tool: AnyTool, access: AiAccess): boolean {
  if (access.state !== "ready" || !access.member) return false;
  if (tool.module !== "core") {
    if (!access.can(tool.module, tool.operation)) return false;
    if (tool.permission && !access.member.permissions.has(tool.permission)) return false;
  }
  if (tool.sensitive === "hr" && !access.grant.canViewSensitiveHr) return false;
  return true;
}

/**
 * Builds a registry and rejects unsafe definitions at startup rather than at request time:
 * duplicate or malformed names, tenant or identity fields in an input schema, writes without a
 * server-built summary, and destructive or financial writes without a typed confirmation phrase.
 */
export function createToolRegistry(tools: readonly AnyTool[]): ToolRegistry {
  const byName = new Map<string, AnyTool>();
  for (const tool of tools) {
    if (!NAME.test(tool.name)) throw new Error(`Invalid AI tool name: ${tool.name}`);
    if (byName.has(tool.name)) throw new Error(`Duplicate AI tool: ${tool.name}`);

    const names = propertyNames(z.toJSONSchema(tool.input, { io: "input", unrepresentable: "any" }));
    for (const forbidden of FORBIDDEN_TOOL_INPUT_KEYS) {
      if (names.has(forbidden)) throw new Error(`AI tool ${tool.name} must not accept "${forbidden}"`);
    }
    if (tool.kind === "write") {
      if (!tool.summarize && !tool.prepare) throw new Error(`AI write tool ${tool.name} needs summarize() or prepare()`);
      if ((tool.risk === "destructive" || tool.risk === "financial") && !tool.typedPhrase && !tool.prepare) {
        throw new Error(`AI ${tool.risk} tool ${tool.name} needs typedPhrase()`);
      }
    }
    if (tool.kind === "read" && tool.risk !== "low") throw new Error(`AI read tool ${tool.name} must be low risk`);
    byName.set(tool.name, tool);
  }
  return {
    all: () => [...byName.values()],
    get: (name) => byName.get(name),
    availableFor: (access) => [...byName.values()].filter((tool) => isToolAvailable(tool, access)),
  };
}

export function requireTool(registry: ToolRegistry, name: string): AnyTool {
  const tool = registry.get(name);
  if (!tool) throw new AppError("NOT_FOUND", "That action is not available.");
  return tool;
}
