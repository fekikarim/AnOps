import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createHarness, type TestHarness } from "../helpers/workspace";

const shared = vi.hoisted(() => {
  process.env.STRIPE_API_KEY = "sk_test_placeholder_for_tests";
  return { db: null as unknown, subscriptions: new Map<string, unknown>(), canceled: [] as string[] };
});
vi.mock("@/server/db/client", () => ({ default: Promise.resolve({ db: () => shared.db }) }));
vi.mock("@/server/tenant/context", () => ({ getActiveTenant: async () => null }));
vi.mock("@/server/email/client", () => ({ sendMail: async () => ({ delivered: true }) }));
// No network: the Stripe SDK is replaced by an in-memory fake that returns the "current" subscription.
vi.mock("stripe", () => {
  class FakeStripe {
    subscriptions = {
      retrieve: async (id: string) => shared.subscriptions.get(id),
      cancel: async (id: string) => (shared.canceled.push(id), { id, status: "canceled" }),
    };
    static errors = { StripeInvalidRequestError: class extends Error {} };
  }
  return { default: FakeStripe };
});

const { handleStripeEvent, applyStripeSubscription } = await import("@/server/platform/billing.service");
const { registerOrganization } = await import("@/server/platform/registration.service");
const { getEntitlements } = await import("@/server/platform/subscription.service");

let h: TestHarness;
beforeAll(async () => {
  h = await createHarness();
  shared.db = h.db;
});
afterAll(async () => h.cleanup());

let n = 0;
async function org(customer: string) {
  const reg = await registerOrganization(
    h.db,
    { firstName: "A", lastName: "B", organizationName: "Org", email: `billing${++n}@example.test`, phone: "+216 20 000 000", currency: "EUR", password: "Secure1234", confirmPassword: "Secure1234", acceptTerms: true, apps: ["finance", "inventory"] },
    { ip: `10.1.0.${n}`, requestId: "r" }
  );
  await h.db.collection("organization_subscriptions").updateOne({ companyId: reg.companyId }, { $set: { stripeCustomerId: customer } });
  return reg;
}

function sub(id: string, customer: string, companyId: ObjectId, patch: Record<string, unknown> = {}, metadata: Record<string, string> = {}) {
  const value = {
    id,
    object: "subscription",
    customer,
    status: "active",
    cancel_at_period_end: false,
    items: { data: [{ current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400 }] },
    metadata: { companyId: companyId.toHexString(), plan: "allops", apps: "", aiAddon: "false", interval: "month", ...metadata },
    ...patch,
  };
  shared.subscriptions.set(id, value);
  return value;
}

const event = (id: string, type: string, object: unknown) => ({ id, type, data: { object } }) as never;

describe("stripe synchronization", () => {
  it("a verified subscription event activates the paid plan; replaying the event is a no-op", async () => {
    const reg = await org("cus_1");
    const s = sub("sub_1", "cus_1", reg.companyId);
    expect(await handleStripeEvent(h.db, event("evt_1", "customer.subscription.created", s), "r")).toBe("processed");
    expect(await handleStripeEvent(h.db, event("evt_1", "customer.subscription.created", s), "r")).toBe("duplicate");
    const ent = await getEntitlements(h.db, reg.companyId);
    expect(ent).toMatchObject({ kind: "paid", plan: "allops", aiFeatures: false });
    expect(ent.appIds).toHaveLength(9);
    expect(ent.appIds).not.toContain("ai");
  });

  it("ignores a subscription whose customer belongs to another organization", async () => {
    const reg = await org("cus_2");
    await applyStripeSubscription(h.db, sub("sub_x", "cus_attacker", reg.companyId, {}, { plan: "maxops" }) as never, "r");
    expect((await getEntitlements(h.db, reg.companyId)).kind).toBe("trial");
  });

  it("custom metadata grants only the paid apps, with the AI add-on when bought", async () => {
    const reg = await org("cus_3");
    await applyStripeSubscription(h.db, sub("sub_3", "cus_3", reg.companyId, {}, { plan: "custom", apps: "finance,crm", aiAddon: "true" }) as never, "r");
    expect(await getEntitlements(h.db, reg.companyId)).toMatchObject({ kind: "paid", plan: "custom", appIds: ["finance", "crm"], aiFeatures: true });
  });

  it("payment failure keeps access during grace; cancellation keeps access until the period ends", async () => {
    const reg = await org("cus_4");
    await applyStripeSubscription(h.db, sub("sub_4", "cus_4", reg.companyId) as never, "r");
    await handleStripeEvent(h.db, event("evt_4", "customer.subscription.updated", sub("sub_4", "cus_4", reg.companyId, { status: "past_due" })), "r");
    expect((await getEntitlements(h.db, reg.companyId)).kind).toBe("grace");
    await handleStripeEvent(h.db, event("evt_5", "customer.subscription.updated", sub("sub_4", "cus_4", reg.companyId, { status: "active", cancel_at_period_end: true })), "r");
    expect((await getEntitlements(h.db, reg.companyId)).kind).toBe("canceling");
    const ended = sub("sub_4", "cus_4", reg.companyId, { status: "canceled", items: { data: [{ current_period_end: Math.floor(Date.now() / 1000) - 10 }] } });
    await handleStripeEvent(h.db, event("evt_6", "customer.subscription.deleted", ended), "r");
    expect(await getEntitlements(h.db, reg.companyId)).toMatchObject({ kind: "lapsed", needsPlanSelection: true });
  });

  it("a plan change through a new checkout replaces (and cancels) the previous subscription", async () => {
    const reg = await org("cus_5");
    await applyStripeSubscription(h.db, sub("sub_old", "cus_5", reg.companyId) as never, "r");
    await applyStripeSubscription(h.db, sub("sub_new", "cus_5", reg.companyId, {}, { plan: "maxops" }) as never, "r");
    expect(shared.canceled).toContain("sub_old");
    expect((await getEntitlements(h.db, reg.companyId)).plan).toBe("maxops");
    // A late event about the old subscription cannot downgrade the organization.
    await applyStripeSubscription(h.db, sub("sub_old", "cus_5", reg.companyId, { status: "canceled" }) as never, "r");
    expect((await getEntitlements(h.db, reg.companyId)).plan).toBe("maxops");
  });

  it("a failed handler releases the event for Stripe's retry", async () => {
    const reg = await org("cus_6");
    shared.subscriptions.delete("sub_missing");
    await expect(handleStripeEvent(h.db, event("evt_fail", "customer.subscription.updated", { id: "sub_missing", customer: "cus_6", metadata: { companyId: reg.companyId.toHexString() } }), "r")).rejects.toBeTruthy();
    expect(await h.db.collection("stripe_events").findOne({ _id: "evt_fail" as never })).toBeNull();
  });
});
