import "server-only";
import { randomUUID } from "crypto";
import type { z } from "zod";
import { resolveWorkspace, type WorkspaceContext } from "@/server/tenancy/workspace";
import { assertWorkspaceAppAccess } from "@/server/platform/access";
import type { ApplicationId } from "@/shared/domain/applications";
import { recordAudit } from "@/server/audit/audit.service";
import type { ExportFile } from "@/server/exports/reports";
import { AppError, isAppError } from "@/shared/lib/errors";

export const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Shared transport for the Excel export route handlers. Each route passes its own query schema and
 * its own report builder, so no request can choose a collection, field or query.
 *
 * Authentication and the tenant come from resolveWorkspace(), never from the URL or the request body.
 * Errors return a safe code and message only. Stack traces and driver details are logged by error name.
 */
export async function handleExport<Q>(
  request: Request,
  app: ApplicationId,
  report: string,
  schema: z.ZodType<Q>,
  build: (ctx: WorkspaceContext, query: Q, now: Date) => Promise<ExportFile>
): Promise<Response> {
  const requestId = randomUUID();
  try {
    const ctx = await resolveWorkspace(requestId);
    await assertWorkspaceAppAccess(ctx, app);
    const parsed = schema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) {
      throw new AppError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "The export filters are not valid.");
    }

    const file = await build(ctx, parsed.data, new Date());
    await recordAudit(ctx.db, {
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: "export.excel_generated",
      entityType: "export",
      entityId: report,
      requestId,
      metadata: { report, rowCount: file.rowCount },
    });

    return new Response(new Uint8Array(file.body), {
      status: 200,
      headers: {
        "Content-Type": XLSX_CONTENT_TYPE,
        "Content-Disposition": `attachment; filename="${file.fileName}"`,
        "Content-Length": String(file.body.length),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Export-Row-Count": String(file.rowCount),
      },
    });
  } catch (error) {
    return exportErrorResponse(error, report, requestId);
  }
}

function exportErrorResponse(error: unknown, report: string, requestId: string): Response {
  if (isAppError(error)) {
    return Response.json(
      { error: { code: error.code, message: error.message, requestId } },
      { status: error.status, headers: { "Cache-Control": "no-store" } }
    );
  }
  console.error(`[export:${report}] ${requestId} ${error instanceof Error ? error.name : "unknown"}`);
  return Response.json(
    { error: { code: "INTERNAL", message: "The export could not be generated. Try again.", requestId } },
    { status: 500, headers: { "Cache-Control": "no-store" } }
  );
}
