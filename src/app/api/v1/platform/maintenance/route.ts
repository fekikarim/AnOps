import { randomUUID, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { env } from "@/config/env";
import clientPromise from "@/server/db/client";
import { ensureIndexes } from "@/server/db/indexes";
import { runLifecycleMaintenance } from "@/server/platform/cleanup.service";

/**
 * Organization lifecycle maintenance: removes organizations not activated within 12 hours and marks
 * ended trials. An external scheduler calls it every few minutes with
 * `Authorization: Bearer <PLATFORM_CRON_SECRET>` (see scripts/platform-maintenance.mjs). Disabled without the secret.
 * Access to expired organizations is already refused at request time; this job performs the deletion.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorized(header: string | null, secret: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice("Bearer ".length));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function POST(request: Request) {
  const requestId = randomUUID();
  // Short secrets are treated as missing: the endpoint deletes data and must not be guessable.
  const secret = env.PLATFORM_CRON_SECRET && env.PLATFORM_CRON_SECRET.length >= 32 ? env.PLATFORM_CRON_SECRET : undefined;
  if (!secret) return NextResponse.json({ error: { code: "NOT_CONFIGURED", message: "Platform maintenance is not configured.", requestId } }, { status: 503 });
  if (!authorized(request.headers.get("authorization"), secret)) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Not authorized.", requestId } }, { status: 401 });
  try {
    const db = (await clientPromise).db();
    await ensureIndexes(db);
    const report = await runLifecycleMaintenance(db);
    return NextResponse.json({ data: report, meta: { requestId } });
  } catch {
    console.error("[platform] maintenance run failed");
    return NextResponse.json({ error: { code: "INTERNAL", message: "The maintenance run failed.", requestId } }, { status: 500 });
  }
}
