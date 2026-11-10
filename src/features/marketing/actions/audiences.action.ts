"use server";

import { revalidatePath } from "next/cache";
import { audienceInputSchema, audienceUpdateSchema, audiencePreviewSchema } from "@/features/marketing/schemas/marketing.schema";
import { objectIdSchema } from "@/shared/lib/schema-primitives";
import { parseInput, runAction } from "@/server/actions/run-action";
import type { ActionResult } from "@/shared/lib/errors";
import { createAudience, deleteAudience, previewAudience, updateAudience, type AudienceDto, type AudiencePreviewDto } from "@/server/marketing/audience.service";

function refresh(): void {
  revalidatePath("/marketing", "layout");
}

export async function createAudienceAction(raw: unknown): Promise<ActionResult<AudienceDto>> {
  return runAction("marketing.audience.create", async (ctx) => {
    const result = await createAudience(ctx, parseInput(audienceInputSchema, raw));
    refresh();
    return result;
  });
}

export async function updateAudienceAction(id: unknown, raw: unknown): Promise<ActionResult<AudienceDto>> {
  return runAction("marketing.audience.update", async (ctx) => {
    const audienceId = parseInput(objectIdSchema, id);
    const result = await updateAudience(ctx, audienceId, parseInput(audienceUpdateSchema, raw));
    refresh();
    return result;
  });
}

export async function deleteAudienceAction(id: unknown): Promise<ActionResult<null>> {
  return runAction("marketing.audience.delete", async (ctx) => {
    await deleteAudience(ctx, parseInput(objectIdSchema, id));
    refresh();
    return null;
  });
}

export async function previewAudienceAction(raw: unknown): Promise<ActionResult<AudiencePreviewDto>> {
  return runAction("marketing.audience.preview", async (ctx) => {
    const input = parseInput(audiencePreviewSchema, raw);
    return previewAudience(ctx, input.rule, input.channel);
  });
}
