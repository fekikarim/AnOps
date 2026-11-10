import { describe, expect, it } from "vitest";
import { productInputSchema, stockMoveInputSchema, warehouseInputSchema, stockAdjustmentInputSchema } from "@/features/inventory/schemas/inventory.schema";
import { purchaseOrderInputSchema } from "@/features/purchasing/schemas/purchasing.schema";
import { bomInputSchema } from "@/features/manufacturing/schemas/manufacturing.schema";

const OID_A = "64b000000000000000000001";
const OID_B = "64b000000000000000000002";

const validProduct = {
  sku: "bolt-m8",
  name: "M8 bolt",
  description: "",
  categoryId: "",
  unitOfMeasure: "unit",
  isStorable: true,
  isActive: true,
  cost: "0.250",
  salePrice: "0.500",
  reorderPoint: "10",
};

describe("product schema", () => {
  it("normalizes SKUs and accepts a valid product", () => {
    const parsed = productInputSchema.parse(validProduct);
    expect(parsed.sku).toBe("BOLT-M8");
    expect(parsed.categoryId).toBeNull();
  });

  it("rejects unknown fields such as a client-supplied stock balance", () => {
    expect(() => productInputSchema.parse({ ...validProduct, stockOnHand: "999" })).toThrow();
    expect(() => productInputSchema.parse({ ...validProduct, companyId: OID_A })).toThrow();
  });

  it("requires whole-number reorder points for countable units", () => {
    expect(() => productInputSchema.parse({ ...validProduct, reorderPoint: "2.5" })).toThrow(/whole-number/);
    expect(() => productInputSchema.parse({ ...validProduct, unitOfMeasure: "kg", reorderPoint: "2.5" })).not.toThrow();
  });

  it("rejects invalid SKUs and monetary values", () => {
    expect(() => productInputSchema.parse({ ...validProduct, sku: "bad sku" })).toThrow();
    expect(() => productInputSchema.parse({ ...validProduct, cost: "-1" })).toThrow();
    expect(() => productInputSchema.parse({ ...validProduct, cost: "1.2345" })).toThrow();
  });
});

describe("stock schemas", () => {
  it("requires a positive quantity for moves and a reason for adjustments", () => {
    expect(() => stockMoveInputSchema.parse({ productId: OID_A, warehouseId: OID_B, quantity: "0" })).toThrow();
    expect(() => stockAdjustmentInputSchema.parse({ productId: OID_A, warehouseId: OID_B, delta: "2", reason: "" })).toThrow();
    expect(() => stockAdjustmentInputSchema.parse({ productId: OID_A, warehouseId: OID_B, delta: "-2", reason: "Count" })).not.toThrow();
  });

  it("rejects malformed identifiers", () => {
    expect(() => stockMoveInputSchema.parse({ productId: "not-an-id", warehouseId: OID_B, quantity: "1" })).toThrow();
    expect(() => warehouseInputSchema.parse({ name: "Main", code: "x", address: "", isActive: true })).toThrow();
  });
});

describe("purchase order schema", () => {
  it("rejects duplicate products and prices sent as numbers", () => {
    const line = { productId: OID_A, quantity: "2", unitCost: "1.000", taxRate: "19" };
    expect(() => purchaseOrderInputSchema.parse({ supplierId: OID_B, expectedDate: "", notes: "", lines: [line, line] })).toThrow(/only once/);
    expect(() => purchaseOrderInputSchema.parse({ supplierId: OID_B, expectedDate: "", notes: "", lines: [{ ...line, unitCost: 1 }] })).toThrow();
  });
});

describe("bom schema", () => {
  it("rejects a product used as its own component and duplicate components", () => {
    expect(() =>
      bomInputSchema.parse({ finishedProductId: OID_A, notes: "", components: [{ productId: OID_A, quantityPerUnit: "1" }] })
    ).toThrow(/itself/);
    const component = { productId: OID_B, quantityPerUnit: "1" };
    expect(() =>
      bomInputSchema.parse({ finishedProductId: OID_A, notes: "", components: [component, component] })
    ).toThrow(/only once/);
  });
});
