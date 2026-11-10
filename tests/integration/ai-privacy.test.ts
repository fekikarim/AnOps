import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { createHarness, type TestHarness } from "../helpers/workspace";
import { actorOf, seedMember, seedTenants } from "../helpers/ai";
import { resolveAiAccess, saveMemberGrant, updateAiSettings } from "@/server/ai/access/access.service";
import {
  appendMessages,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  newMessage,
  renameConversation,
} from "@/server/ai/conversation.service";
import { auditListConversations, auditReadConversation, listMyNotices } from "@/server/ai/transcript-audit.service";
import { getCompanyUsageSummary, getMyUsageToday, reserveTokens, settleTokens } from "@/server/ai/usage.service";
import { COLLECTIONS } from "@/server/db/documents";

let h: TestHarness;
let T: Awaited<ReturnType<typeof seedTenants>>;

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "OK";
  } catch (e) {
    return (e as { code?: string }).code ?? "UNKNOWN";
  }
}
const grant = (extra: object = {}) => ({ enabled: true, modules: { inventory: { view: true, create: true, edit: true, delete: false, approve: false } }, canAuditTranscripts: false, canViewSensitiveHr: false, dailyTokenCap: null, ...extra });

beforeAll(async () => {
  h = await createHarness();
  T = await seedTenants(h);
  await updateAiSettings(actorOf(h, T.A.owner), { enabled: true, retentionDays: 90, dailyTokenBudget: 1000, defaultUserDailyTokenCap: 400 }, 0);
  await updateAiSettings(actorOf(h, T.B.owner), { enabled: true, retentionDays: 90, dailyTokenBudget: 0, defaultUserDailyTokenCap: 0 }, 0);
  await saveMemberGrant(actorOf(h, T.A.owner), T.A.manager.userId.toHexString(), grant(), 0);
  await saveMemberGrant(actorOf(h, T.A.owner), T.A.employee.userId.toHexString(), { ...grant(), modules: { inventory: { view: true, create: false, edit: false, delete: false, approve: false } } }, 0);
});
afterAll(async () => {
  await h.cleanup();
});

async function chat(member: typeof T.A.manager, text: string) {
  const ctx = actorOf(h, member);
  const id = await createConversation(ctx, text);
  await appendMessages(ctx, id, [newMessage("user", [{ type: "text", text }]), newMessage("assistant", [{ type: "text", text: `re: ${text}` }])]);
  return id.toHexString();
}

describe("private conversations", () => {
  it("a member sees only their own conversations", async () => {
    const mine = await chat(T.A.manager, "my secret supplier price");
    const theirs = await chat(T.A.employee, "employee question");
    const managerList = await listConversations(actorOf(h, T.A.manager));
    expect(managerList.map((c) => c.id)).toContain(mine);
    expect(managerList.map((c) => c.id)).not.toContain(theirs);
    expect(managerList.find((c) => c.id === mine)?.messageCount).toBe(2);
  });

  it("owners and administrators cannot read, rename or delete another member's conversation", async () => {
    const id = await chat(T.A.manager, "private note");
    for (const other of [T.A.owner, T.A.admin, T.A.employee]) {
      const ctx = actorOf(h, other);
      expect(await code(getConversation(ctx, id))).toBe("NOT_FOUND");
      expect(await code(renameConversation(ctx, id, "hijacked"))).toBe("NOT_FOUND");
      expect(await code(deleteConversation(ctx, id))).toBe("NOT_FOUND");
      expect(await appendMessages(ctx, new ObjectId(id), [newMessage("user", [{ type: "text", text: "x" }])])).toBe(false);
    }
    expect((await getConversation(actorOf(h, T.A.manager), id)).title).toBe("private note");
  });

  it("another company cannot see a conversation even with its id", async () => {
    const id = await chat(T.A.manager, "company A only");
    expect(await code(getConversation(actorOf(h, T.B.owner), id))).toBe("NOT_FOUND");
    expect((await listConversations(actorOf(h, T.B.owner))).map((c) => c.id)).not.toContain(id);
  });

  it("the same user id used inside another company is a different, empty history", async () => {
    await chat(T.A.manager, "in company A");
    const crossed = { ...actorOf(h, T.A.manager), companyId: T.companyB };
    expect(await listConversations(crossed)).toHaveLength(0);
  });

  it("caps messages per conversation", async () => {
    const ctx = actorOf(h, T.A.manager);
    const id = await createConversation(ctx, "long");
    const batch = Array.from({ length: 100 }, () => newMessage("user", [{ type: "text", text: "x" }]));
    expect(await appendMessages(ctx, id, batch)).toBe(true);
    expect(await appendMessages(ctx, id, batch)).toBe(true);
    expect(await appendMessages(ctx, id, [newMessage("user", [{ type: "text", text: "x" }])])).toBe(false);
  });
});

describe("retention", () => {
  it("sets expiresAt from the company policy and re-anchors it when the policy changes", async () => {
    const id = await chat(T.A.manager, "retention check");
    const before = await h.db.collection(COLLECTIONS.aiConversations).findOne({ _id: new ObjectId(id) });
    const days = Math.round((before!.expiresAt.getTime() - before!.updatedAt.getTime()) / 86_400_000);
    expect(days).toBe(90);
    const settings = await h.db.collection(COLLECTIONS.aiSettings).findOne({ companyId: T.companyA });
    await updateAiSettings(actorOf(h, T.A.owner), { enabled: true, retentionDays: 30, dailyTokenBudget: 1000, defaultUserDailyTokenCap: 400 }, settings!.version);
    const after = await h.db.collection(COLLECTIONS.aiConversations).findOne({ _id: new ObjectId(id) });
    expect(Math.round((after!.expiresAt.getTime() - after!.updatedAt.getTime()) / 86_400_000)).toBe(30);
    // The other company's retention is untouched.
    const other = await chat(T.B.employee, "other tenant");
    const otherDoc = await h.db.collection(COLLECTIONS.aiConversations).findOne({ _id: new ObjectId(other) });
    expect(Math.round((otherDoc!.expiresAt.getTime() - otherDoc!.updatedAt.getTime()) / 86_400_000)).toBe(90);
  });

  it("a departed member's conversations remain until retention expiry", async () => {
    const leaver = await seedMember(h.db, T.companyA, "manager");
    await saveMemberGrant(actorOf(h, T.A.owner), leaver.userId.toHexString(), grant(), 0);
    const id = await chat(leaver, "left behind");
    await h.db.collection(COLLECTIONS.companyMembers).deleteOne({ companyId: T.companyA, userId: leaver.userId });
    expect(await h.db.collection(COLLECTIONS.aiConversations).countDocuments({ _id: new ObjectId(id) })).toBe(1);
    expect((await resolveAiAccess(actorOf(h, leaver))).state).toBe("inactive");
  });
});

describe("transcript audit", () => {
  const reason = "Investigating a reported data issue";
  async function giveAudit(who: typeof T.A.owner | typeof T.A.admin) {
    const current = await h.db.collection(COLLECTIONS.aiAccessGrants).findOne({ userId: who.userId });
    await saveMemberGrant(actorOf(h, T.A.owner), who.userId.toHexString(), { ...grant(), canAuditTranscripts: true }, current?.version ?? 0);
  }

  it("is refused for everyone by default, including the owner and administrators", async () => {
    const id = await chat(T.A.manager, "audit target one");
    for (const who of [T.A.owner, T.A.admin, T.A.manager, T.A.employee]) {
      expect(await code(auditListConversations(actorOf(h, who), T.A.manager.userId.toHexString()))).toBe("FORBIDDEN");
      expect(await code(auditReadConversation(actorOf(h, who), T.A.manager.userId.toHexString(), id, reason))).toBe("FORBIDDEN");
    }
  });

  it("once the owner turns it on for themselves, they can read, with a written reason, an audit event and a notice", async () => {
    await giveAudit(T.A.owner);
    const id = await chat(T.A.manager, "audit target two");
    expect(await code(auditReadConversation(actorOf(h, T.A.owner), T.A.manager.userId.toHexString(), id, "x"))).toBe("VALIDATION_ERROR");
    const convo = await auditReadConversation(actorOf(h, T.A.owner), T.A.manager.userId.toHexString(), id, reason);
    expect(convo.messages).toHaveLength(2);
    const event = await h.db.collection(COLLECTIONS.auditEvents).findOne({ action: "ai.transcript.accessed", entityId: id });
    expect(event?.actorUserId.equals(T.A.owner.userId)).toBe(true);
    expect(event?.metadata.reason).toBe(reason);
    const notices = await listMyNotices(actorOf(h, T.A.manager));
    expect(notices.some((n) => n.kind === "transcript_audited" && !n.read)).toBe(true);
    // The auditor's own notice list is untouched.
    expect(await listMyNotices(actorOf(h, T.A.owner))).toHaveLength(0);
  });

  it("is read-only: the auditor's scope has no way to change or delete the conversation", async () => {
    const id = await chat(T.A.manager, "audit target three");
    await auditReadConversation(actorOf(h, T.A.owner), T.A.manager.userId.toHexString(), id, reason);
    expect(await code(deleteConversation(actorOf(h, T.A.owner), id))).toBe("NOT_FOUND");
    expect((await getConversation(actorOf(h, T.A.manager), id)).messages).toHaveLength(2);
  });

  it("an administrator with the switch cannot audit an owner or another administrator, but can audit a manager", async () => {
    await giveAudit(T.A.admin);
    const managerChat = await chat(T.A.manager, "admin may read");
    const ownerChat = await chat(T.A.owner, "owner private");
    const admin2Chat = await chat(T.A.admin2, "admin2 private");
    const admin = actorOf(h, T.A.admin);
    expect(await code(auditReadConversation(admin, T.A.manager.userId.toHexString(), managerChat, reason))).toBe("OK");
    expect(await code(auditReadConversation(admin, T.A.owner.userId.toHexString(), ownerChat, reason))).toBe("FORBIDDEN");
    expect(await code(auditReadConversation(admin, T.A.admin2.userId.toHexString(), admin2Chat, reason))).toBe("FORBIDDEN");
  });

  it("cannot cross companies, and a wrong target for the conversation id finds nothing", async () => {
    const id = await chat(T.A.manager, "audit target four");
    expect(await code(auditReadConversation(actorOf(h, T.B.owner), T.A.manager.userId.toHexString(), id, reason))).toBe("FORBIDDEN");
    await h.db.collection(COLLECTIONS.aiAccessGrants).insertOne({ _id: new ObjectId(), companyId: T.companyB, userId: T.B.owner.userId, enabled: true, modules: {}, canAuditTranscripts: true, canViewSensitiveHr: false, dailyTokenCap: null, version: 1, updatedBy: T.B.owner.userId, updatedAt: new Date() });
    expect(await code(auditReadConversation(actorOf(h, T.B.owner), T.A.manager.userId.toHexString(), id, reason))).toBe("NOT_FOUND");
    expect(await code(auditReadConversation(actorOf(h, T.A.owner), T.A.employee.userId.toHexString(), id, reason))).toBe("NOT_FOUND");
  });

  it("revoking the switch ends audit access immediately", async () => {
    const current = await h.db.collection(COLLECTIONS.aiAccessGrants).findOne({ userId: T.A.admin.userId });
    await saveMemberGrant(actorOf(h, T.A.owner), T.A.admin.userId.toHexString(), { ...grant(), canAuditTranscripts: false }, current!.version);
    expect(await code(auditListConversations(actorOf(h, T.A.admin), T.A.manager.userId.toHexString()))).toBe("FORBIDDEN");
  });
});

describe("usage caps", () => {
  it("enforces the member's daily cap atomically under concurrency", async () => {
    const m = await seedMember(h.db, T.companyA, "manager");
    await saveMemberGrant(actorOf(h, T.A.owner), m.userId.toHexString(), grant({ dailyTokenCap: 300 }), 0);
    const ctx = actorOf(h, m);
    const access = await resolveAiAccess(ctx);
    const results = await Promise.all(Array.from({ length: 6 }, () => code(reserveTokens(ctx, access, 100))));
    expect(results.filter((r) => r === "OK")).toHaveLength(3);
    expect(results.filter((r) => r === "RATE_LIMITED")).toHaveLength(3);
    expect((await getMyUsageToday(ctx)).tokens).toBe(300);
  });

  it("never refuses concurrent first requests of the day that all fit under the cap (row-creation race)", async () => {
    for (let round = 0; round < 3; round++) {
      const m = await seedMember(h.db, T.companyA, "manager");
      await saveMemberGrant(actorOf(h, T.A.owner), m.userId.toHexString(), grant({ dailyTokenCap: 10_000 }), 0);
      const ctx = actorOf(h, m);
      const access = await resolveAiAccess(ctx);
      const results = await Promise.all(Array.from({ length: 10 }, () => code(reserveTokens(ctx, access, 10))));
      expect(results.filter((r) => r !== "OK")).toEqual([]);
      expect((await getMyUsageToday(ctx)).tokens).toBe(100);
    }
  });

  it("settles to the real token count", async () => {
    const m = await seedMember(h.db, T.companyA, "manager");
    await saveMemberGrant(actorOf(h, T.A.owner), m.userId.toHexString(), grant({ dailyTokenCap: 300 }), 0);
    const ctx = actorOf(h, m);
    const r = await reserveTokens(ctx, await resolveAiAccess(ctx), 200);
    await settleTokens(ctx, r, { actualTokens: 80, toolCalls: 1 });
    expect((await getMyUsageToday(ctx)).tokens).toBe(80);
  });

  it("enforces the company budget, returns the member's reservation, and keeps tenants apart", async () => {
    const a = await seedMember(h.db, T.companyA, "manager");
    const b = await seedMember(h.db, T.companyA, "manager");
    await saveMemberGrant(actorOf(h, T.A.owner), a.userId.toHexString(), grant({ dailyTokenCap: 0 }), 0);
    await saveMemberGrant(actorOf(h, T.A.owner), b.userId.toHexString(), grant({ dailyTokenCap: 0 }), 0);
    const usedByOthers = (await h.db.collection(COLLECTIONS.aiUsage).findOne({ companyId: T.companyA, userId: null }))?.tokens ?? 0;
    const room = 1000 - usedByOthers;
    const ca = actorOf(h, a);
    const cb = actorOf(h, b);
    await reserveTokens(ca, await resolveAiAccess(ca), room - 10);
    expect(await code(reserveTokens(cb, await resolveAiAccess(cb), 50))).toBe("RATE_LIMITED");
    expect((await getMyUsageToday(cb)).tokens).toBe(0); // returned
    // Company B has no budget and is unaffected.
    const bo = actorOf(h, T.B.owner);
    expect(await code(reserveTokens(bo, await resolveAiAccess(bo), 5_000))).toBe("OK");
  });

  it("usage summaries need ai.usage.view and never include content", async () => {
    expect(await code(getCompanyUsageSummary(actorOf(h, T.A.manager), 1000))).toBe("FORBIDDEN");
    const summary = await getCompanyUsageSummary(actorOf(h, T.A.owner), 1000);
    expect(summary.today.budget).toBe(1000);
    expect(JSON.stringify(summary)).not.toMatch(/secret|private/i);
    const foreign = await getCompanyUsageSummary(actorOf(h, T.B.owner), 0);
    expect(foreign.members.every((r) => r.userId !== T.A.manager.userId.toHexString())).toBe(true);
  });
});
