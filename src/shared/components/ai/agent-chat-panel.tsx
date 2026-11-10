"use client";

import {
  useState,
  useTransition,
  useRef,
  useEffect,
  useCallback,
} from "react";
import {
  Send,
  Loader2,
  Bot,
  User,
  Copy,
  Check,
  Trash2,
  Cpu,
  ChevronDown,
  Zap,
} from "lucide-react";
import { cn } from "@/shared/lib/utils";
import type { AgentMessage } from "@/server/ai/base-agent";

// ─── Types & fetching for live provider models ────────────────────────────────

type ProviderModel = { id: string; label: string };

type ProviderModels = {
  id: string;
  label: string;
  icon: string;
  available: boolean;
  models: ProviderModel[];
  error?: string;
};

type ModelSelection = {
  providerId: string;
  providerLabel: string;
  model: string;
  modelLabel: string;
};

const AUTO_PROVIDER: ProviderModels = {
  id: "auto",
  label: "Auto (Best Available)",
  icon: "⚡",
  available: true,
  models: [{ id: "", label: "Auto-select" }],
};

function getDefaultSelection(): ModelSelection {
  return { providerId: "auto", providerLabel: "Auto", model: "", modelLabel: "Auto-select" };
}

/** Fetch live models from /api/ai/models — cached by browser for the session. */
function useLiveProviders(enabled: boolean) {
  const [providers, setProviders] = useState<ProviderModels[]>([AUTO_PROVIDER]);
  const [loading, setLoading] = useState(enabled);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch("/api/ai/models")
      .then((r) => r.json())
      .then((data: { providers?: ProviderModels[]; error?: string }) => {
        if (cancelled) return;
        if (data.providers) {
          setProviders([AUTO_PROVIDER, ...data.providers]);
        } else {
          setFetchError(data.error ?? "Unknown error");
        }
      })
      .catch((e) => {
        if (!cancelled) setFetchError((e as Error).message);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [enabled]);

  return { providers, loading, fetchError };
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type ChatMessage = AgentMessage & {
  /** Structured card data to render below the message text */
  metadata?: Record<string, unknown>;
};

type ProviderBadge = {
  provider: string;
  model: string;
};

type AgentChatPanelProps = {
  /** Off by default: the server chooses the provider and the model. Only a caller whose server action honours a choice turns it on. */
  allowModelChoice?: boolean;
  /** Display name shown in the header */
  agentName: string;
  /** Short description shown below the name */
  agentDescription?: string;
  /** Icon element rendered in the agent avatar */
  agentIcon?: React.ReactNode;
  /** Initial greeting message from the agent */
  welcomeMessage: string;
  /** Suggested quick-action chips */
  suggestedPrompts?: string[];
  /** Placeholder text in the input */
  inputPlaceholder?: string;
  /** Thinking indicator text */
  thinkingText?: string;
  /** Custom toolbar slot (rendered to the right of the description) */
  toolbar?: React.ReactNode;
  /** Custom card renderer for messages with metadata */
  renderMetadataCard?: (metadata: Record<string, unknown>) => React.ReactNode;
  /** Callback when user clicks an action link in agent response */
  onAction?: (action: string) => void;
  /**
   * Called when the user submits a message — must return the assistant reply.
   * `selectedModel` is the model ID chosen by the user, or empty string for auto.
   */
  onSendMessage: (
    userText: string,
    history: ChatMessage[],
    selectedModel?: string,
    selectedProvider?: string
  ) => Promise<{ text: string; metadata?: Record<string, unknown>; provider?: string; model?: string }>;
  /** Extra classes on the outer wrapper */
  className?: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function initMessage(content: string): ChatMessage {
  return {
    id: "welcome",
    role: "assistant",
    content,
    timestamp: new Date().toISOString(),
  };
}

function cleanLatex(formula: string): string {
  return formula
    .replace(/\\textbf\{([^}]*)\}/g, "$1")
    .replace(/\\text\{([^}]*)\}/g, "$1")
    .replace(/\\mathrm\{([^}]*)\}/g, "$1")
    .replace(/\\mathbf\{([^}]*)\}/g, "$1")
    .replace(/\\boxed\{([^}]*)\}/g, "$1")
    .replace(/\\sum(?:_\{[^}]*\})?(?:\^\{[^}]*\})?/g, "Σ")
    .replace(/\\times/g, "×")
    .replace(/\\cdot/g, "·")
    .replace(/\\div/g, "÷")
    .replace(/\\le(?:q)?/g, "≤")
    .replace(/\\ge(?:q)?/g, "≥")
    .replace(/\\approx/g, "≈")
    .replace(/\\neq/g, "≠")
    .replace(/\\pm/g, "±")
    .replace(/\\quad|\\qquad/g, "  ")
    .replace(/\\[,;!]/g, " ")
    .replace(/\\/g, "")
    .trim();
}

function renderMarkdown(text: string): string {
  // 1. Preserve fenced code blocks
  const codeBlocks: string[] = [];
  let out = text.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length;
    const safeCode = code
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const langBadge = lang
      ? `<div class="text-[9px] uppercase font-bold text-neutral-400 mb-1 tracking-wider">${lang}</div>`
      : "";
    codeBlocks.push(
      `<div class="my-2.5 rounded-lg bg-neutral-950 text-neutral-100 p-3 border border-neutral-800 text-xs font-mono overflow-x-auto shadow-xs">${langBadge}<pre class="m-0 leading-relaxed font-mono"><code>${safeCode.trim()}</code></pre></div>`
    );
    return `__CODE_BLOCK_${idx}__`;
  });

  // Model and user text is untrusted and ends up in innerHTML, so it must not be able to open tags or attributes.
  // ">" stays as is: it cannot open anything, and blockquotes below rely on it.
  out = out.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

  // 2. Convert LaTeX display math blocks: \[ ... \] or $$ ... $$
  out = out.replace(/(?:\\\[|\$\$)([\s\S]*?)(?:\\\]|\$\$)/g, (_, math) => {
    const clean = cleanLatex(math);
    return `<div class="my-2.5 px-3 py-2 rounded-lg bg-[var(--color-bg-subtle)] border border-[var(--color-border-subtle)] font-mono text-xs font-bold text-center text-[var(--color-text-primary)] shadow-2xs">${clean}</div>`;
  });

  // 3. Convert LaTeX inline math: \( ... \)
  out = out.replace(/\\\((.*?)\\\)/g, (_, math) => {
    const clean = cleanLatex(math);
    return `<code class="font-mono text-xs font-bold px-1.5 py-0.5 rounded bg-[var(--color-bg-subtle)] border border-[var(--color-border-subtle)]">${clean}</code>`;
  });

  // 4. Markdown tables
  out = out.replace(/(?:^|\n)((?:\|[^\n]+\|\n?)+)/g, (_, tableText) => {
    const lines = tableText.trim().split("\n").map((l: string) => l.trim()).filter(Boolean);
    if (lines.length < 2) return tableText;

    const rows: string[][] = [];
    for (const line of lines) {
      if (/^\|(?:\s*:?-+:?\s*\|)+$/.test(line)) continue; // skip separator row
      const cells = line.split("|").slice(1, -1).map((c: string) => c.trim());
      if (cells.length > 0) rows.push(cells);
    }
    if (rows.length === 0) return tableText;

    const [header, ...bodyRows] = rows;
    const ths = header
      .map((h: string) => `<th class="px-2.5 py-1.5 text-left font-bold border-b border-[var(--color-border-subtle)] text-[11px]">${h}</th>`)
      .join("");
    const trs = bodyRows
      .map((r: string[]) => {
        const tds = r
          .map((c: string) => `<td class="px-2.5 py-1.5 border-b border-[var(--color-border-subtle)]/60 text-[11px] text-[var(--color-text-secondary)]">${c}</td>`)
          .join("");
        return `<tr class="hover:bg-[var(--color-bg-subtle)]/40 transition-colors">${tds}</tr>`;
      })
      .join("");

    return `\n<div class="my-2.5 overflow-x-auto rounded-lg border border-[var(--color-border-subtle)] shadow-2xs"><table class="w-full text-xs text-left border-collapse"><thead class="bg-[var(--color-bg-subtle)] text-[var(--color-text-primary)]"><tr>${ths}</tr></thead><tbody>${trs}</tbody></table></div>\n`;
  });

  // 5. Action links: [Label](#action:action-name) or [Label](action:action-name)
  out = out.replace(
    /\[(.*?)\]\(#?action:([^)]+)\)/g,
    '<a href="#action:$2" data-action="$2" class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold bg-[var(--color-action-primary)] text-[var(--color-action-on-primary)] hover:opacity-90 transition-all shadow-xs my-1 mr-1.5 cursor-pointer no-underline"><span class="truncate">$1</span> <svg class="w-3 h-3 shrink-0 inline ml-0.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"/></svg></a>'
  );

  // 6. Regular links: [Label](url)
  out = out.replace(
    /\[(.*?)\]\((https?:\/\/[^\s)]+|\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" class="font-bold underline text-[var(--color-action-primary)] hover:opacity-80 transition-opacity">$1</a>'
  );

  // 7. Auto-convert common action phrases
  out = out
    .replace(
      /(HR Portal\s*→\s*Leave\s*Balance\s*section|Leave\s*Balance\s*section)/gi,
      '<a href="#action:view-leave-balance" data-action="view-leave-balance" class="inline-flex items-center gap-1 font-bold underline text-[var(--color-action-primary)] hover:opacity-80 transition-opacity cursor-pointer">$1 <svg class="w-3 h-3 inline" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"/></svg></a>'
    )
    .replace(
      /(submit a (?:new )?leave request|submit a leave request|request (?:time off|leave))/gi,
      '<a href="#action:submit-leave-request" data-action="submit-leave-request" class="inline-flex items-center gap-1 font-bold underline text-[var(--color-action-primary)] hover:opacity-80 transition-opacity cursor-pointer">$1 <svg class="w-3 h-3 inline" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"/></svg></a>'
    );

  // 8. Horizontal rules
  out = out.replace(/^(?:---+|\*\*\*+|___+)$/gm, '<hr class="my-3 border-t border-[var(--color-border-subtle)]" />');

  // 9. Blockquotes
  out = out.replace(/^> (.*)$/gm, '<blockquote class="pl-3 py-1 my-2 border-l-2 border-[var(--color-action-primary)] text-xs text-[var(--color-text-secondary)] italic bg-[var(--color-bg-subtle)]/40 rounded-r">$1</blockquote>');

  // 10. Headers
  out = out
    .replace(/^#### (.+)$/gm, "<h4 class='text-xs font-bold uppercase tracking-wider mt-3 mb-1 text-[var(--color-text-primary)]'>$1</h4>")
    .replace(/^### (.+)$/gm, "<h3 class='text-sm font-bold mt-3 mb-1 text-[var(--color-text-primary)]'>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2 class='text-base font-bold mt-4 mb-1 text-[var(--color-text-primary)]'>$1</h2>");

  // 11. Bold, inline code, italics
  out = out
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code class='bg-black/10 dark:bg-white/10 rounded px-1.5 py-0.5 text-[0.85em] font-mono font-bold'>$1</code>");

  // 12. Lists
  out = out
    .replace(/^- (.+)$/gm, "<li class='ml-4 list-disc'>$1</li>")
    .replace(/^[0-9]+\.\s+(.+)$/gm, "<li class='ml-4 list-decimal'>$1</li>")
    .replace(/(<li class='ml-4 list-disc'>[\s\S]*?<\/li>\n?)+/g, (m) => `<ul class='space-y-0.5 my-1.5'>${m}</ul>`)
    .replace(/(<li class='ml-4 list-decimal'>[\s\S]*?<\/li>\n?)+/g, (m) => `<ol class='space-y-0.5 my-1.5'>${m}</ol>`);

  // 13. Restore code blocks
  out = out.replace(/__CODE_BLOCK_(\d+)__/g, (_, idx) => codeBlocks[Number(idx)] || "");

  // 14. Convert newlines to <br/> while avoiding double breaks around block elements
  out = out.replace(/\n{2,}/g, "<br/><br/>").replace(/\n/g, "<br/>");
  out = out.replace(/<\/(div|table|thead|tbody|tr|th|td|ul|ol|li|blockquote|h2|h3|h4|hr)><br\/>/g, "</$1>");
  out = out.replace(/<br\/><(div|table|thead|tbody|tr|th|td|ul|ol|li|blockquote|h2|h3|h4|hr)/g, "<$1");

  return out;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AgentChatPanel({
  agentName,
  agentDescription,
  agentIcon,
  welcomeMessage,
  suggestedPrompts = [],
  inputPlaceholder = "Ask a question…",
  thinkingText = "Thinking…",
  toolbar,
  renderMetadataCard,
  onAction,
  onSendMessage,
  className,
  allowModelChoice = false,
}: AgentChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    initMessage(welcomeMessage),
  ]);
  const [input, setInput] = useState("");
  const [isPending, startTransition] = useTransition();
  const [providerBadge, setProviderBadge] = useState<ProviderBadge | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [selection, setSelection] = useState<ModelSelection>(getDefaultSelection());
  const [selectorOpen, setSelectorOpen] = useState(false);
  const { providers, loading: providersLoading, fetchError } = useLiveProviders(allowModelChoice);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const selectorRef = useRef<HTMLDivElement>(null);

  // Close selector on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (selectorRef.current && !selectorRef.current.contains(e.target as Node)) {
        setSelectorOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isPending]);

  // Show scroll-to-bottom button when user scrolls up
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollBtn(distFromBottom > 120);
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Auto-grow textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
  };

  const send = useCallback(
    (text?: string) => {
      const userText = (text ?? input).trim();
      if (!userText || isPending) return;

      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: userText,
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }

      startTransition(async () => {
        try {
          // Pass history EXCLUDING the welcome message for cleaner context
          const historyForAgent = messages.filter((m) => m.id !== "welcome");
          const result = await onSendMessage(
            userText,
            [...historyForAgent, userMsg],
            selection.model || undefined,
            selection.providerId === "auto" ? undefined : selection.providerId
          );

          const assistantMsg: ChatMessage = {
            id: `agent-${Date.now()}`,
            role: "assistant",
            content: result.text,
            timestamp: new Date().toISOString(),
            metadata: result.metadata,
          };

          setMessages((prev) => [...prev, assistantMsg]);

          if (result.provider && result.model) {
            setProviderBadge({ provider: result.provider, model: result.model });
          }
        } catch (err) {
          console.error("[AgentChatPanel send error]", err);
          setMessages((prev) => [
            ...prev,
            {
              id: `err-${Date.now()}`,
              role: "assistant",
              content:
                "I encountered an error. Please check that at least one AI provider is configured in `.env` and try again.",
              timestamp: new Date().toISOString(),
            },
          ]);
        }
      });
    },
    [input, isPending, messages, onSendMessage, selection]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const handleCopy = (id: string, content: string) => {
    navigator.clipboard.writeText(content).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1800);
    });
  };

  const handleClear = () => {
    setMessages([initMessage(welcomeMessage)]);
    setProviderBadge(null);
  };

  const handleSelectModel = (
    providerId: string,
    providerLabel: string,
    model: string,
    modelLabel: string
  ) => {
    setSelection({ providerId, providerLabel, model, modelLabel });
    setSelectorOpen(false);
  };

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 sm:p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              {agentIcon && (
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-action-primary)] text-[var(--color-action-on-primary)] shadow-xs">
                  {agentIcon}
                </span>
              )}
              <h2 className="text-lg font-bold text-[var(--color-text-primary)]">
                {agentName}
              </h2>
              <span className="rounded-full bg-[var(--color-action-primary)]/15 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-[var(--color-action-primary)]">
                AI Agent
              </span>
            </div>
            {agentDescription && (
              <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                {agentDescription}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            {toolbar}
            <button
              type="button"
              onClick={handleClear}
              title="Clear conversation"
              className="flex min-h-[36px] items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-3 text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-error-text)] hover:border-[var(--color-error-text)] transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear
            </button>
          </div>
        </div>

        {/* Provider badge — last response info */}
        {providerBadge && (
          <div className="mt-3 flex items-center gap-1.5 text-[10px] text-[var(--color-text-secondary)]">
            <Cpu className="h-3 w-3" />
            <span>
              Last response via{" "}
              <strong className="text-[var(--color-text-primary)]">
                {providerBadge.provider}
              </strong>{" "}
              · {providerBadge.model}
            </span>
          </div>
        )}
      </div>

      {/* ── Chat Area ──────────────────────────────────────────────────── */}
      <div className="relative rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] shadow-xs flex flex-col h-[440px] sm:h-[580px]">

        {/* Messages */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 scroll-smooth"
        >
          {messages.map((msg) => {
            const isUser = msg.role === "user";
            return (
              <div
                key={msg.id}
                className={cn(
                  "flex gap-3 group",
                  isUser ? "justify-end" : "justify-start"
                )}
              >
                {/* Agent avatar */}
                {!isUser && (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--color-action-primary)] to-[var(--color-action-hover)] text-[var(--color-action-on-primary)] shadow-xs">
                    {agentIcon ?? <Bot className="h-4 w-4" />}
                  </div>
                )}

                <div className={cn("max-w-2xl space-y-2", isUser && "items-end flex flex-col")}>
                  {/* Bubble */}
                  <div
                    className={cn(
                      "rounded-2xl px-4 py-3 shadow-xs text-xs leading-relaxed",
                      isUser
                        ? "bg-[var(--color-action-primary)] text-[var(--color-action-on-primary)] font-medium rounded-tr-sm"
                        : "bg-[var(--color-bg-subtle)] text-[var(--color-text-primary)] border border-[var(--color-border-subtle)] rounded-tl-sm"
                    )}
                  >
                    <div
                      dir="auto"
                      className="prose prose-xs dark:prose-invert max-w-none"
                      onClick={(e) => {
                        const link = (e.target as HTMLElement).closest("a[data-action]");
                        if (link) {
                          e.preventDefault();
                          const act = link.getAttribute("data-action");
                          if (act && onAction) onAction(act);
                        }
                      }}
                      // eslint-disable-next-line react/no-danger
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                    />

                    {/* Metadata card */}
                    {msg.metadata && renderMetadataCard && (
                      <div className="mt-3">
                        {renderMetadataCard(msg.metadata)}
                      </div>
                    )}

                    <div className="mt-1.5 text-[9px] opacity-50 text-right">
                      {new Date(msg.timestamp).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  </div>

                  {/* Copy button — agent messages only */}
                  {!isUser && (
                    <button
                      type="button"
                      onClick={() => handleCopy(msg.id, msg.content)}
                      className="flex items-center gap-1 text-[10px] text-[var(--color-text-secondary)] opacity-0 group-hover:opacity-100 transition-opacity hover:text-[var(--color-text-primary)]"
                    >
                      {copiedId === msg.id ? (
                        <><Check className="h-3 w-3 text-[var(--color-status-success)]" /> Copied</>
                      ) : (
                        <><Copy className="h-3 w-3" /> Copy</>
                      )}
                    </button>
                  )}
                </div>

                {/* User avatar */}
                {isUser && (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-text-primary)] text-[var(--color-bg-surface)] shadow-xs">
                    <User className="h-4 w-4" />
                  </div>
                )}
              </div>
            );
          })}

          {/* Typing indicator */}
          {isPending && (
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--color-action-primary)] to-[var(--color-action-hover)] text-[var(--color-action-on-primary)] animate-pulse">
                {agentIcon ?? <Bot className="h-4 w-4" />}
              </div>
              <div className="rounded-2xl rounded-tl-sm bg-[var(--color-bg-subtle)] px-4 py-3 border border-[var(--color-border-subtle)] flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>{thinkingText}</span>
                <span className="flex gap-0.5 ml-1">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="h-1.5 w-1.5 rounded-full bg-[var(--color-text-secondary)] animate-bounce"
                      style={{ animationDelay: `${i * 150}ms` }}
                    />
                  ))}
                </span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Scroll-to-bottom FAB */}
        {showScrollBtn && (
          <button
            type="button"
            onClick={scrollToBottom}
            className="absolute bottom-24 right-4 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] shadow-md text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-all animate-in fade-in slide-in-from-bottom-2"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        )}

        {/* ── Suggested Prompts ──────────────────────────────────────── */}
        {suggestedPrompts.length > 0 && (
          <div className="border-t border-[var(--color-border-subtle)] px-4 py-2 bg-[var(--color-bg-subtle)]/40 overflow-x-auto flex items-center gap-2 no-scrollbar">
            <span className="text-[10px] font-bold text-[var(--color-text-secondary)] shrink-0">
              Try:
            </span>
            {suggestedPrompts.map((prompt, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => send(prompt)}
                disabled={isPending}
                className="shrink-0 rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-text-primary)] hover:border-[var(--color-action-primary)] hover:bg-[var(--color-action-primary)]/10 transition-colors disabled:opacity-50"
              >
                {prompt}
              </button>
            ))}
          </div>
        )}

        {/* ── Input Bar ─────────────────────────────────────────────── */}
        <div className="border-t border-[var(--color-border-subtle)] p-3 sm:p-4 bg-[var(--color-bg-surface)] rounded-b-[var(--radius-card)]">

          {/* Model selector row */}
          <div className={cn("mb-2 flex items-center gap-2 relative", !allowModelChoice && "hidden")} ref={selectorRef}>
            <button
              type="button"
              onClick={() => setSelectorOpen((v) => !v)}
              disabled={providersLoading}
              className={cn(
                "flex items-center gap-1.5 rounded-[var(--radius-control)] border px-2.5 py-1 text-[11px] font-medium transition-colors",
                selection.model
                  ? "border-[var(--color-action-primary)] bg-[var(--color-action-primary)]/10 text-[var(--color-action-primary)]"
                  : "border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
                providersLoading && "opacity-60 cursor-wait"
              )}
            >
              {providersLoading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Zap className="h-3 w-3" />
              )}
              <span>{providersLoading ? "Loading models…" : selection.providerLabel}</span>
              {selection.model && !providersLoading && (
                <span className="text-[var(--color-text-secondary)] font-normal">· {selection.modelLabel}</span>
              )}
              {!providersLoading && (
                <ChevronDown className={cn("h-3 w-3 transition-transform", selectorOpen && "rotate-180")} />
              )}
            </button>

            {/* Fetch error hint */}
            {fetchError && !providersLoading && (
              <span className="text-[10px] text-[var(--color-error-text)]">
                Could not load models — using defaults
              </span>
            )}

            {/* Dropdown */}
            {selectorOpen && !providersLoading && (
              <div className="absolute bottom-full mb-1 left-0 z-50 w-72 max-h-80 overflow-y-auto rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] shadow-xl animate-in fade-in slide-in-from-bottom-2 duration-150">
                <div className="sticky top-0 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)] bg-[var(--color-bg-surface)] border-b border-[var(--color-border-subtle)]">
                  Provider &amp; Model
                </div>
                {providers.map((provider) => (
                  <div key={provider.id}>
                    {/* Provider header */}
                    <div className={cn(
                      "flex items-center justify-between px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider bg-[var(--color-bg-subtle)]",
                      !provider.available && provider.id !== "auto" && "opacity-50"
                    )}>
                      <span>{provider.icon} {provider.label}</span>
                      {provider.id !== "auto" && (
                        <span className={cn(
                          "rounded-full px-1.5 py-0.5 text-[9px] font-bold",
                          provider.available
                            ? "bg-[var(--color-status-success-bg)] text-[var(--color-status-success)]"
                            : "bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)]"
                        )}>
                          {provider.available ? `${provider.models.length} models` : provider.error ?? "Not configured"}
                        </span>
                      )}
                    </div>

                    {/* Models list */}
                    {provider.available ? (
                      provider.models.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => handleSelectModel(provider.id, provider.label, m.id, m.label)}
                          className={cn(
                            "w-full text-left px-4 py-1.5 text-xs transition-colors hover:bg-[var(--color-bg-subtle)] flex items-center justify-between gap-2",
                            selection.model === m.id
                              ? "text-[var(--color-action-primary)] font-semibold bg-[var(--color-action-primary)]/5"
                              : "text-[var(--color-text-primary)]"
                          )}
                        >
                          <span className="truncate">{m.label}</span>
                          {selection.model === m.id && (
                            <Check className="h-3 w-3 shrink-0 text-[var(--color-action-primary)]" />
                          )}
                        </button>
                      ))
                    ) : (
                      <div className="px-4 py-2 text-[11px] text-[var(--color-text-secondary)] italic">
                        Add {provider.label} key to .env to enable
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
            className="flex items-end gap-2"
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={inputPlaceholder}
              rows={1}
              disabled={isPending}
              className="flex-1 resize-none rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3 py-2.5 text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--color-action-primary)] min-h-[42px] max-h-[120px] transition-[border-color]"
            />
            <button
              type="submit"
              disabled={isPending || !input.trim()}
              className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-action-primary)] text-[var(--color-action-on-primary)] hover:bg-[var(--color-action-hover)] transition-colors disabled:opacity-40 shadow-xs"
              title="Send"
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </button>
          </form>
          <p className="mt-1.5 text-[10px] text-[var(--color-text-secondary)] text-center">
            Shift+Enter for new line · AI can make mistakes — verify important info
          </p>
        </div>
      </div>
    </div>
  );
}
