import type { SocialPostStatus } from "@/features/marketing/types/constants";

/**
 * Social post lifecycle. `publishing` is entered before the provider is called. If the provider call
 * times out after the request was sent, the post moves to `needs_reconciliation` and is never
 * retried automatically, which prevents duplicate publications.
 */
export const SOCIAL_POST_TRANSITIONS: Record<SocialPostStatus, readonly SocialPostStatus[]> = {
  draft: ["scheduled", "cancelled"],
  scheduled: ["publishing", "draft", "cancelled"],
  publishing: ["published", "failed", "needs_reconciliation"],
  failed: ["scheduled", "draft", "cancelled"],
  published: [],
  cancelled: [],
  needs_reconciliation: [],
};

export function canTransitionSocialPost(from: SocialPostStatus, to: SocialPostStatus): boolean {
  return SOCIAL_POST_TRANSITIONS[from].includes(to);
}

export const SOCIAL_POST_STATUS_LABELS: Record<SocialPostStatus, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  publishing: "Publishing",
  published: "Published",
  failed: "Failed",
  cancelled: "Cancelled",
  needs_reconciliation: "Needs review",
};

/** Platform limits enforced when a post is saved. */
export const SOCIAL_CONTENT_LIMITS: Record<"facebook_page", number> = {
  facebook_page: 5000,
};
