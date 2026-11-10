import type { CampaignStatus } from "@/features/marketing/types/constants";

/**
 * Campaign lifecycle. Each transition is enforced on the server with a conditional update that also
 * checks the expected status and version, so two users cannot both approve or schedule the same
 * campaign. Delivery state is separate and lives on marketing_deliveries.
 */
export const CAMPAIGN_TRANSITIONS: Record<CampaignStatus, readonly CampaignStatus[]> = {
  draft: ["pending_approval", "cancelled"],
  pending_approval: ["approved", "draft"],
  approved: ["scheduled", "cancelled"],
  scheduled: ["processing", "cancelled"],
  processing: ["completed", "failed"],
  completed: [],
  cancelled: [],
  failed: [],
};

export function canTransitionCampaign(from: CampaignStatus, to: CampaignStatus): boolean {
  return CAMPAIGN_TRANSITIONS[from].includes(to);
}

/** Content and audience can change only while the campaign is a draft. */
export function isCampaignEditable(status: CampaignStatus): boolean {
  return status === "draft";
}

/** Cancellation is possible until the dispatch worker has started sending. */
export function isCampaignCancellable(status: CampaignStatus): boolean {
  return status === "draft" || status === "pending_approval" || status === "approved" || status === "scheduled";
}

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

