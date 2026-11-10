import "server-only";
import type { TenantScope } from "@/server/db/documents";

/** Filter fragment that every tenant-owned query must include. */
export function tenantFilter(scope: TenantScope): { companyId: TenantScope["companyId"] } {
  return { companyId: scope.companyId };
}

/** Escapes user text for use inside an anchored MongoDB regex, so input cannot inject operators. */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const MAX_BOUNDED_LIST = 200;
