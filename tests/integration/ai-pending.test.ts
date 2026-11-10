import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { createHarness, type TestHarness } from "../helpers/workspace";
import { actorOf, seedMember, seedTenants, wsOf } from "../helpers/ai";
import { resolveAiAccess, saveMemberGrant, updateAiSettings } from "@/server/ai/access/access.service";
import { cancelPendingAction, confirmAction, listPendingActions, proposeAction } from "@/server/ai/pending-actions.service";
import { defineTool } from "@/server/ai/tools/define-tool";
import { createToolRegistry } from "@/server/ai/tools/registry";
import { COLLECTIONS } from "@/server/db/documents";
import { PERMISSIONS } from "@/server/security/permissions";
import { AppError } from "@/shared/lib/errors";

let h: TestHarness;
let T: Awaited<ReturnType<typeof seedTenants>>;
let failNext = false;

const EFFECTS = "ai_test_effects";

const createThing = defineTool({
  name: "create_thing",
  module: "inventory",
  operation: "create",
  kind: "write",
  risk: "low",
  permission: PERMISSIONS.INVENTORY_PRODUCT_MANAGE,
  description: "test write",
  input: z.object({ name: z.string().min(1).max(40) }).strict(),
  summarize: (a) => `Create thing "${a.name}"`,
  async run(ctx, args) {
    if (failNext) {
      failNext = false;
      throw new AppError("CONFLICT", "duplicate");
    }
    await ctx.db.collection(EFFECTS).insertOne({ companyId: ctx.companyId, by: ctx.userId, name: args.name });
    return { summary: `Created ${args.name}` };
  },
});

const deleteThing = defineTool({
  name: "delete_thing",
  module: "inventory",
  operation: "delete",
  kind: "write",
  risk: "destructive",
  permission: PERMISSIONS.INVENTORY_PRODUCT_MANAGE,
  description: "test destructive write",
  input: z.object({ name: z.string().min(1).max(40) }).strict(),
  summarize: (a) => `Delete thing "${a.name}"`,
  typedPhrase: (a) => a.name,
  async run(ctx, args) {
    await ctx.db.collection(EFFECTS).insertOne({ companyId: ctx.companyId, by: ctx.userId, deleted: args.name });
    return { summary: `Deleted ${args.name}` };
  },
});

const listThings = defineTool({
  name: "list_things",
  module: "inventory",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: PERMISSIONS.INVENTORY_READ,
  description: "test read",
  input: z.object({}).strict(),
  async run() {
    return { summary: "listed" };
  },
});

const registry = createToolRegistry([createThing, deleteThing, listThings]);

const ALL = { view: true, create: true, edit: true, delete: true, approve: false };
const grant = (modules: object, enabled = true) => ({ enabled, modules, canAuditTranscripts: false, canViewSensitiveHr: false, dailyTokenCap: null });

async function effects(filter: object = {}) {
  return h.db.collection(EFFECTS).countDocuments({ companyId: T.companyA, ...filter });
}
async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "OK";
  } catch (e) {
    return (e as { code?: string }).code ?? "UNKNOWN";
  }
}
async function propose(member: Parameters<typeof wsOf>[1], tool: string, args: unknown) {
  const ctx = wsOf(h, member);
  const access = await resolveAiAccess(actorOf(h, member));
  return proposeAction(ctx, access, registry, { toolName: tool, rawArgs: args, conversationId: null });
}
async function freshManager() {
  const m = await seedMember(h.db, T.companyA, "manager");
  await saveMemberGrant(actorOf(h, T.A.owner), m.userId.toHexString(), grant({ inventory: ALL }), 0);
  return m;
}

beforeAll(async () => {
  h = await createHarness();
  T = await seedTenants(h);
  await updateAiSettings(actorOf(h, T.A.owner), { enabled: true, retentionDays: 90, dailyTokenBudget: 0, defaultUserDailyTokenCap: 0 }, 0);
  await updateAiSettings(actorOf(h, T.B.owner), { enabled: true, retentionDays: 90, dailyTokenBudget: 0, defaultUserDailyTokenCap: 0 }, 0);
});
afterAll(async () => {
  await h.cleanup();
});

describe("proposing", () => {
  it("stores a pending action with a server-built summary and never runs the tool", async () => {
    const m = await freshManager();
    const p = await propose(m, "create_thing", { name: "Widget" });
    expect(p.summary).toBe('Create thing "Widget"');
    expect(p.requiresTyped).toBe(false);
    expect(await effects({ name: "Widget" })).toBe(0);
    expect(await listPendingActions(wsOf(h, m))).toHaveLength(1);
  });

  it("rejects model-supplied extras (summary, tenant ids) because inputs are strict", async () => {
    const m = await freshManager();
    expect(await code(propose(m, "create_thing", { name: "x", summary: "Totally safe" }))).toBe("VALIDATION_ERROR");
    expect(await code(propose(m, "create_thing", { name: "x", companyId: T.companyB.toHexString() }))).toBe("VALIDATION_ERROR");
  });

  it("refuses reads, unknown tools, and tools the member has no grant for", async () => {
    const m = await freshManager();
    expect(await code(propose(m, "list_things", {}))).toBe("VALIDATION_ERROR");
    expect(await code(propose(m, "nope_tool", {}))).toBe("NOT_FOUND");
    const none = await seedMember(h.db, T.companyA, "manager");
    expect(await code(propose(none, "create_thing", { name: "x" }))).toBe("FORBIDDEN");
    const viewer = await seedMember(h.db, T.companyA, "employee");
    await saveMemberGrant(actorOf(h, T.A.owner), viewer.userId.toHexString(), grant({ inventory: { view: true, create: false, edit: false, delete: false, approve: false } }), 0);
    expect(await code(propose(viewer, "create_thing", { name: "x" }))).toBe("FORBIDDEN");
  });

  it("caps the number of open proposals per member", async () => {
    const m = await freshManager();
    for (let i = 0; i < 10; i++) await propose(m, "create_thing", { name: `n${i}` });
    expect(await code(propose(m, "create_thing", { name: "one-too-many" }))).toBe("RATE_LIMITED");
  });
});

describe("confirming", () => {
  it("runs the service once, with the live member, and audits it as AI-assisted", async () => {
    const m = await freshManager();
    const p = await propose(m, "create_thing", { name: "Gadget" });
    const result = await confirmAction(wsOf(h, m), registry, { actionId: p.id });
    expect(result.summary).toBe("Created Gadget");
    expect(await effects({ name: "Gadget", by: m.userId })).toBe(1);
    const audit = await h.db.collection(COLLECTIONS.auditEvents).findOne({ entityId: p.id, action: "ai.action.executed" });
    expect(audit?.metadata).toMatchObject({ source: "ai", tool: "create_thing" });
  });

  it("is exactly-once: a second confirm conflicts, and 10 parallel confirms produce one effect", async () => {
    const m = await freshManager();
    const p = await propose(m, "create_thing", { name: "Once" });
    const results = await Promise.all(Array.from({ length: 10 }, () => code(confirmAction(wsOf(h, m), registry, { actionId: p.id }))));
    expect(results.filter((r) => r === "OK")).toHaveLength(1);
    expect(results.filter((r) => r === "CONFLICT")).toHaveLength(9);
    expect(await effects({ name: "Once" })).toBe(1);
    expect(await code(confirmAction(wsOf(h, m), registry, { actionId: p.id }))).toBe("CONFLICT");
  });

  it("is private: another member of the same company, an owner, or another company gets NOT_FOUND", async () => {
    const m = await freshManager();
    const p = await propose(m, "create_thing", { name: "Mine" });
    expect(await code(confirmAction(wsOf(h, T.A.owner), registry, { actionId: p.id }))).toBe("NOT_FOUND");
    expect(await code(confirmAction(wsOf(h, T.A.admin), registry, { actionId: p.id }))).toBe("NOT_FOUND");
    expect(await code(confirmAction(wsOf(h, T.B.owner), registry, { actionId: p.id }))).toBe("NOT_FOUND");
    expect(await code(cancelPendingAction(wsOf(h, T.A.owner), p.id))).toBe("NOT_FOUND");
    expect(await effects({ name: "Mine" })).toBe(0);
  });

  it("refuses an expired proposal", async () => {
    const m = await freshManager();
    const p = await propose(m, "create_thing", { name: "Late" });
    await h.db.collection(COLLECTIONS.aiPendingActions).updateOne({ _id: new ObjectId(p.id) }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await code(confirmAction(wsOf(h, m), registry, { actionId: p.id }))).toBe("CONFLICT");
    expect(await effects({ name: "Late" })).toBe(0);
  });

  it("destructive writes need the exact typed phrase, and a wrong phrase does not burn the proposal", async () => {
    const m = await freshManager();
    const p = await propose(m, "delete_thing", { name: "Old Stock" });
    expect(p.requiresTyped).toBe(true);
    expect(p.typedPhrase).toBe("Old Stock");
    expect(await code(confirmAction(wsOf(h, m), registry, { actionId: p.id }))).toBe("VALIDATION_ERROR");
    expect(await code(confirmAction(wsOf(h, m), registry, { actionId: p.id, typedConfirmation: "old" }))).toBe("VALIDATION_ERROR");
    expect(await effects({ deleted: "Old Stock" })).toBe(0);
    expect(await code(confirmAction(wsOf(h, m), registry, { actionId: p.id, typedConfirmation: "  old   STOCK " }))).toBe("OK");
    expect(await effects({ deleted: "Old Stock" })).toBe(1);
  });

  it("a failing service marks the proposal failed and it is never retried automatically", async () => {
    const m = await freshManager();
    const p = await propose(m, "create_thing", { name: "Boom" });
    failNext = true;
    expect(await code(confirmAction(wsOf(h, m), registry, { actionId: p.id }))).toBe("CONFLICT");
    const row = await h.db.collection(COLLECTIONS.aiPendingActions).findOne({ _id: new ObjectId(p.id) });
    expect(row?.status).toBe("failed");
    expect(await code(confirmAction(wsOf(h, m), registry, { actionId: p.id }))).toBe("CONFLICT");
    expect(await effects({ name: "Boom" })).toBe(0);
  });

  it("detects arguments changed after the proposal and does not execute", async () => {
    const m = await freshManager();
    const p = await propose(m, "create_thing", { name: "Honest" });
    await h.db.collection(COLLECTIONS.aiPendingActions).updateOne({ _id: new ObjectId(p.id) }, { $set: { "args.name": "Tampered" } });
    expect(await code(confirmAction(wsOf(h, m), registry, { actionId: p.id }))).toBe("CONFLICT");
    expect(await effects({ name: "Tampered" })).toBe(0);
    expect(await effects({ name: "Honest" })).toBe(0);
  });
});

describe("revocation between proposal and confirmation", () => {
  it("lowering the grant cancels the proposal in the same operation", async () => {
    const m = await freshManager();
    const p = await propose(m, "create_thing", { name: "Revoked" });
    const current = await h.db.collection(COLLECTIONS.aiAccessGrants).findOne({ userId: m.userId });
    await saveMemberGrant(actorOf(h, T.A.owner), m.userId.toHexString(), grant({ inventory: { ...ALL, create: false } }), current!.version);
    expect(await code(confirmAction(wsOf(h, m), registry, { actionId: p.id }))).toBe("CONFLICT");
    expect(await effects({ name: "Revoked" })).toBe(0);
  });

  it("turning the member's AI off blocks confirmation", async () => {
    const m = await freshManager();
    const p = await propose(m, "create_thing", { name: "Off" });
    const current = await h.db.collection(COLLECTIONS.aiAccessGrants).findOne({ userId: m.userId });
    await saveMemberGrant(actorOf(h, T.A.owner), m.userId.toHexString(), grant({ inventory: ALL }, false), current!.version);
    expect(await code(confirmAction(wsOf(h, m), registry, { actionId: p.id }))).toBe("CONFLICT");
    expect(await effects({ name: "Off" })).toBe(0);
  });

  it("a role downgrade outside the grant editor still blocks it, and the proposal is cancelled", async () => {
    const m = await freshManager();
    const p = await propose(m, "create_thing", { name: "Downgraded" });
    await h.db.collection(COLLECTIONS.companyMembers).updateOne({ companyId: T.companyA, userId: m.userId }, { $set: { role: "employee" } });
    expect(await code(confirmAction(wsOf(h, m), registry, { actionId: p.id }))).toBe("FORBIDDEN");
    expect(await effects({ name: "Downgraded" })).toBe(0);
    const row = await h.db.collection(COLLECTIONS.aiPendingActions).findOne({ _id: new ObjectId(p.id) });
    expect(row).toMatchObject({ status: "cancelled", statusReason: "access_revoked" });
  });

  it("the company switch turning off blocks confirmation", async () => {
    const m = await freshManager();
    const p = await propose(m, "create_thing", { name: "CompanyOff" });
    await h.db.collection(COLLECTIONS.aiSettings).updateOne({ companyId: T.companyA }, { $set: { enabled: false } });
    expect(await code(confirmAction(wsOf(h, m), registry, { actionId: p.id }))).toBe("FORBIDDEN");
    await h.db.collection(COLLECTIONS.aiSettings).updateOne({ companyId: T.companyA }, { $set: { enabled: true } });
    expect(await effects({ name: "CompanyOff" })).toBe(0);
  });

  it("racing a revocation against a confirmation never leaves an action that ran after the revoke finished", async () => {
    for (let i = 0; i < 5; i++) {
      const m = await freshManager();
      const p = await propose(m, "create_thing", { name: `Race${i}` });
      const current = await h.db.collection(COLLECTIONS.aiAccessGrants).findOne({ userId: m.userId });
      const [confirm] = await Promise.all([
        code(confirmAction(wsOf(h, m), registry, { actionId: p.id })),
        code(saveMemberGrant(actorOf(h, T.A.owner), m.userId.toHexString(), grant({}, false), current!.version)),
      ]);
      const ran = await effects({ name: `Race${i}` });
      expect(ran).toBeLessThanOrEqual(1);
      if (confirm !== "OK") expect(ran).toBe(0);
      // After the dust settles, a second attempt must always be refused.
      expect(await code(confirmAction(wsOf(h, m), registry, { actionId: p.id }))).not.toBe("OK");
    }
  });
});

describe("cancelling", () => {
  it("the owner of a proposal can cancel it once", async () => {
    const m = await freshManager();
    const p = await propose(m, "create_thing", { name: "Nope" });
    await cancelPendingAction(wsOf(h, m), p.id);
    expect(await code(cancelPendingAction(wsOf(h, m), p.id))).toBe("NOT_FOUND");
    expect(await code(confirmAction(wsOf(h, m), registry, { actionId: p.id }))).toBe("CONFLICT");
  });
});
