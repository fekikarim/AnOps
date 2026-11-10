import type { Metadata } from "next";
import { BillingCenter, type BillingData } from "@/features/platform/components/billing-center";
import { getPageOrganization } from "@/server/platform/access";
import { billingConfiguration, listInvoices, reconcileCheckout } from "@/server/platform/billing.service";
import { getSubscriptionDoc, getEntitlements, toState } from "@/server/platform/subscription.service";
import { freeFallbackChoices } from "@/shared/domain/plans";

export const metadata: Metadata = { title: "Subscription & billing" };

export default async function BillingPage({ params, searchParams }: { params: Promise<{ orgId: string }>; searchParams: Promise<{ checkout?: string; session_id?: string; plan?: string }> }) {
  const { orgId } = await params;
  const query = await searchParams;
  let access = await getPageOrganization(orgId);
  const isOwner = access.companyRole === "owner";

  let checkoutResult: BillingData["checkoutResult"] = null;
  if (query.checkout === "success" && isOwner) {
    // Server-side verification with Stripe; the redirect itself proves nothing.
    try {
      const outcome = await reconcileCheckout(access, query.session_id);
      checkoutResult = outcome === "ignored" ? null : outcome;
    } catch {
      checkoutResult = "pending";
    }
    access = { ...access, entitlements: await getEntitlements(access.ctx.db, access.ctx.companyId) };
  } else if (query.checkout === "canceled") checkoutResult = "canceled";

  const [doc, invoices] = await Promise.all([getSubscriptionDoc(access.ctx.db, access.ctx.companyId), listInvoices(access.ctx.db, access.ctx.companyId)]);
  const ent = access.entitlements;
  const owner = await access.ctx.db.collection("users").findOne({ _id: access.ctx.userId }, { projection: { email: 1 } });

  const data: BillingData = {
    orgId,
    isOwner,
    kind: ent.kind,
    plan: ent.plan,
    appIds: ent.appIds,
    aiFeatures: ent.aiFeatures,
    trialDaysLeft: ent.trialDaysLeft,
    trialEndsAt: ent.trialEndsAt?.toISOString() ?? null,
    currentPeriodEnd: doc?.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: Boolean(doc?.cancelAtPeriodEnd),
    accessEndsAt: ent.accessEndsAt?.toISOString() ?? null,
    hasStripeSubscription: Boolean(doc?.stripeSubscriptionId) && (doc?.status === "active" || doc?.status === "past_due"),
    billingEmail: doc?.billingEmail ?? String(owner?.email ?? ""),
    billingCurrency: doc?.billingCurrency ?? (access.organization.currency === "USD" ? "usd" : "eur"),
    billingInterval: doc?.billingInterval ?? null,
    freeAppId: doc?.freeAppId ?? null,
    fallbackChoices: freeFallbackChoices(toState(doc)),
    needsPlanSelection: ent.needsPlanSelection,
    config: billingConfiguration(),
    invoices,
    checkoutResult,
    preselect: query.plan === "allops" || query.plan === "maxops" || query.plan === "custom" ? query.plan : null,
  };

  return <BillingCenter data={data} />;
}
