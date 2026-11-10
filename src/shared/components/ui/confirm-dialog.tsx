"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, HelpCircle, Info, Trash2 } from "lucide-react";
import { DialogOverlay } from "@/shared/components/ui/dialog-overlay";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";

/**
 * Branded replacement for window.confirm / window.alert / window.prompt.
 * Call `confirmAction()` / `promptAction()` / `noticeAction()` from any handler (they return promises);
 * a single <ConfirmHost /> mounted in the root layout renders the dialog.
 */
export type ConfirmTone = "danger" | "warning" | "default";

type Request = {
  title: string;
  message?: string;
  tone: ConfirmTone;
  confirmLabel: string;
  cancelLabel: string | null;
  input?: { label: string; defaultValue?: string; placeholder?: string };
  resolve: (value: { ok: boolean; text: string }) => void;
};

type Options = {
  title: string;
  message?: string;
  tone?: ConfirmTone;
  confirmLabel?: string;
  cancelLabel?: string;
};

let listener: ((request: Request) => void) | null = null;

function open(request: Omit<Request, "resolve">): Promise<{ ok: boolean; text: string }> {
  return new Promise((resolve) => {
    if (!listener) return resolve({ ok: false, text: "" });
    listener({ ...request, resolve });
  });
}

export async function confirmAction(options: Options): Promise<boolean> {
  const tone = options.tone ?? "default";
  const result = await open({ title: options.title, message: options.message, tone, confirmLabel: options.confirmLabel ?? (tone === "danger" ? "Delete" : "Confirm"), cancelLabel: options.cancelLabel ?? "Cancel" });
  return result.ok;
}

/** Asks for a line of text. Resolves with the text, or null when cancelled. */
export async function promptAction(options: Options & { label: string; defaultValue?: string; placeholder?: string }): Promise<string | null> {
  const result = await open({
    title: options.title,
    message: options.message,
    tone: options.tone ?? "default",
    confirmLabel: options.confirmLabel ?? "Confirm",
    cancelLabel: options.cancelLabel ?? "Cancel",
    input: { label: options.label, defaultValue: options.defaultValue, placeholder: options.placeholder },
  });
  return result.ok ? result.text : null;
}

/** One-button message, the styled replacement for alert(). */
export async function noticeAction(options: { title: string; message?: string; tone?: ConfirmTone; okLabel?: string }): Promise<void> {
  await open({ title: options.title, message: options.message, tone: options.tone ?? "default", confirmLabel: options.okLabel ?? "OK", cancelLabel: null });
}

const TONE = {
  danger: { icon: Trash2, ring: "bg-[var(--color-status-error-bg)] text-[var(--color-status-error)]" },
  warning: { icon: AlertTriangle, ring: "bg-[var(--color-warning-bg)] text-[var(--color-warning-text)]" },
  default: { icon: HelpCircle, ring: "bg-[var(--color-bg-subtle)] text-[var(--color-text-primary)]" },
} as const;

export function ConfirmHost() {
  const [request, setRequest] = useState<Request | null>(null);
  const [text, setText] = useState("");
  const queue = useRef<Request[]>([]);

  useEffect(() => {
    listener = (next) => {
      setRequest((current) => {
        if (current) {
          queue.current.push(next);
          return current;
        }
        setText(next.input?.defaultValue ?? "");
        return next;
      });
    };
    return () => {
      listener = null;
    };
  }, []);

  if (!request) return null;

  const finish = (ok: boolean) => {
    request.resolve({ ok, text: text.trim() });
    const next = queue.current.shift() ?? null;
    setText(next?.input?.defaultValue ?? "");
    setRequest(next);
  };

  const { icon: Icon, ring } = request.cancelLabel === null && request.tone === "default" ? { icon: Info, ring: TONE.default.ring } : TONE[request.tone];
  const danger = request.tone === "danger";

  return (
    <DialogOverlay
      label={request.title}
      onClose={() => finish(false)}
      onClick={(event) => {
        if (event.target === event.currentTarget) finish(false);
      }}
      className="fixed inset-0 z-[200] flex items-end justify-center bg-[rgba(17,31,29,0.55)] p-3 pb-[max(12px,env(safe-area-inset-bottom))] backdrop-blur-[2px] sm:items-center sm:p-4"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          finish(true);
        }}
        noValidate
        className="max-h-[90dvh] w-full max-w-[420px] overflow-y-auto rounded-[20px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 sm:p-6 shadow-[0_32px_80px_-24px_rgba(17,31,29,0.55)] motion-safe:animate-[anops-rise_220ms_var(--ease-out)_both]"
      >
        <div className="flex items-start gap-4">
          <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-full", ring)}>
            <Icon size={20} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold tracking-[-0.01em] text-[var(--color-text-primary)]">{request.title}</h2>
            {request.message && <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-text-secondary)]">{request.message}</p>}
          </div>
        </div>
        {request.input && (
          <label className="mt-5 block space-y-1.5">
            <span className="text-sm font-semibold text-[var(--color-text-primary)]">{request.input.label}</span>
            <input
              data-autofocus
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={request.input.placeholder}
              className="h-11 w-full rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:ring-[3px] focus:ring-[var(--color-focus-ring)]"
            />
          </label>
        )}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {request.cancelLabel !== null && (
            <Button variant="secondary" onClick={() => finish(false)} className="sm:min-w-[96px]">
              {request.cancelLabel}
            </Button>
          )}
          <Button
            type="submit"
            variant={danger ? "danger" : "primary"}
            data-autofocus={request.input ? undefined : true}
            className={cn("sm:min-w-[96px]", danger && "bg-[var(--color-status-error)] text-white hover:opacity-90")}
          >
            {request.confirmLabel}
          </Button>
        </div>
      </form>
    </DialogOverlay>
  );
}
