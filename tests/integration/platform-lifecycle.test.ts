import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createHarness, type TestHarness } from "../helpers/workspace";

const shared = vi.hoisted(() => ({ db: null as unknown, sent: [] as Array<{ to: string; subject: string; html: string; text: string }> }));
vi.mock("@/server/db/client", () => ({ default: Promise.resolve({ db: () => shared.db }) }));
vi.mock("@/server/auth", () => ({ auth: async () => null }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: () => undefined }));
vi.mock("@/server/tenant/context", () => ({ getActiveTenant: async () => null }));
vi.mock("@/server/email/client", () => ({ sendMail: async (m: (typeof shared.sent)[number]) => (shared.sent.push(m), { delivered: true }) }));

const { registerOrganization } = await import("@/server/platform/registration.service");
const { activateOrganization, resendActivation } = await import("@/server/platform/activation.service");
const { runLifecycleMaintenance } = await import("@/server/platform/cleanup.service");
const { inviteMembers, acceptInvitation, previewInvitation, revokeInvitation } = await import("@/server/platform/invitation.service");
const { chooseFreeFallback, getEntitlements, getSubscriptionDoc } = await import("@/server/platform/subscription.service");
const { allowAuthAttempt } = await import("@/server/security/auth-throttle");
const { assertAppAccessFor, assertAiEntitled } = await import("@/server/platform/access");
const { listMyOrganizations, leaveOrganization } = await import("@/server/platform/organization.service");
const { resolveAiAccess } = await import("@/server/ai/access/access.service");
const { effectiveApps } = await import("@/shared/domain/plans");
const { permissionsForRole } = await import("@/server/security/permissions");

let h: TestHarness;
beforeAll(async () => {
  h = await createHarness();
  shared.db = h.db;
});
afterAll(async () => h.cleanup());
beforeEach(() => {
  shared.sent.length = 0;
});

let seq = 0;
const form = (apps: string[], patch: Record<string, unknown> = {}) => ({
  firstName: "Amira",
  lastName: "Ben Salah",
  organizationName: "Atlas Trading",
  email: `owner${++seq}@example.test`,
  phone: "+216 20 123 456",
  currency: "TND",
  password: "Secure1234",
  confirmPassword: "Secure1234",
  acceptTerms: true,
  apps,
  ...patch,
});
const meta = () => ({ ip: `10.0.0.${seq}`, requestId: `req-${new ObjectId().toHexString()}` });
const tokenFrom = (text: string, path: string) => new RegExp(`${path}\\?token=([A-Za-z0-9_-]{43})`).exec(text)?.[1] ?? "";

describe("registration", () => {
  it("one application: owner, organization, membership, permanent free plan and activation email", async () => {
    const result = await registerOrganization(h.db, form(["inventory"]), meta());
    expect(result.kind).toBe("free");
    const company = await h.db.collection("companies").findOne({ _id: result.companyId });
    expect(company).toMatchObject({ name: "Atlas Trading", currency: "TND", activationStatus: "pending" });
    const user = await h.db.collection("users").findOne({ _id: result.userId });
    expect(user).toMatchObject({ status: "active", emailVerified: null, firstName: "Amira" });
    expect(user?.password).not.toBe("Secure1234");
    expect(await h.db.collection("company_members").findOne({ companyId: result.companyId, userId: result.userId })).toMatchObject({ role: "owner", status: "active" });
    const ent = await getEntitlements(h.db, result.companyId);
    expect(ent).toMatchObject({ kind: "free", appIds: ["inventory"], aiFeatures: false });
    expect(shared.sent).toHaveLength(1);
    expect(shared.sent[0].text).toMatch(/\/activate\?token=/);
    // Only the hash is stored.
    const stored = await h.db.collection("activation_tokens").findOne({ companyId: result.companyId });
    expect(shared.sent[0].text).not.toContain(stored?.tokenHash);
  });

  it("two or three applications start a 15-day trial", async () => {
    const result = await registerOrganization(h.db, form(["finance", "purchasing", "ai"]), meta());
    const ent = await getEntitlements(h.db, result.companyId);
    expect(ent.kind).toBe("trial");
    expect(ent.trialDaysLeft).toBe(15);
    expect(ent.aiFeatures).toBe(true);
  });

  it("re-validates the selection and refuses duplicates and existing emails", async () => {
    await expect(registerOrganization(h.db, form(["finance", "marketing", "hr-payroll", "inventory"]), meta())).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(registerOrganization(h.db, form(["ai"]), meta())).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const first = form(["hr-payroll"]);
    await registerOrganization(h.db, first, meta());
    await expect(registerOrganization(h.db, { ...first }, meta())).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await h.db.collection("users").countDocuments({ email: first.email })).toBe(1);
  });

  it("concurrent registrations for one email create a single account", async () => {
    const input = form(["hr-payroll"]);
    const results = await Promise.allSettled([registerOrganization(h.db, input, meta()), registerOrganization(h.db, input, meta())]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await h.db.collection("users").countDocuments({ email: input.email })).toBe(1);
    expect(await h.db.collection("companies").countDocuments({ contactEmail: input.email })).toBe(1);
  });
});

describe("activation", () => {
  it("activates once, then the link is dead", async () => {
    const reg = await registerOrganization(h.db, form(["finance"]), meta());
    const token = tokenFrom(shared.sent[0].text, "/activate");
    const done = await activateOrganization(h.db, token, "req");
    expect(done.companyId.equals(reg.companyId)).toBe(true);
    expect(await h.db.collection("companies").findOne({ _id: reg.companyId })).toMatchObject({ activationStatus: "active" });
    const user = await h.db.collection("users").findOne({ _id: reg.userId });
    expect(user?.emailVerified).toBeInstanceOf(Date);
    expect(user?.provisionalUntil).toBeUndefined();
    await expect(activateOrganization(h.db, token, "req")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects malformed and unknown tokens with one generic answer", async () => {
    await expect(activateOrganization(h.db, "abc", "req")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(activateOrganization(h.db, "A".repeat(43), "req")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("concurrent clicks activate exactly once", async () => {
    await registerOrganization(h.db, form(["finance"]), meta());
    const token = tokenFrom(shared.sent[0].text, "/activate");
    const results = await Promise.allSettled([activateOrganization(h.db, token, "a"), activateOrganization(h.db, token, "b")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("resend revokes the previous link and has a cooldown", async () => {
    const reg = await registerOrganization(h.db, form(["finance"]), meta());
    const first = tokenFrom(shared.sent[0].text, "/activate");
    await h.db.collection("activation_tokens").updateMany({ companyId: reg.companyId }, { $set: { createdAt: new Date(Date.now() - 120_000) } });
    await resendActivation(h.db, { userId: reg.userId, companyId: reg.companyId, requestId: "r" });
    await expect(resendActivation(h.db, { userId: reg.userId, companyId: reg.companyId, requestId: "r" })).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await expect(activateOrganization(h.db, first, "req")).rejects.toMatchObject({ code: "NOT_FOUND" });
    const second = tokenFrom(shared.sent[1].text, "/activate");
    await expect(activateOrganization(h.db, second, "req")).resolves.toBeTruthy();
  });

  it("only the owner can resend", async () => {
    const reg = await registerOrganization(h.db, form(["finance"]), meta());
    await expect(resendActivation(h.db, { userId: new ObjectId(), companyId: reg.companyId, requestId: "r" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("12-hour expiry cleanup", () => {
  it("removes unactivated organizations and their provisional data, keeps audit records, spares activated ones", async () => {
    const expired = await registerOrganization(h.db, form(["inventory", "finance"]), meta());
    const expiredToken = tokenFrom(shared.sent[0].text, "/activate");
    const kept = await registerOrganization(h.db, form(["inventory"]), meta());
    await activateOrganization(h.db, tokenFrom(shared.sent[1].text, "/activate"), "req");
    await h.db.collection("inventory_products").insertOne({ companyId: expired.companyId, name: "Provisional" });

    const later = new Date(Date.now() + 13 * 60 * 60 * 1000);
    // Before cleanup runs, the expired organization already refuses activation.
    await h.db.collection("companies").updateOne({ _id: expired.companyId }, { $set: { activationDeadline: new Date(Date.now() - 1000) } });
    await expect(activateOrganization(h.db, expiredToken, "req")).rejects.toMatchObject({ code: "NOT_FOUND" });

    const [a, b] = await Promise.all([runLifecycleMaintenance(h.db, later), runLifecycleMaintenance(h.db, later)]);
    expect(a.expiredOrganizations + b.expiredOrganizations).toBeGreaterThanOrEqual(1);
    expect(await h.db.collection("companies").findOne({ _id: expired.companyId })).toBeNull();
    expect(await h.db.collection("company_members").countDocuments({ companyId: expired.companyId })).toBe(0);
    expect(await h.db.collection("inventory_products").countDocuments({ companyId: expired.companyId })).toBe(0);
    expect(await h.db.collection("organization_subscriptions").countDocuments({ companyId: expired.companyId })).toBe(0);
    expect(await h.db.collection("users").findOne({ _id: expired.userId })).toBeNull();
    expect(await h.db.collection("audit_events").countDocuments({ companyId: expired.companyId, action: "organization.expired_cleanup" })).toBe(1);

    expect(await h.db.collection("companies").findOne({ _id: kept.companyId })).toMatchObject({ activationStatus: "active" });
    expect(await h.db.collection("users").findOne({ _id: kept.userId })).not.toBeNull();
    // Idempotent.
    expect((await runLifecycleMaintenance(h.db, later)).expiredOrganizations).toBe(0);
  });
});

describe("invitations", () => {
  async function activeOrg() {
    const reg = await registerOrganization(h.db, form(["hr-payroll"]), meta());
    await activateOrganization(h.db, tokenFrom(shared.sent.at(-1)!.text, "/activate"), "req");
    shared.sent.length = 0;
    return { ...reg, ctx: { db: h.db, companyId: reg.companyId, userId: reg.userId, role: "owner" as const, requestId: "r" } };
  }

  it("new people accept with a single-use link and join with the invited role", async () => {
    const org = await activeOrg();
    const out = await inviteMembers(org.ctx, { invitations: [{ email: "new.hire@example.test", role: "manager" }, { email: "new.hire@example.test", role: "manager" }] });
    expect(out).toEqual([{ email: "new.hire@example.test", status: "sent" }]);
    const token = tokenFrom(shared.sent[0].text, "/invite");
    expect(await previewInvitation(h.db, token)).toMatchObject({ email: "new.hire@example.test", roleLabel: "Manager", accountExists: false });
    const joined = await acceptInvitation(h.db, { token, signedInUserId: null, newAccount: { firstName: "Nour", lastName: "K", password: "Secure1234", confirmPassword: "Secure1234" }, requestId: "r" });
    expect(joined.createdAccount).toBe(true);
    expect(await h.db.collection("company_members").findOne({ companyId: org.companyId, userId: joined.userId })).toMatchObject({ role: "manager", status: "active" });
    await expect(acceptInvitation(h.db, { token, signedInUserId: null, newAccount: {}, requestId: "r" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses duplicates while pending, existing members, and admins appointing admins", async () => {
    const org = await activeOrg();
    await inviteMembers(org.ctx, { invitations: [{ email: "dup@example.test", role: "employee" }] });
    expect(await inviteMembers(org.ctx, { invitations: [{ email: "dup@example.test", role: "employee" }] })).toEqual([{ email: "dup@example.test", status: "already_invited" }]);
    const owner = await h.db.collection("users").findOne({ _id: org.userId });
    expect(await inviteMembers(org.ctx, { invitations: [{ email: String(owner?.email), role: "employee" }] })).toEqual([{ email: String(owner?.email), status: "already_member" }]);
    await expect(inviteMembers({ ...org.ctx, role: "admin" }, { invitations: [{ email: "boss@example.test", role: "admin" }] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(inviteMembers({ ...org.ctx, role: "operator" }, { invitations: [{ email: "x@example.test", role: "employee" }] })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("existing accounts must be signed in as the invited email; revoked and expired links fail", async () => {
    const org = await activeOrg();
    const other = await activeOrg();
    const otherOwner = await h.db.collection("users").findOne({ _id: other.userId });
    await inviteMembers(org.ctx, { invitations: [{ email: String(otherOwner?.email), role: "employee" }] });
    const token = tokenFrom(shared.sent[0].text, "/invite");
    await expect(acceptInvitation(h.db, { token, signedInUserId: new ObjectId(), requestId: "r" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(acceptInvitation(h.db, { token, signedInUserId: other.userId, requestId: "r" })).resolves.toMatchObject({ createdAccount: false });

    await inviteMembers(org.ctx, { invitations: [{ email: "late@example.test", role: "employee" }, { email: "gone@example.test", role: "employee" }] });
    const late = tokenFrom(shared.sent[1].text, "/invite");
    await h.db.collection("organization_invitations").updateOne({ email: "late@example.test" }, { $set: { expiresAt: new Date(Date.now() - 1) } });
    expect(await previewInvitation(h.db, late)).toBeNull();
    const gone = await h.db.collection("organization_invitations").findOne({ email: "gone@example.test" });
    await revokeInvitation(org.ctx, gone!._id.toHexString());
    expect(await previewInvitation(h.db, tokenFrom(shared.sent[2].text, "/invite"))).toBeNull();
  });

  it("cannot invite before activation", async () => {
    const reg = await registerOrganization(h.db, form(["hr-payroll"]), meta());
    await expect(inviteMembers({ db: h.db, companyId: reg.companyId, userId: reg.userId, role: "owner", requestId: "r" }, { invitations: [{ email: "a@example.test", role: "employee" }] })).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });
});

describe("trial expiry and free fallback", () => {
  it("expired trial blocks apps, allows one immutable OneOps choice among trial apps", async () => {
    const reg = await registerOrganization(h.db, form(["finance", "inventory"]), meta());
    await h.db.collection("organization_subscriptions").updateOne({ companyId: reg.companyId }, { $set: { trialEndsAt: new Date(Date.now() - 1000) } });
    await runLifecycleMaintenance(h.db);
    expect(await getEntitlements(h.db, reg.companyId)).toMatchObject({ kind: "trial_expired", appIds: [], needsPlanSelection: true });

    await expect(chooseFreeFallback(h.db, { companyId: reg.companyId, actorUserId: reg.userId, appId: "marketing", requestId: "r" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await chooseFreeFallback(h.db, { companyId: reg.companyId, actorUserId: reg.userId, appId: "inventory", requestId: "r" });
    expect(await getEntitlements(h.db, reg.companyId)).toMatchObject({ kind: "free", appIds: ["inventory"], aiFeatures: false });
    await expect(chooseFreeFallback(h.db, { companyId: reg.companyId, actorUserId: reg.userId, appId: "finance", requestId: "r" })).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    expect((await getSubscriptionDoc(h.db, reg.companyId))?.freeAppId).toBe("inventory");
  });
});

describe("AI entitlement", () => {
  it("OneOps organizations never get AI, even with company AI on and an owner grant", async () => {
    const reg = await registerOrganization(h.db, form(["finance"]), meta());
    await h.db.collection("ai_settings").insertOne({ companyId: reg.companyId, enabled: true, version: 1 });
    const access = await resolveAiAccess({ db: h.db, companyId: reg.companyId, userId: reg.userId, requestId: "r", role: "owner", currencyCode: "TND", permissions: permissionsForRole("owner") } as never);
    expect(access.state).toBe("plan_excluded");
    expect(access.can("inventory", "view")).toBe(false);
  });

  it("member application access narrows the organization's entitlement", () => {
    const ent = { kind: "paid", plan: "allops", appIds: ["finance", "inventory", "crm"], aiFeatures: false, needsPlanSelection: false, trialEndsAt: null, trialDaysLeft: null, accessEndsAt: null } as const;
    expect(effectiveApps({ ...ent, appIds: [...ent.appIds] }, { companyRole: "employee", appAccess: ["crm", "marketing"] })).toEqual(["crm"]);
    expect(effectiveApps({ ...ent, appIds: [...ent.appIds] }, { companyRole: "admin", appAccess: ["crm"] })).toEqual(["finance", "inventory", "crm"]);
  });
});

describe("multi-organization", () => {
  it("lists every organization of a person with their role and plan, and keeps data per organization", async () => {
    const a = await registerOrganization(h.db, form(["finance"]), meta());
    await activateOrganization(h.db, tokenFrom(shared.sent.at(-1)!.text, "/activate"), "req");
    const otherOwner = await registerOrganization(h.db, form(["inventory"]), meta());
    await activateOrganization(h.db, tokenFrom(shared.sent.at(-1)!.text, "/activate"), "req");
    // The first person is also an employee of the second organization.
    await h.db.collection("company_members").insertOne({ companyId: otherOwner.companyId, userId: a.userId, role: "employee", status: "active", createdAt: new Date(), updatedAt: new Date() });

    const list = await listMyOrganizations(h.db, a.userId, a.companyId.toHexString());
    expect(list).toHaveLength(2);
    expect(list.find((o) => o.id === a.companyId.toHexString())).toMatchObject({ role: "owner", active: true, appCount: 1 });
    expect(list.find((o) => o.id === otherOwner.companyId.toHexString())).toMatchObject({ role: "employee", active: false });
    // The other owner only sees their own organization.
    expect(await listMyOrganizations(h.db, otherOwner.userId, otherOwner.companyId.toHexString())).toHaveLength(1);
  });

  it("members can leave; owners cannot", async () => {
    const owner = await registerOrganization(h.db, form(["finance"]), meta());
    await activateOrganization(h.db, tokenFrom(shared.sent.at(-1)!.text, "/activate"), "req");
    const member = new ObjectId();
    await h.db.collection("company_members").insertOne({ companyId: owner.companyId, userId: member, role: "employee", status: "active", createdAt: new Date(), updatedAt: new Date() });
    const access = (userId: ObjectId, companyRole: string) => ({ ctx: { db: h.db, companyId: owner.companyId, userId, requestId: "r" }, companyRole }) as never;
    await expect(leaveOrganization(access(owner.userId, "owner"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await leaveOrganization(access(member, "employee"));
    expect(await h.db.collection("company_members").countDocuments({ companyId: owner.companyId, userId: member })).toBe(0);
    expect(await h.db.collection("company_members").countDocuments({ companyId: owner.companyId, role: "owner" })).toBe(1);
  });
});

describe("server-side application access", () => {
  it("refuses applications outside the plan or outside a member's own access, on every call", async () => {
    const owner = await registerOrganization(h.db, form(["finance", "inventory"]), meta());
    await activateOrganization(h.db, tokenFrom(shared.sent.at(-1)!.text, "/activate"), "req");
    // Owner: both trial applications work, others are refused.
    await expect(assertAppAccessFor(h.db, owner.companyId, owner.userId, "finance")).resolves.toBeUndefined();
    await expect(assertAppAccessFor(h.db, owner.companyId, owner.userId, "inventory")).resolves.toBeUndefined();
    await expect(assertAppAccessFor(h.db, owner.companyId, owner.userId, "purchasing")).rejects.toMatchObject({ code: "FORBIDDEN" });
    // A member limited to Finance cannot use Inventory even though the organization has it.
    const member = new ObjectId();
    await h.db.collection("company_members").insertOne({ companyId: owner.companyId, userId: member, role: "manager", status: "active", appAccess: ["finance"], createdAt: new Date(), updatedAt: new Date() });
    await expect(assertAppAccessFor(h.db, owner.companyId, member, "finance")).resolves.toBeUndefined();
    await expect(assertAppAccessFor(h.db, owner.companyId, member, "inventory")).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Employees never open Finance, Purchasing or Marketing even when the organization has them.
    const employee = new ObjectId();
    await h.db.collection("company_members").insertOne({ companyId: owner.companyId, userId: employee, role: "employee", status: "active", createdAt: new Date(), updatedAt: new Date() });
    await expect(assertAppAccessFor(h.db, owner.companyId, employee, "finance")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(assertAppAccessFor(h.db, owner.companyId, employee, "inventory")).resolves.toBeUndefined();
    // Strangers and suspended members are refused outright.
    await expect(assertAppAccessFor(h.db, owner.companyId, new ObjectId(), "finance")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("sign-in throttling", () => {
  it("stops repeated attempts for one address and account, without locking out other people", async () => {
    const limits = { pair: 3, account: 5, ip: 50 };
    for (let i = 0; i < 3; i++) expect(await allowAuthAttempt(h.db, "login", "1.1.1.1", "victim@example.test", limits)).toBe(true);
    expect(await allowAuthAttempt(h.db, "login", "1.1.1.1", "victim@example.test", limits)).toBe(false);
    // The same account from another address still has account-level room; another account from the first address is unaffected.
    expect(await allowAuthAttempt(h.db, "login", "2.2.2.2", "victim@example.test", limits)).toBe(true);
    expect(await allowAuthAttempt(h.db, "login", "1.1.1.1", "someone.else@example.test", limits)).toBe(true);
    // A distributed run still hits the account ceiling (3 + 1 so far, 5 allowed).
    expect(await allowAuthAttempt(h.db, "login", "3.3.3.3", "victim@example.test", limits)).toBe(true);
    expect(await allowAuthAttempt(h.db, "login", "4.4.4.4", "victim@example.test", limits)).toBe(false);
  });
});

describe("AI availability by plan (what the AI health endpoint and every AI action rely on)", () => {
  it("AI is open only for trial, MaxOps and Custom with the AI add-on; never for OneOps or AllOps", async () => {
    const owner = await registerOrganization(h.db, form(["finance", "inventory"]), meta());
    await activateOrganization(h.db, tokenFrom(shared.sent.at(-1)!.text, "/activate"), "req");
    const subs = h.db.collection("organization_subscriptions");
    const set = (patch: Record<string, unknown>) => subs.updateOne({ companyId: owner.companyId }, { $set: { legacy: false, status: "active", cancelAtPeriodEnd: false, currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000), ...patch } });
    const ai = () => assertAiEntitled(h.db, owner.companyId);

    await expect(ai()).resolves.toBeUndefined(); // trial includes AI
    await set({ status: "free", plan: "oneops", freeAppId: "finance" });
    await expect(ai()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await set({ status: "active", plan: "allops", aiAddon: false });
    await expect(ai()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(assertAppAccessFor(h.db, owner.companyId, owner.userId, "hr-payroll")).resolves.toBeUndefined(); // all other apps stay
    await set({ status: "active", plan: "maxops" });
    await expect(ai()).resolves.toBeUndefined();
    await set({ status: "active", plan: "custom", customAppIds: ["finance", "inventory"], aiAddon: false });
    await expect(ai()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(assertAppAccessFor(h.db, owner.companyId, owner.userId, "purchasing")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await set({ status: "active", plan: "custom", customAppIds: ["finance", "inventory"], aiAddon: true });
    await expect(ai()).resolves.toBeUndefined();
    // Subscription lapses: everything closes at once, no matter the plan that was active.
    await set({ status: "canceled", plan: "maxops", currentPeriodEnd: new Date(Date.now() - 1000) });
    await expect(ai()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(assertAppAccessFor(h.db, owner.companyId, owner.userId, "finance")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
