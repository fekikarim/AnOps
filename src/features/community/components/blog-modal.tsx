"use client";

import { useState, useTransition } from "react";
import type { BlogPost, ContentCategory } from "@/features/community/types";
import {
  createBlogPostAction,
  updateBlogPostAction,
} from "@/features/community/actions/community.action";
import { IconClose } from "@/shared/components/ui/brand-icons";
import { FileText, Image as ImageIcon, Tag, Folder } from "lucide-react";

interface BlogModalProps {
  isOpen: boolean;
  onClose: () => void;
  categories: ContentCategory[];
  postToEdit?: BlogPost | null;
  onSaved?: (post: BlogPost) => void;
  /** Only administrators publish. Everyone else saves drafts. */
  canPublish?: boolean;
}

export function BlogModal({
  isOpen,
  onClose,
  categories,
  postToEdit,
  onSaved,
  canPublish = false,
}: BlogModalProps) {
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="blog-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/50 backdrop-blur-sm overflow-y-auto"
    >
      <BlogModalForm
        key={postToEdit ? postToEdit.id : "new"}
        onClose={onClose}
        categories={categories}
        postToEdit={postToEdit}
        onSaved={onSaved}
        canPublish={canPublish}
      />
    </div>
  );
}

function BlogModalForm({
  onClose,
  categories,
  postToEdit,
  onSaved,
  canPublish,
}: {
  canPublish: boolean;
  onClose: () => void;
  categories: ContentCategory[];
  postToEdit?: BlogPost | null;
  onSaved?: (post: BlogPost) => void;
}) {
  const [title, setTitle] = useState(postToEdit?.title || "");
  const [excerpt, setExcerpt] = useState(postToEdit?.excerpt || "");
  const [body, setBody] = useState(postToEdit?.body || "");
  const [categoryId, setCategoryId] = useState(
    postToEdit?.categoryIds[0] || categories[0]?.id || ""
  );
  const [tagsInput, setTagsInput] = useState(
    postToEdit?.tags ? postToEdit.tags.join(", ") : ""
  );
  const [coverImage, setCoverImage] = useState(postToEdit?.coverImage || "");
  const [status, setStatus] = useState<"draft" | "published">(
    !canPublish || postToEdit?.status === "draft" || !postToEdit ? "draft" : "published"
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const tags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    startTransition(async () => {
      let res;
      if (postToEdit) {
        res = await updateBlogPostAction({
          id: postToEdit.id,
          title,
          excerpt,
          body,
          categoryIds: categoryId ? [categoryId] : [],
          tags,
          coverImage,
          status,
        });
      } else {
        res = await createBlogPostAction({
          title,
          excerpt,
          body,
          categoryIds: categoryId ? [categoryId] : [],
          tags,
          coverImage,
          status,
        });
      }

      if (res.success && res.data) {
        if (onSaved) onSaved(res.data as BlogPost);
        onClose();
      } else if (!res.success) {
        setErrorMsg(res.error || "An error occurred");
      }
    });
  };

  const estimatedReadingTime = Math.max(
    1,
    Math.ceil(body.trim().split(/\s+/).filter(Boolean).length / 200)
  );

  return (
    <div className="relative w-full max-w-2xl rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 sm:p-6 shadow-xl my-8 transition-all">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-[var(--color-border-subtle)]">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-action-primary)]/10 text-[var(--color-action-primary)]">
            <FileText size={18} />
          </span>
          <div>
            <h2
              id="blog-modal-title"
              className="text-base font-semibold text-[var(--color-text-primary)]"
            >
              {postToEdit ? "Edit Article" : "Write New Article"}
            </h2>
            <p className="text-xs text-[var(--color-text-secondary)]">
              Publish company updates, engineering logs, or customer guides.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text-primary)]"
          aria-label="Close dialog"
        >
          <IconClose size={16} />
        </button>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4 pt-4">
        {errorMsg && (
          <div className="rounded-[var(--radius-control)] bg-[var(--color-destructive)]/10 p-3 text-xs font-medium text-[var(--color-destructive)]">
            {errorMsg}
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-[var(--color-text-primary)] mb-1">
            Article Title *
          </label>
          <input
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., How Our Supply Chain Team Improved Inventory Turnover"
            className="w-full rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-action-primary)] focus:outline-none min-h-[42px]"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-[var(--color-text-primary)] mb-1 flex items-center gap-1">
              <Folder size={12} className="text-[var(--color-text-secondary)]" />
              Category
            </label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-action-primary)] focus:outline-none min-h-[42px]"
            >
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold text-[var(--color-text-primary)] mb-1 flex items-center gap-1">
              <Tag size={12} className="text-[var(--color-text-secondary)]" />
              Tags (comma separated)
            </label>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="ERP, Operations, SupplyChain"
              className="w-full rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-action-primary)] focus:outline-none min-h-[42px]"
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-[var(--color-text-primary)] mb-1 flex items-center gap-1">
            <ImageIcon size={12} className="text-[var(--color-text-secondary)]" />
            Cover Image URL (optional)
          </label>
          <input
            type="url"
            value={coverImage}
            onChange={(e) => setCoverImage(e.target.value)}
            placeholder="https://images.unsplash.com/photo-..."
            className="w-full rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-action-primary)] focus:outline-none min-h-[42px]"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-[var(--color-text-primary)] mb-1">
            Short Summary / Excerpt
          </label>
          <input
            type="text"
            value={excerpt}
            onChange={(e) => setExcerpt(e.target.value)}
            placeholder="Brief 1-sentence teaser for cards and search"
            className="w-full rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-action-primary)] focus:outline-none min-h-[42px]"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-semibold text-[var(--color-text-primary)]">
              Content (Markdown supported) *
            </label>
            <span className="text-[11px] text-[var(--color-text-secondary)]">
              ~{estimatedReadingTime} min read
            </span>
          </div>
          <textarea
            required
            rows={8}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your article in Markdown... Use ## headers, - bullet points, and `code` snippets."
            className="w-full rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-3 text-sm font-mono text-[var(--color-text-primary)] focus:border-[var(--color-action-primary)] focus:outline-none"
          />
        </div>

        <div className="flex items-center justify-between pt-2">
          {!canPublish ? (
            <p className="text-xs text-[var(--color-text-secondary)]">Saved as a draft. An administrator publishes it.</p>
          ) : (
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-[var(--color-text-primary)]">
              Status:
            </label>
            <div className="inline-flex rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] p-0.5 bg-[var(--color-bg-subtle)]">
              <button
                type="button"
                onClick={() => setStatus("draft")}
                className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
                  status === "draft"
                    ? "bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-sm font-semibold"
                    : "text-[var(--color-text-secondary)]"
                }`}
              >
                Draft
              </button>
              <button
                type="button"
                onClick={() => setStatus("published")}
                className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
                  status === "published"
                    ? "bg-[var(--color-action-primary)] text-[var(--color-action-on-primary)] shadow-sm font-semibold"
                    : "text-[var(--color-text-secondary)]"
                }`}
              >
                Published
              </button>
            </div>
          </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 min-h-[42px] rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] text-xs font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-bg-subtle)] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending || !title.trim() || !body.trim()}
              className="px-4 py-2 min-h-[42px] rounded-[var(--radius-control)] bg-[var(--color-action-primary)] text-xs font-semibold text-[var(--color-action-on-primary)] hover:opacity-90 disabled:opacity-50 transition-all flex items-center gap-1.5"
            >
              {isPending ? "Saving..." : postToEdit ? "Update Article" : "Save Article"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
