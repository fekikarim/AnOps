"use client";

import type { CommunityDashboardStats } from "@/features/community/types";
import {
  BookOpen,
  MessageSquare,
  Headset,
  Sparkles,
  MessageCircle,
} from "lucide-react";

interface CommunityStatsCardsProps {
  stats: CommunityDashboardStats;
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export function CommunityStatsCards({
  stats,
  activeTab,
  onTabChange,
}: CommunityStatsCardsProps) {
  const kpis = [
    {
      id: "blogs",
      label: "Published Articles",
      value: stats.publishedBlogPosts,
      sub: `${stats.draftBlogPosts} drafts in review`,
      icon: BookOpen,
      badge: "Blogs",
    },
    {
      id: "forum",
      label: "Discussion Topics",
      value: stats.totalForumTopics,
      sub: `${stats.totalForumReplies} community replies`,
      icon: MessageSquare,
      badge: "Forum",
    },
    {
      id: "chat",
      label: "Open Support Inquiries",
      value: stats.openChatConversations,
      sub: "Live chat queue",
      icon: Headset,
      badge: "Live Chat",
      highlight: stats.openChatConversations > 0,
    },
    {
      id: "forum",
      label: "Total Comments",
      value: stats.totalComments,
      sub: "Across articles & topics",
      icon: MessageCircle,
      badge: "Discussions",
    },
    {
      id: "ai",
      label: "AI Summaries Generated",
      value: stats.aiSummariesGenerated,
      sub: "Powered by AI Master",
      icon: Sparkles,
      badge: "AI Master",
      ai: true,
    },
  ];

  return (
    <section aria-labelledby="community-stats-heading" className="space-y-2">
      <h2 id="community-stats-heading" className="sr-only">
        Community Key Metrics
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-5">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          const isSelected = activeTab === kpi.id;

          return (
            <button
              key={kpi.label}
              type="button"
              onClick={() => onTabChange(kpi.id)}
              className={`flex flex-col justify-between text-left rounded-[var(--radius-card)] border p-4 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-action-primary)] ${
                isSelected
                  ? "border-[var(--color-action-primary)] bg-[var(--color-bg-subtle)] shadow-sm"
                  : "border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] hover:bg-[var(--color-bg-subtle)]"
              }`}
            >
              <div className="flex items-center justify-between gap-2 w-full">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
                  {kpi.badge}
                </span>
                <span
                  className={`flex h-7 w-7 items-center justify-center rounded-md ${
                    kpi.ai
                      ? "bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300"
                      : kpi.highlight
                      ? "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                      : "bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)]"
                  }`}
                >
                  <Icon size={14} />
                </span>
              </div>

              <div className="mt-2">
                <span className="block text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">
                  {kpi.value}
                </span>
                <p className="mt-1 text-xs font-medium text-[var(--color-text-primary)] line-clamp-1">
                  {kpi.label}
                </p>
                <p className="mt-0.5 text-[11px] text-[var(--color-text-secondary)] line-clamp-1">
                  {kpi.sub}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
