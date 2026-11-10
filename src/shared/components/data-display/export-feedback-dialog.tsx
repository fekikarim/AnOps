"use client";

import { useEffect, useRef } from "react";
import { RotateCw, X } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";

export type ExportFeedback =
  | { kind: "success"; title: string; description: string }
  | { kind: "error"; title: string; description: string };

const ASSETS = {
  success: "/gif/wired-lineal-37-check-hover-pinch.gif",
  error: "/gif/wired-lineal-2592-fail-hover-pinch.gif",
} as const;

/**
 * Modal outcome of an Excel export. Built on the native <dialog> element, so focus is trapped, Escape closes it,
 * and focus returns to the trigger. The animation sits on a tinted tile because the GIFs use dark outlines
 * that would disappear on the dark theme surface.
 */
export function ExportFeedbackDialog({
  feedback,
  onClose,
  onRetry,
}: {
  feedback: ExportFeedback | null;
  onClose: () => void;
  onRetry?: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (feedback && !dialog.open) dialog.showModal();
    if (!feedback && dialog.open) dialog.close();
  }, [feedback]);

  const isError = feedback?.kind === "error";

  return (
    <dialog
      ref={ref}
      aria-labelledby="export-feedback-title"
      aria-describedby="export-feedback-description"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-0 text-[var(--color-text-primary)] shadow-[0_24px_60px_-20px_rgba(17,31,29,0.5)] backdrop:bg-[rgba(17,31,29,0.55)]"
    >
      {feedback && (
        <div className="relative flex flex-col items-center px-6 pb-6 pt-8 text-center">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-3 top-3 flex size-9 items-center justify-center rounded-full text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text-primary)] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)]"
          >
            <X aria-hidden className="size-4" />
          </button>
          <div
            className={cn(
              "flex size-36 items-center justify-center rounded-full",
              isError ? "bg-[var(--color-status-error-bg)]" : "bg-[var(--color-status-success-bg)]"
            )}
          >
            {/* Plain img keeps the GIF animating at its native proportions (256 px source shown at 128 px). */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={ASSETS[feedback.kind]} alt="" width={112} height={112} className="size-28 select-none" draggable={false} />
          </div>
          <h2 id="export-feedback-title" className="mt-5 text-xl font-semibold tracking-tight">{feedback.title}</h2>
          <p id="export-feedback-description" className="mt-2 text-sm text-[var(--color-text-secondary)]">{feedback.description}</p>
          <div className="mt-6 flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-center">
            {isError && onRetry && (
              <Button variant="primary" onClick={onRetry} className="sm:min-w-32">
                <RotateCw aria-hidden className="size-4" />
                Try again
              </Button>
            )}
            <Button variant={isError ? "secondary" : "primary"} onClick={onClose} autoFocus={!isError} className="sm:min-w-32">
              {isError ? "Close" : "Done"}
            </Button>
          </div>
        </div>
      )}
    </dialog>
  );
}
