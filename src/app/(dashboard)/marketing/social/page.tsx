import type { Metadata } from "next";
import Link from "next/link";
import { getPageWorkspace } from "@/server/tenancy/workspace";
import { listSocialAccounts, socialIntegrationStatus } from "@/server/marketing/social/accounts.service";
import { listSocialPosts } from "@/server/marketing/social/post.service";
import { PageHeader } from "@/shared/components/data-display/page-header";
import { Pagination } from "@/shared/components/data-display/pagination";
import { EmptyState } from "@/shared/components/data-display/empty-state";
import { StatusBadge } from "@/shared/components/data-display/status-badge";
import { SocialAccounts } from "@/features/marketing/components/social-accounts";
import { SOCIAL_POST_STATUS_LABELS } from "@/features/marketing/utils/social-state";
import { SOCIAL_POST_STATUSES } from "@/features/marketing/types/constants";
import { buttonClass, selectClass } from "@/shared/components/ui/button";
import { PERMISSIONS } from "@/server/security/permissions";
import { ERROR_CODE_MESSAGES } from "@/features/marketing/labels";
import { formatDateTime } from "@/shared/lib/format";
import { socialPostListQuerySchema } from "@/features/marketing/schemas/marketing.schema";

export const metadata: Metadata = { title: "Social | AnOps ERP" };

function single(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

const TONE: Record<string, "success" | "warning" | "error" | "neutral" | "info"> = {
  draft: "neutral",
  scheduled: "info",
  publishing: "warning",
  published: "success",
  failed: "error",
  cancelled: "neutral",
  needs_reconciliation: "warning",
};

export default async function SocialPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getPageWorkspace();
  const raw = await searchParams;
  const query = socialPostListQuerySchema.parse({ status: single(raw.status) || undefined, page: single(raw.page) || undefined });
  const [accounts, posts] = await Promise.all([listSocialAccounts(ctx), listSocialPosts(ctx, query)]);
  const integration = socialIntegrationStatus();
  const canManage = ctx.permissions.has(PERMISSIONS.MARKETING_SOCIAL_MANAGE);
  const notice = (() => {
    const error = single(raw.error);
    if (error) return { kind: "error" as const, text: ERROR_CODE_MESSAGES[error] ?? "The connection could not be completed. Try again later." };
    const connected = single(raw.connected);
    if (connected) return { kind: "success" as const, text: `Connected ${connected} Facebook Page${connected === "1" ? "" : "s"}.` };
    return null;
  })();

  return (
    <div className="space-y-8">
      <PageHeader
        title="Social"
        description="Connect Facebook Pages, then draft, schedule and publish posts. Publishing is recorded only after the platform confirms it."
        actions={canManage ? <Link href="/marketing/social/posts/new" className={buttonClass("primary")}>New post</Link> : undefined}
      />

      <section aria-labelledby="accounts" className="space-y-4">
        <h2 id="accounts" className="text-base font-semibold">Accounts</h2>
        <SocialAccounts accounts={accounts.items} integration={integration} canManage={canManage} notice={notice} />
      </section>

      <section aria-labelledby="posts" className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <h2 id="posts" className="text-base font-semibold">Posts</h2>
          <form method="get" className="flex items-end gap-2">
            <div className="space-y-1">
              <label htmlFor="status" className="text-xs font-semibold">Status</label>
              <select id="status" name="status" defaultValue={query.status} className={selectClass}>
                <option value="all">All</option>
                {SOCIAL_POST_STATUSES.map((status) => <option key={status} value={status}>{SOCIAL_POST_STATUS_LABELS[status]}</option>)}
              </select>
            </div>
            <button type="submit" className={buttonClass("secondary")}>Apply</button>
          </form>
        </div>
        {posts.items.length === 0 ? (
          <EmptyState title="No posts yet" description="Write a draft for a connected Page. Drafts stay private until you schedule them." actionHref={canManage ? "/marketing/social/posts/new" : undefined} actionLabel={canManage ? "Write a post" : undefined} />
        ) : (
          <ul className="divide-y divide-[var(--color-border-subtle)] rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
            {posts.items.map((post) => (
              <li key={post.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <Link href={`/marketing/social/posts/${post.id}`} className="line-clamp-2 break-words font-medium underline-offset-2 hover:underline">{post.content}</Link>
                  <p className="text-sm text-[var(--color-text-secondary)]">{post.accountName}{post.scheduledAt ? ` · ${formatDateTime(post.scheduledAt)}` : ""}</p>
                  {post.lastErrorCode && <p className="text-xs text-[var(--color-text-secondary)]">{post.lastErrorCode}</p>}
                </div>
                <StatusBadge label={post.statusLabel} tone={TONE[post.status] ?? "neutral"} />
              </li>
            ))}
          </ul>
        )}
        <Pagination basePath="/marketing/social" page={posts.page} totalPages={posts.totalPages} params={{ status: query.status === "all" ? undefined : query.status }} />
      </section>
    </div>
  );
}
