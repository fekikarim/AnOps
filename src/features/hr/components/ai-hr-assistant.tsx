"use client";

import { Sparkles, ShieldCheck, BookOpen, X, Calendar, Plus, History } from "lucide-react";
import Link from "next/link";
import { AgentChatPanel } from "@/shared/components/ai/agent-chat-panel";
import type { ChatMessage } from "@/shared/components/ai/agent-chat-panel";
import { chatWithHRAssistantAction } from "@/features/hr/actions/hr-assistant.action";
import { COMPANY_POLICIES } from "@/features/hr/policies/company-policies";
import { ConfirmationCard, SourcesLine } from "@/features/hr/components/copilot-cards";
import type { ConfirmationCard as ConfirmationCardData, CopilotSources } from "@/features/hr/ai/types";
import { useState } from "react";
import { Portal } from "@/shared/components/ui/portal";
import { DialogOverlay } from "@/shared/components/ui/dialog-overlay";

type AIHRAssistantProps = {
  userRole?: "employee" | "manager" | "hr_admin";
  /** Callback to switch tabs in the HR portal */
  onNavigateTab?: (tab: "employees" | "leave" | "attendance" | "payroll" | "ai") => void;
  /** Callback to directly open the new leave request modal */
  onOpenLeaveRequest?: () => void;
  /** Reloads HR data after a confirmed action */
  onDataChanged?: () => void;
};

const SUGGESTED_PROMPTS_EMPLOYEE = [
  "How many days do I have left?",
  "Book 3 days of annual leave starting next Monday",
  "Show my leave requests",
  "Is unpaid leave deducted from my salary?",
  "What happens to my unused leave if I leave the company?",
];

const SUGGESTED_PROMPTS_ADMIN = [
  "Who is absent today?",
  "Show pending leave requests",
  "Preview payroll for this month",
  "Who is on leave next week?",
  "How is Solde de congé calculated?",
];

const WELCOME_MESSAGE = `Hello! I'm your **AnOps HR Copilot**. I work from your company policies and live HR data, in English, French, Arabic or Derja.

I can:
- 🌴 Explain your **Solde de congé** and how it is calculated
- 📝 **Prepare a leave request or cancellation**. Nothing is submitted until you click Confirm
- 💰 Explain **payroll and deductions**
- 📋 Answer questions on **HR policies**

What would you like to do?`;

/**
 * AI HR Copilot panel: AgentChatPanel (shared UI) wired to the copilot via chatWithHRAssistantAction.
 * Identity and role are decided on the server; the props here only choose what to display.
 */
export function AIHRAssistant({
  userRole = "employee",
  onNavigateTab,
  onOpenLeaveRequest,
  onDataChanged,
}: AIHRAssistantProps) {
  const isAdmin = userRole === "hr_admin";
  const [conversationId] = useState(() => `hr-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [selectedPolicyId, setSelectedPolicyId] = useState(COMPANY_POLICIES[0]?.id ?? "");

  const selectedPolicy = COMPANY_POLICIES.find((p) => p.id === selectedPolicyId);
  const suggestedPrompts = isAdmin ? SUGGESTED_PROMPTS_ADMIN : SUGGESTED_PROMPTS_EMPLOYEE;

  const handleAction = (action: string) => {
    const act = action.toLowerCase();
    if (act.includes("submit") || act.includes("request")) {
      onOpenLeaveRequest?.();
    } else if (act.includes("leave") || act.includes("balance")) {
      onNavigateTab?.("leave");
    } else if (act.includes("attendance")) {
      onNavigateTab?.("attendance");
    } else if (act.includes("payroll") || act.includes("payslip")) {
      onNavigateTab?.("payroll");
    } else if (act.includes("employee")) {
      onNavigateTab?.("employees");
    }
  };

  /** Bridge: AgentChatPanel → HR server action */
  const handleSend = async (
    userText: string,
    history: ChatMessage[],
    selectedModel?: string,
    selectedProvider?: string
  ) => {
    const result = await chatWithHRAssistantAction({
      userMessage: userText,
      conversationId,
      uiLanguage: typeof navigator === "undefined" ? undefined : navigator.language,
      model: selectedModel || undefined,
      provider: selectedProvider || undefined,
      // The last entry is the message being sent. Earlier cards and metadata are not sent back.
      history: history.slice(0, -1).slice(-4).map((m) => ({ role: m.role, content: m.content })),
    });

    if (!result.ok) {
      return { text: result.error };
    }

    return {
      text: result.text,
      metadata: { cards: result.cards, sources: result.sources, balanceCard: result.balanceCard },
      provider: result.provider,
      model: result.model,
    };
  };

  const toolbar = (
    <div className="flex items-center gap-2">
      {/* AI audit trail: HR Admin only, also enforced by the page */}
      {isAdmin && (
        <Link
          href="/hr/ai-activity"
          className="flex min-h-[36px] items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-3 text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-subtle)] transition-colors shadow-xs"
        >
          <History className="h-3.5 w-3.5" />
          AI Activity
        </Link>
      )}

      {/* Policy library button */}
      <button
        type="button"
        onClick={() => setPolicyOpen(true)}
        className="flex min-h-[36px] items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-3 text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-subtle)] transition-colors shadow-xs"
      >
        <BookOpen className="h-3.5 w-3.5" />
        Policy Library ({COMPANY_POLICIES.length})
      </button>
    </div>
  );

  return (
    <>
      <AgentChatPanel
        allowModelChoice
        agentName="HR Copilot"
        agentDescription={
          <span className="flex items-center gap-1">
            <ShieldCheck className="h-3.5 w-3.5 text-[var(--color-status-success)]" />
            Grounded in company policies and live HR data. You confirm every change.
          </span> as unknown as string
        }
        agentIcon={<Sparkles className="h-4 w-4" />}
        welcomeMessage={WELCOME_MESSAGE}
        suggestedPrompts={suggestedPrompts}
        inputPlaceholder="Ask a question, or say: Book 3 days starting next Monday…"
        thinkingText="Checking HR policies and records…"
        toolbar={toolbar}
        onAction={handleAction}
        onSendMessage={handleSend}
        renderMetadataCard={(metadata) => {
          const cards = (metadata.cards ?? []) as ConfirmationCardData[];
          const sources = metadata.sources as CopilotSources | undefined;
          const balanceCard = () => {
            if (!metadata.balanceCard) return null;
            const d = metadata.balanceCard as Record<string, unknown>;
            const employeeName = typeof d.employeeName === "string" ? d.employeeName : undefined;
            const earned = Number(d.earned ?? d.allowance ?? 0);
            const taken = Number(d.taken ?? d.usedPaidDays ?? d.used ?? 0);
            const reserved = Number(d.reserved ?? 0);
            const available = Number(d.available ?? d.remainingDays ?? d.remaining ?? 0);
            const policyName = typeof d.policyName === "string" ? d.policyName : undefined;
            const legalRef = typeof d.legalReference === "string" ? d.legalReference : undefined;

            return (
              <div className="mt-2.5 rounded-[var(--radius-control)] bg-[var(--color-bg-surface)] p-3 border border-[var(--color-border-subtle)] space-y-2.5 shadow-xs animate-in fade-in duration-200">
                <div className="flex items-center justify-between text-[11px] font-semibold text-[var(--color-text-secondary)] border-b border-[var(--color-border-subtle)] pb-1.5">
                  <span className="font-bold text-[var(--color-text-primary)]">
                    {employeeName ? `${employeeName}'s Leave Balance` : "Real-time Leave Balance"}
                  </span>
                  {policyName && <span className="text-[10px] truncate max-w-[150px]">{policyName}</span>}
                </div>

                <div className="grid grid-cols-4 gap-1.5 text-center">
                  <div className="p-1.5 rounded-md bg-[var(--color-bg-subtle)] border border-[var(--color-border-subtle)]">
                    <span className="text-[9px] text-[var(--color-text-secondary)] font-medium block">Earned</span>
                    <div className="font-bold text-xs text-[var(--color-text-primary)]">{earned}d</div>
                  </div>
                  <div className="p-1.5 rounded-md bg-[var(--color-bg-subtle)] border border-[var(--color-border-subtle)]">
                    <span className="text-[9px] text-[var(--color-text-secondary)] font-medium block">Taken</span>
                    <div className="font-bold text-xs text-[var(--color-text-secondary)]">{taken}d</div>
                  </div>
                  <div className="p-1.5 rounded-md bg-[var(--color-warning-bg)] border border-[var(--color-warning-border)]">
                    <span className="text-[9px] text-[var(--color-warning-text)] font-bold block">Reserved</span>
                    <div className="font-bold text-xs text-[var(--color-warning-text)]">{reserved}d</div>
                  </div>
                  <div className="p-1.5 rounded-md bg-[var(--color-status-success-bg)]">
                    <span className="text-[9px] font-bold text-[var(--color-status-success)] block">Available</span>
                    <div className="font-black text-xs text-[var(--color-status-success)]">{available}d</div>
                  </div>
                </div>

                {legalRef && (
                  <p className="text-[9px] italic text-[var(--color-text-secondary)]">
                    * Ref: {legalRef}
                  </p>
                )}

                {/* Direct Action Buttons */}
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[var(--color-border-subtle)]">
                  <button
                    type="button"
                    onClick={() => onNavigateTab?.("leave")}
                    className="flex-1 min-w-[130px] flex items-center justify-center gap-1.5 px-3 py-2 rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)] hover:bg-[var(--color-border-subtle)] text-[11px] font-bold text-[var(--color-text-primary)] transition-all border border-[var(--color-border-subtle)] hover:shadow-xs cursor-pointer"
                  >
                    <Calendar className="h-3.5 w-3.5 text-[var(--color-action-primary)]" />
                    <span>View Leave Balance</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenLeaveRequest?.()}
                    className="flex-1 min-w-[130px] flex items-center justify-center gap-1.5 px-3 py-2 rounded-[var(--radius-control)] bg-[var(--color-action-primary)] hover:bg-[var(--color-action-hover)] text-[11px] font-bold text-[var(--color-action-on-primary)] transition-all shadow-xs cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Request Leave</span>
                  </button>
                </div>
              </div>
            );
          };

          return (
            <div className="space-y-2.5">
              {cards.map((card) => (
                <ConfirmationCard key={card.actionId} card={card} onConfirmed={onDataChanged} />
              ))}
              {balanceCard()}
              {sources && <SourcesLine sources={sources} />}
            </div>
          );
        }}
      />

      {/* Policy Library Modal */}
      {policyOpen && (
        <Portal>
          <DialogOverlay label="Policy library" onClose={() => setPolicyOpen(false)} className="fixed inset-0 z-50 flex flex-col justify-end sm:justify-center sm:items-center overflow-hidden p-0 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200" onClick={() => setPolicyOpen(false)}>
            <div
              className="relative w-full max-w-2xl max-h-[92dvh] sm:max-h-[85vh] overflow-y-auto rounded-t-[calc(var(--radius-card)+6px)] sm:rounded-[var(--radius-card)] border-t sm:border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 sm:p-6 shadow-2xl pb-[max(1rem,env(safe-area-inset-bottom))] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-10 h-1 rounded-full bg-[var(--color-border-control)] mx-auto mb-3 sm:hidden shrink-0" />

              <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] pb-4">
                <div className="flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-[var(--color-text-secondary)]" />
                  <h3 className="text-base font-bold text-[var(--color-text-primary)]">
                    Company Policy Library
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setPolicyOpen(false)}
                  className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[var(--radius-control)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Policy pills */}
              <div className="flex items-center gap-1.5 overflow-x-auto py-3 border-b border-[var(--color-border-subtle)] no-scrollbar">
                {COMPANY_POLICIES.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedPolicyId(p.id)}
                    className={`shrink-0 rounded-[var(--radius-control)] px-3 py-1.5 text-xs font-bold transition-colors ${
                      selectedPolicyId === p.id
                        ? "bg-[var(--color-action-primary)] text-[var(--color-action-on-primary)]"
                        : "border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)]"
                    }`}
                  >
                    {p.title}
                  </button>
                ))}
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto pt-4 pr-1 text-xs space-y-3 text-[var(--color-text-primary)]">
                {selectedPolicy && (
                  <>
                    <div className="rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)] p-3">
                      <span className="font-bold text-[11px] uppercase tracking-wider text-[var(--color-text-secondary)]">
                        Summary
                      </span>
                      <p className="mt-0.5">{selectedPolicy.summary}</p>
                    </div>
                    <div className="whitespace-pre-wrap leading-relaxed font-mono bg-[var(--color-bg-subtle)]/40 p-4 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)]">
                      {selectedPolicy.content}
                    </div>
                  </>
                )}
              </div>

              <div className="border-t border-[var(--color-border-subtle)] pt-3 text-right shrink-0">
                <button
                  type="button"
                  onClick={() => setPolicyOpen(false)}
                  className="min-h-[44px] rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] px-5 text-sm font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </DialogOverlay>
        </Portal>
      )}
    </>
  );
}
