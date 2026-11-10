import "server-only";
import type { PageInfo } from "@/features/inventory/types";

export function pageInfo(page: number, pageSize: number, total: number): PageInfo {
  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export function skipFor(page: number, pageSize: number): number {
  return (page - 1) * pageSize;
}
