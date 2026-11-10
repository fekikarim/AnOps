import "server-only";
import { ObjectId, type Filter } from "mongodb";
import { COLLECTIONS, type BomDoc, type ProductDoc, type TenantScope } from "@/server/db/documents";
import { tenantFilter } from "@/server/db/scope";
import { pageInfo, skipFor } from "@/server/db/pagination";
import { withTransaction } from "@/server/db/transactions";
import { recordAudit } from "@/server/audit/audit.service";
import { assertPermission, PERMISSIONS } from "@/server/security/permissions";
import type { WorkspaceContext } from "@/server/tenancy/workspace";
import { idKey, trimDecimal } from "@/server/inventory/mappers";
import { isCountableUnit } from "@/shared/domain/units";
import { AppError } from "@/shared/lib/errors";
import { formatQuantity, parseQuantity, isWholeQuantity } from "@/shared/lib/fixed-point";
import type { BomInput, BomUpdateInput } from "@/features/manufacturing/schemas/manufacturing.schema";
import type { BomDetailDto, BomSummaryDto, ManufacturingPage } from "@/features/manufacturing/types";

export const BOM_PAGE_SIZE = 25;

function scope(ctx: WorkspaceContext): TenantScope {
  return { companyId: ctx.companyId };
}

function toSummary(doc: BomDoc): BomSummaryDto {
  return {
    id: idKey(doc._id),
    finishedSku: doc.finishedSku,
    finishedName: doc.finishedName,
    revision: doc.revision,
    status: doc.status,
    componentCount: doc.components.length,
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function toDetail(doc: BomDoc, canManage: boolean): BomDetailDto {
  return {
    ...toSummary(doc),
    finishedProductId: idKey(doc.finishedProductId),
    notes: doc.notes,
    version: doc.version,
    components: doc.components.map((component) => ({
      productId: idKey(component.productId),
      sku: component.sku,
      productName: component.productName,
      unitOfMeasure: component.unitOfMeasure,
      quantityPerUnit: trimDecimal(formatQuantity(component.quantityPerUnitMicro, 6)),
    })),
    permissions: {
      canEdit: canManage && doc.status === "draft",
      canActivate: canManage && doc.status === "draft",
      canArchive: canManage && doc.status !== "archived",
    },
  };
}

export async function listBoms(
  ctx: WorkspaceContext,
  query: { status: "all" | "draft" | "active" | "archived"; page: number }
): Promise<ManufacturingPage<BomSummaryDto>> {
  assertPermission(ctx.permissions, PERMISSIONS.MANUFACTURING_READ);
  const filter: Filter<BomDoc> = { ...tenantFilter(scope(ctx)) };
  if (query.status !== "all") filter.status = query.status;
  const boms = ctx.db.collection<BomDoc>(COLLECTIONS.manufacturingBoms);
  const [total, docs] = await Promise.all([
    boms.countDocuments(filter),
    boms.find(filter).sort({ updatedAt: -1, _id: -1 }).skip(skipFor(query.page, BOM_PAGE_SIZE)).limit(BOM_PAGE_SIZE).toArray(),
  ]);
  return { items: docs.map(toSummary), ...pageInfo(query.page, BOM_PAGE_SIZE, total) };
}

export async function getBom(ctx: WorkspaceContext, bomId: string): Promise<BomDetailDto> {
  assertPermission(ctx.permissions, PERMISSIONS.MANUFACTURING_READ);
  const doc = await ctx.db
    .collection<BomDoc>(COLLECTIONS.manufacturingBoms)
    .findOne({ _id: new ObjectId(bomId), ...tenantFilter(scope(ctx)) });
  if (!doc) throw new AppError("NOT_FOUND", "Bill of materials not found");
  return toDetail(doc, ctx.permissions.has(PERMISSIONS.MANUFACTURING_BOM_MANAGE));
}

/**
 * Validates the finished product and components on the server and builds the stored
 * component list. Nested BOMs are not supported: every component is treated as a stored item.
 */
async function buildComponents(ctx: WorkspaceContext, input: BomInput) {
  const productIds = [new ObjectId(input.finishedProductId), ...input.components.map((c) => new ObjectId(c.productId))];
  const products = await ctx.db
    .collection<ProductDoc>(COLLECTIONS.inventoryProducts)
    .find({ ...tenantFilter(scope(ctx)), _id: { $in: productIds } })
    .toArray();
  const byId = new Map(products.map((p) => [idKey(p._id), p]));

  const finished = byId.get(input.finishedProductId);
  if (!finished) throw new AppError("VALIDATION_ERROR", "Choose a finished product", { finishedProductId: "Unknown product" });
  if (!finished.isActive || !finished.isStorable) {
    throw new AppError("VALIDATION_ERROR", "The finished product must be an active stored item", { finishedProductId: "Not producible" });
  }

  const components = input.components.map((component) => {
    const product = byId.get(component.productId);
    if (!product) throw new AppError("VALIDATION_ERROR", "A component product no longer exists");
    if (!product.isActive || !product.isStorable) {
      throw new AppError("VALIDATION_ERROR", `${product.sku} is not an active stored item`);
    }
    const quantityPerUnitMicro = parseQuantity(component.quantityPerUnit);
    if (isCountableUnit(product.unitOfMeasure) && !isWholeQuantity(quantityPerUnitMicro)) {
      throw new AppError("VALIDATION_ERROR", `${product.sku} is counted in whole units`);
    }
    return {
      productId: product._id,
      sku: product.sku,
      productName: product.name,
      unitOfMeasure: product.unitOfMeasure,
      quantityPerUnitMicro,
    };
  });

  return { finished, components };
}

/** Creates a new draft revision. Revisions are numbered per finished product and never reused. */
export async function createBomDraft(ctx: WorkspaceContext, input: BomInput): Promise<BomDetailDto> {
  assertPermission(ctx.permissions, PERMISSIONS.MANUFACTURING_BOM_MANAGE);
  const { finished, components } = await buildComponents(ctx, input);
  const latest = await ctx.db
    .collection<BomDoc>(COLLECTIONS.manufacturingBoms)
    .find({ ...tenantFilter(scope(ctx)), finishedProductId: finished._id }, { projection: { revision: 1 } })
    .sort({ revision: -1 })
    .limit(1)
    .toArray();
  const now = new Date();
  const doc: BomDoc = {
    _id: new ObjectId(),
    ...tenantFilter(scope(ctx)),
    finishedProductId: finished._id,
    finishedSku: finished.sku,
    finishedName: finished.name,
    revision: (latest[0]?.revision ?? 0) + 1,
    status: "draft",
    components,
    notes: input.notes,
    createdBy: ctx.userId,
    activatedAt: null,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
  await ctx.db.collection<BomDoc>(COLLECTIONS.manufacturingBoms).insertOne(doc);
  return toDetail(doc, true);
}

/** Only draft revisions are editable. Active and archived revisions stay fixed for work orders that reference them. */
export async function updateBomDraft(ctx: WorkspaceContext, bomId: string, input: BomUpdateInput): Promise<BomDetailDto> {
  assertPermission(ctx.permissions, PERMISSIONS.MANUFACTURING_BOM_MANAGE);
  const objectId = new ObjectId(bomId);
  const existing = await ctx.db
    .collection<BomDoc>(COLLECTIONS.manufacturingBoms)
    .findOne({ _id: objectId, ...tenantFilter(scope(ctx)) });
  if (!existing) throw new AppError("NOT_FOUND", "Bill of materials not found");
  if (existing.status !== "draft") throw new AppError("INVALID_TRANSITION", "Only draft BOMs can be edited");

  const { finished, components } = await buildComponents(ctx, input);
  const result = await ctx.db.collection<BomDoc>(COLLECTIONS.manufacturingBoms).updateOne(
    { _id: objectId, ...tenantFilter(scope(ctx)), status: "draft", version: input.expectedVersion },
    {
      $set: {
        finishedProductId: finished._id,
        finishedSku: finished.sku,
        finishedName: finished.name,
        components,
        notes: input.notes,
        updatedAt: new Date(),
      },
      $inc: { version: 1 },
    }
  );
  if (result.matchedCount === 0) {
    throw new AppError("CONFLICT", "This BOM was changed by someone else. Reload and try again.");
  }
  return getBom(ctx, bomId);
}

/**
 * Activates a draft. The previous active revision for the same product is archived in
 * the same transaction. A partial unique index also guarantees one active BOM per product.
 */
export async function activateBom(ctx: WorkspaceContext, bomId: string, expectedVersion: number): Promise<void> {
  assertPermission(ctx.permissions, PERMISSIONS.MANUFACTURING_BOM_MANAGE);
  const objectId = new ObjectId(bomId);
  await withTransaction(ctx.db, async (tx) => {
    const session = tx.session;
    const bom = await ctx.db
      .collection<BomDoc>(COLLECTIONS.manufacturingBoms)
      .findOne({ _id: objectId, ...tenantFilter(scope(ctx)) }, { session });
    if (!bom) throw new AppError("NOT_FOUND", "Bill of materials not found");
    if (bom.status !== "draft") throw new AppError("INVALID_TRANSITION", "Only draft BOMs can be activated");
    if (bom.version !== expectedVersion) {
      throw new AppError("CONFLICT", "This BOM was changed by someone else. Reload and try again.");
    }
    const now = new Date();
    await ctx.db.collection<BomDoc>(COLLECTIONS.manufacturingBoms).updateMany(
      { ...tenantFilter(scope(ctx)), finishedProductId: bom.finishedProductId, status: "active" },
      { $set: { status: "archived", updatedAt: now }, $inc: { version: 1 } },
      { session }
    );
    const result = await ctx.db.collection<BomDoc>(COLLECTIONS.manufacturingBoms).updateOne(
      { _id: objectId, ...tenantFilter(scope(ctx)), status: "draft", version: expectedVersion },
      { $set: { status: "active", activatedAt: now, updatedAt: now }, $inc: { version: 1 } },
      { session }
    );
    if (result.matchedCount === 0) {
      throw new AppError("CONFLICT", "This BOM was changed by someone else. Reload and try again.");
    }
    tx.onRollback(() =>
      ctx.db.collection<BomDoc>(COLLECTIONS.manufacturingBoms).updateOne(
        { _id: objectId },
        { $set: { status: "draft", activatedAt: null }, $inc: { version: -1 } }
      )
    );
    await recordAudit(
      ctx.db,
      {
        companyId: ctx.companyId,
        actorUserId: ctx.userId,
        action: "manufacturing.bom.activated",
        entityType: "bom",
        entityId: bomId,
        requestId: ctx.requestId,
        metadata: { revision: bom.revision },
      },
      tx
    );
  });
}

/** Archives a revision. Work orders keep their own component snapshot, so archiving never changes them. */
export async function archiveBom(ctx: WorkspaceContext, bomId: string): Promise<void> {
  assertPermission(ctx.permissions, PERMISSIONS.MANUFACTURING_BOM_MANAGE);
  const result = await ctx.db.collection<BomDoc>(COLLECTIONS.manufacturingBoms).updateOne(
    { _id: new ObjectId(bomId), ...tenantFilter(scope(ctx)), status: { $ne: "archived" } },
    { $set: { status: "archived", updatedAt: new Date() }, $inc: { version: 1 } }
  );
  if (result.matchedCount === 0) throw new AppError("NOT_FOUND", "Bill of materials not found or already archived");
}

export async function bomOptions(ctx: WorkspaceContext): Promise<{ id: string; label: string; revision: number }[]> {
  assertPermission(ctx.permissions, PERMISSIONS.MANUFACTURING_READ);
  const docs = await ctx.db
    .collection<BomDoc>(COLLECTIONS.manufacturingBoms)
    .find({ ...tenantFilter(scope(ctx)), status: "active" }, { projection: { finishedSku: 1, finishedName: 1, revision: 1 } })
    .sort({ finishedSku: 1 })
    .limit(200)
    .toArray();
  return docs.map((doc) => ({ id: idKey(doc._id), label: `${doc.finishedSku} · ${doc.finishedName} (rev ${doc.revision})`, revision: doc.revision }));
}
