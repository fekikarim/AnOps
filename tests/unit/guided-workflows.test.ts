import { describe, expect, it } from "vitest";
import { buildSetupProgress, isSetupStepId, type SetupCounts } from "@/features/inventory/setup-progress";
import { buildShortagePurchaseHref, parseShortageLines } from "@/features/purchasing/shortage-link";
import { rankAttention, type AttentionItem } from "@/features/inventory/attention";
import { suggestSku, suggestWarehouseCode } from "@/features/inventory/suggestions";
import { openingStockBatchSchema, productWithOpeningStockSchema } from "@/features/inventory/schemas/inventory.schema";

const EMPTY: SetupCounts = { warehouses: 0, categories: 0, products: 0, storableProducts: 0, productsWithStock: 0, suppliers: 0 };
const ID_A = "a".repeat(24);
const ID_B = "b".repeat(24);

describe("guided inventory setup progress", () => {
  it("starts at the warehouse step with nothing usable", () => {
    const progress = buildSetupProgress(EMPTY);
    expect(progress.nextStepId).toBe("warehouse");
    expect(progress.isUsable).toBe(false);
    expect(progress.isComplete).toBe(false);
    expect(progress.percent).toBe(0);
    expect(progress.steps.map((s) => s.id)).toEqual(["warehouse", "categories", "products", "stock", "suppliers", "review"]);
  });

  it("blocks opening stock until a warehouse and a product exist, and says which comes first", () => {
    const noWarehouse = buildSetupProgress({ ...EMPTY, products: 2, storableProducts: 2 });
    expect(noWarehouse.steps.find((s) => s.id === "stock")).toMatchObject({ status: "blocked", blockedBy: "warehouse" });
    const noProducts = buildSetupProgress({ ...EMPTY, warehouses: 1 });
    expect(noProducts.steps.find((s) => s.id === "stock")).toMatchObject({ status: "blocked", blockedBy: "products" });
  });

  it("is usable once a warehouse and a product exist, even though optional steps remain", () => {
    const progress = buildSetupProgress({ ...EMPTY, warehouses: 1, products: 1, storableProducts: 1 });
    expect(progress.isUsable).toBe(true);
    expect(progress.isComplete).toBe(false);
    // The next suggested step is the first one still to do, which is optional here.
    expect(progress.nextStepId).toBe("categories");
  });

  it("does not ask for opening stock when no product holds stock", () => {
    const progress = buildSetupProgress({ ...EMPTY, warehouses: 1, products: 1, storableProducts: 0 });
    expect(progress.steps.find((s) => s.id === "stock")?.status).toBe("done");
  });

  it("completes only when every step is done and then points at the review", () => {
    const progress = buildSetupProgress({ warehouses: 1, categories: 2, products: 3, storableProducts: 3, productsWithStock: 2, suppliers: 1 });
    expect(progress.isComplete).toBe(true);
    expect(progress.percent).toBe(100);
    expect(progress.nextStepId).toBe("review");
    expect(progress.steps.find((s) => s.id === "review")?.status).toBe("done");
  });

  it("only accepts known step ids from the address bar", () => {
    expect(isSetupStepId("stock")).toBe(true);
    expect(isSetupStepId("../admin")).toBe(false);
    expect(isSetupStepId(undefined)).toBe(false);
  });
});

describe("shortage hand-off to purchasing", () => {
  it("round-trips product ids and quantities", () => {
    const href = buildShortagePurchaseHref([{ productId: ID_A, quantity: "12.5" }, { productId: ID_B, quantity: "3" }], { workOrderId: ID_A });
    const query = new URL(href, "http://x").searchParams;
    expect(href.startsWith("/purchasing/orders/new?")).toBe(true);
    expect(parseShortageLines(query.get("lines") ?? undefined)).toEqual([
      { productId: ID_A, quantity: "12.5" },
      { productId: ID_B, quantity: "3" },
    ]);
    expect(query.get("workOrder")).toBe(ID_A);
  });

  it("drops malformed, zero, negative and duplicate entries instead of trusting them", () => {
    const raw = [`${ID_A}:5`, `${ID_A}:9`, "nothex:5", `${ID_B}:0`, `${ID_B}:-2`, `${ID_B}:1e3`, ":4", `${ID_B}`].join(",");
    expect(parseShortageLines(raw)).toEqual([{ productId: ID_A, quantity: "5" }]);
    expect(parseShortageLines(undefined)).toEqual([]);
    expect(parseShortageLines([`${ID_A}:1`, `${ID_B}:1`])).toEqual([{ productId: ID_A, quantity: "1" }]);
  });

  it("caps the number of prefilled lines", () => {
    const many = Array.from({ length: 80 }, (_, i) => `${i.toString(16).padStart(24, "0")}:1`).join(",");
    expect(parseShortageLines(many)).toHaveLength(50);
  });

  it("builds a plain link when nothing is short", () => {
    expect(buildShortagePurchaseHref([])).toBe("/purchasing/orders/new");
  });
});

describe("attention ranking", () => {
  const item = (id: string, severity: AttentionItem["severity"], module: AttentionItem["module"]): AttentionItem => ({
    id, severity, module, title: id, detail: "", actionLabel: "Go", href: "/x",
  });

  it("puts blocked work first, then orders by module, keeping insertion order within a tie", () => {
    const ranked = rankAttention([
      item("po-info", "info", "purchasing"),
      item("wo-2", "warning", "manufacturing"),
      item("inv-crit", "critical", "inventory"),
      item("wo-1", "warning", "manufacturing"),
      item("po-warn", "warning", "purchasing"),
    ]);
    expect(ranked.map((i) => i.id)).toEqual(["inv-crit", "po-warn", "wo-2", "wo-1", "po-info"]);
  });
});

describe("smart defaults", () => {
  it("suggests a readable warehouse code that satisfies the schema", () => {
    expect(suggestWarehouseCode("Main Store")).toBe("MS");
    expect(suggestWarehouseCode("Central")).toBe("CENTRA");
    expect(suggestWarehouseCode("A")).toBe("A1");
    expect(suggestWarehouseCode("   ")).toBe("");
    expect(suggestWarehouseCode("Entrepôt Sfax")).toMatch(/^[A-Z0-9-]{2,12}$/);
  });

  it("suggests a SKU from the product name", () => {
    expect(suggestSku("Steel sheet 2 mm")).toBe("STEEL-SHEET-2-MM");
    expect(suggestSku("!!!")).toBe("");
  });
});

describe("opening stock input rules", () => {
  const base = {
    sku: "WID-1", name: "Widget", description: "", categoryId: "", unitOfMeasure: "unit",
    isStorable: true, isActive: true, cost: "2.000", salePrice: "0.000", reorderPoint: "0",
    openingWarehouseId: "", openingQuantity: "0",
  };

  it("accepts a product with no opening stock and no warehouse", () => {
    expect(productWithOpeningStockSchema.safeParse(base).success).toBe(true);
  });

  it("requires a warehouse when a quantity is given", () => {
    const result = productWithOpeningStockSchema.safeParse({ ...base, openingQuantity: "5" });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.path[0] === "openingWarehouseId")).toBe(true);
  });

  it("refuses opening stock on a product that is not stored", () => {
    const result = productWithOpeningStockSchema.safeParse({ ...base, isStorable: false, openingWarehouseId: ID_A, openingQuantity: "5" });
    expect(result.success).toBe(false);
  });

  it("refuses a fractional quantity for a countable unit but allows it for a measured one", () => {
    expect(productWithOpeningStockSchema.safeParse({ ...base, openingWarehouseId: ID_A, openingQuantity: "2.5" }).success).toBe(false);
    expect(productWithOpeningStockSchema.safeParse({ ...base, unitOfMeasure: "kg", openingWarehouseId: ID_A, openingQuantity: "2.5" }).success).toBe(true);
  });

  it("rejects unknown fields so a form cannot smuggle extra data", () => {
    expect(productWithOpeningStockSchema.safeParse({ ...base, companyId: ID_A }).success).toBe(false);
  });

  it("validates the batch: at least one entry, no duplicates, positive quantities", () => {
    expect(openingStockBatchSchema.safeParse({ warehouseId: ID_A, entries: [] }).success).toBe(false);
    expect(openingStockBatchSchema.safeParse({ warehouseId: ID_A, entries: [{ productId: ID_B, quantity: "0" }] }).success).toBe(false);
    expect(
      openingStockBatchSchema.safeParse({ warehouseId: ID_A, entries: [{ productId: ID_B, quantity: "1" }, { productId: ID_B, quantity: "2" }] }).success
    ).toBe(false);
    expect(openingStockBatchSchema.safeParse({ warehouseId: ID_A, entries: [{ productId: ID_B, quantity: "4" }] }).success).toBe(true);
  });
});
