"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { templateInputSchema, templateUpdateSchema } from "@/features/marketing/schemas/marketing.schema";
import { objectIdSchema } from "@/shared/lib/schema-primitives";
import { parseInput, runAction } from "@/server/actions/run-action";
import type { ActionResult } from "@/shared/lib/errors";
import { createTemplate, deleteTemplate, duplicateTemplate, setTemplateActive, updateTemplate, type TemplateDto } from "@/server/marketing/template.service";

function refresh(): void {
  revalidatePath("/marketing", "layout");
}

const activeSchema = z.object({ isActive: z.boolean(), expectedVersion: z.number().int().min(1) }).strict();

export async function createTemplateAction(raw: unknown): Promise<ActionResult<TemplateDto>> {
  return runAction("marketing.template.create", async (ctx) => {
    const result = await createTemplate(ctx, parseInput(templateInputSchema, raw));
    refresh();
    return result;
  });
}

export async function updateTemplateAction(id: unknown, raw: unknown): Promise<ActionResult<TemplateDto>> {
  return runAction("marketing.template.update", async (ctx) => {
    const templateId = parseInput(objectIdSchema, id);
    const result = await updateTemplate(ctx, templateId, parseInput(templateUpdateSchema, raw));
    refresh();
    return result;
  });
}

export async function duplicateTemplateAction(id: unknown): Promise<ActionResult<TemplateDto>> {
  return runAction("marketing.template.duplicate", async (ctx) => {
    const result = await duplicateTemplate(ctx, parseInput(objectIdSchema, id));
    refresh();
    return result;
  });
}

export async function setTemplateActiveAction(id: unknown, raw: unknown): Promise<ActionResult<TemplateDto>> {
  return runAction("marketing.template.active", async (ctx) => {
    const input = parseInput(activeSchema, raw);
    const result = await setTemplateActive(ctx, parseInput(objectIdSchema, id), input.isActive, input.expectedVersion);
    refresh();
    return result;
  });
}

export async function deleteTemplateAction(id: unknown): Promise<ActionResult<null>> {
  return runAction("marketing.template.delete", async (ctx) => {
    await deleteTemplate(ctx, parseInput(objectIdSchema, id));
    refresh();
    return null;
  });
}
