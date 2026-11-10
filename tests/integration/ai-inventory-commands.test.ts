import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createHarness, parsed, type TestHarness } from "../helpers/workspace";
import { actorOf, seedMember, seedTenants, wsOf } from "../helpers/ai";
import { resolveAiAccess, saveMemberGrant, updateAiSettings } from "@/server/ai/access/access.service";
import { runCommandStep } from "@/server/ai/command-runner";
import { commandRegistry } from "@/server/ai/commands";
import { getConversation, createConversation } from "@/server/ai/conversation.service";
import { runTurn, type CompleteFn, type TurnEvent } from "@/server/ai/orchestrator";
import { confirmAction } from "@/server/ai/pending-actions.service";
import { aiToolRegistry } from "@/server/ai/tools";
import { createProduct, createWarehouse, getProduct } from "@/server/inventory/catalog.service";
import { listBalancesForProduct, receiveStock } from "@/server/inventory/stock.service";
import { productInputSchema, stockMoveInputSchema, warehouseInputSchema } from "@/features/inventory/schemas/inventory.schema";
import type { AiMessagePart } from "@/server/db/documents";
import type { AiModules } from "@/shared/domain/ai";

let h: TestHarness;
let T: Awaited<ReturnType<typeof seedTenants>>;
let viewer: Awaited<ReturnType<typeof seedMember>>;
let A: { bolt: string; main: string; second: string };
let foreignProduct: string;

const g = (view: boolean, create: boolean, edit: boolean, del: boolean, approve: boolean) => ({ view, create, edit, delete: del, approve });
const grant = (modules: AiModules) => ({ enabled: true, modules, canAuditTranscripts: false, canViewSensitiveHr: false, dailyTokenCap: null });
type Member = Parameters<typeof wsOf>[1];

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "OK";
  } catch (e) {
    return (e as { code?: string }).code ?? "UNKNOWN";
  }
}
const step = (member: Member, body: object) => runCommandStep(wsOf(h, member), body);
const partsOf = async (member: Member, body: object) => (await step(member, body)).parts;
const kind = <T extends AiMessagePart["type"]>(parts: AiMessagePart[], type: T) => parts.find((p) => p.type === type) as Extract<AiMessagePart, { type: T }>;
async function newManager(modules: AiModules = { inventory: g(true, true, true, false, false) }) {
  const m = await seedMember(h.db, T.companyA, "manager");
  await saveMemberGrant(actorOf(h, T.A.owner), m.userId.toHexString(), grant(modules), 0);
  return m;
}
async function onHand(productId: string, warehouseId: string) {
  const row = (await listBalancesForProduct(wsOf(h, T.A.owner), productId)).find((b) => b.warehouseId === warehouseId);
  return String(Number(row?.onHand ?? "0"));
}

beforeAll(async () => {
  h = await createHarness();
  T = await seedTenants(h);
  for (const o of [T.A.owner, T.B.owner]) await updateAiSettings(actorOf(h, o), { enabled: true, retentionDays: 90, dailyTokenBudget: 0, defaultUserDailyTokenCap: 0 }, 0);
  viewer = await seedMember(h.db, T.companyA, "employee");
  await saveMemberGrant(actorOf(h, T.A.owner), viewer.userId.toHexString(), grant({ inventory: g(true, false, false, false, false) }), 0);
  await saveMemberGrant(actorOf(h, T.A.owner), T.A.admin.userId.toHexString(), grant({ inventory: g(true, true, true, true, true) }), 0);
  const ws = wsOf(h, T.A.owner);
  const main = await createWarehouse(ws, parsed(warehouseInputSchema, { name: "Main Store", code: "MAIN", address: "", isActive: true }));
  const second = await createWarehouse(ws, parsed(warehouseInputSchema, { name: "Second Store", code: "SEC", address: "", isActive: true }));
  const bolt = await createProduct(ws, parsed(productInputSchema, { sku: "BOLT-1", name: "Steel bolt", description: "", categoryId: "", unitOfMeasure: "unit", isStorable: true, isActive: true, cost: "2", salePrice: "3", reorderPoint: "5" }));
  await receiveStock(ws, parsed(stockMoveInputSchema, { productId: bolt.id, warehouseId: main.id, quantity: "40", reason: "seed" }));
  A = { bolt: bolt.id, main: main.id, second: second.id };
  const wsB = wsOf(h, T.B.owner);
  foreignProduct = (await createProduct(wsB, parsed(productInputSchema, { sku: "FOREIGN-1", name: "Other company", description: "", categoryId: "", unitOfMeasure: "unit", isStorable: true, isActive: true, cost: "1", salePrice: "1", reorderPoint: "0" }))).id;
});
afterAll(async () => {
  await h.cleanup();
});

describe("the command palette follows live access", () => {
  const names = async (m: Member) => commandRegistry.listFor(await resolveAiAccess(actorOf(h, m))).map((c) => c.command);

  it("shows each member only the commands they can run, and never hidden row-action commands", async () => {
    const manager = await newManager();
    const viewerNames = await names(viewer);
    expect(viewerNames).toEqual(expect.arrayContaining(["/help", "/access", "/products", "/categories", "/warehouses", "/stock", "/movements"]));
    expect(viewerNames.some((n) => /new|edit|delete|archive|receive|issue|transfer|adjust/.test(n))).toBe(false);
    const managerNames = await names(manager);
    expect(managerNames).toEqual(expect.arrayContaining(["/newproduct", "/editproduct", "/receive", "/issue", "/transfer", "/newwarehouse"]));
    expect(managerNames).not.toContain("/deleteproduct");
    expect(managerNames).not.toContain("/adjust");
    expect(managerNames).not.toContain("/product");
    const adminNames = await names(T.A.admin);
    expect(adminNames).toEqual(expect.arrayContaining(["/deleteproduct", "/adjust"]));
    const nobody = await seedMember(h.db, T.companyA, "manager");
    expect(await names(nobody)).toEqual([]);
  });
});

describe("reading", () => {
  it("/products returns a structured, paged table with row actions limited to the member's access", async () => {
    const manager = await newManager();
    const table = kind(await partsOf(manager, { command: "products", step: "start", args: { q: "bolt" } }), "record_table");
    expect(table.rows[0].cells.sku).toBe("BOLT-1");
    expect(table.rows[0].actions?.map((a) => a.label)).toEqual(["Open", "Edit"]);
    expect(table.paging).toMatchObject({ page: 1, command: "products" });
    const asViewer = kind(await partsOf(viewer, { command: "products", step: "start", args: {} }), "record_table");
    expect(asViewer.rows[0].actions?.map((a) => a.label)).toEqual(["Open"]);
  });

  it("opens a product card and other lists", async () => {
    const card = kind(await partsOf(viewer, { command: "product", step: "start", args: { productId: A.bolt } }), "record_card");
    expect(card.subtitle).toBe("BOLT-1");
    for (const command of ["categories", "warehouses", "stock", "movements"]) {
      expect(kind(await partsOf(viewer, { command, step: "start", args: {} }), "record_table").type).toBe("record_table");
    }
  });

  it("does not leak another company's records through ids supplied by the client", async () => {
    expect(await code(step(viewer, { command: "product", step: "start", args: { productId: foreignProduct } }))).toBe("NOT_FOUND");
    const stock = kind(await partsOf(viewer, { command: "stock", step: "start", args: { productId: foreignProduct } }), "record_table");
    expect(stock.rows).toHaveLength(0);
  });
});

describe("guided edit", () => {
  it("pick, edit, review the diff, confirm; the module's version rule protects against stale forms", async () => {
    const manager = await newManager();
    // Starting the command now offers the choice; the manual path is unchanged behind the "manual" step.
    expect(kind(await partsOf(manager, { command: "editproduct", step: "start", args: { q: "bolt" } }), "entry_choice")).toMatchObject({ command: "editproduct" });
    const picker = kind(await partsOf(manager, { command: "editproduct", step: "manual", args: { q: "bolt" } }), "record_table");
    expect(picker.rows[0].actions).toEqual([{ label: "Select", command: "editproduct", args: { productId: A.bolt }, step: "select" }]);

    const formPart = kind(await partsOf(manager, { command: "editproduct", step: "select", args: { productId: A.bolt } }), "form");
    expect(formPart.fields.find((f) => f.name === "name")?.value).toBe("Steel bolt");
    const ctx = formPart.context;

    const review = kind(await partsOf(manager, { command: "editproduct", step: "submit", args: ctx, values: { name: "Steel bolt M8", sku: "BOLT-1", categoryId: "", unitOfMeasure: "unit", cost: "2.000", salePrice: "3.500", reorderPoint: "5.000", isStorable: true, description: "" } }), "confirmation");
    expect(review.details).toEqual([
      { label: "Name", before: "Steel bolt", after: "Steel bolt M8" },
      { label: "Sale price", before: "3.000 TND", after: "3.500 TND" },
    ]);
    expect((await getProduct(wsOf(h, T.A.owner), A.bolt)).name).toBe("Steel bolt"); // nothing changed yet
    await confirmAction(wsOf(h, manager), aiToolRegistry, { actionId: review.actionId });
    expect(await getProduct(wsOf(h, T.A.owner), A.bolt)).toMatchObject({ name: "Steel bolt M8", salePrice: "3.500" });

    // The form above is now stale: submitting it again must not overwrite the newer version.
    expect(await code(step(manager, { command: "editproduct", step: "submit", args: ctx, values: { name: "Old", sku: "BOLT-1", categoryId: "", unitOfMeasure: "unit", cost: "2.000", salePrice: "3.500", reorderPoint: "5", isStorable: true, description: "" } }))).toBe("CONFLICT");
    expect((await getProduct(wsOf(h, T.A.owner), A.bolt)).name).toBe("Steel bolt M8");
  });

  it("rejects invalid form values with the module's validation, before any proposal exists", async () => {
    const manager = await newManager();
    const formPart = kind(await partsOf(manager, { command: "editproduct", step: "select", args: { productId: A.bolt } }), "form");
    const submit = (values: object) => code(step(manager, { command: "editproduct", step: "submit", args: formPart.context, values }));
    const base = { name: "X", sku: "BOLT-1", categoryId: "", unitOfMeasure: "unit", cost: "2", salePrice: "3", reorderPoint: "5", isStorable: true, description: "" };
    expect(await submit({ ...base, salePrice: "-1" })).toBe("VALIDATION_ERROR");
    expect(await submit({ ...base, reorderPoint: "1.5" })).toBe("VALIDATION_ERROR");
    expect(await submit({ ...base, sku: "no spaces allowed" })).toBe("VALIDATION_ERROR");
    expect(await submit({ ...base, companyId: T.companyB.toHexString() })).toBe("VALIDATION_ERROR");
    expect(await h.db.collection("ai_pending_actions").countDocuments({ userId: manager.userId })).toBe(0);
  });
});

describe("guided create", () => {
  it("/newproduct builds a form with the company's categories, then a confirmation", async () => {
    const manager = await newManager();
    expect(kind(await partsOf(manager, { command: "newproduct", step: "start", args: {} }), "entry_choice")).toMatchObject({ command: "newproduct" });
    const formPart = kind(await partsOf(manager, { command: "newproduct", step: "manual", args: {} }), "form");
    expect(formPart.fields.map((f) => f.name)).toEqual(expect.arrayContaining(["sku", "name", "unitOfMeasure", "categoryId", "cost", "salePrice", "reorderPoint", "isStorable"]));
    const review = kind(await partsOf(manager, { command: "newproduct", step: "submit", args: {}, values: { sku: "gasket-1", name: "Gasket", unitOfMeasure: "unit", categoryId: "", cost: "1.5", salePrice: "2", reorderPoint: "10", isStorable: true, description: "" } }), "confirmation");
    expect(review.summary).toBe('Create product "Gasket" (GASKET-1).');
    expect(review.requiresTyped).toBe(false);
  });
});

describe("guided stock and delete flows", () => {
  it("/receive: table, then a form listing warehouses with live on-hand, then confirm and post", async () => {
    const manager = await newManager();
    const formPart = kind(await partsOf(manager, { command: "receive", step: "select", args: { productId: A.bolt } }), "form");
    const warehouse = formPart.fields.find((f) => f.name === "warehouseId")!;
    expect(warehouse.options?.map((o) => o.label)).toEqual(["MAIN · Main Store (40.000 on hand)", "SEC · Second Store (0 on hand)"]);
    const review = kind(await partsOf(manager, { command: "receive", step: "submit", args: formPart.context, values: { warehouseId: A.second, quantity: "6", reason: "" } }), "confirmation");
    expect(review.details[0]).toEqual({ label: "On hand (SEC)", before: "0.000", after: "6.000" });
    await confirmAction(wsOf(h, manager), aiToolRegistry, { actionId: review.actionId });
    expect(await onHand(A.bolt, A.second)).toBe("6");
  });

  it("/adjust is unavailable to a manager, including through hand-crafted requests, and typed for an admin", async () => {
    const manager = await newManager();
    for (const stepName of ["start", "select"] as const) {
      expect(await code(step(manager, { command: "adjust", step: stepName, args: { productId: A.bolt } }))).toBe("FORBIDDEN");
    }
    expect(await code(step(manager, { command: "adjust", step: "submit", args: { productId: A.bolt }, values: { warehouseId: A.main, delta: "-1", reason: "x" } }))).toBe("FORBIDDEN");
    expect(await onHand(A.bolt, A.main)).toBe("40");

    const formPart = kind(await partsOf(T.A.admin, { command: "adjust", step: "select", args: { productId: A.bolt } }), "form");
    const review = kind(await partsOf(T.A.admin, { command: "adjust", step: "submit", args: formPart.context, values: { warehouseId: A.main, delta: "-4", reason: "Cycle count" } }), "confirmation");
    expect(review).toMatchObject({ risk: "financial", requiresTyped: true, typedPhrase: "BOLT-1" });
    expect(await code(confirmAction(wsOf(h, T.A.admin), aiToolRegistry, { actionId: review.actionId, typedConfirmation: "nope" }))).toBe("VALIDATION_ERROR");
    await confirmAction(wsOf(h, T.A.admin), aiToolRegistry, { actionId: review.actionId, typedConfirmation: "BOLT-1" });
    expect(await onHand(A.bolt, A.main)).toBe("36");
  });

  it("/deleteproduct goes straight to a typed confirmation; a referenced product is refused with advice", async () => {
    const spare = await createProduct(wsOf(h, T.A.owner), parsed(productInputSchema, { sku: "SPARE-9", name: "Spare", description: "", categoryId: "", unitOfMeasure: "unit", isStorable: true, isActive: true, cost: "1", salePrice: "1", reorderPoint: "0" }));
    const review = kind(await partsOf(T.A.admin, { command: "deleteproduct", step: "select", args: { productId: spare.id } }), "confirmation");
    expect(review).toMatchObject({ risk: "destructive", requiresTyped: true, typedPhrase: "SPARE-9" });
    expect(await code(step(T.A.admin, { command: "deleteproduct", step: "select", args: { productId: A.bolt } }))).toBe("CONFLICT");
    const manager = await newManager();
    expect(await code(step(manager, { command: "deleteproduct", step: "start", args: {} }))).toBe("FORBIDDEN");
  });
});

describe("what the client sends is never trusted", () => {
  it("rejects unknown commands, steps that do not exist, malformed ids and oversized or extra input", async () => {
    const manager = await newManager();
    expect(await code(step(manager, { command: "dropdatabase", step: "start" }))).toBe("FORBIDDEN");
    expect(await code(step(manager, { command: "products", step: "select", args: { productId: A.bolt } }))).toBe("NOT_FOUND");
    expect(await code(step(manager, { command: "product", step: "start", args: { productId: "xyz" } }))).toBe("VALIDATION_ERROR");
    expect(await code(step(manager, { command: "Products", step: "start" }))).toBe("VALIDATION_ERROR");
    expect(await code(step(manager, { command: "products", step: "start", extra: 1 }))).toBe("VALIDATION_ERROR");
    expect(await code(step(manager, { command: "products", step: "start", args: { q: "x".repeat(500) } }))).toBe("VALIDATION_ERROR");
  });

  it("another company's record ids fail with NOT_FOUND at every step", async () => {
    const manager = await newManager();
    expect(await code(step(manager, { command: "editproduct", step: "select", args: { productId: foreignProduct } }))).toBe("NOT_FOUND");
    expect(await code(step(manager, { command: "receive", step: "select", args: { productId: foreignProduct } }))).toBe("NOT_FOUND");
    expect(await code(step(manager, { command: "receive", step: "submit", args: { productId: foreignProduct }, values: { warehouseId: A.main, quantity: "1" } }))).toBe("NOT_FOUND");
    expect(await code(step(T.A.admin, { command: "deleteproduct", step: "select", args: { productId: foreignProduct } }))).toBe("NOT_FOUND");
  });

  it("a revocation in the middle of a flow ends it at the next step", async () => {
    const manager = await newManager();
    const formPart = kind(await partsOf(manager, { command: "receive", step: "select", args: { productId: A.bolt } }), "form");
    const current = await h.db.collection("ai_access_grants").findOne({ userId: manager.userId });
    await saveMemberGrant(actorOf(h, T.A.owner), manager.userId.toHexString(), grant({ inventory: g(true, true, false, false, false) }), current!.version);
    expect(await code(step(manager, { command: "receive", step: "submit", args: formPart.context, values: { warehouseId: A.main, quantity: "1" } }))).toBe("FORBIDDEN");
    expect(await onHand(A.bolt, A.main)).toBe("36");
  });

  it("a member with AI switched off cannot run any step", async () => {
    const nobody = await seedMember(h.db, T.companyA, "manager");
    expect(await code(step(nobody, { command: "products", step: "start" }))).toBe("FORBIDDEN");
  });
});

describe("history", () => {
  it("records guided steps in the member's own conversation only", async () => {
    const manager = await newManager();
    const id = (await createConversation(actorOf(h, manager), "inventory work")).toHexString();
    await step(manager, { command: "products", step: "start", args: {}, conversationId: id, label: "Browse products" });
    const convo = await getConversation(actorOf(h, manager), id);
    expect(convo.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(convo.messages[1].parts.some((p) => p.type === "record_table")).toBe(true);
    expect(await code(step(T.A.owner, { command: "products", step: "start", args: {}, conversationId: id }))).toBe("NOT_FOUND");
    expect(await code(step(T.B.owner, { command: "products", step: "start", args: {}, conversationId: id }))).toBe("NOT_FOUND");
  });
});

describe("chat: slash commands and natural language", () => {
  async function drain(gen: AsyncGenerator<TurnEvent>) {
    const out: TurnEvent[] = [];
    for await (const e of gen) out.push(e);
    return out;
  }
  const scripted = (...replies: string[]) => {
    let i = 0;
    const calls = vi.fn();
    const complete: CompleteFn = async (options) => {
      calls(options);
      return { text: replies[Math.min(i++, replies.length - 1)], provider: "Groq", model: "test", usage: { totalTokens: 40 } };
    };
    return { complete, calls };
  };
  const partsFrom = (events: TurnEvent[]) => events.filter((e): e is Extract<TurnEvent, { type: "part" }> => e.type === "part").map((e) => e.part);

  it("a typed slash command renders a table without calling the model", async () => {
    const manager = await newManager();
    const { complete, calls } = scripted("unused");
    const events = await drain(runTurn(wsOf(h, manager), { text: "/products bolt" }, { complete }));
    expect(partsFrom(events).some((p) => p.type === "record_table")).toBe(true);
    expect(calls).not.toHaveBeenCalled();
    const help = await drain(runTurn(wsOf(h, manager), { text: "/help" }, { complete }));
    const text = help.filter((e) => e.type === "text").map((e) => (e as { text: string }).text).join("");
    expect(text).toContain("/newproduct");
    expect(text).not.toContain("/adjust");
  });

  it("natural language: the model finds a product by search, then the edit lands in an editable draft; nothing is saved", async () => {
    const manager = await newManager();
    const { complete, calls } = scripted(
      JSON.stringify({ type: "tool", tool: "inventory_list_products", args: { q: "bolt" } }),
      JSON.stringify({ type: "tool", tool: "inventory_update_product", args: { productId: A.bolt, salePrice: 9 } })
    );
    const before = (await getProduct(wsOf(h, T.A.owner), A.bolt)).salePrice;
    const events = await drain(runTurn(wsOf(h, manager), { text: "set the bolt price to 9" }, { complete }));
    const secondPrompt = calls.mock.calls[1][0].messages.map((m: { content: string }) => m.content).join("\n");
    expect(secondPrompt).toContain(A.bolt);
    const draft = partsFrom(events).find((p) => p.type === "form");
    expect(draft && draft.type === "form" && draft.draft).toMatchObject({ targetId: A.bolt, changed: ["salePrice"] });
    expect(draft && draft.type === "form" && draft.draft?.provenance.salePrice).toBe("you"); // "9" is in the person's own words
    expect(partsFrom(events).some((p) => p.type === "confirmation")).toBe(false);
    expect((await getProduct(wsOf(h, T.A.owner), A.bolt)).salePrice).toBe(before);
  });

  it("the model is only told about tools the member can use", async () => {
    const { complete, calls } = scripted(JSON.stringify({ type: "final", text: "ok" }));
    await drain(runTurn(wsOf(h, viewer), { text: "hello" }, { complete }));
    const prompt = calls.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain("inventory_list_products");
    expect(prompt).not.toMatch(/inventory_(create|update|delete|receive|issue|transfer|adjust|set)_/);
  });

  it("a model that tries a tool outside the member's access is refused and nothing changes", async () => {
    const { complete } = scripted(
      JSON.stringify({ type: "tool", tool: "inventory_adjust_stock", args: { productId: A.bolt, warehouseId: A.main, delta: -30, reason: "model decided" } }),
      JSON.stringify({ type: "final", text: "I cannot do that." })
    );
    const manager = await newManager();
    const events = await drain(runTurn(wsOf(h, manager), { text: "zero the stock" }, { complete }));
    expect(events.some((e) => e.type === "part" && e.part.type === "confirmation")).toBe(false);
    expect(await onHand(A.bolt, A.main)).toBe("36");
    expect(await h.db.collection("ai_pending_actions").countDocuments({ userId: manager.userId })).toBe(0);
  });
});

void ObjectId;
