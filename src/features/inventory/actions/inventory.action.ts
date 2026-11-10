"use server";

import { revalidatePath } from "next/cache";
import {
  categoryInputSchema,
  openingStockBatchSchema,
  productInputSchema,
  productWithOpeningStockSchema,
  productUpdateSchema,
  stockAdjustmentInputSchema,
  stockMoveInputSchema,
  stockTransferInputSchema,
  warehouseInputSchema,
} from "@/features/inventory/schemas/inventory.schema";
import { objectIdSchema } from "@/shared/lib/schema-primitives";
import { z } from "zod";
import { parseInput, runAction } from "@/server/actions/run-action";
import {
  createCategory,
  createProduct,
  createWarehouse,
  deleteProduct,
  setCategoryActive,
  setProductActive,
  updateCategory,
  updateProduct,
  updateWarehouse,
} from "@/server/inventory/catalog.service";
import { createProductWithOpeningStock, getProductStockContext, recordOpeningStockBatch, type ProductStockContext } from "@/server/inventory/onboarding.service";
import { adjustStock, issueStock, receiveStock, transferStock } from "@/server/inventory/stock.service";
import type { ActionResult } from "@/shared/lib/errors";
import type { CategoryDto, OpeningStockBatchResult, ProductCreatedResult, ProductDto, WarehouseDto } from "@/features/inventory/types";

const STOCK_RATE_LIMIT = { limit: 60, windowMs: 60_000 };

function refreshInventory(): void {
  revalidatePath("/inventory", "layout");
}

export async function createCategoryAction(raw: unknown): Promise<ActionResult<CategoryDto>> {
  return runAction("inventory.category.create", async (ctx) => {
    const input = parseInput(categoryInputSchema, raw);
    const result = await createCategory(ctx, input);
    refreshInventory();
    return result;
  });
}

export async function updateCategoryAction(id: unknown, raw: unknown): Promise<ActionResult<CategoryDto>> {
  return runAction("inventory.category.update", async (ctx) => {
    const categoryId = parseInput(objectIdSchema, id);
    const input = parseInput(categoryInputSchema, raw);
    const result = await updateCategory(ctx, categoryId, input);
    refreshInventory();
    return result;
  });
}

export async function setCategoryActiveAction(id: unknown, isActive: unknown): Promise<ActionResult<null>> {
  return runAction("inventory.category.toggle", async (ctx) => {
    const categoryId = parseInput(objectIdSchema, id);
    const active = parseInput(z.boolean(), isActive);
    await setCategoryActive(ctx, categoryId, active);
    refreshInventory();
    return null;
  });
}

export async function createProductAction(raw: unknown): Promise<ActionResult<ProductDto>> {
  return runAction("inventory.product.create", async (ctx) => {
    const input = parseInput(productInputSchema, raw);
    const result = await createProduct(ctx, input);
    refreshInventory();
    return result;
  });
}

/** Creates the product and, when a quantity is given, posts its opening stock through the receipt ledger. */
export async function createProductWithStockAction(raw: unknown): Promise<ActionResult<ProductCreatedResult>> {
  return runAction("inventory.product.create_with_stock", async (ctx) => {
    const result = await createProductWithOpeningStock(ctx, parseInput(productWithOpeningStockSchema, raw));
    refreshInventory();
    return result;
  });
}

export async function recordOpeningStockAction(raw: unknown): Promise<ActionResult<OpeningStockBatchResult>> {
  return runAction(
    "inventory.stock.opening",
    async (ctx) => {
      const result = await recordOpeningStockBatch(ctx, parseInput(openingStockBatchSchema, raw));
      refreshInventory();
      return result;
    },
    { rateLimit: STOCK_RATE_LIMIT }
  );
}

export async function updateProductAction(id: unknown, raw: unknown): Promise<ActionResult<ProductDto>> {
  return runAction("inventory.product.update", async (ctx) => {
    const productId = parseInput(objectIdSchema, id);
    const input = parseInput(productUpdateSchema, raw);
    const result = await updateProduct(ctx, productId, input);
    refreshInventory();
    return result;
  });
}

export async function setProductActiveAction(id: unknown, isActive: unknown): Promise<ActionResult<null>> {
  return runAction("inventory.product.toggle", async (ctx) => {
    const productId = parseInput(objectIdSchema, id);
    const active = parseInput(z.boolean(), isActive);
    await setProductActive(ctx, productId, active);
    refreshInventory();
    return null;
  });
}

export async function deleteProductAction(id: unknown): Promise<ActionResult<null>> {
  return runAction("inventory.product.delete", async (ctx) => {
    const productId = parseInput(objectIdSchema, id);
    await deleteProduct(ctx, productId);
    refreshInventory();
    return null;
  });
}

export async function createWarehouseAction(raw: unknown): Promise<ActionResult<WarehouseDto>> {
  return runAction("inventory.warehouse.create", async (ctx) => {
    const input = parseInput(warehouseInputSchema, raw);
    const result = await createWarehouse(ctx, input);
    refreshInventory();
    return result;
  });
}

export async function updateWarehouseAction(id: unknown, raw: unknown): Promise<ActionResult<WarehouseDto>> {
  return runAction("inventory.warehouse.update", async (ctx) => {
    const warehouseId = parseInput(objectIdSchema, id);
    const input = parseInput(warehouseInputSchema, raw);
    const result = await updateWarehouse(ctx, warehouseId, input);
    refreshInventory();
    return result;
  });
}

export async function receiveStockAction(raw: unknown): Promise<ActionResult<null>> {
  return runAction(
    "inventory.stock.receive",
    async (ctx) => {
      await receiveStock(ctx, parseInput(stockMoveInputSchema, raw));
      refreshInventory();
      return null;
    },
    { rateLimit: STOCK_RATE_LIMIT }
  );
}

export async function issueStockAction(raw: unknown): Promise<ActionResult<null>> {
  return runAction(
    "inventory.stock.issue",
    async (ctx) => {
      await issueStock(ctx, parseInput(stockMoveInputSchema, raw));
      refreshInventory();
      return null;
    },
    { rateLimit: STOCK_RATE_LIMIT }
  );
}

export async function transferStockAction(raw: unknown): Promise<ActionResult<null>> {
  return runAction(
    "inventory.stock.transfer",
    async (ctx) => {
      await transferStock(ctx, parseInput(stockTransferInputSchema, raw));
      refreshInventory();
      return null;
    },
    { rateLimit: STOCK_RATE_LIMIT }
  );
}

export async function adjustStockAction(raw: unknown): Promise<ActionResult<null>> {
  return runAction(
    "inventory.stock.adjust",
    async (ctx) => {
      await adjustStock(ctx, parseInput(stockAdjustmentInputSchema, raw));
      refreshInventory();
      return null;
    },
    { rateLimit: STOCK_RATE_LIMIT }
  );
}

/** Read-only: on hand, reorder level and quantity already on order for the products a form is showing. */
export async function getStockContextAction(ids: unknown): Promise<ActionResult<ProductStockContext[]>> {
  return runAction(
    "inventory.stock.context",
    async (ctx) => getProductStockContext(ctx, parseInput(z.array(objectIdSchema).max(100), ids)),
    { rateLimit: { limit: 240, windowMs: 60_000 } }
  );
}
