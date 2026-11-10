import { NextRequest, NextResponse } from "next/server";
import { assertWorkspaceAppAccess } from "@/server/platform/access";
import { resolveWorkspace } from "@/server/tenancy/workspace";
import { getChatMessages } from "@/server/services/community.service";
import { isAppError } from "@/shared/lib/errors";

export const dynamic = "force-dynamic";

/**
 * Messages of one conversation. The workspace (session, live account state, company, role) is resolved on the server;
 * the service shows the conversation only to a support agent or to the person who started it.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await resolveWorkspace();
    await assertWorkspaceAppAccess(ctx, "community");
    const { searchParams } = new URL(req.url);
    const conversationId = searchParams.get("conversationId");
    const after = searchParams.get("after") || undefined;

    if (!conversationId) {
      return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
    }
    if (after && Number.isNaN(new Date(after).getTime())) {
      return NextResponse.json({ error: "after must be a timestamp" }, { status: 400 });
    }

    const messages = await getChatMessages(ctx, conversationId, after);
    return NextResponse.json({ data: messages }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (isAppError(err)) return NextResponse.json({ error: err.message }, { status: err.status, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ error: "Failed to load messages" }, { status: 500 });
  }
}
