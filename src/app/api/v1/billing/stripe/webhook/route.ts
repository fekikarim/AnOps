import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { env } from "@/config/env";
import clientPromise from "@/server/db/client";
import { ensureIndexes } from "@/server/db/indexes";
import { getStripe, handleStripeEvent } from "@/server/platform/billing.service";

/**
 * Stripe webhook. The raw body is verified with STRIPE_WEBHOOK_SECRET before anything is read;
 * events are processed idempotently and subscriptions are re-fetched from Stripe (see billing.service.ts).
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = randomUUID();
  const stripe = getStripe();
  if (!stripe || !env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: { code: "NOT_CONFIGURED", message: "Stripe webhooks are not configured.", requestId } }, { status: 503 });
  }
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Missing signature.", requestId } }, { status: 400 });

  let event: Stripe.Event;
  try {
    const body = await request.text();
    event = stripe.webhooks.constructEvent(body, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Invalid signature.", requestId } }, { status: 400 });
  }

  try {
    const db = (await clientPromise).db();
    await ensureIndexes(db);
    const outcome = await handleStripeEvent(db, event, requestId);
    return NextResponse.json({ received: true, outcome });
  } catch (error) {
    console.error(`[billing] webhook ${event.type} failed: ${error instanceof Error ? error.name : "unknown"}`);
    // 500 makes Stripe retry later; the event id was released for reprocessing.
    return NextResponse.json({ error: { code: "INTERNAL", message: "Processing failed.", requestId } }, { status: 500 });
  }
}
