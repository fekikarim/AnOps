import type { Metadata } from "next";
import { PERMISSIONS } from "@/server/security/permissions";
import { getPageWorkspace } from "@/server/tenancy/workspace";
import { getActiveTenant } from "@/server/tenant/context";
import { getCurrentAuthUser } from "@/server/auth/rbac";
import {
  getBlogPosts,
  getCategories,
  getForumTopics,
  getChatConversations,
  getCommunityDashboardStats,
} from "@/server/services/community.service";
import { CommunityDashboardClient } from "@/features/community/components/community-dashboard-client";

export const metadata: Metadata = {
  title: "Blogs, Forum & Live Chat | AnOps ERP",
  description:
    "Knowledge Base Blog Publishing, Community Forum, Real-Time Live Support Chat & AI Summarizer Bot.",
};

export default async function CommunityPage() {
  // Resolves the active company and the caller's permissions (redirects to login or onboarding if needed).
  const workspace = await getPageWorkspace();

  const authUser = await getCurrentAuthUser();
  const authorName = authUser?.employee?.fullName || authUser?.email || "Member";
  const canWrite = workspace.permissions.has(PERMISSIONS.COMMUNITY_WRITE);
  const canSupport = workspace.permissions.has(PERMISSIONS.COMMUNITY_SUPPORT);
  const canAdmin = workspace.permissions.has(PERMISSIONS.COMMUNITY_ADMIN);

  // Every read below is scoped to the active company and filtered by what this role may see.
  const [posts, categories, topics, conversations, stats] = await Promise.all([
    getBlogPosts(workspace),
    getCategories(workspace),
    getForumTopics(workspace),
    getChatConversations(workspace),
    getCommunityDashboardStats(workspace),
  ]);

  const tenant = await getActiveTenant();
  const companyName = tenant?.company?.name || "AnOps";

  return (
    <CommunityDashboardClient
      initialPosts={posts}
      initialCategories={categories}
      initialTopics={topics}
      initialConversations={conversations}
      initialStats={stats}
      currentUserId={authUser?.userId}
      currentUserName={authorName}
      access={{ canWrite, canSupport, canAdmin }}
      companyName={companyName}
    />
  );
}
