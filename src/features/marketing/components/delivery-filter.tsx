"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, selectClass } from "@/shared/components/ui/button";
import { useToast } from "@/shared/components/ui/toast";
import { DELIVERY_STATUS_LABELS } from "@/features/marketing/labels";
import { DELIVERY_STATUSES, type DeliveryStatus } from "@/features/marketing/types/constants";

/** Filters the delivery list by status. Applying confirms the change, and "Show all" resets it. */
export function DeliveryFilter({ campaignId, current, matching, total }: { campaignId: string; current: "all" | DeliveryStatus; matching: number; total: number }) {
  const router = useRouter();
  const toast = useToast();
  const [choice, setChoice] = useState<"all" | DeliveryStatus>(current);
  // Plain navigation, no transition: a transition on a same-URL push never settles, which left the button disabled.
  const apply = (status: "all" | DeliveryStatus) => {
    if (status === current) {
      toast.info(status === "all" ? "Already showing all deliveries" : `Already filtered to ${DELIVERY_STATUS_LABELS[status]}`);
      return;
    }
    router.push(status === "all" ? `/marketing/campaigns/${campaignId}` : `/marketing/campaigns/${campaignId}?status=${status}`);
    toast.info(
      status === "all" ? "Showing all deliveries" : `Filtered to ${DELIVERY_STATUS_LABELS[status]}`,
      status === "all" ? `${total} recipient${total === 1 ? "" : "s"} in this campaign` : "The list below is updated"
    );
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="space-y-1">
        <label htmlFor="delivery-status" className="text-xs font-semibold">Status</label>
        <select id="delivery-status" className={selectClass} value={choice} onChange={(event) => setChoice(event.target.value as "all" | DeliveryStatus)}>
          <option value="all">All statuses</option>
          {DELIVERY_STATUSES.map((status) => (
            <option key={status} value={status}>{DELIVERY_STATUS_LABELS[status]}</option>
          ))}
        </select>
      </div>
      <div className="flex gap-2">
        <Button variant="primary" onClick={() => apply(choice)}>Apply filter</Button>
        {current !== "all" && <Button onClick={() => { setChoice("all"); apply("all"); }}>Show all</Button>}
      </div>
      <p className="text-sm text-[var(--color-text-secondary)] sm:ml-auto" aria-live="polite">
        {current === "all" ? `Showing all ${total}` : `Showing ${matching} of ${total} with status ${DELIVERY_STATUS_LABELS[current]}`}
      </p>
    </div>
  );
}
