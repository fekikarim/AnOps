import type { BadgeTone } from "@/shared/components/data-display/status-badge";

/** Status labels and tones for purchasing. Kept out of page files, which may only export route config. */
export const PO_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  draft: { label: "Draft", tone: "neutral" },
  approved: { label: "Approved", tone: "info" },
  partially_received: { label: "Partially received", tone: "warning" },
  received: { label: "Received", tone: "success" },
  cancelled: { label: "Cancelled", tone: "error" },
};

export const RECEIPT_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  draft: { label: "Draft", tone: "neutral" },
  posted: { label: "Posted", tone: "success" },
  cancelled: { label: "Cancelled", tone: "error" },
};
