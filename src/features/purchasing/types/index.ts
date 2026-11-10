import type { UnitOfMeasure } from "@/shared/domain/units";

export type { Paged, PageInfo } from "@/features/inventory/types";

export type SupplierDto = {
  id: string;
  name: string;
  email: string;
  phone: string;
  taxIdentifier: string;
  address: string;
  isActive: boolean;
};

export type PurchaseOrderStatusDto = "draft" | "approved" | "partially_received" | "received" | "cancelled";

export type PurchaseOrderSummaryDto = {
  id: string;
  orderNumber: string;
  supplierName: string;
  status: PurchaseOrderStatusDto;
  currencyCode: string;
  total: string;
  lineCount: number;
  expectedDate: string | null;
  createdAt: string;
};

export type PurchaseOrderLineDto = {
  id: string;
  productId: string;
  sku: string;
  productName: string;
  unitOfMeasure: UnitOfMeasure;
  ordered: string;
  received: string;
  remaining: string;
  orderedMicro: number;
  receivedMicro: number;
  remainingMicro: number;
  unitCost: string;
  taxRate: string;
  lineSubtotal: string;
  lineTax: string;
};

export type PurchaseOrderDetailDto = PurchaseOrderSummaryDto & {
  supplierId: string;
  notes: string;
  subtotal: string;
  tax: string;
  approvedAt: string | null;
  version: number;
  lines: PurchaseOrderLineDto[];
  permissions: {
    canEdit: boolean;
    canApprove: boolean;
    canCancel: boolean;
    canReceive: boolean;
  };
};

export type ReceiptStatusDto = "draft" | "posted" | "cancelled";

export type ReceiptSummaryDto = {
  id: string;
  receiptNumber: string;
  orderNumber: string;
  supplierName: string;
  warehouseCode: string;
  status: ReceiptStatusDto;
  lineCount: number;
  postedAt: string | null;
  createdAt: string;
};

export type ReceiptDetailDto = ReceiptSummaryDto & {
  purchaseOrderId: string;
  warehouseId: string;
  version: number;
  lines: {
    purchaseOrderLineId: string;
    sku: string;
    productName: string;
    unitOfMeasure: UnitOfMeasure;
    quantity: string;
  }[];
  permissions: {
    canPost: boolean;
    canCancel: boolean;
  };
};

export type OrderOptionDto = { id: string; orderNumber: string; supplierName: string; status: PurchaseOrderStatusDto };
