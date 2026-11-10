"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, History, Lock, Sparkles } from "lucide-react";
import {
  deleteConversationAction,
  getConversationAction,
  listConversationsAction,
  markNoticesReadAction,
  runAiCommandAction,
} from "@/features/ai/actions/ai.action";
import { Composer } from "@/features/ai/components/composer";
import { ConversationRail } from "@/features/ai/components/conversation-rail";
import { MessagePart } from "@/features/ai/components/message-parts";
import { ThreadActionsProvider, type ThreadRequest, type ThreadResult } from "@/features/ai/components/thread-actions";
import { ChatRequestError, streamChat, type StreamEvent } from "@/features/ai/components/stream-chat";
import type { AiWorkspaceState, ConversationSummaryDto } from "@/features/ai/types";
import { EmptyState } from "@/shared/components/data-display/empty-state";
import { Button } from "@/shared/components/ui/button";
import { Drawer } from "@/shared/components/ui/drawer";
import { useToast } from "@/shared/components/ui/toast";
import { cn } from "@/shared/lib/utils";
import type { AiMessagePart } from "@/server/db/documents";

type UiMessage = { id: string; role: "user" | "assistant"; parts: AiMessagePart[]; streaming?: boolean };

/** Starting points, shown only when the member can actually run them. */
const SUGGESTIONS = [
  { command: "/products", label: "Browse products" },
  { command: "/stock", label: "Check stock levels" },
  { command: "/newproduct", label: "Add a product" },
  { command: "/neworder", label: "Create a purchase order" },
  { command: "/materials", label: "Check materials for production" },
  { command: "/newinvoice", label: "Create an invoice" },
  { command: "/unpaid", label: "See unpaid invoices" },
  { command: "/receive", label: "Receive stock" },
  { command: "/access", label: "What can you do for me?" },
  { command: "/help", label: "Show available commands" },
];

function Unavailable({ state, canManage }: { state: AiWorkspaceState["state"]; canManage: boolean }) {
  if (state === "platform_disabled") {
    return <EmptyState icon={Lock} title="AnOps AI is switched off for now" description="AI has been turned off for the whole platform by an operator. Everything else in AnOps keeps working. Try again later." />;
  }
  if (state === "plan_excluded") {
    return (
      <EmptyState
        icon={Lock}
        title="AI features are not in your plan"
        description={canManage ? "AnOps AI and the AI features inside every application are included in MaxOps, and in Custom with the AI add-on." : "Your organization's plan does not include AI features. An owner or administrator can upgrade the plan."}
        actionHref={canManage ? "/anops?plans=1" : undefined}
        actionLabel={canManage ? "Compare plans" : undefined}
      />
    );
  }
  if (state === "company_disabled") {
    return (
      <EmptyState
        icon={Lock}
        title="AnOps AI is not turned on for your company"
        description={canManage ? "Turn it on, then choose who can use it and what it may do." : "An owner or administrator needs to turn it on first. Ask them if you would like to use it."}
        actionHref={canManage ? "/ai/access" : undefined}
        actionLabel={canManage ? "Set up AI access" : undefined}
      />
    );
  }
  if (state === "not_granted") {
    return (
      <EmptyState
        icon={Lock}
        title="AI is not enabled for your account"
        description="Your company has AnOps AI, but it has not been enabled for you yet. Ask an owner or administrator to give you access."
        actionHref={canManage ? "/ai/access" : undefined}
        actionLabel={canManage ? "Manage access" : undefined}
      />
    );
  }
  return <EmptyState icon={Lock} title="Your account is not active in this company" description="Sign in with an active account, or ask an owner to restore your membership." />;
}

export function AiWorkspace({ initial }: { initial: AiWorkspaceState }) {
  const toast = useToast();
  const [conversations, setConversations] = useState<ConversationSummaryDto[]>(initial.conversations);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [unreadNotices, setUnreadNotices] = useState(initial.notices.filter((n) => !n.read));
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const title = useMemo(() => conversations.find((c) => c.id === activeId)?.title ?? "New conversation", [conversations, activeId]);

  useEffect(() => {
    // The empty state starts at the top; only a real thread follows the newest message.
    if (messages.length > 0 && stickRef.current) endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const refreshList = useCallback(async () => {
    const result = await listConversationsAction();
    if (result.ok) setConversations(result.data);
  }, []);

  const patchAssistant = useCallback((id: string, update: (parts: AiMessagePart[]) => AiMessagePart[], streaming = true) => {
    setMessages((current) => current.map((m) => (m.id === id ? { ...m, parts: update(m.parts), streaming } : m)));
  }, []);

  const send = useCallback(
    async (text: string) => {
      const assistantId = crypto.randomUUID();
      stickRef.current = true;
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text }] },
        { id: assistantId, role: "assistant", parts: [], streaming: true },
      ]);
      setSending(true);
      const controller = new AbortController();
      abortRef.current = controller;

      const onEvent = (event: StreamEvent) => {
        switch (event.type) {
          case "conversation":
            setActiveId(event.conversationId);
            break;
          case "text":
            patchAssistant(assistantId, (parts) => {
              const last = parts[parts.length - 1];
              return last?.type === "text" ? [...parts.slice(0, -1), { type: "text", text: last.text + event.text }] : [...parts, { type: "text", text: event.text }];
            });
            break;
          case "part":
            patchAssistant(assistantId, (parts) => [...parts, event.part]);
            break;
          case "error":
            patchAssistant(assistantId, (parts) => [...parts, { type: "error", code: event.code, message: event.message }], false);
            break;
          case "done":
            patchAssistant(assistantId, (parts) => parts, false);
            break;
        }
      };

      try {
        await streamChat({ text, conversationId: activeId ?? undefined }, onEvent, controller.signal);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          const message = error instanceof ChatRequestError ? error.message : "Could not reach AnOps AI. Check your connection and try again.";
          patchAssistant(assistantId, (parts) => [...parts, { type: "error", code: "REQUEST", message }], false);
        }
      } finally {
        patchAssistant(assistantId, (parts) => parts, false);
        setSending(false);
        abortRef.current = null;
        void refreshList();
      }
    },
    [activeId, patchAssistant, refreshList]
  );

  const open = useCallback(
    async (id: string) => {
      setHistoryOpen(false);
      setLoadingConversation(true);
      const result = await getConversationAction(id);
      setLoadingConversation(false);
      if (!result.ok) {
        toast.fromError(result.error);
        void refreshList();
        return;
      }
      stickRef.current = true;
      setActiveId(result.data.id);
      setMessages(result.data.messages.map((m) => ({ id: m.id, role: m.role, parts: m.parts })));
    },
    [refreshList, toast]
  );

  const [guidedBusy, setGuidedBusy] = useState(false);

  /** One click in a guided flow. The server re-checks access, validates every argument and records the step in this conversation. */
  const runGuided = useCallback(
    async (request: ThreadRequest): Promise<ThreadResult> => {
      setGuidedBusy(true);
      const result = await runAiCommandAction({ ...request, conversationId: activeId ?? undefined });
      setGuidedBusy(false);
      if (!result.ok) {
        // A form shows its own error under the fields; every other step reports in the thread.
        if (request.step !== "submit") {
          setMessages((m) => [...m, { id: crypto.randomUUID(), role: "assistant", parts: [{ type: "error", code: result.error.code, message: result.error.message }] }]);
        }
        return { ok: false, error: result.error };
      }
      stickRef.current = true;
      const parts: AiMessagePart[] = [...(result.data.text ? [{ type: "text" as const, text: result.data.text }] : []), ...result.data.parts];
      setMessages((m) => [...m, { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text: request.label }] }, { id: crypto.randomUUID(), role: "assistant", parts }]);
      void refreshList();
      return { ok: true };
    },
    [activeId, refreshList]
  );

  const startNew = useCallback(() => {
    abortRef.current?.abort();
    setActiveId(null);
    setMessages([]);
    setHistoryOpen(false);
  }, []);

  const remove = useCallback(
    async (id: string) => {
      const result = await deleteConversationAction(id);
      if (!result.ok) {
        toast.fromError(result.error);
        return;
      }
      if (id === activeId) startNew();
      void refreshList();
    },
    [activeId, refreshList, startNew, toast]
  );

  const dismissNotices = async () => {
    setUnreadNotices([]);
    await markNoticesReadAction();
  };

  if (initial.state !== "ready") {
    return <Unavailable state={initial.state} canManage={initial.canManageAccess} />;
  }

  const threadActions = { run: runGuided, busy: guidedBusy || sending };
  const capped = initial.tokenCap > 0;
  const used = initial.usedToday;

  return (
    <div className="space-y-4">
      {unreadNotices.length > 0 && (
        <div role="status" className="flex items-start gap-3 rounded-[var(--radius-card)] border border-[var(--color-status-warning)] bg-[var(--color-status-warning-bg)] p-3 text-sm text-[var(--color-status-warning)]">
          <Bell aria-hidden className="mt-0.5 size-4 shrink-0" />
          <p className="flex-1">
            An authorised administrator opened {unreadNotices.length === 1 ? "one of your conversations" : `${unreadNotices.length} of your conversations`} for audit. This is logged and read-only.
          </p>
          <button type="button" onClick={dismissNotices} className="min-h-[44px] -my-3 px-2 text-sm font-semibold hover:underline focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)]">
            Dismiss
          </button>
        </div>
      )}

      <div className="grid h-[calc(100dvh-13.5rem)] min-h-[30rem] gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <aside aria-label="Conversation history" className="hidden min-h-0 rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-3 lg:block">
          <ConversationRail conversations={conversations} activeId={activeId} busy={sending} onSelect={open} onNew={startNew} onDelete={remove} />
        </aside>

        <section aria-label="Conversation" className="flex min-h-0 min-w-0 flex-col rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
          <header className="flex items-center gap-2 border-b border-[var(--color-border-subtle)] px-3 py-2 sm:px-4">
            <Button variant="ghost" className="lg:hidden" onClick={() => setHistoryOpen(true)} aria-label="Open conversation history">
              <History aria-hidden className="size-4" />
              <span className="hidden sm:inline">History</span>
            </Button>
            <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--color-text-primary)]">{title}</h2>
            <div className="shrink-0 text-right text-xs tabular-nums text-[var(--color-text-secondary)]" title="Tokens used today against your daily limit">
              {capped ? (
                <>
                  <span className="sr-only">Daily usage: </span>
                  {used.toLocaleString()} of {initial.tokenCap.toLocaleString()} today
                </>
              ) : (
                <>{used.toLocaleString()} used today</>
              )}
            </div>
          </header>

          <div
            ref={scrollerRef}
            role="log"
            aria-live="polite"
            aria-relevant="additions text"
            aria-busy={sending}
            onScroll={(e) => {
              const el = e.currentTarget;
              stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            }}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-5 sm:px-6"
          >
            {loadingConversation ? (
              <div aria-busy="true" aria-label="Loading conversation" className="mx-auto max-w-3xl space-y-4">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-14 animate-pulse rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)] motion-reduce:animate-none" style={{ width: `${88 - i * 18}%` }} />
                ))}
              </div>
            ) : messages.length === 0 ? (
              <div className="mx-auto flex min-h-full max-w-xl flex-col py-6">
              <div className="my-auto">
                <h3 className="text-2xl text-[var(--color-text-primary)]">What do you want to get done?</h3>
                <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
                  Ask in English or French, or type / for commands. Inventory, Purchasing, Manufacturing, Finance, HR, Marketing and Community are connected: stock, orders, receipts, work orders, customers, invoices, payments, expenses, employees, leave, attendance, payroll previews, campaigns, contacts, and Community articles, forum and support chat.
                </p>
                <ul className="mt-5 grid gap-2 sm:grid-cols-2">
                  {SUGGESTIONS.filter((s) => initial.commands.some((c) => c.command === s.command)).slice(0, 4).map((s) => (
                    <li key={s.command}>
                      <button
                        type="button"
                        onClick={() => void send(s.command)}
                        className="flex min-h-[44px] w-full flex-col items-start justify-center rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] px-3 py-2 text-left transition-colors hover:bg-[var(--color-bg-subtle)] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)]"
                      >
                        <span className="text-sm font-semibold text-[var(--color-text-primary)]">{s.label}</span>
                        <span className="text-xs text-[var(--color-text-secondary)]">{s.command}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                {initial.canManageAccess && (
                  <p className="mt-5 text-sm text-[var(--color-text-secondary)]">
                    Managing who can use AI?{" "}
                    <Link href="/ai/access" className="font-semibold text-[var(--color-text-primary)] underline underline-offset-2">
                      Open access and limits
                    </Link>
                  </p>
                )}
              </div>
              </div>
            ) : (
              <ThreadActionsProvider value={threadActions}>
              <ol className="mx-auto max-w-3xl space-y-6">
                {messages.map((m) => (
                  <li key={m.id} className={cn(m.role === "user" && "flex justify-end")}>
                    {m.role === "user" ? (
                      <div className="max-w-[88%] rounded-[var(--radius-card)] bg-[var(--color-bg-subtle)] px-4 py-2.5">
                        {m.parts.map((p, i) => (
                          <MessagePart key={i} part={p} />
                        ))}
                      </div>
                    ) : (
                      <div className="flex gap-3">
                        <span aria-hidden className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-action-primary)] text-[var(--color-action-on-primary)]">
                          <Sparkles className="size-4" />
                        </span>
                        <div className="min-w-0 flex-1 space-y-3">
                          <p className="text-xs font-semibold text-[var(--color-text-secondary)]">AnOps AI</p>
                          {m.parts.length === 0 && m.streaming && (
                            <p className="flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)]" role="status">
                              <span className="size-1.5 animate-pulse rounded-full bg-[var(--color-text-secondary)] motion-reduce:animate-none" />
                              Working on it
                            </p>
                          )}
                          {m.parts.map((p, i) => (
                            <MessagePart key={i} part={p} />
                          ))}
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ol>
              </ThreadActionsProvider>
            )}
            <div ref={endRef} />
          </div>

          <div className="border-t border-[var(--color-border-subtle)] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4">
            <div className="mx-auto max-w-3xl">
              <Composer commands={initial.commands} sending={sending} onSend={(t) => void send(t)} onStop={() => abortRef.current?.abort()} />
            </div>
          </div>
        </section>
      </div>

      <Drawer open={historyOpen} onClose={() => setHistoryOpen(false)} title="Your conversations" description="Only you can see these.">
        <ConversationRail conversations={conversations} activeId={activeId} busy={sending} onSelect={open} onNew={startNew} onDelete={remove} />
      </Drawer>
    </div>
  );
}
