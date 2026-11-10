"use client";

import { useState, useTransition } from "react";
import type {
  ForumTopic,
  ContentCategory,
} from "@/features/community/types";
import { ForumModal } from "./forum-modal";
import { CommentsThread } from "./comments-thread";
import {
  createForumReplyAction,
  togglePinTopicAction,
} from "@/features/community/actions/community.action";
import {
  MessageSquare,
  Plus,
  Pin,
  CornerDownRight,
  Send,
  Search,
  ChevronRight,
  ArrowLeft,
} from "lucide-react";

interface ForumSectionProps {
  initialTopics: ForumTopic[];
  categories: ContentCategory[];
  currentUserId?: string;
  currentUserName?: string;
  isAdmin?: boolean;
  canWrite?: boolean;
}

export function ForumSection({
  initialTopics,
  categories,
  currentUserId,
  currentUserName = "You",
  isAdmin = false,
  canWrite = false,
}: ForumSectionProps) {
  const [topics, setTopics] = useState<ForumTopic[]>(initialTopics);
  const [selectedTopic, setSelectedTopic] = useState<ForumTopic | null>(null);
  const [search, setSearch] = useState("");
  const [selectedCat, setSelectedCat] = useState<string>("all");
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Active topic reply state
  const [replyBody, setReplyBody] = useState("");
  const [replyToParentId, setReplyToParentId] = useState<string | null>(null);

  const [isPending, startTransition] = useTransition();

  const filteredTopics = topics.filter((topic) => {
    const matchesCat =
      selectedCat === "all" || topic.categoryId === selectedCat;
    const matchesSearch =
      !search.trim() ||
      topic.title.toLowerCase().includes(search.toLowerCase()) ||
      topic.body.toLowerCase().includes(search.toLowerCase());
    return matchesCat && matchesSearch;
  });

  const handleOpenTopic = (topic: ForumTopic) => {
    setSelectedTopic(topic);
    setReplyBody("");
    setReplyToParentId(null);
  };

  const handleTogglePin = (topicId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    startTransition(async () => {
      const res = await togglePinTopicAction(topicId);
      if (res.success && res.data) {
        const isPinned = (res.data as { isPinned: boolean }).isPinned;
        setTopics((prev) =>
          prev.map((t) => (t.id === topicId ? { ...t, isPinned } : t))
        );
        if (selectedTopic?.id === topicId) {
          setSelectedTopic((prev) => (prev ? { ...prev, isPinned } : null));
        }
      }
    });
  };

  const handlePostReply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTopic || !replyBody.trim()) return;

    startTransition(async () => {
      const res = await createForumReplyAction({
        topicId: selectedTopic.id,
        parentReplyId: replyToParentId,
        body: replyBody.trim(),
      });

      if (res.success && res.data) {
        setReplyBody("");
        setReplyToParentId(null);
        // Increment reply count in list
        setTopics((prev) =>
          prev.map((t) =>
            t.id === selectedTopic.id
              ? { ...t, repliesCount: t.repliesCount + 1 }
              : t
          )
        );
        setSelectedTopic((prev) =>
          prev ? { ...prev, repliesCount: prev.repliesCount + 1 } : null
        );
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* Top Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 items-center gap-2 max-w-md">
          <div className="relative w-full">
            <Search
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)]"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search discussion topics..."
              className="w-full rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] pl-9 pr-3 py-2 text-xs text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] focus:border-[var(--color-action-primary)] focus:outline-none min-h-[40px]"
            />
          </div>
        </div>

        {canWrite && (
        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-[var(--color-action-primary)] px-3.5 py-2 min-h-[40px] text-xs font-semibold text-[var(--color-action-on-primary)] transition-all hover:opacity-90 shadow-sm"
        >
          <Plus size={15} />
          New Topic
        </button>
        )}
      </div>

      {/* Category Filter Pills */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--color-border-subtle)] pb-3">
        <button
          type="button"
          onClick={() => setSelectedCat("all")}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            selectedCat === "all"
              ? "bg-[var(--color-action-primary)] text-[var(--color-action-on-primary)]"
              : "bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          }`}
        >
          All Topics ({topics.length})
        </button>
        {categories.map((cat) => {
          const count = topics.filter((t) => t.categoryId === cat.id).length;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => setSelectedCat(cat.id)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                selectedCat === cat.id
                  ? "bg-[var(--color-action-primary)] text-[var(--color-action-on-primary)]"
                  : "bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              }`}
            >
              {cat.name} ({count})
            </button>
          );
        })}
      </div>

      {/* Detail View OR Topic List */}
      {selectedTopic ? (
        /* Topic Detail Discussion View */
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 sm:p-7 space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-[var(--color-border-subtle)]">
            <button
              type="button"
              onClick={() => setSelectedTopic(null)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--color-action-primary)] hover:underline"
            >
              <ArrowLeft size={14} />
              Back to all topics
            </button>

            {isAdmin && (
              <button
                type="button"
                onClick={(e) => handleTogglePin(selectedTopic.id, e)}
                className={`inline-flex items-center gap-1 rounded-[var(--radius-control)] px-2.5 py-1 text-xs font-semibold transition-colors ${
                  selectedTopic.isPinned
                    ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                    : "border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)]"
                }`}
              >
                <Pin size={12} />
                {selectedTopic.isPinned ? "Pinned" : "Pin Topic"}
              </button>
            )}
          </div>

          <div>
            <div className="flex items-center gap-2">
              {selectedTopic.isPinned && (
                <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wide">
                  <Pin size={10} /> Pinned
                </span>
              )}
              {selectedTopic.categoryName && (
                <span className="rounded bg-[var(--color-bg-subtle)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-text-secondary)]">
                  {selectedTopic.categoryName}
                </span>
              )}
            </div>

            <h1 className="mt-2 text-xl font-bold text-[var(--color-text-primary)]">
              {selectedTopic.title}
            </h1>

            <div className="mt-2 flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
              <span className="font-medium text-[var(--color-text-primary)]">
                {selectedTopic.authorName}
              </span>
              <span>•</span>
              <span>{new Date(selectedTopic.createdAt).toLocaleDateString()}</span>
              <span>•</span>
              <span>{selectedTopic.viewsCount} views</span>
              <span>•</span>
              <span>{selectedTopic.repliesCount} replies</span>
            </div>

            <div className="mt-5 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)]/30 p-4 text-sm text-[var(--color-text-primary)] leading-relaxed whitespace-pre-wrap">
              {selectedTopic.body}
            </div>
          </div>

          {/* Reply Form */}
          {canWrite && (
          <form onSubmit={handlePostReply} className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-[var(--color-text-primary)] flex items-center gap-1">
                <CornerDownRight size={13} className="text-[var(--color-action-primary)]" />
                Post a Reply to this Thread
              </label>
              {replyToParentId && (
                <button
                  type="button"
                  onClick={() => setReplyToParentId(null)}
                  className="text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-destructive)]"
                >
                  Cancel nested reply ✕
                </button>
              )}
            </div>
            <div className="relative rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] focus-within:border-[var(--color-action-primary)] transition-colors">
              <textarea
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                placeholder="Share your perspective or answer this question..."
                rows={3}
                className="w-full resize-none bg-transparent p-3 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] focus:outline-none"
              />
              <div className="flex items-center justify-end border-t border-[var(--color-border-subtle)] px-3 py-2 bg-[var(--color-bg-subtle)]/40 rounded-b-[var(--radius-control)]">
                <button
                  type="submit"
                  disabled={isPending || !replyBody.trim()}
                  className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-[var(--color-action-primary)] px-3.5 py-1.5 min-h-[36px] text-xs font-semibold text-[var(--color-action-on-primary)] transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  <Send size={12} />
                  {isPending ? "Posting..." : "Submit Reply"}
                </button>
              </div>
            </div>
          </form>
          )}

          {/* Polymorphic Comments Component */}
          <div className="pt-4 border-t border-[var(--color-border-subtle)]">
            <CommentsThread
              targetType="forum_topic"
              targetId={selectedTopic.id}
              currentUserId={currentUserId}
              currentUserName={currentUserName}
              canWrite={canWrite}
              canAdmin={isAdmin}
            />
          </div>
        </div>
      ) : (
        /* Forum Topics List */
        <div className="space-y-3">
          {filteredTopics.length === 0 ? (
            <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-12 text-center">
              <MessageSquare size={32} className="mx-auto text-[var(--color-text-secondary)] opacity-50 mb-3" />
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
                No discussion topics yet
              </h3>
              <p className="mt-1 text-xs text-[var(--color-text-secondary)] max-w-sm mx-auto">
                Be the first to open a question, operational proposal, or team announcement.
              </p>
              {canWrite && (
              <button
                type="button"
                onClick={() => setIsModalOpen(true)}
                className="mt-4 inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-[var(--color-action-primary)] px-3 py-1.5 text-xs font-semibold text-[var(--color-action-on-primary)]"
              >
                <Plus size={14} />
                Start First Topic
              </button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-[var(--color-border-subtle)] rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] overflow-hidden">
              {filteredTopics.map((topic) => (
                <div
                  key={topic.id}
                  onClick={() => handleOpenTopic(topic)}
                  className="group flex items-center justify-between gap-4 p-4 hover:bg-[var(--color-bg-subtle)]/70 transition-colors cursor-pointer"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div
                      className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                        topic.isPinned
                          ? "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                          : "bg-[var(--color-action-primary)]/10 text-[var(--color-action-primary)]"
                      }`}
                    >
                      {topic.isPinned ? <Pin size={15} /> : <MessageSquare size={15} />}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {topic.isPinned && (
                          <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">
                            PINNED
                          </span>
                        )}
                        {topic.categoryName && (
                          <span className="text-[11px] font-medium text-[var(--color-text-secondary)]">
                            {topic.categoryName}
                          </span>
                        )}
                      </div>

                      <h4 className="mt-0.5 text-sm font-semibold text-[var(--color-text-primary)] group-hover:text-[var(--color-action-primary)] transition-colors truncate">
                        {topic.title}
                      </h4>
                      <p className="mt-0.5 text-xs text-[var(--color-text-secondary)] line-clamp-1">
                        {topic.body}
                      </p>

                      <div className="mt-2 flex items-center gap-3 text-[11px] text-[var(--color-text-secondary)]">
                        <span>Started by {topic.authorName}</span>
                        <span>•</span>
                        <span>{new Date(topic.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-5 shrink-0 text-right">
                    <div className="hidden sm:block">
                      <span className="block text-sm font-bold text-[var(--color-text-primary)]">
                        {topic.repliesCount}
                      </span>
                      <span className="text-[10px] text-[var(--color-text-secondary)] uppercase">
                        Replies
                      </span>
                    </div>

                    <div className="hidden sm:block">
                      <span className="block text-sm font-bold text-[var(--color-text-primary)]">
                        {topic.viewsCount}
                      </span>
                      <span className="text-[10px] text-[var(--color-text-secondary)] uppercase">
                        Views
                      </span>
                    </div>

                    <ChevronRight
                      size={18}
                      className="text-[var(--color-text-secondary)] group-hover:translate-x-0.5 transition-transform"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* New Topic Modal */}
      <ForumModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        categories={categories}
        isAdmin={isAdmin}
        onTopicCreated={(newTopic) => {
          setTopics((prev) => [newTopic, ...prev]);
        }}
      />
    </div>
  );
}
