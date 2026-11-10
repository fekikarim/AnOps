import { randomUUID, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import clientPromise from "@/server/db/client";
import { ensureIndexes } from "@/server/db/indexes";
import { getWorkerSecret } from "@/server/marketing/config";
import { runDueJobs } from "@/server/marketing/dispatch";

/**
 * Background worker entry point. An external scheduler (cron, a platform scheduler) calls this endpoint
 * every minute with `Authorization: Bearer <MARKETING_WORKER_SECRET>`. Each call runs a bounded number of jobs.
 * Without the secret configured the endpoint is disabled.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_JOBS_PER_RUN = 5;

function authorized(header: string | null, secret: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice("Bearer ".length));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function POST(request: Request) {
  const requestId = randomUUID();
  const secret = getWorkerSecret();
  if (!secret) {
    return NextResponse.json({ error: { code: "NOT_CONFIGURED", message: "The marketing worker is not configured.", requestId } }, { status: 503 });
  }
  if (!authorized(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Not authorized.", requestId } }, { status: 401 });
  }
  try {
    const db = (await clientPromise).db();
    await ensureIndexes(db);
    const summary = await runDueJobs(db, { workerId: `worker-${requestId}`, limit: MAX_JOBS_PER_RUN });
    return NextResponse.json({ data: summary, meta: { requestId } });
  } catch {
    console.error("[marketing] worker run failed");
    return NextResponse.json({ error: { code: "INTERNAL", message: "The worker run failed.", requestId } }, { status: 500 });
  }
}
