import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { createHarness, parsed, type TestHarness } from "../helpers/workspace";
import { productInputSchema, stockMoveInputSchema, warehouseInputSchema } from "@/features/inventory/schemas/inventory.schema";
import { createProduct, createWarehouse } from "@/server/inventory/catalog.service";
import { receiveStock } from "@/server/inventory/stock.service";
import { getOnHandMicro } from "@/server/inventory/stock-ledger";
import { activateBom, createBomDraft, updateBomDraft } from "@/server/manufacturing/bom.service";
import { cancelWorkOrder, completeWorkOrder, createWorkOrder, getWorkOrder, startWorkOrder } from "@/server/manufacturing/work-order.service";
import { bomInputSchema, workOrderInputSchema } from "@/features/manufacturing/schemas/manufacturing.schema";
import { COLLECTIONS, type StockMovementDoc } from "@/server/db/documents";
import type { BomDetailDto } from "@/features/manufacturing/types";

let h: TestHarness;
let finishedId: string;
let componentKgId: string;
let componentPcsId: string;
let warehouseId: string;

beforeAll(async () => {
  h = await createHarness();
  const make = (sku: string, unit: string) =>
    createProduct(
      h.ctx(),
      parsed(productInputSchema, {
        sku, name: `Item ${sku}`, description: "", categoryId: "", unitOfMeasure: unit,
        isStorable: true, isActive: true, cost: "1.000", salePrice: "0.000", reorderPoint: "0",
      })
    );
  finishedId = (await make("FIN-CHAIR", "unit")).id;
  componentKgId = (await make("MAT-WOOD", "kg")).id;
  componentPcsId = (await make("MAT-SCREW", "unit")).id;
  warehouseId = (await createWarehouse(h.ctx(), parsed(warehouseInputSchema, { name: "Assembly", code: "ASM", address: "", isActive: true }))).id;
});

afterAll(async () => {
  await h.cleanup();
});

const scope = () => ({ companyId: h.ctx().companyId });
const oid = (hex: string) => ObjectId.createFromHexString(hex);

async function onHand(productId: string): Promise<number> {
  return getOnHandMicro(h.db, scope(), oid(productId), oid(warehouseId));
}

async function activeBom(
  components: { productId: string; quantityPerUnit: string }[],
  finished = finishedId
): Promise<BomDetailDto> {
  const draft = await createBomDraft(h.ctx(), parsed(bomInputSchema, { finishedProductId: finished, notes: "", components }));
  await activateBom(h.ctx(), draft.id, draft.version);
  return draft;
}

describe("bills of materials", () => {
  it("rejects a BOM that lists the finished product as its own component", () => {
    expect(() =>
      parsed(bomInputSchema, { finishedProductId: finishedId, notes: "", components: [{ productId: finishedId, quantityPerUnit: "1" }] })
    ).toThrow();
  });

  it("archives the previous active revision when a new one is activated", async () => {
    const first = await activeBom([{ productId: componentPcsId, quantityPerUnit: "1" }], finishedId);
    const second = await activeBom([{ productId: componentPcsId, quantityPerUnit: "2" }], finishedId);
    expect(second.revision).toBeGreaterThan(first.revision);
    const previous = await h.db
      .collection(COLLECTIONS.manufacturingBoms)
      .findOne({ _id: oid(first.id) });
    expect(previous?.status).toBe("archived");
  });

  it("forbids editing an active revision", async () => {
    const bom = await activeBom([{ productId: componentPcsId, quantityPerUnit: "1" }], finishedId);
    await expect(
      updateBomDraft(h.ctx(), bom.id, {
        ...parsed(bomInputSchema, { finishedProductId: finishedId, notes: "", components: [{ productId: componentPcsId, quantityPerUnit: "3" }] }),
        expectedVersion: bom.version,
      })
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });
});

describe("work orders", () => {
  it("plans material requirements from the BOM without consuming stock", async () => {
    const finishedAlt = (
      await createProduct(
        h.ctx(),
        parsed(productInputSchema, {
          sku: "FIN-TABLE", name: "Table", description: "", categoryId: "", unitOfMeasure: "unit",
          isStorable: true, isActive: true, cost: "0.000", salePrice: "0.000", reorderPoint: "0",
        })
      )
    ).id;
    const bom = await activeBom(
      [
        { productId: componentKgId, quantityPerUnit: "0.5" },
        { productId: componentPcsId, quantityPerUnit: "2" },
      ],
      finishedAlt
    );
    await receiveStock(h.ctx(), parsed(stockMoveInputSchema, { productId: componentKgId, warehouseId, quantity: "10", reason: "" }));
    await receiveStock(h.ctx(), parsed(stockMoveInputSchema, { productId: componentPcsId, warehouseId, quantity: "6", reason: "" }));

    const wo = await createWorkOrder(h.ctx(), parsed(workOrderInputSchema, { bomId: bom.id, warehouseId, quantity: "4", plannedStart: "" }));
    expect(wo.status).toBe("draft");
    const wood = wo.materials.find((m) => m.sku === "MAT-WOOD");
    const screw = wo.materials.find((m) => m.sku === "MAT-SCREW");
    expect(wood?.planned).toBe("2.000");
    expect(screw?.planned).toBe("8.000");
    expect(screw?.sufficient).toBe(false);
    expect(screw?.shortfall).toBe("2.000");
    expect(await onHand(componentPcsId)).toBe(6_000_000);
  });

  it("rejects completion with insufficient components and leaves everything unchanged", async () => {
    const bom = await activeBom([{ productId: componentPcsId, quantityPerUnit: "2" }], finishedId);
    const wo = await createWorkOrder(h.ctx(), parsed(workOrderInputSchema, { bomId: bom.id, warehouseId, quantity: "4", plannedStart: "" }));
    const started = await getWorkOrder(h.ctx(), wo.id);
    await startWorkOrder(h.ctx(), wo.id, started.version);

    const before = await onHand(componentPcsId);
    const finishedBefore = await onHand(finishedId);
    const current = await getWorkOrder(h.ctx(), wo.id);
    await expect(completeWorkOrder(h.ctx(), wo.id, current.version)).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });

    expect(await onHand(componentPcsId)).toBe(before);
    expect(await onHand(finishedId)).toBe(finishedBefore);
    expect((await getWorkOrder(h.ctx(), wo.id)).status).toBe("in_progress");
  });

  it("undoes an earlier component issue when a later component is short", async () => {
    const plenty = await createProduct(
      h.ctx(),
      parsed(productInputSchema, {
        sku: "MAT-BOLT", name: "Bolt", description: "", categoryId: "", unitOfMeasure: "unit",
        isStorable: true, isActive: true, cost: "0.100", salePrice: "0.000", reorderPoint: "0",
      })
    );
    const scarce = await createProduct(
      h.ctx(),
      parsed(productInputSchema, {
        sku: "MAT-NUT", name: "Nut", description: "", categoryId: "", unitOfMeasure: "unit",
        isStorable: true, isActive: true, cost: "0.100", salePrice: "0.000", reorderPoint: "0",
      })
    );
    await receiveStock(h.ctx(), parsed(stockMoveInputSchema, { productId: plenty.id, warehouseId, quantity: "20", reason: "" }));
    await receiveStock(h.ctx(), parsed(stockMoveInputSchema, { productId: scarce.id, warehouseId, quantity: "1", reason: "" }));
    const bom = await activeBom(
      [
        { productId: plenty.id, quantityPerUnit: "2" },
        { productId: scarce.id, quantityPerUnit: "2" },
      ],
      finishedId
    );
    const wo = await createWorkOrder(h.ctx(), parsed(workOrderInputSchema, { bomId: bom.id, warehouseId, quantity: "1", plannedStart: "" }));
    const started = await getWorkOrder(h.ctx(), wo.id);
    await startWorkOrder(h.ctx(), wo.id, started.version);

    const boltsBefore = await onHand(plenty.id);
    const movementsBefore = await h.db.collection(COLLECTIONS.inventoryStockMovements).countDocuments({ sourceId: oid(wo.id) });
    const current = await getWorkOrder(h.ctx(), wo.id);
    await expect(completeWorkOrder(h.ctx(), wo.id, current.version)).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });

    expect(await onHand(plenty.id)).toBe(boltsBefore);
    expect(await h.db.collection(COLLECTIONS.inventoryStockMovements).countDocuments({ sourceId: oid(wo.id) })).toBe(movementsBefore);
    expect((await getWorkOrder(h.ctx(), wo.id)).status).toBe("in_progress");
  });

  it("consumes components and records finished goods atomically on completion", async () => {
    const wo = await createWorkOrder(h.ctx(), parsed(workOrderInputSchema, {
      bomId: (await activeBom([{ productId: componentPcsId, quantityPerUnit: "1" }], finishedId)).id,
      warehouseId,
      quantity: "2",
      plannedStart: "",
    }));
    const started = await getWorkOrder(h.ctx(), wo.id);
    await startWorkOrder(h.ctx(), wo.id, started.version);

    await receiveStock(h.ctx(), parsed(stockMoveInputSchema, { productId: componentPcsId, warehouseId, quantity: "10", reason: "" }));
    const screwsBefore = await onHand(componentPcsId);
    const finishedBefore = await onHand(finishedId);

    const current = await getWorkOrder(h.ctx(), wo.id);
    await completeWorkOrder(h.ctx(), wo.id, current.version);

    expect(await onHand(componentPcsId)).toBe(screwsBefore - 2_000_000);
    expect(await onHand(finishedId)).toBe(finishedBefore + 2_000_000);
    const done = await getWorkOrder(h.ctx(), wo.id);
    expect(done.status).toBe("completed");
    expect(done.producedQuantity).toBe("2.000");
    expect(done.materials[0].consumed).toBe("2.000");
  });

  it("prevents duplicate completion when two requests race", async () => {
    const bom = await activeBom([{ productId: componentPcsId, quantityPerUnit: "1" }], finishedId);
    const wo = await createWorkOrder(h.ctx(), parsed(workOrderInputSchema, { bomId: bom.id, warehouseId, quantity: "1", plannedStart: "" }));
    const started = await getWorkOrder(h.ctx(), wo.id);
    await startWorkOrder(h.ctx(), wo.id, started.version);
    await receiveStock(h.ctx(), parsed(stockMoveInputSchema, { productId: componentPcsId, warehouseId, quantity: "5", reason: "" }));

    const screwsBefore = await onHand(componentPcsId);
    const finishedBefore = await onHand(finishedId);
    const version = (await getWorkOrder(h.ctx(), wo.id)).version;
    const results = await Promise.allSettled([completeWorkOrder(h.ctx(), wo.id, version), completeWorkOrder(h.ctx(), wo.id, version)]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await onHand(componentPcsId)).toBe(screwsBefore - 1_000_000);
    expect(await onHand(finishedId)).toBe(finishedBefore + 1_000_000);
  });

  it("does not move stock when a draft is cancelled, and blocks invalid transitions", async () => {
    const bom = await activeBom([{ productId: componentPcsId, quantityPerUnit: "1" }], finishedId);
    const wo = await createWorkOrder(h.ctx(), parsed(workOrderInputSchema, { bomId: bom.id, warehouseId, quantity: "1", plannedStart: "" }));
    const before = await onHand(componentPcsId);
    await cancelWorkOrder(h.ctx(), wo.id, wo.version);
    expect(await onHand(componentPcsId)).toBe(before);
    await expect(startWorkOrder(h.ctx(), wo.id, wo.version + 1)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("keeps an existing work order on its snapshot when the BOM changes", async () => {
    const bom = await activeBom([{ productId: componentPcsId, quantityPerUnit: "2" }], finishedId);
    const wo = await createWorkOrder(h.ctx(), parsed(workOrderInputSchema, { bomId: bom.id, warehouseId, quantity: "3", plannedStart: "" }));
    await activeBom([{ productId: componentPcsId, quantityPerUnit: "9" }], finishedId);
    const reloaded = await getWorkOrder(h.ctx(), wo.id);
    expect(reloaded.materials[0].planned).toBe("6.000");
  });

  it("refuses execution by read-only members and by other tenants", async () => {
    const bom = await activeBom([{ productId: componentPcsId, quantityPerUnit: "1" }], finishedId);
    const wo = await createWorkOrder(h.ctx(), parsed(workOrderInputSchema, { bomId: bom.id, warehouseId, quantity: "1", plannedStart: "" }));
    await expect(startWorkOrder(h.ctx("viewer"), wo.id, wo.version)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getWorkOrder(h.otherTenant(), wo.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("writes production movements with traceable source references", async () => {
    const ledger = await h.db
      .collection<StockMovementDoc>(COLLECTIONS.inventoryStockMovements)
      .find({ movementType: { $in: ["production_consume", "production_output"] } })
      .toArray();
    expect(ledger.length).toBeGreaterThan(0);
    for (const movement of ledger) {
      expect(movement.sourceType).toBe("work_order");
      expect(movement.sourceId).not.toBeNull();
    }
  });

  it("updates a draft BOM with the expected version", async () => {
    const draft = await createBomDraft(h.ctx(), parsed(bomInputSchema, { finishedProductId: finishedId, notes: "", components: [{ productId: componentPcsId, quantityPerUnit: "1" }] }));
    const updated = await updateBomDraft(h.ctx(), draft.id, {
      ...parsed(bomInputSchema, { finishedProductId: finishedId, notes: "v2", components: [{ productId: componentPcsId, quantityPerUnit: "4" }] }),
      expectedVersion: draft.version,
    });
    expect(updated.components[0].quantityPerUnit).toBe("4");
    await expect(
      updateBomDraft(h.ctx(), draft.id, {
        ...parsed(bomInputSchema, { finishedProductId: finishedId, notes: "", components: [{ productId: componentPcsId, quantityPerUnit: "1" }] }),
        expectedVersion: draft.version,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
