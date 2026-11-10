import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { createHarness, parsed, type TestHarness } from "../helpers/workspace";
import { productInputSchema, warehouseInputSchema } from "@/features/inventory/schemas/inventory.schema";
import { createProduct, createWarehouse } from "@/server/inventory/catalog.service";
import { getOnHandMicro } from "@/server/inventory/stock-ledger";
import {
  createSupplier,
  getSupplier,
  updateSupplier,
} from "@/server/purchasing/supplier.service";
import {
  approvePurchaseOrder,
  cancelPurchaseOrder,
  createPurchaseOrder,
  getPurchaseOrder,
  listPurchaseOrders,
  updatePurchaseOrder,
} from "@/server/purchasing/purchase-order.service";
import { cancelReceipt, createReceipt, getReceipt, postReceipt } from "@/server/purchasing/receipt.service";
import { supplierInputSchema, purchaseOrderInputSchema, receiptInputSchema } from "@/features/purchasing/schemas/purchasing.schema";
import type { WorkspaceContext } from "@/server/tenancy/workspace";
import type { PurchaseOrderDetailDto } from "@/features/purchasing/types";

let h: TestHarness;
let product: { id: string };
let warehouse: { id: string };
let supplierId: string;

beforeAll(async () => {
  h = await createHarness();
  product = await createProduct(
    h.ctx(),
    parsed(productInputSchema, {
      sku: "PUR-ITEM-1", name: "Purchased item", description: "", categoryId: "", unitOfMeasure: "unit",
      isStorable: true, isActive: true, cost: "2.000", salePrice: "0.000", reorderPoint: "0",
    })
  );
  warehouse = await createWarehouse(h.ctx(), parsed(warehouseInputSchema, { name: "Receiving", code: "RCV", address: "", isActive: true }));
  const supplier = await createSupplier(
    h.ctx(),
    parsed(supplierInputSchema, { name: "Acme Supplies", email: "sales@acme.test", phone: "", taxIdentifier: "", address: "", isActive: true })
  );
  supplierId = supplier.id;
});

afterAll(async () => {
  await h.cleanup();
});

function orderPayload(quantity: string, extra: Record<string, unknown> = {}) {
  return {
    supplierId,
    expectedDate: "",
    notes: "",
    lines: [{ productId: product.id, quantity, unitCost: "2.000", taxRate: "19" }],
    ...extra,
  };
}

async function newOrder(quantity = "10", ctx: WorkspaceContext = h.ctx()): Promise<PurchaseOrderDetailDto> {
  return createPurchaseOrder(ctx, parsed(purchaseOrderInputSchema, orderPayload(quantity)));
}

async function approvedOrder(quantity = "10"): Promise<PurchaseOrderDetailDto> {
  const order = await newOrder(quantity);
  await approvePurchaseOrder(h.ctx(), order.id, order.version);
  return getPurchaseOrder(h.ctx(), order.id);
}

function receiptFor(order: PurchaseOrderDetailDto, quantity: string) {
  return parsed(receiptInputSchema, {
    purchaseOrderId: order.id,
    warehouseId: warehouse.id,
    lines: [{ purchaseOrderLineId: order.lines[0].id, quantity }],
  });
}

async function onHand(): Promise<number> {
  return getOnHandMicro(h.db, { companyId: h.ctx().companyId }, ObjectId.createFromHexString(product.id), ObjectId.createFromHexString(warehouse.id));
}

describe("suppliers", () => {
  it("rejects duplicate supplier names within a company", async () => {
    await expect(
      createSupplier(h.ctx(), parsed(supplierInputSchema, { name: "acme supplies", email: "", phone: "", taxIdentifier: "", address: "", isActive: true }))
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("hides suppliers from other tenants", async () => {
    await expect(getSupplier(h.otherTenant(), supplierId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      updateSupplier(h.otherTenant(), supplierId, parsed(supplierInputSchema, { name: "x", email: "", phone: "", taxIdentifier: "", address: "", isActive: true }))
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("purchase orders", () => {
  it("computes line and order totals on the server with decimal-safe rounding", async () => {
    const order = await newOrder("10");
    expect(order.status).toBe("draft");
    expect(order.lines[0].lineSubtotal).toBe("20.000");
    expect(order.lines[0].lineTax).toBe("3.800");
    expect(order.total).toBe("23.800");
  });

  it("lists orders with line counts", async () => {
    await newOrder("1");
    const list = await listPurchaseOrders(h.ctx(), { q: "", status: "all", page: 1 });
    expect(list.items.length).toBeGreaterThan(0);
    for (const item of list.items) {
      expect(item.lineCount).toBeGreaterThanOrEqual(1);
    }
  });

  it("ignores client-supplied totals and statuses", () => {
    expect(() => parsed(purchaseOrderInputSchema, { ...orderPayload("1"), total: "0.001" })).toThrow();
    expect(() => parsed(purchaseOrderInputSchema, { ...orderPayload("1"), status: "received" })).toThrow();
  });

  it("does not change stock when the order is approved", async () => {
    const before = await onHand();
    const order = await approvedOrder("3");
    expect(order.status).toBe("approved");
    expect(await onHand()).toBe(before);
  });

  it("allows only drafts to be edited", async () => {
    const order = await approvedOrder("2");
    await expect(updatePurchaseOrder(h.ctx(), order.id, order.version, parsed(purchaseOrderInputSchema, orderPayload("5")))).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
  });

  it("prevents operators from approving orders", async () => {
    const order = await newOrder("1");
    await expect(approvePurchaseOrder(h.ctx("operator"), order.id, order.version)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("cannot be cancelled once a receipt has been posted", async () => {
    const order = await approvedOrder("4");
    const receipt = await createReceipt(h.ctx(), receiptFor(order, "1"));
    await postReceipt(h.ctx(), receipt.id);
    const current = await getPurchaseOrder(h.ctx(), order.id);
    await expect(cancelPurchaseOrder(h.ctx(), order.id, current.version)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("denies other tenants any view of the order", async () => {
    const order = await newOrder("1");
    await expect(getPurchaseOrder(h.otherTenant(), order.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("goods receipts", () => {
  it("increases stock only when a receipt is posted, and supports partial receipts", async () => {
    const order = await approvedOrder("10");
    const baseline = await onHand();
    const draft = await createReceipt(h.ctx(), receiptFor(order, "4"));
    expect(await onHand()).toBe(baseline);

    await postReceipt(h.ctx(), draft.id);
    const after = await getPurchaseOrder(h.ctx(), order.id);
    expect(await onHand()).toBe(baseline + 4_000_000);
    expect(after.status).toBe("partially_received");
    expect(after.lines[0].remaining).toBe("6.000");
  });

  it("rejects receipts above the remaining quantity", async () => {
    const order = await approvedOrder("3");
    await expect(createReceipt(h.ctx(), receiptFor(order, "4"))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("posts a receipt exactly once when the same draft is posted concurrently", async () => {
    const order = await approvedOrder("6");
    const draft = await createReceipt(h.ctx(), receiptFor(order, "6"));
    const before = await onHand();

    const results = await Promise.allSettled([postReceipt(h.ctx(), draft.id), postReceipt(h.ctx(), draft.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(failed?.reason).toMatchObject({ code: "CONFLICT" });
    expect(await onHand()).toBe(before + 6_000_000);
    expect((await getReceipt(h.ctx(), draft.id)).status).toBe("posted");
  });

  it("lets only one of two drafts consume the same remaining quantity", async () => {
    const order = await approvedOrder("6");
    const first = await createReceipt(h.ctx(), receiptFor(order, "6"));
    const second = await createReceipt(h.ctx(), receiptFor(order, "6"));
    const before = await onHand();

    const results = await Promise.allSettled([postReceipt(h.ctx(), first.id), postReceipt(h.ctx(), second.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await onHand()).toBe(before + 6_000_000);

    const current = await getPurchaseOrder(h.ctx(), order.id);
    expect(current.status).toBe("received");
    expect(current.lines[0].receivedMicro).toBe(6_000_000);
  });

  it("does not post a cancelled receipt", async () => {
    const order = await approvedOrder("2");
    const draft = await createReceipt(h.ctx(), receiptFor(order, "2"));
    await cancelReceipt(h.ctx(), draft.id);
    await expect(postReceipt(h.ctx(), draft.id)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("denies other tenants the ability to post a receipt", async () => {
    const order = await approvedOrder("1");
    const draft = await createReceipt(h.ctx(), receiptFor(order, "1"));
    await expect(postReceipt(h.otherTenant(), draft.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
