"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { bomInputSchema, bomUpdateSchema, materialPreviewSchema, workOrderInputSchema } from "@/features/manufacturing/schemas/manufacturing.schema";
import { objectIdSchema } from "@/shared/lib/schema-primitives";
import { parseInput, runAction } from "@/server/actions/run-action";
import { activateBom, archiveBom, createBomDraft, updateBomDraft } from "@/server/manufacturing/bom.service";
import { cancelWorkOrder, completeWorkOrder, createWorkOrder, previewMaterialAvailability, startWorkOrder } from "@/server/manufacturing/work-order.service";
import type { ActionResult } from "@/shared/lib/errors";
import type { BomDetailDto, MaterialAvailabilityDto, WorkOrderDetailDto } from "@/features/manufacturing/types";

const versionSchema = z.number().int().min(1);

function refreshManufacturing(): void {
  revalidatePath("/manufacturing", "layout");
  revalidatePath("/inventory", "layout");
}

export async function createBomAction(raw: unknown): Promise<ActionResult<BomDetailDto>> {
  return runAction("manufacturing.bom.create", async (ctx) => {
    const result = await createBomDraft(ctx, parseInput(bomInputSchema, raw));
    refreshManufacturing();
    return result;
  });
}

export async function updateBomAction(id: unknown, raw: unknown): Promise<ActionResult<BomDetailDto>> {
  return runAction("manufacturing.bom.update", async (ctx) => {
    const bomId = parseInput(objectIdSchema, id);
    const result = await updateBomDraft(ctx, bomId, parseInput(bomUpdateSchema, raw));
    refreshManufacturing();
    return result;
  });
}

export async function activateBomAction(id: unknown, expectedVersion: unknown): Promise<ActionResult<null>> {
  return runAction("manufacturing.bom.activate", async (ctx) => {
    await activateBom(ctx, parseInput(objectIdSchema, id), parseInput(versionSchema, expectedVersion));
    refreshManufacturing();
    return null;
  });
}

export async function archiveBomAction(id: unknown): Promise<ActionResult<null>> {
  return runAction("manufacturing.bom.archive", async (ctx) => {
    await archiveBom(ctx, parseInput(objectIdSchema, id));
    refreshManufacturing();
    return null;
  });
}

export async function createWorkOrderAction(raw: unknown): Promise<ActionResult<WorkOrderDetailDto>> {
  return runAction("manufacturing.work_order.create", async (ctx) => {
    const result = await createWorkOrder(ctx, parseInput(workOrderInputSchema, raw));
    refreshManufacturing();
    return result;
  });
}

export async function startWorkOrderAction(id: unknown, expectedVersion: unknown): Promise<ActionResult<null>> {
  return runAction("manufacturing.work_order.start", async (ctx) => {
    await startWorkOrder(ctx, parseInput(objectIdSchema, id), parseInput(versionSchema, expectedVersion));
    refreshManufacturing();
    return null;
  });
}

export async function completeWorkOrderAction(id: unknown, expectedVersion: unknown): Promise<ActionResult<null>> {
  return runAction(
    "manufacturing.work_order.complete",
    async (ctx) => {
      await completeWorkOrder(ctx, parseInput(objectIdSchema, id), parseInput(versionSchema, expectedVersion));
      refreshManufacturing();
      return null;
    },
    { rateLimit: { limit: 30, windowMs: 60_000 } }
  );
}

export async function cancelWorkOrderAction(id: unknown, expectedVersion: unknown): Promise<ActionResult<null>> {
  return runAction("manufacturing.work_order.cancel", async (ctx) => {
    await cancelWorkOrder(ctx, parseInput(objectIdSchema, id), parseInput(versionSchema, expectedVersion));
    refreshManufacturing();
    return null;
  });
}

/** Read-only: what this production run would need versus what the warehouse holds. Writes nothing. */
export async function previewMaterialAvailabilityAction(raw: unknown): Promise<ActionResult<MaterialAvailabilityDto>> {
  return runAction("manufacturing.work_order.preview", async (ctx) => previewMaterialAvailability(ctx, parseInput(materialPreviewSchema, raw)), {
    rateLimit: { limit: 120, windowMs: 60_000 },
  });
}
