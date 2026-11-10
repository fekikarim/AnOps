"use server";

import { aiPromptSchema } from "@/features/hr/schemas/hr.schema";
import { askHRAssistant } from "@/server/services/hr.service";
import type { AIChatMessage } from "@/features/hr/types";
import type { ActionResult } from "./employee.action";

import { requireAuthUser } from "@/server/auth/rbac";

export async function askHRAssistantAction(rawData: unknown): Promise<ActionResult<AIChatMessage>> {
  try {
    const authUser = await requireAuthUser("hr-payroll");
    const parsed = aiPromptSchema.safeParse(rawData);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0]?.message || "Invalid query prompt.";
      return { error: firstIssue };
    }

    const { prompt, employeeId } = parsed.data;
    const answer = await askHRAssistant(prompt, employeeId, authUser.companyId, {
      role: authUser.role,
      isAdmin: authUser.isAdmin,
      employeeId: authUser.employee?.id,
      fullName: authUser.employee?.fullName,
    });
    return { success: true, data: answer };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "HR Assistant failed to respond.";
    return { error: message };
  }
}
