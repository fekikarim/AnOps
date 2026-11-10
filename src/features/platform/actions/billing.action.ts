"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { toActionError } from "@/server/actions/run-action";
import { resolveOrganizationById } from "@/server/platform/access";
import { createCheckoutSession, createPortalSession, setCancelAtPeriodEnd, type CheckoutInput } from "@/server/platform/billing.service";
import { chooseFreeFallback } from "@/server/platform/subscription.service";
import { consumeSharedRateLimit } from "@/server/security/shared-rate-limit";
import { AppError, type ActionResult } from "@/shared/lib/errors";

async function run<T>(orgId: string, name: string, op: (access: Awaited<ReturnType<typeof resolveOrganizationById>>) => Promise<T>): Promise<ActionResult<T>> {
  const requestId = randomUUID();
  try {
    const access = await resolveOrganizationById(orgId, requestId);
    await consumeSharedRateLimit(access.ctx.db, `user:${access.ctx.userId.toHexString()}:${name}`, 10, 60_000);
    const data = await op(access);
    revalidatePath(`/organization/${orgId}`, "layout");
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: toActionError(error, requestId, name) };
  }
}

export const startCheckoutAction = async (orgId: string, input: CheckoutInput) => run(orgId, "billing.checkout", (a) => createCheckoutSession(a, input));
export const openBillingPortalAction = async (orgId: string) => run(orgId, "billing.portal", (a) => createPortalSession(a));
export const setCancelAtPeriodEndAction = async (orgId: string, cancel: boolean) => run(orgId, "billing.cancel", (a) => setCancelAtPeriodEnd(a, cancel));
export const chooseOneOpsAction = async (orgId: string, appId: string) =>
  run(orgId, "billing.oneops", async (a) => {
    if (a.companyRole !== "owner") throw new AppError("FORBIDDEN", "Only the organization owner can change the plan.");
    await chooseFreeFallback(a.ctx.db, { companyId: a.ctx.companyId, actorUserId: a.ctx.userId, appId, requestId: a.ctx.requestId });
  });
