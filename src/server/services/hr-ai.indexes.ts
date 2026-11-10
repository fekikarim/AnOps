import "server-only";
import type { IndexDescription } from "mongodb";

export const HR_AI_COLLECTIONS = {
  pendingActions: "hr_ai_pending_actions",
  auditLog: "hr_ai_audit_log",
  recommendations: "hr_ai_recommendations",
} as const;

export const HR_AI_INDEXES: Record<string, IndexDescription[]> = {
  [HR_AI_COLLECTIONS.pendingActions]: [
    { key: { companyId: 1, userId: 1, status: 1, createdAt: -1 }, name: "ai_action_user_status" },
  ],
  [HR_AI_COLLECTIONS.auditLog]: [
    { key: { companyId: 1, createdAt: -1 }, name: "ai_audit_time" },
    { key: { companyId: 1, userId: 1, createdAt: -1 }, name: "ai_audit_user_time" },
  ],
  [HR_AI_COLLECTIONS.recommendations]: [
    { key: { companyId: 1, leaveRequestId: 1 }, name: "ai_recommendation_request_unique", unique: true },
  ],
};
