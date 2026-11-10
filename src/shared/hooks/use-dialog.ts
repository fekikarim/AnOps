"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Open dialogs, oldest first. Only the top one reacts to Escape and Tab, so nested dialogs close one at a time. */
const stack: symbol[] = [];

function visible(element: HTMLElement): boolean {
  return element.getClientRects().length > 0;
}

/**
 * Keyboard behaviour of a modal dialog, attached to its container (`ref`):
 * focus moves into the dialog when it opens (first field/control, or the container), Tab stays inside it,
 * Escape closes it (topmost dialog only), and focus returns to whatever opened it when it closes.
 * The container needs `role="dialog"`, `aria-modal="true"`, an accessible name and `tabIndex={-1}`.
 */
export function useDialog<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const node = ref.current;
    if (!node) return;
    const id = Symbol("dialog");
    stack.push(id);
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const items = () => [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);

    // Prefer the first form field; a bare close button is a poor starting point.
    const start = node.querySelector<HTMLElement>("[data-autofocus]") ?? items().find((el) => /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) ?? items()[0] ?? node;
    start.focus({ preventScroll: true });

    const onKey = (event: KeyboardEvent) => {
      if (stack[stack.length - 1] !== id) return;
      if (event.key === "Escape") {
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = items();
      if (focusable.length === 0) {
        event.preventDefault();
        node.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === node)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (!node.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      const index = stack.indexOf(id);
      if (index >= 0) stack.splice(index, 1);
      // Give the dialog's own unmount a tick, then put focus back where the person was.
      if (opener && document.contains(opener)) requestAnimationFrame(() => opener.focus({ preventScroll: true }));
    };
  }, [open]);

  return ref;
}
