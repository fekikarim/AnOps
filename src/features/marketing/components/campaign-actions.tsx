"use client";

import { confirmAction } from "@/shared/components/ui/confirm-dialog";
import { useToast } from "@/shared/components/ui/toast";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  approveCampaignAction,
  cancelCampaignAction,
  deleteCampaignAction,
  duplicateCampaignAction,
  returnCampaignAction,
  scheduleCampaignAction,
  submitCampaignAction,
} from "@/features/marketing/actions/campaigns.action";
import { Button } from "@/shared/components/ui/button";
import { tunisiaLocalToIso } from "@/features/marketing/utils/datetime";
import type { CampaignDto } from "@/server/marketing/campaign.service";
import Link from "next/link";


/**
 * Lifecycle controls. Each button maps to one server action, which re-checks permission and the current
 * state. The buttons shown here only reflect what the server reported for this user.
 */
export function CampaignActions({
  campaign,
  providerReady,
  channelLabel,
}: {
  campaign: CampaignDto;
  providerReady: boolean;
  channelLabel: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const toast = useToast();
  const [when, setWhen] = useState("");
  const actions = campaign.actions;
  const version = campaign.version;

  const run = (task: () => Promise<{ ok: boolean; error?: { message: string }; data?: unknown }>, success: string, after?: (data: unknown) => void) =>
    startTransition(async () => {
      const result = await task();
      if (!result.ok) return toast.fromError(result.error);
      toast.success(success);
      if (after) after(result.data);
      router.refresh();
    });

  const none = !actions.canSubmit && !actions.canReturn && !actions.canApprove && !actions.canSchedule && !actions.canCancel && !actions.canDelete && !actions.canDuplicate;

  return (
    <section aria-labelledby="campaign-actions" className="space-y-4 rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5">
      <h2 id="campaign-actions" className="text-base font-semibold">Lifecycle</h2>
      {none && <p className="text-sm text-[var(--color-text-secondary)]">No actions are available for your role in this state.</p>}

      <div className="flex flex-wrap gap-2">
        {actions.canSubmit && (
          <Button variant="primary" disabled={pending} onClick={() => run(() => submitCampaignAction(campaign.id, { expectedVersion: version }), "Sent for approval. The content is now locked.")}>
            Submit for approval
          </Button>
        )}
        {actions.canApprove && (
          <Button variant="primary" disabled={pending} onClick={() => run(() => approveCampaignAction(campaign.id, { expectedVersion: version }), "Approved. Recipients are now fixed for this campaign.")}>
            Approve and freeze recipients
          </Button>
        )}
        {actions.canReturn && (
          <Button disabled={pending} onClick={() => run(() => returnCampaignAction(campaign.id, { expectedVersion: version }), "Returned to draft.")}>
            Return to draft
          </Button>
        )}
        {actions.canDuplicate && (
          <Button disabled={pending} onClick={() => run(() => duplicateCampaignAction(campaign.id), "Copied as a new draft.", (data) => {
            const copy = data as { id: string };
            router.push(`/marketing/campaigns/${copy.id}`);
          })}>
            Duplicate
          </Button>
        )}
        {actions.canDelete && (
          <Button variant="danger" disabled={pending} onClick={async () => {
            if (!(await confirmAction({ title: "Delete this draft?", message: "The draft is permanently removed. This cannot be undone.", tone: "danger", confirmLabel: "Delete draft" }))) return;
            startTransition(async () => {
              const result = await deleteCampaignAction(campaign.id);
              if (!result.ok) return toast.fromError(result.error);
              router.push("/marketing/campaigns");
              router.refresh();
            });
          }}>
            Delete draft
          </Button>
        )}
        {actions.canCancel && (
          <Button variant="danger" disabled={pending} onClick={async () => {
            if (!(await confirmAction({ title: "Cancel this campaign?", message: "Recipients will not be contacted.", tone: "warning", confirmLabel: "Cancel campaign", cancelLabel: "Keep campaign" }))) return;
            run(() => cancelCampaignAction(campaign.id, { expectedVersion: version }), "Campaign cancelled.");
          }}>
            Cancel campaign
          </Button>
        )}
      </div>

      {actions.canSchedule && (
        <div className="space-y-3 rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)] p-4">
          <p className="text-sm font-semibold">Schedule sending</p>
          {!providerReady ? (
            <div role="status" className="space-y-1 text-sm text-[var(--color-text-primary)]">
              <p className="font-semibold text-[var(--color-status-warning)]">Sending is unavailable</p>
              <p>
                No {channelLabel} provider is connected on this server. Nothing will be sent, and this campaign can&apos;t be scheduled until one is.{" "}
                <Link className="underline" href="/marketing/integrations">See integrations</Link>
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="space-y-1.5">
                  <label htmlFor="when" className="text-sm font-semibold">Send at (Tunisia time, optional)</label>
                  <input id="when" type="datetime-local" value={when} onChange={(event) => setWhen(event.target.value)} className="min-h-[44px] w-full rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3 text-sm sm:w-auto" />
                </div>
                <Button variant="primary" disabled={pending} onClick={() => {
                  const at = tunisiaLocalToIso(when);
                  if (!at.ok) return toast.error("Check the send time", at.message);
                  run(() => scheduleCampaignAction(campaign.id, { scheduledAt: at.iso, expectedVersion: version }), when ? "Campaign scheduled" : "Queued to send now");
                }}>
                  {when ? "Schedule" : "Send now"}
                </Button>
              </div>
              <p className="text-xs text-[var(--color-text-secondary)]">Leave the time empty to send as soon as the background worker runs. Each recipient is checked again just before sending.</p>
            </>
          )}
        </div>
      )}
      {!actions.canSchedule && campaign.status === "approved" && !actions.canApprove && (
        <p className="text-sm text-[var(--color-text-secondary)]">Only owners and admins can schedule sending.</p>
      )}
    </section>
  );
}
