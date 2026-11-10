import { NextResponse } from "next/server";
import { getAiHealth, toTenantHealth } from "@/server/ai/health";
import { assertAiEntitled } from "@/server/platform/access";
import { PERMISSIONS, assertPermission } from "@/server/security/permissions";
import { resolveWorkspace } from "@/server/tenancy/workspace";
import { isAppError } from "@/shared/lib/errors";

export const dynamic = "force-dynamic";

/**
 * Whether the AI Command Center can run, for owners and administrators of organizations whose plan includes AI.
 * Two facts only (available, paused); platform diagnostics are never exposed to tenants.
 */
export async function GET() {
  try {
    const ctx = await resolveWorkspace();
    assertPermission(ctx.permissions, PERMISSIONS.AI_ACCESS_MANAGE);
    await assertAiEntitled(ctx.db, ctx.companyId);
    return NextResponse.json({ data: toTenantHealth(await getAiHealth(ctx.db)) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (isAppError(err)) return NextResponse.json({ error: err.message }, { status: err.status, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ error: "Health check failed" }, { status: 500 });
  }
}
