import "server-only";
import { z } from "zod";
import { AI_MODULES, AI_OPERATIONS } from "@/server/ai/access/capabilities";
import { defineTool } from "@/server/ai/tools/define-tool";

/**
 * Phase 0 ships only core tools: they describe the member's own AI access and change nothing.
 * Module tools (Inventory first) are added in later phases through the same registry.
 */
export const showMyAccessTool = defineTool({
  name: "show_my_access",
  module: "core",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: null,
  description: "Show which modules and operations the assistant can currently perform for the signed-in member.",
  input: z.object({}).strict(),
  async run(_ctx, _args, { access }) {
    const modules = AI_MODULES.map((module) => ({
      module,
      operations: AI_OPERATIONS.filter((operation) => access.can(module, operation)),
    })).filter((entry) => entry.operations.length > 0);
    return {
      summary: modules.length > 0 ? `Access to ${modules.length} module${modules.length === 1 ? "" : "s"}` : "No module access yet",
      parts: [
        {
          type: "access_summary",
          state: access.state,
          modules,
          tokenCap: access.tokenCap,
          usedToday: 0,
        },
      ],
      data: { modules },
    };
  },
});

export const CORE_TOOLS = [showMyAccessTool];
