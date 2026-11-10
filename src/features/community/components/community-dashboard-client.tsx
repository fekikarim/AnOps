"use client";

import { useState } from "react";
import type {
  BlogPost,
  ContentCategory,
  ForumTopic,
  ChatConversation,
  CommunityDashboardStats,
} from "@/features/community/types";
import { CommunityStatsCards } from "./community-stats-cards";
import { BlogSection } from "./blog-section";
import { ForumSection } from "./forum-section";
import { LiveChatSection } from "./live-chat-section";
import { VisitorChatWidget } from "./visitor-chat-widget";
import {
  BookOpen,
  MessageSquare,
  Headset,
  Sparkles,
  Bot,
  CheckCircle,
  Shield,
} from "lucide-react";

interface CommunityDashboardClientProps {
  initialPosts: BlogPost[];
  initialCategories: ContentCategory[];
  initialTopics: ForumTopic[];
  initialConversations: ChatConversation[];
  initialStats: CommunityDashboardStats;
  currentUserId?: string;
  currentUserName?: string;
  access: { canWrite: boolean; canSupport: boolean; canAdmin: boolean };
  companyName: string;
}

export function CommunityDashboardClient({
  initialPosts,
  initialCategories,
  initialTopics,
  initialConversations,
  initialStats,
  currentUserId,
  currentUserName = "Fatma",
  access,
  companyName,
}: CommunityDashboardClientProps) {
  const [activeTab, setActiveTab] = useState<string>("blogs");
  const isAdmin = access.canAdmin;

  const allTabs = [
    {
      id: "blogs",
      label: "Blog & Knowledge Articles",
      count: initialPosts.length,
      icon: BookOpen,
    },
    {
      id: "forum",
      label: "Community Forum",
      count: initialTopics.length,
      icon: MessageSquare,
    },
    {
      id: "chat",
      label: "Live Support Inquiries",
      count: initialConversations.length,
      icon: Headset,
      badge: initialConversations.filter((c) => c.status === "open").length,
    },
    {
      id: "ai",
      label: "AI Summarizer & FAQ Bot",
      icon: Sparkles,
      aiBadge: true,
    },
  ];

  // The support console is for support agents; everyone else reaches support through the chat widget.
  const tabs = allTabs.filter((tab) => tab.id !== "chat" || access.canSupport);

  return (
    <div className="space-y-6 pb-12">
      {/* Page Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-[var(--color-border-subtle)] pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">
              Blogs, Forum & Live Chat
            </h1>
            <span className="rounded-full bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
              <Sparkles size={11} /> AI Assisted
            </span>
          </div>
          <p className="mt-1 text-xs sm:text-sm text-[var(--color-text-secondary)]">
            Publish knowledge base articles, foster community discussions, and deliver real-time live support for {companyName}.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)]">
            <Shield size={13} className="text-[var(--color-action-primary)]" />
            <span className="font-semibold text-[var(--color-text-primary)]">
              {isAdmin ? "Moderator / Admin" : "Member"}
            </span>
          </div>
        </div>
      </div>

      {/* KPI Stats */}
      <CommunityStatsCards
        stats={initialStats}
        activeTab={activeTab}
        onTabChange={(tab) => setActiveTab(tab)}
      />

      {/* Main Tab Bar */}
      <div className="border-b border-[var(--color-border-subtle)]">
        <nav
          aria-label="Community workspace tabs"
          className="flex space-x-2 overflow-x-auto pb-px"
        >
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`group inline-flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-xs font-semibold whitespace-nowrap transition-colors min-h-[44px] ${
                  isActive
                    ? "border-[var(--color-action-primary)] text-[var(--color-action-primary)]"
                    : "border-transparent text-[var(--color-text-secondary)] hover:border-[var(--color-border-subtle)] hover:text-[var(--color-text-primary)]"
                }`}
              >
                <Icon
                  size={15}
                  className={
                    isActive
                      ? "text-[var(--color-action-primary)]"
                      : "text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)]"
                  }
                />
                <span>{tab.label}</span>
                {typeof tab.count === "number" && (
                  <span
                    className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                      isActive
                        ? "bg-[var(--color-action-primary)]/15 text-[var(--color-action-primary)]"
                        : "bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)]"
                    }`}
                  >
                    {tab.count}
                  </span>
                )}
                {tab.badge !== undefined && tab.badge > 0 && (
                  <span className="rounded-full bg-amber-500 text-white px-1.5 py-0.2 text-[9px] font-bold">
                    {tab.badge}
                  </span>
                )}
                {tab.aiBadge && (
                  <span className="rounded bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide">
                    AI
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Panels */}
      <div>
        {activeTab === "blogs" && (
          <BlogSection
            initialPosts={initialPosts}
            categories={initialCategories}
            currentUserId={currentUserId}
            currentUserName={currentUserName}
            canWrite={access.canWrite}
            canAdmin={access.canAdmin}
          />
        )}

        {activeTab === "forum" && (
          <ForumSection
            initialTopics={initialTopics}
            categories={initialCategories}
            currentUserId={currentUserId}
            currentUserName={currentUserName}
            isAdmin={isAdmin}
            canWrite={access.canWrite}
          />
        )}

        {activeTab === "chat" && access.canSupport && (
          <LiveChatSection
            initialConversations={initialConversations}
            currentUserId={currentUserId}
            currentUserName={currentUserName}
          />
        )}

        {activeTab === "ai" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Feature 1: Blog 3-Bullet Summarizer */}
            <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-6 space-y-4">
              <div className="flex items-center gap-2.5">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300">
                  <Sparkles size={20} />
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
                    Article 3-Bullet Summarizer
                  </h3>
                  <p className="text-xs text-[var(--color-text-secondary)]">
                    Module 5 Feature (AnOps.md)
                  </p>
                </div>
              </div>
              <p className="text-xs text-[var(--color-text-primary)] leading-relaxed">
                Empowers team members and readers to digest lengthy articles and knowledge docs in seconds. Generates an executive overview and exactly three actionable takeaways using the unified AnOps AI Master router.
              </p>
              <div className="rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)]/50 border border-[var(--color-border-subtle)] p-3 text-xs space-y-1.5">
                <span className="font-semibold text-purple-700 dark:text-purple-300 block text-[11px]">
                  Sample Generated Summary:
                </span>
                <ul className="list-disc pl-4 space-y-1 text-[11px] text-[var(--color-text-primary)]">
                  <li>Automates inventory tracking through multi-tenant data isolation.</li>
                  <li>Eliminates duplicate manual purchase order processing.</li>
                  <li>Increases employee self-service turnaround by 45%.</li>
                </ul>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab("blogs")}
                className="w-full rounded-[var(--radius-control)] bg-[var(--color-action-primary)] py-2 text-xs font-semibold text-[var(--color-action-on-primary)] hover:opacity-90"
              >
                Go to Articles to Summarize
              </button>
            </div>

            {/* Feature 2: Fallback AI Chatbot */}
            <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-6 space-y-4">
              <div className="flex items-center gap-2.5">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
                  <Bot size={20} />
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
                    Live Chat FAQ Bot
                  </h3>
                  <p className="text-xs text-[var(--color-text-secondary)]">
                    Module 5 Feature (AnOps.md)
                  </p>
                </div>
              </div>
              <p className="text-xs text-[var(--color-text-primary)] leading-relaxed">
                When customer support agents are away or busy, this automated assistant steps in to answer common inquiries, guide users to documentation, and generate response suggestions for human agents.
              </p>
              <div className="rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)]/50 border border-[var(--color-border-subtle)] p-3 text-xs space-y-1.5">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--color-text-primary)]">
                  <CheckCircle size={13} className="text-emerald-500" />
                  Grounding: Scoped to active company articles & policies
                </div>
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--color-text-primary)]">
                  <CheckCircle size={13} className="text-emerald-500" />
                  Single Entry: Routes through @/server/ai key rotation pool
                </div>
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--color-text-primary)]">
                  <CheckCircle size={13} className="text-emerald-500" />
                  Operator Co-pilot: Suggests 3 quick-click replies
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab("chat")}
                className="w-full rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] py-2 text-xs font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-bg-subtle)]"
              >
                Open Live Support Console
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Floating Visitor Chat Widget for Live Simulation */}
      <VisitorChatWidget />
    </div>
  );
}
