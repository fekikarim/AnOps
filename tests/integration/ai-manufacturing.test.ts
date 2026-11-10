import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHarness, parsed, type TestHarness } from "../helpers/workspace";
import { actorOf, seedMember, seedTenants, wsOf } from "../helpers/ai";
import { code, flow, formValues, fieldValue, kind, llm, stated } from "../helpers/ai-flow";
import { resolveAiAccess, saveMemberGrant, updateAiSettings } from "@/server/ai/access/access.service";
import { commandRegistry } from "@/server/ai/commands";
import { createProduct, createWarehouse } from "@/server/inventory/catalog.service";
import { listBalancesForProduct, receiveStock } from "@/server/inventory/stock.service";
import { activateBom, createBomDraft, getBom, listBoms } from "@/server/manufacturing/bom.service";
import { createWorkOrder, getWorkOrder, listWorkOrders } from "@/server/manufacturing/work-order.service";
import { listPurchaseOrders, getPurchaseOrder } from "@/server/purchasing/purchase-order.service";
import { listReceipts } from "@/server/purchasing/receipt.service";
import { createSupplier } from "@/server/purchasing/supplier.service";
import { bomInputSchema, workOrderInputSchema } from "@/features/manufacturing/schemas/manufacturing.schema";
import { productInputSchema, stockMoveInputSchema, warehouseInputSchema } from "@/features/inventory/schemas/inventory.schema";
import { supplierInputSchema } from "@/features/purchasing/schemas/purchasing.schema";
import type { AiModules } from "@/shared/domain/ai";

const { completeMock } = vi.hoisted(() => ({ completeMock: vi.fn() }));
vi.mock("@/server/ai", () => ({ ai: { complete: completeMock } }));

let h: TestHarness;
let T: Awaited<ReturnType<typeof seedTenants>>;
let viewer: Awaited<ReturnType<typeof seedMember>>;
let planner: Awaited<ReturnType<typeof seedMember>>;
let A: { main: string; second: string; oil: string; bottle: string; raw: string; olive: string; supplier: string };
let B: { bom: string; wo: string; product: string; warehouse: string };
const f = flow(() => h);

const g = (view: boolean, create: boolean, edit: boolean, del: boolean, approve: boolean) => ({ view, create, edit, delete: del, approve });
const grant = (modules: AiModules) => ({ enabled: true, modules, canAuditTranscripts: false, canViewSensitiveHr: false, dailyTokenCap: null });
const ws = () => wsOf(h, T.A.owner);
const num = (s: string | number) => String(Number(s));
async function onHand(productId: string, warehouseId = A.main) {
  return num((await listBalancesForProduct(ws(), productId)).find((b) => b.warehouseId === warehouseId)?.onHand ?? "0");
}
const stock = (productId: string, quantity: string, warehouseId = A.main) => receiveStock(ws(), parsed(stockMoveInputSchema, { productId, warehouseId, quantity, reason: "seed" }));
const mkProduct = (sku: string, name: string, unit: string, cost = "1") =>
  createProduct(ws(), parsed(productInputSchema, { sku, name, description: "", categoryId: "", unitOfMeasure: unit, isStorable: true, isActive: true, cost, salePrice: "0", reorderPoint: "0" }));

async function activeBom(finishedProductId: string, components: { productId: string; quantityPerUnit: string }[]) {
  const b = await createBomDraft(ws(), parsed(bomInputSchema, { finishedProductId, notes: "", components }));
  await activateBom(ws(), b.id, b.version);
  return getBom(ws(), b.id);
}

beforeAll(async () => {
  completeMock.mockRejectedValue(new Error("model unavailable in tests"));
  h = await createHarness();
  T = await seedTenants(h);
  for (const o of [T.A.owner, T.B.owner]) await updateAiSettings(actorOf(h, o), { enabled: true, retentionDays: 90, dailyTokenBudget: 0, defaultUserDailyTokenCap: 0 }, 0);
  const owner = actorOf(h, T.A.owner);
  viewer = await seedMember(h.db, T.companyA, "employee");
  await saveMemberGrant(owner, viewer.userId.toHexString(), grant({ manufacturing: g(true, false, false, false, false) }), 0);
  planner = await seedMember(h.db, T.companyA, "manager");
  await saveMemberGrant(owner, planner.userId.toHexString(), grant({ manufacturing: g(true, true, true, true, true), inventory: g(true, false, false, false, false), purchasing: g(true, true, true, false, false) }), 0);
  await saveMemberGrant(owner, T.A.admin.userId.toHexString(), grant({ manufacturing: g(true, true, true, true, true), purchasing: g(true, true, true, true, true), inventory: g(true, true, true, true, true) }), 0);

  A = {} as typeof A;
  A.main = (await createWarehouse(ws(), parsed(warehouseInputSchema, { name: "Main Store", code: "MAIN", address: "", isActive: true }))).id;
  A.second = (await createWarehouse(ws(), parsed(warehouseInputSchema, { name: "Second Store", code: "SEC", address: "", isActive: true }))).id;
  A.oil = (await mkProduct("OIL-1", "Olive oil bottle", "unit", "10")).id;
  A.bottle = (await mkProduct("BOTTLE-1", "Glass bottle", "unit", "0.4")).id;
  A.raw = (await mkProduct("RAW-1", "Raw olive oil", "kg", "3")).id;
  A.olive = (await mkProduct("OLIVE-2", "Olive pomace", "kg", "1")).id; // a second "olive" product to make words ambiguous
  A.supplier = (await createSupplier(ws(), parsed(supplierInputSchema, { name: "Olive Grove", email: "", phone: "", taxIdentifier: "", address: "", isActive: true }))).id;

  const wsB = wsOf(h, T.B.owner);
  const wB = await createWarehouse(wsB, parsed(warehouseInputSchema, { name: "B Store", code: "BMAIN", address: "", isActive: true }));
  const mkB = (sku: string) => createProduct(wsB, parsed(productInputSchema, { sku, name: `${sku} of B`, description: "", categoryId: "", unitOfMeasure: "unit", isStorable: true, isActive: true, cost: "1", salePrice: "0", reorderPoint: "0" }));
  const fin = await mkB("B-FIN");
  const comp = await mkB("B-COMP");
  const bBom = await createBomDraft(wsB, parsed(bomInputSchema, { finishedProductId: fin.id, notes: "", components: [{ productId: comp.id, quantityPerUnit: "1" }] }));
  await activateBom(wsB, bBom.id, bBom.version);
  const bWo = await createWorkOrder(wsB, parsed(workOrderInputSchema, { bomId: bBom.id, warehouseId: wB.id, quantity: "1", plannedStart: "" }));
  B = { bom: bBom.id, wo: bWo.id, product: fin.id, warehouse: wB.id };
});
afterAll(async () => {
  await h.cleanup();
});

describe("bills of materials", () => {
  it("creates a draft with a clear preview, refuses invalid components with the module's own rules, stores nothing on refusal", async () => {
    const base = { finishedProductId: A.oil, components: [{ productId: A.bottle, quantityPerUnit: 1 }, { productId: A.raw, quantityPerUnit: 0.5 }] };
    const before = await h.db.collection("ai_pending_actions").countDocuments({});
    const bad = (a: object) => code(f.propose(planner, "manufacturing_create_bom", { ...base, ...a }));
    expect(await bad({ components: [{ productId: A.oil, quantityPerUnit: 1 }] })).toBe("VALIDATION_ERROR"); // a product as its own component
    expect(await bad({ components: [{ productId: A.bottle, quantityPerUnit: 1 }, { productId: A.bottle, quantityPerUnit: 2 }] })).toBe("VALIDATION_ERROR");
    expect(await bad({ components: [{ productId: A.bottle, quantityPerUnit: 0.5 }] })).toBe("VALIDATION_ERROR"); // countable unit needs a whole number
    expect(await bad({ components: [{ productId: A.bottle, quantityPerUnit: 0 }] })).toBe("VALIDATION_ERROR");
    expect(await bad({ components: [] })).toBe("VALIDATION_ERROR");
    expect(await bad({ finishedProductId: B.product })).toBe("NOT_FOUND");
    expect(await bad({ components: [{ productId: B.product, quantityPerUnit: 1 }] })).toBe("NOT_FOUND");
    expect(await bad({ companyId: T.companyB.toHexString() })).toBe("VALIDATION_ERROR");
    expect(await code(f.propose(viewer, "manufacturing_create_bom", base))).toBe("FORBIDDEN");
    expect(await h.db.collection("ai_pending_actions").countDocuments({})).toBe(before);

    const p = await f.propose(planner, "manufacturing_create_bom", base);
    expect(p.details).toEqual([
      { label: "Finished product", after: "OIL-1 · Olive oil bottle" },
      { label: "BOTTLE-1 · Glass bottle", after: "1 per unit" },
      { label: "RAW-1 · Raw olive oil", after: "0.5 per unit" },
    ]);
    const results = await Promise.all([1, 2, 3].map(() => code(f.confirm(planner, p.id))));
    expect(results.filter((r) => r === "OK")).toHaveLength(1);
    expect((await listBoms(ws(), { status: "draft", page: 1 })).items.filter((b) => b.finishedSku === "OIL-1")).toHaveLength(1);
  });

  it("edits a draft with a diff and stale protection; activation archives the previous revision; archive needs a typed SKU", async () => {
    const draft = (await listBoms(ws(), { status: "draft", page: 1 })).items.find((b) => b.finishedSku === "OIL-1")!;
    const p = await f.propose(planner, "manufacturing_update_bom", { bomId: draft.id, components: [{ productId: A.bottle, quantityPerUnit: 2 }, { productId: A.raw, quantityPerUnit: 0.5 }, { productId: A.olive, quantityPerUnit: 0.1 }] });
    expect(p.details).toEqual([
      { label: "BOTTLE-1 · Glass bottle", before: "1 per unit", after: "2 per unit" },
      { label: "Add OLIVE-2 · Olive pomace", after: "0.1 per unit" },
    ]);
    const other = await f.propose(planner, "manufacturing_update_bom", { bomId: draft.id, notes: "changed elsewhere" });
    await f.confirm(planner, other.id);
    expect(await code(f.confirm(planner, p.id))).toBe("CONFLICT");
    expect(await code(f.propose(planner, "manufacturing_update_bom", { bomId: draft.id, notes: "changed elsewhere" }))).toBe("VALIDATION_ERROR"); // no-op

    const act = await f.propose(planner, "manufacturing_activate_bom", { bomId: draft.id });
    expect(act.details.map((d) => d.label)).toEqual(["BOM", "Components"]);
    await f.confirm(planner, act.id);
    expect((await getBom(ws(), draft.id)).status).toBe("active");
    expect(await code(f.propose(planner, "manufacturing_update_bom", { bomId: draft.id, notes: "x" }))).toBe("INVALID_TRANSITION");

    // A second revision: activating it archives the first and says so in the preview.
    const second = await createBomDraft(ws(), parsed(bomInputSchema, { finishedProductId: A.oil, notes: "rev 2", components: [{ productId: A.bottle, quantityPerUnit: "1" }] }));
    const act2 = await f.propose(planner, "manufacturing_activate_bom", { bomId: second.id });
    expect(act2.details.find((d) => d.label === "Archives")?.after).toContain("revision 1");
    await f.confirm(planner, act2.id);
    expect((await getBom(ws(), draft.id)).status).toBe("archived");
    const arch = await f.propose(planner, "manufacturing_archive_bom", { bomId: second.id });
    expect(arch).toMatchObject({ risk: "destructive", typedPhrase: "OIL-1" });
    expect(await code(f.confirm(planner, arch.id))).toBe("VALIDATION_ERROR");
    await f.confirm(planner, arch.id, "oil-1");
    expect((await getBom(ws(), second.id)).status).toBe("archived");
  });
});

describe("material availability and work orders", () => {
  it("checks materials read-only, creates a draft work order whose preview names every shortage, and refuses invalid orders", async () => {
    const bom = await activeBom(A.oil, [{ productId: A.bottle, quantityPerUnit: "1" }, { productId: A.raw, quantityPerUnit: "0.5" }]);
    await stock(A.raw, "20");
    const check = await f.read(viewer, "manufacturing_check_materials", { bomId: bom.id, warehouseId: A.main, quantity: 100 });
    expect(check.summary).toBe("2 materials short");
    expect(check.data).toMatchObject({ shortCount: 2, materials: expect.arrayContaining([expect.objectContaining({ sku: "RAW-1", needed: "50.000", onHand: "20.000", shortfall: "30" })]) });
    const actions = ((check.parts![0] as { actions: { label: string }[] }).actions).map((a) => a.label);
    expect(actions).toEqual([]); // a viewer cannot create work orders or purchase orders
    const asPlanner = ((await f.read(planner, "manufacturing_check_materials", { bomId: bom.id, warehouseId: A.main, quantity: 100 })).parts![0] as { actions: { label: string }[] }).actions.map((a) => a.label);
    expect(asPlanner).toEqual(["Create work order", "Order the shortages"]);

    const bad = (a: object) => code(f.propose(planner, "manufacturing_create_work_order", { bomId: bom.id, warehouseId: A.main, quantity: 10, ...a }));
    expect(await bad({ quantity: 0 })).toBe("VALIDATION_ERROR");
    expect(await bad({ plannedStart: "soon" })).toBe("VALIDATION_ERROR");
    expect(await bad({ bomId: B.bom })).toBe("NOT_FOUND");
    expect(await bad({ warehouseId: B.warehouse })).toBe("NOT_FOUND");
    expect(await bad({ bomId: (await listBoms(ws(), { status: "archived", page: 1 })).items[0].id })).toBe("VALIDATION_ERROR"); // not active
    expect(await code(f.propose(viewer, "manufacturing_create_work_order", { bomId: bom.id, warehouseId: A.main, quantity: 1 }))).toBe("FORBIDDEN");

    const p = await f.propose(planner, "manufacturing_create_work_order", { bomId: bom.id, warehouseId: A.main, quantity: "100", plannedStart: "2026-12-01" });
    expect(p.summary).toContain("2 materials are short");
    expect(p.details.some((d) => d.after.includes("SHORT 100.000"))).toBe(true);
    const before = (await listWorkOrders(ws(), { status: "all", page: 1 })).total;
    await f.confirm(planner, p.id);
    expect((await listWorkOrders(ws(), { status: "all", page: 1 })).total).toBe(before + 1);
  });

  it("start and complete need the execute permission; completing refuses up front while materials are short, and consumes and produces exactly once when stocked", async () => {
    const bom = await activeBom(A.oil, [{ productId: A.bottle, quantityPerUnit: "1" }, { productId: A.raw, quantityPerUnit: "0.5" }]);
    const wo = await createWorkOrder(ws(), parsed(workOrderInputSchema, { bomId: bom.id, warehouseId: A.second, quantity: "10", plannedStart: "" }));
    const manager = await seedMember(h.db, T.companyA, "manager");
    await saveMemberGrant(actorOf(h, T.A.owner), manager.userId.toHexString(), grant({ manufacturing: g(true, true, true, false, false) }), 0);
    expect(await code(f.propose(manager, "manufacturing_start_work_order", { workOrderId: wo.id }))).toBe("FORBIDDEN"); // no approve cell
    expect(await code(f.propose(viewer, "manufacturing_start_work_order", { workOrderId: wo.id }))).toBe("FORBIDDEN");

    const start = await f.propose(planner, "manufacturing_start_work_order", { workOrderId: wo.id });
    expect(start.summary).toContain("2 materials are short");
    await f.confirm(planner, start.id);
    expect((await getWorkOrder(ws(), wo.id)).status).toBe("in_progress");
    expect(await code(f.propose(planner, "manufacturing_start_work_order", { workOrderId: wo.id }))).toBe("INVALID_TRANSITION");

    // Short: refused at proposal time, before any confirmation exists.
    expect(await code(f.propose(planner, "manufacturing_complete_work_order", { workOrderId: wo.id }))).toBe("INSUFFICIENT_STOCK");
    await stock(A.bottle, "25", A.second);
    await stock(A.raw, "8", A.second);
    const done = await f.propose(planner, "manufacturing_complete_work_order", { workOrderId: wo.id });
    expect(done).toMatchObject({ risk: "financial", requiresTyped: true, typedPhrase: wo.orderNumber });
    expect(done.details.map((d) => d.label)).toEqual(["Consume BOTTLE-1", "Consume RAW-1", "Receive OIL-1"]);
    expect(await code(f.confirm(planner, done.id, "nope"))).toBe("VALIDATION_ERROR");
    expect(await onHand(A.oil, A.second)).toBe("0");
    const results = await Promise.all([1, 2, 3].map(() => code(f.confirm(planner, done.id, wo.orderNumber))));
    expect(results.filter((r) => r === "OK")).toHaveLength(1);
    expect([await onHand(A.bottle, A.second), await onHand(A.raw, A.second), await onHand(A.oil, A.second)]).toEqual(["15", "3", "10"]);
    expect((await getWorkOrder(ws(), wo.id)).status).toBe("completed");
  });

  it("cancelling needs the typed order number; a completed order cannot be cancelled", async () => {
    const bom = (await listBoms(ws(), { status: "active", page: 1 })).items[0];
    const wo = await createWorkOrder(ws(), parsed(workOrderInputSchema, { bomId: bom.id, warehouseId: A.main, quantity: "1", plannedStart: "" }));
    const p = await f.propose(planner, "manufacturing_cancel_work_order", { workOrderId: wo.id });
    expect(p).toMatchObject({ risk: "destructive", typedPhrase: wo.orderNumber });
    await f.confirm(planner, p.id, wo.orderNumber);
    expect((await getWorkOrder(ws(), wo.id)).status).toBe("cancelled");
    expect(await code(f.propose(planner, "manufacturing_cancel_work_order", { workOrderId: wo.id }))).toBe("INVALID_TRANSITION");
  });
});

describe("workflow: BOM -> material availability -> shortage order -> receipt -> work order", () => {
  it("runs end to end: real shortfalls become a prefilled purchase order, the goods arrive, and production completes", async () => {
    const bom = await activeBom(A.oil, [{ productId: A.bottle, quantityPerUnit: "1" }, { productId: A.raw, quantityPerUnit: "0.5" }]);
    const wo = await createWorkOrder(ws(), parsed(workOrderInputSchema, { bomId: bom.id, warehouseId: A.main, quantity: "40", plannedStart: "" }));
    const detail = await getWorkOrder(ws(), wo.id);
    const shortages = detail.materials.filter((m) => !m.sufficient);
    expect(shortages.length).toBeGreaterThan(0);

    // The work order card offers the next step; the planner has purchasing create access.
    const card = (await f.read(planner, "manufacturing_get_work_order", { workOrderId: wo.id })).parts![0] as { actions: { label: string; command: string; args: Record<string, string> }[]; badges: { label: string }[] };
    expect(card.badges.some((b) => b.label.endsWith("short"))).toBe(true);
    const order = card.actions.find((a) => a.label === "Order the shortages")!;
    expect(order).toMatchObject({ command: "neworder", args: { workOrderId: wo.id } });

    // The prefilled draft carries the exact shortfalls, marked as found in company records, and asks for the supplier.
    const draft = kind(await f.parts(planner, { command: order.command, step: "manual", args: order.args }), "form");
    const rows = JSON.parse(String(fieldValue(draft, "lines"))) as Record<string, string>[];
    expect(rows.map((r) => [r.productId, r.quantity]).sort()).toEqual(shortages.map((m) => [m.productId, m.shortfallExact]).sort());
    expect(draft.draft!.lineProvenance!.lines.every((c) => c.quantity === "found" && c.unitCost === "found")).toBe(true);
    expect(draft.draft!.questions.some((q) => q.field === "supplierId")).toBe(true);
    expect(fieldValue(draft, "notes")).toBe(`For material shortages of ${wo.orderNumber}`);

    // Review, confirm, approve, receive, post.
    const values = { ...formValues(draft), supplierId: A.supplier };
    await f.confirm(planner, kind(await f.parts(planner, { command: "neworder", step: "submit", args: draft.context, values }), "confirmation").actionId);
    const po = (await listPurchaseOrders(ws(), { status: "draft", q: "", page: 1 })).items.find((o) => o.supplierName === "Olive Grove" && o.lineCount === shortages.length)!;
    const full = await getPurchaseOrder(ws(), po.id);
    await f.confirm(T.A.admin, (await f.propose(T.A.admin, "purchasing_approve_order", { orderId: po.id })).id, po.orderNumber);
    await f.confirm(T.A.admin, (await f.propose(T.A.admin, "purchasing_create_receipt", { purchaseOrderId: po.id, warehouseId: A.main, lines: full.lines.map((l) => ({ purchaseOrderLineId: l.id, quantity: l.remaining })) })).id);
    const receipt = (await listReceipts(ws(), { status: "draft", page: 1 })).items.find((r) => r.orderNumber === po.orderNumber)!;
    await f.confirm(T.A.admin, (await f.propose(T.A.admin, "purchasing_post_receipt", { receiptId: receipt.id })).id);
    expect((await getWorkOrder(ws(), wo.id)).materials.every((m) => m.sufficient)).toBe(true);

    // Production: start, complete with the typed number.
    await f.confirm(planner, (await f.propose(planner, "manufacturing_start_work_order", { workOrderId: wo.id })).id);
    const oilBefore = Number(await onHand(A.oil, A.main));
    await f.confirm(planner, (await f.propose(planner, "manufacturing_complete_work_order", { workOrderId: wo.id })).id, wo.orderNumber);
    expect(Number(await onHand(A.oil, A.main)) - oilBefore).toBe(40);
    expect((await getWorkOrder(ws(), wo.id)).status).toBe("completed");
  });

  it("a member without purchasing access is not offered the shortage action, and cannot reach it by hand", async () => {
    const solo = await seedMember(h.db, T.companyA, "manager");
    await saveMemberGrant(actorOf(h, T.A.owner), solo.userId.toHexString(), grant({ manufacturing: g(true, true, true, false, false), inventory: g(true, false, false, false, false) }), 0);
    const wo = (await listWorkOrders(ws(), { status: "draft", page: 1 })).items[0] ?? (await listWorkOrders(ws(), { status: "all", page: 1 })).items[0];
    const card = (await f.read(solo, "manufacturing_get_work_order", { workOrderId: wo.id })).parts![0] as { actions: { label: string }[] };
    expect(card.actions.map((a) => a.label)).not.toContain("Order the shortages");
    expect(await code(f.step(solo, { command: "neworder", step: "manual", args: { workOrderId: wo.id } }))).toBe("FORBIDDEN");
  });
});

describe("AI-assisted entry", () => {
  it("offers both paths for BOMs and work orders; read-only and action commands have no draft form", async () => {
    for (const command of ["newbom", "editbom", "newworkorder"]) expect(kind(await f.parts(planner, { command, step: "start", args: {} }), "entry_choice")).toMatchObject({ command });
    for (const name of ["activatebom", "archivebom", "startworkorder", "completeworkorder", "cancelworkorder", "materials"]) expect(commandRegistry.get(name)?.draft, name).toBeUndefined();
  });

  it("describes a BOM in words: the finished product and components are resolved against real products, quantities must be stated", async () => {
    const { complete } = llm({
      values: { finishedProductId: stated("olive oil bottle", "the olive oil bottle") },
      lines: [{ ref: "glass bottle", values: { quantityPerUnit: stated(1, "1 glass bottle") } }, { ref: "raw olive oil", values: { quantityPerUnit: { value: 2, basis: "assumed" } } }],
    });
    const draft = kind(await f.parts(planner, { command: "newbom", step: "draft", args: {}, draft: { text: "A bill of materials for the olive oil bottle: 1 glass bottle and some raw olive oil per unit", provenance: {} } }, complete), "form");
    expect(fieldValue(draft, "finishedProductId")).toBe(A.oil);
    expect(draft.draft!.provenance.finishedProductId).toBe("found");
    const rows = JSON.parse(String(fieldValue(draft, "components"))) as Record<string, string>[];
    expect(rows.map((r) => [r.productId, r.quantityPerUnit])).toEqual([[A.bottle, "1"], [A.raw, ""]]); // assumed amount dropped
    expect(draft.draft!.questions.map((q) => q.question)).toEqual(expect.arrayContaining([expect.stringContaining("quantity per unit for RAW-1")]));
    const review = kind(await f.parts(planner, { command: "newbom", step: "submit", args: draft.context, values: { ...formValues(draft), components: JSON.stringify(rows.map((r) => (r.productId === A.raw ? { ...r, quantityPerUnit: "0.5" } : r))) } }), "confirmation");
    expect(review.summary).toContain("OIL-1");
  });

  it("an ambiguous or unknown product name is asked about, never guessed", async () => {
    const { complete } = llm({ values: { finishedProductId: stated("olive", "olive") }, lines: [{ ref: "olive", values: { quantityPerUnit: stated(1, "1") } }, { ref: "dragon scale", values: { quantityPerUnit: stated(2, "2") } }] });
    const draft = kind(await f.parts(planner, { command: "newbom", step: "draft", args: {}, draft: { text: "olive with 1 olive and 2 dragon scale", provenance: {} } }, complete), "form");
    expect(fieldValue(draft, "finishedProductId")).toBe("");
    const q = draft.draft!.questions.map((x) => x.question).join(" | ");
    expect(q).toContain("More than one finished product matches");
    expect(q).toContain("OLIVE-2");
    expect(q).toContain("could not find \"dragon scale\"");
  });

  it("describes a work order in words: BOM by name, warehouse from the real list, quantity only if stated", async () => {
    const { complete } = llm({ values: { bomId: stated("OIL-1", "OIL-1"), warehouseId: { value: A.main, basis: "matched_option", evidence: "main store" }, quantity: stated(200, "200 units"), plannedStart: stated("2026-12-01", "2026-12-01") } });
    const draft = kind(await f.parts(planner, { command: "newworkorder", step: "draft", args: {}, draft: { text: "Produce 200 units of OIL-1 in the main store starting 2026-12-01", provenance: {} } }, complete), "form");
    expect(String(fieldValue(draft, "bomId"))).toHaveLength(24);
    expect(fieldValue(draft, "quantity")).toBe("200");
    expect(draft.draft!.provenance).toMatchObject({ bomId: "found", warehouseId: "found", quantity: "you" });
    const noQty = llm({ values: { bomId: stated("OIL-1", "OIL-1"), quantity: { value: 50, basis: "assumed" } } });
    const d2 = kind(await f.parts(planner, { command: "newworkorder", step: "draft", args: {}, draft: { text: "make some OIL-1", provenance: {} } }, noQty.complete), "form");
    expect(fieldValue(d2, "quantity")).toBe("");
    expect(d2.draft!.questions.some((x) => x.field === "quantity")).toBe(true);
  });

  it("the /materials form answers without a confirmation (nothing changes) and respects live access", async () => {
    const bom = (await listBoms(ws(), { status: "active", page: 1 })).items[0];
    const formPart = kind(await f.parts(viewer, { command: "materials", step: "select", args: { bomId: bom.id } }), "form");
    const result = kind(await f.parts(viewer, { command: "materials", step: "submit", args: {}, values: { ...formValues(formPart), quantity: "5" } }), "record_card");
    expect(result.title).toContain("Materials for 5");
    const nobody = await seedMember(h.db, T.companyA, "manager");
    expect(await code(f.step(nobody, { command: "materials", step: "start", args: {} }))).toBe("FORBIDDEN");
  });
});

describe("tenant isolation and permissions", () => {
  it("another company's BOM and work order ids fail with NOT_FOUND at every step", async () => {
    for (const [command, step, args] of [["bom", "start", { bomId: B.bom }], ["editbom", "select", { bomId: B.bom }], ["workorder", "start", { workOrderId: B.wo }], ["startworkorder", "select", { workOrderId: B.wo }], ["cancelworkorder", "select", { workOrderId: B.wo }], ["materials", "select", { bomId: B.bom }], ["neworder", "manual", { workOrderId: B.wo }]] as const) {
      const outcome = await code(f.step(T.A.admin, { command, step, args }));
      // materials/select only builds a form with the id preselected; submitting it is where the record is read.
      if (command === "materials") expect(await code(f.step(T.A.admin, { command, step: "submit", args: {}, values: { bomId: B.bom, warehouseId: A.main, quantity: "1" } }))).toBe("NOT_FOUND");
      else expect(outcome, `${command}.${step}`).toBe("NOT_FOUND");
    }
  });

  it("the palette follows live access for Manufacturing", async () => {
    const names = async (m: typeof viewer) => commandRegistry.listFor(await resolveAiAccess(actorOf(h, m))).map((c) => c.command);
    const v = await names(viewer);
    expect(v).toEqual(expect.arrayContaining(["/boms", "/workorders", "/materials"]));
    expect(v.some((c) => /new|edit|activate|archive|start|complete|cancel/.test(c))).toBe(false);
    expect(await names(planner)).toEqual(expect.arrayContaining(["/newbom", "/editbom", "/newworkorder", "/startworkorder", "/completeworkorder"]));
  });
});
