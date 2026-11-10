import type { BadgeTone } from "@/shared/components/data-display/status-badge";
import type {
  CampaignStatus,
  ContactSource,
  DeliveryStatus,
  LifecycleStage,
  MarketingChannel,
  SocialPostStatus,
} from "@/features/marketing/types/constants";
import type { ExclusionReason } from "@/server/marketing/eligibility";

export const CHANNEL_LABELS: Record<MarketingChannel, string> = { email: "Email", sms: "SMS", telegram: "Telegram" };

export const LIFECYCLE_LABELS: Record<LifecycleStage, string> = {
  lead: "Lead",
  prospect: "Prospect",
  customer: "Customer",
  inactive: "Inactive",
};

export const SOURCE_LABELS: Record<ContactSource, string> = {
  manual: "Manual entry",
  import: "Import",
  website: "Website",
  referral: "Referral",
  event: "Event",
  other: "Other",
};

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: "Draft",
  pending_approval: "Pending approval",
  approved: "Approved",
  scheduled: "Scheduled",
  processing: "Sending",
  completed: "Completed",
  cancelled: "Cancelled",
  failed: "Failed",
};

export const CAMPAIGN_STATUS_TONE: Record<CampaignStatus, BadgeTone> = {
  draft: "neutral",
  pending_approval: "warning",
  approved: "info",
  scheduled: "info",
  processing: "warning",
  completed: "success",
  cancelled: "neutral",
  failed: "error",
};

export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  pending: "Pending",
  sending: "Sending",
  sent: "Sent",
  delivered: "Delivered",
  bounced: "Bounced",
  complained: "Complained",
  failed: "Failed",
  suppressed: "Suppressed",
};

export const DELIVERY_STATUS_TONE: Record<DeliveryStatus, BadgeTone> = {
  pending: "neutral",
  sending: "warning",
  sent: "info",
  delivered: "success",
  bounced: "error",
  complained: "error",
  failed: "error",
  suppressed: "warning",
};

export const EXCLUSION_LABELS: Record<ExclusionReason, string> = {
  contact_inactive: "Contact inactive",
  missing_destination: "No valid address",
  no_consent: "No marketing consent",
  suppressed: "On suppression list",
};

export const SOCIAL_STATUS_TONE: Record<SocialPostStatus, BadgeTone> = {
  draft: "neutral",
  scheduled: "info",
  publishing: "warning",
  published: "success",
  failed: "error",
  cancelled: "neutral",
  needs_reconciliation: "warning",
};

/** Plain-language error messages for codes returned by the server. Unknown codes fall back to a generic line. */
export const ERROR_CODE_MESSAGES: Record<string, string> = {
  DENIED: "Authorization was cancelled on Facebook.",
  INVALID_CALLBACK: "The Facebook response was incomplete. Start the connection again.",
  PROVIDER_NOT_CONFIGURED: "This integration is not configured on the server.",
  FORBIDDEN: "You do not have permission for this action or the link has expired.",
  INTERNAL: "The connection could not be completed. Try again later.",
};

export function consentLabel(status: "granted" | "withdrawn" | "not_granted"): string {
  if (status === "granted") return "Granted";
  if (status === "withdrawn") return "Withdrawn";
  return "Not granted";
}

/** Plain-language guidance shown under each contact field, so the user knows what to enter. */
export const SOURCE_HINTS: Record<ContactSource, string> = {
  manual: "You added this person yourself.",
  import: "Came from a spreadsheet or list you imported.",
  website: "Signed up or enquired through your website.",
  referral: "Recommended by an existing customer or partner.",
  event: "Met at a fair, webinar or event.",
  other: "Any other origin.",
};

export const LIFECYCLE_HINTS: Record<LifecycleStage, string> = {
  lead: "Showed interest, not yet in talks with you.",
  prospect: "Actively considering buying from you.",
  customer: "Has bought from you before.",
  inactive: "No longer engaged. Kept on record for history.",
};
