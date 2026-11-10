import { APPLICATION_IDS, getApplication, isApplicationId, type ApplicationId } from "@/shared/domain/applications";

/**
 * Subscription plans, prices and the pure entitlement rules. Everything that decides what an
 * organization may use is computed here from the stored subscription state, so the server, the
 * route guard and the UI can never disagree. Prices: see docs/karim-feki/PRICING_RESEARCH.md.
 */
export const TRIAL_DAYS = 15;
export const MAX_TRIAL_APPS = 3;
export const ACTIVATION_HOURS = 12;
export const PAST_DUE_GRACE_DAYS = 7;
export const CUSTOM_MIN_APPS = 2;
/** Total applications, and the applications of a plan without AI (everything except AI-native apps). */
export const TOTAL_APP_COUNT = APPLICATION_IDS.length;
export const ALLOPS_APP_COUNT = APPLICATION_IDS.filter((id) => !getApplication(id).aiNative).length;
/** AllOps includes every application except the AI-native ones (see aiNative), so Custom stays strictly below it. */
export const CUSTOM_MAX_APPS = APPLICATION_IDS.filter((id) => !getApplication(id).aiNative).length - 1;

export type PlanId = "oneops" | "allops" | "maxops" | "custom";
export type PaidPlanId = Exclude<PlanId, "oneops">;
export type BillingInterval = "month" | "year";
export type BillingCurrency = "usd" | "eur";

export const BILLING_CURRENCIES: BillingCurrency[] = ["usd", "eur"];

export type PlanDefinition = {
  id: PlanId;
  name: string;
  tagline: string;
  apps: "one" | "selected" | "all";
  ai: "none" | "addon" | "included";
  features: string[];
};

export const PLANS: Record<PlanId, PlanDefinition> = {
  oneops: {
    id: "oneops",
    name: "OneOps",
    tagline: "One application, free forever.",
    apps: "one",
    ai: "none",
    features: ["One application, chosen once", "Unlimited users", "No expiration", "No credit card"],
  },
  custom: {
    id: "custom",
    name: "Custom",
    tagline: "Only the applications you need.",
    apps: "selected",
    ai: "addon",
    features: [`${CUSTOM_MIN_APPS} to ${CUSTOM_MAX_APPS} applications of your choice`, "Unlimited users", "Always priced below AllOps", "AnOps AI and AI features only with the AI add-on"],
  },
  allops: {
    id: "allops",
    name: "AllOps",
    tagline: "Every application, one workspace.",
    apps: "all",
    ai: "none",
    features: [`${ALLOPS_APP_COUNT} applications (everything except AnOps AI)`, "Unlimited users", "Centralized organization workspace", "No AI features anywhere"],
  },
  maxops: {
    id: "maxops",
    name: "MaxOps",
    tagline: "Every application with the complete AI ecosystem.",
    apps: "all",
    ai: "included",
    features: [`All ${TOTAL_APP_COUNT} applications, including AnOps AI`, "Unlimited users", "AnOps AI Command Center", "AI features in every application"],
  },
};

/** Monthly prices in minor units (cents). Annual = 10 × monthly. */
const MONTHLY: Record<BillingCurrency, { allops: number; maxops: number; customPerApp: number; customCap: number; aiAddon: number }> = {
  usd: { allops: 4900, maxops: 9900, customPerApp: 900, customCap: 4500, aiAddon: 2900 },
  eur: { allops: 4500, maxops: 8900, customPerApp: 800, customCap: 4200, aiAddon: 2700 },
};

export const ANNUAL_MONTHS_CHARGED = 10;

export type PriceQuote = { currency: BillingCurrency; interval: BillingInterval; base: number; aiAddon: number; total: number };

export function quotePrice(input: { plan: PaidPlanId; currency: BillingCurrency; interval: BillingInterval; appCount?: number; aiAddon?: boolean }): PriceQuote {
  const table = MONTHLY[input.currency];
  let base: number;
  if (input.plan === "allops") base = table.allops;
  else if (input.plan === "maxops") base = table.maxops;
  else {
    const count = input.appCount ?? 0;
    if (count < CUSTOM_MIN_APPS || count > CUSTOM_MAX_APPS) throw new Error(`Custom needs ${CUSTOM_MIN_APPS} to ${CUSTOM_MAX_APPS} applications.`);
    base = Math.min(count * table.customPerApp, table.customCap);
  }
  const addon = input.plan === "custom" && input.aiAddon ? table.aiAddon : 0;
  const factor = input.interval === "year" ? ANNUAL_MONTHS_CHARGED : 1;
  return { currency: input.currency, interval: input.interval, base: base * factor, aiAddon: addon * factor, total: (base + addon) * factor };
}

export function formatMoney(minor: number, currency: BillingCurrency, locale = "en-US"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: currency.toUpperCase(), minimumFractionDigits: minor % 100 === 0 ? 0 : 2 }).format(minor / 100);
}

/** Default billing currency for an organization's preferred currency. TND organizations are billed in EUR. */
export function billingCurrencyFor(orgCurrency: string | undefined): BillingCurrency {
  return orgCurrency?.toUpperCase() === "USD" ? "usd" : "eur";
}

// ───────────────────────── Subscription state & entitlements ─────────────────────────

export type SubscriptionStatus = "free" | "trialing" | "active" | "past_due" | "canceled" | "lapsed";

/** Stored per organization (collection `organization_subscriptions`). Dates are real Date objects. */
export type SubscriptionState = {
  plan: PlanId | null;
  status: SubscriptionStatus;
  /** The permanent OneOps application. Set once, never changed. */
  freeAppId: ApplicationId | null;
  trialAppIds: ApplicationId[];
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  customAppIds: ApplicationId[];
  aiAddon: boolean;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  pastDueSince: Date | null;
};

export type AccessKind = "legacy" | "free" | "trial" | "trial_expired" | "paid" | "grace" | "canceling" | "lapsed";

export type Entitlements = {
  kind: AccessKind;
  plan: PlanId | null;
  appIds: ApplicationId[];
  aiFeatures: boolean;
  /** The owner must choose a plan (or the one-time OneOps fallback) before applications reopen. */
  needsPlanSelection: boolean;
  trialEndsAt: Date | null;
  trialDaysLeft: number | null;
  /** Date after which access stops (grace end, cancel date) when relevant. */
  accessEndsAt: Date | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function paidApps(state: SubscriptionState): ApplicationId[] {
  if (state.plan === "allops" || state.plan === "maxops") return [...APPLICATION_IDS]; // AI-native apps are removed below when the plan has no AI
  if (state.plan === "custom") return state.customAppIds.filter(isApplicationId);
  if (state.plan === "oneops" && state.freeAppId && isApplicationId(state.freeAppId)) return [state.freeAppId];
  return [];
}

function paidAi(state: SubscriptionState): boolean {
  return state.plan === "maxops" || (state.plan === "custom" && state.aiAddon);
}

const NONE = (kind: AccessKind, plan: PlanId | null, extra: Partial<Entitlements> = {}): Entitlements => ({
  kind,
  plan,
  appIds: [],
  aiFeatures: false,
  needsPlanSelection: true,
  trialEndsAt: null,
  trialDaysLeft: null,
  accessEndsAt: null,
  ...extra,
});

/**
 * The single answer to "what may this organization use right now?".
 * A missing subscription means the organization predates subscriptions: it keeps full access (grandfathered).
 */
export function resolveEntitlements(state: SubscriptionState | null, now: Date = new Date()): Entitlements {
  return withoutAiApps(resolveRaw(state, now));
}

/** AI-native applications (AnOps AI) are never part of an entitlement that has no AI features. */
function withoutAiApps(entitlements: Entitlements): Entitlements {
  // Stored values for applications that no longer exist (e.g. the retired Company app) are dropped.
  entitlements = { ...entitlements, appIds: entitlements.appIds.filter(isApplicationId) };
  if (entitlements.aiFeatures) return entitlements;
  return { ...entitlements, appIds: entitlements.appIds.filter((id) => !getApplication(id).aiNative) };
}

function resolveRaw(state: SubscriptionState | null, now: Date): Entitlements {
  if (!state) {
    return { kind: "legacy", plan: null, appIds: [...APPLICATION_IDS], aiFeatures: true, needsPlanSelection: false, trialEndsAt: null, trialDaysLeft: null, accessEndsAt: null };
  }
  const base = { trialEndsAt: state.trialEndsAt, trialDaysLeft: null, accessEndsAt: null } as const;

  switch (state.status) {
    case "free":
      return state.freeAppId && isApplicationId(state.freeAppId)
        ? { ...base, kind: "free", plan: "oneops", appIds: [state.freeAppId], aiFeatures: false, needsPlanSelection: false }
        : NONE("lapsed", "oneops");
    case "trialing": {
      if (state.trialEndsAt && now < state.trialEndsAt) {
        const left = Math.max(1, Math.ceil((state.trialEndsAt.getTime() - now.getTime()) / DAY_MS));
        return { ...base, kind: "trial", plan: null, appIds: state.trialAppIds.filter(isApplicationId), aiFeatures: true, needsPlanSelection: false, trialDaysLeft: left };
      }
      return NONE("trial_expired", null, { trialEndsAt: state.trialEndsAt, trialDaysLeft: 0 });
    }
    case "active":
      if (state.cancelAtPeriodEnd && state.currentPeriodEnd) {
        if (now >= state.currentPeriodEnd) return NONE("lapsed", state.plan);
        return { ...base, kind: "canceling", plan: state.plan, appIds: paidApps(state), aiFeatures: paidAi(state), needsPlanSelection: false, accessEndsAt: state.currentPeriodEnd };
      }
      return { ...base, kind: "paid", plan: state.plan, appIds: paidApps(state), aiFeatures: paidAi(state), needsPlanSelection: false };
    case "past_due": {
      const since = state.pastDueSince ?? now;
      const graceEnd = new Date(since.getTime() + PAST_DUE_GRACE_DAYS * DAY_MS);
      if (now < graceEnd) {
        return { ...base, kind: "grace", plan: state.plan, appIds: paidApps(state), aiFeatures: paidAi(state), needsPlanSelection: false, accessEndsAt: graceEnd };
      }
      return NONE("lapsed", state.plan);
    }
    case "canceled":
      if (state.currentPeriodEnd && now < state.currentPeriodEnd) {
        return { ...base, kind: "canceling", plan: state.plan, appIds: paidApps(state), aiFeatures: paidAi(state), needsPlanSelection: false, accessEndsAt: state.currentPeriodEnd };
      }
      return NONE("lapsed", state.plan);
    case "lapsed":
    default:
      // A trial that ended without a plan stays a "trial_expired" experience for the owner.
      if (!state.plan && state.trialEndsAt) return NONE("trial_expired", null, { trialEndsAt: state.trialEndsAt, trialDaysLeft: 0 });
      return NONE("lapsed", state.plan);
  }
}

/** Applications the organization may pick as its permanent OneOps application right now. */
export function freeFallbackChoices(state: SubscriptionState | null): ApplicationId[] {
  if (!state) return [];
  if (state.freeAppId) return [state.freeAppId];
  const candidates = state.trialAppIds.length > 0 ? state.trialAppIds : [...APPLICATION_IDS];
  return candidates.filter((id) => id !== "ai" && getApplication(id).status === "available");
}

// ───────────────────────── Trial selection ─────────────────────────

export type TrialSelection = { ok: true; kind: "free" | "trial"; appIds: ApplicationId[] } | { ok: false; message: string };

/** Validates the /trial selection. Runs in the browser for feedback and again on the server, which is authoritative. */
export function validateTrialSelection(raw: unknown): TrialSelection {
  if (!Array.isArray(raw)) return { ok: false, message: "Choose at least one application." };
  const ids = [...new Set(raw)];
  if (ids.length !== raw.length) return { ok: false, message: "Each application can be selected once." };
  if (!ids.every(isApplicationId)) return { ok: false, message: "One of the selected applications does not exist." };
  if (ids.length === 0) return { ok: false, message: "Choose at least one application." };
  if (ids.length > MAX_TRIAL_APPS) return { ok: false, message: `You can select up to ${MAX_TRIAL_APPS} applications.` };
  const unavailable = (ids as ApplicationId[]).filter((id) => getApplication(id).status !== "available");
  if (unavailable.length > 0) {
    return { ok: false, message: `${unavailable.map((id) => getApplication(id).name).join(" and ")} ${unavailable.length > 1 ? "are" : "is"} coming soon and cannot be selected yet.` };
  }
  if (ids.includes("ai")) {
    return { ok: false, message: "AnOps AI is only available with the MaxOps plan and cannot be selected for a trial or the free plan." };
  }
  return { ok: true, kind: ids.length === 1 ? "free" : "trial", appIds: ids as ApplicationId[] };
}

/** Initial subscription state created at registration. */
export function initialSubscriptionState(selection: { kind: "free" | "trial"; appIds: ApplicationId[] }, now: Date = new Date()): SubscriptionState {
  const empty: SubscriptionState = {
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
  };
  if (selection.kind === "free") return { ...empty, plan: "oneops", status: "free", freeAppId: selection.appIds[0] };
  return { ...empty, status: "trialing", trialAppIds: selection.appIds, trialStartedAt: now, trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * DAY_MS) };
}

/** Organization entitlement intersected with a member's application access. Owners and admins see everything entitled. */
export function effectiveApps(entitlements: Pick<Entitlements, "appIds">, member: { companyRole: string; appAccess: ApplicationId[] | null }): ApplicationId[] {
  if (member.companyRole === "owner" || member.companyRole === "admin" || !member.appAccess) return entitlements.appIds;
  const allowed = new Set(member.appAccess);
  return entitlements.appIds.filter((id) => allowed.has(id));
}
