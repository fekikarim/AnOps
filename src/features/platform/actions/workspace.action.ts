"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { resolveOrgAccess } from "@/server/platform/access";
import { resendActivation } from "@/server/platform/activation.service";
import { chooseFreeFallback } from "@/server/platform/subscription.service";
import { toActionError } from "@/server/actions/run-action";
import { AppError, type ActionResult } from "@/shared/lib/errors";

export async function resendActivationAction(): Promise<ActionResult<{ email: string; delivered: boolean }>> {
  const requestId = randomUUID();
  try {
    const access = await resolveOrgAccess(requestId);
    const result = await resendActivation(access.ctx.db, { userId: access.ctx.userId, companyId: access.ctx.companyId, requestId });
    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, error: toActionError(error, requestId, "platform.resendActivation") };
  }
}

/** One-time permanent OneOps choice after a trial or a lapsed subscription. Owner only. */
export async function chooseFreeFallbackAction(appId: string): Promise<ActionResult<true>> {
  const requestId = randomUUID();
  try {
    const access = await resolveOrgAccess(requestId);
    if (access.companyRole !== "owner") throw new AppError("FORBIDDEN", "Only the organization owner can change the plan.");
    await chooseFreeFallback(access.ctx.db, { companyId: access.ctx.companyId, actorUserId: access.ctx.userId, appId, requestId });
    revalidatePath("/anops");
    return { ok: true, data: true };
  } catch (error) {
    return { ok: false, error: toActionError(error, requestId, "platform.chooseFreeFallback") };
  }
}
