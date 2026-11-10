"use client";

import { useEffect } from "react";

/**
 * Marks the document as hydrated so the dev-only recovery shim (see root
 * layout) can detect a returned-to page that never hydrated (Next.js dev
 * bfcache/disk-cache issue) and reload it automatically.
 */
export function HydrationMarker() {
  useEffect(() => {
    document.documentElement.dataset.hydrated = "true";
  }, []);

  return null;
}
