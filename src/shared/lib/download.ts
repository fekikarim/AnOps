/**
 * Browser-side helpers for file exports. Export controls call the route, wait for the whole file,
 * and only then save it. Callers show success only after saveFileFromResponse has run.
 */

export const EXPORT_BASE_PATH = "/api/v1/exports";

/** Builds an export URL from the same filters the screen shows. Empty and undefined values are left out. */
export function exportUrl(report: string, params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const query = search.toString();
  return `${EXPORT_BASE_PATH}/${report}${query ? `?${query}` : ""}`;
}

/** Reads the filename from Content-Disposition. Returns null when the header is missing or unusual. */
export function fileNameFromDisposition(header: string | null): string | null {
  const match = header?.match(/filename="([^"\\/]+)"/);
  return match ? match[1] : null;
}

/** Turns an error response into a short, user-facing sentence. Never shows server internals. */
export async function errorMessageFrom(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: unknown } };
    if (typeof body.error?.message === "string") return body.error.message;
  } catch {
    // Non-JSON error bodies fall through to the generic message below.
  }
  if (response.status === 401) return "Your session has ended. Sign in again to export.";
  return "The export could not be generated. Try again.";
}

/** Saves a blob through a temporary object URL. The URL is released after the click starts the download. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
