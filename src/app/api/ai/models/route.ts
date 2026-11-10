import { NextResponse } from "next/server";
import { assertAiReady, resolveAiAccess } from "@/server/ai/access/access.service";
import { fetchAllProviderModels } from "@/server/ai/fetch-models";
import { resolveWorkspace } from "@/server/tenancy/workspace";
import { isAppError } from "@/shared/lib/errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/ai/models
 *
 * Lists the models the configured providers offer, for people who may use AI. It makes outbound calls with the server's own
 * provider key, so it follows the same rules as every other AI path: a signed-in member of an active company, with the platform
 * and company switches on and an AI grant of their own. Anyone else gets the reason, and no provider call is made.
 */
export async function GET() {
  try {
    const ctx = await resolveWorkspace();
    assertAiReady(await resolveAiAccess(ctx));
    const providers = await fetchAllProviderModels();
    return NextResponse.json({ providers }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (isAppError(err)) return NextResponse.json({ error: err.message }, { status: err.status, headers: { "Cache-Control": "no-store" } });
    console.error("[GET /api/ai/models]", err instanceof Error ? err.name : "unknown");
    return NextResponse.json({ error: "Failed to fetch models" }, { status: 500 });
  }
}
