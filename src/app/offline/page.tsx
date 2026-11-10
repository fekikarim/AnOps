"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useOnlineStatus } from "@/shared/components/offline-indicator";

export default function OfflinePage() {
  const isOnline = useOnlineStatus();
  const [cachedUrls, setCachedUrls] = useState<string[]>([]);

  useEffect(() => {
    if (isOnline) {
      window.location.href = "/anops";
    }
  }, [isOnline]);

  useEffect(() => {
    if (typeof window !== "undefined" && "caches" in window) {
      caches.keys().then(async (keys) => {
        const cache = await caches.open(keys[0] || "anops-cache-v3");
        const requests = await cache.keys();
        const urls = requests
          .map((req) => new URL(req.url))
          .filter((u) => u.origin === window.location.origin)
          .map((u) => u.pathname)
          .filter(
            (p) =>
              !p.startsWith("/_next") &&
              !p.startsWith("/api") &&
              !p.startsWith("/brand-kit") &&
              p !== "/offline" &&
              p !== "/manifest.json" &&
              !p.includes(".")
          );
        setCachedUrls(Array.from(new Set(urls)));
      });
    }
  }, []);

  return (
    <main id="main" className="min-h-screen flex items-center justify-center px-4 bg-[var(--color-bg-canvas)] text-[var(--color-text-primary)]">
      <div className="w-full max-w-md text-center space-y-6">
        <div className="mx-auto w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center border border-amber-500/20">
          <svg
            className="w-8 h-8 text-amber-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 4.243a9 9 0 01-2.828-6.364m0 0a9 9 0 012.828-6.364M3 3l18 18"
            />
          </svg>
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">You are currently offline</h1>
          <p className="text-sm text-[var(--color-text-secondary)]">
            We couldn&apos;t load this new page because there is no internet connection. Previously visited pages are saved and can still be viewed.
          </p>
        </div>

        {cachedUrls.length > 0 && (
          <div className="text-left bg-[var(--color-bg-surface,#181a1b)] border border-[var(--color-border,#2a2e33)] rounded-lg p-4 space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
              Available Offline Pages
            </h2>
            <ul className="divide-y divide-[var(--color-border,#2a2e33)] text-sm">
              {cachedUrls.map((path) => (
                <li key={path} className="py-2 flex items-center justify-between">
                  <span className="font-mono text-xs text-[var(--color-text-primary)]">{path}</span>
                  <Link
                    href={path}
                    className="text-xs text-[var(--color-action-primary)] hover:underline font-medium"
                  >
                    Open &rarr;
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="w-full sm:w-auto h-11 px-5 rounded-[var(--radius-control)] bg-[var(--color-action-primary)] text-sm font-semibold text-[var(--color-action-on-primary)] hover:bg-[var(--color-action-hover)] transition-colors min-h-[44px]"
          >
            Retry Connection
          </button>
          <button
            type="button"
            onClick={() => window.history.back()}
            className="w-full sm:w-auto h-11 px-5 rounded-[var(--radius-control)] border border-[var(--color-border)] text-sm font-medium hover:bg-[var(--color-bg-surface)] transition-colors min-h-[44px]"
          >
            Go Back
          </button>
        </div>
      </div>
    </main>
  );
}
