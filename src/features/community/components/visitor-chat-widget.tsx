"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import {
  startChatConversationAction,
  sendChatMessageAction,
  triggerAiBotReplyAction,
} from "@/features/community/actions/community.action";
import type { ChatConversation, ChatMessage } from "@/features/community/types";
import {
  MessageCircle,
  X,
  Send,
  Bot,
  Sparkles,
  Headset,
} from "lucide-react";

export function VisitorChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [visitorName, setVisitorName] = useState("");
  const [visitorEmail, setVisitorEmail] = useState("");
  const [initialMessage, setInitialMessage] = useState("");
  const [activeConv, setActiveConv] = useState<ChatConversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [isPending, startTransition] = useTransition();
  const [isBotResponding, setIsBotResponding] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatScrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isBotResponding]);

  const handleStartChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!visitorName.trim() || !initialMessage.trim()) return;

    setErrorMsg(null);
    startTransition(async () => {
      const res = await startChatConversationAction({
        visitorName: visitorName.trim(),
        visitorEmail: visitorEmail.trim() || undefined,
        initialMessage: initialMessage.trim(),
        channel: "web_widget",
      });

      if (res.success && res.data) {
        const payload = res.data as {
          conversation: ChatConversation;
          firstMessage: ChatMessage;
        };
        setActiveConv(payload.conversation);
        setMessages([payload.firstMessage]);

        // Auto-trigger AI fallback bot response for simulation
        setIsBotResponding(true);
        const botRes = await triggerAiBotReplyAction(payload.conversation.id);
        if (botRes.success && botRes.data) {
          setMessages((prev) => [...prev, botRes.data as ChatMessage]);
        }
        setIsBotResponding(false);
      } else if (!res.success) {
        setErrorMsg(res.error || "Failed to start chat session");
      }
    });
  };

  const handleSendFollowUp = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeConv || !inputMessage.trim()) return;

    const text = inputMessage.trim();
    setInputMessage("");

    const localMsgId = "local_" + Math.random().toString(36).slice(2, 9);
    const localMsg: ChatMessage = {
      id: localMsgId,
      companyId: activeConv.companyId,
      conversationId: activeConv.id,
      senderType: "visitor",
      senderName: visitorName,
      body: text,
      messageType: "text",
      sentAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, localMsg]);

    startTransition(async () => {
      const res = await sendChatMessageAction({
        conversationId: activeConv.id,
        body: text,
        senderType: "visitor",
        messageType: "text",
      });

      if (res.success && res.data) {
        const realMsg = res.data as ChatMessage;
        setMessages((prev) =>
          prev.map((m) => (m.id === localMsg.id ? realMsg : m))
        );

        // Auto trigger AI fallback bot if operators are offline
        setIsBotResponding(true);
        const botRes = await triggerAiBotReplyAction(activeConv.id);
        if (botRes.success && botRes.data) {
          setMessages((prev) => [...prev, botRes.data as ChatMessage]);
        }
        setIsBotResponding(false);
      }
    });
  };

  return (
    <div className="fixed bottom-5 right-5 z-40">
      {/* Floating Launcher Button */}
      {!isOpen && (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-action-primary)] text-[var(--color-action-on-primary)] shadow-lg hover:scale-105 transition-transform"
          aria-label="Open support chat widget"
        >
          <MessageCircle size={26} />
        </button>
      )}

      {/* Floating Chat Box */}
      {isOpen && (
        <div className="flex flex-col w-[350px] sm:w-[380px] h-[520px] rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] shadow-2xl overflow-hidden transition-all animate-in fade-in slide-in-from-bottom-5">
          {/* Header */}
          <div className="flex items-center justify-between p-4 bg-[var(--color-action-primary)] text-[var(--color-action-on-primary)]">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20">
                <Headset size={18} />
              </span>
              <div>
                <h3 className="text-sm font-semibold">AnOps Live Support</h3>
                <p className="text-[11px] opacity-90 flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
                  Support Team & AI Bot Active
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="rounded-full p-1 hover:bg-white/10 text-white transition-colors"
              aria-label="Close chat"
            >
              <X size={18} />
            </button>
          </div>

          {/* Body */}
          {!activeConv ? (
            /* Visitor Registration Form */
            <form onSubmit={handleStartChat} className="p-5 flex-1 flex flex-col justify-between overflow-y-auto">
              <div className="space-y-3">
                <div className="text-center py-2">
                  <div className="h-12 w-12 rounded-full bg-[var(--color-action-primary)]/10 text-[var(--color-action-primary)] flex items-center justify-center mx-auto mb-2">
                    <Sparkles size={22} />
                  </div>
                  <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">
                    How can we help you today?
                  </h4>
                  <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                    Start a live chat with our operations support or AI FAQ assistant.
                  </p>
                </div>

                {errorMsg && (
                  <div className="p-2 rounded bg-red-100 text-red-700 text-xs">
                    {errorMsg}
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-[var(--color-text-primary)] mb-1">
                    Your Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={visitorName}
                    onChange={(e) => setVisitorName(e.target.value)}
                    placeholder="e.g., Sarah Jenkins"
                    className="w-full rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-3 py-2 text-xs text-[var(--color-text-primary)] focus:border-[var(--color-action-primary)] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--color-text-primary)] mb-1">
                    Your Email (optional)
                  </label>
                  <input
                    type="email"
                    value={visitorEmail}
                    onChange={(e) => setVisitorEmail(e.target.value)}
                    placeholder="sarah@example.com"
                    className="w-full rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-3 py-2 text-xs text-[var(--color-text-primary)] focus:border-[var(--color-action-primary)] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--color-text-primary)] mb-1">
                    Your Question / Message *
                  </label>
                  <textarea
                    required
                    rows={3}
                    value={initialMessage}
                    onChange={(e) => setInitialMessage(e.target.value)}
                    placeholder="Describe what you need help with..."
                    className="w-full rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-2.5 text-xs text-[var(--color-text-primary)] focus:border-[var(--color-action-primary)] focus:outline-none"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isPending || !visitorName.trim() || !initialMessage.trim()}
                className="w-full mt-4 rounded-[var(--radius-control)] bg-[var(--color-action-primary)] py-2.5 text-xs font-semibold text-[var(--color-action-on-primary)] hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {isPending ? "Connecting..." : "Start Chat"}
              </button>
            </form>
          ) : (
            /* Active Live Chat Thread */
            <div className="flex-1 flex flex-col justify-between overflow-hidden">
              <div className="flex-1 p-3.5 overflow-y-auto space-y-2.5 bg-[var(--color-bg-subtle)]/30">
                {messages.map((m) => {
                  const isVisitor = m.senderType === "visitor";
                  const isBot = m.senderType === "bot";

                  return (
                    <div
                      key={m.id}
                      className={`flex flex-col ${
                        isVisitor ? "items-end" : "items-start"
                      }`}
                    >
                      <span className="text-[10px] text-[var(--color-text-secondary)] mb-0.5 px-1">
                        {isBot ? "AnOps Bot" : m.senderName}
                      </span>
                      <div
                        className={`rounded-[var(--radius-control)] px-3 py-2 text-xs max-w-[85%] leading-relaxed ${
                          isVisitor
                            ? "bg-[var(--color-action-primary)] text-[var(--color-action-on-primary)]"
                            : isBot
                            ? "bg-purple-100 text-purple-950 dark:bg-purple-950/60 dark:text-purple-100 border border-purple-200 dark:border-purple-800"
                            : "bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] text-[var(--color-text-primary)]"
                        }`}
                      >
                        {m.body}
                      </div>
                    </div>
                  );
                })}

                {isBotResponding && (
                  <div className="flex items-center gap-1.5 text-xs text-purple-600 dark:text-purple-400 p-1">
                    <Bot size={13} className="animate-bounce" />
                    <span className="text-[11px]">AI Assistant is answering...</span>
                  </div>
                )}
                <div ref={chatScrollRef} />
              </div>

              <form
                onSubmit={handleSendFollowUp}
                className="p-2.5 border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] flex items-center gap-2"
              >
                <input
                  type="text"
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  placeholder="Type a message..."
                  className="flex-1 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-3 py-2 text-xs text-[var(--color-text-primary)] focus:border-[var(--color-action-primary)] focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={isPending || !inputMessage.trim()}
                  className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-action-primary)] text-[var(--color-action-on-primary)] hover:opacity-90 disabled:opacity-50"
                  aria-label="Send message"
                >
                  <Send size={14} />
                </button>
              </form>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
