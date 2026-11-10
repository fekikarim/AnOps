"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { socialPostInputSchema, socialPostUpdateSchema, socialScheduleSchema } from "@/features/marketing/schemas/marketing.schema";
import { objectIdSchema } from "@/shared/lib/schema-primitives";
import { parseInput, runAction } from "@/server/actions/run-action";
import type { ActionResult } from "@/shared/lib/errors";
import { disconnectSocialAccount, startSocialConnection } from "@/server/marketing/social/accounts.service";
import {
  cancelSocialPost,
  createSocialPost,
  deleteSocialPost,
  scheduleSocialPost,
  updateSocialPost,
  type SocialPostDto,
} from "@/server/marketing/social/post.service";

function refresh(): void {
  revalidatePath("/marketing", "layout");
}

const versionSchema = z.object({ expectedVersion: z.number().int().min(1) }).strict();

/** Returns the Meta authorization URL. The browser is redirected to it; no credential is ever returned. */
export async function startSocialConnectionAction(): Promise<ActionResult<{ authorizationUrl: string }>> {
  return runAction("marketing.social.connect", async (ctx) => startSocialConnection(ctx));
}

export async function disconnectSocialAccountAction(id: unknown, raw: unknown): Promise<ActionResult<null>> {
  return runAction("marketing.social.disconnect", async (ctx) => {
    const { expectedVersion } = parseInput(versionSchema, raw);
    await disconnectSocialAccount(ctx, parseInput(objectIdSchema, id), expectedVersion);
    refresh();
    return null;
  });
}

export async function createSocialPostAction(raw: unknown): Promise<ActionResult<SocialPostDto>> {
  return runAction("marketing.social.post.create", async (ctx) => {
    const result = await createSocialPost(ctx, parseInput(socialPostInputSchema, raw));
    refresh();
    return result;
  });
}

export async function updateSocialPostAction(id: unknown, raw: unknown): Promise<ActionResult<SocialPostDto>> {
  return runAction("marketing.social.post.update", async (ctx) => {
    const postId = parseInput(objectIdSchema, id);
    const result = await updateSocialPost(ctx, postId, parseInput(socialPostUpdateSchema, raw));
    refresh();
    return result;
  });
}

export async function deleteSocialPostAction(id: unknown): Promise<ActionResult<null>> {
  return runAction("marketing.social.post.delete", async (ctx) => {
    await deleteSocialPost(ctx, parseInput(objectIdSchema, id));
    refresh();
    return null;
  });
}

export async function scheduleSocialPostAction(id: unknown, raw: unknown): Promise<ActionResult<SocialPostDto>> {
  return runAction("marketing.social.post.schedule", async (ctx) => {
    const input = parseInput(socialScheduleSchema, raw);
    const result = await scheduleSocialPost(ctx, parseInput(objectIdSchema, id), input.scheduledAt, input.expectedVersion);
    refresh();
    return result;
  });
}

export async function cancelSocialPostAction(id: unknown, raw: unknown): Promise<ActionResult<null>> {
  return runAction("marketing.social.post.cancel", async (ctx) => {
    const { expectedVersion } = parseInput(versionSchema, raw);
    await cancelSocialPost(ctx, parseInput(objectIdSchema, id), expectedVersion);
    refresh();
    return null;
  });
}
