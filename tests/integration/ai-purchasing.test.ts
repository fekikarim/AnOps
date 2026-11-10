import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createHarness, parsed, type TestHarness } from "../helpers/workspace";
import { actorOf, seedMember, seedTenants, wsOf } from "../helpers/ai";
import { code, flow, formValues, fieldValue, kind, llm, stated } from "../helpers/ai-flow";
import { saveMemberGrant, updateAiSettings } from "@/server/ai/access/access.service";
import { runTurn, type TurnEvent } from "@/server/ai/orchestrator";
import { createProduct, createWarehouse } from "@/server/inventory/catalog.service";
import { listBalancesForProduct, issueStock, receiveStock } from "@/server/inventory/stock.service";
import { approvePurchaseOrder, createPurchaseOrder, getPurchaseOrder, listPurchaseOrders } from "@/server/purchasing/purchase-order.service";
import { getReceipt, listReceipts } from "@/server/purchasing/receipt.service";
import { createSupplier, listSuppliers } from "@/server/purchasing/supplier.service";
import { getReplenishmentProposal } from "@/server/purchasing/replenishment.service";
import { productInputSchema, stockMoveInputSchema, warehouseInputSchema } from "@/features/inventory/schemas/inventory.schema";
import { purchaseOrderInputSchema, supplierInputSchema } from "@/features/purchasing/schemas/purchasing.schema";
import type { AiModules } from "@/shared/domain/ai";

/** The replenishment service asks a model for explanations; here it is unavailable, which the service handles. */
const { completeMock } = vi.hoisted(() => ({ completeMock: vi.fn() }));
vi.mock("@/server/ai", () => ({ ai: { complete: completeMock } }));

let h: TestHarness;
let T: Awaited<ReturnType<typeof seedTenants>>;
let viewer: Awaited<ReturnType<typeof seedMember>>;
let buyer: Awaited<ReturnType<typeof seedMember>>;
let A: { main: string; second: string; bolt: string; nut: string; kg: string; s1: string; inactive: string };
let B: { supplier: string; product: string; warehouse: string };
const f = flow(() => h);

const g = (view: boolean, create: boolean, edit: boolean, del: boolean, approve: boolean) => ({ view, create, edit, delete: del, approve });
const grant = (modules: AiModules) => ({ enabled: true, modules, canAuditTranscripts: false, canViewSensitiveHr: false, dailyTokenCap: null });
const ws = () => wsOf(h, T.A.owner);
const num = (s: string) => String(Number(s));

async function onHand(productId: string, warehouseId: string) {
  return num((await listBalancesForProduct(ws(), productId)).find((b) => b.warehouseId === warehouseId)?.onHand ?? "0");
}
async function draftOrder(lines: { productId: string; quantity: string; unitCost?: string; taxRate?: string }[], supplierId = A.s1) {
  return createPurchaseOrder(ws(), parsed(purchaseOrderInputSchema, { supplierId, expectedDate: "", notes: "", lines: lines.map((l) => ({ unitCost: "1.000", taxRate: "0", ...l })) }));
}
async function approved(lines: Parameters<typeof draftOrder>[0]) {
  const o = await draftOrder(lines);
  await approvePurchaseOrder(ws(), o.id, o.version);
  return getPurchaseOrder(ws(), o.id);
}

beforeAll(async () => {
  completeMock.mockRejectedValue(new Error("model unavailable in tests"));
  h = await createHarness();
  T = await seedTenants(h);
  for (const o of [T.A.owner, T.B.owner]) await updateAiSettings(actorOf(h, o), { enabled: true, retentionDays: 90, dailyTokenBudget: 0, defaultUserDailyTokenCap: 0 }, 0);
  const owner = actorOf(h, T.A.owner);
  viewer = await seedMember(h.db, T.companyA, "manager");
  await saveMemberGrant(owner, viewer.userId.toHexString(), grant({ purchasing: g(true, false, false, false, false) }), 0);
  buyer = await seedMember(h.db, T.companyA, "manager");
  await saveMemberGrant(owner, buyer.userId.toHexString(), grant({ purchasing: g(true, true, true, true, false), inventory: g(true, false, false, false, false) }), 0);
  await saveMemberGrant(owner, T.A.admin.userId.toHexString(), grant({ purchasing: g(true, true, true, true, true), inventory: g(true, true, true, true, true), manufacturing: g(true, true, true, true, true) }), 0);

  const main = await createWarehouse(ws(), parsed(warehouseInputSchema, { name: "Main Store", code: "MAIN", address: "", isActive: true }));
  const second = await createWarehouse(ws(), parsed(warehouseInputSchema, { name: "Second Store", code: "SEC", address: "", isActive: true }));
  const mk = (sku: string, name: string, cost: string, unit = "unit") =>
    createProduct(ws(), parsed(productInputSchema, { sku, name, description: "", categoryId: "", unitOfMeasure: unit, isStorable: true, isActive: true, cost, salePrice: "0", reorderPoint: "5" }));
  const bolt = await mk("BOLT-1", "Steel bolt", "2.000");
  const nut = await mk("NUT-1", "Hex nut", "0.500");
  const kg = await mk("KG-1", "Bulk powder", "1.000", "kg");
  const sup = (name: string, isActive = true) => createSupplier(ws(), parsed(supplierInputSchema, { name, email: "", phone: "", taxIdentifier: "", address: "", isActive }));
  const s1 = await sup("Olive Grove");
  const inactive = await sup("Dormant Supplies", false);
  A = { main: main.id, second: second.id, bolt: bolt.id, nut: nut.id, kg: kg.id, s1: s1.id, inactive: inactive.id };

  const wsB = wsOf(h, T.B.owner);
  B = {
    warehouse: (await createWarehouse(wsB, parsed(warehouseInputSchema, { name: "B Store", code: "BMAIN", address: "", isActive: true }))).id,
    product: (await createProduct(wsB, parsed(productInputSchema, { sku: "BOLT-9", name: "Company B bolt", description: "", categoryId: "", unitOfMeasure: "unit", isStorable: true, isActive: true, cost: "1", salePrice: "0", reorderPoint: "0" }))).id,
    supplier: (await createSupplier(wsB, parsed(supplierInputSchema, { name: "Company B Supplier", email: "", phone: "", taxIdentifier: "", address: "", isActive: true }))).id,
  };
});
afterAll(async () => {
  await h.cleanup();
});

describe("reads", () => {
  it("lists suppliers, orders and receipts for this company only, with ids for follow-up calls", async () => {
    const suppliers = await f.read(viewer, "purchasing_list_suppliers", {});
    expect(JSON.stringify(suppliers.data)).toContain(A.s1);
    expect(JSON.stringify(suppliers.data)).not.toContain("Company B");
    expect(await code(f.read(viewer, "purchasing_get_order", { orderId: new ObjectId().toHexString() }))).toBe("NOT_FOUND");
    const theirs = await createPurchaseOrder(wsOf(h, T.B.owner), parsed(purchaseOrderInputSchema, { supplierId: B.supplier, expectedDate: "", notes: "", lines: [{ productId: B.product, quantity: "1", unitCost: "1", taxRate: "0" }] }));
    expect(await code(f.read(viewer, "purchasing_get_order", { orderId: theirs.id }))).toBe("NOT_FOUND");
    expect(JSON.stringify((await f.read(viewer, "purchasing_list_orders", {})).data)).not.toContain(theirs.orderNumber);
  });

  it("a viewer sees cards without write actions; the buyer sees edit and receive actions where the record allows", async () => {
    const o = await draftOrder([{ productId: A.bolt, quantity: "3" }]);
    const actions = async (m: typeof viewer) => ((await f.read(m, "purchasing_get_order", { orderId: o.id })).parts![0] as { actions: { label: string }[] }).actions.map((a) => a.label);
    expect(await actions(viewer)).toEqual([]);
    expect(await actions(buyer)).toEqual(["Edit order", "Cancel order"]); // no approve cell
    expect(await actions(T.A.admin)).toEqual(["Edit order", "Approve", "Cancel order"]);
  });
});

describe("suppliers", () => {
  it("create and update go through preview and confirmation; duplicates and invalid data are refused up front", async () => {
    const before = await h.db.collection("ai_pending_actions").countDocuments({});
    expect(await code(f.propose(buyer, "purchasing_create_supplier", { name: "olive grove" }))).toBe("CONFLICT");
    expect(await code(f.propose(buyer, "purchasing_create_supplier", { name: "Bad Mail", email: "not-an-email" }))).toBe("VALIDATION_ERROR");
    expect(await h.db.collection("ai_pending_actions").countDocuments({})).toBe(before);
    const p = await f.propose(buyer, "purchasing_create_supplier", { name: "Sfax Packaging", email: "hello@sfax.tn", phone: "71 000 000" });
    expect(p.details.map((d) => d.label)).toEqual(["Name", "Email", "Phone"]);
    expect((await listSuppliers(ws(), { q: "Sfax", page: 1 })).total).toBe(0);
    await f.confirm(buyer, p.id);
    const created = (await listSuppliers(ws(), { q: "Sfax", page: 1 })).items[0];
    const edit = await f.propose(buyer, "purchasing_update_supplier", { supplierId: created.id, phone: "71 999 999" });
    expect(edit.details).toEqual([{ label: "Phone", before: "71 000 000", after: "71 999 999" }]);
    await f.confirm(buyer, edit.id);
    expect(await code(f.propose(buyer, "purchasing_update_supplier", { supplierId: created.id, phone: "71 999 999" }))).toBe("VALIDATION_ERROR"); // no-op
    expect(await code(f.propose(viewer, "purchasing_create_supplier", { name: "Nope" }))).toBe("FORBIDDEN");
    expect(await code(f.propose(buyer, "purchasing_update_supplier", { supplierId: B.supplier, phone: "1" }))).toBe("NOT_FOUND");
  });
});

describe("purchase orders", () => {
  it("creates a draft with the exact totals the service will store, using the product's own cost when none is given", async () => {
    const p = await f.propose(buyer, "purchasing_create_order", { supplierId: A.s1, expectedDate: "2026-12-01", lines: [{ productId: A.bolt, quantity: 10, unitCost: 2, taxRate: 19 }, { productId: A.nut, quantity: "20" }] });
    expect(p.summary).toBe("Create a draft purchase order for Olive Grove with 2 lines.");
    expect(p.details).toEqual([
      { label: "Supplier", after: "Olive Grove" },
      { label: "Expected", after: "2026-12-01" },
      { label: "BOLT-1 · Steel bolt", after: "10 × 2 (+19% tax)" },
      { label: "NUT-1 · Hex nut", after: "20 × 0.500" }, // standard cost from the product record
      { label: "Total", after: "33.800 TND" },
    ]);
    const results = await Promise.all([1, 2, 3].map(() => code(f.confirm(buyer, p.id))));
    expect(results.filter((r) => r === "OK")).toHaveLength(1);
    const stored = (await listPurchaseOrders(ws(), { status: "draft", q: "", page: 1 })).items.find((o) => o.total === "33.800");
    expect(stored?.status).toBe("draft");
  });

  it("refuses invalid input with the module's own rules, foreign records and inactive suppliers, storing nothing", async () => {
    const base = { supplierId: A.s1, lines: [{ productId: A.bolt, quantity: 1 }] };
    const bad = (a: object) => code(f.propose(buyer, "purchasing_create_order", { ...base, ...a }));
    expect(await bad({ lines: [{ productId: A.bolt, quantity: 0 }] })).toBe("VALIDATION_ERROR");
    expect(await bad({ lines: [{ productId: A.bolt, quantity: 1 }, { productId: A.bolt, quantity: 2 }] })).toBe("VALIDATION_ERROR");
    expect(await bad({ lines: [{ productId: A.bolt, quantity: 1, taxRate: 250 }] })).toBe("VALIDATION_ERROR");
    expect(await bad({ lines: [] })).toBe("VALIDATION_ERROR");
    expect(await bad({ expectedDate: "tomorrow" })).toBe("VALIDATION_ERROR");
    expect(await bad({ supplierId: A.inactive })).toBe("VALIDATION_ERROR");
    expect(await bad({ supplierId: B.supplier })).toBe("NOT_FOUND");
    expect(await bad({ lines: [{ productId: B.product, quantity: 1 }] })).toBe("NOT_FOUND");
    expect(await bad({ companyId: T.companyB.toHexString() })).toBe("VALIDATION_ERROR");
    expect(await code(f.propose(viewer, "purchasing_create_order", base))).toBe("FORBIDDEN");
  });

  it("edits show a precise diff, protect against a stale version, and refuse approved orders", async () => {
    const o = await draftOrder([{ productId: A.bolt, quantity: "10", unitCost: "2" }, { productId: A.nut, quantity: "20", unitCost: "0.5" }]);
    const p = await f.propose(buyer, "purchasing_update_order", { orderId: o.id, lines: [{ productId: A.bolt, quantity: 15, unitCost: 2, taxRate: 0 }] });
    expect(p.details.map((d) => d.label)).toEqual(["BOLT-1 · Steel bolt", "Remove NUT-1 · Hex nut", "New total"]);
    expect(p.details[0]).toMatchObject({ before: "10.000 × 2.000 (+0%)", after: "15 × 2 (+0%)" });
    // The order changes elsewhere before this is confirmed.
    const other = await f.propose(T.A.admin, "purchasing_update_order", { orderId: o.id, notes: "changed elsewhere" });
    await f.confirm(T.A.admin, other.id);
    expect(await code(f.confirm(buyer, p.id))).toBe("CONFLICT");
    expect((await getPurchaseOrder(ws(), o.id)).lines).toHaveLength(2);
    const approvedOrder = await approved([{ productId: A.bolt, quantity: "1" }]);
    expect(await code(f.propose(buyer, "purchasing_update_order", { orderId: approvedOrder.id, notes: "x" }))).toBe("INVALID_TRANSITION");
  });

  it("an order that already has an expected date can be edited (the date round-trips as YYYY-MM-DD) and shows it cleanly", async () => {
    const dated = await createPurchaseOrder(ws(), parsed(purchaseOrderInputSchema, { supplierId: A.s1, expectedDate: "2026-12-01", notes: "", lines: [{ productId: A.bolt, quantity: "4", unitCost: "2", taxRate: "0" }] }));
    const card = (await f.read(buyer, "purchasing_get_order", { orderId: dated.id })).parts![0] as { fields: { label: string; value: string }[] };
    expect(card.fields.find((x) => x.label === "Expected")?.value).toBe("2026-12-01");
    const p = await f.propose(buyer, "purchasing_update_order", { orderId: dated.id, notes: "Call before delivery" });
    expect(p.details.map((d) => d.label)).toEqual(["Notes", "New total"]); // the date is unchanged, so it is not in the diff
    await f.confirm(buyer, p.id);
    expect((await getPurchaseOrder(ws(), dated.id)).notes).toBe("Call before delivery");
    // The guided edit form carries the same clean date.
    const form = kind(await f.parts(buyer, { command: "editorder", step: "select", args: { orderId: dated.id } }), "form");
    expect(fieldValue(form, "expectedDate")).toBe("2026-12-01");
    const change = await f.propose(buyer, "purchasing_update_order", { orderId: dated.id, expectedDate: "2027-01-10" });
    expect(change.details[0]).toEqual({ label: "Expected", before: "2026-12-01", after: "2027-01-10" });
  });

  it("approval needs the approve permission and a typed order number, and runs once", async () => {
    const o = await draftOrder([{ productId: A.bolt, quantity: "5", unitCost: "2" }]);
    expect(await code(f.propose(buyer, "purchasing_approve_order", { orderId: o.id }))).toBe("FORBIDDEN");
    const p = await f.propose(T.A.admin, "purchasing_approve_order", { orderId: o.id });
    expect(p).toMatchObject({ risk: "financial", requiresTyped: true, typedPhrase: o.orderNumber });
    expect(await code(f.confirm(T.A.admin, p.id))).toBe("VALIDATION_ERROR");
    expect((await getPurchaseOrder(ws(), o.id)).status).toBe("draft");
    const results = await Promise.all([1, 2, 3].map(() => code(f.confirm(T.A.admin, p.id, o.orderNumber.toLowerCase()))));
    expect(results.filter((r) => r === "OK")).toHaveLength(1);
    expect((await getPurchaseOrder(ws(), o.id)).status).toBe("approved");
    expect(await code(f.propose(T.A.admin, "purchasing_approve_order", { orderId: o.id }))).toBe("INVALID_TRANSITION");
  });

  it("cancelling needs a typed order number; an approved order with posted receipts cannot be cancelled", async () => {
    const o = await draftOrder([{ productId: A.bolt, quantity: "2" }]);
    const p = await f.propose(buyer, "purchasing_cancel_order", { orderId: o.id });
    expect(p).toMatchObject({ risk: "destructive", typedPhrase: o.orderNumber });
    await f.confirm(buyer, p.id, o.orderNumber);
    expect((await getPurchaseOrder(ws(), o.id)).status).toBe("cancelled");
    const live = await approved([{ productId: A.nut, quantity: "4" }]);
    const rc = await f.propose(T.A.admin, "purchasing_create_receipt", { purchaseOrderId: live.id, warehouseId: A.main, lines: [{ purchaseOrderLineId: live.lines[0].id, quantity: 4 }] });
    await f.confirm(T.A.admin, rc.id);
    const receipt = (await listReceipts(ws(), { status: "draft", page: 1 })).items.find((r) => r.orderNumber === live.orderNumber)!;
    await f.confirm(T.A.admin, (await f.propose(T.A.admin, "purchasing_post_receipt", { receiptId: receipt.id })).id);
    expect(await code(f.propose(T.A.admin, "purchasing_cancel_order", { orderId: live.id }))).toBe("INVALID_TRANSITION");
  });
});

describe("goods receipts", () => {
  it("record against an approved order, then post: stock and order status follow, once", async () => {
    const o = await approved([{ productId: A.bolt, quantity: "10", unitCost: "2" }, { productId: A.nut, quantity: "6", unitCost: "1" }]);
    const [lineBolt, lineNut] = o.lines;
    expect(await code(f.propose(buyer, "purchasing_create_receipt", { purchaseOrderId: o.id, warehouseId: A.main, lines: [{ purchaseOrderLineId: lineBolt.id, quantity: 11 }] }))).toBe("VALIDATION_ERROR"); // more than remaining
    expect(await code(f.propose(buyer, "purchasing_create_receipt", { purchaseOrderId: o.id, warehouseId: B.warehouse, lines: [{ purchaseOrderLineId: lineBolt.id, quantity: 1 }] }))).toBe("NOT_FOUND");
    expect(await code(f.propose(buyer, "purchasing_create_receipt", { purchaseOrderId: o.id, warehouseId: A.main, lines: [{ purchaseOrderLineId: new ObjectId().toHexString(), quantity: 1 }] }))).toBe("VALIDATION_ERROR");
    const draftOnly = await draftOrder([{ productId: A.bolt, quantity: "1" }]);
    expect(await code(f.propose(buyer, "purchasing_create_receipt", { purchaseOrderId: draftOnly.id, warehouseId: A.main, lines: [{ purchaseOrderLineId: draftOnly.lines[0].id, quantity: 1 }] }))).toBe("INVALID_TRANSITION");

    const before = await onHand(A.bolt, A.main);
    const p = await f.propose(buyer, "purchasing_create_receipt", { purchaseOrderId: o.id, warehouseId: A.main, lines: [{ purchaseOrderLineId: lineBolt.id, quantity: 10 }, { purchaseOrderLineId: lineNut.id, quantity: 2 }] });
    await f.confirm(buyer, p.id);
    expect(await onHand(A.bolt, A.main)).toBe(before); // a draft receipt moves nothing
    const receipt = (await listReceipts(ws(), { status: "draft", page: 1 })).items.find((r) => r.orderNumber === o.orderNumber)!;
    const post = await f.propose(buyer, "purchasing_post_receipt", { receiptId: receipt.id });
    expect(post.details.filter((d) => d.after.startsWith("+")).map((d) => d.after)).toEqual(["+10.000 unit", "+2.000 unit"]);
    const results = await Promise.all([1, 2, 3].map(() => code(f.confirm(buyer, post.id))));
    expect(results.filter((r) => r === "OK")).toHaveLength(1);
    expect(Number(await onHand(A.bolt, A.main)) - Number(before)).toBe(10);
    expect((await getReceipt(ws(), receipt.id)).status).toBe("posted");
    expect((await getPurchaseOrder(ws(), o.id)).status).toBe("partially_received");
    expect(await code(f.propose(buyer, "purchasing_post_receipt", { receiptId: receipt.id }))).toBe("INVALID_TRANSITION");
  });

  it("a draft receipt can be cancelled with a typed number; a viewer can do none of this", async () => {
    const o = await approved([{ productId: A.nut, quantity: "3" }]);
    await f.confirm(buyer, (await f.propose(buyer, "purchasing_create_receipt", { purchaseOrderId: o.id, warehouseId: A.main, lines: [{ purchaseOrderLineId: o.lines[0].id, quantity: 3 }] })).id);
    const r = (await listReceipts(ws(), { status: "draft", page: 1 })).items.find((x) => x.orderNumber === o.orderNumber)!;
    const cancel = await f.propose(buyer, "purchasing_cancel_receipt", { receiptId: r.id });
    expect(cancel.typedPhrase).toBe(r.receiptNumber);
    await f.confirm(buyer, cancel.id, r.receiptNumber);
    expect((await getReceipt(ws(), r.id)).status).toBe("cancelled");
    expect(await code(f.propose(viewer, "purchasing_post_receipt", { receiptId: r.id }))).toBe("FORBIDDEN");
  });
});

describe("workflow: replenishment -> purchase order -> receipt -> stock", () => {
  it("runs end to end through the AI tools, with live permissions and a confirmation at every write", async () => {
    // Demand history: 40 received, 30 issued, so BOLT-1 is below its reorder point.
    await receiveStock(ws(), parsed(stockMoveInputSchema, { productId: A.bolt, warehouseId: A.second, quantity: "40", reason: "seed" }));
    await issueStock(ws(), parsed(stockMoveInputSchema, { productId: A.bolt, warehouseId: A.second, quantity: "37", reason: "usage" }));

    expect(await code(f.propose(buyer, "purchasing_generate_replenishment", { warehouseId: A.second, horizonDays: 14 }))).toBe("OK"); // creating a proposal needs only the manage permission
    const gen = await f.propose(T.A.admin, "purchasing_generate_replenishment", { warehouseId: A.second, horizonDays: "14" });
    expect(await code(f.propose(T.A.admin, "purchasing_generate_replenishment", { warehouseId: A.second, horizonDays: 200 }))).toBe("VALIDATION_ERROR");
    await f.confirm(T.A.admin, gen.id);
    const proposalRow = (await h.db.collection("purchase_replenishment_proposals").find({ companyId: T.companyA }).sort({ generatedAt: -1 }).toArray())[0];
    const proposalId = proposalRow._id.toHexString();
    const proposal = await getReplenishmentProposal(ws(), proposalId);
    expect(proposal.lines.find((l) => l.sku === "BOLT-1")).toBeTruthy();

    // Only someone with the approve permission can turn it into an order.
    expect(await code(f.propose(buyer, "purchasing_convert_replenishment", { proposalId, supplierId: A.s1 }))).toBe("FORBIDDEN");
    expect(await code(f.propose(T.A.admin, "purchasing_convert_replenishment", { proposalId, supplierId: A.inactive }))).toBe("VALIDATION_ERROR");
    expect(await code(f.propose(T.A.admin, "purchasing_convert_replenishment", { proposalId, supplierId: B.supplier }))).toBe("NOT_FOUND");
    const convert = await f.propose(T.A.admin, "purchasing_convert_replenishment", { proposalId, supplierId: A.s1 });
    expect(convert.details[0]).toEqual({ label: "Supplier", after: "Olive Grove" });
    await f.confirm(T.A.admin, convert.id);
    const done = await getReplenishmentProposal(ws(), proposalId);
    expect(done.status).toBe("converted");
    expect(await code(f.confirm(T.A.admin, convert.id))).toBe("CONFLICT"); // exactly once
    const order = await getPurchaseOrder(ws(), done.convertedOrderId!);
    expect(order.status).toBe("draft");

    // Approve (typed), receive everything remaining, post.
    await f.confirm(T.A.admin, (await f.propose(T.A.admin, "purchasing_approve_order", { orderId: order.id })).id, order.orderNumber);
    const approvedOrder = await getPurchaseOrder(ws(), order.id);
    const receipt = await f.propose(T.A.admin, "purchasing_create_receipt", { purchaseOrderId: order.id, warehouseId: A.second, lines: approvedOrder.lines.map((l) => ({ purchaseOrderLineId: l.id, quantity: l.remaining })) });
    await f.confirm(T.A.admin, receipt.id);
    const draft = (await listReceipts(ws(), { status: "draft", page: 1 })).items.find((r) => r.orderNumber === order.orderNumber)!;
    const boltSuggested = Number(proposal.lines.find((l) => l.sku === "BOLT-1")!.suggested);
    const before = Number(await onHand(A.bolt, A.second));
    await f.confirm(T.A.admin, (await f.propose(T.A.admin, "purchasing_post_receipt", { receiptId: draft.id })).id);
    expect(Number(await onHand(A.bolt, A.second)) - before).toBe(boltSuggested);
    expect((await getPurchaseOrder(ws(), order.id)).status).toBe("received");
  });
});

describe("AI-assisted entry", () => {
  const OLIVE = "Order 50 steel bolts and 20 hex nuts from Olive Grove, expected 2026-12-01";

  it("both ways in are offered; the manual order form keeps one blank row and the manual receipt form fixed rows", async () => {
    for (const command of ["neworder", "editorder", "receivegoods", "newsupplier", "editsupplier", "genreplenishment"]) {
      expect(kind(await f.parts(T.A.admin, { command, step: "start", args: {} }), "entry_choice")).toMatchObject({ command });
    }
    const manual = kind(await f.parts(T.A.admin, { command: "neworder", step: "manual", args: {} }), "form");
    expect(manual.draft).toBeUndefined();
    expect(manual.fields.map((x) => x.name)).toEqual(["supplierId", "expectedDate", "notes", "lines"]);
    expect(JSON.parse(String(fieldValue(manual, "lines")))).toHaveLength(1);
  });

  it("describes an order in words: supplier and products are resolved against real records, costs come from the product record, quantities only from the person's words", async () => {
    const { complete } = llm({
      values: { supplierId: stated("Olive Grove", "from Olive Grove"), expectedDate: stated("2026-12-01", "2026-12-01") },
      lines: [
        { ref: "steel bolts", values: { quantity: stated(50, "50 steel bolts") } },
        { ref: "hex nuts", values: { quantity: stated(20, "20 hex nuts"), unitCost: { value: 9, basis: "assumed" } } },
      ],
    });
    const draft = kind(await f.parts(buyer, { command: "neworder", step: "draft", args: {}, draft: { text: OLIVE, provenance: {} } }, complete), "form");
    expect(fieldValue(draft, "supplierId")).toBe(A.s1);
    expect(draft.draft!.provenance.supplierId).toBe("found");
    const rows = JSON.parse(String(fieldValue(draft, "lines"))) as Record<string, string>[];
    expect(rows.map((r) => [r.productId, r.quantity, r.unitCost, r.taxRate])).toEqual([[A.bolt, "50", "2.000", "0"], [A.nut, "20", "0.500", "0"]]);
    const cells = draft.draft!.lineProvenance!.lines;
    expect(cells[0]).toMatchObject({ productId: "found", quantity: "you", unitCost: "found", taxRate: "default" });
    expect(cells[1].unitCost).toBe("found"); // the model's assumed price 9 is ignored; the product's own cost stays
    expect(draft.draft!.questions).toEqual([]);
    // Nothing exists yet; submitting is the manual submit and ends in the usual confirmation.
    const before = (await listPurchaseOrders(ws(), { status: "all", q: "", page: 1 })).total;
    const review = kind(await f.parts(buyer, { command: "neworder", step: "submit", args: draft.context, values: formValues(draft) }), "confirmation");
    expect(review.summary).toBe("Create a draft purchase order for Olive Grove with 2 lines.");
    expect((await listPurchaseOrders(ws(), { status: "all", q: "", page: 1 })).total).toBe(before);
    await f.confirm(buyer, review.actionId);
    expect((await listPurchaseOrders(ws(), { status: "all", q: "", page: 1 })).total).toBe(before + 1);
  });

  it("never invents a supplier, a quantity or a product: it asks, and lists the real candidates when several match", async () => {
    const { complete } = llm({
      values: { supplierId: { value: "Olive Grove", basis: "assumed" } },
      lines: [{ ref: "bolt", values: {} }, { ref: "unicorn saddle", values: { quantity: stated(3, "3") } }, { ref: "n", values: { quantity: stated(1, "1") } }],
    });
    const draft = kind(await f.parts(buyer, { command: "neworder", step: "draft", args: {}, draft: { text: "some bolts and a unicorn saddle 3", provenance: {} } }, complete), "form");
    expect(fieldValue(draft, "supplierId")).toBe("");
    const questions = draft.draft!.questions.map((q) => q.question);
    expect(questions.some((q) => q.startsWith("Which supplier"))).toBe(true);
    expect(questions.some((q) => q.includes("unicorn saddle") && q.includes("could not find"))).toBe(true);
    expect(questions.some((q) => q.includes("What is the quantity for BOLT-1"))).toBe(true);
    expect(JSON.stringify(draft)).not.toContain("Company B");
  });

  it("edits a draft order in words, keeps untouched lines as found, removes a named line, and refuses a stale version", async () => {
    const o = await draftOrder([{ productId: A.bolt, quantity: "10", unitCost: "2" }, { productId: A.nut, quantity: "20", unitCost: "0.5" }]);
    const { complete } = llm({ target: { search: o.orderNumber }, values: {}, lines: [{ ref: "steel bolt", values: { quantity: stated(15, "15") } }, { ref: "hex nut", remove: true, values: {} }] });
    const draft = kind(await f.parts(buyer, { command: "editorder", step: "draft", args: {}, draft: { text: `On ${o.orderNumber} make it 15 steel bolts and remove the hex nuts`, provenance: {} } }, complete), "form");
    expect(draft.title).toBe(`Review changes: ${o.orderNumber}`);
    const rows = JSON.parse(String(fieldValue(draft, "lines"))) as Record<string, string>[];
    expect(rows.map((r) => [r.productId, r.quantity])).toEqual([[A.bolt, "15"]]);
    expect(draft.draft!.lineProvenance!.lines[0]).toMatchObject({ quantity: "you", unitCost: "found" });
    const review = kind(await f.parts(buyer, { command: "editorder", step: "submit", args: draft.context, values: formValues(draft) }), "confirmation");
    expect(review.details.map((d) => d.label)).toEqual(["BOLT-1 · Steel bolt", "Remove NUT-1 · Hex nut", "New total"]);
    const other = await f.propose(T.A.admin, "purchasing_update_order", { orderId: o.id, notes: "bumped" });
    await f.confirm(T.A.admin, other.id);
    expect(await code(f.step(buyer, { command: "editorder", step: "submit", args: draft.context, values: formValues(draft) }))).toBe("CONFLICT");
  });

  it("receiving goods in words: lines are the order's own lines, a model cannot add one, and a quantity must be stated", async () => {
    const o = await approved([{ productId: A.bolt, quantity: "10", unitCost: "2" }, { productId: A.nut, quantity: "6", unitCost: "1" }]);
    const { complete } = llm({
      target: { search: o.orderNumber },
      values: { warehouseId: { value: A.main, basis: "matched_option", evidence: "main store" } },
      lines: [{ ref: "steel bolt", values: { quantity: stated(4, "4 steel bolts") } }, { ref: "hex nut", values: { quantity: { value: 6, basis: "assumed" } } }, { ref: "kg", values: {} }],
    });
    const draft = kind(await f.parts(buyer, { command: "receivegoods", step: "draft", args: {}, draft: { text: `Received 4 steel bolts of ${o.orderNumber} into the main store`, provenance: {} } }, complete), "form");
    expect(draft.fields.find((x) => x.name === "lines")!.lines!.fixedRows).toBe(true);
    const rows = JSON.parse(String(fieldValue(draft, "lines"))) as Record<string, string>[];
    expect(rows.map((r) => r.quantity)).toEqual(["4", ""]); // the assumed nut quantity is dropped
    expect(draft.draft!.questions.map((q) => q.question)).toEqual(expect.arrayContaining([expect.stringContaining("quantity for NUT-1")])); // the assumed quantity is dropped and asked about
    expect(fieldValue(draft, "warehouseId")).toBe(A.main);
    const review = kind(await f.parts(buyer, { command: "receivegoods", step: "submit", args: draft.context, values: formValues(draft) }), "confirmation");
    expect(review.details.at(-1)).toMatchObject({ after: "4 unit (remaining 10.000)" });
  });

  it("a manual receipt form can fill every remaining quantity in one step, and the server still validates the result", async () => {
    const o = await approved([{ productId: A.bolt, quantity: "2" }]);
    const form = kind(await f.parts(buyer, { command: "receivegoods", step: "select", args: { orderId: o.id } }), "form");
    expect(form.fields.find((x) => x.name === "lines")!.lines!.fillRemaining).toEqual({ from: "remaining", to: "quantity" });
    const rows = JSON.parse(String(fieldValue(form, "lines"))) as Record<string, string>[];
    const filled = rows.map((r) => ({ ...r, quantity: "5" })); // more than remaining
    expect(await code(f.step(buyer, { command: "receivegoods", step: "submit", args: form.context, values: { warehouseId: A.main, lines: JSON.stringify(filled) } }))).toBe("VALIDATION_ERROR");
    expect(await code(f.step(buyer, { command: "receivegoods", step: "submit", args: form.context, values: { warehouseId: A.main, lines: JSON.stringify(rows.map((r) => ({ ...r, quantity: r.remaining }))) } }))).toBe("OK");
  });

  it("a replenishment request in words needs the warehouse and the number of days from the person", async () => {
    const { complete } = llm({ values: { warehouseId: { value: A.main, basis: "matched_option", evidence: "main store" }, horizonDays: { value: 21, basis: "assumed" } } });
    const draft = kind(await f.parts(buyer, { command: "genreplenishment", step: "draft", args: {}, draft: { text: "what should we reorder for the main store", provenance: {} } }, complete), "form");
    expect(fieldValue(draft, "warehouseId")).toBe(A.main);
    expect(fieldValue(draft, "horizonDays")).toBe("");
    expect(draft.draft!.questions.some((q) => q.field === "horizonDays")).toBe(true);
  });

  it("a chat order request lands in the same draft; unknown ids are verified, not trusted, and invented prices dropped", async () => {
    const ghost = new ObjectId().toHexString();
    const { complete } = llm({ type: "tool", tool: "purchasing_create_order", args: { supplierId: A.s1, lines: [{ productId: A.bolt, quantity: 7, unitCost: 99 }, { productId: ghost, quantity: 1 }] } });
    const events: TurnEvent[] = [];
    for await (const e of runTurn(wsOf(h, buyer), { text: "order 7 bolts from Olive Grove" }, { complete })) events.push(e);
    const draft = events.map((e) => (e.type === "part" ? e.part : null)).find((p) => p?.type === "form");
    expect(draft && draft.type === "form" && fieldValue(draft, "supplierId")).toBe(A.s1);
    const rows = JSON.parse(String(draft && draft.type === "form" ? fieldValue(draft, "lines") : "[]")) as Record<string, string>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ productId: A.bolt, quantity: "7", unitCost: "2.000" }); // 99 is not in the person's words
    expect(draft && draft.type === "form" && draft.draft!.questions.map((q) => q.question).join(" ")).toContain("not in your records");
  });
});

describe("authorization across the purchasing flows", () => {
  it("commands and tools follow live access: a viewer has reads only; the buyer cannot approve; a revoked cell ends a flow", async () => {
    const names = async (m: typeof viewer) => (await import("@/server/ai/commands")).commandRegistry.listFor((await (await import("@/server/ai/access/access.service")).resolveAiAccess(actorOf(h, m)))).map((c) => c.command);
    const v = await names(viewer);
    expect(v).toEqual(expect.arrayContaining(["/suppliers", "/orders", "/receipts", "/proposals"]));
    expect(v.some((c) => /new|edit|approve|cancel|receivegoods|post|gen|convert/.test(c))).toBe(false);
    const b = await names(buyer);
    expect(b).toEqual(expect.arrayContaining(["/neworder", "/receivegoods", "/postreceipt", "/cancelorder"]));
    expect(b).not.toContain("/approveorder");
    expect(b).not.toContain("/convertproposal");
    for (const s of ["start", "select"] as const) expect(await code(f.step(buyer, { command: "approveorder", step: s, args: { orderId: A.s1 } }))).toBe("FORBIDDEN");

    const m = await seedMember(h.db, T.companyA, "manager");
    await saveMemberGrant(actorOf(h, T.A.owner), m.userId.toHexString(), grant({ purchasing: g(true, true, true, false, false) }), 0);
    const o = await draftOrder([{ productId: A.bolt, quantity: "1" }]);
    const form = kind(await f.parts(m, { command: "editorder", step: "select", args: { orderId: o.id } }), "form");
    const current = await h.db.collection("ai_access_grants").findOne({ userId: m.userId });
    await saveMemberGrant(actorOf(h, T.A.owner), m.userId.toHexString(), grant({ purchasing: g(true, true, false, false, false) }), current!.version);
    expect(await code(f.step(m, { command: "editorder", step: "submit", args: form.context, values: formValues(form) }))).toBe("FORBIDDEN");
  });

  it("another company's order, receipt and proposal ids fail with NOT_FOUND at every step", async () => {
    const theirs = (await listPurchaseOrders(wsOf(h, T.B.owner), { status: "all", q: "", page: 1 })).items[0];
    for (const [command, step, args] of [["order", "start", { orderId: theirs.id }], ["editorder", "select", { orderId: theirs.id }], ["receivegoods", "select", { orderId: theirs.id }], ["cancelorder", "select", { orderId: theirs.id }], ["receipt", "start", { receiptId: theirs.id }], ["proposal", "start", { proposalId: theirs.id }]] as const) {
      expect(await code(f.step(T.A.admin, { command, step, args })), `${command}.${step}`).toBe("NOT_FOUND");
    }
  });
});
