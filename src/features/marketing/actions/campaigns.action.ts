"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { campaignInputSchema, campaignUpdateSchema, scheduleCampaignSchema } from "@/features/marketing/schemas/marketing.schema";
import { objectIdSchema } from "@/shared/lib/schema-primitives";
import { parseInput, runAction } from "@/server/actions/run-action";
import type { ActionResult } from "@/shared/lib/errors";
import {
  approveCampaign,
  cancelCampaign,
  createCampaign,
  deleteCampaign,
  duplicateCampaign,
  returnCampaign,
  scheduleCampaign,
  submitCampaign,
  updateCampaign,
  type CampaignDto,
} from "@/server/marketing/campaign.service";

/** Campaign actions are rate-limited because each dispatch can contact many recipients. */
const DISPATCH_RATE_LIMIT = { limit: 20, windowMs: 60_000 };

function refresh(): void {
  revalidatePath("/marketing", "layout");
}

const versionSchema = z.object({ expectedVersion: z.number().int().min(1) }).strict();

export async function createCampaignAction(raw: unknown): Promise<ActionResult<CampaignDto>> {
  return runAction("marketing.campaign.create", async (ctx) => {
    const result = await createCampaign(ctx, parseInput(campaignInputSchema, raw));
    refresh();
    return result;
  });
}

export async function updateCampaignAction(id: unknown, raw: unknown): Promise<ActionResult<CampaignDto>> {
  return runAction("marketing.campaign.update", async (ctx) => {
    const campaignId = parseInput(objectIdSchema, id);
    const result = await updateCampaign(ctx, campaignId, parseInput(campaignUpdateSchema, raw));
    refresh();
    return result;
  });
}

export async function duplicateCampaignAction(id: unknown): Promise<ActionResult<CampaignDto>> {
  return runAction("marketing.campaign.duplicate", async (ctx) => {
    const result = await duplicateCampaign(ctx, parseInput(objectIdSchema, id));
    refresh();
    return result;
  });
}

export async function deleteCampaignAction(id: unknown): Promise<ActionResult<null>> {
  return runAction("marketing.campaign.delete", async (ctx) => {
    await deleteCampaign(ctx, parseInput(objectIdSchema, id));
    refresh();
    return null;
  });
}

export async function submitCampaignAction(id: unknown, raw: unknown): Promise<ActionResult<null>> {
  return runAction("marketing.campaign.submit", async (ctx) => {
    const { expectedVersion } = parseInput(versionSchema, raw);
    await submitCampaign(ctx, parseInput(objectIdSchema, id), expectedVersion);
    refresh();
    return null;
  });
}

export async function returnCampaignAction(id: unknown, raw: unknown): Promise<ActionResult<null>> {
  return runAction("marketing.campaign.return", async (ctx) => {
    const { expectedVersion } = parseInput(versionSchema, raw);
    await returnCampaign(ctx, parseInput(objectIdSchema, id), expectedVersion);
    refresh();
    return null;
  });
}

export async function approveCampaignAction(id: unknown, raw: unknown): Promise<ActionResult<CampaignDto>> {
  return runAction(
    "marketing.campaign.approve",
    async (ctx) => {
      const { expectedVersion } = parseInput(versionSchema, raw);
      const result = await approveCampaign(ctx, parseInput(objectIdSchema, id), expectedVersion);
      refresh();
      return result;
    },
    { rateLimit: DISPATCH_RATE_LIMIT }
  );
}

export async function scheduleCampaignAction(id: unknown, raw: unknown): Promise<ActionResult<null>> {
  return runAction(
    "marketing.campaign.schedule",
    async (ctx) => {
      const input = parseInput(scheduleCampaignSchema, raw);
      await scheduleCampaign(ctx, parseInput(objectIdSchema, id), input.scheduledAt, input.expectedVersion);
      refresh();
      return null;
    },
    { rateLimit: DISPATCH_RATE_LIMIT }
  );
}

export async function cancelCampaignAction(id: unknown, raw: unknown): Promise<ActionResult<null>> {
  return runAction("marketing.campaign.cancel", async (ctx) => {
    const { expectedVersion } = parseInput(versionSchema, raw);
    await cancelCampaign(ctx, parseInput(objectIdSchema, id), expectedVersion);
    refresh();
    return null;
  });
}
