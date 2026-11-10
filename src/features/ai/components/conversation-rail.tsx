"use client";

import { useState } from "react";
import { MessageSquarePlus, Trash2 } from "lucide-react";
import type { ConversationSummaryDto } from "@/features/ai/types";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";

function when(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** The member's own history. Nobody else's conversations ever appear here: the server scopes the list. */
export function ConversationRail({
  conversations,
  activeId,
  busy,
  onSelect,
  onNew,
  onDelete,
}: {
  conversations: ConversationSummaryDto[];
  activeId: string | null;
  busy: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <Button variant="secondary" onClick={onNew} disabled={busy} className="w-full justify-start">
        <MessageSquarePlus aria-hidden className="size-4" />
        New conversation
      </Button>
      {conversations.length === 0 ? (
        <p className="px-1 text-sm text-[var(--color-text-secondary)]">Your conversations appear here. Only you can see them.</p>
      ) : (
        <ul aria-label="Your conversations" className="-mx-1 min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1">
          {conversations.map((c) => {
            const active = c.id === activeId;
            return (
              <li key={c.id} className="group relative">
                {confirmId === c.id ? (
                  <div role="group" aria-label={`Delete ${c.title}?`} className="flex min-h-[44px] items-center gap-1 rounded-[var(--radius-control)] bg-[var(--color-status-error-bg)] px-2">
                    <span className="flex-1 truncate text-xs font-semibold text-[var(--color-status-error)]">Delete this?</span>
                    <button type="button" className="min-h-[44px] px-2 text-xs font-semibold text-[var(--color-status-error)] hover:underline focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)]" onClick={() => { setConfirmId(null); onDelete(c.id); }}>
                      Delete
                    </button>
                    <button type="button" autoFocus className="min-h-[44px] px-2 text-xs font-semibold text-[var(--color-status-neutral)] hover:underline focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)]" onClick={() => setConfirmId(null)}>
                      Keep
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => onSelect(c.id)}
                      aria-current={active ? "true" : undefined}
                      className={cn(
                        "flex min-h-[44px] w-full flex-col justify-center rounded-[var(--radius-control)] px-3 py-1.5 pr-11 text-left transition-colors focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)]",
                        active ? "bg-[var(--color-bg-subtle)]" : "hover:bg-[var(--color-bg-subtle)]"
                      )}
                    >
                      <span className={cn("truncate text-sm text-[var(--color-text-primary)]", active && "font-semibold")}>{c.title}</span>
                      <span className="text-xs text-[var(--color-text-secondary)]">{when(c.updatedAt)}</span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete conversation ${c.title}`}
                      onClick={() => setConfirmId(c.id)}
                      className="absolute top-0 right-0 flex size-11 items-center justify-center rounded-[var(--radius-control)] text-[var(--color-text-secondary)] opacity-100 hover:text-[var(--color-status-error)] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)] lg:opacity-0 lg:group-focus-within:opacity-100 lg:group-hover:opacity-100"
                    >
                      <Trash2 aria-hidden className="size-4" />
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
