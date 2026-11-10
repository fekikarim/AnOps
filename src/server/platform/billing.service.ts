import "server-only";
import Stripe from "stripe";
import { ObjectId, type Db } from "mongodb";
import { env, getAppUrl } from "@/config/env";
import { recordAudit } from "@/server/audit/audit.service";
import type { OrgAccess } from "@/server/platform/access";
import { PLATFORM_COLLECTIONS, type BillingInvoiceDoc, type SubscriptionDoc } from "@/server/platform/collections";
import { getSubscriptionDoc } from "@/server/platform/subscription.service";
import { getApplication, isApplicationId, type ApplicationId } from "@/shared/domain/applications";
import { ALLOPS_APP_COUNT, BILLING_CURRENCIES, CUSTOM_MAX_APPS, CUSTOM_MIN_APPS, PLANS, quotePrice, type BillingCurrency, type BillingInterval, type PaidPlanId, type SubscriptionStatus } from "@/shared/domain/plans";
import { AppError } from "@/shared/lib/errors";

let client: Stripe | null = null;

/** Stripe product tax code for "Software as a service (SaaS) - business use" (required by Stripe Managed Payments / Stripe Tax). */
const SAAS_TAX_CODE = "txcd_10103001";

/** Audit actor for changes driven by Stripe (no signed-in person). */
const SYSTEM_ACTOR = new ObjectId("000000000000000000000000");

/** Server-only Stripe client. The secret key never reaches the browser. */
export function getStripe(): Stripe | null {
  if (!env.STRIPE_API_KEY) return null;
  client ??= new Stripe(env.STRIPE_API_KEY, { appInfo: { name: "AnOps" }, maxNetworkRetries: 2, timeout: 20_000 });
  return client;
}

export function billingConfiguration() {
  return {
    payments: Boolean(env.STRIPE_API_KEY),
    testMode: env.STRIPE_API_KEY?.startsWith("sk_test_") || env.STRIPE_API_KEY?.startsWith("rk_test_") || false,
    webhooks: Boolean(env.STRIPE_WEBHOOK_SECRET),
  };
}

function requireStripe(): Stripe {
  const stripe = getStripe();
  if (!stripe) throw new AppError("PROVIDER_NOT_CONFIGURED", "Online payments are not configured yet. Contact AnOps to subscribe.");
  return stripe;
}

function requireOwner(access: OrgAccess) {
  if (access.companyRole !== "owner") throw new AppError("FORBIDDEN", "Only the organization owner can manage the subscription.");
}

const subs = (db: Db) => db.collection<SubscriptionDoc>(PLATFORM_COLLECTIONS.subscriptions);
const invoices = (db: Db) => db.collection<BillingInvoiceDoc>(PLATFORM_COLLECTIONS.billingInvoices);

/** Organizations created before subscriptions get a subscription document the first time they open billing. */
async function ensureSubscriptionDoc(access: OrgAccess): Promise<SubscriptionDoc> {
  const existing = await getSubscriptionDoc(access.ctx.db, access.ctx.companyId);
  if (existing) return existing;
  const company = await access.ctx.db.collection("companies").findOne({ _id: access.ctx.companyId }, { projection: { currency: 1, contactEmail: 1 } });
  const owner = await access.ctx.db.collection("users").findOne({ _id: access.ctx.userId }, { projection: { email: 1 } });
  const now = new Date();
  await subs(access.ctx.db).updateOne(
    { companyId: access.ctx.companyId },
    {
      $setOnInsert: {
        _id: new ObjectId(),
        companyId: access.ctx.companyId,
        // Grandfathered: full access is kept until the owner chooses a paid plan.
        plan: null,
        status: "lapsed",
        legacy: true,
        freeAppId: null,
        trialAppIds: [],
        trialStartedAt: null,
        trialEndsAt: null,
        customAppIds: [],
        aiAddon: false,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        pastDueSince: null,
        billingCurrency: company?.currency === "USD" ? "usd" : "eur",
        billingInterval: null,
        billingEmail: String(company?.contactEmail ?? owner?.email ?? ""),
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        stripeStatus: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
      },
    },
    { upsert: true }
  );
  return (await getSubscriptionDoc(access.ctx.db, access.ctx.companyId)) as SubscriptionDoc;
}

async function ensureCustomer(stripe: Stripe, access: OrgAccess, sub: SubscriptionDoc): Promise<string> {
  if (sub.stripeCustomerId) return sub.stripeCustomerId;
  const company = await access.ctx.db.collection("companies").findOne({ _id: access.ctx.companyId }, { projection: { name: 1 } });
  const customer = await stripe.customers.create(
    { name: String(company?.name ?? "AnOps organization"), email: sub.billingEmail ?? undefined, metadata: { companyId: access.ctx.companyId.toHexString() } },
    { idempotencyKey: `anops-customer-${access.ctx.companyId.toHexString()}` }
  );
  // Only the first writer wins; a concurrent request reuses the stored customer.
  await subs(access.ctx.db).updateOne({ _id: sub._id, stripeCustomerId: null }, { $set: { stripeCustomerId: customer.id, updatedAt: new Date() } });
  return (await getSubscriptionDoc(access.ctx.db, access.ctx.companyId))?.stripeCustomerId ?? customer.id;
}

export type CheckoutInput = { plan: unknown; interval: unknown; currency: unknown; appIds?: unknown; aiAddon?: unknown };

function parseCheckout(input: CheckoutInput) {
  const plan = input.plan;
  if (plan !== "allops" && plan !== "maxops" && plan !== "custom") throw new AppError("VALIDATION_ERROR", "Choose a valid plan.");
  const interval: BillingInterval = input.interval === "year" ? "year" : "month";
  if (!BILLING_CURRENCIES.includes(input.currency as BillingCurrency)) throw new AppError("VALIDATION_ERROR", "Choose a valid billing currency.");
  const currency = input.currency as BillingCurrency;
  let appIds: ApplicationId[] = [];
  if (plan === "custom") {
    if (!Array.isArray(input.appIds) || !input.appIds.every(isApplicationId)) throw new AppError("VALIDATION_ERROR", "Choose valid applications.");
    appIds = [...new Set(input.appIds)];
    if (appIds.length < CUSTOM_MIN_APPS || appIds.length > CUSTOM_MAX_APPS) throw new AppError("VALIDATION_ERROR", `Custom includes ${CUSTOM_MIN_APPS} to ${CUSTOM_MAX_APPS} applications. For more, choose AllOps (${ALLOPS_APP_COUNT} applications, no AI) or MaxOps.`);
  }
  const aiAddon = plan === "custom" && input.aiAddon === true;
  if (appIds.some((id) => getApplication(id).aiNative) && !aiAddon) throw new AppError("VALIDATION_ERROR", "AnOps AI is only available with the AI add-on, MaxOps or a trial.");
  return { plan: plan as PaidPlanId, interval, currency, appIds, aiAddon };
}

/** Creates a Stripe Checkout session for a paid plan. Prices come from the server-side catalogue only. */
export async function createCheckoutSession(access: OrgAccess, input: CheckoutInput): Promise<{ url: string }> {
  requireOwner(access);
  const stripe = requireStripe();
  const order = parseCheckout(input);
  const sub = await ensureSubscriptionDoc(access);
  if (sub.stripeSubscriptionId && sub.status === "active" && sub.plan === order.plan && !sub.cancelAtPeriodEnd && order.plan !== "custom") {
    throw new AppError("CONFLICT", `Your organization is already on ${PLANS[order.plan].name}.`);
  }
  const customer = await ensureCustomer(stripe, access, sub);
  const quote = quotePrice({ plan: order.plan, currency: order.currency, interval: order.interval, appCount: order.appIds.length, aiAddon: order.aiAddon });
  const orgId = access.ctx.companyId.toHexString();
  const base = `${getAppUrl()}/organization/${orgId}/billing`;
  const productName = order.plan === "custom" ? `AnOps Custom (${order.appIds.length} applications)` : `AnOps ${PLANS[order.plan].name}`;
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
    { quantity: 1, price_data: { currency: order.currency, unit_amount: quote.base, recurring: { interval: order.interval }, product_data: { name: productName, tax_code: SAAS_TAX_CODE, metadata: { plan: order.plan } } } },
  ];
  if (order.aiAddon) {
    lineItems.push({ quantity: 1, price_data: { currency: order.currency, unit_amount: quote.aiAddon, recurring: { interval: order.interval }, product_data: { name: "AnOps AI add-on", tax_code: SAAS_TAX_CODE, metadata: { addon: "ai" } } } });
  }
  const metadata = { companyId: orgId, plan: order.plan, apps: order.appIds.join(","), aiAddon: String(order.aiAddon), interval: order.interval };
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: orgId,
    line_items: lineItems,
    subscription_data: { metadata },
    metadata,
    allow_promotion_codes: false,
    billing_address_collection: "auto",
    success_url: `${base}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}?checkout=canceled`,
  });
  await recordAudit(access.ctx.db, { companyId: access.ctx.companyId, actorUserId: access.ctx.userId, action: "billing.checkout_started", entityType: "subscription", entityId: sub._id.toHexString(), requestId: access.ctx.requestId, metadata: { plan: order.plan, interval: order.interval, currency: order.currency, total: quote.total } });
  if (!session.url) throw new AppError("INTERNAL", "Stripe did not return a checkout page.");
  return { url: session.url };
}

// ───────────────────────── Synchronization (authoritative state comes from Stripe) ─────────────────────────

function mapStatus(status: Stripe.Subscription.Status): SubscriptionStatus | null {
  switch (status) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
      return "past_due";
    case "canceled":
      return "canceled";
    case "unpaid":
    case "incomplete_expired":
      return "lapsed";
    default:
      return null; // incomplete / paused: no entitlement change until Stripe settles it
  }
}

function periodEnd(subscription: Stripe.Subscription): Date | null {
  const ends = subscription.items.data.map((item) => item.current_period_end).filter((v): v is number => typeof v === "number");
  return ends.length ? new Date(Math.max(...ends) * 1000) : null;
}

const customerId = (value: string | Stripe.Customer | Stripe.DeletedCustomer | null) => (typeof value === "string" ? value : value?.id ?? null);

/** Applies a Stripe subscription (always freshly retrieved) to the organization's subscription document. */
export async function applyStripeSubscription(db: Db, subscription: Stripe.Subscription, requestId: string): Promise<void> {
  const meta = subscription.metadata ?? {};
  const customer = customerId(subscription.customer);
  const companyIdHex = meta.companyId;
  if (!companyIdHex || !ObjectId.isValid(companyIdHex) || !customer) return;
  const companyId = new ObjectId(companyIdHex);
  const doc = await subs(db).findOne({ companyId });
  // The customer must belong to this organization: metadata alone is never trusted.
  if (!doc || (doc.stripeCustomerId && doc.stripeCustomerId !== customer)) {
    console.warn(`[billing] ignored subscription ${subscription.id}: organization/customer mismatch`);
    return;
  }
  const status = mapStatus(subscription.status);
  if (!status) return;

  // A different subscription is current: only the current one (or a newer active one) may change state.
  if (doc.stripeSubscriptionId && doc.stripeSubscriptionId !== subscription.id && status !== "active") return;

  const plan = meta.plan === "allops" || meta.plan === "maxops" || meta.plan === "custom" ? meta.plan : doc.plan;
  const apps = (meta.apps ?? "").split(",").filter(isApplicationId);
  const now = new Date();
  const replacing = doc.stripeSubscriptionId && doc.stripeSubscriptionId !== subscription.id ? doc.stripeSubscriptionId : null;

  await subs(db).updateOne(
    { _id: doc._id },
    {
      $set: {
        plan,
        status,
        customAppIds: plan === "custom" ? apps : [],
        aiAddon: plan === "custom" && meta.aiAddon === "true",
        currentPeriodEnd: periodEnd(subscription),
        cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
        pastDueSince: status === "past_due" ? (doc.pastDueSince ?? now) : null,
        billingInterval: meta.interval === "year" ? "year" : "month",
        stripeCustomerId: customer,
        stripeSubscriptionId: subscription.id,
        stripeStatus: subscription.status,
        legacy: false,
        updatedAt: now,
      },
      $inc: { version: 1 },
    }
  );
  await recordAudit(db, { companyId, actorUserId: SYSTEM_ACTOR, action: "billing.subscription_synced", entityType: "subscription", entityId: subscription.id, requestId, metadata: { status: subscription.status, plan: String(plan) } });

  // Plan change through a new Checkout: the previous subscription stops so the organization is never billed twice.
  if (replacing && status === "active") {
    const stripe = getStripe();
    try {
      await stripe?.subscriptions.cancel(replacing, { prorate: true });
    } catch {
      console.error(`[billing] could not cancel replaced subscription ${replacing}`);
    }
  }
}

export async function upsertInvoice(db: Db, invoice: Stripe.Invoice): Promise<void> {
  const customer = customerId(invoice.customer);
  if (!customer || !invoice.id) return;
  const doc = await subs(db).findOne({ stripeCustomerId: customer }, { projection: { companyId: 1 } });
  if (!doc) return;
  const line = invoice.lines?.data?.[0];
  await invoices(db).updateOne(
    { stripeInvoiceId: invoice.id },
    {
      $set: {
        companyId: doc.companyId,
        number: invoice.number ?? null,
        status: invoice.status ?? "draft",
        currency: invoice.currency,
        amountDue: invoice.amount_due,
        amountPaid: invoice.amount_paid,
        hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
        invoicePdf: invoice.invoice_pdf ?? null,
        periodStart: line?.period?.start ? new Date(line.period.start * 1000) : null,
        periodEnd: line?.period?.end ? new Date(line.period.end * 1000) : null,
        issuedAt: new Date(invoice.created * 1000),
        updatedAt: new Date(),
      },
      $setOnInsert: { _id: new ObjectId() },
    },
    { upsert: true }
  );
}

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const parent = invoice.parent;
  if (parent?.type === "subscription_details") {
    const sub = parent.subscription_details?.subscription;
    return typeof sub === "string" ? sub : sub?.id ?? null;
  }
  return null;
}

/** Webhook entry point. Idempotent: each Stripe event id is processed once; a failure releases it for Stripe's retry. */
export async function handleStripeEvent(db: Db, event: Stripe.Event, requestId: string): Promise<"processed" | "duplicate" | "ignored"> {
  const stripe = requireStripe();
  const events = db.collection<{ _id: string; type: string; receivedAt: Date }>(PLATFORM_COLLECTIONS.stripeEvents);
  try {
    await events.insertOne({ _id: event.id, type: event.type, receivedAt: new Date() });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return "duplicate";
    throw error;
  }
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
        if (subId) await applyStripeSubscription(db, await stripe.subscriptions.retrieve(subId), requestId);
        return "processed";
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        // Re-fetch: the event payload may be older than the current state (out-of-order delivery).
        const fresh = event.type === "customer.subscription.deleted" ? subscription : await stripe.subscriptions.retrieve(subscription.id);
        await applyStripeSubscription(db, fresh, requestId);
        return "processed";
      }
      case "invoice.paid":
      case "invoice.payment_failed":
      case "invoice.finalized":
      case "invoice.voided": {
        const invoice = event.data.object as Stripe.Invoice;
        await upsertInvoice(db, invoice);
        const subId = invoiceSubscriptionId(invoice);
        if (subId) await applyStripeSubscription(db, await stripe.subscriptions.retrieve(subId), requestId);
        return "processed";
      }
      default:
        return "ignored";
    }
  } catch (error) {
    await events.deleteOne({ _id: event.id });
    throw error;
  }
}

/**
 * Called when the owner returns from Checkout. The redirect is NOT proof of payment: the session is
 * retrieved from Stripe and must belong to this organization before anything is applied.
 */
export async function reconcileCheckout(access: OrgAccess, sessionId: unknown): Promise<"active" | "pending" | "ignored"> {
  const stripe = getStripe();
  if (!stripe || typeof sessionId !== "string" || !/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) return "ignored";
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.client_reference_id !== access.ctx.companyId.toHexString()) return "ignored";
  const doc = await getSubscriptionDoc(access.ctx.db, access.ctx.companyId);
  if (!doc?.stripeCustomerId || customerId(session.customer) !== doc.stripeCustomerId) return "ignored";
  if (session.status !== "complete" || !session.subscription) return "pending";
  const subId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
  const subscription = await stripe.subscriptions.retrieve(subId);
  await applyStripeSubscription(access.ctx.db, subscription, access.ctx.requestId);
  return mapStatus(subscription.status) === "active" ? "active" : "pending";
}

export async function setCancelAtPeriodEnd(access: OrgAccess, cancel: boolean): Promise<void> {
  requireOwner(access);
  const stripe = requireStripe();
  const doc = await getSubscriptionDoc(access.ctx.db, access.ctx.companyId);
  if (!doc?.stripeSubscriptionId) throw new AppError("INVALID_TRANSITION", "There is no paid subscription to change.");
  const updated = await stripe.subscriptions.update(doc.stripeSubscriptionId, { cancel_at_period_end: cancel });
  await applyStripeSubscription(access.ctx.db, updated, access.ctx.requestId);
  await recordAudit(access.ctx.db, { companyId: access.ctx.companyId, actorUserId: access.ctx.userId, action: cancel ? "billing.cancel_scheduled" : "billing.cancel_reverted", entityType: "subscription", entityId: doc.stripeSubscriptionId, requestId: access.ctx.requestId });
}

export async function createPortalSession(access: OrgAccess): Promise<{ url: string }> {
  requireOwner(access);
  const stripe = requireStripe();
  const doc = await getSubscriptionDoc(access.ctx.db, access.ctx.companyId);
  if (!doc?.stripeCustomerId) throw new AppError("INVALID_TRANSITION", "Subscribe to a paid plan first.");
  try {
    const portal = await stripe.billingPortal.sessions.create({ customer: doc.stripeCustomerId, return_url: `${getAppUrl()}/organization/${access.ctx.companyId.toHexString()}/billing` });
    return { url: portal.url };
  } catch (error) {
    if (error instanceof Stripe.errors.StripeInvalidRequestError) throw new AppError("PROVIDER_NOT_CONFIGURED", "The Stripe customer portal is not configured yet (Stripe Dashboard → Settings → Billing → Customer portal).");
    throw error;
  }
}

export type InvoiceView = { id: string; number: string | null; status: string; total: string; issuedAt: string; hostedInvoiceUrl: string | null; invoicePdf: string | null };

export async function listInvoices(db: Db, companyId: ObjectId): Promise<InvoiceView[]> {
  const docs = await invoices(db).find({ companyId }).sort({ issuedAt: -1 }).limit(48).toArray();
  return docs.map((doc) => ({
    id: doc._id.toHexString(),
    number: doc.number,
    status: doc.status,
    total: new Intl.NumberFormat("en-US", { style: "currency", currency: doc.currency.toUpperCase() }).format((doc.status === "paid" ? doc.amountPaid : doc.amountDue) / 100),
    issuedAt: doc.issuedAt.toISOString(),
    hostedInvoiceUrl: doc.hostedInvoiceUrl,
    invoicePdf: doc.invoicePdf,
  }));
}
