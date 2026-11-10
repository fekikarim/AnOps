"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

type PortalProps = {
  children: React.ReactNode;
};

const noopSubscribe = () => () => {};

/** Renders into document.body in the browser only; the server and the first hydration pass render nothing. */
export function Portal({ children }: PortalProps) {
  const inBrowser = useSyncExternalStore(noopSubscribe, () => true, () => false);
  if (!inBrowser) return null;
  return createPortal(children, document.body);
}
