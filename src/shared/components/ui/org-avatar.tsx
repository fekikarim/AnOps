"use client";

import { useState } from "react";
import { cn } from "@/shared/lib/utils";

export function orgInitials(name: string): string {
  return (
    name
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "O"
  );
}

/**
 * The organization's identity tile: its logo when one is set, otherwise its initials. If the logo cannot be loaded
 * (offline, removed), the initials are shown instead of a broken image. `className` sets size, radius and the fallback colours.
 */
export function OrgAvatar({ name, logoUrl, className }: { name: string; logoUrl?: string | null; className?: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showLogo = Boolean(logoUrl) && failedUrl !== logoUrl;
  return (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center overflow-hidden", className, showLogo && "bg-white")}>
      {showLogo ? (
        // eslint-disable-next-line @next/next/no-img-element -- private, versioned URL served by our own route
        <img src={logoUrl ?? undefined} alt="" onError={() => setFailedUrl(logoUrl ?? null)} className="h-full w-full object-contain" />
      ) : (
        <span aria-hidden="true">{orgInitials(name)}</span>
      )}
    </span>
  );
}
