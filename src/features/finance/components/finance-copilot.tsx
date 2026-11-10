"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Lock, RotateCcw, ScanLine, Sparkles } from "lucide-react";
import { getAiWorkspaceAction, runAiCommandAction } from "@/features/ai/actions/ai.action";
import { Composer } from "@/features/ai/components/composer";
import { MessagePart } from "@/features/ai/components/message-parts";
import { ThreadActionsProvider, type ThreadRequest, type ThreadResult } from "@/features/ai/components/thread-actions";
import { ChatRequestError, streamChat, type StreamEvent } from "@/features/ai/components/stream-chat";
import type { AiWorkspaceState } from "@/features/ai/types";
import { Drawer } from "@/shared/components/ui/drawer";
import { cn } from "@/shared/lib/utils";
import type { AiMessagePart } from "@/server/db/documents";

type UiMessage = { id: string; role: "user" | "assistant"; parts: AiMessagePart[]; streaming?: boolean };

/** Starting points written for the screen the person is on. */
function promptsFor(path: string): string[] {
  if (path.startsWith("/finance/invoices")) return ["Which invoices are overdue?", "Who owes us the most?", "Show the receivables aging", "/newinvoice"];
  if (path.startsWith("/finance/payments")) return ["Which payments are not allocated yet?", "Show the receivables aging", "/recordpayment", "/unpaid"];
  if (path.startsWith("/finance/expenses")) return ["Which expenses need a second look?", "What is waiting for my approval?", "How much did we spend this month?", "/newexpense"];
  if (path.startsWith("/finance/customers")) return ["Who owes us the most?", "Which customers pay late?", "/newcustomer"];
  if (path.startsWith("/finance/receipts")) return ["Which expenses need a second look?", "How much did we spend this month?", "/newexpense"];
  return ["How is our cash flow for the next 90 days?", "What should I do first today?", "Which invoices are overdue?", "Show the receivables aging"];
}

function pageLabel(path: string): string {
  const map: Array<[string, string]> = [
    ["/finance/invoices/new", "New invoice form"],
    ["/finance/invoices/", "An invoice's detail page"],
    ["/finance/invoices", "Invoices list"],
    ["/finance/payments", "Payments"],
    ["/finance/expenses", "Expenses"],
    ["/finance/customers", "Customers"],
    ["/finance/receipts", "Receipt scanner"],
  ];
  return map.find(([p]) => path.startsWith(p))?.[1] ?? "Finance dashboard";
}

/**
 * The Finance Copilot: the AnOps AI engine (same tools, confirmations, audit and limits) scoped to Finance,
 * in a drawer on every Finance page. It sees only finance tools; changes still need the person's confirmation.
 */
export function FinanceCopilot() {
  const path = usePathname() ?? "/finance";
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<AiWorkspaceState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [guidedBusy, setGuidedBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || state) return;
    void getAiWorkspaceAction().then((r) => (r.ok ? setState(r.data) : setLoadError(r.error.message)));
  }, [open, state]);

  useEffect(() => {
    if (messages.length) endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const patch = useCallback((id: string, update: (p: AiMessagePart[]) => AiMessagePart[], streaming = true) => {
    setMessages((cur) => cur.map((m) => (m.id === id ? { ...m, parts: update(m.parts), streaming } : m)));
  }, []);

  const send = useCallback(
    async (text: string) => {
      const assistantId = crypto.randomUUID();
      setMessages((cur) => [...cur, { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text }] }, { id: assistantId, role: "assistant", parts: [], streaming: true }]);
      setSending(true);
      const controller = new AbortController();
      abortRef.current = controller;
      const onEvent = (e: StreamEvent) => {
        if (e.type === "conversation") setConversationId(e.conversationId);
        else if (e.type === "text")
          patch(assistantId, (parts) => {
            const last = parts[parts.length - 1];
            return last?.type === "text" ? [...parts.slice(0, -1), { type: "text", text: last.text + e.text }] : [...parts, { type: "text", text: e.text }];
          });
        else if (e.type === "part") patch(assistantId, (parts) => [...parts, e.part]);
        else if (e.type === "error") patch(assistantId, (parts) => [...parts, { type: "error", code: e.code, message: e.message }], false);
      };
      try {
        await streamChat({ text, conversationId: conversationId ?? undefined, scope: "finance", page: pageLabel(path) }, onEvent, controller.signal);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          patch(assistantId, (parts) => [...parts, { type: "error", code: "REQUEST", message: error instanceof ChatRequestError ? error.message : "Could not reach the Copilot. Check your connection and try again." }], false);
        }
      } finally {
        patch(assistantId, (p) => p, false);
        setSending(false);
        abortRef.current = null;
      }
    },
    [conversationId, patch, path]
  );

  const runGuided = useCallback(
    async (request: ThreadRequest): Promise<ThreadResult> => {
      setGuidedBusy(true);
      const result = await runAiCommandAction({ ...request, conversationId: conversationId ?? undefined });
      setGuidedBusy(false);
      if (!result.ok) {
        if (request.step !== "submit") setMessages((m) => [...m, { id: crypto.randomUUID(), role: "assistant", parts: [{ type: "error", code: result.error.code, message: result.error.message }] }]);
        return { ok: false, error: result.error };
      }
      const parts: AiMessagePart[] = [...(result.data.text ? [{ type: "text" as const, text: result.data.text }] : []), ...result.data.parts];
      setMessages((m) => [...m, { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text: request.label }] }, { id: crypto.randomUUID(), role: "assistant", parts }]);
      return { ok: true };
    },
    [conversationId]
  );

  const reset = () => {
    abortRef.current?.abort();
    setMessages([]);
    setConversationId(null);
  };

  const financeCommands = state?.commands.filter((c) => c.module === "finance" || c.module === "core") ?? [];
  const ready = state?.state === "ready";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open the Finance Copilot"
        className="fixed bottom-5 right-5 z-40 inline-flex min-h-[48px] items-center gap-2 rounded-full bg-[var(--color-action-primary)] px-4 text-sm font-semibold text-[var(--color-action-on-primary)] shadow-lg transition-transform hover:scale-[1.03] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)] motion-reduce:transition-none print:hidden pb-[env(safe-area-inset-bottom)]"
        data-tour="finance-copilot"
      >
        <Sparkles aria-hidden className="size-4 shrink-0" />
        <span className="hidden sm:inline">Finance Copilot</span>
      </button>

      <Drawer open={open} onClose={() => setOpen(false)} title="Finance Copilot" description="Ask about invoices, payments, expenses and cash flow. Changes always wait for your confirmation.">
        <div className="flex h-[min(78dvh,46rem)] flex-col">
          {!state && !loadError && <p className="p-2 text-sm text-[var(--color-text-secondary)]" role="status">Loading…</p>}
          {loadError && <p role="alert" className="p-2 text-sm text-[var(--color-status-error)]">{loadError}</p>}
          {state && !ready && (
            <div className="flex flex-col items-center gap-3 p-6 text-center">
              <Lock aria-hidden className="size-6 text-[var(--color-text-secondary)]" />
              <p className="text-sm text-[var(--color-text-primary)]">
                {state.state === "plan_excluded" ? "AI features are not included in your organization's plan." : state.state === "company_disabled" ? "AnOps AI is not turned on for your company." : state.state === "not_granted" ? "AI is not enabled for your account yet." : "AI is not available right now."}
              </p>
              {state.canManageAccess && (
                <Link href="/ai/access" className="text-sm font-semibold underline">
                  Open AI access settings
                </Link>
              )}
            </div>
          )}

          {ready && (
            <>
              <div className="flex items-center justify-between gap-2 pb-2 text-xs text-[var(--color-text-secondary)]">
                <span className="truncate">On: {pageLabel(path)}</span>
                <div className="flex shrink-0 items-center gap-3">
                  {messages.length > 0 && (
                    <button type="button" onClick={reset} className="inline-flex items-center gap-1 font-semibold hover:text-[var(--color-text-primary)] focus:outline-none focus-visible:underline">
                      <RotateCcw aria-hidden className="size-3.5" /> New chat
                    </button>
                  )}
                  <Link href="/ai" className="inline-flex items-center gap-1 font-semibold hover:text-[var(--color-text-primary)]">
                    Full AI <ExternalLink aria-hidden className="size-3.5" />
                  </Link>
                </div>
              </div>

              <div role="log" aria-live="polite" aria-busy={sending} className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] p-3">
                {messages.length === 0 ? (
                  <div className="space-y-3">
                    <p className="text-sm text-[var(--color-text-primary)]">What do you need on {pageLabel(path).toLowerCase()}?</p>
                    <ul className="grid gap-2">
                      {promptsFor(path)
                        .filter((p) => !p.startsWith("/") || financeCommands.some((c) => c.command === p))
                        .map((p) => (
                          <li key={p}>
                            <button
                              type="button"
                              onClick={() => void send(p)}
                              className="flex min-h-[44px] w-full items-center rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] px-3 py-2 text-left text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-bg-subtle)] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)]"
                            >
                              {p.startsWith("/") ? financeCommands.find((c) => c.command === p)?.description ?? p : p}
                            </button>
                          </li>
                        ))}
                    </ul>
                    <Link href="/finance/receipts" onClick={() => setOpen(false)} className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-action-primary)] hover:underline">
                      <ScanLine aria-hidden className="size-4" /> Scan a receipt
                    </Link>
                  </div>
                ) : (
                  <ThreadActionsProvider value={{ run: runGuided, busy: guidedBusy || sending }}>
                    <ol className="space-y-4">
                      {messages.map((m) => (
                        <li key={m.id} className={cn(m.role === "user" && "flex justify-end")}>
                          {m.role === "user" ? (
                            <div className="max-w-[88%] rounded-[var(--radius-card)] bg-[var(--color-bg-subtle)] px-3 py-2">
                              {m.parts.map((p, i) => (
                                <MessagePart key={i} part={p} />
                              ))}
                            </div>
                          ) : (
                            <div className="min-w-0 space-y-2">
                              {m.parts.length === 0 && m.streaming && (
                                <p role="status" className="flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)]">
                                  <span className="size-1.5 animate-pulse rounded-full bg-[var(--color-text-secondary)] motion-reduce:animate-none" /> Working on it
                                </p>
                              )}
                              {m.parts.map((p, i) => (
                                <MessagePart key={i} part={p} />
                              ))}
                            </div>
                          )}
                        </li>
                      ))}
                    </ol>
                  </ThreadActionsProvider>
                )}
                <div ref={endRef} />
              </div>

              <div className="pt-3">
                <Composer commands={financeCommands} sending={sending} onSend={(t) => void send(t)} onStop={() => abortRef.current?.abort()} />
              </div>
            </>
          )}
        </div>
      </Drawer>
    </>
  );
}
