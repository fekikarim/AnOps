/** Client-safe types shared by the HR Copilot, the Approval Advisor and their UI. */

export type AiAuditEventType =
  | "TOOL_CALL"
  | "ACTION_CREATED"
  | "ACTION_CONFIRMED"
  | "ACTION_CANCELLED"
  | "GUARDRAIL_BLOCK"
  | "PROVIDER_FALLBACK";

export const AI_AUDIT_EVENT_TYPES: AiAuditEventType[] = [
  "TOOL_CALL",
  "ACTION_CREATED",
  "ACTION_CONFIRMED",
  "ACTION_CANCELLED",
  "GUARDRAIL_BLOCK",
  "PROVIDER_FALLBACK",
];

export type AiAuditEntry = {
  id: string;
  userId: string;
  actorName: string;
  role: string;
  conversationId?: string;
  eventType: AiAuditEventType;
  toolName?: string;
  arguments?: Record<string, unknown>;
  resultStatus: string;
  provider?: string;
  model?: string;
  latencyMs?: number;
  createdAt: string;
};

export type ConfirmationCard = {
  type: "confirmation_card";
  actionId: string;
  title: string;
  summary: string;
  details: Record<string, string | number | boolean | null>;
  warnings: string[];
  expiresAt: string;
};

export type CopilotSources = {
  policies: Array<{ title: string; section: string }>;
  data: string[];
};

export type AiActionResult =
  | { ok: true; message: string; resultRef?: string; alreadyConfirmed?: boolean }
  | { ok: false; error: string };

export type AdvisorRecommendationKind = "APPROVE" | "REVIEW" | "REJECT_RISK";
export type AdvisorRiskLevel = "LOW" | "MEDIUM" | "HIGH";

export type RequestFacts = {
  requestId: string;
  employee: { name: string; department: string; hireDate: string; policyName: string | null };
  request: {
    type: string;
    isPaid: boolean;
    startDate: string;
    endDate: string;
    workingDays: number;
    reason: string;
    hasDocument: boolean;
    requiresDocument: boolean;
  };
  /** Null for unpaid leave, which does not use the balance. */
  balance: { available: number; reserved: number; after: number; overdraftDays: number } | null;
  team: { colleagues: number; onLeaveCount: number; onLeavePct: number; onLeaveNames: string[] };
  /** `unexplainedAbsences` and `lateCheckIns` are null when no attendance was recorded in the window. */
  attendance: { windowDays: number; unexplainedAbsences: number | null; lateCheckIns: number | null };
  history: { requestsLast12Months: number; rejectionsLast12Months: number };
  calendar: { holidaysInRange: string[] };
  ownOverlaps: Array<{ status: string; startDate: string; endDate: string }>;
  policy: Array<{ source: string; section: string; snippet: string }>;
  /** The reason text looks like instructions to an AI, so it is withheld from the model. */
  reasonFlagged: boolean;
};

export type AdvisorRecommendation = {
  recommendation: AdvisorRecommendationKind;
  risk_level: AdvisorRiskLevel;
  summary: string;
  reasons: string[];
  policy_refs: Array<{ source: string; section: string }>;
  confidence_note: string;
};

export type AdvisorCardData = AdvisorRecommendation & {
  blocked: boolean;
  /** "llm": written by a model. "rules": deterministic, either blocked or all providers failed. */
  origin: "llm" | "rules";
  provider?: string;
  model?: string;
  generatedAt: string;
  facts: Pick<RequestFacts, "balance" | "team" | "attendance" | "history"> & { workingDays: number };
};
