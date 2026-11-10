import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { createHarness, parsed, type TestHarness } from "../helpers/workspace";
import {
  productInputSchema,
  stockAdjustmentInputSchema,
  stockMoveInputSchema,
  stockTransferInputSchema,
  warehouseInputSchema,
} from "@/features/inventory/schemas/inventory.schema";
import { COLLECTIONS, type StockBalanceDoc, type StockMovementDoc } from "@/server/db/documents";
import {
  createProduct,
  createWarehouse,
  deleteProduct,
  getProduct,
  listProducts,
  updateProduct,
} from "@/server/inventory/catalog.service";
import { adjustStock, issueStock, listStockMovements, receiveStock, transferStock } from "@/server/inventory/stock.service";
import { getInventoryOverview } from "@/server/inventory/overview.service";
import { AppError } from "@/shared/lib/errors";
import type { WorkspaceContext } from "@/server/tenancy/workspace";

let h: TestHarness;

beforeAll(async () => {
  h = await createHarness();
});

afterAll(async () => {
  await h.cleanup();
});

function productPayload(sku: string, overrides: Record<string, unknown> = {}) {
  return {
    sku,
    name: `Product ${sku}`,
    description: "",
    categoryId: "",
    unitOfMeasure: "unit",
    isStorable: true,
    isActive: true,
    cost: "2.000",
    salePrice: "3.000",
    reorderPoint: "5",
    ...overrides,
  };
}

function newProduct(sku: string, ctx: WorkspaceContext = h.ctx(), overrides: Record<string, unknown> = {}) {
  return createProduct(ctx, parsed(productInputSchema, productPayload(sku, overrides)));
}

function newWarehouse(code: string) {
  return createWarehouse(h.ctx(), parsed(warehouseInputSchema, { name: `Warehouse ${code}`, code, address: "", isActive: true }));
}

async function balanceOf(productId: string, warehouseId: string): Promise<number> {
  const balance = await h.db.collection<StockBalanceDoc>(COLLECTIONS.inventoryStockBalances).findOne({
    productId: ObjectId.createFromHexString(productId),
    warehouseId: ObjectId.createFromHexString(warehouseId),
  });
  return balance?.onHandMicro ?? 0;
}

describe("products and tenant isolation", () => {
  it("creates a product and reads it back through the scoped path", async () => {
    const created = await newProduct("SKU-READ-1");
    const read = await getProduct(h.ctx(), created.id);
    expect(read.sku).toBe("SKU-READ-1");
    expect(read.stockStatus).toBe("out_of_stock");
  });

  it("enforces SKU uniqueness within the company", async () => {
    await newProduct("SKU-DUP-1");
    await expect(newProduct("sku-dup-1")).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("never returns another tenant's product", async () => {
    const mine = await newProduct("SKU-TENANT-1");
    await expect(getProduct(h.otherTenant(), mine.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const otherList = await listProducts(h.otherTenant(), { q: "SKU-TENANT", status: "all", page: 1 });
    expect(otherList.items).toHaveLength(0);
  });

  it("does not let another tenant update or delete a product", async () => {
    const mine = await newProduct("SKU-TENANT-2");
    const edit = {
      ...parsed(productInputSchema, productPayload("SKU-TENANT-2", { name: "hijacked" })),
      expectedVersion: 1,
    };
    await expect(updateProduct(h.otherTenant(), mine.id, edit)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(deleteProduct(h.otherTenant(), mine.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await getProduct(h.ctx(), mine.id)).name).toBe("Product SKU-TENANT-2");
  });

  it("denies read-only members product management", async () => {
    await expect(newProduct("SKU-VIEW-1", h.ctx("viewer"))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("uses bounded pagination and prefix search", async () => {
    for (let i = 0; i < 27; i += 1) {
      await newProduct(`BULK-${String(i).padStart(3, "0")}`);
    }
    const page1 = await listProducts(h.ctx(), { q: "BULK-", status: "active", page: 1 });
    const page2 = await listProducts(h.ctx(), { q: "BULK-", status: "active", page: 2 });
    expect(page1.items).toHaveLength(25);
    expect(page2.items).toHaveLength(2);
    expect(page1.total).toBe(27);
    expect(page1.totalPages).toBe(2);
  });

  it("refuses to hard-delete a product with stock history, but deletes unused ones", async () => {
    const warehouse = await newWarehouse("W-DEL");
    const used = await newProduct("SKU-HIST-1");
    await receiveStock(h.ctx(), parsed(stockMoveInputSchema, { productId: used.id, warehouseId: warehouse.id, quantity: "1", reason: "" }));
    await expect(deleteProduct(h.ctx(), used.id)).rejects.toMatchObject({ code: "CONFLICT" });

    const unused = await newProduct("SKU-UNUSED-1");
    await expect(deleteProduct(h.ctx(), unused.id)).resolves.toBeUndefined();
  });

  it("locks the unit of measure once stock has moved", async () => {
    const warehouse = await newWarehouse("W-UOM");
    const product = await newProduct("SKU-UOM-1", h.ctx(), { unitOfMeasure: "kg", reorderPoint: "0" });
    await receiveStock(h.ctx(), parsed(stockMoveInputSchema, { productId: product.id, warehouseId: warehouse.id, quantity: "2", reason: "" }));
    const edit = {
      ...parsed(productInputSchema, productPayload("SKU-UOM-1", { unitOfMeasure: "m", reorderPoint: "0" })),
      expectedVersion: 1,
    };
    await expect(updateProduct(h.ctx(), product.id, edit)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects stale edits with a conflict instead of overwriting", async () => {
    const product = await newProduct("SKU-VERSION-1");
    const edit = { ...parsed(productInputSchema, productPayload("SKU-VERSION-1", { name: "New name" })), expectedVersion: 99 };
    await expect(updateProduct(h.ctx(), product.id, edit)).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("stock ledger", () => {
  it("receives and issues stock, keeping balance and movement history in step", async () => {
    const warehouse = await newWarehouse("W-LEDGER");
    const product = await newProduct("SKU-LEDGER-1");
    await receiveStock(h.ctx(), parsed(stockMoveInputSchema, { productId: product.id, warehouseId: warehouse.id, quantity: "10", reason: "" }));
    await issueStock(h.ctx(), parsed(stockMoveInputSchema, { productId: product.id, warehouseId: warehouse.id, quantity: "4", reason: "Sample" }));
    expect(await balanceOf(product.id, warehouse.id)).toBe(6_000_000);
    const history = await listStockMovements(h.ctx(), { productId: product.id, page: 1 });
    expect(history.total).toBe(2);
  });

  it("rejects an issue larger than on-hand and leaves the balance untouched", async () => {
    const warehouse = await newWarehouse("W-NEG");
    const product = await newProduct("SKU-NEG-1");
    await receiveStock(h.ctx(), parsed(stockMoveInputSchema, { productId: product.id, warehouseId: warehouse.id, quantity: "3", reason: "" }));
    await expect(
      issueStock(h.ctx(), parsed(stockMoveInputSchema, { productId: product.id, warehouseId: warehouse.id, quantity: "4", reason: "Too many" }))
    ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
    expect(await balanceOf(product.id, warehouse.id)).toBe(3_000_000);
  });

  it("lets exactly one of two concurrent issues take the last units", async () => {
    const warehouse = await newWarehouse("W-RACE");
    const product = await newProduct("SKU-RACE-1");
    await receiveStock(h.ctx(), parsed(stockMoveInputSchema, { productId: product.id, warehouseId: warehouse.id, quantity: "5", reason: "" }));

    const input = parsed(stockMoveInputSchema, { productId: product.id, warehouseId: warehouse.id, quantity: "5", reason: "Race" });
    const results = await Promise.allSettled([issueStock(h.ctx(), input), issueStock(h.ctx(), input)]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(AppError);
    expect(await balanceOf(product.id, warehouse.id)).toBe(0);
  });

  it("transfers stock between warehouses without changing the total", async () => {
    const source = await newWarehouse("W-SRC");
    const target = await newWarehouse("W-DST");
    const product = await newProduct("SKU-XFER-1");
    await receiveStock(h.ctx(), parsed(stockMoveInputSchema, { productId: product.id, warehouseId: source.id, quantity: "8", reason: "" }));
    await transferStock(
      h.ctx(),
      parsed(stockTransferInputSchema, { productId: product.id, fromWarehouseId: source.id, toWarehouseId: target.id, quantity: "3", reason: "" })
    );
    expect(await balanceOf(product.id, source.id)).toBe(5_000_000);
    expect(await balanceOf(product.id, target.id)).toBe(3_000_000);
    const overview = await getInventoryOverview(h.ctx());
    expect(overview.recentMovements.length).toBeGreaterThan(0);
  });

  it("requires a reason for adjustments and restricts them to owners and admins", async () => {
    const warehouse = await newWarehouse("W-ADJ");
    const product = await newProduct("SKU-ADJ-1");
    const adjustment = { productId: product.id, warehouseId: warehouse.id, delta: "2", reason: "Count" };
    await expect(adjustStock(h.ctx(), parsed(stockAdjustmentInputSchema, adjustment))).resolves.toBeUndefined();
    await expect(adjustStock(h.ctx("operator"), parsed(stockAdjustmentInputSchema, adjustment))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(() => parsed(stockAdjustmentInputSchema, { ...adjustment, reason: "" })).toThrow();
  });

  it("rejects fractional quantities for countable units", async () => {
    const warehouse = await newWarehouse("W-FRAC");
    const product = await newProduct("SKU-FRAC-1");
    await expect(
      receiveStock(h.ctx(), parsed(stockMoveInputSchema, { productId: product.id, warehouseId: warehouse.id, quantity: "1.5", reason: "" }))
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("reconciles balances against the movement ledger", async () => {
    const warehouse = await newWarehouse("W-RECON");
    // Fractional quantities are only valid for non-countable units.
    const product = await newProduct("SKU-RECON-1", h.ctx(), { unitOfMeasure: "kg", reorderPoint: "0" });
    await receiveStock(h.ctx(), parsed(stockMoveInputSchema, { productId: product.id, warehouseId: warehouse.id, quantity: "7", reason: "" }));
    await issueStock(h.ctx(), parsed(stockMoveInputSchema, { productId: product.id, warehouseId: warehouse.id, quantity: "2", reason: "Use" }));
    await adjustStock(h.ctx(), parsed(stockAdjustmentInputSchema, { productId: product.id, warehouseId: warehouse.id, delta: "-1.5", reason: "Breakage" }));

    const [ledger] = await h.db
      .collection<StockMovementDoc>(COLLECTIONS.inventoryStockMovements)
      .aggregate<{ total: number }>([
        {
          $match: {
            productId: ObjectId.createFromHexString(product.id),
            warehouseId: ObjectId.createFromHexString(warehouse.id),
          },
        },
        { $group: { _id: null, total: { $sum: "$deltaMicro" } } },
      ])
      .toArray();
    expect(ledger.total).toBe(await balanceOf(product.id, warehouse.id));
    expect(await balanceOf(product.id, warehouse.id)).toBe(3_500_000);
  });
});
