"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { LayoutDashboard, LogOut, Settings, User } from "lucide-react";
import { logoutAction } from "@/features/auth/actions/auth.action";
import { cn } from "@/shared/lib/utils";

type MenuUser = { name?: string | null; email?: string | null; image?: string | null };

function initials(user: MenuUser): string {
  const source = (user.name || user.email || "?").trim();
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[1][0] : "")).toUpperCase();
}

const row =
  "flex min-h-[44px] w-full items-center gap-3 rounded-[10px] px-3 text-sm font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-bg-subtle)] focus-visible:bg-[var(--color-bg-subtle)] focus-visible:outline-none";

function SignOutRow() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      role="menuitem"
      disabled={pending}
      className={cn(row, "text-[var(--color-status-error-fg)] hover:bg-[var(--color-status-error-bg)] focus-visible:bg-[var(--color-status-error-bg)] disabled:cursor-wait disabled:opacity-70")}
    >
      {pending ? <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <LogOut size={16} aria-hidden="true" />}
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}

/** Account menu for the marketing header: profile avatar with Profile, Settings and Sign out. Works with mouse, touch and keyboard. */
export function UserMenu({ user }: { user: MenuUser }) {
  const [open, setOpen] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const label = user.name || user.email || "Account";

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        root.current?.querySelector<HTMLButtonElement>("button[aria-haspopup]")?.focus();
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const items = [...(panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
        if (items.length === 0) return;
        event.preventDefault();
        const index = items.indexOf(document.activeElement as HTMLElement);
        const next = event.key === "ArrowDown" ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
        items[next].focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    panel.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Account menu for ${label}`}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-[var(--color-action-primary)] text-sm font-bold text-[var(--color-action-on-primary)] ring-2 ring-transparent transition-[box-shadow,transform] duration-200 hover:ring-[var(--color-border-control)] focus-visible:outline-none focus-visible:ring-[var(--color-focus-ring)] motion-safe:active:scale-95",
          open && "ring-[var(--color-border-control)]"
        )}
      >
        {user.image && !imageFailed ? (
          // eslint-disable-next-line @next/next/no-img-element -- user-supplied avatar URL, falls back to initials
          <img src={user.image} alt="" onError={() => setImageFailed(true)} className="h-full w-full object-cover" />
        ) : (
          <span aria-hidden="true">{initials(user)}</span>
        )}
      </button>

      {open && (
        <div
          ref={panel}
          id={panelId}
          role="menu"
          aria-label="Account"
          className="menu-in absolute right-0 top-[calc(100%+10px)] z-50 w-[min(280px,calc(100vw-32px))] origin-top-right rounded-[16px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-2 shadow-[0_24px_60px_-20px_rgba(17,31,29,0.4),0_2px_8px_rgba(17,31,29,0.12)]"
        >
          <div className="flex items-center gap-3 px-3 pb-3 pt-2">
            <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-action-primary)] text-sm font-bold text-[var(--color-action-on-primary)]">
              {initials(user)}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-[var(--color-text-primary)]">{user.name || "Your account"}</span>
              {user.email && <span className="block truncate text-xs text-[var(--color-text-secondary)]">{user.email}</span>}
            </span>
          </div>
          <div role="separator" className="mx-1 mb-1 h-px bg-[var(--color-border-subtle)]" />
          <Link href="/anops" role="menuitem" onClick={() => setOpen(false)} className={row}>
            <LayoutDashboard size={16} aria-hidden="true" className="text-[var(--color-text-secondary)]" />
            Workspace
          </Link>
          <Link href="/profile" role="menuitem" onClick={() => setOpen(false)} className={row}>
            <User size={16} aria-hidden="true" className="text-[var(--color-text-secondary)]" />
            Profile
          </Link>
          <Link href="/settings" role="menuitem" onClick={() => setOpen(false)} className={row}>
            <Settings size={16} aria-hidden="true" className="text-[var(--color-text-secondary)]" />
            Settings
          </Link>
          <div role="separator" className="mx-1 my-1 h-px bg-[var(--color-border-subtle)]" />
          <form action={logoutAction}>
            <SignOutRow />
          </form>
        </div>
      )}
    </div>
  );
}
