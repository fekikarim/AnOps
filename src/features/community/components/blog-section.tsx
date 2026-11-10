"use client";

import { confirmAction } from "@/shared/components/ui/confirm-dialog";
import { useAiFeatures } from "@/features/platform/components/ai-features";
import { useState, useTransition } from "react";
import type { BlogPost, ContentCategory } from "@/features/community/types";
import { BlogModal } from "./blog-modal";
import { CommentsThread } from "./comments-thread";
import {
  deleteBlogPostAction,
  generateBlogPostSummaryAction,
} from "@/features/community/actions/community.action";
import {
  BookOpen,
  Plus,
  Sparkles,
  Clock,
  Trash2,
  Edit3,
  Search,
} from "lucide-react";

interface BlogSectionProps {
  canWrite?: boolean;
  canAdmin?: boolean;
  initialPosts: BlogPost[];
  categories: ContentCategory[];
  currentUserId?: string;
  currentUserName?: string;
}

export function BlogSection({
  initialPosts,
  categories,
  currentUserId,
  currentUserName,
  canWrite = false,
  canAdmin = false,
}: BlogSectionProps) {
  const aiFeatures = useAiFeatures();
  const [posts, setPosts] = useState<BlogPost[]>(initialPosts);
  const [selectedCat, setSelectedCat] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [postToEdit, setPostToEdit] = useState<BlogPost | null>(null);
  const [readingPost, setReadingPost] = useState<BlogPost | null>(null);

  // AI summary state
  const [summaries, setSummaries] = useState<Record<string, { summary: string; bullets: string[] }>>({});
  const [isSummarizingId, setIsSummarizingId] = useState<string | null>(null);

  const [isPending, startTransition] = useTransition();

  const filteredPosts = posts.filter((post) => {
    const matchesCat =
      selectedCat === "all" || post.categoryIds.includes(selectedCat);
    const matchesSearch =
      !search.trim() ||
      post.title.toLowerCase().includes(search.toLowerCase()) ||
      post.excerpt.toLowerCase().includes(search.toLowerCase()) ||
      post.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()));
    return matchesCat && matchesSearch;
  });

  const handleGenerateSummary = (post: BlogPost) => {
    setIsSummarizingId(post.id);
    startTransition(async () => {
      const res = await generateBlogPostSummaryAction({ blogPostId: post.id });
      if (res.success && res.data) {
        const data = res.data as { summary: string; bulletPoints: string[] };
        setSummaries((prev) => ({
          ...prev,
          [post.id]: {
            summary: data.summary,
            bullets: data.bulletPoints,
          },
        }));
      }
      setIsSummarizingId(null);
    });
  };

  const handleDeletePost = async (postId: string) => {
    if (!(await confirmAction({ title: "Delete this article?", message: "The article is permanently removed. This cannot be undone.", tone: "danger", confirmLabel: "Delete article" }))) return;
    startTransition(async () => {
      const res = await deleteBlogPostAction(postId);
      if (res.success) {
        setPosts((prev) => prev.filter((p) => p.id !== postId));
        if (readingPost?.id === postId) setReadingPost(null);
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* Top Filter and Action Bar */}
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
              placeholder="Search articles by title, tag, or topic..."
              className="w-full rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] pl-9 pr-3 py-2 text-xs text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] focus:border-[var(--color-action-primary)] focus:outline-none min-h-[40px]"
            />
          </div>
        </div>

        {canWrite && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setPostToEdit(null);
              setIsModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-[var(--color-action-primary)] px-3.5 py-2 min-h-[40px] text-xs font-semibold text-[var(--color-action-on-primary)] transition-all hover:opacity-90 shadow-sm"
          >
            <Plus size={15} />
            Write Article
          </button>
        </div>
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
          All Topics ({posts.length})
        </button>
        {categories.map((cat) => {
          const count = posts.filter((p) => p.categoryIds.includes(cat.id)).length;
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

      {/* Articles Grid */}
      {filteredPosts.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-12 text-center">
          <BookOpen size={32} className="mx-auto text-[var(--color-text-secondary)] opacity-50 mb-3" />
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
            No articles found
          </h3>
          <p className="mt-1 text-xs text-[var(--color-text-secondary)] max-w-sm mx-auto">
            {search
              ? "Try adjusting your search keywords or clear filters."
              : "Start drafting knowledge articles, product manuals, or company announcements."}
          </p>
          {canWrite && (
          <button
            type="button"
            onClick={() => {
              setPostToEdit(null);
              setIsModalOpen(true);
            }}
            className="mt-4 inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-[var(--color-action-primary)] px-3 py-1.5 text-xs font-semibold text-[var(--color-action-on-primary)]"
          >
            <Plus size={14} />
            Write First Article
          </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredPosts.map((post) => {
            const hasSummary = Boolean(summaries[post.id]);
            const postSummary = summaries[post.id];

            return (
              <article
                key={post.id}
                className="group flex flex-col justify-between rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] overflow-hidden transition-all hover:border-[var(--color-action-primary)]/40 hover:shadow-sm"
              >
                {/* Cover Banner */}
                <div className="relative h-40 w-full overflow-hidden bg-gradient-to-tr from-[var(--color-bg-subtle)] to-[var(--color-border-subtle)]">
                  {post.coverImage ? (
                    <img
                      src={post.coverImage}
                      alt={post.title}
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[var(--color-text-secondary)] opacity-40">
                      <BookOpen size={36} />
                    </div>
                  )}
                  <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${
                        post.status === "published"
                          ? "bg-emerald-500/90 text-white"
                          : "bg-amber-500/90 text-white"
                      }`}
                    >
                      {post.status}
                    </span>
                    <span className="rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-xs flex items-center gap-1">
                      <Clock size={10} />
                      {post.readingTimeMinutes} min
                    </span>
                  </div>

                  <div className="absolute top-2.5 right-2.5 flex items-center gap-1">
                    {canWrite && (post.status === "draft" || canAdmin) && (
                    <button
                      type="button"
                      onClick={() => {
                        setPostToEdit(post);
                        setIsModalOpen(true);
                      }}
                      className="rounded-full bg-white/90 p-1.5 text-zinc-700 hover:bg-white hover:text-black shadow-sm transition-colors"
                      title="Edit article"
                    >
                      <Edit3 size={13} />
                    </button>
                    )}
                    {canAdmin && (
                    <button
                      type="button"
                      onClick={() => handleDeletePost(post.id)}
                      className="rounded-full bg-white/90 p-1.5 text-zinc-700 hover:bg-red-50 hover:text-red-600 shadow-sm transition-colors"
                      title="Delete article"
                    >
                      <Trash2 size={13} />
                    </button>
                    )}
                  </div>
                </div>

                {/* Content Details */}
                <div className="p-4 flex-1 flex flex-col justify-between">
                  <div>
                    {/* Tags */}
                    {post.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {post.tags.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className="rounded bg-[var(--color-bg-subtle)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-secondary)]"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}

                    <h3
                      onClick={() => setReadingPost(post)}
                      className="cursor-pointer text-sm font-semibold text-[var(--color-text-primary)] hover:text-[var(--color-action-primary)] transition-colors line-clamp-2"
                    >
                      {post.title}
                    </h3>
                    <p className="mt-1.5 text-xs text-[var(--color-text-secondary)] line-clamp-2">
                      {post.excerpt || post.body.slice(0, 120)}
                    </p>

                    {/* AI 3-Bullet Summary Preview */}
                    {hasSummary && postSummary && (
                      <div className="mt-3 rounded-[var(--radius-control)] border border-purple-200 bg-purple-50/60 dark:border-purple-900/50 dark:bg-purple-950/20 p-2.5 text-xs">
                        <div className="flex items-center gap-1 font-semibold text-purple-700 dark:text-purple-300 text-[11px] mb-1">
                          <Sparkles size={12} />
                          <span>AI Executive 3-Bullet Summary</span>
                        </div>
                        <ul className="space-y-1 text-[11px] text-[var(--color-text-primary)] list-disc pl-3.5">
                          {postSummary.bullets.map((b, i) => (
                            <li key={i}>{b}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  {/* Footer Meta & Action */}
                  <div className="mt-4 pt-3 border-t border-[var(--color-border-subtle)] flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 text-[var(--color-text-secondary)]">
                      <div className="h-5 w-5 rounded-full bg-[var(--color-action-primary)]/10 text-[10px] font-bold text-[var(--color-action-primary)] flex items-center justify-center">
                        {post.authorName.slice(0, 1).toUpperCase()}
                      </div>
                      <span className="text-[11px] font-medium truncate max-w-[100px]">
                        {post.authorName}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {/* AI Summarizer Button */}
                      {canWrite && aiFeatures && (
                      <button
                        type="button"
                        disabled={isPending || isSummarizingId === post.id}
                        onClick={() => handleGenerateSummary(post)}
                        className="inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-purple-200 bg-purple-50 px-2 py-1 text-[11px] font-semibold text-purple-700 hover:bg-purple-100 dark:border-purple-800 dark:bg-purple-950/50 dark:text-purple-300 transition-colors"
                        title="Generate 3-bullet AI summary"
                      >
                        <Sparkles size={11} />
                        {isSummarizingId === post.id ? "Analyzing..." : "AI Summary"}
                      </button>
                      )}

                      <button
                        type="button"
                        onClick={() => setReadingPost(post)}
                        className="inline-flex items-center rounded-[var(--radius-control)] bg-[var(--color-action-primary)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-action-on-primary)] hover:opacity-90 transition-opacity"
                      >
                        Read
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Blog Create / Edit Modal */}
      <BlogModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setPostToEdit(null);
        }}
        categories={categories}
        postToEdit={postToEdit}
        canPublish={canAdmin}
        onSaved={(newPost) => {
          setPosts((prev) => {
            const exists = prev.some((p) => p.id === newPost.id);
            if (exists) {
              return prev.map((p) => (p.id === newPost.id ? newPost : p));
            }
            return [newPost, ...prev];
          });
        }}
      />

      {/* Full Article Reader Dialog */}
      {readingPost && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/60 backdrop-blur-sm overflow-y-auto"
        >
          <div className="relative w-full max-w-3xl rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-6 sm:p-8 shadow-2xl my-8 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-[var(--color-border-subtle)]">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
                Knowledge Base Article
              </span>
              <button
                type="button"
                onClick={() => setReadingPost(null)}
                className="rounded-[var(--radius-control)] p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text-primary)]"
              >
                Close ✕
              </button>
            </div>

            {readingPost.coverImage && (
              <img
                src={readingPost.coverImage}
                alt={readingPost.title}
                className="mt-4 h-64 w-full rounded-[var(--radius-control)] object-cover"
              />
            )}

            <div className="mt-4">
              <div className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                <span>By {readingPost.authorName}</span>
                <span>•</span>
                <span>{new Date(readingPost.createdAt).toLocaleDateString()}</span>
                <span>•</span>
                <span className="flex items-center gap-1">
                  <Clock size={11} /> {readingPost.readingTimeMinutes} min read
                </span>
              </div>

              <h1 className="mt-2 text-xl sm:text-2xl font-bold text-[var(--color-text-primary)]">
                {readingPost.title}
              </h1>

              {/* AI Summary in reader */}
              {summaries[readingPost.id] && (
                <div className="mt-4 rounded-[var(--radius-control)] border border-purple-200 bg-purple-50/70 dark:border-purple-900/50 dark:bg-purple-950/20 p-4 text-xs">
                  <div className="flex items-center gap-1.5 font-bold text-purple-700 dark:text-purple-300 mb-1.5">
                    <Sparkles size={14} />
                    <span>AI Executive 3-Bullet Takeaways</span>
                  </div>
                  <p className="text-[var(--color-text-primary)] mb-2 italic">
                    {summaries[readingPost.id].summary}
                  </p>
                  <ul className="space-y-1 list-disc pl-4 text-[var(--color-text-primary)]">
                    {summaries[readingPost.id].bullets.map((b, i) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Body */}
              <div className="mt-6 prose dark:prose-invert max-w-none text-sm text-[var(--color-text-primary)] leading-relaxed whitespace-pre-wrap font-sans">
                {readingPost.body}
              </div>

              {/* Comments Section */}
              <div className="mt-10 pt-6 border-t border-[var(--color-border-subtle)]">
                <CommentsThread
                  targetType="blog_post"
                  targetId={readingPost.id}
                  currentUserId={currentUserId}
                  currentUserName={currentUserName}
                  canWrite={canWrite}
                  canAdmin={canAdmin}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
