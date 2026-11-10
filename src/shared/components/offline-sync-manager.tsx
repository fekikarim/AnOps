"use client";

import { useEffect, useState } from "react";
import {
  getPendingMutations,
  removeOfflineMutation,
  OfflineMutation,
} from "@/shared/lib/offline-store";
import { createProductAction, updateProductAction } from "@/features/inventory/actions/inventory.action";

type ActionDispatcher = (payload: unknown) => Promise<{ ok: boolean; error?: unknown }>;

/** Queued payloads were validated when they were queued; the server validates them again when they run. */
const MUTATION_HANDLERS: Record<string, ActionDispatcher> = {
  "inventory.product.create": async (payload) => createProductAction(payload as Parameters<typeof createProductAction>[0]),
  "inventory.product.update": async (payload) => {
    const { id, data } = payload as { id: string; data: Parameters<typeof updateProductAction>[1] };
    return updateProductAction(id, data);
  },
};

export function registerOfflineMutationHandler(type: string, handler: ActionDispatcher) {
  MUTATION_HANDLERS[type] = handler;
}

export function OfflineSyncManager() {
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState<string | null>(null);

  const processQueue = async () => {
    if (!navigator.onLine || syncing) return;
    const queue = await getPendingMutations();
    if (queue.length === 0) return;

    setSyncing(true);
    let successCount = 0;

    for (const item of queue) {
      const handler = MUTATION_HANDLERS[item.type];
      if (handler) {
        try {
          const res = await handler(item.payload);
          if (res && res.ok) {
            await removeOfflineMutation(item.id);
            successCount++;
          }
        } catch (err) {
          console.error(`[OfflineSync] Failed to sync ${item.type}:`, err);
        }
      }
    }

    setSyncing(false);
    setPendingCount((await getPendingMutations()).length);
    if (successCount > 0) {
      setLastSyncResult(`Synced ${successCount} offline change(s) successfully!`);
      setTimeout(() => setLastSyncResult(null), 4000);
    }
  };

  useEffect(() => {
    let active = true;
    const refreshCount = () => {
      getPendingMutations()
        .then((pending) => {
          if (active) setPendingCount(pending.length);
        })
        .catch(() => {});
    };
    refreshCount();
    const handleUpdate = () => refreshCount();
    const handleOnline = () => {
      refreshCount();
      processQueue();
    };

    window.addEventListener("anops:offline-mutations-updated", handleUpdate);
    window.addEventListener("online", handleOnline);

    return () => {
      active = false;
      window.removeEventListener("anops:offline-mutations-updated", handleUpdate);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  if (pendingCount === 0 && !lastSyncResult) return null;

  return (
    <div className="fixed bottom-16 right-4 z-50 flex items-center gap-3 px-4 py-2 rounded-lg border border-[var(--color-border,#2a2e33)] bg-[var(--color-bg-surface,#1f2225)] shadow-xl text-xs">
      {syncing ? (
        <span className="flex items-center gap-2 text-sky-400">
          <span className="animate-spin inline-block w-3 h-3 border-2 border-sky-400 border-t-transparent rounded-full" />
          Syncing {pendingCount} offline change(s)...
        </span>
      ) : lastSyncResult ? (
        <span className="text-emerald-400 font-medium">{lastSyncResult}</span>
      ) : (
        <div className="flex items-center gap-2 text-amber-300">
          <span className="w-2 h-2 rounded-full bg-amber-400" />
          <span>{pendingCount} offline action(s) queued</span>
          {typeof navigator !== "undefined" && navigator.onLine && (
            <button
              onClick={processQueue}
              className="ml-2 px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/30"
            >
              Sync Now
            </button>
          )}
        </div>
      )}
    </div>
  );
}
