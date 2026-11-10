import "server-only";
import { ObjectId, type Db } from "mongodb";
import { COLLECTIONS, type TenantScope } from "@/server/db/documents";
import { assertPermission, type Permission } from "@/server/security/permissions";
import type { WorkspaceContext } from "@/server/tenancy/workspace";
import { AppError } from "@/shared/lib/errors";

export const MARKETING_PAGE_SIZE = 25;
/** Upper bound for any in-memory evaluation (rule matching, eligibility). Larger audiences are rejected. */
export const MAX_EVALUATED_CONTACTS = 20_000;
/** Upper bound for one campaign's recipient snapshot. */
export const MAX_CAMPAIGN_RECIPIENTS = 20_000;
/** Scheduled sends may be queued at most this far ahead. */
export const MAX_SCHEDULE_HORIZON_DAYS = 365;
export const EVALUATION_BATCH_SIZE = 500;

export function scopeOf(ctx: WorkspaceContext): TenantScope {
  return { companyId: ctx.companyId };
}

/** Requires one permission in the active company. Services call this before reading or writing. */
export function requireMarketing(ctx: WorkspaceContext, permission: Permission): void {
  assertPermission(ctx.permissions, permission);
}

/** Converts a route or form identifier into an ObjectId. Malformed ids are reported as not found. */
export function toObjectId(id: string): ObjectId {
  if (!ObjectId.isValid(id) || !/^[a-f0-9]{24}$/i.test(id)) {
    throw new AppError("NOT_FOUND", "Record not found");
  }
  return new ObjectId(id);
}

export function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export function pageMeta(page: number, total: number, pageSize = MARKETING_PAGE_SIZE) {
  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export function skipOf(page: number, pageSize = MARKETING_PAGE_SIZE): number {
  return (page - 1) * pageSize;
}

/** Escapes text for a regex that must match literally. Callers also cap the input length. */
export function literalRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function tagIdsFromParam(raw: string): string[] {
  return raw
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => /^[a-f0-9]{24}$/.test(part))
    .slice(0, 5);
}

export async function companyName(db: Db, companyId: ObjectId): Promise<string> {
  const company = await db
    .collection<{ name: string }>(COLLECTIONS.companies)
    .findOne({ _id: companyId }, { projection: { name: 1 } });
  return company?.name ?? "";
}
