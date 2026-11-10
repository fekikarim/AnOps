"use client";

import { useState, useTransition } from "react";
import type { Comment, CommentTargetType } from "@/features/community/types";
import {
  createCommentAction,
  deleteCommentAction,
} from "@/features/community/actions/community.action";
import { MessageSquare, Trash2, Send } from "lucide-react";

interface CommentsThreadProps {
  targetType: CommentTargetType;
  targetId: string;
  initialComments?: Comment[];
  currentUserId?: string;
  currentUserName?: string;
  canWrite?: boolean;
  canAdmin?: boolean;
}

export function CommentsThread({
  targetType,
  targetId,
  initialComments = [],
  currentUserId,
  currentUserName: _currentUserName,
  canWrite = false,
  canAdmin = false,
}: CommentsThreadProps) {
  const [comments, setComments] = useState<Comment[]>(initialComments);
  const [body, setBody] = useState("");
  const [isPending, startTransition] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;

    setErrorMsg(null);
    startTransition(async () => {
      const res = await createCommentAction({
        targetType,
        targetId,
        body: body.trim(),
      });

      if (res.success && res.data) {
        setComments((prev) => [res.data as Comment, ...prev]);
        setBody("");
      } else if (!res.success) {
        setErrorMsg(res.error || "Failed to post comment");
      }
    });
  };

  const handleDelete = (commentId: string) => {
    startTransition(async () => {
      const res = await deleteCommentAction(commentId);
      if (res.success) {
        setComments((prev) => prev.filter((c) => c.id !== commentId));
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
        <MessageSquare size={16} className="text-[var(--color-action-primary)]" />
        <span>Comments & Discussion ({comments.length})</span>
      </div>

      {/* Comment Input */}
      {canWrite && (
      <form onSubmit={handleSubmit} className="space-y-2">
        <div className="relative rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] focus-within:border-[var(--color-action-primary)] transition-colors">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write a thought or feedback..."
            rows={2}
            className="w-full resize-none bg-transparent p-3 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] focus:outline-none"
          />
          <div className="flex items-center justify-between border-t border-[var(--color-border-subtle)] px-3 py-2 bg-[var(--color-bg-subtle)]/40 rounded-b-[var(--radius-control)]">
            <span className="text-[11px] text-[var(--color-text-secondary)]">
              Markdown formatting supported
            </span>
            <button
              type="submit"
              disabled={isPending || !body.trim()}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-[var(--color-action-primary)] px-3 py-1.5 min-h-[34px] text-xs font-semibold text-[var(--color-action-on-primary)] transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Send size={12} />
              {isPending ? "Posting..." : "Post"}
            </button>
          </div>
        </div>
        {errorMsg && (
          <p className="text-xs text-[var(--color-destructive)]">{errorMsg}</p>
        )}
      </form>
      )}

      {/* Comment List */}
      {comments.length === 0 ? (
        <p className="text-xs text-[var(--color-text-secondary)] py-2 italic">
          No comments yet.
        </p>
      ) : (
        <div className="space-y-3 pt-1">
          {comments.map((comment) => {
            const isAuthor =
              currentUserId && comment.authorUserId === currentUserId;

            return (
              <div
                key={comment.id}
                className="flex items-start gap-3 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-3.5 transition-colors"
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-action-primary)]/10 text-[11px] font-bold text-[var(--color-action-primary)]">
                  {comment.authorName.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-[var(--color-text-primary)]">
                        {comment.authorName}
                      </span>
                      <span className="text-[10px] text-[var(--color-text-secondary)]">
                        {new Date(comment.createdAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    {((isAuthor && canWrite) || canAdmin) && (
                      <button
                        type="button"
                        onClick={() => handleDelete(comment.id)}
                        disabled={isPending}
                        className="text-[var(--color-text-secondary)] hover:text-[var(--color-destructive)] p-1 rounded transition-colors"
                        title="Delete comment"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-[var(--color-text-primary)] whitespace-pre-wrap leading-relaxed">
                    {comment.body}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
