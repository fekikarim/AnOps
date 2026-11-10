import "server-only";
import { ObjectId, type Filter } from "mongodb";
import { COLLECTIONS, type SupplierDoc, type TenantScope } from "@/server/db/documents";
import { escapeRegex, MAX_BOUNDED_LIST, tenantFilter } from "@/server/db/scope";
import { pageInfo, skipFor } from "@/server/db/pagination";
import { assertPermission, PERMISSIONS } from "@/server/security/permissions";
import type { WorkspaceContext } from "@/server/tenancy/workspace";
import { AppError } from "@/shared/lib/errors";
import type { SupplierInput } from "@/features/purchasing/schemas/purchasing.schema";
import type { Paged, SupplierDto } from "@/features/purchasing/types";
import { idKey } from "@/server/inventory/mappers";
import { assertExportWithinLimit, MAX_EXPORT_ROWS } from "@/server/exports/limits";

export const SUPPLIER_PAGE_SIZE = 25;

function scope(ctx: WorkspaceContext): TenantScope {
  return { companyId: ctx.companyId };
}

export function toSupplierDto(doc: SupplierDoc): SupplierDto {
  return {
    id: idKey(doc._id),
    name: doc.name,
    email: doc.email,
    phone: doc.phone,
    taxIdentifier: doc.taxIdentifier,
    address: doc.address,
    isActive: doc.isActive,
  };
}

/** Shared by the supplier list and the supplier export. */
function supplierListFilter(ctx: WorkspaceContext, q: string): Filter<SupplierDoc> {
  const filter: Filter<SupplierDoc> = { ...tenantFilter(scope(ctx)) };
  if (q) filter.normalizedName = { $regex: `^${escapeRegex(q.toLowerCase())}` };
  return filter;
}

export async function listSuppliers(
  ctx: WorkspaceContext,
  query: { q: string; page: number }
): Promise<Paged<SupplierDto>> {
  assertPermission(ctx.permissions, PERMISSIONS.PURCHASING_READ);
  const filter = supplierListFilter(ctx, query.q);

  const suppliers = ctx.db.collection<SupplierDoc>(COLLECTIONS.purchaseSuppliers);
  const [total, docs] = await Promise.all([
    suppliers.countDocuments(filter),
    suppliers.find(filter).sort({ normalizedName: 1, _id: 1 }).skip(skipFor(query.page, SUPPLIER_PAGE_SIZE)).limit(SUPPLIER_PAGE_SIZE).toArray(),
  ]);
  return { items: docs.map(toSupplierDto), ...pageInfo(query.page, SUPPLIER_PAGE_SIZE, total) };
}

/** Every supplier matching the filter, sorted like the list. Bounded by MAX_EXPORT_ROWS. */
export async function listSuppliersForExport(ctx: WorkspaceContext, query: { q: string }): Promise<SupplierDto[]> {
  assertPermission(ctx.permissions, PERMISSIONS.PURCHASING_READ);
  const filter = supplierListFilter(ctx, query.q);
  const suppliers = ctx.db.collection<SupplierDoc>(COLLECTIONS.purchaseSuppliers);
  assertExportWithinLimit(await suppliers.countDocuments(filter));
  const docs = await suppliers.find(filter).sort({ normalizedName: 1, _id: 1 }).limit(MAX_EXPORT_ROWS).toArray();
  return docs.map(toSupplierDto);
}

export async function getSupplier(ctx: WorkspaceContext, supplierId: string): Promise<SupplierDto> {
  assertPermission(ctx.permissions, PERMISSIONS.PURCHASING_READ);
  const doc = await ctx.db
    .collection<SupplierDoc>(COLLECTIONS.purchaseSuppliers)
    .findOne({ _id: new ObjectId(supplierId), ...tenantFilter(scope(ctx)) });
  if (!doc) throw new AppError("NOT_FOUND", "Supplier not found");
  return toSupplierDto(doc);
}

export async function createSupplier(ctx: WorkspaceContext, input: SupplierInput): Promise<SupplierDto> {
  assertPermission(ctx.permissions, PERMISSIONS.PURCHASING_SUPPLIER_MANAGE);
  const now = new Date();
  const doc: SupplierDoc = {
    _id: new ObjectId(),
    ...tenantFilter(scope(ctx)),
    name: input.name,
    normalizedName: input.name.toLowerCase(),
    email: input.email.toLowerCase(),
    phone: input.phone,
    taxIdentifier: input.taxIdentifier,
    address: input.address,
    isActive: input.isActive,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await ctx.db.collection<SupplierDoc>(COLLECTIONS.purchaseSuppliers).insertOne(doc);
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      throw new AppError("CONFLICT", "A supplier with this name already exists", { name: "Name already in use" });
    }
    throw error;
  }
  return toSupplierDto(doc);
}

/**
 * Suppliers are never deleted: historical purchase orders and receipts keep referring
 * to them. Deactivation hides a supplier from new orders.
 */
export async function updateSupplier(ctx: WorkspaceContext, supplierId: string, input: SupplierInput): Promise<SupplierDto> {
  assertPermission(ctx.permissions, PERMISSIONS.PURCHASING_SUPPLIER_MANAGE);
  try {
    const result = await ctx.db.collection<SupplierDoc>(COLLECTIONS.purchaseSuppliers).updateOne(
      { _id: new ObjectId(supplierId), ...tenantFilter(scope(ctx)) },
      {
        $set: {
          name: input.name,
          normalizedName: input.name.toLowerCase(),
          email: input.email.toLowerCase(),
          phone: input.phone,
          taxIdentifier: input.taxIdentifier,
          address: input.address,
          isActive: input.isActive,
          updatedAt: new Date(),
        },
      }
    );
    if (result.matchedCount === 0) throw new AppError("NOT_FOUND", "Supplier not found");
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      throw new AppError("CONFLICT", "A supplier with this name already exists", { name: "Name already in use" });
    }
    throw error;
  }
  return getSupplier(ctx, supplierId);
}

export async function supplierOptions(ctx: WorkspaceContext): Promise<{ id: string; name: string }[]> {
  assertPermission(ctx.permissions, PERMISSIONS.PURCHASING_READ);
  const docs = await ctx.db
    .collection<SupplierDoc>(COLLECTIONS.purchaseSuppliers)
    .find({ ...tenantFilter(scope(ctx)), isActive: true }, { projection: { name: 1 } })
    .sort({ normalizedName: 1 })
    .limit(MAX_BOUNDED_LIST)
    .toArray();
  return docs.map((doc) => ({ id: idKey(doc._id), name: doc.name }));
}
