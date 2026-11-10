"use client";

import { useSyncExternalStore } from "react";

function subscribe(listener: () => void) {
  const timer = setInterval(listener, 1000);
  return () => clearInterval(timer);
}

/** The current time, ticking every second in the browser; null on the server and during hydration. */
export function useNow(): Date | null {
  const seconds = useSyncExternalStore(subscribe, () => Math.floor(Date.now() / 1000), () => null);
  return seconds === null ? null : new Date(seconds * 1000);
}
