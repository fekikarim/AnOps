import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHarness, parsed, type TestHarness } from "../helpers/workspace";
import { enableAi } from "../helpers/ai";
import { productInputSchema, stockMoveInputSchema, warehouseInputSchema } from "@/features/inventory/schemas/inventory.schema";
import { purchaseOrderInputSchema, supplierInputSchema } from "@/features/purchasing/schemas/purchasing.schema";
import { createProduct, createWarehouse } from "@/server/inventory/catalog.service";
import { getOnHandMicro } from "@/server/inventory/stock-ledger";
import { issueStock, receiveStock } from "@/server/inventory/stock.service";
import { createSupplier } from "@/server/purchasing/supplier.service";
import { createPurchaseOrder, getPurchaseOrder } from "@/server/purchasing/purchase-order.service";
import {
  convertReplenishmentProposal,
  generateReplenishmentProposal,
  getReplenishmentProposal,
  reconcileReplenishmentProposal,
} from "@/server/purchasing/replenishment.service";
import { ObjectId } from "mongodb";
import { COLLECTIONS, type ReplenishmentProposalDoc } from "@/server/db/documents";

/** Groq is replaced by a scripted fake. The real provider is covered in tests/unit/groq-provider.test.ts. */
const { completeMock } = vi.hoisted(() => ({ completeMock: vi.fn() }));
vi.mock("@/server/ai", () => ({ ai: { complete: completeMock, status: () => [{ name: "Fake", available: true, models: [] }] } }));

let h: TestHarness;
let warehouseId: string;
let supplierId: string;
let productA: { id: string };

async function generate(ctx = h.ctx(), horizonDays = 14) {
  return generateReplenishmentProposal(ctx, { warehouseId, horizonDays });
}

beforeAll(async () => {
  h = await createHarness();
  // Rationale generation runs behind the AI gate: the proposing member holds a live Purchasing AI grant.
  await enableAi(h, h.ctx(), { purchasing: { view: true, create: true } });
  warehouseId = (await createWarehouse(h.ctx(), parsed(warehouseInputSchema, { name: "Main", code: "MAIN", address: "", isActive: true }))).id;
  supplierId = (
    await createSupplier(
      h.ctx(),
      parsed(supplierInputSchema, { name: "Repl Supplies", email: "", phone: "", taxIdentifier: "", address: "", isActive: true })
    )
  ).id;
  productA = await createProduct(
    h.ctx(),
    parsed(productInputSchema, {
      sku: "REP-A", name: "Widget A", description: "", categoryId: "", unitOfMeasure: "unit",
      isStorable: true, isActive: true, cost: "2.000", salePrice: "0.000", reorderPoint: "5",
    })
  );
  await createProduct(
    h.ctx(),
    parsed(productInputSchema, {
      sku: "REP-C", name: "Widget C", description: "", categoryId: "", unitOfMeasure: "unit",
      isStorable: true, isActive: true, cost: "3.500", salePrice: "0.000", reorderPoint: "4",
    })
  );
  await createProduct(
    h.ctx(),
    parsed(productInputSchema, {
      sku: "REP-KG", name: "Bulk powder", description: "", categoryId: "", unitOfMeasure: "kg",
      isStorable: true, isActive: true, cost: "1.000", salePrice: "0.000", reorderPoint: "0",
    })
  );

  // Facts: 40 units of A received, 30 issued during the lookback (1 per day), so 10 remain.
  await receiveStock(h.ctx(), parsed(stockMoveInputSchema, { productId: productA.id, warehouseId, quantity: "40", reason: "" }));
  await issueStock(h.ctx(), parsed(stockMoveInputSchema, { productId: productA.id, warehouseId, quantity: "30", reason: "Sales" }));
});

afterAll(async () => {
  await h.cleanup();
});

beforeEach(() => {
  completeMock.mockReset();
  completeMock.mockResolvedValue({ text: "{}", provider: "Groq", model: "openai/gpt-oss-120b" });
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

describe("replenishment proposals", () => {
  it("computes suggestions from stock facts, stores provenance, and never changes stock", async () => {
    completeMock.mockResolvedValueOnce({
      provider: "Groq",
      model: "openai/gpt-oss-120b",
      text: JSON.stringify({
        items: [
          { productId: productA.id, rationale: "Recorded use is 30 units in the last 30 days, an average of 1 per day. Projected use over 14 days is 14, so the suggested quantity is 9." },
          { productId: "ffffffffffffffffffffffff", rationale: "Not a product that was sent." },
        ],
      }),
    });
    const before = await getOnHandMicro(h.db, { companyId: h.ctx().companyId }, new ObjectId(productA.id), new ObjectId(warehouseId));

    const proposal = await generate();

    expect(proposal).toMatchObject({
      status: "proposed",
      horizonDays: 14,
      method: "trailing_consumption_v1",
      rationaleStatus: "partial",
      rationaleProvider: "Groq",
      canConvert: true,
      lineCount: 2,
    });
    const bySku = Object.fromEntries(proposal.lines.map((line) => [line.sku, line]));
    // A: 1/day x 14 + reorder 5 - on hand 10 = 9. C: reorder 4 - 0 = 4. Kg item has no need.
    expect(bySku["REP-A"]).toMatchObject({ forecastDailyUsage: "1.000", suggested: "9.000", onHand: "10.000", rationale: "Recorded use is 30 units in the last 30 days, an average of 1 per day. Projected use over 14 days is 14, so the suggested quantity is 9." });
    expect(bySku["REP-C"]).toMatchObject({ suggested: "4.000", rationale: null });
    expect(bySku["REP-KG"]).toBeUndefined();

    expect(await getOnHandMicro(h.db, { companyId: h.ctx().companyId }, new ObjectId(productA.id), new ObjectId(warehouseId))).toBe(before);

    // Only facts and computed numbers were sent to the provider. No supplier or company data.
    const sent = JSON.stringify(completeMock.mock.calls[0][0]);
    expect(sent).not.toContain(supplierId);
    expect(sent).toContain("REP-A");
    expect(completeMock.mock.calls[0][0]).toMatchObject({ provider: "groq", jsonObject: true });
  });

  it("keeps the proposal when Groq is unavailable and records the status", async () => {
    completeMock.mockRejectedValueOnce(new Error("[AiMaster] No AI providers are configured."));
    const proposal = await generate();
    expect(proposal.rationaleStatus).toBe("unavailable");
    expect(proposal.lines.every((line) => line.rationale === null)).toBe(true);
    expect(proposal.lineCount).toBe(2);
  });

  it("records invalid model output without trusting it", async () => {
    completeMock.mockResolvedValueOnce({ provider: "Groq", model: "m", text: "Sure! Here is the answer: ..." });
    const proposal = await generate();
    expect(proposal.rationaleStatus).toBe("invalid_output");
    expect(proposal.lines.every((line) => line.rationale === null)).toBe(true);
  });

  it("denies generation without order-management rights", async () => {
    await expect(generate(h.ctx("viewer"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("does not expose one company's proposals to another", async () => {
    const proposal = await generate();
    await expect(getReplenishmentProposal(h.otherTenant(), proposal.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(convertReplenishmentProposal(h.otherTenant(), proposal.id, { supplierId, expectedVersion: proposal.version }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("requires the approve permission to convert, even for a user who can manage orders", async () => {
    const proposal = await generate();
    await expect(convertReplenishmentProposal(h.ctx("operator"), proposal.id, { supplierId, expectedVersion: proposal.version }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    const stillProposed = await getReplenishmentProposal(h.ctx(), proposal.id);
    expect(stillProposed.status).toBe("proposed");
  });

  it("converts an approved proposal into a draft order at the server-side product cost, once", async () => {
    const proposal = await generate();
    const order = await convertReplenishmentProposal(h.ctx(), proposal.id, { supplierId, expectedVersion: proposal.version });

    expect(order.status).toBe("draft");
    const lines = Object.fromEntries(order.lines.map((line) => [line.sku, line]));
    expect(lines["REP-A"]).toMatchObject({ ordered: "9.000", unitCost: "2.000" });
    expect(lines["REP-C"]).toMatchObject({ ordered: "4.000", unitCost: "3.500" });

    const stored = await getPurchaseOrder(h.ctx(), order.id);
    expect(stored.status).toBe("draft");
    const after = await getReplenishmentProposal(h.ctx(), proposal.id);
    expect(after).toMatchObject({ status: "converted", convertedOrderId: order.id, canConvert: false });

    await expect(convertReplenishmentProposal(h.ctx(), proposal.id, { supplierId, expectedVersion: after.version }))
      .rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("lets only one of two simultaneous conversions create an order", async () => {
    const proposal = await generate();
    const attempts = await Promise.allSettled([
      convertReplenishmentProposal(h.ctx(), proposal.id, { supplierId, expectedVersion: proposal.version }),
      convertReplenishmentProposal(h.ctx(), proposal.id, { supplierId, expectedVersion: proposal.version }),
    ]);
    const fulfilled = attempts.filter((a) => a.status === "fulfilled");
    const rejected = attempts.filter((a): a is PromiseRejectedResult => a.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ code: "CONFLICT" });

    const orders = await h.db
      .collection(COLLECTIONS.purchaseOrders)
      .countDocuments({ companyId: h.ctx().companyId, notes: `Draft created from replenishment proposal ${proposal.id}` });
    expect(orders).toBe(1);
  });

  it("rejects a stale review before creating anything", async () => {
    const proposal = await generate();
    await expect(convertReplenishmentProposal(h.ctx(), proposal.id, { supplierId, expectedVersion: 99 }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect((await getReplenishmentProposal(h.ctx(), proposal.id)).status).toBe("proposed");
  });

  it("releases the claim when order creation fails, so the approver can retry", async () => {
    const proposal = await generate();
    await expect(
      convertReplenishmentProposal(h.ctx(), proposal.id, { supplierId: "ffffffffffffffffffffffff", expectedVersion: proposal.version })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const released = await h.db
      .collection<ReplenishmentProposalDoc>(COLLECTIONS.purchaseReplenishmentProposals)
      .findOne({ _id: new ObjectId(proposal.id) });
    expect(released?.status).toBe("proposed");

    const order = await convertReplenishmentProposal(h.ctx(), proposal.id, { supplierId, expectedVersion: released!.version });
    expect(order.status).toBe("draft");
  });
});

describe("conversion recovery", () => {
  const proposalsCollection = () => h.db.collection<ReplenishmentProposalDoc>(COLLECTIONS.purchaseReplenishmentProposals);

  /** Puts a proposal into the state a crashed conversion leaves behind. */
  async function leaveClaim(proposalId: string, claimedAt: Date, conversionOrderId: ObjectId) {
    await proposalsCollection().updateOne(
      { _id: new ObjectId(proposalId) },
      { $set: { status: "converting", claimedAt, conversionOrderId, updatedAt: new Date() }, $inc: { version: 1 } }
    );
  }

  /** Creates the order a conversion would have created, linked to the proposal, as if the final write then failed. */
  async function orderFor(proposalId: string, orderId = new ObjectId()) {
    return createPurchaseOrder(
      h.ctx(),
      parsed(purchaseOrderInputSchema, {
        supplierId,
        expectedDate: "",
        notes: `Draft created from replenishment proposal ${proposalId}`,
        lines: [{ productId: productA.id, quantity: "9", unitCost: "2.000", taxRate: "0" }],
      }),
      { orderId, proposalId: new ObjectId(proposalId) }
    );
  }

  it("links a proposal stuck in converting to the order that already exists", async () => {
    const proposal = await generate();
    const order = await orderFor(proposal.id);
    await leaveClaim(proposal.id, new Date(), new ObjectId(order.id));

    const recovered = await reconcileReplenishmentProposal(h.ctx(), proposal.id);
    expect(recovered).toMatchObject({ status: "converted", convertedOrderId: order.id, canConvert: false });
  });

  it("releases a stale claim that has no order, and the conversion then succeeds exactly once", async () => {
    const proposal = await generate();
    await leaveClaim(proposal.id, new Date(Date.now() - 60 * 60 * 1000), new ObjectId());

    const released = await reconcileReplenishmentProposal(h.ctx(), proposal.id);
    expect(released.status).toBe("proposed");

    const order = await convertReplenishmentProposal(h.ctx(), proposal.id, { supplierId, expectedVersion: released.version });
    expect(order.status).toBe("draft");
    const orders = await h.db
      .collection(COLLECTIONS.purchaseOrders)
      .countDocuments({ companyId: h.ctx().companyId, sourceReplenishmentProposalId: new ObjectId(proposal.id) });
    expect(orders).toBe(1);
  });

  it("refuses to release a claim that may still be running", async () => {
    const proposal = await generate();
    await leaveClaim(proposal.id, new Date(), new ObjectId());

    await expect(reconcileReplenishmentProposal(h.ctx(), proposal.id)).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await getReplenishmentProposal(h.ctx(), proposal.id)).status).toBe("converting");
  });

  it("lets the database refuse a second order for the same proposal", async () => {
    const proposal = await generate();
    await orderFor(proposal.id);
    await expect(orderFor(proposal.id)).rejects.toMatchObject({ code: 11000 });
    const orders = await h.db
      .collection(COLLECTIONS.purchaseOrders)
      .countDocuments({ companyId: h.ctx().companyId, sourceReplenishmentProposalId: new ObjectId(proposal.id) });
    expect(orders).toBe(1);
  });

  it("adopts an order that a late write created after its claim was released, instead of duplicating it", async () => {
    const proposal = await generate();
    await leaveClaim(proposal.id, new Date(Date.now() - 60 * 60 * 1000), new ObjectId());
    const released = await reconcileReplenishmentProposal(h.ctx(), proposal.id);

    const late = await orderFor(proposal.id);
    const adopted = await convertReplenishmentProposal(h.ctx(), proposal.id, { supplierId, expectedVersion: released.version });

    expect(adopted.id).toBe(late.id);
    expect(await getReplenishmentProposal(h.ctx(), proposal.id)).toMatchObject({ status: "converted", convertedOrderId: late.id });
    const orders = await h.db
      .collection(COLLECTIONS.purchaseOrders)
      .countDocuments({ companyId: h.ctx().companyId, sourceReplenishmentProposalId: new ObjectId(proposal.id) });
    expect(orders).toBe(1);
  });

  it("denies recovery to a user who cannot approve orders", async () => {
    const proposal = await generate();
    await leaveClaim(proposal.id, new Date(Date.now() - 60 * 60 * 1000), new ObjectId());
    await expect(reconcileReplenishmentProposal(h.ctx("operator"), proposal.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await getReplenishmentProposal(h.ctx(), proposal.id)).status).toBe("converting");
  });
});
