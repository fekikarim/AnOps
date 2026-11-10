"use client";

import { createContext, useContext } from "react";

const AiFeaturesContext = createContext(true);

/**
 * Whether the active organization's plan includes AI features (MaxOps, Custom + AI add-on, or a trial).
 * Used only to hide AI controls; the server refuses every AI call independently (resolveAiAccess → plan_excluded).
 */
export function AiFeaturesProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  return <AiFeaturesContext.Provider value={enabled}>{children}</AiFeaturesContext.Provider>;
}

export function useAiFeatures() {
  return useContext(AiFeaturesContext);
}
