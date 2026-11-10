import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { auth } from "@/server/auth";
import clientPromise from "@/server/db/client";
import { ensureIndexes } from "@/server/db/indexes";
import { getAppUrl } from "@/config/env";
import { completeSocialConnection } from "@/server/marketing/social/accounts.service";
import { isAppError } from "@/shared/lib/errors";

/**
 * OAuth callback. The session must belong to the user who started the flow; the state is single-use and
 * expires after ten minutes. Redirects carry only a result code, never provider data or error details.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SOCIAL_PAGE = "/marketing/social";

function back(params: Record<string, string>): NextResponse {
  const url = new URL(SOCIAL_PAGE, getAppUrl());
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId || !ObjectId.isValid(userId)) {
    const login = new URL("/login", getAppUrl());
    login.searchParams.set("callbackUrl", SOCIAL_PAGE);
    return NextResponse.redirect(login);
  }

  const params = new URL(request.url).searchParams;
  if (params.has("error")) return back({ error: "DENIED" });

  const state = params.get("state") ?? "";
  const code = params.get("code") ?? "";
  if (state.length < 20 || state.length > 200 || code.length < 1 || code.length > 2000) {
    return back({ error: "INVALID_CALLBACK" });
  }

  try {
    const db = (await clientPromise).db();
    await ensureIndexes(db);
    const result = await completeSocialConnection(db, {
      state,
      code,
      userId: new ObjectId(userId),
      requestId: crypto.randomUUID(),
    });
    return back({ connected: String(result.connectedPages) });
  } catch (error) {
    if (isAppError(error)) return back({ error: error.code });
    console.error("[marketing] social callback failed");
    return back({ error: "INTERNAL" });
  }
}
