import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { createHarness, parsed, type TestHarness } from "../helpers/workspace";
import { productInputSchema, productWithOpeningStockSchema, warehouseInputSchema } from "@/features/inventory/schemas/inventory.schema";
import { supplierInputSchema, purchaseOrderInputSchema } from "@/features/purchasing/schemas/purchasing.schema";
import { bomInputSchema, workOrderInputSchema } from "@/features/manufacturing/schemas/manufacturing.schema";
import { COLLECTIONS, type ProductDoc, type StockMovementDoc } from "@/server/db/documents";
import { createProduct, createWarehouse, updateWarehouse } from "@/server/inventory/catalog.service";
import { getOnHandMicro } from "@/server/inventory/stock-ledger";
import {
  createProductWithOpeningStock,
  getInventorySetupData,
  getProductStockContext,
  recordOpeningStockBatch,
} from "@/server/inventory/onboarding.service";
import { getAttentionItems } from "@/server/operations/attention.service";
import { createSupplier } from "@/server/purchasing/supplier.service";
import { approvePurchaseOrder, createPurchaseOrder } from "@/server/purchasing/purchase-order.service";
import { createReceipt, postReceipt } from "@/server/purchasing/receipt.service";
import { activateBom, createBomDraft } from "@/server/manufacturing/bom.service";
import { createWorkOrder, previewMaterialAvailability } from "@/server/manufacturing/work-order.service";
import { buildShortagePurchaseHref, parseShortageLines } from "@/features/purchasing/shortage-link";
import { receiveStock } from "@/server/inventory/stock.service";
import type { WorkspaceContext } from "@/server/tenancy/workspace";

let h: TestHarness;
const oid = (hex: string) => ObjectId.createFromHexString(hex);

/** A company that has never been used by another test in this file. */
const brandNewCompany = (): WorkspaceContext => ({ ...h.ctx(), companyId: new ObjectId(), userId: new ObjectId() });

beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.cleanup();
});

function productInput(sku: string, overrides: Record<string, unknown> = {}) {
  return parsed(productWithOpeningStockSchema, {
    sku, name: `Product ${sku}`, description: "", categoryId: "", unitOfMeasure: "unit",
    isStorable: true, isActive: true, cost: "2.000", salePrice: "0.000", reorderPoint: "0",
    openingWarehouseId: "", openingQuantity: "0",
    ...overrides,
  });
}

async function newWarehouse(ctx: WorkspaceContext, code: string) {
  return createWarehouse(ctx, parsed(warehouseInputSchema, { name: `Warehouse ${code}`, code, address: "", isActive: true }));
}

const productCount = (ctx: WorkspaceContext) =>
  h.db.collection<ProductDoc>(COLLECTIONS.inventoryProducts).countDocuments({ companyId: ctx.companyId });

describe("creating a product with opening stock", () => {
  it("posts the opening quantity through the stock ledger, as an auditable receipt", async () => {
    const warehouse = await newWarehouse(h.ctx(), "OPEN1");
    const result = await createProductWithOpeningStock(h.ctx(), productInput("OPEN-A", { openingWarehouseId: warehouse.id, openingQuantity: "12" }));

    expect(result.openingStock).toEqual({ status: "posted" });
    const onHand = await getOnHandMicro(h.db, { companyId: h.ctx().companyId }, oid(result.product.id), oid(warehouse.id));
    expect(onHand).toBe(12_000_000);

    const movements = await h.db
      .collection<StockMovementDoc>(COLLECTIONS.inventoryStockMovements)
      .find({ companyId: h.ctx().companyId, productId: oid(result.product.id) })
      .toArray();
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ movementType: "receipt", deltaMicro: 12_000_000, reason: "Opening stock" });
  });

  it("creates a product without any stock movement when no quantity is given", async () => {
    const result = await createProductWithOpeningStock(h.ctx(), productInput("OPEN-NONE"));
    expect(result.openingStock).toEqual({ status: "none" });
    const movements = await h.db.collection(COLLECTIONS.inventoryStockMovements).countDocuments({ productId: oid(result.product.id) });
    expect(movements).toBe(0);
  });

  it("creates nothing when the warehouse belongs to another company", async () => {
    const foreign = await newWarehouse(h.otherTenant(), "FOREIGN1");
    const before = await productCount(h.ctx());
    await expect(
      createProductWithOpeningStock(h.ctx(), productInput("OPEN-X", { openingWarehouseId: foreign.id, openingQuantity: "5" }))
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await productCount(h.ctx())).toBe(before);
  });

  it("creates nothing when the warehouse is archived", async () => {
    const warehouse = await newWarehouse(h.ctx(), "OLDWH");
    await updateWarehouse(h.ctx(), warehouse.id, parsed(warehouseInputSchema, { name: warehouse.name, code: "OLDWH", address: "", isActive: false }));
    const before = await productCount(h.ctx());
    await expect(
      createProductWithOpeningStock(h.ctx(), productInput("OPEN-ARCH", { openingWarehouseId: warehouse.id, openingQuantity: "5" }))
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await productCount(h.ctx())).toBe(before);
  });

  it("refuses a role that cannot move stock before writing anything", async () => {
    const warehouse = await newWarehouse(h.ctx(), "VIEW1");
    const before = await productCount(h.ctx());
    await expect(
      createProductWithOpeningStock(h.ctx("viewer"), productInput("OPEN-V", { openingWarehouseId: warehouse.id, openingQuantity: "5" }))
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await productCount(h.ctx())).toBe(before);
  });

  it("keeps the product but reports plainly when the stock could not be posted", async () => {
    const warehouse = await newWarehouse(h.ctx(), "FAIL1");
    // A fractional count for a countable unit passes the pre-checks (the form schema guards it) but is refused by the ledger.
    const input = { ...productInput("OPEN-FRAC"), openingWarehouseId: warehouse.id, openingQuantity: "2.5" };
    const result = await createProductWithOpeningStock(h.ctx(), input);
    expect(result.product.sku).toBe("OPEN-FRAC");
    expect(result.openingStock.status).toBe("failed");
    expect(await getOnHandMicro(h.db, { companyId: h.ctx().companyId }, oid(result.product.id), oid(warehouse.id))).toBe(0);
  });

  it("reports a duplicate SKU without posting stock", async () => {
    const warehouse = await newWarehouse(h.ctx(), "DUP1");
    await createProductWithOpeningStock(h.ctx(), productInput("OPEN-DUP"));
    await expect(
      createProductWithOpeningStock(h.ctx(), productInput("OPEN-DUP", { openingWarehouseId: warehouse.id, openingQuantity: "3" }))
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const moved = await h.db.collection(COLLECTIONS.inventoryStockMovements).countDocuments({ warehouseId: oid(warehouse.id) });
    expect(moved).toBe(0);
  });
});

describe("opening stock for existing products", () => {
  it("records each product independently so one bad entry never blocks the rest", async () => {
    const warehouse = await newWarehouse(h.ctx(), "BATCH1");
    const good = await createProduct(h.ctx(), parsed(productInputSchema, { sku: "BATCH-GOOD", name: "Good", description: "", categoryId: "", unitOfMeasure: "unit", isStorable: true, isActive: true, cost: "1.000", salePrice: "0.000", reorderPoint: "0" }));
    const kg = await createProduct(h.ctx(), parsed(productInputSchema, { sku: "BATCH-KG", name: "Kg", description: "", categoryId: "", unitOfMeasure: "kg", isStorable: true, isActive: true, cost: "1.000", salePrice: "0.000", reorderPoint: "0" }));
    const foreign = await createProduct(h.otherTenant(), parsed(productInputSchema, { sku: "BATCH-FOREIGN", name: "Foreign", description: "", categoryId: "", unitOfMeasure: "unit", isStorable: true, isActive: true, cost: "1.000", salePrice: "0.000", reorderPoint: "0" }));

    const result = await recordOpeningStockBatch(h.ctx(), {
      warehouseId: warehouse.id,
      entries: [
        { productId: good.id, quantity: "4" },
        { productId: good.id.replace(/./, (c) => (c === "a" ? "b" : "a")), quantity: "1" }, // unknown id
        { productId: foreign.id, quantity: "9" }, // another company's product
        { productId: kg.id, quantity: "2.5" },
      ],
    });

    expect(result.posted.map((p) => p.productId).sort()).toEqual([good.id, kg.id].sort());
    expect(result.failed).toHaveLength(2);
    const scope = { companyId: h.ctx().companyId };
    expect(await getOnHandMicro(h.db, scope, oid(good.id), oid(warehouse.id))).toBe(4_000_000);
    expect(await getOnHandMicro(h.db, scope, oid(kg.id), oid(warehouse.id))).toBe(2_500_000);
    // The foreign product received nothing, in either company.
    expect(await h.db.collection(COLLECTIONS.inventoryStockMovements).countDocuments({ productId: oid(foreign.id) })).toBe(0);
  });

  it("refuses the whole batch for a role that cannot move stock", async () => {
    const warehouse = await newWarehouse(h.ctx(), "BATCH2");
    await expect(
      recordOpeningStockBatch(h.ctx("viewer"), { warehouseId: warehouse.id, entries: [{ productId: new ObjectId().toHexString(), quantity: "1" }] })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("guided setup state", () => {
  it("starts empty for a new company and advances as real records appear", async () => {
    const fresh = brandNewCompany();
    const empty = await getInventorySetupData(fresh);
    expect(empty.progress.nextStepId).toBe("warehouse");
    expect(empty.progress.isUsable).toBe(false);

    const warehouse = await newWarehouse(fresh, "SETUP1");
    const afterWarehouse = await getInventorySetupData(fresh);
    expect(afterWarehouse.progress.steps.find((s) => s.id === "warehouse")?.status).toBe("done");

    const created = await createProductWithOpeningStock(fresh, productInput("SETUP-P", { openingWarehouseId: warehouse.id, openingQuantity: "3" }));
    const afterProduct = await getInventorySetupData(fresh);
    expect(afterProduct.progress.isUsable).toBe(true);
    expect(afterProduct.counts).toMatchObject({ warehouses: 1, products: 1, storableProducts: 1, productsWithStock: 1 });
    expect(afterProduct.products.find((p) => p.id === created.product.id)?.needsOpeningStock).toBe(false);
  });

  it("flags stored products without a quantity so they can be counted", async () => {
    const ctx = brandNewCompany();
    await createProductWithOpeningStock(ctx, productInput("SETUP-NOSTOCK"));
    const data = await getInventorySetupData(ctx);
    expect(data.products.find((p) => p.sku === "SETUP-NOSTOCK")?.needsOpeningStock).toBe(true);
  });

  it("never mixes in another company's records", async () => {
    const primary = await getInventorySetupData(h.ctx());
    const other = await getInventorySetupData(h.otherTenant());
    const ids = new Set(primary.products.map((p) => p.id));
    expect(other.products.some((p) => ids.has(p.id))).toBe(false);
    expect(other.warehouses.every((w) => !primary.warehouses.some((x) => x.id === w.id))).toBe(true);
  });
});

describe("purchasing hand-off and receiving", () => {
  it("shows what is already on order next to the stock level", async () => {
    const ctx = h.ctx();
    const warehouse = await newWarehouse(ctx, "PO1");
    const supplier = await createSupplier(ctx, parsed(supplierInputSchema, { name: "Ctx Supplier", email: "", phone: "", taxIdentifier: "", address: "", isActive: true }));
    const item = await createProductWithOpeningStock(ctx, productInput("PO-CTX", { openingWarehouseId: warehouse.id, openingQuantity: "4", reorderPoint: "20" }));
    const order = await createPurchaseOrder(ctx, parsed(purchaseOrderInputSchema, {
      supplierId: supplier.id, expectedDate: "", notes: "",
      lines: [{ productId: item.product.id, quantity: "50", unitCost: "2.000", taxRate: "0" }],
    }));
    // A draft is not "on order" yet.
    expect((await getProductStockContext(ctx, [item.product.id]))[0]).toMatchObject({ onHand: "4", reorderPoint: "20", onOrder: "0" });

    await approvePurchaseOrder(ctx, order.id, order.version);
    expect((await getProductStockContext(ctx, [item.product.id]))[0]?.onOrder).toBe("50");

    // Receiving through the real receipt flow updates stock and reduces what is on order.
    const detail = await createReceipt(ctx, {
      purchaseOrderId: order.id,
      warehouseId: warehouse.id,
      lines: [{ purchaseOrderLineId: (await h.db.collection(COLLECTIONS.purchaseOrders).findOne({ _id: oid(order.id) }))!.lines[0]._id.toHexString(), quantity: "30" }],
    });
    await postReceipt(ctx, detail.id);
    const after = (await getProductStockContext(ctx, [item.product.id]))[0];
    expect(after).toMatchObject({ onHand: "34", onOrder: "20" });
  });

  it("does not reveal another company's stock context", async () => {
    const foreign = await createProductWithOpeningStock(h.otherTenant(), productInput("CTX-FOREIGN"));
    expect(await getProductStockContext(h.ctx(), [foreign.product.id])).toEqual([]);
  });
});

describe("manufacturing material check", () => {
  async function setupBom(ctx: WorkspaceContext, tag: string) {
    const warehouse = await newWarehouse(ctx, `MFG${tag}`);
    const finished = await createProductWithOpeningStock(ctx, productInput(`FIN-${tag}`));
    const plenty = await createProductWithOpeningStock(ctx, productInput(`PLENTY-${tag}`, { openingWarehouseId: warehouse.id, openingQuantity: "100" }));
    const scarce = await createProductWithOpeningStock(ctx, productInput(`SCARCE-${tag}`, { openingWarehouseId: warehouse.id, openingQuantity: "3" }));
    const draft = await createBomDraft(ctx, parsed(bomInputSchema, {
      finishedProductId: finished.product.id, notes: "",
      components: [{ productId: plenty.product.id, quantityPerUnit: "2" }, { productId: scarce.product.id, quantityPerUnit: "1" }],
    }));
    await activateBom(ctx, draft.id, draft.version);
    return { warehouse, bom: draft, plenty: plenty.product, scarce: scarce.product };
  }

  it("lists each material's need, stock and shortfall without writing anything", async () => {
    const { warehouse, bom, scarce, plenty } = await setupBom(h.ctx(), "A");
    const before = await h.db.collection(COLLECTIONS.inventoryStockMovements).countDocuments({});
    const preview = await previewMaterialAvailability(h.ctx(), { bomId: bom.id, warehouseId: warehouse.id, quantity: "10" });

    expect(preview.shortCount).toBe(1);
    const short = preview.materials.find((m) => m.productId === scarce.id)!;
    expect(short).toMatchObject({ planned: "10.000", onHand: "3.000", shortfall: "7.000", shortfallExact: "7", sufficient: false });
    expect(preview.materials.find((m) => m.productId === plenty.id)).toMatchObject({ sufficient: true, shortfallExact: "0" });
    expect(await h.db.collection(COLLECTIONS.inventoryStockMovements).countDocuments({})).toBe(before);
  });

  it("agrees with the work order created afterwards, and the shortage link carries the exact quantity", async () => {
    const { warehouse, bom, scarce } = await setupBom(h.ctx(), "B");
    const preview = await previewMaterialAvailability(h.ctx(), { bomId: bom.id, warehouseId: warehouse.id, quantity: "5" });
    const order = await createWorkOrder(h.ctx(), parsed(workOrderInputSchema, { bomId: bom.id, warehouseId: warehouse.id, quantity: "5", plannedStart: "" }));
    const material = order.materials.find((m) => m.productId === scarce.id)!;
    expect(material.shortfallExact).toBe(preview.materials.find((m) => m.productId === scarce.id)!.shortfallExact);
    expect(material.sufficient).toBe(false);

    const href = buildShortagePurchaseHref([{ productId: scarce.id, quantity: material.shortfallExact }], { workOrderId: order.id });
    const lines = parseShortageLines(new URL(href, "http://x").searchParams.get("lines") ?? undefined);
    expect(lines).toEqual([{ productId: scarce.id, quantity: "2" }]);
  });

  it("refuses another company's BOM or warehouse", async () => {
    const foreign = await setupBom(h.otherTenant(), "C");
    await expect(
      previewMaterialAvailability(h.ctx(), { bomId: foreign.bom.id, warehouseId: foreign.warehouse.id, quantity: "1" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("requires manufacturing and inventory read access", async () => {
    const { warehouse, bom } = await setupBom(h.ctx(), "D");
    const noAccess: WorkspaceContext = { ...h.ctx("viewer"), permissions: new Set() };
    await expect(previewMaterialAvailability(noAccess, { bomId: bom.id, warehouseId: warehouse.id, quantity: "1" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("what needs attention", () => {
  it("names the real problems, links to their fix, and stays inside the company", async () => {
    const ctx = brandNewCompany();
    const warehouse = await newWarehouse(ctx, "ATT1");
    // Out of stock but wanted: below its reorder point.
    const low = await createProductWithOpeningStock(ctx, productInput("ATT-LOW", { reorderPoint: "10" }));
    // A work order waiting for a material.
    const finished = await createProductWithOpeningStock(ctx, productInput("ATT-FIN"));
    const draft = await createBomDraft(ctx, parsed(bomInputSchema, {
      finishedProductId: finished.product.id, notes: "", components: [{ productId: low.product.id, quantityPerUnit: "1" }],
    }));
    await activateBom(ctx, draft.id, draft.version);
    const wo = await createWorkOrder(ctx, parsed(workOrderInputSchema, { bomId: draft.id, warehouseId: warehouse.id, quantity: "5", plannedStart: "" }));
    // A purchase order past its date.
    const supplier = await createSupplier(ctx, parsed(supplierInputSchema, { name: "Late Co", email: "", phone: "", taxIdentifier: "", address: "", isActive: true }));
    const po = await createPurchaseOrder(ctx, parsed(purchaseOrderInputSchema, {
      supplierId: supplier.id, expectedDate: "2020-01-01", notes: "",
      lines: [{ productId: low.product.id, quantity: "20", unitCost: "1.000", taxRate: "0" }],
    }));
    await approvePurchaseOrder(ctx, po.id, po.version);

    const items = await getAttentionItems(ctx);
    const ids = items.map((i) => i.id);
    expect(ids).toContain(`wo-${wo.id}`);
    expect(ids).toContain("po-overdue");
    // The 20 on order cover the reorder gap (0 + 20 > 10), so the product is not reported as a problem.
    expect(ids).toContain("replenish-covered");
    expect(ids).not.toContain("replenish");

    const blocked = items.find((i) => i.id === `wo-${wo.id}`)!;
    expect(blocked.severity).toBe("warning");
    expect(blocked.href).toContain("/purchasing/orders/new?lines=");
    expect(parseShortageLines(new URL(blocked.href, "http://x").searchParams.get("lines") ?? undefined)).toEqual([{ productId: low.product.id, quantity: "5" }]);
    // Critical or blocked work comes before informational items.
    const severities = items.map((i) => i.severity);
    expect(severities).toEqual([...severities].sort((a, b) => ["critical", "warning", "info"].indexOf(a) - ["critical", "warning", "info"].indexOf(b)));

    // The other company sees none of it.
    const mine = (await getAttentionItems(h.ctx())).map((i) => i.id);
    expect(mine).not.toContain(`wo-${wo.id}`);
    expect(mine).not.toContain("po-overdue");
  });

  it("reports an uncovered shortage as needing replenishment, and a viewer cannot be sent to order", async () => {
    const ctx = h.ctx();
    await createProductWithOpeningStock(ctx, productInput("ATT-UNCOVERED", { reorderPoint: "50" }));
    const owner = (await getAttentionItems(ctx)).find((i) => i.id === "replenish");
    expect(owner).toMatchObject({ href: "/purchasing/replenishment", severity: "critical" });
    const viewer = (await getAttentionItems(h.ctx("viewer"))).find((i) => i.id === "replenish");
    expect(viewer?.href).toBe("/inventory/stock");
  });

  it("only includes modules the caller may read", async () => {
    const inventoryOnly: WorkspaceContext = {
      ...h.ctx("viewer"),
      permissions: new Set(["inventory.read"]),
    } as WorkspaceContext;
    const items = await getAttentionItems(inventoryOnly);
    expect(items.every((i) => i.module === "inventory")).toBe(true);
  });

  it("is empty for a caller with no read access at all", async () => {
    const none: WorkspaceContext = { ...h.ctx("viewer"), permissions: new Set() };
    expect(await getAttentionItems(none)).toEqual([]);
  });
});

describe("existing stock rules still hold under the new flows", () => {
  it("never lets opening stock create a negative or fractional-countable balance", async () => {
    const warehouse = await newWarehouse(h.ctx(), "RULE1");
    const item = await createProductWithOpeningStock(h.ctx(), productInput("RULE-ITEM", { openingWarehouseId: warehouse.id, openingQuantity: "2" }));
    await expect(receiveStock(h.ctx(), { productId: item.product.id, warehouseId: warehouse.id, quantity: "0.5", reason: "" })).rejects.toBeTruthy();
    expect(await getOnHandMicro(h.db, { companyId: h.ctx().companyId }, oid(item.product.id), oid(warehouse.id))).toBe(2_000_000);
  });
});
