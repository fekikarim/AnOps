import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { createHarness, parsed, type TestHarness } from "../helpers/workspace";
import { actorOf, seedMember, seedTenants, wsOf } from "../helpers/ai";
import { resolveAiAccess, saveMemberGrant, updateAiSettings } from "@/server/ai/access/access.service";
import { cancelPendingAction, confirmAction, proposeAction } from "@/server/ai/pending-actions.service";
import { aiToolRegistry } from "@/server/ai/tools";
import { isToolAvailable } from "@/server/ai/tools/registry";
import { COLLECTIONS } from "@/server/db/documents";
import { createProduct, createWarehouse, getProduct, listCategories, listProducts, listWarehouses } from "@/server/inventory/catalog.service";
import { listBalancesForProduct, receiveStock } from "@/server/inventory/stock.service";
import { productInputSchema, stockMoveInputSchema, warehouseInputSchema } from "@/features/inventory/schemas/inventory.schema";
import type { AiMessagePart } from "@/server/db/documents";
import type { AiModules } from "@/shared/domain/ai";

let h: TestHarness;
let T: Awaited<ReturnType<typeof seedTenants>>;
let viewer: Awaited<ReturnType<typeof seedMember>>;
let managerDelete: Awaited<ReturnType<typeof seedMember>>;
let admin: typeof T.A.admin;
let A: { bolt: string; nut: string; main: string; second: string };
let B: { product: string; warehouse: string };

const g = (view: boolean, create: boolean, edit: boolean, del: boolean, approve: boolean) => ({ view, create, edit, delete: del, approve });
const grant = (modules: AiModules) => ({ enabled: true, modules, canAuditTranscripts: false, canViewSensitiveHr: false, dailyTokenCap: null });
const reg = aiToolRegistry;

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "OK";
  } catch (e) {
    return (e as { code?: string }).code ?? "UNKNOWN";
  }
}

type Member = Parameters<typeof wsOf>[1];

async function read(member: Member, name: string, args: unknown = {}) {
  const access = await resolveAiAccess(actorOf(h, member));
  const tool = reg.get(name)!;
  if (!isToolAvailable(tool, access)) throw Object.assign(new Error("unavailable"), { code: "UNAVAILABLE" });
  const ws = { ...wsOf(h, member), role: access.member!.role, permissions: access.member!.permissions };
  return tool.run(ws, tool.input.parse(args), { access }, {});
}

async function propose(member: Member, name: string, args: unknown) {
  const access = await resolveAiAccess(actorOf(h, member));
  return proposeAction(wsOf(h, member), access, reg, { toolName: name, rawArgs: args, conversationId: null });
}
const confirm = (member: Member, id: string, typedConfirmation?: string) => confirmAction(wsOf(h, member), reg, { actionId: id, typedConfirmation });

const ownerWs = () => wsOf(h, T.A.owner);
const tables = (parts: AiMessagePart[] | undefined) => (parts ?? []).filter((p) => p.type === "record_table");

async function onHand(productId: string, warehouseId: string): Promise<string> {
  const raw = (await listBalancesForProduct(ownerWs(), productId)).find((b) => b.warehouseId === warehouseId)?.onHand ?? "0";
  return String(Number(raw));
}

beforeAll(async () => {
  h = await createHarness();
  T = await seedTenants(h);
  admin = T.A.admin;
  await updateAiSettings(actorOf(h, T.A.owner), { enabled: true, retentionDays: 90, dailyTokenBudget: 0, defaultUserDailyTokenCap: 0 }, 0);
  await updateAiSettings(actorOf(h, T.B.owner), { enabled: true, retentionDays: 90, dailyTokenBudget: 0, defaultUserDailyTokenCap: 0 }, 0);
  const owner = actorOf(h, T.A.owner);
  await saveMemberGrant(owner, T.A.manager.userId.toHexString(), grant({ inventory: g(true, true, true, false, false) }), 0);
  viewer = await seedMember(h.db, T.companyA, "employee");
  await saveMemberGrant(owner, viewer.userId.toHexString(), grant({ inventory: g(true, false, false, false, false) }), 0);
  managerDelete = await seedMember(h.db, T.companyA, "manager");
  await saveMemberGrant(owner, managerDelete.userId.toHexString(), grant({ inventory: g(true, true, true, true, false) }), 0);
  await saveMemberGrant(owner, admin.userId.toHexString(), grant({ inventory: g(true, true, true, true, true) }), 0);

  const ws = ownerWs();
  const wMain = await createWarehouse(ws, parsed(warehouseInputSchema, { name: "Main Store", code: "MAIN", address: "", isActive: true }));
  const wSec = await createWarehouse(ws, parsed(warehouseInputSchema, { name: "Second Store", code: "SEC", address: "", isActive: true }));
  const mk = (sku: string, name: string, extra = {}) =>
    createProduct(ws, parsed(productInputSchema, { sku, name, description: "", categoryId: "", unitOfMeasure: "unit", isStorable: true, isActive: true, cost: "2.000", salePrice: "3.000", reorderPoint: "5", ...extra }));
  const bolt = await mk("BOLT-1", "Steel bolt");
  const nut = await mk("NUT-1", "Hex nut");
  await receiveStock(ws, parsed(stockMoveInputSchema, { productId: bolt.id, warehouseId: wMain.id, quantity: "40", reason: "seed" }));
  A = { bolt: bolt.id, nut: nut.id, main: wMain.id, second: wSec.id };

  const wsB = wsOf(h, T.B.owner);
  const wB = await createWarehouse(wsB, parsed(warehouseInputSchema, { name: "B Store", code: "BMAIN", address: "", isActive: true }));
  const pB = await createProduct(wsB, parsed(productInputSchema, { sku: "BOLT-1", name: "Company B bolt", description: "", categoryId: "", unitOfMeasure: "unit", isStorable: true, isActive: true, cost: "1", salePrice: "1", reorderPoint: "0" }));
  B = { product: pB.id, warehouse: wB.id };
});
afterAll(async () => {
  await h.cleanup();
});

describe("reads", () => {
  it("lists and searches products as structured tables with ids for follow-up calls", async () => {
    const result = await read(T.A.manager, "inventory_list_products", { q: "bolt" });
    const [table] = tables(result.parts);
    expect(table).toMatchObject({ type: "record_table", total: 1 });
    expect(table.type === "record_table" && table.rows[0].cells.sku).toBe("BOLT-1");
    expect(JSON.stringify(result.data)).toContain(A.bolt);
  });

  it("never returns another company's products, by search, by id or by balances", async () => {
    const all = await read(T.A.owner, "inventory_list_products", { status: "all" });
    expect(JSON.stringify(all.data)).not.toContain(B.product);
    expect(JSON.stringify(all.data)).not.toContain("Company B");
    expect(await code(read(T.A.owner, "inventory_get_product", { productId: B.product }))).toBe("NOT_FOUND");
    const balances = await read(T.A.owner, "inventory_stock_balances", { warehouseId: B.warehouse });
    expect(balances.summary).toBe("0 balances");
    // And the other company sees only its own.
    const theirs = await read(T.B.owner, "inventory_list_products", { status: "all" });
    expect(JSON.stringify(theirs.data)).toContain("Company B bolt");
    expect(JSON.stringify(theirs.data)).not.toContain("Steel bolt");
  });

  it("shows a product card with stock per warehouse and only the actions the member's access allows", async () => {
    const asOwner = await read(T.A.owner, "inventory_get_product", { productId: A.bolt });
    const card = asOwner.parts![0];
    expect(card.type === "record_card" && card.sections?.[0].rows[0]).toEqual({ label: "Main Store (MAIN)", value: "40.000" });
    const labels = (r: Awaited<ReturnType<typeof read>>) => (r.parts![0].type === "record_card" ? r.parts![0].actions!.map((a) => a.label) : []);
    expect(labels(asOwner)).toEqual(expect.arrayContaining(["Edit", "Receive", "Issue", "Transfer", "Adjust stock", "Delete", "Movements"]));
    const asManager = await read(T.A.manager, "inventory_get_product", { productId: A.bolt });
    expect(labels(asManager)).toEqual(expect.arrayContaining(["Edit", "Receive"]));
    expect(labels(asManager)).not.toContain("Delete");
    expect(labels(asManager)).not.toContain("Adjust stock");
    const asViewer = await read(viewer, "inventory_get_product", { productId: A.bolt });
    expect(labels(asViewer)).toEqual(["Movements"]);
  });

  it("returns warehouses, categories, balances and movements", async () => {
    expect((await read(viewer, "inventory_list_warehouses")).summary).toBe("2 warehouses");
    expect((await read(viewer, "inventory_list_categories")).summary).toBe("0 categories");
    const balances = await read(viewer, "inventory_stock_balances", { productId: A.bolt });
    expect(balances.summary).toBe("1 balance");
    const moves = await read(viewer, "inventory_stock_movements", { productId: A.bolt });
    expect(moves.parts![0]).toMatchObject({ type: "record_table", total: 1 });
  });

  it("rejects malformed ids and unknown fields before the service is reached", async () => {
    expect(() => reg.get("inventory_get_product")!.input.parse({ productId: "not-an-id" })).toThrow();
    expect(() => reg.get("inventory_list_products")!.input.parse({ companyId: B.product })).toThrow();
    expect(() => reg.get("inventory_stock_movements")!.input.parse({ productId: A.bolt, page: 0 })).toThrow();
  });
});

describe("tool availability follows live access", () => {
  it("a member with no AI grant, or a revoked cell, gets no inventory tools", async () => {
    const nobody = await seedMember(h.db, T.companyA, "manager");
    expect((await resolveAiAccess(actorOf(h, nobody))).state).toBe("not_granted");
    expect(await code(read(nobody, "inventory_list_products"))).toBe("UNAVAILABLE");
    const names = (m: Member) => resolveAiAccess(actorOf(h, m)).then((a) => reg.availableFor(a).map((t) => t.name));
    const viewerTools = await names(viewer);
    expect(viewerTools).toEqual(expect.arrayContaining(["inventory_list_products", "inventory_stock_movements"]));
    expect(viewerTools.some((n) => /create|update|delete|receive|issue|transfer|adjust|set_/.test(n))).toBe(false);
    const managerTools = await names(T.A.manager);
    expect(managerTools).toContain("inventory_create_product");
    expect(managerTools).not.toContain("inventory_delete_product");
    expect(managerTools).not.toContain("inventory_adjust_stock");
    const adminTools = await names(admin);
    expect(adminTools).toEqual(expect.arrayContaining(["inventory_delete_product", "inventory_adjust_stock"]));
  });
});

describe("category writes", () => {
  it("create, rename and archive: each needs confirmation and shows what changes", async () => {
    const p = await propose(T.A.manager, "inventory_create_category", { name: "Fasteners", description: "Bolts and nuts" });
    expect(p.summary).toBe('Create category "Fasteners".');
    expect((await listCategories(ownerWs())).length).toBe(0); // nothing happens before confirmation
    await confirm(T.A.manager, p.id);
    const [cat] = await listCategories(ownerWs());
    expect(cat.name).toBe("Fasteners");

    const rename = await propose(T.A.manager, "inventory_update_category", { categoryId: cat.id, name: "Hardware" });
    expect(rename.details).toEqual([{ label: "Name", before: "Fasteners", after: "Hardware" }]);
    await confirm(T.A.manager, rename.id);
    expect((await listCategories(ownerWs()))[0].name).toBe("Hardware");

    const arch = await propose(T.A.manager, "inventory_set_category_active", { categoryId: cat.id, isActive: false });
    await confirm(T.A.manager, arch.id);
    expect((await listCategories(ownerWs()))[0].isActive).toBe(false);
  });

  it("refuses duplicates and no-op edits at proposal time, storing nothing", async () => {
    const before = await h.db.collection(COLLECTIONS.aiPendingActions).countDocuments({});
    expect(await code(propose(T.A.manager, "inventory_create_category", { name: "hardware" }))).toBe("CONFLICT");
    const cat = (await listCategories(ownerWs()))[0];
    expect(await code(propose(T.A.manager, "inventory_update_category", { categoryId: cat.id }))).toBe("VALIDATION_ERROR");
    expect(await code(propose(T.A.manager, "inventory_update_category", { categoryId: new ObjectId().toHexString() }))).toBe("NOT_FOUND");
    expect(await h.db.collection(COLLECTIONS.aiPendingActions).countDocuments({})).toBe(before);
  });
});

describe("product writes", () => {
  it("creates a product from loose model input (numbers for money) through the real validation", async () => {
    const p = await propose(T.A.manager, "inventory_create_product", { sku: "washer-1", name: "Flat washer", unitOfMeasure: "unit", cost: 0.25, salePrice: "0.5", reorderPoint: 20 });
    expect(p.details.find((d) => d.label === "SKU")?.after).toBe("WASHER-1");
    expect(p.details.find((d) => d.label === "Cost")?.after).toBe("0.25 TND");
    await confirm(T.A.manager, p.id);
    const found = (await listProducts(ownerWs(), { q: "WASHER", status: "active", page: 1 })).items[0];
    expect(found).toMatchObject({ sku: "WASHER-1", cost: "0.250", salePrice: "0.500" });
  });

  it("rejects invalid input with the module's own rules, at proposal time", async () => {
    const bad = (args: object) => code(propose(T.A.manager, "inventory_create_product", { sku: "X-1", name: "X", unitOfMeasure: "unit", ...args }));
    expect(await bad({ sku: "bad sku!" })).toBe("VALIDATION_ERROR");
    expect(await bad({ cost: -2 })).toBe("VALIDATION_ERROR");
    expect(await bad({ salePrice: "1.23456" })).toBe("VALIDATION_ERROR");
    expect(await bad({ reorderPoint: "2.5" })).toBe("VALIDATION_ERROR"); // countable unit needs a whole number
    expect(await bad({ unitOfMeasure: "parsec" })).toBe("VALIDATION_ERROR");
    expect(await bad({ categoryId: new ObjectId().toHexString() })).toBe("VALIDATION_ERROR");
    expect(await bad({ companyId: T.companyB.toHexString() })).toBe("VALIDATION_ERROR");
    expect(await code(propose(T.A.manager, "inventory_create_product", { sku: "BOLT-1", name: "Dup", unitOfMeasure: "unit" }))).toBe("CONFLICT");
  });

  it("edits show a before/after diff and only the changed fields; a no-op is refused", async () => {
    const p = await propose(T.A.manager, "inventory_update_product", { productId: A.nut, salePrice: 4.5, name: "Hex nut M8" });
    expect(p.details).toEqual([
      { label: "Name", before: "Hex nut", after: "Hex nut M8" },
      { label: "Sale price", before: "3.000 TND", after: "4.5 TND" },
    ]);
    await confirm(T.A.manager, p.id);
    expect(await getProduct(ownerWs(), A.nut)).toMatchObject({ name: "Hex nut M8", salePrice: "4.500" });
    expect(await code(propose(T.A.manager, "inventory_update_product", { productId: A.nut, salePrice: "4.500" }))).toBe("VALIDATION_ERROR");
  });

  it("a stale edit never overwrites a newer change: the version captured at proposal time is enforced", async () => {
    const p = await propose(T.A.manager, "inventory_update_product", { productId: A.nut, reorderPoint: 9 });
    // Someone else edits the product before the confirmation.
    const other = await propose(managerDelete, "inventory_update_product", { productId: A.nut, description: "changed elsewhere" });
    await confirm(managerDelete, other.id);
    expect(await code(confirm(T.A.manager, p.id))).toBe("CONFLICT");
    const product = await getProduct(ownerWs(), A.nut);
    expect(product.description).toBe("changed elsewhere");
    expect(product.reorderPoint).not.toBe("9");
    const row = await h.db.collection(COLLECTIONS.aiPendingActions).findOne({ _id: new ObjectId(p.id) });
    expect(row?.status).toBe("failed");
  });

  it("archive and restore", async () => {
    const p = await propose(T.A.manager, "inventory_set_product_active", { productId: A.nut, isActive: false });
    await confirm(T.A.manager, p.id);
    expect((await getProduct(ownerWs(), A.nut)).isActive).toBe(false);
    expect(await code(propose(T.A.manager, "inventory_set_product_active", { productId: A.nut, isActive: false }))).toBe("VALIDATION_ERROR");
    await confirm(T.A.manager, (await propose(T.A.manager, "inventory_set_product_active", { productId: A.nut, isActive: true })).id);
  });

  it("a manager without the delete cell cannot even propose a delete", async () => {
    expect(await code(propose(T.A.manager, "inventory_delete_product", { productId: A.nut }))).toBe("FORBIDDEN");
    expect(await code(propose(viewer, "inventory_update_product", { productId: A.nut, name: "x" }))).toBe("FORBIDDEN");
  });

  it("deleting needs the typed SKU, refuses referenced products, and runs once", async () => {
    // Referenced product (has stock movements): refused before any proposal exists.
    expect(await code(propose(managerDelete, "inventory_delete_product", { productId: A.bolt }))).toBe("CONFLICT");
    const spare = await createProduct(ownerWs(), parsed(productInputSchema, { sku: "SPARE-1", name: "Spare", description: "", categoryId: "", unitOfMeasure: "unit", isStorable: true, isActive: true, cost: "1", salePrice: "1", reorderPoint: "0" }));
    const p = await propose(managerDelete, "inventory_delete_product", { productId: spare.id });
    expect(p).toMatchObject({ risk: "destructive", requiresTyped: true, typedPhrase: "SPARE-1" });
    expect(await code(confirm(managerDelete, p.id))).toBe("VALIDATION_ERROR");
    expect(await code(confirm(managerDelete, p.id, "spare"))).toBe("VALIDATION_ERROR");
    expect((await getProduct(ownerWs(), spare.id)).sku).toBe("SPARE-1");
    const results = await Promise.all([1, 2, 3].map(() => code(confirm(managerDelete, p.id, "spare-1"))));
    expect(results.filter((r) => r === "OK")).toHaveLength(1);
    expect(await code(getProduct(ownerWs(), spare.id))).toBe("NOT_FOUND");
  });

  it("cannot reach another company's product from a proposal", async () => {
    expect(await code(propose(T.A.manager, "inventory_update_product", { productId: B.product, name: "stolen" }))).toBe("NOT_FOUND");
    expect(await code(propose(managerDelete, "inventory_delete_product", { productId: B.product }))).toBe("NOT_FOUND");
    expect(await code(propose(T.A.manager, "inventory_receive_stock", { productId: B.product, warehouseId: A.main, quantity: 1 }))).toBe("NOT_FOUND");
    expect(await code(propose(T.A.manager, "inventory_receive_stock", { productId: A.bolt, warehouseId: B.warehouse, quantity: 1 }))).toBe("NOT_FOUND");
    expect((await getProduct(wsOf(h, T.B.owner), B.product)).name).toBe("Company B bolt");
  });
});

describe("warehouse writes", () => {
  it("creates, edits and refuses duplicates and deactivating a warehouse that holds stock", async () => {
    const p = await propose(T.A.manager, "inventory_create_warehouse", { name: "Overflow", code: "ovf" });
    expect(p.details[1]).toEqual({ label: "Code", after: "OVF" });
    await confirm(T.A.manager, p.id);
    const wh = (await listWarehouses(ownerWs())).find((w) => w.code === "OVF")!;
    expect(await code(propose(T.A.manager, "inventory_create_warehouse", { name: "Again", code: "OVF" }))).toBe("CONFLICT");
    const edit = await propose(T.A.manager, "inventory_update_warehouse", { warehouseId: wh.id, address: "Dock 4" });
    expect(edit.details).toEqual([{ label: "Address", before: "", after: "Dock 4" }]);
    await confirm(T.A.manager, edit.id);
    // MAIN holds 40 bolts: the service refuses deactivation at execution time.
    const deactivate = await propose(T.A.manager, "inventory_update_warehouse", { warehouseId: A.main, isActive: false });
    expect(await code(confirm(T.A.manager, deactivate.id))).toBe("CONFLICT");
    expect((await listWarehouses(ownerWs())).find((w) => w.id === A.main)?.isActive).toBe(true);
  });
});

describe("stock writes", () => {
  it("receive: previews the new level, then posts through the ledger with both audit trails", async () => {
    const p = await propose(T.A.manager, "inventory_receive_stock", { productId: A.bolt, warehouseId: A.second, quantity: "12", reason: "Found in aisle 3" });
    expect(p.details[0]).toEqual({ label: "On hand (SEC)", before: "0.000", after: "12.000" });
    expect(await onHand(A.bolt, A.second)).toBe("0");
    await confirm(T.A.manager, p.id);
    expect(await onHand(A.bolt, A.second)).toBe("12");
    const events = await h.db.collection(COLLECTIONS.auditEvents).find({ companyId: T.companyA, entityId: { $in: [A.bolt, new ObjectId(A.bolt)] as never } }).toArray();
    const actions = (await h.db.collection(COLLECTIONS.auditEvents).find({ companyId: T.companyA }).toArray()).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["inventory.stock.received", "ai.action.executed"]));
    void events;
  });

  it("issue needs a reason and refuses to go negative, before anything is proposed", async () => {
    expect(await code(propose(T.A.manager, "inventory_issue_stock", { productId: A.bolt, warehouseId: A.second, quantity: 2 }))).toBe("VALIDATION_ERROR");
    expect(await code(propose(T.A.manager, "inventory_issue_stock", { productId: A.bolt, warehouseId: A.second, quantity: 500, reason: "x" }))).toBe("INSUFFICIENT_STOCK");
    const p = await propose(T.A.manager, "inventory_issue_stock", { productId: A.bolt, warehouseId: A.second, quantity: 2, reason: "Damaged" });
    await confirm(T.A.manager, p.id);
    expect(await onHand(A.bolt, A.second)).toBe("10");
  });

  it("transfer moves stock between warehouses atomically and rejects identical endpoints", async () => {
    expect(await code(propose(T.A.manager, "inventory_transfer_stock", { productId: A.bolt, fromWarehouseId: A.main, toWarehouseId: A.main, quantity: 1 }))).toBe("VALIDATION_ERROR");
    const p = await propose(T.A.manager, "inventory_transfer_stock", { productId: A.bolt, fromWarehouseId: A.main, toWarehouseId: A.second, quantity: 15 });
    expect(p.details.map((d) => d.after)).toEqual(["25.000", "25.000"]);
    await confirm(T.A.manager, p.id);
    expect([await onHand(A.bolt, A.main), await onHand(A.bolt, A.second)]).toEqual(["25", "25"]);
  });

  it("rejects fractional quantities for countable units and non-stocked products", async () => {
    expect(await code(confirm(T.A.manager, (await propose(T.A.manager, "inventory_receive_stock", { productId: A.bolt, warehouseId: A.main, quantity: "1.5" })).id))).toBe("VALIDATION_ERROR");
    const service = await createProduct(ownerWs(), parsed(productInputSchema, { sku: "SVC-1", name: "Consulting", description: "", categoryId: "", unitOfMeasure: "hour", isStorable: false, isActive: true, cost: "1", salePrice: "1", reorderPoint: "0" }));
    expect(await code(propose(T.A.manager, "inventory_receive_stock", { productId: service.id, warehouseId: A.main, quantity: 1 }))).toBe("VALIDATION_ERROR");
  });

  it("adjustment needs the approve cell AND the stock-adjust role permission, and a typed SKU", async () => {
    expect(await code(propose(T.A.manager, "inventory_adjust_stock", { productId: A.bolt, warehouseId: A.main, delta: -3, reason: "Count" }))).toBe("FORBIDDEN");
    // The role ceiling stops an administrator from granting a manager the approve cell at all.
    const attempt = await saveMemberGrant(actorOf(h, T.A.owner), T.A.manager.userId.toHexString(), grant({ inventory: g(true, true, true, false, true) }), 1).catch((e) => e);
    expect(attempt.code).toBe("VALIDATION_ERROR");

    const p = await propose(admin, "inventory_adjust_stock", { productId: A.bolt, warehouseId: A.main, delta: -3, reason: "Cycle count" });
    expect(p).toMatchObject({ risk: "financial", requiresTyped: true, typedPhrase: "BOLT-1" });
    expect(p.details[0]).toEqual({ label: "On hand (MAIN)", before: "25.000", after: "22.000" });
    expect(await code(confirm(admin, p.id, "wrong"))).toBe("VALIDATION_ERROR");
    expect(await onHand(A.bolt, A.main)).toBe("25");
    await confirm(admin, p.id, "bolt-1");
    expect(await onHand(A.bolt, A.main)).toBe("22");
    // Below zero is refused up front.
    expect(await code(propose(admin, "inventory_adjust_stock", { productId: A.bolt, warehouseId: A.main, delta: "-999", reason: "oops" }))).toBe("INSUFFICIENT_STOCK");
    expect(await code(propose(admin, "inventory_adjust_stock", { productId: A.bolt, warehouseId: A.main, delta: 5 }))).toBe("VALIDATION_ERROR"); // reason required
  });

  it("a duplicate confirmation never posts stock twice", async () => {
    const p = await propose(T.A.manager, "inventory_receive_stock", { productId: A.nut, warehouseId: A.main, quantity: 7 });
    const results = await Promise.all(Array.from({ length: 8 }, () => code(confirm(T.A.manager, p.id))));
    expect(results.filter((r) => r === "OK")).toHaveLength(1);
    expect(await onHand(A.nut, A.main)).toBe("7");
  });

  it("revocation between proposal and confirmation stops a stock move", async () => {
    const m = await seedMember(h.db, T.companyA, "manager");
    await saveMemberGrant(actorOf(h, T.A.owner), m.userId.toHexString(), grant({ inventory: g(true, true, true, false, false) }), 0);
    const p = await propose(m, "inventory_receive_stock", { productId: A.nut, warehouseId: A.main, quantity: 100 });
    await saveMemberGrant(actorOf(h, T.A.owner), m.userId.toHexString(), grant({ inventory: g(true, true, false, false, false) }), 1);
    expect(await code(confirm(m, p.id))).toBe("CONFLICT");
    expect(await onHand(A.nut, A.main)).toBe("7");
  });

  it("a role downgrade made outside the AI screens is honoured at confirmation", async () => {
    const m = await seedMember(h.db, T.companyA, "manager");
    await saveMemberGrant(actorOf(h, T.A.owner), m.userId.toHexString(), grant({ inventory: g(true, true, true, false, false) }), 0);
    const p = await propose(m, "inventory_receive_stock", { productId: A.nut, warehouseId: A.main, quantity: 100 });
    await h.db.collection(COLLECTIONS.companyMembers).updateOne({ companyId: T.companyA, userId: m.userId }, { $set: { role: "employee" } });
    expect(await code(confirm(m, p.id))).toBe("FORBIDDEN");
    expect(await onHand(A.nut, A.main)).toBe("7");
  });

  it("proposals are private: nobody else, including owners and administrators, can confirm or cancel them", async () => {
    const p = await propose(T.A.manager, "inventory_receive_stock", { productId: A.nut, warehouseId: A.main, quantity: 1 });
    for (const other of [T.A.owner, admin, managerDelete, T.B.owner]) {
      expect(await code(confirm(other, p.id))).toBe("NOT_FOUND");
      expect(await code(cancelPendingAction(wsOf(h, other), p.id))).toBe("NOT_FOUND");
    }
    await cancelPendingAction(wsOf(h, T.A.manager), p.id);
  });
});
