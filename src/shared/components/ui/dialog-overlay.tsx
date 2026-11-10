"use client";

import type { MouseEventHandler, ReactNode } from "react";
import { useDialog } from "@/shared/hooks/use-dialog";

/**
 * The full-screen layer of a modal dialog, mounted only while the dialog is open.
 * Provides the dialog semantics and keyboard behaviour (see useDialog); the caller supplies layout classes and content.
 */
export function DialogOverlay({ label, onClose, className, onClick, children }: { label: string; onClose: () => void; className?: string; onClick?: MouseEventHandler<HTMLDivElement>; children: ReactNode }) {
  const ref = useDialog<HTMLDivElement>(true, onClose);
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} className={className} onClick={onClick} style={{ outline: "none" }}>
      {children}
    </div>
  );
}
