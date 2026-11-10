"use client";

import { confirmAction } from "@/shared/components/ui/confirm-dialog";
import { useToast } from "@/shared/components/ui/toast";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cancelSocialPostAction, deleteSocialPostAction, scheduleSocialPostAction } from "@/features/marketing/actions/social.action";
import { Button } from "@/shared/components/ui/button";
import { tunisiaLocalToIso } from "@/features/marketing/utils/datetime";
import type { SocialPostDto } from "@/server/marketing/social/post.service";
import { SOCIAL_POST_STATUS_LABELS } from "@/features/marketing/utils/social-state";

export function SocialPostActions({ post, integrationReady }: { post: SocialPostDto; integrationReady: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const toast = useToast();
  const [when, setWhen] = useState("");
  const run = (task: () => Promise<{ ok: boolean; error?: { message: string } }>, success: string) =>
    startTransition(async () => {
      const result = await task();
      if (!result.ok) return toast.fromError(result.error);
      toast.success(success);
      router.refresh();
    });

  const canSchedule = post.actions.canSchedule && integrationReady;
  return (
    <section aria-labelledby="post-actions" className="space-y-4 rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5">
      <h2 id="post-actions" className="text-base font-semibold">Publishing</h2>
      <p className="text-sm">Status: <span className="font-semibold">{SOCIAL_POST_STATUS_LABELS[post.status]}</span></p>
      {post.status === "published" && post.externalPostId && (
        <p className="text-sm text-[var(--color-text-secondary)]">Published on {post.publishedAt ? new Date(post.publishedAt).toLocaleString("en-GB", { timeZone: "Africa/Tunis" }) : "—"}. Platform post id: <span className="font-mono">{post.externalPostId}</span></p>
      )}
      {post.status === "needs_reconciliation" && (
        <p role="alert" className="rounded-[var(--radius-control)] bg-[var(--color-status-warning-bg)] p-3 text-sm text-[var(--color-status-warning)]">
          The platform did not confirm this publication (the request may have timed out after it was accepted). It has not been retried, to avoid a duplicate. Check the Page before doing anything else.
        </p>
      )}
      {post.lastErrorCode && post.status === "failed" && (
        <p className="text-sm text-[var(--color-status-error)]">Last error: {post.lastErrorCode}. Fix the cause, then schedule again.</p>
      )}

      {canSchedule && (
        <div className="space-y-3 rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)] p-4">
          <label htmlFor="post-when" className="text-sm font-semibold">Publish at (Tunisia time, optional)</label>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <input id="post-when" type="datetime-local" value={when} onChange={(event) => setWhen(event.target.value)} className="min-h-[44px] rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3 text-sm" />
            <Button variant="primary" disabled={pending} onClick={() => {
                const at = tunisiaLocalToIso(when);
                if (!at.ok) return toast.error("Check the publish time", at.message);
                run(() => scheduleSocialPostAction(post.id, { scheduledAt: at.iso, expectedVersion: post.version }), when ? "Post scheduled" : "Queued to publish now");
              }}>
              {when ? "Schedule" : "Publish now"}
            </Button>
          </div>
          <p className="text-xs text-[var(--color-text-secondary)]">Publishing happens in the background. This page shows the result once the platform confirms it.</p>
        </div>
      )}
      {post.actions.canSchedule && !integrationReady && (
        <p role="status" className="text-sm text-[var(--color-status-warning)]">Publishing is unavailable until the Facebook integration is configured on the server.</p>
      )}

      <div className="flex flex-wrap gap-2">
        {post.actions.canCancel && (
          <Button variant="danger" disabled={pending} onClick={() => run(() => cancelSocialPostAction(post.id, { expectedVersion: post.version }), "Scheduled post cancelled.")}>Cancel schedule</Button>
        )}
        {post.actions.canDelete && (
          <Button variant="danger" disabled={pending} onClick={async () => {
            if (!(await confirmAction({ title: "Delete this post?", message: "The post is permanently removed.", tone: "danger", confirmLabel: "Delete post" }))) return;
            startTransition(async () => {
              const result = await deleteSocialPostAction(post.id);
              if (!result.ok) return toast.fromError(result.error);
              router.push("/marketing/social");
              router.refresh();
            });
          }}>Delete</Button>
        )}
      </div>
    </section>
  );
}
