import "server-only";
import type { ObjectId } from "mongodb";
import type { ProductDoc, StockMovementDoc, WarehouseDoc } from "@/server/db/documents";
import type { ProductDto, StockStatus, StockMovementDto, WarehouseDto } from "@/features/inventory/types";
import { formatMoneyAmount, formatQuantity } from "@/shared/lib/fixed-point";

/** Removes trailing zeros so edit forms show "2.5" rather than "2.500000". */
export function trimDecimal(value: string): string {
  if (!value.includes(".")) return value;
  return value.replace(/0+$/, "").replace(/\.$/, "");
}

export function computeStockStatus(
  product: Pick<ProductDoc, "isStorable" | "reorderPointMicro">,
  onHandMicro: number
): StockStatus {
  if (!product.isStorable) return "not_stored";
  if (onHandMicro <= 0) return "out_of_stock";
  if (product.reorderPointMicro > 0 && onHandMicro <= product.reorderPointMicro) return "low_stock";
  return "in_stock";
}

export function toProductDto(
  product: ProductDoc,
  onHandMicro: number,
  categoryName: string | null
): ProductDto {
  return {
    id: product._id.toHexString(),
    sku: product.sku,
    name: product.name,
    description: product.description,
    categoryId: product.categoryId ? product.categoryId.toHexString() : null,
    categoryName,
    unitOfMeasure: product.unitOfMeasure,
    isStorable: product.isStorable,
    isActive: product.isActive,
    cost: formatMoneyAmount(product.costMilli, 3),
    salePrice: formatMoneyAmount(product.salePriceMilli, 3),
    reorderPoint: trimDecimal(formatQuantity(product.reorderPointMicro, 6)),
    onHand: formatQuantity(onHandMicro, 3),
    onHandMicro,
    reorderPointMicro: product.reorderPointMicro,
    stockStatus: computeStockStatus(product, onHandMicro),
    version: product.version,
    updatedAt: product.updatedAt.toISOString(),
  };
}

export function toWarehouseDto(warehouse: WarehouseDoc, onHandMicro: number): WarehouseDto {
  return {
    id: warehouse._id.toHexString(),
    name: warehouse.name,
    code: warehouse.code,
    address: warehouse.address,
    isActive: warehouse.isActive,
    onHand: formatQuantity(onHandMicro, 3),
    onHandMicro,
    updatedAt: warehouse.updatedAt.toISOString(),
  };
}

export function toMovementDto(
  movement: StockMovementDoc,
  productSku: string,
  warehouseCode: string
): StockMovementDto {
  return {
    id: movement._id.toHexString(),
    productId: movement.productId.toHexString(),
    productSku,
    warehouseId: movement.warehouseId.toHexString(),
    warehouseCode,
    movementType: movement.movementType,
    quantity: trimDecimal(formatQuantity(Math.abs(movement.deltaMicro), 6)),
    deltaMicro: movement.deltaMicro,
    sourceType: movement.sourceType,
    sourceId: movement.sourceId ? movement.sourceId.toHexString() : null,
    reason: movement.reason,
    createdAt: movement.createdAt.toISOString(),
  };
}

/** Safe lookup key for Map-based batch joins. */
export function idKey(id: ObjectId): string {
  return id.toHexString();
}
