import { Readable } from "stream";
import { NextResponse } from "next/server";
import { resolveOrganizationById } from "@/server/platform/access";
import { openOrganizationLogo } from "@/server/platform/organization-logo.service";
import { isAppError } from "@/shared/lib/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The organization's logo. Only members of that organization can read it (the id in the URL is never trusted: membership is
 * verified), and a non-member gets the same 404 as a missing logo. The URL carries a version (?v=fileId), so browsers may
 * cache it privately for a long time and a new logo is picked up immediately.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  try {
    const access = await resolveOrganizationById(orgId);
    const file = await openOrganizationLogo(access.ctx.db, access.ctx.companyId);
    if (!file) return NextResponse.json({ error: { code: "NOT_FOUND", message: "No logo." } }, { status: 404 });
    return new NextResponse(Readable.toWeb(file.stream as Readable) as ReadableStream, {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Length": String(file.size),
        "Cache-Control": "private, max-age=31536000, immutable",
        ETag: `"${file.sha256}"`,
        // A raster image only; never let a browser treat it as anything else or run it as a document.
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    if (isAppError(error) && (error.code === "UNAUTHENTICATED" || error.code === "NOT_FOUND")) {
      return NextResponse.json({ error: { code: error.code, message: "Not found." } }, { status: error.code === "UNAUTHENTICATED" ? 401 : 404, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ error: { code: "INTERNAL", message: "Could not load the logo." } }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
