"use client";

import { useState, useEffect, useTransition, useRef, useCallback } from "react";
import type { ChatConversation, ChatMessage } from "@/features/community/types";
import {
  sendChatMessageAction,
  closeChatConversationAction,
  triggerAiBotReplyAction,
  getAiReplySuggestionsAction,
} from "@/features/community/actions/community.action";
import {
  Headset,
  Bot,
  Send,
  Sparkles,
  RefreshCw,
  Search,
} from "lucide-react";

interface LiveChatSectionProps {
  initialConversations: ChatConversation[];
  currentUserId?: string;
  currentUserName?: string;
}

export function LiveChatSection({
  initialConversations,
  currentUserId,
  currentUserName = "Support Specialist",
}: LiveChatSectionProps) {
  const [conversations, setConversations] =
    useState<ChatConversation[]>(initialConversations);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(
    initialConversations[0]?.id || null
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputBody, setInputBody] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  // AI suggestions
  const [suggestions, setSuggestions] = useState<string[]>([]);

  const [isPending, startTransition] = useTransition();
  const [isBotThinking, setIsBotThinking] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeConversation = conversations.find((c) => c.id === selectedConvId);

  // Filter conversations
  const filteredConversations = conversations.filter((conv) => {
    const matchesStatus =
      statusFilter === "all" || conv.status === statusFilter;
    const matchesSearch =
      !search.trim() ||
      conv.visitorName.toLowerCase().includes(search.toLowerCase()) ||
      (conv.visitorEmail &&
        conv.visitorEmail.toLowerCase().includes(search.toLowerCase()));
    return matchesStatus && matchesSearch;
  });

  const fetchMessages = useCallback(async (convId: string) => {
    try {
      const res = await fetch(
        `/api/v1/community/chat?conversationId=${encodeURIComponent(convId)}`
      );
      if (res.ok) {
        const json = await res.json();
        if (json.data) {
          setMessages(json.data);
        }
      }
    } catch {
      // Graceful fallback
    }
  }, []);

  const loadSuggestions = useCallback(async (convId: string) => {
    try {
      const res = await getAiReplySuggestionsAction(convId);
      if (res.success && res.data) {
        setSuggestions(res.data);
      }
    } catch {
      setSuggestions([]);
    }
  }, []);

  // Fetch conversation messages & suggestions when selected conversation changes
  useEffect(() => {
    if (!selectedConvId) return;
    let cancelled = false;

    fetch(`/api/v1/community/chat?conversationId=${encodeURIComponent(selectedConvId)}`)
      .then((res) => res.json())
      .then((json) => {
        if (!cancelled && json.data) {
          setMessages(json.data);
        }
      })
      .catch(() => {});

    getAiReplySuggestionsAction(selectedConvId)
      .then((res) => {
        if (!cancelled && res.success && res.data) {
          setSuggestions(res.data);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [selectedConvId]);

  // Polling for new messages every 5 seconds
  useEffect(() => {
    if (!selectedConvId) return;
    const interval = setInterval(() => {
      fetchMessages(selectedConvId);
    }, 5000);
    return () => clearInterval(interval);
  }, [selectedConvId, fetchMessages]);

  // Scroll to bottom when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSendMessage = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedConvId || !inputBody.trim()) return;

    const bodyToSend = inputBody.trim();
    setInputBody("");

    const localId = `temp_${crypto.randomUUID()}`;
    const tempMsg: ChatMessage = {
      id: localId,
      companyId: activeConversation?.companyId || "",
      conversationId: selectedConvId,
      senderUserId: currentUserId,
      senderType: "agent",
      senderName: currentUserName,
      body: bodyToSend,
      messageType: "text",
      sentAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempMsg]);

    startTransition(async () => {
      const res = await sendChatMessageAction({
        conversationId: selectedConvId,
        body: bodyToSend,
      });

      if (res.success && res.data) {
        const realMsg = res.data as ChatMessage;
        setMessages((prev) =>
          prev.map((m) => (m.id === tempMsg.id ? realMsg : m))
        );
      }
    });
  };

  const handleTriggerAiBot = () => {
    if (!selectedConvId) return;
    setIsBotThinking(true);

    startTransition(async () => {
      const res = await triggerAiBotReplyAction(selectedConvId);
      if (res.success && res.data) {
        setMessages((prev) => [...prev, res.data as ChatMessage]);
      }
      setIsBotThinking(false);
    });
  };

  const handleCloseConversation = () => {
    if (!selectedConvId) return;
    startTransition(async () => {
      const res = await closeChatConversationAction(selectedConvId);
      if (res.success) {
        setConversations((prev) =>
          prev.map((c) =>
            c.id === selectedConvId ? { ...c, status: "closed" } : c
          )
        );
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
            Live Support Console
          </h2>
          <p className="text-xs text-[var(--color-text-secondary)]">
            Respond to visitor inquiries in real time or leverage the AI Fallback Assistant.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            if (selectedConvId) {
              fetchMessages(selectedConvId);
              loadSuggestions(selectedConvId);
            }
          }}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text-primary)]"
        >
          <RefreshCw size={13} className={isPending ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* Two-Panel Workspace */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] overflow-hidden min-h-[580px]">
        {/* Left: Conversation List (4 Cols) */}
        <div className="md:col-span-5 lg:col-span-4 border-r border-[var(--color-border-subtle)] flex flex-col h-full bg-[var(--color-bg-subtle)]/20">
          {/* Search & Filter */}
          <div className="p-3 border-b border-[var(--color-border-subtle)] space-y-2">
            <div className="relative">
              <Search
                size={14}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)]"
              />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search visitor or email..."
                className="w-full rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] pl-8 pr-2.5 py-1.5 text-xs text-[var(--color-text-primary)] focus:border-[var(--color-action-primary)] focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-1">
              {["all", "open", "closed"].map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`rounded-[var(--radius-control)] px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide transition-colors ${
                    statusFilter === st
                      ? "bg-[var(--color-action-primary)] text-[var(--color-action-on-primary)]"
                      : "bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>

          {/* Conversation Items */}
          <div className="flex-1 overflow-y-auto divide-y divide-[var(--color-border-subtle)]">
            {filteredConversations.length === 0 ? (
              <div className="p-8 text-center text-xs text-[var(--color-text-secondary)]">
                No conversations found.
              </div>
            ) : (
              filteredConversations.map((conv) => {
                const isSelected = conv.id === selectedConvId;
                return (
                  <div
                    key={conv.id}
                    onClick={() => setSelectedConvId(conv.id)}
                    className={`p-3.5 transition-colors cursor-pointer flex items-start gap-3 ${
                      isSelected
                        ? "bg-[var(--color-action-primary)]/10 border-l-3 border-[var(--color-action-primary)]"
                        : "hover:bg-[var(--color-bg-subtle)]/60"
                    }`}
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-action-primary)]/15 text-xs font-bold text-[var(--color-action-primary)]">
                      {conv.visitorName.slice(0, 2).toUpperCase()}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-semibold text-[var(--color-text-primary)] truncate">
                          {conv.visitorName}
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                            conv.status === "open"
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                              : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                          }`}
                        >
                          {conv.status}
                        </span>
                      </div>

                      <p className="mt-0.5 text-[11px] text-[var(--color-text-secondary)] truncate">
                        {conv.visitorEmail || "Guest User via Web Widget"}
                      </p>

                      <div className="mt-1.5 flex items-center justify-between text-[10px] text-[var(--color-text-secondary)]">
                        <span>
                          {new Date(conv.lastMessageAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        {conv.unreadCount > 0 && (
                          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[var(--color-action-primary)] text-[9px] font-bold text-[var(--color-action-on-primary)]">
                            {conv.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right: Message Stream (8 Cols) */}
        <div className="md:col-span-7 lg:col-span-8 flex flex-col h-full bg-[var(--color-bg-surface)]">
          {activeConversation ? (
            <>
              {/* Header */}
              <div className="flex items-center justify-between p-3.5 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-action-primary)]/10 text-xs font-bold text-[var(--color-action-primary)]">
                    {activeConversation.visitorName.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
                      {activeConversation.visitorName}
                      <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                    </h3>
                    <p className="text-[11px] text-[var(--color-text-secondary)]">
                      {activeConversation.visitorEmail || "Web Widget Inquirer"} • Session:{" "}
                      {activeConversation.visitorSessionId.slice(0, 10)}...
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {/* AI Bot Fallback Button */}
                  <button
                    type="button"
                    onClick={handleTriggerAiBot}
                    disabled={isBotThinking}
                    className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-purple-200 bg-purple-50 px-2.5 py-1.5 text-xs font-semibold text-purple-700 hover:bg-purple-100 dark:border-purple-800 dark:bg-purple-950/50 dark:text-purple-300 transition-colors"
                    title="Generate automated fallback reply via AnOps AI Bot"
                  >
                    <Sparkles size={13} className={isBotThinking ? "animate-spin" : ""} />
                    {isBotThinking ? "Bot Generating..." : "AI FAQ Reply"}
                  </button>

                  {activeConversation.status === "open" && (
                    <button
                      type="button"
                      onClick={handleCloseConversation}
                      className="inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text-primary)] transition-colors"
                    >
                      Close Chat
                    </button>
                  )}
                </div>
              </div>

              {/* Chat Thread */}
              <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-[var(--color-bg-subtle)]/20 min-h-[360px] max-h-[440px]">
                {messages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-8 text-[var(--color-text-secondary)]">
                    <Headset size={32} className="opacity-40 mb-2" />
                    <p className="text-xs">No messages yet in this session.</p>
                  </div>
                ) : (
                  messages.map((msg) => {
                    const isVisitor = msg.senderType === "visitor";
                    const isBot = msg.senderType === "bot";

                    return (
                      <div
                        key={msg.id}
                        className={`flex flex-col ${
                          isVisitor
                            ? "items-start"
                            : isBot
                            ? "items-start"
                            : "items-end"
                        }`}
                      >
                        <div className="flex items-center gap-1.5 mb-1 px-1 text-[10px] text-[var(--color-text-secondary)]">
                          {isBot ? (
                            <span className="font-semibold text-purple-600 dark:text-purple-400 flex items-center gap-1">
                              <Bot size={11} /> AI Support Bot
                            </span>
                          ) : (
                            <span className="font-medium">{msg.senderName}</span>
                          )}
                          <span>•</span>
                          <span>
                            {new Date(msg.sentAt).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>

                        <div
                          className={`max-w-[85%] sm:max-w-[75%] rounded-[var(--radius-control)] px-3.5 py-2.5 text-xs leading-relaxed ${
                            isVisitor
                              ? "bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] text-[var(--color-text-primary)]"
                              : isBot
                              ? "bg-purple-50 border border-purple-200 text-purple-950 dark:bg-purple-950/40 dark:border-purple-800 dark:text-purple-100"
                              : "bg-[var(--color-action-primary)] text-[var(--color-action-on-primary)]"
                          }`}
                        >
                          <p className="whitespace-pre-wrap">{msg.body}</p>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* AI Reply Suggestions Bar */}
              {suggestions.length > 0 && (
                <div className="px-3.5 py-2 border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)]/40 flex items-center gap-1.5 overflow-x-auto">
                  <span className="text-[10px] font-semibold text-purple-700 dark:text-purple-300 flex items-center gap-1 shrink-0">
                    <Sparkles size={11} /> Suggestions:
                  </span>
                  {suggestions.map((sug, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setInputBody(sug)}
                      className="shrink-0 rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-2.5 py-1 text-[11px] text-[var(--color-text-primary)] hover:border-[var(--color-action-primary)] hover:text-[var(--color-action-primary)] transition-colors truncate max-w-[260px]"
                    >
                      {sug}
                    </button>
                  ))}
                </div>
              )}

              {/* Input Area */}
              <form
                onSubmit={handleSendMessage}
                className="p-3 border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] flex items-center gap-2"
              >
                <input
                  type="text"
                  value={inputBody}
                  onChange={(e) => setInputBody(e.target.value)}
                  placeholder="Type support reply or click AI suggestion above..."
                  className="flex-1 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-3.5 py-2 text-xs text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] focus:border-[var(--color-action-primary)] focus:outline-none min-h-[42px]"
                />
                <button
                  type="submit"
                  disabled={isPending || !inputBody.trim()}
                  className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-[var(--color-action-primary)] px-4 py-2 min-h-[42px] text-xs font-semibold text-[var(--color-action-on-primary)] transition-all hover:opacity-90 disabled:opacity-50"
                >
                  <Send size={13} />
                  Send
                </button>
              </form>
            </>
          ) : (
            <div className="h-full flex flex-col items-center justify-center p-8 text-center text-[var(--color-text-secondary)]">
              <Headset size={36} className="opacity-40 mb-2" />
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
                Select a conversation
              </h3>
              <p className="mt-1 text-xs">
                Pick a live chat inquiry on the left to start responding.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
