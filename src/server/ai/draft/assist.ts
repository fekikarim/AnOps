import "server-only";
import { choicePart } from "@/server/ai/draft/draft-engine";
import type { CommandDefinition, DraftSpec } from "@/server/ai/commands/types";

/**
 * Gives a command AI-assisted entry without touching its manual flow. The original `start` is kept
 * as the `manual` step; `start` now offers the choice. Text typed after a create command skips the
 * choice and goes straight to drafting (the runner handles that, because it owns the model call).
 */
export function withAssist(def: CommandDefinition, draft: DraftSpec): CommandDefinition {
  const assisted: CommandDefinition = { ...def, draft, manual: def.start };
  assisted.fromText =
    draft.kind === "create"
      ? (rest) => ({ text: rest.trim().slice(0, 600) })
      : def.fromText;
  assisted.start = async (_env, args) => ({ parts: [choicePart(assisted, args)] });
  return assisted;
}
