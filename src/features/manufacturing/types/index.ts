import type { UnitOfMeasure } from "@/shared/domain/units";
import type { PageInfo, StockStatus } from "@/features/inventory/types";

export type BomStatusDto = "draft" | "active" | "archived";
export type WorkOrderStatusDto = "draft" | "in_progress" | "completed" | "cancelled";

export type BomSummaryDto = {
  id: string;
  finishedSku: string;
  finishedName: string;
  revision: number;
  status: BomStatusDto;
  componentCount: number;
  updatedAt: string;
};

export type BomDetailDto = BomSummaryDto & {
  finishedProductId: string;
  notes: string;
  version: number;
  components: {
    productId: string;
    sku: string;
    productName: string;
    unitOfMeasure: UnitOfMeasure;
    quantityPerUnit: string;
  }[];
  permissions: { canEdit: boolean; canActivate: boolean; canArchive: boolean };
};

export type WorkOrderSummaryDto = {
  id: string;
  orderNumber: string;
  finishedSku: string;
  finishedName: string;
  plannedQuantity: string;
  producedQuantity: string;
  status: WorkOrderStatusDto;
  plannedStart: string | null;
  createdAt: string;
};

export type WorkOrderDetailDto = WorkOrderSummaryDto & {
  bomId: string;
  bomRevision: number;
  warehouseId: string;
  warehouseCode: string;
  version: number;
  startedAt: string | null;
  completedAt: string | null;
  materials: {
    productId: string;
    sku: string;
    productName: string;
    unitOfMeasure: UnitOfMeasure;
    planned: string;
    consumed: string;
    onHand: string;
    shortfall: string;
    /** Exact shortfall (up to six decimals, trimmed) for prefilling a purchase order. */
    shortfallExact: string;
    stockStatus: StockStatus;
    sufficient: boolean;
  }[];
  permissions: { canStart: boolean; canComplete: boolean; canCancel: boolean };
};

export type ManufacturingPage<T> = { items: T[] } & PageInfo;

/** What a production run would need versus what the warehouse holds right now. Read-only; nothing is reserved. */
export type MaterialAvailabilityDto = {
  materials: {
    productId: string;
    sku: string;
    productName: string;
    unitOfMeasure: UnitOfMeasure;
    planned: string;
    onHand: string;
    shortfall: string;
    /** Shortfall as an exact, trimmed quantity that can be typed into a purchase order line. */
    shortfallExact: string;
    sufficient: boolean;
  }[];
  shortCount: number;
  warehouseCode: string;
};
