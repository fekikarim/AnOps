"use client";

import { useState } from "react";
import { cn } from "@/shared/lib/utils";

type PreviewWidth = "desktop" | "mobile";

/**
 * Renders an HTML email inside a sandboxed iframe. Scripts are disabled and the document is produced
 * from escaped text, so the preview cannot execute anything from the template body.
 *
 * The frame height follows the viewport and the width toggle simulates a phone (390 px) so the layout
 * can be checked without sending a test message.
 */
export function EmailPreview({
  html,
  title,
  className = "",
}: {
  html: string;
  title: string;
  className?: string;
}) {
  const [width, setWidth] = useState<PreviewWidth>("desktop");
  const mobile = width === "mobile";

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-[var(--color-text-secondary)]">Width</span>
        <div role="group" aria-label="Preview width" className="inline-flex rounded-[var(--radius-pill)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-0.5">
          <button
            type="button"
            aria-pressed={!mobile}
            onClick={() => setWidth("desktop")}
            className={cn(
              "min-h-[44px] rounded-[var(--radius-pill)] px-3 text-xs font-medium transition-colors sm:min-h-[32px]",
              !mobile
                ? "bg-[var(--color-action-primary)] text-[var(--color-action-on-primary)]"
                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            )}
          >
            Desktop
          </button>
          <button
            type="button"
            aria-pressed={mobile}
            onClick={() => setWidth("mobile")}
            className={cn(
              "min-h-[44px] rounded-[var(--radius-pill)] px-3 text-xs font-medium transition-colors sm:min-h-[32px]",
              mobile
                ? "bg-[var(--color-action-primary)] text-[var(--color-action-on-primary)]"
                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            )}
          >
            Mobile
          </button>
        </div>
      </div>
      <div className="overflow-hidden rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)]">
        <div
          className={cn(
            "mx-auto transition-[width] duration-300 ease-out",
            mobile ? "w-[390px] max-w-full" : "w-full"
          )}
        >
          <iframe
            title={title}
            srcDoc={html}
            sandbox=""
            className="block h-[clamp(360px,62vh,680px)] w-full bg-white"
          />
        </div>
      </div>
    </div>
  );
}
