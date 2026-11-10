"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { aiEditSchema, aiRequestSchema } from "@/features/marketing/schemas/marketing.schema";
import { objectIdSchema } from "@/shared/lib/schema-primitives";
import { parseInput, runAction } from "@/server/actions/run-action";
import type { ActionResult } from "@/shared/lib/errors";
import {
  approveGeneration,
  editGeneration,
  generateCopy,
  applyCopyToSocialPost,
  applyCopyToCampaign,
  type AiGenerationDto,
} from "@/server/marketing/ai/copy.service";
import type { SocialPostDto } from "@/server/marketing/social/post.service";

function refresh(): void {
  revalidatePath("/marketing", "layout");
}

const versionSchema = z.object({ expectedVersion: z.number().int().min(1) }).strict();
const editSchema = aiEditSchema.extend({ expectedVersion: z.number().int().min(1) }).strict();

export async function generateCopyAction(raw: unknown): Promise<ActionResult<AiGenerationDto>> {
  return runAction("marketing.ai.generate", async (ctx) => {
    const result = await generateCopy(ctx, parseInput(aiRequestSchema, raw));
    refresh();
    return result;
  });
}

export async function editCopyAction(id: unknown, raw: unknown): Promise<ActionResult<AiGenerationDto>> {
  return runAction("marketing.ai.edit", async (ctx) => {
    const input = parseInput(editSchema, raw);
    const result = await editGeneration(ctx, parseInput(objectIdSchema, id), input);
    refresh();
    return result;
  });
}

export async function approveCopyAction(id: unknown, raw: unknown): Promise<ActionResult<AiGenerationDto>> {
  return runAction("marketing.ai.approve", async (ctx) => {
    const { expectedVersion } = parseInput(versionSchema, raw);
    const result = await approveGeneration(ctx, parseInput(objectIdSchema, id), expectedVersion);
    refresh();
    return result;
  });
}

export async function applyCopyToCampaignAction(id: unknown, raw: unknown): Promise<ActionResult<null>> {
  return runAction("marketing.ai.use_campaign", async (ctx) => {
    const input = parseInput(z.object({ campaignId: objectIdSchema, expectedVersion: z.number().int().min(1) }).strict(), raw);
    await applyCopyToCampaign(ctx, parseInput(objectIdSchema, id), input.campaignId, input.expectedVersion);
    refresh();
    return null;
  });
}

export async function applyCopyToSocialPostAction(id: unknown, raw: unknown): Promise<ActionResult<SocialPostDto>> {
  return runAction("marketing.ai.use_social", async (ctx) => {
    const input = parseInput(z.object({ socialAccountId: objectIdSchema }).strict(), raw);
    const result = await applyCopyToSocialPost(ctx, parseInput(objectIdSchema, id), input.socialAccountId);
    refresh();
    return result;
  });
}
