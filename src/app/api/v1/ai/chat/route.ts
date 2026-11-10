import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { chatRequestSchema } from "@/features/ai/schemas/ai.schema";
import { runTurn, type TurnEvent } from "@/server/ai/orchestrator";
import { resolveWorkspace } from "@/server/tenancy/workspace";
import { AppError, isAppError } from "@/shared/lib/errors";
import { toFieldErrors } from "@/shared/lib/validation";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BODY_BYTES = 8 * 1024;

function failure(error: unknown, requestId: string) {
  if (isAppError(error)) {
    return NextResponse.json({ ok: false, error: { code: error.code, message: error.message, requestId, details: error.details } }, { status: error.status, headers: { "Cache-Control": "no-store" } });
  }
  console.error(`[ai] chat failed (request ${requestId}): ${error instanceof Error ? error.name : "unknown"}`);
  return NextResponse.json({ ok: false, error: { code: "INTERNAL", message: "Something went wrong. Please try again.", requestId } }, { status: 500, headers: { "Cache-Control": "no-store" } });
}

function sse(event: TurnEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * One chat turn as a server-sent event stream. Identity, company and permissions are resolved here
 * from the session; the body carries only the message text and an optional conversation id.
 */
export async function POST(request: Request) {
  const requestId = randomUUID();
  try {
    // A JSON content type cannot be sent by a cross-site form, and a foreign Origin is refused outright.
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      throw new AppError("VALIDATION_ERROR", "Unsupported request.");
    }
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).host !== request.headers.get("host")) {
      throw new AppError("FORBIDDEN", "Request origin not allowed.");
    }
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > MAX_BODY_BYTES) throw new AppError("VALIDATION_ERROR", "Message is too large.");
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) throw new AppError("VALIDATION_ERROR", "Message is too large.");

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new AppError("VALIDATION_ERROR", "Unsupported request.");
    }
    const parsed = chatRequestSchema.safeParse(json);
    if (!parsed.success) {
      throw new AppError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "The message is invalid.", toFieldErrors(parsed.error));
    }

    const ctx = await resolveWorkspace(requestId);
    const turn = runTurn(ctx, parsed.data, { signal: request.signal });
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await turn.next();
          if (next.done) {
            controller.close();
            return;
          }
          controller.enqueue(encoder.encode(sse(next.value)));
        } catch {
          controller.enqueue(encoder.encode(sse({ type: "error", code: "INTERNAL", message: "Something went wrong. Please try again." })));
          controller.close();
        }
      },
      async cancel() {
        await turn.return(undefined);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        "X-Request-Id": requestId,
      },
    });
  } catch (error) {
    return failure(error, requestId);
  }
}
