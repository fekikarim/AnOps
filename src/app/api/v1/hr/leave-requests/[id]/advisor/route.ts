import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentAuthUser } from "@/server/auth/rbac";
import { gatedChat } from "@/server/ai/gate";
import { resolveWorkspace } from "@/server/tenancy/workspace";
import { isAppError } from "@/shared/lib/errors";
import { getLeaveRecommendation } from "@/server/services/hr-advisor.service";

const paramsSchema = z.object({ id: z.string().regex(/^[a-f\d]{24}$/i) });

type RouteContext = { params: Promise<{ id: string }> };

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

async function respond(context: RouteContext, refresh: boolean) {
  let user: Awaited<ReturnType<typeof getCurrentAuthUser>>;
  try {
    user = await getCurrentAuthUser("hr-payroll");
  } catch (error) {
    // The application is not in the plan, or this member's access excludes it.
    if (isAppError(error) && error.code === "FORBIDDEN") return errorResponse("FORBIDDEN", error.message, 403);
    throw error;
  }
  if (!user) return errorResponse("UNAUTHENTICATED", "Please log in to continue.", 401);
  if (!user.isAdmin) return errorResponse("FORBIDDEN", "Only HR administrators can view the Approval Advisor.", 403);

  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return errorResponse("NOT_FOUND", "Leave request not found.", 404);

  try {
    // The model runs only on "Refresh analysis", and only through the AI gate (switches, the admin's own HR grant, limits, budget).
    // If the gate refuses, the rules card is shown instead.
    const ws = refresh ? await resolveWorkspace().catch(() => null) : null;
    const chat = ws ? (options: Parameters<typeof gatedChat>[2]) => gatedChat(ws, { module: "hr", operation: "view", feature: "hr.advisor" }, options) : undefined;
    const outcome = await getLeaveRecommendation(
      params.data.id,
      {
        userId: user.userId,
        employeeId: user.employee?.id,
        companyId: user.companyId,
        role: user.role,
        actorName: user.employee?.fullName || user.email,
      },
      { refresh, chat }
    );
    if (outcome.status === "not_found") return errorResponse("NOT_FOUND", "Leave request not found.", 404);
    if (outcome.status !== "ok") return errorResponse("CONFLICT", "This request is no longer pending.", 409);
    return NextResponse.json({ data: outcome.card }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    console.error("[advisor route]", err instanceof Error ? err.name : "unknown");
    return errorResponse("INTERNAL", "The analysis is unavailable right now.", 500);
  }
}

/** The advisor card for a pending request: cached when its facts are unchanged. */
export function GET(_request: Request, context: RouteContext) {
  return respond(context, false);
}

/** Regenerates the analysis ("Refresh analysis"). */
export function POST(_request: Request, context: RouteContext) {
  return respond(context, true);
}
