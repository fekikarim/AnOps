"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { errorCopy, type ErrorLike } from "@/shared/lib/action-error-copy";

/**
 * Application notifications. One stack in the top-right corner (full width on phones). Each notice lasts four
 * seconds, pauses while hovered or focused, and can be dismissed. Errors use role="alert" so screen readers
 * announce them; other tones use role="status". Colours come from the theme tokens, so light and dark modes match.
 */
export type ToastTone = "success" | "error" | "warning" | "info";

type ToastItem = { id: number; tone: ToastTone; title: string; description?: string; leaving: boolean };

type ToastApi = {
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  warning: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
  /** Shows the friendly copy for a typed action error (see errorCopy). */
  fromError: (error: ErrorLike | undefined | null) => void;
  dismiss: (id: number) => void;
};

const DURATION_MS = 4000;
const MAX_VISIBLE = 4;
const EXIT_MS = 180;

const ToastContext = createContext<ToastApi | null>(null);

const TONE: Record<ToastTone, { icon: typeof CheckCircle2; iconClass: string; bar: string }> = {
  success: { icon: CheckCircle2, iconClass: "text-[var(--color-status-success)]", bar: "bg-[var(--color-status-success)]" },
  error: { icon: XCircle, iconClass: "text-[var(--color-status-error)]", bar: "bg-[var(--color-status-error)]" },
  warning: { icon: AlertTriangle, iconClass: "text-[var(--color-status-warning)]", bar: "bg-[var(--color-status-warning)]" },
  info: { icon: Info, iconClass: "text-[var(--color-text-primary)]", bar: "bg-[var(--color-action-primary)]" },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const remove = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const dismiss = useCallback(
    (id: number) => {
      setItems((current) => current.map((item) => (item.id === id ? { ...item, leaving: true } : item)));
      window.setTimeout(() => remove(id), EXIT_MS);
    },
    [remove]
  );

  const push = useCallback(
    (tone: ToastTone, title: string, description?: string) => {
      const id = nextId.current++;
      setItems((current) => [...current.slice(-(MAX_VISIBLE - 1)), { id, tone, title, description, leaving: false }]);
    },
    []
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (title, description) => push("success", title, description),
      error: (title, description) => push("error", title, description),
      warning: (title, description) => push("warning", title, description),
      info: (title, description) => push("info", title, description),
      fromError: (error) => {
        const copy = errorCopy(error);
        push("error", copy.title, copy.description);
      },
      dismiss,
    }),
    [push, dismiss]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 top-4 z-[200] flex flex-col items-stretch gap-3 sm:inset-x-auto sm:right-6 sm:top-6 sm:w-[380px]"
      >
        {items.map((item) => (
          <ToastCard key={item.id} item={item} onDismiss={() => dismiss(item.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const [paused, setPaused] = useState(false);
  const timer = useRef<number | null>(null);
  const remaining = useRef(DURATION_MS);
  const started = useRef(0);
  const config = TONE[item.tone];
  const Icon = config.icon;

  useEffect(() => {
    if (paused || item.leaving) {
      if (timer.current) window.clearTimeout(timer.current);
      if (paused) remaining.current -= Date.now() - started.current;
      return;
    }
    started.current = Date.now();
    timer.current = window.setTimeout(onDismiss, Math.max(0, remaining.current));
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [paused, item.leaving, onDismiss]);

  return (
    <div
      role={item.tone === "error" ? "alert" : "status"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={cn(
        "pointer-events-auto relative overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 pr-11 shadow-[0_12px_40px_-12px_rgba(17,31,29,0.35)]",
        // Enter and exit use CSS animations, so they do not depend on requestAnimationFrame (throttled in background tabs).
        item.leaving ? "anops-toast-out" : "anops-toast-in"
      )}
    >
      <div className="flex items-start gap-3">
        <Icon size={20} aria-hidden="true" className={cn("mt-0.5 shrink-0", config.iconClass)} />
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-semibold text-[var(--color-text-primary)]">{item.title}</p>
          {item.description && <p className="mt-0.5 break-words text-sm text-[var(--color-text-secondary)]">{item.description}</p>}
        </div>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text-primary)] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)]"
      >
        <X size={16} aria-hidden="true" />
      </button>
      <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[3px] bg-[var(--color-bg-subtle)]">
        <div
          className={cn("toast-progress h-full origin-left", config.bar)}
          style={{ animationDuration: `${DURATION_MS}ms`, animationPlayState: paused || item.leaving ? "paused" : "running" }}
        />
      </div>
    </div>
  );
}

/** Notifications for the calling component. Must be used inside a ToastProvider. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast must be used inside ToastProvider");
  return api;
}
