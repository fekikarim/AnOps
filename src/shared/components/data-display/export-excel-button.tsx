"use client";

import { useRef, useState } from "react";
import { Download, LoaderCircle } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { errorMessageFrom, fileNameFromDisposition, saveBlob } from "@/shared/lib/download";
import { ExportFeedbackDialog, type ExportFeedback } from "@/shared/components/data-display/export-feedback-dialog";

/**
 * Downloads a server-generated Excel workbook for the current filters. The button is disabled while
 * the request is in flight, and a ref blocks a second click that lands before React re-renders.
 * The success dialog appears only after the whole file has been received and handed to the browser's download;
 * the browser does not report whether the user keeps it, so the wording says "downloaded", not "saved to disk".
 */
export function ExportExcelButton({ href, label = "Export Excel", ariaLabel }: { href: string; label?: string; ariaLabel?: string }) {
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<ExportFeedback | null>(null);
  const inFlight = useRef(false);

  async function download() {
    if (inFlight.current) return;
    inFlight.current = true;
    setFeedback(null);
    setLoading(true);
    try {
      const response = await fetch(href, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) {
        setFeedback({ kind: "error", title: "Export failed", description: await errorMessageFrom(response) });
        return;
      }
      const blob = await response.blob();
      const fileName = fileNameFromDisposition(response.headers.get("Content-Disposition")) ?? "export.xlsx";
      const rows = Number(response.headers.get("X-Export-Row-Count") ?? "0");
      saveBlob(blob, fileName);
      setFeedback({
        kind: "success",
        title: "Export completed successfully",
        description:
          rows === 0
            ? `${fileName} was downloaded. It contains no records because nothing matches the current filters.`
            : `${fileName} with ${rows.toLocaleString("en-US")} rows was generated and sent to your browser's downloads.`,
      });
    } catch {
      setFeedback({ kind: "error", title: "Export failed", description: "The export could not be generated. Check your connection and try again." });
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }

  return (
    <>
      <Button type="button" onClick={download} disabled={loading} aria-busy={loading} aria-label={ariaLabel} className="w-full sm:w-auto">
        {loading ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <Download aria-hidden className="size-4" />}
        {loading ? "Preparing Excel…" : label}
      </Button>
      <ExportFeedbackDialog feedback={feedback} onClose={() => setFeedback(null)} onRetry={download} />
    </>
  );
}
