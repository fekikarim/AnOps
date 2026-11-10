import type { Metadata } from "next";
import { getPageWorkspace } from "@/server/tenancy/workspace";
import { getSocialPost } from "@/server/marketing/social/post.service";
import { connectedAccountOptions, socialIntegrationStatus } from "@/server/marketing/social/accounts.service";
import { PageHeader } from "@/shared/components/data-display/page-header";
import { SocialPostForm } from "@/features/marketing/components/social-post-form";
import { SocialPostActions } from "@/features/marketing/components/social-post-actions";
import { orNotFound } from "@/server/marketing/page-guard";
import { PERMISSIONS } from "@/server/security/permissions";

export const metadata: Metadata = { title: "Post | AnOps ERP" };

export default async function SocialPostDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getPageWorkspace();
  const { id } = await params;
  const [post, accounts] = await orNotFound(() => Promise.all([getSocialPost(ctx, id), connectedAccountOptions(ctx)]));
  const integration = socialIntegrationStatus();
  return (
    <div className="space-y-6">
      <PageHeader title="Post" description={`Page: ${post.accountName}`} />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <section aria-label="Post content" className="space-y-4 rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5">
          {post.actions.canEdit ? (
            <SocialPostForm post={post} accounts={accounts} />
          ) : (
            <p className="whitespace-pre-wrap break-words text-sm">{post.content}</p>
          )}
        </section>
        {ctx.permissions.has(PERMISSIONS.MARKETING_SOCIAL_PUBLISH) || ctx.permissions.has(PERMISSIONS.MARKETING_SOCIAL_MANAGE) ? (
          <SocialPostActions post={post} integrationReady={integration.configured} />
        ) : null}
      </div>
    </div>
  );
}
