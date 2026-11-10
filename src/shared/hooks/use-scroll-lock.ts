"use client";

import { useEffect } from "react";

/**
 * Reliably locks page background scroll when a modal is open.
 *
 * In this application:
 * - Dashboard pages scroll inside `<main className="overflow-y-auto">`
 * - Non-dashboard pages scroll on `<html>` / `<body>`
 *
 * Setting `overflow: hidden` on `<main>`, `<body>`, and `<html>`:
 * - Completely prevents the page in the background from scrolling
 * - Leaves inner scrollable containers inside modals free to scroll smoothly
 * - Avoids `position: fixed` on body (which shifted layouts and broke vertical centering)
 * - Avoids global wheel/touchmove event cancellation (which blocked scrolling inside modals)
 */
export function useScrollLock(isLocked: boolean) {
  useEffect(() => {
    if (!isLocked) return;

    const html = document.documentElement;
    const body = document.body;
    const main = document.querySelector("main");

    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    const prevMainOverflow = main ? main.style.overflow : "";

    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    if (main) {
      main.style.overflow = "hidden";
    }

    return () => {
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
      if (main) {
        main.style.overflow = prevMainOverflow;
      }
    };
  }, [isLocked]);
}
