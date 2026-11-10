"use client";

import { noticeAction } from "@/shared/components/ui/confirm-dialog";
import { useEffect, useState, useSyncExternalStore } from "react";
import { WifiOff, Wifi, RefreshCw } from "lucide-react";

function subscribeOnline(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function getOnlineSnapshot() {
  return typeof navigator !== "undefined" ? navigator.onLine : true;
}

function getServerSnapshot() {
  return true;
}

export function useOnlineStatus() {
  return useSyncExternalStore(subscribeOnline, getOnlineSnapshot, getServerSnapshot);
}

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();
  // idle → offline → restored (shown for 4 s) → idle. The phase follows the connection during render; only the timer is an effect.
  const [phase, setPhase] = useState<"idle" | "offline" | "restored">("idle");
  if (!isOnline && phase !== "offline") setPhase("offline");
  else if (isOnline && phase === "offline") setPhase("restored");
  const showRestored = phase === "restored";

  useEffect(() => {
    if (phase !== "restored") return;
    const timer = setTimeout(() => setPhase("idle"), 4000);
    return () => clearTimeout(timer);
  }, [phase]);

  if (isOnline && !showRestored) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`fixed top-0 inset-x-0 z-[99999] w-full px-4 py-2.5 shadow-md flex items-center justify-between transition-all duration-300 pointer-events-auto ${
        !isOnline
          ? "bg-[#b45309] text-white font-medium text-sm border-b border-amber-700"
          : "bg-[#059669] text-white font-medium text-sm border-b border-emerald-700"
      }`}
    >
      <div className="max-w-7xl mx-auto w-full flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {!isOnline ? (
            <WifiOff className="w-4 h-4 shrink-0 animate-pulse text-amber-200" />
          ) : (
            <Wifi className="w-4 h-4 shrink-0 text-emerald-200" />
          )}
          <span className="text-xs sm:text-sm tracking-wide">
            {!isOnline ? (
              <>
                <strong className="font-semibold uppercase tracking-wider text-[11px] bg-amber-950/60 text-amber-100 px-2 py-0.5 rounded mr-2">
                  OFFLINE
                </strong>
                You are currently offline. Pages are serving from local cache and changes will be queued.
              </>
            ) : (
              <>
                <strong className="font-semibold uppercase tracking-wider text-[11px] bg-emerald-950/60 text-emerald-100 px-2 py-0.5 rounded mr-2">
                  ONLINE
                </strong>
                Connection restored. Syncing data...
              </>
            )}
          </span>
        </div>

        {!isOnline && (
          <button
            type="button"
            onClick={async () => {
              try {
                const res = await fetch("/manifest.json", { cache: "no-store" });
                if (res.ok) {
                  window.location.reload();
                } else {
                  void noticeAction({ title: "Still offline", message: "Please check your connection and try again.", tone: "warning", okLabel: "Close" });
                }
              } catch {
                void noticeAction({ title: "Still offline", message: "Please check your connection and try again.", tone: "warning", okLabel: "Close" });
              }
            }}
            className="flex items-center gap-1.5 text-xs bg-amber-900/80 hover:bg-amber-950 text-white font-semibold px-3 py-1 rounded transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Retry Connection</span>
          </button>
        )}
      </div>
    </div>
  );
}
