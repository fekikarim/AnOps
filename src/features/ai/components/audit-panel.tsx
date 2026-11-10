"use client";

import { useState, useTransition } from "react";
import { Eye, Loader2 } from "lucide-react";
import { auditListConversationsAction, auditReadConversationAction } from "@/features/ai/actions/ai.action";
import { MessagePart } from "@/features/ai/components/message-parts";
import type { AccessMemberDto, ConversationDto, ConversationSummaryDto } from "@/features/ai/types";
import { Button } from "@/shared/components/ui/button";
import { Select } from "@/shared/components/ui/form-kit";
import { useToast } from "@/shared/components/ui/toast";

/**
 * Read-only transcript audit. Only rendered for an owner or administrator who has been given the
 * audit switch. Every list and every opened conversation is logged and the person is notified; the
 * server enforces all of it again, so this panel is a convenience and never the control.
 */
export function AuditPanel({ members }: { members: AccessMemberDto[] }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [target, setTarget] = useState("");
  const [list, setList] = useState<ConversationSummaryDto[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [transcript, setTranscript] = useState<ConversationDto | null>(null);

  const candidates = members.filter((m) => !m.isSelf);

  const load = () => {
    setList(null);
    setSelected(null);
    setTranscript(null);
    start(async () => {
      const result = await auditListConversationsAction(target);
      if (!result.ok) return toast.fromError(result.error);
      setList(result.data);
    });
  };

  const open = () => {
    if (!selected) return;
    start(async () => {
      const result = await auditReadConversationAction({ userId: target, conversationId: selected, reason });
      if (!result.ok) return toast.fromError(result.error);
      setTranscript(result.data);
    });
  };

  return (
    <section aria-labelledby="audit-heading" className="space-y-4 rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 sm:p-5">
      <div>
        <h2 id="audit-heading" className="text-lg font-semibold text-[var(--color-text-primary)]">Conversation audit</h2>
        <p className="mt-1 max-w-2xl text-sm text-[var(--color-text-secondary)]">
          Conversations are private to the person who had them. You were given audit access, so you can read one when you have a reason. Each look is logged and the person is notified. You cannot change or delete anything.
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <label htmlFor="audit-member" className="mb-1.5 block text-sm font-semibold text-[var(--color-text-primary)]">Person</label>
          <Select id="audit-member" value={target} onChange={(e) => { setTarget(e.target.value); setList(null); setTranscript(null); setSelected(null); }}>
            <option value="">Choose a person</option>
            {candidates.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name} ({m.email})
              </option>
            ))}
          </Select>
        </div>
        <Button onClick={load} disabled={!target || pending}>
          {pending && !transcript ? <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> : <Eye aria-hidden className="size-4" />}
          Show conversations
        </Button>
      </div>

      {list && (list.length === 0 ? (
        <p className="text-sm text-[var(--color-text-secondary)]">This person has no conversations within the retention period.</p>
      ) : (
        <div className="space-y-3">
          <ul aria-label="Conversations" className="divide-y divide-[var(--color-border-subtle)] rounded-[var(--radius-control)] border border-[var(--color-border-subtle)]">
            {list.map((c) => (
              <li key={c.id}>
                <label className="flex min-h-[44px] cursor-pointer items-center gap-3 px-3 py-2 hover:bg-[var(--color-bg-subtle)]">
                  <input type="radio" name="audit-conversation" className="size-4 accent-[var(--color-text-primary)]" checked={selected === c.id} onChange={() => { setSelected(c.id); setTranscript(null); }} />
                  <span className="min-w-0 flex-1 truncate text-sm text-[var(--color-text-primary)]">{c.title}</span>
                  <span className="shrink-0 text-xs tabular-nums text-[var(--color-text-secondary)]">{new Date(c.updatedAt).toLocaleDateString()}</span>
                </label>
              </li>
            ))}
          </ul>
          {selected && !transcript && (
            <div className="space-y-2">
              <label htmlFor="audit-reason" className="block text-sm font-semibold text-[var(--color-text-primary)]">Why are you opening this conversation?</label>
              <input
                id="audit-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={300}
                placeholder="For example: investigating a reported stock discrepancy"
                className="min-h-[44px] w-full rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3 text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-[3px] focus:ring-[var(--color-focus-ring)]"
              />
              <Button variant="primary" onClick={open} disabled={pending || reason.trim().length < 8}>
                {pending && <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />}
                Open and notify {members.find((m) => m.userId === target)?.name ?? "the person"}
              </Button>
            </div>
          )}
        </div>
      ))}

      {transcript && (
        <div className="space-y-4 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] p-4">
          <p className="text-sm font-semibold text-[var(--color-text-primary)]">{transcript.title}</p>
          <ol className="space-y-4">
            {transcript.messages.map((m) => (
              <li key={m.id} className="space-y-1">
                <p className="text-xs font-semibold text-[var(--color-text-secondary)]">{m.role === "user" ? "Person" : "AnOps AI"}</p>
                {m.parts.map((p, i) => (
                  <MessagePart key={i} part={p.type === "confirmation" ? { type: "text", text: `Proposed change: ${p.summary}` } : p} />
                ))}
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
