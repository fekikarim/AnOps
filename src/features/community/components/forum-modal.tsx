"use client";

import { useState, useTransition } from "react";
import type { ForumTopic, ContentCategory } from "@/features/community/types";
import { createForumTopicAction } from "@/features/community/actions/community.action";
import { IconClose } from "@/shared/components/ui/brand-icons";
import { MessageSquare, Pin, Folder } from "lucide-react";

interface ForumModalProps {
  isOpen: boolean;
  onClose: () => void;
  categories: ContentCategory[];
  onTopicCreated: (topic: ForumTopic) => void;
  isAdmin?: boolean;
}

export function ForumModal({
  isOpen,
  onClose,
  categories,
  onTopicCreated,
  isAdmin = false,
}: ForumModalProps) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [categoryId, setCategoryId] = useState(categories[0]?.id || "");
  const [isPinned, setIsPinned] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !body.trim()) return;

    setErrorMsg(null);
    startTransition(async () => {
      const res = await createForumTopicAction({
        title,
        body,
        categoryId: categoryId || undefined,
        isPinned,
      });

      if (res.success && res.data) {
        onTopicCreated(res.data as ForumTopic);
        onClose();
        setTitle("");
        setBody("");
      } else if (!res.success) {
        setErrorMsg(res.error || "Failed to create forum topic");
      }
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="forum-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/50 backdrop-blur-sm overflow-y-auto"
    >
      <div className="relative w-full max-w-xl rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 sm:p-6 shadow-xl my-8 transition-all">
        <div className="flex items-center justify-between pb-4 border-b border-[var(--color-border-subtle)]">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-action-primary)]/10 text-[var(--color-action-primary)]">
              <MessageSquare size={18} />
            </span>
            <div>
              <h2
                id="forum-modal-title"
                className="text-base font-semibold text-[var(--color-text-primary)]"
              >
                Start Community Discussion
              </h2>
              <p className="text-xs text-[var(--color-text-secondary)]">
                Ask questions, propose operational initiatives, or share feedback.
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

        <form onSubmit={handleSubmit} className="space-y-4 pt-4">
          {errorMsg && (
            <div className="rounded-[var(--radius-control)] bg-[var(--color-destructive)]/10 p-3 text-xs font-medium text-[var(--color-destructive)]">
              {errorMsg}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-[var(--color-text-primary)] mb-1">
              Topic Title *
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Best way to manage cross-warehouse transfers?"
              className="w-full rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-action-primary)] focus:outline-none min-h-[42px]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[var(--color-text-primary)] mb-1 flex items-center gap-1">
              <Folder size={12} className="text-[var(--color-text-secondary)]" />
              Category Channel
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
            <label className="block text-xs font-semibold text-[var(--color-text-primary)] mb-1">
              Discussion Details *
            </label>
            <textarea
              required
              rows={5}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Provide background, context, and specific points you would like team feedback on..."
              className="w-full rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-3 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-action-primary)] focus:outline-none"
            />
          </div>

          {isAdmin && (
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="pin-topic"
                checked={isPinned}
                onChange={(e) => setIsPinned(e.target.checked)}
                className="h-4 w-4 rounded border-[var(--color-border-subtle)] text-[var(--color-action-primary)] focus:ring-[var(--color-action-primary)]"
              />
              <label
                htmlFor="pin-topic"
                className="text-xs font-medium text-[var(--color-text-primary)] flex items-center gap-1 cursor-pointer"
              >
                <Pin size={12} className="text-amber-500" />
                Pin this topic to the top of the forum
              </label>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--color-border-subtle)]">
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
              className="px-4 py-2 min-h-[42px] rounded-[var(--radius-control)] bg-[var(--color-action-primary)] text-xs font-semibold text-[var(--color-action-on-primary)] hover:opacity-90 disabled:opacity-50 transition-all"
            >
              {isPending ? "Posting..." : "Create Topic"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
