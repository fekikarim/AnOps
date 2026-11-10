import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { createHarness, parsed, type TestHarness } from "../helpers/workspace";
import { actorOf, seedMember, seedTenants, wsOf, type SeededMember } from "../helpers/ai";
import { code } from "../helpers/ai-flow";
import { resolveAiAccess, saveMemberGrant, updateAiSettings } from "@/server/ai/access/access.service";
import { runCommandStep } from "@/server/ai/command-runner";
import { createCommandRegistry } from "@/server/ai/commands";
import { createConversation, deleteConversation, getConversation } from "@/server/ai/conversation.service";
import { authorizeAiUse, gatedComplete } from "@/server/ai/gate";
import { runTurn, type CompleteFn, type TurnEvent } from "@/server/ai/orchestrator";
import { SENSITIVE_PLACEHOLDER } from "@/server/ai/platform";
import { confirmAction, proposeAction } from "@/server/ai/pending-actions.service";
import { aiToolRegistry } from "@/server/ai/tools";
import { defineTool } from "@/server/ai/tools/define-tool";
import { createToolRegistry } from "@/server/ai/tools/registry";
import { getCompanyUsageSummary, getMyUsageToday } from "@/server/ai/usage.service";
import { createBlogPostSchema } from "@/features/community/schemas/community.schema";
import { countBlogPosts, createBlogPost, getBlogPosts } from "@/server/services/community.service";
import { COLLECTIONS } from "@/server/db/documents";
import { consumeSharedRateLimit } from "@/server/security/shared-rate-limit";
import { PERMISSIONS } from "@/server/security/permissions";
import type { AiCompletionOptions } from "@/server/ai/types";
import type { AiModules } from "@/shared/domain/ai";

let h: TestHarness;
let T: Awaited<ReturnType<typeof seedTenants>>;
const g = (view: boolean, create: boolean, edit: boolean, del = false, approve = false) => ({ view, create, edit, delete: del, approve });
const grant = (modules: AiModules, cap: number | null = null, sensitive = false) => ({ enabled: true, modules, canAuditTranscripts: false, canViewSensitiveHr: sensitive, dailyTokenCap: cap });
const owner = () => actorOf(h, T.A.owner);

async function member(role: "manager" | "employee" | "admin", modules: AiModules, cap: number | null = null, sensitive = false, company = T.companyA): Promise<SeededMember> {
  const m = await seedMember(h.db, company, role);
  await saveMemberGrant(actorOf(h, company.equals(T.companyA) ? T.A.owner : T.B.owner), m.userId.toHexString(), grant(modules, cap, sensitive), 0);
  return m;
}
const fake = (tokens = 100, delayMs = 0) => {
  const calls = vi.fn();
  const complete = async (o: AiCompletionOptions) => {
    calls(o);
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    return { text: "ok", provider: "fake", model: "m1", usage: { totalTokens: tokens } };
  };
  return { complete, calls };
};
const spec = { module: "community" as const, operation: "create" as const, feature: "test" };
const msg = (n = 40): AiCompletionOptions => ({ messages: [{ role: "user", content: "x".repeat(n) }], maxTokens: 400 });

async function drain(gen: AsyncGenerator<TurnEvent>) {
  const out: TurnEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}
const errorOf = (events: TurnEvent[]) => events.find((e): e is Extract<TurnEvent, { type: "error" }> => e.type === "error");
const scripted = (...replies: string[]) => {
  let i = 0;
  const calls = vi.fn();
  const complete: CompleteFn = async (o) => {
    calls(o);
    return { text: replies[Math.min(i++, replies.length - 1)], provider: "fake", model: "m1", usage: { totalTokens: 50 } };
  };
  return { complete, calls };
};

beforeAll(async () => {
  h = await createHarness();
  T = await seedTenants(h);
  for (const o of [T.A.owner, T.B.owner]) await updateAiSettings(actorOf(h, o), { enabled: true, retentionDays: 90, dailyTokenBudget: 0, defaultUserDailyTokenCap: 0 }, 0);
});
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  await h.cleanup();
});

describe("the AI gate in front of every legacy model call", () => {
  it("refuses, without calling the model, anyone who has no AI access, the wrong module, or no live membership", async () => {
    const { complete, calls } = fake();
    const none = await seedMember(h.db, T.companyA, "manager"); // no grant at all
    const wrongModule = await member("manager", { inventory: g(true, true, true) });
    const viewOnly = await member("manager", { community: g(true, false, false) });
    const removed = await member("manager", { community: g(true, true, true) });
    await h.db.collection(COLLECTIONS.companyMembers).updateOne({ userId: removed.userId }, { $set: { status: "removed" } });
    for (const m of [none, wrongModule, viewOnly, removed]) expect(await code(gatedComplete(wsOf(h, m), spec, msg(), { complete }))).toBe("FORBIDDEN");
    expect(calls).not.toHaveBeenCalled();
    const ok = await member("manager", { community: g(true, true, true) });
    expect(await code(gatedComplete(wsOf(h, ok), spec, msg(), { complete }))).toBe("OK");
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it("is isolated by company: a grant in company A gives nothing in company B", async () => {
    const { complete, calls } = fake();
    const inA = await member("manager", { community: g(true, true, true) });
    const sameUserInB = { ...wsOf(h, inA), companyId: T.companyB };
    expect(await code(gatedComplete(sameUserInB, spec, msg(), { complete }))).toBe("FORBIDDEN");
    expect(calls).not.toHaveBeenCalled();
  });

  it("requires the sensitive-HR switch when salary data is involved", async () => {
    const hrSpec = { module: "hr" as const, operation: "view" as const, feature: "hr.test", sensitiveHr: true };
    const without = await member("admin", { hr: g(true, false, false) });
    const withSwitch = await member("admin", { hr: g(true, false, false) }, null, true);
    expect(await code(authorizeAiUse(wsOf(h, without), hrSpec, { requireProvider: false }))).toBe("FORBIDDEN");
    expect(await code(authorizeAiUse(wsOf(h, withSwitch), hrSpec, { requireProvider: false }))).toBe("OK");
  });

  it("the platform kill switch blocks every path at once and lifts the moment it is turned off", async () => {
    const m = await member("manager", { community: g(true, true, true) });
    const { complete, calls } = fake();
    const turnModel = scripted(JSON.stringify({ type: "final", text: "hi" }));
    vi.stubEnv("AI_KILL_SWITCH", "true");
    expect(await code(gatedComplete(wsOf(h, m), spec, msg(), { complete }))).toBe("FORBIDDEN");
    expect(errorOf(await drain(runTurn(wsOf(h, m), { text: "hello" }, { complete: turnModel.complete })))?.code).toBe("FORBIDDEN");
    expect(errorOf(await drain(runTurn(wsOf(h, m), { text: "/help" })))?.code).toBe("FORBIDDEN");
    expect(await code(runCommandStep(wsOf(h, m), { command: "posts", step: "start", args: {} }))).toBe("FORBIDDEN");
    const pendingAccess = await resolveAiAccess(actorOf(h, m));
    expect(pendingAccess.state).toBe("platform_disabled");
    expect(calls).not.toHaveBeenCalled();
    expect(turnModel.calls).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
    expect((await resolveAiAccess(actorOf(h, m))).state).toBe("ready");
    expect(await code(gatedComplete(wsOf(h, m), spec, msg(), { complete }))).toBe("OK");
  });

  it("a confirmation during the kill switch does not execute", async () => {
    const m = await member("manager", { community: g(true, true, true) });
    const ws = wsOf(h, m);
    const p = await proposeAction(ws, await resolveAiAccess(actorOf(h, m)), aiToolRegistry, { toolName: "community_create_post", rawArgs: { title: "Kill switch draft", body: "A body that is long enough." }, conversationId: null });
    vi.stubEnv("AI_KILL_SWITCH", "1");
    expect(await code(confirmAction(ws, aiToolRegistry, { actionId: p.id }))).toBe("FORBIDDEN");
    vi.unstubAllEnvs();
    expect(await h.db.collection("blog_posts").countDocuments({ title: "Kill switch draft" })).toBe(0);
  });
});

describe("budgets and limits under concurrency", () => {
  it("parallel calls cannot overshoot a member's daily cap, and measured usage replaces the estimate", async () => {
    const m = await member("manager", { community: g(true, true, true) }, 1000);
    const { complete, calls } = fake(100, 150); // slow, so every request reserves before any of them settles
    const big = { messages: [{ role: "user" as const, content: "x".repeat(40) }], maxTokens: 900 }; // reserves ~910 of the 1000
    const results = await Promise.all(Array.from({ length: 6 }, () => code(gatedComplete(wsOf(h, m), spec, big, { complete }))));
    expect(results.filter((r) => r === "OK")).toHaveLength(1);
    expect(results.filter((r) => r === "RATE_LIMITED")).toHaveLength(5);
    expect(calls).toHaveBeenCalledTimes(1);
    expect((await getMyUsageToday(actorOf(h, m))).tokens).toBe(100); // the measured 100, not the 910 estimate
  });

  it("the company budget is shared by its members and never by another company", async () => {
    await updateAiSettings(actorOf(h, T.B.owner), { enabled: true, retentionDays: 90, dailyTokenBudget: 900, defaultUserDailyTokenCap: 0 }, 1);
    const a = await member("manager", { community: g(true, true, true) }, null, false, T.companyB);
    const b = await member("manager", { community: g(true, true, true) }, null, false, T.companyB);
    const { complete } = fake(10, 150);
    const results = await Promise.all([a, b, a, b, a].map((m) => code(gatedComplete(wsOf(h, m), spec, msg(), { complete }))));
    expect(results.filter((r) => r === "OK")).toHaveLength(2); // 900 / ~410 per reservation, across both members together
    const outsider = await member("manager", { community: g(true, true, true) });
    expect(await code(gatedComplete(wsOf(h, outsider), spec, msg(), { complete }))).toBe("OK"); // company A has no limit
  });

  it("an optional spending cap (in the price currency) limits the company the same way", async () => {
    vi.stubEnv("AI_PRICE_PER_1K_TOKENS", "1");
    vi.stubEnv("AI_COMPANY_DAILY_COST_LIMIT", "0.01"); // = 10 tokens
    const m = await member("manager", { community: g(true, true, true) });
    const { complete, calls } = fake(5);
    expect(await code(gatedComplete(wsOf(h, m), spec, msg(), { complete }))).toBe("RATE_LIMITED");
    expect(calls).not.toHaveBeenCalled();
  });

  it("the shared limiter is atomic: parallel requests take exactly the slots there are, per key and per company", async () => {
    const key = `test:${new ObjectId().toHexString()}`;
    const results = await Promise.all(Array.from({ length: 12 }, () => code(consumeSharedRateLimit(h.db, key, 3, 60_000))));
    expect(results.filter((r) => r === "OK")).toHaveLength(3);
    expect(results.filter((r) => r === "RATE_LIMITED")).toHaveLength(9);
    expect(await code(consumeSharedRateLimit(h.db, `${key}:other`, 3, 60_000))).toBe("OK");
    expect(await h.db.collection(COLLECTIONS.rateLimits).countDocuments({ key })).toBe(1);
  });

  it("chat turns are limited per person without affecting a colleague", async () => {
    const busy = await member("manager", { community: g(true, true, true) });
    const calm = await member("manager", { community: g(true, true, true) });
    const outcomes: string[] = [];
    for (let i = 0; i < 24; i++) outcomes.push(errorOf(await drain(runTurn(wsOf(h, busy), { text: "/help" })))?.code ?? "ok");
    expect(outcomes.filter((o) => o === "RATE_LIMITED").length).toBeGreaterThanOrEqual(3);
    expect(errorOf(await drain(runTurn(wsOf(h, calm), { text: "/help" })))).toBeUndefined();
  });

  it("measured usage is recorded per provider and model, cost appears only with a configured price, and rows carry a TTL", async () => {
    const m = await member("manager", { community: g(true, true, true) });
    const { complete } = fake(120);
    await gatedComplete(wsOf(h, m), spec, msg(), { complete });
    const admin = await seedMember(h.db, T.companyA, "admin");
    const summary = await getCompanyUsageSummary({ ...actorOf(h, admin), userId: T.A.owner.userId }, 0);
    expect(summary.byModel.find((r) => r.provider === "fake" && r.model === "m1")?.tokens).toBeGreaterThanOrEqual(120);
    expect(summary.priced).toBe(false);
    expect(summary.today.estimatedCost).toBeNull();
    vi.stubEnv("AI_PRICE_PER_1K_TOKENS", "2");
    vi.stubEnv("AI_PRICE_CURRENCY", "eur");
    const priced = await getCompanyUsageSummary({ ...actorOf(h, admin), userId: T.A.owner.userId }, 0);
    expect(priced.priced).toBe(true);
    expect(priced.today.estimatedCost).toEqual({ amount: Math.round((priced.today.tokens / 1000) * 2 * 10_000) / 10_000, currency: "EUR" });
    const row = await h.db.collection(COLLECTIONS.aiUsage).findOne({ companyId: T.companyA, userId: m.userId });
    expect(row?.expiresAt).toBeInstanceOf(Date);
  });

  it("a cancelled stream stops before any provider call", async () => {
    const m = await member("manager", { community: g(true, true, true) });
    const { complete, calls } = scripted(JSON.stringify({ type: "final", text: "hi" }));
    const controller = new AbortController();
    controller.abort();
    await drain(runTurn(wsOf(h, m), { text: "hello there" }, { complete, signal: controller.signal }));
    expect(calls).not.toHaveBeenCalled();
  });
});

describe("pending actions follow their conversation, their company switch and their cap", () => {
  const propose = async (m: SeededMember, conversationId: ObjectId | null, title: string) =>
    proposeAction(wsOf(h, m), await resolveAiAccess(actorOf(h, m)), aiToolRegistry, { toolName: "community_create_post", rawArgs: { title, body: "A body that is long enough." }, conversationId });

  it("deleting a conversation cancels its open proposals, and only its own", async () => {
    const m = await member("manager", { community: g(true, true, true) });
    const stranger = await member("manager", { community: g(true, true, true) });
    const c1 = await createConversation(wsOf(h, m), "first");
    const c2 = await createConversation(wsOf(h, m), "second");
    const cs = await createConversation(wsOf(h, stranger), "theirs");
    const p1 = await propose(m, c1, "Del one");
    const p2 = await propose(m, c2, "Del two");
    const ps = await propose(stranger, cs, "Del stranger");
    expect(await code(deleteConversation(wsOf(h, stranger), c1.toHexString()))).toBe("NOT_FOUND"); // not theirs: nothing happens
    expect(await h.db.collection(COLLECTIONS.aiPendingActions).countDocuments({ _id: new ObjectId(p1.id), status: "pending" })).toBe(1);
    await deleteConversation(wsOf(h, m), c1.toHexString());
    expect(await code(getConversation(wsOf(h, m), c1.toHexString()))).toBe("NOT_FOUND");
    expect(await code(confirmAction(wsOf(h, m), aiToolRegistry, { actionId: p1.id }))).toBe("CONFLICT");
    expect((await h.db.collection(COLLECTIONS.aiPendingActions).findOne({ _id: new ObjectId(p1.id) }))?.statusReason).toBe("conversation_deleted");
    expect(await h.db.collection("blog_posts").countDocuments({ title: "Del one" })).toBe(0);
    expect(await code(confirmAction(wsOf(h, m), aiToolRegistry, { actionId: p2.id }))).toBe("OK"); // another conversation: untouched
    expect(await code(confirmAction(wsOf(h, stranger), aiToolRegistry, { actionId: ps.id }))).toBe("OK");
  });

  it("another member cannot confirm, cancel-by-replay or read a proposal that is not theirs", async () => {
    const m = await member("manager", { community: g(true, true, true) });
    const other = await member("manager", { community: g(true, true, true) });
    const p = await propose(m, null, "Not yours");
    expect(await code(confirmAction(wsOf(h, other), aiToolRegistry, { actionId: p.id }))).toBe("NOT_FOUND");
    expect(await code(confirmAction(wsOf(h, m), aiToolRegistry, { actionId: p.id }))).toBe("OK");
    expect(await code(confirmAction(wsOf(h, m), aiToolRegistry, { actionId: p.id }))).toBe("CONFLICT"); // replay
  });

  it("switching AI off for the company ends every member's open proposals, and switching it back on does not revive them", async () => {
    const a = await member("manager", { community: g(true, true, true) }, null, false, T.companyA);
    const b = await member("manager", { community: g(true, true, true) }, null, false, T.companyA);
    const pa = await propose(a, null, "Off one");
    const pb = await propose(b, null, "Off two");
    const settings = await h.db.collection(COLLECTIONS.aiSettings).findOne({ companyId: T.companyA });
    await updateAiSettings(owner(), { enabled: false, retentionDays: 90, dailyTokenBudget: 0, defaultUserDailyTokenCap: 0 }, settings!.version);
    const reasons = await h.db.collection(COLLECTIONS.aiPendingActions).find({ _id: { $in: [new ObjectId(pa.id), new ObjectId(pb.id)] } }).toArray();
    expect(reasons.map((r) => r.statusReason)).toEqual(["ai_disabled", "ai_disabled"]);
    await updateAiSettings(owner(), { enabled: true, retentionDays: 90, dailyTokenBudget: 0, defaultUserDailyTokenCap: 0 }, settings!.version + 1);
    expect(await code(confirmAction(wsOf(h, a), aiToolRegistry, { actionId: pa.id }))).toBe("CONFLICT");
    expect(await code(confirmAction(wsOf(h, b), aiToolRegistry, { actionId: pb.id }))).toBe("CONFLICT");
    // Another company's proposals are untouched by this company's switch.
    const bOwn = await member("manager", { community: g(true, true, true) }, null, false, T.companyB);
    const pOther = await propose(bOwn, null, "Other company");
    expect(await code(confirmAction(wsOf(h, bOwn), aiToolRegistry, { actionId: pOther.id }))).toBe("OK");
  });

  it("the open-proposal cap holds when proposals are created at the same moment", async () => {
    const m = await member("manager", { community: g(true, true, true) });
    const results = await Promise.all(Array.from({ length: 16 }, (_, i) => code(propose(m, null, `Cap ${i}`))));
    expect(results.filter((r) => r === "OK").length).toBeLessThanOrEqual(10);
    expect(results.filter((r) => r === "RATE_LIMITED").length).toBeGreaterThanOrEqual(6);
    expect(await h.db.collection(COLLECTIONS.aiPendingActions).countDocuments({ userId: m.userId, status: "pending" })).toBeLessThanOrEqual(10);
  });
});

describe("sensitive HR data is shown live but not kept in history", () => {
  const payslipCard = { type: "record_card" as const, title: "Payslip 2026-10", subtitle: "Nour", badges: [], fields: [{ label: "Net", value: "4,213.000 TND" }], actions: [] };
  const peek = defineTool({
    name: "hr_peek_pay",
    module: "hr",
    operation: "view",
    kind: "read",
    risk: "low",
    permission: PERMISSIONS.HR_READ,
    sensitive: "hr",
    description: "Test payslip",
    input: z.object({}).strict(),
    async run() {
      return { summary: "Payslip", parts: [payslipCard], data: { ok: true } };
    },
  });
  const registry = createToolRegistry([peek]);
  const commands = createCommandRegistry([
    { name: "peekpay", description: "t", example: "/peekpay", module: "hr", operation: "view", permission: PERMISSIONS.HR_READ, sensitive: "hr", args: z.record(z.string(), z.unknown()) as never, fromText: () => ({}), start: async () => ({ parts: [payslipCard] }) },
  ]);

  it("a sensitive tool's card reaches the person but history keeps a neutral line", async () => {
    const m = await member("admin", { hr: g(true, false, false) }, null, true);
    const { complete } = scripted(JSON.stringify({ type: "tool", tool: "hr_peek_pay", args: {} }), JSON.stringify({ type: "final", text: "Shown." }));
    const events = await drain(runTurn(wsOf(h, m), { text: "show my payslip" }, { registry, complete }));
    expect(events.some((e) => e.type === "part" && e.part.type === "record_card")).toBe(true);
    const conversationId = events.find((e) => e.type === "conversation")!;
    const stored = await getConversation(wsOf(h, m), (conversationId as { conversationId: string }).conversationId);
    const text = JSON.stringify(stored.messages);
    expect(text).not.toContain("4,213.000");
    expect(text).not.toContain("record_card");
    expect(text).toContain(SENSITIVE_PLACEHOLDER);
  });

  it("the same holds for a sensitive slash command, typed or clicked", async () => {
    const m = await member("admin", { hr: g(true, false, false) }, null, true);
    const events = await drain(runTurn(wsOf(h, m), { text: "/peekpay" }, { registry, commands }));
    expect(events.some((e) => e.type === "part" && e.part.type === "record_card")).toBe(true);
    const id = (events.find((e) => e.type === "conversation") as { conversationId: string }).conversationId;
    expect(JSON.stringify((await getConversation(wsOf(h, m), id)).messages)).not.toContain("4,213.000");
    const clicked = await runCommandStep(wsOf(h, m), { command: "peekpay", step: "start", args: {}, conversationId: id }, { commands });
    expect(JSON.stringify(clicked.parts)).toContain("4,213.000");
    expect(JSON.stringify((await getConversation(wsOf(h, m), id)).messages)).not.toContain("4,213.000");
  });
});

describe("one failing tool does not end the turn", () => {
  const flaky = defineTool({
    name: "inventory_flaky_lookup",
    module: "inventory",
    operation: "view",
    kind: "read",
    risk: "low",
    permission: PERMISSIONS.INVENTORY_READ,
    description: "Test lookup that fails",
    input: z.object({}).strict(),
    async run() {
      throw new (await import("@/shared/lib/errors")).AppError("NOT_FOUND", "That record was not found.");
    },
  });
  it("the model is told what failed, in words, and answers with what it has", async () => {
    const m = await member("manager", { inventory: g(true, false, false) });
    const { complete, calls } = scripted(JSON.stringify({ type: "tool", tool: "inventory_flaky_lookup", args: {} }), JSON.stringify({ type: "final", text: "I could not find it." }));
    const events = await drain(runTurn(wsOf(h, m), { text: "find the thing" }, { registry: createToolRegistry([flaky]), complete }));
    expect(errorOf(events)).toBeUndefined();
    expect(events.some((e) => e.type === "text")).toBe(true);
    expect(JSON.stringify(calls.mock.calls[1])).toContain("That record was not found.");
  });
});

describe("Community lists are indexed and paged in the database", () => {
  it("reads one page with skip and limit and counts separately", async () => {
    const ctx = { ...h.ctx("owner"), companyId: new ObjectId() };
    for (let i = 0; i < 5; i++) await createBlogPost(ctx, parsed(createBlogPostSchema, { title: `Paged ${i}`, body: "A body that is long enough.", status: "draft" }), "Owner");
    expect(await countBlogPosts(ctx)).toBe(5);
    expect(await getBlogPosts(ctx, {}, { skip: 2, limit: 2 })).toHaveLength(2);
    expect(await getBlogPosts(ctx, {}, { skip: 4, limit: 10 })).toHaveLength(1);
  });

  it("the indexes the queries rely on exist", async () => {
    await h.db.collection("blog_posts").createIndex({ x: 1 }).catch(() => undefined); // ensureIndexes ran for the harness database
    const names = async (c: string) => (await h.db.collection(c).indexes()).map((i) => i.name);
    expect(await names("blog_posts")).toContain("blog_company_status_time");
    expect(await names("chat_messages")).toContain("chatmsg_company_conversation_time");
    expect(await names(COLLECTIONS.rateLimits)).toContain("rate_limit_ttl");
    expect(await names(COLLECTIONS.aiUsage)).toContain("ai_usage_ttl");
  });
});
