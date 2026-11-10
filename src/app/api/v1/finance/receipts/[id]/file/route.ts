import { NextResponse } from "next/server";
import { getFinanceService } from "@/server/services/finance.service";
import { isAppError } from "@/shared/lib/errors";

/**
 * GET /api/v1/finance/receipts/:id/file: the stored receipt image or PDF, for the signed-in company only.
 * Another company's id answers 404, exactly like a missing one.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const service = await getFinanceService();
    const file = await service.getReceiptFile(id);
    if (!file) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Receipt not found." } }, { status: 404 });
    const ascii = file.document.originalName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
    return new NextResponse(new Uint8Array(file.bytes), {
      headers: {
        "Content-Type": file.document.mimeType,
        "Content-Length": String(file.bytes.length),
        "Content-Disposition": `inline; filename="${ascii}"`,
        // The type was decided from the file's own bytes; never let the browser guess another one.
        "X-Content-Type-Options": "nosniff",
        // Chrome refuses to render a PDF inside a sandboxed document, so only images get the sandbox.
        "Content-Security-Policy": `default-src 'none'; img-src 'self'; style-src 'unsafe-inline'${file.document.mimeType === "application/pdf" ? "" : "; sandbox"}`,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    if (isAppError(error) && (error.code === "UNAUTHENTICATED" || error.code === "FORBIDDEN")) {
      return NextResponse.json({ error: { code: error.code, message: "Not allowed." } }, { status: error.code === "UNAUTHENTICATED" ? 401 : 403 });
    }
    return NextResponse.json({ error: { code: "INTERNAL", message: "Could not load the receipt." } }, { status: 500 });
  }
}
