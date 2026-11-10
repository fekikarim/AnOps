import "server-only";
import type { IndexDescription, ObjectId } from "mongodb";
import type { ApplicationId } from "@/shared/domain/applications";
import type { BillingCurrency, BillingInterval, SubscriptionState } from "@/shared/domain/plans";

/**
 * Platform collections: organization lifecycle, subscriptions, invitations and billing.
 * The organization is the existing `companies` document; these collections all reference it by companyId.
 */
export const PLATFORM_COLLECTIONS = {
  subscriptions: "organization_subscriptions",
  activationTokens: "activation_tokens",
  invitations: "organization_invitations",
  billingInvoices: "billing_invoices",
  stripeEvents: "stripe_events",
  registrationLocks: "registration_locks",
} as const;

export type OrganizationActivationStatus = "pending" | "active";

export type SubscriptionDoc = SubscriptionState & {
  _id: ObjectId;
  companyId: ObjectId;
  billingCurrency: BillingCurrency;
  billingInterval: BillingInterval | null;
  billingEmail: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripeStatus: string | null;
  /** Set for organizations that predate subscriptions: grandfathered full access. */
  legacy?: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

export type ActivationTokenDoc = {
  _id: ObjectId;
  tokenHash: string;
  userId: ObjectId;
  companyId: ObjectId;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
};

export type InvitationRole = "admin" | "manager" | "employee";
export type InvitationStatus = "pending" | "accepted" | "revoked";

export type InvitationDoc = {
  _id: ObjectId;
  companyId: ObjectId;
  email: string;
  role: InvitationRole;
  appAccess: ApplicationId[] | null;
  tokenHash: string;
  status: InvitationStatus;
  invitedBy: ObjectId;
  expiresAt: Date;
  sentAt: Date;
  sendCount: number;
  acceptedAt: Date | null;
  acceptedUserId: ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
};

export type BillingInvoiceDoc = {
  _id: ObjectId;
  companyId: ObjectId;
  stripeInvoiceId: string;
  number: string | null;
  status: string;
  currency: string;
  amountDue: number;
  amountPaid: number;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  issuedAt: Date;
  updatedAt: Date;
};

export const PLATFORM_INDEXES: Record<string, IndexDescription[]> = {
  [PLATFORM_COLLECTIONS.subscriptions]: [
    { key: { companyId: 1 }, name: "subscription_company_unique", unique: true },
    { key: { stripeSubscriptionId: 1 }, name: "subscription_stripe_sub", partialFilterExpression: { stripeSubscriptionId: { $type: "string" } } },
    { key: { stripeCustomerId: 1 }, name: "subscription_stripe_customer", partialFilterExpression: { stripeCustomerId: { $type: "string" } } },
    { key: { status: 1, trialEndsAt: 1 }, name: "subscription_status_trial" },
  ],
  [PLATFORM_COLLECTIONS.activationTokens]: [
    { key: { tokenHash: 1 }, name: "activation_token_hash_unique", unique: true },
    { key: { companyId: 1, createdAt: -1 }, name: "activation_company_time" },
  ],
  [PLATFORM_COLLECTIONS.invitations]: [
    { key: { tokenHash: 1 }, name: "invitation_token_hash_unique", unique: true },
    { key: { companyId: 1, status: 1, createdAt: -1 }, name: "invitation_company_status" },
    {
      key: { companyId: 1, email: 1 },
      name: "invitation_pending_email_unique",
      unique: true,
      partialFilterExpression: { status: "pending" },
    },
  ],
  [PLATFORM_COLLECTIONS.billingInvoices]: [
    { key: { stripeInvoiceId: 1 }, name: "invoice_stripe_unique", unique: true },
    { key: { companyId: 1, issuedAt: -1 }, name: "invoice_company_time" },
  ],
  [PLATFORM_COLLECTIONS.stripeEvents]: [{ key: { receivedAt: 1 }, name: "stripe_event_ttl", expireAfterSeconds: 60 * 60 * 24 * 90 }],
  [PLATFORM_COLLECTIONS.registrationLocks]: [{ key: { createdAt: 1 }, name: "registration_lock_ttl", expireAfterSeconds: 60 * 10 }],
  companies: [{ key: { activationStatus: 1, activationDeadline: 1 }, name: "company_activation_deadline" }],
};
