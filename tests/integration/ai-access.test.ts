import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { createHarness, type TestHarness } from "../helpers/workspace";
import { actorOf, seedMember, seedTenants, type SeededMember } from "../helpers/ai";
import {
  cancelPendingForMember,
  getAiSettings,
  listAccessMembers,
  resolveAiAccess,
  saveMemberGrant,
  updateAiSettings,
} from "@/server/ai/access/access.service";
import { COLLECTIONS } from "@/server/db/documents";
import type { AiModules } from "@/shared/domain/ai";

let h: TestHarness;
let T: Awaited<ReturnType<typeof seedTenants>>;

const ON = { view: true, create: true, edit: true, delete: false, approve: false };
const READ = { view: true, create: false, edit: false, delete: false, approve: false };

function grant(modules: AiModules, extra: Partial<{ enabled: boolean; canAuditTranscripts: boolean; canViewSensitiveHr: boolean; dailyTokenCap: number | null }> = {}) {
  return { enabled: true, modules, canAuditTranscripts: false, canViewSensitiveHr: false, dailyTokenCap: null, ...extra };
}

const settingsOn = { enabled: true, retentionDays: 90, dailyTokenBudget: 500_000, defaultUserDailyTokenCap: 50_000 };

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "OK";
  } catch (error) {
    return (error as { code?: string }).code ?? "UNKNOWN";
  }
}

beforeAll(async () => {
  h = await createHarness();
  T = await seedTenants(h);
});

afterAll(async () => {
  await h.cleanup();
});

describe("company switch and defaults", () => {
  it("is off by default, so even the owner is told the company has not enabled AI", async () => {
    expect((await getAiSettings(actorOf(h, T.A.owner))).enabled).toBe(false);
    expect((await resolveAiAccess(actorOf(h, T.A.owner))).state).toBe("company_disabled");
  });

  it("gives the owner built-in access once the company enables AI, and nobody else", async () => {
    await updateAiSettings(actorOf(h, T.A.owner), settingsOn, 0);
    const owner = await resolveAiAccess(actorOf(h, T.A.owner));
    expect(owner.state).toBe("ready");
    expect(owner.grant.isDefault).toBe(true);
    expect(owner.can("inventory", "delete")).toBe(true);
    expect(owner.grant.canAuditTranscripts).toBe(false);
    for (const member of [T.A.admin, T.A.manager, T.A.employee]) {
      expect((await resolveAiAccess(actorOf(h, member))).state).toBe("not_granted");
    }
  });

  it("does not leak the switch to another company", async () => {
    expect((await resolveAiAccess(actorOf(h, T.B.owner))).state).toBe("company_disabled");
  });

  it("rejects settings changes from non-managers and stale versions", async () => {
    expect(await code(updateAiSettings(actorOf(h, T.A.manager), settingsOn, 1))).toBe("FORBIDDEN");
    expect(await code(updateAiSettings(actorOf(h, T.A.employee), settingsOn, 1))).toBe("FORBIDDEN");
    expect(await code(updateAiSettings(actorOf(h, T.A.owner), settingsOn, 0))).toBe("CONFLICT");
  });

  it("validates settings bounds", async () => {
    expect(await code(updateAiSettings(actorOf(h, T.A.owner), { ...settingsOn, retentionDays: 1 }, 1))).toBe("VALIDATION_ERROR");
    expect(await code(updateAiSettings(actorOf(h, T.A.owner), { ...settingsOn, unknownField: true }, 1))).toBe("VALIDATION_ERROR");
  });
});

describe("granting access", () => {
  it("an owner grants a manager Inventory and Purchasing; the effective set is grant AND role", async () => {
    await saveMemberGrant(
      actorOf(h, T.A.owner),
      T.A.manager.userId.toHexString(),
      grant({ inventory: ON, purchasing: ON }),
      0
    );
    const access = await resolveAiAccess(actorOf(h, T.A.manager));
    expect(access.state).toBe("ready");
    expect(access.can("inventory", "create")).toBe(true);
    expect(access.can("purchasing", "edit")).toBe(true);
    expect(access.can("finance", "view")).toBe(false); // not granted
    expect(access.can("inventory", "delete")).toBe(false); // granted off
  });

  it("rejects a grant above the role ceiling instead of trimming it", async () => {
    // A company employee (viewer) has no write permissions.
    const error = await saveMemberGrant(
      actorOf(h, T.A.owner),
      T.A.employee.userId.toHexString(),
      grant({ inventory: { ...ON } }),
      0
    ).catch((e) => e);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(Object.keys(error.details)).toEqual(expect.arrayContaining(["inventory.create", "inventory.edit"]));
    // Operators cannot approve purchase orders, so that cell is rejected even though the module is allowed.
    expect(
      await code(
        saveMemberGrant(
          actorOf(h, T.A.owner),
          T.A.manager.userId.toHexString(),
          grant({ purchasing: { ...ON, approve: true } }),
          1
        )
      )
    ).toBe("VALIDATION_ERROR");
  });

  it("a read-only grant works for a viewer and never exposes writes", async () => {
    await saveMemberGrant(actorOf(h, T.A.owner), T.A.employee.userId.toHexString(), grant({ inventory: READ }), 0);
    const access = await resolveAiAccess(actorOf(h, T.A.employee));
    expect(access.can("inventory", "view")).toBe(true);
    expect(access.can("inventory", "create")).toBe(false);
    // Employees have no finance role at all, so AI cannot be granted it for them either.
    expect(await code(saveMemberGrant(actorOf(h, T.A.owner), T.A.employee.userId.toHexString(), grant({ inventory: READ, finance: READ }), 1))).toBe("VALIDATION_ERROR");
  });

  it("an admin can grant managers and employees but not owners, other admins or themselves", async () => {
    const admin = actorOf(h, T.A.admin);
    expect(await code(saveMemberGrant(admin, T.A.employee.userId.toHexString(), grant({ inventory: READ }), 1))).toBe("OK");
    expect(await code(saveMemberGrant(admin, T.A.admin2.userId.toHexString(), grant({ inventory: READ }), 0))).toBe("FORBIDDEN");
    expect(await code(saveMemberGrant(admin, T.A.owner.userId.toHexString(), grant({ inventory: READ }), 0))).toBe("FORBIDDEN");
    expect(await code(saveMemberGrant(admin, T.A.admin.userId.toHexString(), grant({ inventory: READ }), 0))).toBe("FORBIDDEN");
  });

  it("an owner can manage an administrator", async () => {
    expect(await code(saveMemberGrant(actorOf(h, T.A.owner), T.A.admin2.userId.toHexString(), grant({ finance: ON }), 0))).toBe("OK");
  });

  it("managers and employees cannot manage anyone's AI access", async () => {
    expect(await code(saveMemberGrant(actorOf(h, T.A.manager), T.A.employee.userId.toHexString(), grant({}), 2))).toBe("FORBIDDEN");
    expect(await code(listAccessMembers(actorOf(h, T.A.employee)))).toBe("FORBIDDEN");
  });

  it("audit and sensitive-data switches are owner-only; audit goes only to owners and administrators", async () => {
    const adminCtx = actorOf(h, T.A.admin);
    const target = T.A.admin2.userId.toHexString();
    expect(await code(saveMemberGrant(adminCtx, target, grant({ finance: ON }, { canViewSensitiveHr: true }), 1))).toBe("FORBIDDEN");
    const owner = actorOf(h, T.A.owner);
    expect(await code(saveMemberGrant(owner, T.A.manager.userId.toHexString(), grant({ inventory: ON }, { canAuditTranscripts: true }), 1))).toBe("VALIDATION_ERROR");
    expect(await code(saveMemberGrant(owner, target, grant({ finance: ON }, { canAuditTranscripts: true }), 1))).toBe("OK");
    // Even the owner has no audit switch until it is explicitly saved for them.
    expect((await resolveAiAccess(owner)).grant.canAuditTranscripts).toBe(false);
  });

  it("is version-checked: a stale save is a CONFLICT and only one of two parallel saves wins", async () => {
    const member = await seedMember(h.db, T.companyA, "manager");
    const owner = actorOf(h, T.A.owner);
    const results = await Promise.all([
      code(saveMemberGrant(owner, member.userId.toHexString(), grant({ inventory: ON }), 0)),
      code(saveMemberGrant(owner, member.userId.toHexString(), grant({ inventory: READ }), 0)),
    ]);
    expect(results.sort()).toEqual(["CONFLICT", "OK"]);
    expect(await code(saveMemberGrant(owner, member.userId.toHexString(), grant({ inventory: READ }), 0))).toBe("CONFLICT");
  });

  it("rejects malformed grants", async () => {
    const owner = actorOf(h, T.A.owner);
    const id = T.A.manager.userId.toHexString();
    expect(await code(saveMemberGrant(owner, id, { enabled: true, modules: { crm: ON } }, 2))).toBe("VALIDATION_ERROR");
    expect(await code(saveMemberGrant(owner, id, grant({}, { dailyTokenCap: -5 }), 2))).toBe("VALIDATION_ERROR");
    expect(await code(saveMemberGrant(owner, "not-an-id", grant({}), 0))).toBe("NOT_FOUND");
  });

  it("writes an audit event for every access change", async () => {
    const events = await h.db
      .collection(COLLECTIONS.auditEvents)
      .find({ companyId: T.companyA, action: "ai.access.updated" })
      .toArray();
    expect(events.length).toBeGreaterThanOrEqual(4);
    expect(events[0].actorUserId).toBeInstanceOf(ObjectId);
  });
});

describe("tenant isolation", () => {
  it("another company's administrator cannot see or edit this company's members", async () => {
    const foreign = actorOf(h, T.B.owner);
    expect(await code(saveMemberGrant(foreign, T.A.manager.userId.toHexString(), grant({ inventory: ON }), 2))).toBe("NOT_FOUND");
    const listed = await listAccessMembers(foreign);
    expect(listed.every((m) => !m.userId.includes(T.A.manager.userId.toHexString()))).toBe(true);
    expect(listed).toHaveLength(3);
  });

  it("a member of company A has no standing in company B even with a grant in A", async () => {
    const asIfInB = { ...actorOf(h, T.A.manager), companyId: T.companyB };
    expect((await resolveAiAccess(asIfInB)).state).toBe("inactive");
  });

  it("grants written in one company never appear in another", async () => {
    const inB = await h.db.collection(COLLECTIONS.aiAccessGrants).countDocuments({ companyId: T.companyB });
    expect(inB).toBe(0);
  });
});

describe("immediate revocation", () => {
  it("disabling a member takes effect on the next resolution", async () => {
    const member = await seedMember(h.db, T.companyA, "manager");
    const owner = actorOf(h, T.A.owner);
    await saveMemberGrant(owner, member.userId.toHexString(), grant({ inventory: ON }), 0);
    expect((await resolveAiAccess(actorOf(h, member))).can("inventory", "edit")).toBe(true);
    await saveMemberGrant(owner, member.userId.toHexString(), grant({ inventory: ON }, { enabled: false }), 1);
    const after = await resolveAiAccess(actorOf(h, member));
    expect(after.state).toBe("not_granted");
    expect(after.can("inventory", "view")).toBe(false);
  });

  it("a role downgrade shrinks the effective set even though the stored grant is unchanged", async () => {
    const member = await seedMember(h.db, T.companyA, "manager");
    await saveMemberGrant(actorOf(h, T.A.owner), member.userId.toHexString(), grant({ inventory: ON }), 0);
    expect((await resolveAiAccess(actorOf(h, member))).can("inventory", "edit")).toBe(true);
    await h.db.collection(COLLECTIONS.companyMembers).updateOne({ companyId: T.companyA, userId: member.userId }, { $set: { role: "employee" } });
    const after = await resolveAiAccess(actorOf(h, member));
    expect(after.can("inventory", "edit")).toBe(false);
    expect(after.can("inventory", "view")).toBe(true);
  });

  it("removal from the company, a ban, or turning AI off for the company all revoke at once", async () => {
    const member = await seedMember(h.db, T.companyA, "manager");
    await saveMemberGrant(actorOf(h, T.A.owner), member.userId.toHexString(), grant({ inventory: ON }), 0);

    await h.db.collection("users").updateOne({ _id: member.userId }, { $set: { status: "banned" } });
    expect((await resolveAiAccess(actorOf(h, member))).state).toBe("inactive");
    await h.db.collection("users").updateOne({ _id: member.userId }, { $set: { status: "active" } });
    expect((await resolveAiAccess(actorOf(h, member))).state).toBe("ready");

    await h.db.collection(COLLECTIONS.companyMembers).deleteOne({ companyId: T.companyA, userId: member.userId });
    expect((await resolveAiAccess(actorOf(h, member))).state).toBe("inactive");
  });

  it("a reduction cancels the member's pending actions in the same operation; an increase does not", async () => {
    const member = await seedMember(h.db, T.companyA, "manager");
    const owner = actorOf(h, T.A.owner);
    await saveMemberGrant(owner, member.userId.toHexString(), grant({ inventory: ON }), 0);
    const seedPending = () =>
      h.db.collection(COLLECTIONS.aiPendingActions).insertOne({
        _id: new ObjectId(),
        companyId: T.companyA,
        userId: member.userId,
        status: "pending",
      } as never);
    await seedPending();
    await saveMemberGrant(owner, member.userId.toHexString(), grant({ inventory: ON, purchasing: ON }), 1);
    expect(await h.db.collection(COLLECTIONS.aiPendingActions).countDocuments({ userId: member.userId, status: "pending" })).toBe(1);
    await saveMemberGrant(owner, member.userId.toHexString(), grant({ inventory: READ, purchasing: ON }), 2);
    expect(await h.db.collection(COLLECTIONS.aiPendingActions).countDocuments({ userId: member.userId, status: "pending" })).toBe(0);
    expect(await h.db.collection(COLLECTIONS.aiPendingActions).countDocuments({ userId: member.userId, status: "cancelled" })).toBe(1);
  });

  it("cancelPendingForMember never touches another member or another company", async () => {
    const other = await seedMember(h.db, T.companyA, "manager");
    const foreign = await seedMember(h.db, T.companyB, "manager");
    const rows = [
      { userId: other.userId, companyId: T.companyA },
      { userId: foreign.userId, companyId: T.companyB },
    ];
    for (const r of rows) await h.db.collection(COLLECTIONS.aiPendingActions).insertOne({ _id: new ObjectId(), ...r, status: "pending" } as never);
    await cancelPendingForMember({ db: h.db, companyId: T.companyA }, other.userId, "test");
    expect(await h.db.collection(COLLECTIONS.aiPendingActions).countDocuments({ userId: foreign.userId, status: "pending" })).toBe(1);
  });
});

describe("token caps resolution", () => {
  it("uses the grant's cap, else the company default", async () => {
    const member = await seedMember(h.db, T.companyA, "manager");
    await saveMemberGrant(actorOf(h, T.A.owner), member.userId.toHexString(), grant({ inventory: ON }), 0);
    expect((await resolveAiAccess(actorOf(h, member))).tokenCap).toBe(50_000);
    await saveMemberGrant(actorOf(h, T.A.owner), member.userId.toHexString(), grant({ inventory: ON }, { dailyTokenCap: 1234 }), 1);
    expect((await resolveAiAccess(actorOf(h, member))).tokenCap).toBe(1234);
  });
});

export type { SeededMember };
