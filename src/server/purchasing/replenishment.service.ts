import "server-only";
import { ObjectId, type Collection } from "mongodb";
import {
  COLLECTIONS,
  type ProductDoc,
  type PurchaseOrderDoc,
  type ReplenishmentLineSub,
  type ReplenishmentProposalDoc,
  type StockBalanceDoc,
  type TenantScope,
  type WarehouseDoc,
} from "@/server/db/documents";
import { tenantFilter } from "@/server/db/scope";
import { pageInfo, skipFor } from "@/server/db/pagination";
import { recordAudit } from "@/server/audit/audit.service";
import { assertPermission, PERMISSIONS } from "@/server/security/permissions";
import type { WorkspaceContext } from "@/server/tenancy/workspace";
import { idKey } from "@/server/inventory/mappers";
import { createPurchaseOrder, getPurchaseOrder } from "@/server/purchasing/purchase-order.service";
import { generateRationales, type RationaleFacts } from "@/server/purchasing/replenishment-rationale";
import {
  calculationStatements,
  formatFact,
  projectedUseMicro,
  requirementMicro,
  type ReplenishmentFacts,
} from "@/shared/domain/replenishment-calculation";
import { purchaseOrderInputSchema, type PurchaseOrderInput } from "@/features/purchasing/schemas/purchasing.schema";
import { AppError } from "@/shared/lib/errors";
import { isCountableUnit } from "@/shared/domain/units";
import { formatMoneyAmount, formatQuantity, QTY_SCALE } from "@/shared/lib/fixed-point";
import type { Paged, PurchaseOrderDetailDto } from "@/features/purchasing/types";

/**
 * AI replenishment proposals.
 *
 * Facts: on-hand balances, reorder points and recorded consumption (stock movements).
 * Prediction: average daily consumption over the lookback window, projected over the horizon.
 * Recommendation: the whole-unit shortfall between projected need plus reorder point and on-hand.
 *
 * Quantities come only from the facts. Groq writes the explanations, which are validated against
 * the proposed product ids. A proposal changes no stock. Converting one into a draft purchase order
 * requires the approve permission and is claimed once.
 */

export const REPLENISHMENT_LOOKBACK_DAYS = 30;
export const REPLENISHMENT_METHOD = "trailing_consumption_v1" as const;
/** Products considered per generation. A larger catalogue sets `truncated` on the proposal. */
const MAX_CANDIDATE_PRODUCTS = 500;
const PAGE_SIZE = 20;
/** Movement types that represent real consumption. Adjustments and receipts do not. */
const DEMAND_MOVEMENT_TYPES = ["issue", "transfer_out", "production_consume"] as const;

export type ReplenishmentSummaryDto = {
  id: string;
  warehouseCode: string;
  status: ReplenishmentProposalDoc["status"];
  horizonDays: number;
  lineCount: number;
  rationaleStatus: ReplenishmentProposalDoc["rationaleStatus"];
  generatedAt: string;
  convertedOrderId: string | null;
};

export type ReplenishmentProposalDto = ReplenishmentSummaryDto & {
  warehouseId: string;
  lookbackDays: number;
  method: string;
  truncated: boolean;
  rationaleProvider: string | null;
  rationaleModel: string | null;
  version: number;
  canConvert: boolean;
  lines: Array<{
    productId: string;
    sku: string;
    productName: string;
    unitOfMeasure: string;
    onHand: string;
    reorderPoint: string;
    consumedLookback: string;
    forecastDailyUsage: string;
    suggested: string;
    rationale: string | null;
    calculation: string[];
  }>;
};

function scope(ctx: WorkspaceContext): TenantScope {
  return { companyId: ctx.companyId };
}

function toSummary(doc: ReplenishmentProposalDoc): ReplenishmentSummaryDto {
  return {
    id: idKey(doc._id),
    warehouseCode: doc.warehouseCode,
    status: doc.status,
    horizonDays: doc.horizonDays,
    lineCount: doc.lineCount,
    rationaleStatus: doc.rationaleStatus,
    generatedAt: doc.generatedAt.toISOString(),
    convertedOrderId: doc.convertedOrderId ? idKey(doc.convertedOrderId) : null,
  };
}

function toDetail(doc: ReplenishmentProposalDoc, canConvert: boolean): ReplenishmentProposalDto {
  return {
    ...toSummary(doc),
    warehouseId: idKey(doc.warehouseId),
    lookbackDays: doc.lookbackDays,
    method: doc.method,
    truncated: doc.truncated,
    rationaleProvider: doc.rationaleProvider,
    rationaleModel: doc.rationaleModel,
    version: doc.version,
    canConvert: canConvert && doc.status === "proposed" && doc.lines.some((line) => line.suggestedMicro > 0),
    lines: doc.lines
      .filter((line) => line.suggestedMicro > 0)
      .map((line) => ({
        productId: idKey(line.productId),
        sku: line.sku,
        productName: line.productName,
        unitOfMeasure: line.unitOfMeasure,
        onHand: formatQuantity(line.onHandMicro, 3),
        reorderPoint: formatQuantity(line.reorderPointMicro, 3),
        consumedLookback: formatQuantity(line.consumedMicro, 3),
        forecastDailyUsage: formatQuantity(line.forecastDailyUsageMicro, 3),
        suggested: formatQuantity(line.suggestedMicro, 3),
        rationale: line.rationale,
        calculation: calculationStatements(toFacts(line, doc.lookbackDays, doc.horizonDays)),
      })),
  };
}

/**
 * Computes the suggested whole-unit shortfall for each candidate product.
 * Pure function so the forecasting rules can be unit tested without a database.
 */
export function computeReplenishmentLines(input: {
  products: Array<Pick<ProductDoc, "_id" | "sku" | "name" | "unitOfMeasure" | "reorderPointMicro">>;
  onHandByProduct: Map<string, number>;
  consumedByProduct: Map<string, number>;
  lookbackDays: number;
  horizonDays: number;
}): ReplenishmentLineSub[] {
  const lines: ReplenishmentLineSub[] = [];
  for (const product of input.products) {
    const key = idKey(product._id);
    const onHandMicro = input.onHandByProduct.get(key) ?? 0;
    const consumedMicro = input.consumedByProduct.get(key) ?? 0;
    const forecastDailyUsageMicro = Math.round(consumedMicro / input.lookbackDays);
    const targetMicro = forecastDailyUsageMicro * input.horizonDays + product.reorderPointMicro;
    let suggestedMicro = Math.max(0, targetMicro - onHandMicro);
    if (isCountableUnit(product.unitOfMeasure)) {
      suggestedMicro = Math.ceil(suggestedMicro / QTY_SCALE) * QTY_SCALE;
    }
    if (suggestedMicro === 0) continue;
    lines.push({
      productId: product._id,
      sku: product.sku,
      productName: product.name,
      unitOfMeasure: product.unitOfMeasure,
      onHandMicro,
      reorderPointMicro: product.reorderPointMicro,
      consumedMicro,
      forecastDailyUsageMicro,
      suggestedMicro,
      rationale: null,
    });
  }
  return lines;
}

export async function listReplenishmentProposals(
  ctx: WorkspaceContext,
  query: { page: number }
): Promise<Paged<ReplenishmentSummaryDto>> {
  assertPermission(ctx.permissions, PERMISSIONS.PURCHASING_READ);
  const filter = { ...tenantFilter(scope(ctx)) };
  const collection = ctx.db.collection<ReplenishmentProposalDoc>(COLLECTIONS.purchaseReplenishmentProposals);
  const [total, docs] = await Promise.all([
    collection.countDocuments(filter),
    collection
      .find(filter, { projection: { lines: 0 } })
      .sort({ generatedAt: -1, _id: -1 })
      .skip(skipFor(query.page, PAGE_SIZE))
      .limit(PAGE_SIZE)
      .toArray(),
  ]);
  return { items: docs.map(toSummary), ...pageInfo(query.page, PAGE_SIZE, total) };
}

export async function getReplenishmentProposal(ctx: WorkspaceContext, proposalId: string): Promise<ReplenishmentProposalDto> {
  assertPermission(ctx.permissions, PERMISSIONS.PURCHASING_READ);
  const doc = await ctx.db
    .collection<ReplenishmentProposalDoc>(COLLECTIONS.purchaseReplenishmentProposals)
    .findOne({ _id: new ObjectId(proposalId), ...tenantFilter(scope(ctx)) });
  if (!doc) throw new AppError("NOT_FOUND", "Replenishment proposal not found");
  return toDetail(doc, ctx.permissions.has(PERMISSIONS.PURCHASING_ORDER_APPROVE));
}

/**
 * Generates and stores a proposal for one warehouse. Reads only tenant-scoped facts, changes no stock,
 * and sends Groq only product ids, SKUs, names and numbers. No supplier, customer or personal data.
 */
export async function generateReplenishmentProposal(
  ctx: WorkspaceContext,
  input: { warehouseId: string; horizonDays: number }
): Promise<ReplenishmentProposalDto> {
  assertPermission(ctx.permissions, PERMISSIONS.PURCHASING_ORDER_MANAGE);
  const warehouseId = new ObjectId(input.warehouseId);
  const warehouse = await ctx.db
    .collection<WarehouseDoc>(COLLECTIONS.inventoryWarehouses)
    .findOne({ _id: warehouseId, ...tenantFilter(scope(ctx)) }, { projection: { code: 1, isActive: 1 } });
  if (!warehouse) throw new AppError("VALIDATION_ERROR", "Choose a warehouse", { warehouseId: "Unknown warehouse" });
  if (!warehouse.isActive) throw new AppError("VALIDATION_ERROR", "This warehouse is inactive", { warehouseId: "Inactive warehouse" });

  const now = new Date();
  const since = new Date(now.getTime() - REPLENISHMENT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const products = await ctx.db
    .collection<ProductDoc>(COLLECTIONS.inventoryProducts)
    .find(
      { ...tenantFilter(scope(ctx)), isActive: true, isStorable: true },
      { projection: { sku: 1, name: 1, unitOfMeasure: 1, reorderPointMicro: 1 } }
    )
    .sort({ normalizedName: 1, _id: 1 })
    .limit(MAX_CANDIDATE_PRODUCTS + 1)
    .toArray();
  const truncated = products.length > MAX_CANDIDATE_PRODUCTS;
  const candidates = products.slice(0, MAX_CANDIDATE_PRODUCTS);
  const candidateIds = candidates.map((product) => product._id);

  const [balances, demand] = await Promise.all([
    ctx.db
      .collection<StockBalanceDoc>(COLLECTIONS.inventoryStockBalances)
      .find({ ...tenantFilter(scope(ctx)), warehouseId, productId: { $in: candidateIds } }, { projection: { productId: 1, onHandMicro: 1 } })
      .toArray(),
    ctx.db
      .collection(COLLECTIONS.inventoryStockMovements)
      .aggregate<{ _id: ObjectId; consumedMicro: number }>([
        {
          $match: {
            companyId: ctx.companyId,
            warehouseId,
            productId: { $in: candidateIds },
            createdAt: { $gte: since },
            deltaMicro: { $lt: 0 },
            movementType: { $in: [...DEMAND_MOVEMENT_TYPES] },
          },
        },
        { $group: { _id: "$productId", consumedMicro: { $sum: { $multiply: ["$deltaMicro", -1] } } } },
      ])
      .toArray(),
  ]);

  const lines = computeReplenishmentLines({
    products: candidates,
    onHandByProduct: new Map(balances.map((balance) => [idKey(balance.productId), balance.onHandMicro])),
    consumedByProduct: new Map(demand.map((row) => [idKey(row._id), row.consumedMicro])),
    lookbackDays: REPLENISHMENT_LOOKBACK_DAYS,
    horizonDays: input.horizonDays,
  }).slice(0, MAX_CANDIDATE_PRODUCTS);

  const rationale = await generateRationales(ctx, lines.map((line) => toRationaleInput(line, input.horizonDays)));
  for (const line of lines) {
    line.rationale = rationale.byProductId.get(idKey(line.productId)) ?? null;
  }

  const doc: ReplenishmentProposalDoc = {
    _id: new ObjectId(),
    ...tenantFilter(scope(ctx)),
    warehouseId,
    warehouseCode: warehouse.code,
    status: "proposed",
    method: REPLENISHMENT_METHOD,
    lookbackDays: REPLENISHMENT_LOOKBACK_DAYS,
    horizonDays: input.horizonDays,
    truncated,
    rationaleStatus: rationale.status,
    rationaleProvider: rationale.provider,
    rationaleModel: rationale.model,
    lineCount: lines.filter((line) => line.suggestedMicro > 0).length,
    lines,
    generatedBy: ctx.userId,
    generatedAt: now,
    convertedOrderId: null,
    convertedBy: null,
    convertedAt: null,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
  await ctx.db.collection<ReplenishmentProposalDoc>(COLLECTIONS.purchaseReplenishmentProposals).insertOne(doc);
  await recordAudit(ctx.db, {
    companyId: ctx.companyId,
    actorUserId: ctx.userId,
    action: "purchasing.replenishment.generated",
    entityType: "replenishment_proposal",
    entityId: idKey(doc._id),
    requestId: ctx.requestId,
    metadata: { warehouseCode: warehouse.code, lineCount: lines.length, rationaleStatus: rationale.status },
  });
  return toDetail(doc, true);
}

/** Stored line facts, in the shape the calculation module reads. */
function toFacts(line: ReplenishmentLineSub, lookbackDays: number, horizonDays: number): ReplenishmentFacts {
  return {
    unitOfMeasure: line.unitOfMeasure,
    lookbackDays,
    horizonDays,
    onHandMicro: line.onHandMicro,
    reorderPointMicro: line.reorderPointMicro,
    consumedMicro: line.consumedMicro,
    forecastDailyUsageMicro: line.forecastDailyUsageMicro,
    suggestedMicro: line.suggestedMicro,
  };
}

/** Only the stored facts and the computed numbers leave the server. No supplier, customer or company data. */
function toRationaleInput(line: ReplenishmentLineSub, horizonDays: number): RationaleFacts {
  const facts = toFacts(line, REPLENISHMENT_LOOKBACK_DAYS, horizonDays);
  return {
    productId: idKey(line.productId),
    sku: line.sku,
    name: line.productName,
    unit: line.unitOfMeasure,
    countable: isCountableUnit(line.unitOfMeasure),
    lookbackDays: REPLENISHMENT_LOOKBACK_DAYS,
    horizonDays,
    consumed: formatFact(line.consumedMicro),
    dailyUsage: formatFact(line.forecastDailyUsageMicro),
    projectedUse: formatFact(projectedUseMicro(facts)),
    reorderPoint: formatFact(line.reorderPointMicro),
    onHand: formatFact(line.onHandMicro),
    requirement: formatFact(requirementMicro(facts)),
    suggested: formatFact(line.suggestedMicro),
  };
}

/** A claim older than this is treated as abandoned (for example, the process stopped mid-conversion). */
export const CONVERSION_STALE_AFTER_MS = 10 * 60 * 1000;

/** Name of the unique index that allows at most one purchase order per proposal (see server/db/indexes.ts). */
const SOURCE_UNIQUE_INDEX = "po_replenishment_source_unique";

/**
 * Converts an approved proposal into a DRAFT purchase order. The purchase order is not approved and
 * changes no stock; it still goes through the normal approval and receipt flow.
 *
 * - Requires both the approve and order-manage permissions.
 * - Claims the proposal (`proposed` -> `converting`) with a conditional update and records the order ID it
 *   will use. Duplicate requests fail the claim.
 * - The order is created with that reserved ID and the proposal ID. A unique index allows only one order per
 *   proposal, so a repeated write cannot create a second order. If an order already exists, it is adopted.
 * - Unit costs come from the product record at conversion time, never from the client.
 * - If order creation fails, the claim is released so the user can retry.
 */
export async function convertReplenishmentProposal(
  ctx: WorkspaceContext,
  proposalId: string,
  input: { supplierId: string; expectedVersion: number }
): Promise<PurchaseOrderDetailDto> {
  assertPermission(ctx.permissions, PERMISSIONS.PURCHASING_ORDER_APPROVE);
  assertPermission(ctx.permissions, PERMISSIONS.PURCHASING_ORDER_MANAGE);
  const objectId = new ObjectId(proposalId);
  const proposals = ctx.db.collection<ReplenishmentProposalDoc>(COLLECTIONS.purchaseReplenishmentProposals);

  const existing = await proposals.findOne({ _id: objectId, ...tenantFilter(scope(ctx)) });
  if (!existing) throw new AppError("NOT_FOUND", "Replenishment proposal not found");
  if (existing.status !== "proposed") {
    throw new AppError("CONFLICT", "This proposal has already been converted or is being converted");
  }
  if (existing.version !== input.expectedVersion) {
    throw new AppError("CONFLICT", "This proposal changed. Reload it and review the suggestions again.");
  }
  const suggested = existing.lines.filter((line) => line.suggestedMicro > 0);
  if (suggested.length === 0) throw new AppError("VALIDATION_ERROR", "This proposal has no quantities to order");

  const orderId = new ObjectId();
  const claim = await proposals.updateOne(
    { _id: objectId, ...tenantFilter(scope(ctx)), status: "proposed", version: input.expectedVersion },
    {
      $set: { status: "converting", conversionOrderId: orderId, claimedAt: new Date(), updatedAt: new Date() },
      $inc: { version: 1 },
    }
  );
  if (claim.matchedCount === 0) {
    throw new AppError("CONFLICT", "This proposal has already been converted or changed. Reload it.");
  }

  const products = await ctx.db
    .collection<ProductDoc>(COLLECTIONS.inventoryProducts)
    .find({ ...tenantFilter(scope(ctx)), _id: { $in: suggested.map((line) => line.productId) } }, { projection: { costMilli: 1 } })
    .toArray();
  const costByProduct = new Map(products.map((product) => [idKey(product._id), product.costMilli]));

  let poInput: PurchaseOrderInput;
  try {
    poInput = purchaseOrderInputSchema.parse({
      supplierId: input.supplierId,
      expectedDate: "",
      notes: `Draft created from replenishment proposal ${proposalId}`,
      lines: suggested.map((line) => ({
        productId: idKey(line.productId),
        quantity: formatQuantity(line.suggestedMicro, 3),
        unitCost: formatMoneyAmount(costByProduct.get(idKey(line.productId)) ?? 0, 3),
        taxRate: "0",
      })),
    });
  } catch (err) {
    await releaseClaim(proposals, objectId, ctx);
    throw err;
  }

  let order: PurchaseOrderDetailDto;
  try {
    order = await createPurchaseOrder(ctx, poInput, { orderId, proposalId: objectId });
  } catch (err) {
    if (isSourceDuplicate(err)) {
      // An order for this proposal already exists, for example from an earlier attempt whose final write failed.
      // Adopt it rather than creating another.
      const adopted = await ctx.db
        .collection<PurchaseOrderDoc>(COLLECTIONS.purchaseOrders)
        .findOne({ ...tenantFilter(scope(ctx)), sourceReplenishmentProposalId: objectId }, { projection: { _id: 1 } });
      if (!adopted) throw err;
      await finalizeConversion(ctx, objectId, adopted._id);
      return getPurchaseOrder(ctx, idKey(adopted._id));
    }
    await releaseClaim(proposals, objectId, ctx);
    throw err;
  }

  // If this write fails after the order exists, the proposal stays `converting`. The reconcile action
  // finishes it by linking the existing order. No second order can be created in the meantime.
  await finalizeConversion(ctx, objectId, orderId);
  await recordAudit(ctx.db, {
    companyId: ctx.companyId,
    actorUserId: ctx.userId,
    action: "purchasing.replenishment.converted",
    entityType: "replenishment_proposal",
    entityId: proposalId,
    requestId: ctx.requestId,
    metadata: { orderNumber: order.orderNumber, lineCount: suggested.length },
  });
  return order;
}

/**
 * Recovery for a proposal left in `converting` by a crash or a failed final write. It never creates an order.
 * - If an order exists for this proposal, the proposal is finished and linked to it.
 * - Otherwise the claim is released, but only after CONVERSION_STALE_AFTER_MS. Release is safe: the unique
 *   index blocks a second order, so a late write from the original attempt is adopted by the next conversion.
 */
export async function reconcileReplenishmentProposal(ctx: WorkspaceContext, proposalId: string): Promise<ReplenishmentProposalDto> {
  assertPermission(ctx.permissions, PERMISSIONS.PURCHASING_ORDER_APPROVE);
  assertPermission(ctx.permissions, PERMISSIONS.PURCHASING_ORDER_MANAGE);
  const objectId = new ObjectId(proposalId);
  const proposals = ctx.db.collection<ReplenishmentProposalDoc>(COLLECTIONS.purchaseReplenishmentProposals);

  const doc = await proposals.findOne({ _id: objectId, ...tenantFilter(scope(ctx)) });
  if (!doc) throw new AppError("NOT_FOUND", "Replenishment proposal not found");
  if (doc.status !== "converting") throw new AppError("CONFLICT", "This proposal is not waiting on a conversion.");

  const order = await ctx.db
    .collection<PurchaseOrderDoc>(COLLECTIONS.purchaseOrders)
    .findOne({ ...tenantFilter(scope(ctx)), sourceReplenishmentProposalId: objectId }, { projection: { _id: 1, orderNumber: 1 } });

  let outcome: "linked" | "released";
  if (order) {
    await finalizeConversion(ctx, objectId, order._id);
    outcome = "linked";
  } else {
    const claimedAt = doc.claimedAt ?? null;
    if (!claimedAt || Date.now() - claimedAt.getTime() < CONVERSION_STALE_AFTER_MS) {
      throw new AppError("CONFLICT", "A conversion for this proposal may still be running. Try again in a few minutes.");
    }
    const released = await proposals.updateOne(
      { _id: objectId, ...tenantFilter(scope(ctx)), status: "converting", version: doc.version },
      { $set: { status: "proposed", updatedAt: new Date() }, $unset: { claimedAt: "", conversionOrderId: "" }, $inc: { version: 1 } }
    );
    if (released.matchedCount === 0) throw new AppError("CONFLICT", "This proposal changed while it was being checked. Reload it.");
    outcome = "released";
  }

  await recordAudit(ctx.db, {
    companyId: ctx.companyId,
    actorUserId: ctx.userId,
    action: "purchasing.replenishment.reconciled",
    entityType: "replenishment_proposal",
    entityId: proposalId,
    requestId: ctx.requestId,
    metadata: { outcome, orderNumber: order?.orderNumber ?? "" },
  });
  return getReplenishmentProposal(ctx, proposalId);
}

function isSourceDuplicate(error: unknown): boolean {
  const driverError = error as { code?: number; message?: unknown } | null;
  return driverError?.code === 11000 && typeof driverError.message === "string" && driverError.message.includes(SOURCE_UNIQUE_INDEX);
}

/** Moves a claimed proposal to `converted` and links the order. Conditional on the claim, so it runs once. */
async function finalizeConversion(ctx: WorkspaceContext, objectId: ObjectId, orderId: ObjectId): Promise<void> {
  const now = new Date();
  await ctx.db.collection<ReplenishmentProposalDoc>(COLLECTIONS.purchaseReplenishmentProposals).updateOne(
    { _id: objectId, ...tenantFilter(scope(ctx)), status: "converting" },
    {
      $set: { status: "converted", convertedOrderId: orderId, convertedBy: ctx.userId, convertedAt: now, updatedAt: now },
      $unset: { claimedAt: "", conversionOrderId: "" },
      $inc: { version: 1 },
    }
  );
}

async function releaseClaim(
  proposals: Collection<ReplenishmentProposalDoc>,
  objectId: ObjectId,
  ctx: WorkspaceContext
): Promise<void> {
  await proposals.updateOne(
    { _id: objectId, ...tenantFilter(scope(ctx)), status: "converting" },
    { $set: { status: "proposed", updatedAt: new Date() }, $unset: { claimedAt: "", conversionOrderId: "" }, $inc: { version: 1 } }
  );
}
