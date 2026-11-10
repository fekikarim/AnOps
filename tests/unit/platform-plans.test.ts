import { describe, expect, it } from "vitest";
import { APPLICATION_IDS, APPLICATIONS, applicationForPath, getApplication } from "@/shared/domain/applications";
import {
  CUSTOM_MAX_APPS,
  freeFallbackChoices,
  initialSubscriptionState,
  quotePrice,
  resolveEntitlements,
  validateTrialSelection,
  type SubscriptionState,
} from "@/shared/domain/plans";

const now = new Date("2026-11-09T12:00:00Z");
const day = 24 * 60 * 60 * 1000;

const state = (patch: Partial<SubscriptionState>): SubscriptionState => ({
  plan: null,
  status: "lapsed",
  freeAppId: null,
  trialAppIds: [],
  trialStartedAt: null,
  trialEndsAt: null,
  customAppIds: [],
  aiAddon: false,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  pastDueSince: null,
  ...patch,
});

describe("application registry", () => {
  it("has exactly the 10 applications, each with navigation", () => {
    expect(APPLICATIONS).toHaveLength(10);
    for (const app of APPLICATIONS) expect(app.nav.flatMap((g) => g.items).length).toBeGreaterThan(0);
  });

  it("maps routes to their application and ignores platform routes", () => {
    expect(applicationForPath("/inventory/products/123")?.id).toBe("inventory");
    expect(applicationForPath("/hr")?.id).toBe("hr-payroll");
    expect(applicationForPath("/anops")).toBeNull();
    expect(applicationForPath("/organization/abc")).toBeNull();
    expect(applicationForPath("/ai-something")).toBeNull();
    expect(getApplication("finance").href).toBe("/finance");
  });
});

describe("trial selection", () => {
  it("one application is the permanent free plan", () => {
    expect(validateTrialSelection(["finance"])).toEqual({ ok: true, kind: "free", appIds: ["finance"] });
  });
  it("two or three applications start a trial", () => {
    expect(validateTrialSelection(["finance", "inventory", "hr-payroll"])).toMatchObject({ ok: true, kind: "trial" });
  });
  it("rejects more than three, duplicates, unknown ids, empty and AI alone", () => {
    expect(validateTrialSelection(["finance", "inventory", "hr-payroll", "marketing"]).ok).toBe(false);
    expect(validateTrialSelection(["crm"]).ok).toBe(false);
    expect(validateTrialSelection(["finance", "finance"]).ok).toBe(false);
    expect(validateTrialSelection(["finance", "payroll"]).ok).toBe(false);
    expect(validateTrialSelection([]).ok).toBe(false);
    expect(validateTrialSelection("finance").ok).toBe(false);
    expect(validateTrialSelection(["ai"]).ok).toBe(false);
    expect(validateTrialSelection(["ai", "finance"]).ok).toBe(false);
  });
});

describe("entitlements", () => {
  it("grandfathers organizations without a subscription", () => {
    const e = resolveEntitlements(null, now);
    expect(e.kind).toBe("legacy");
    expect(e.appIds).toHaveLength(APPLICATION_IDS.length);
  });

  it("free plan: one app, no AI, never expires", () => {
    const e = resolveEntitlements(initialSubscriptionState({ kind: "free", appIds: ["inventory"] }, now), new Date(now.getTime() + 3650 * day));
    expect(e).toMatchObject({ kind: "free", plan: "oneops", appIds: ["inventory"], aiFeatures: false, needsPlanSelection: false });
  });

  it("trial: selected apps with AI for 15 days, then nothing until a plan is chosen", () => {
    const s = initialSubscriptionState({ kind: "trial", appIds: ["inventory", "finance"] }, now);
    const during = resolveEntitlements(s, new Date(now.getTime() + 14.5 * day));
    expect(during).toMatchObject({ kind: "trial", aiFeatures: true, trialDaysLeft: 1 });
    expect(during.appIds).toEqual(["inventory", "finance"]);
    const after = resolveEntitlements(s, new Date(now.getTime() + 15 * day));
    expect(after).toMatchObject({ kind: "trial_expired", appIds: [], aiFeatures: false, needsPlanSelection: true });
  });

  it("never grants AI to AllOps or OneOps, grants it to MaxOps and Custom with add-on", () => {
    expect(resolveEntitlements(state({ plan: "allops", status: "active" }), now).aiFeatures).toBe(false);
    expect(resolveEntitlements(state({ plan: "oneops", status: "free", freeAppId: "crm" }), now).aiFeatures).toBe(false);
    expect(resolveEntitlements(state({ plan: "maxops", status: "active" }), now).aiFeatures).toBe(true);
    expect(resolveEntitlements(state({ plan: "custom", status: "active", customAppIds: ["crm", "sales"] }), now).aiFeatures).toBe(false);
    expect(resolveEntitlements(state({ plan: "custom", status: "active", customAppIds: ["crm", "sales"], aiAddon: true }), now).aiFeatures).toBe(true);
  });

  it("AllOps has no AnOps AI app and no AI; MaxOps has both", () => {
    const allops = resolveEntitlements(state({ plan: "allops", status: "active" }), now);
    expect(allops.appIds).toHaveLength(9);
    expect(allops.appIds).not.toContain("ai");
    expect(allops.aiFeatures).toBe(false);
    const maxops = resolveEntitlements(state({ plan: "maxops", status: "active" }), now);
    expect(maxops.appIds).toHaveLength(10);
    expect(maxops.appIds).toContain("ai");
    // Custom without the add-on never exposes AnOps AI, even if it was stored.
    expect(resolveEntitlements(state({ plan: "custom", status: "active", customAppIds: ["ai", "finance"] }), now).appIds).toEqual(["finance"]);
    expect(resolveEntitlements(state({ plan: "custom", status: "active", customAppIds: ["ai", "finance"], aiAddon: true }), now).appIds).toEqual(["ai", "finance"]);
    // Grace and cancelling states follow the same rule.
    expect(resolveEntitlements(state({ plan: "allops", status: "past_due", pastDueSince: now }), now).appIds).not.toContain("ai");
  });

  it("custom grants only the chosen apps", () => {
    expect(resolveEntitlements(state({ plan: "custom", status: "active", customAppIds: ["crm", "sales"] }), now).appIds).toEqual(["crm", "sales"]);
  });

  it("past due keeps access during the grace period only", () => {
    const s = state({ plan: "allops", status: "past_due", pastDueSince: now });
    expect(resolveEntitlements(s, new Date(now.getTime() + 6 * day)).kind).toBe("grace");
    expect(resolveEntitlements(s, new Date(now.getTime() + 7 * day))).toMatchObject({ kind: "lapsed", needsPlanSelection: true });
  });

  it("cancellation keeps access until the period ends", () => {
    const s = state({ plan: "maxops", status: "active", cancelAtPeriodEnd: true, currentPeriodEnd: new Date(now.getTime() + day) });
    expect(resolveEntitlements(s, now).kind).toBe("canceling");
    expect(resolveEntitlements(s, new Date(now.getTime() + 2 * day)).kind).toBe("lapsed");
    expect(resolveEntitlements(state({ plan: "maxops", status: "canceled", currentPeriodEnd: new Date(now.getTime() - 1) }), now).kind).toBe("lapsed");
  });

  it("free fallback keeps the original free app, or offers the trial apps without AI", () => {
    expect(freeFallbackChoices(state({ freeAppId: "crm" }))).toEqual(["crm"]);
    expect(freeFallbackChoices(state({ trialAppIds: ["ai", "finance", "marketing"] }))).toEqual(["finance", "marketing"]);
  });
});

describe("pricing", () => {
  it("custom is always below AllOps, annual is ten months", () => {
    for (let n = 2; n <= CUSTOM_MAX_APPS; n++) {
      const custom = quotePrice({ plan: "custom", currency: "usd", interval: "month", appCount: n });
      expect(custom.total).toBeLessThan(quotePrice({ plan: "allops", currency: "usd", interval: "month" }).total);
    }
    expect(quotePrice({ plan: "maxops", currency: "eur", interval: "year" }).total).toBe(89000);
    expect(quotePrice({ plan: "custom", currency: "usd", interval: "month", appCount: 3, aiAddon: true })).toMatchObject({ base: 2700, aiAddon: 2900, total: 5600 });
    expect(() => quotePrice({ plan: "custom", currency: "usd", interval: "month", appCount: 1 })).toThrow();
  });
});
