"use client";

import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { Portal } from "@/shared/components/ui/portal";
import { cn } from "@/shared/lib/utils";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Contextual drawer for inline creation. A bottom sheet on phones, a right-hand panel from `sm` up.
 * Keeps the page behind it mounted, so the form the user came from keeps every value they typed.
 * Escape and the backdrop close it; focus is trapped inside and restored to the opener on close.
 */
export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  // The panel is rendered by a portal one tick after `open`, so focus is moved when it actually exists.
  const [panelMounted, setPanelMounted] = useState(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open || !panelMounted) return;
    const opener = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const panel = panelRef.current;
    const focusables = () => Array.from(panel?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    // Focus the first form field rather than the close button so typing can start immediately.
    const firstField = panel?.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea");
    (firstField ?? focusables()[0] ?? panel)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      opener?.focus?.();
    };
  }, [open, panelMounted]);

  if (!open) return null;

  return (
    <Portal>
      <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-stretch sm:justify-end">
        <div aria-hidden onClick={onClose} className="absolute inset-0 bg-black/45 backdrop-blur-[1px]" />
        <div
          ref={(node) => {
            panelRef.current = node;
            setPanelMounted(node !== null);
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className={cn(
            "relative flex max-h-[92dvh] w-full flex-col overflow-hidden border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] shadow-2xl outline-none",
            "rounded-t-[var(--radius-card)] sm:max-h-none sm:max-w-md sm:rounded-none sm:rounded-l-[var(--radius-card)]",
            "animate-in fade-in slide-in-from-bottom-4 duration-200 sm:slide-in-from-right-4 sm:slide-in-from-bottom-0 motion-reduce:animate-none"
          )}
        >
          <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border-subtle)] px-4 py-4 sm:px-6">
            <div className="min-w-0">
              <h2 id={titleId} className="text-base font-semibold text-[var(--color-text-primary)]">{title}</h2>
              {description && <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">{description}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-2 flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text-primary)] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)]"
            >
              <X aria-hidden className="size-5" />
            </button>
          </div>
          <div className="overflow-y-auto overscroll-contain px-4 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-6">{children}</div>
        </div>
      </div>
    </Portal>
  );
}
