"use server";

import { revalidatePath } from "next/cache";
import {
  purchaseOrderInputSchema,
  purchaseOrderUpdateSchema,
  receiptInputSchema,
  replenishmentConvertSchema,
  replenishmentGenerateSchema,
  supplierInputSchema,
} from "@/features/purchasing/schemas/purchasing.schema";
import { objectIdSchema } from "@/shared/lib/schema-primitives";
import { parseInput, runAction } from "@/server/actions/run-action";
import { createSupplier, updateSupplier } from "@/server/purchasing/supplier.service";
import {
  approvePurchaseOrder,
  cancelPurchaseOrder,
  createPurchaseOrder,
  updatePurchaseOrder,
} from "@/server/purchasing/purchase-order.service";
import { cancelReceipt, createReceipt, postReceipt } from "@/server/purchasing/receipt.service";
import {
  convertReplenishmentProposal,
  generateReplenishmentProposal,
  type ReplenishmentProposalDto,
  reconcileReplenishmentProposal,
} from "@/server/purchasing/replenishment.service";
import { z } from "zod";
import type { ActionResult } from "@/shared/lib/errors";
import type { PurchaseOrderDetailDto, ReceiptDetailDto, SupplierDto } from "@/features/purchasing/types";

const POSTING_RATE_LIMIT = { limit: 30, windowMs: 60_000 };

const versionSchema = z.number().int().min(1);

function refreshPurchasing(): void {
  revalidatePath("/purchasing", "layout");
  revalidatePath("/inventory", "layout");
}

export async function createSupplierAction(raw: unknown): Promise<ActionResult<SupplierDto>> {
  return runAction("purchasing.supplier.create", async (ctx) => {
    const result = await createSupplier(ctx, parseInput(supplierInputSchema, raw));
    refreshPurchasing();
    return result;
  });
}

export async function updateSupplierAction(id: unknown, raw: unknown): Promise<ActionResult<SupplierDto>> {
  return runAction("purchasing.supplier.update", async (ctx) => {
    const supplierId = parseInput(objectIdSchema, id);
    const result = await updateSupplier(ctx, supplierId, parseInput(supplierInputSchema, raw));
    refreshPurchasing();
    return result;
  });
}

export async function createPurchaseOrderAction(raw: unknown): Promise<ActionResult<PurchaseOrderDetailDto>> {
  return runAction("purchasing.order.create", async (ctx) => {
    const result = await createPurchaseOrder(ctx, parseInput(purchaseOrderInputSchema, raw));
    refreshPurchasing();
    return result;
  });
}

export async function updatePurchaseOrderAction(id: unknown, raw: unknown): Promise<ActionResult<PurchaseOrderDetailDto>> {
  return runAction("purchasing.order.update", async (ctx) => {
    const orderId = parseInput(objectIdSchema, id);
    const input = parseInput(purchaseOrderUpdateSchema, raw);
    const { expectedVersion, ...order } = input;
    const result = await updatePurchaseOrder(ctx, orderId, expectedVersion, parseInput(purchaseOrderInputSchema, order));
    refreshPurchasing();
    return result;
  });
}

export async function approvePurchaseOrderAction(id: unknown, expectedVersion: unknown): Promise<ActionResult<null>> {
  return runAction("purchasing.order.approve", async (ctx) => {
    const orderId = parseInput(objectIdSchema, id);
    await approvePurchaseOrder(ctx, orderId, parseInput(versionSchema, expectedVersion));
    refreshPurchasing();
    return null;
  });
}

export async function cancelPurchaseOrderAction(id: unknown, expectedVersion: unknown): Promise<ActionResult<null>> {
  return runAction("purchasing.order.cancel", async (ctx) => {
    const orderId = parseInput(objectIdSchema, id);
    await cancelPurchaseOrder(ctx, orderId, parseInput(versionSchema, expectedVersion));
    refreshPurchasing();
    return null;
  });
}

export async function createReceiptAction(raw: unknown): Promise<ActionResult<ReceiptDetailDto>> {
  return runAction("purchasing.receipt.create", async (ctx) => {
    const result = await createReceipt(ctx, parseInput(receiptInputSchema, raw));
    refreshPurchasing();
    return result;
  });
}

/** Posting changes stock, so it is rate-limited per user. The transaction ensures a single posting. */
export async function postReceiptAction(id: unknown): Promise<ActionResult<ReceiptDetailDto>> {
  return runAction(
    "purchasing.receipt.post",
    async (ctx) => {
      const receiptId = parseInput(objectIdSchema, id);
      const result = await postReceipt(ctx, receiptId);
      refreshPurchasing();
      return result;
    },
    { rateLimit: POSTING_RATE_LIMIT }
  );
}

export async function cancelReceiptAction(id: unknown): Promise<ActionResult<null>> {
  return runAction("purchasing.receipt.cancel", async (ctx) => {
    await cancelReceipt(ctx, parseInput(objectIdSchema, id));
    refreshPurchasing();
    return null;
  });
}

/** Generates an advisory replenishment proposal. Changes no stock and creates no order. */
export async function generateReplenishmentAction(raw: unknown): Promise<ActionResult<ReplenishmentProposalDto>> {
  return runAction(
    "purchasing.replenishment.generate",
    async (ctx) => generateReplenishmentProposal(ctx, parseInput(replenishmentGenerateSchema, raw)),
    { rateLimit: POSTING_RATE_LIMIT }
  );
}

/** Converts a reviewed proposal into a DRAFT purchase order. Requires approval rights. */
export async function convertReplenishmentAction(
  id: unknown,
  raw: unknown
): Promise<ActionResult<PurchaseOrderDetailDto>> {
  return runAction("purchasing.replenishment.convert", async (ctx) => {
    const proposalId = parseInput(objectIdSchema, id);
    const input = parseInput(replenishmentConvertSchema, raw);
    const order = await convertReplenishmentProposal(ctx, proposalId, input);
    refreshPurchasing();
    return order;
  }, { rateLimit: POSTING_RATE_LIMIT });
}

/**
 * Recovers a proposal left in `converting` by an interrupted conversion. It links an existing order or
 * releases a stale claim. It never creates an order.
 */
export async function reconcileReplenishmentAction(id: unknown): Promise<ActionResult<ReplenishmentProposalDto>> {
  return runAction(
    "purchasing.replenishment.reconcile",
    async (ctx) => {
      const proposalId = parseInput(objectIdSchema, id);
      const proposal = await reconcileReplenishmentProposal(ctx, proposalId);
      refreshPurchasing();
      return proposal;
    },
    { rateLimit: POSTING_RATE_LIMIT }
  );
}
