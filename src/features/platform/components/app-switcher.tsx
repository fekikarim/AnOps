"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Portal } from "@/shared/components/ui/portal";
import { useScrollLock } from "@/shared/hooks/use-scroll-lock";
import { AnimatedIcon } from "@/shared/components/portal/animated-icon";
import { IconSearch } from "@/shared/components/ui/brand-icons";
import { APPLICATIONS, type ApplicationId } from "@/shared/domain/applications";
import { cn } from "@/shared/lib/utils";

type Entry = { key: string; label: string; detail: string; href: string; icon: string; locked: boolean; kind: "app" | "page" };

/**
 * Global application switcher and search. Only authorized applications and their pages are
 * navigable; other applications are listed as locked with an upgrade link.
 */
export function AppSwitcher({
  allowed,
  currentAppId,
  permissions = [],
  aiFeatures = true,
  trigger = "button",
  upgradeHref = "/anops?plans=1",
  hotkey = true,
}: {
  allowed: ApplicationId[];
  currentAppId?: ApplicationId | null;
  permissions?: string[];
  aiFeatures?: boolean;
  trigger?: "button" | "icon";
  upgradeHref?: string;
  /** Only one switcher per screen should own the ⌘K shortcut. */
  hotkey?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();

  // ── macOS-style movable window (desktop with a mouse only) ─────────────────────────────────────────
  // The panel can be dragged by its search bar like a window or a browser tab. Phones and touch devices keep the bottom sheet.
  const moverRef = useRef<HTMLDivElement | null>(null);
  const offset = useRef({ x: 0, y: 0 });
  /** The translation currently applied to the mounted element (a freshly mounted panel starts at 0,0). */
  const applied = useRef({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px) and (hover: hover) and (pointer: fine)");
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  /** Keeps the title bar reachable: it can leave the screen only partially, never completely. */
  const clamp = useCallback((x: number, y: number) => {
    const el = moverRef.current;
    if (!el) return { x, y };
    // The element's untranslated position = current rect minus the offset currently applied.
    const rect = el.getBoundingClientRect();
    const baseLeft = rect.left - applied.current.x;
    const baseTop = rect.top - applied.current.y;
    const minX = 96 - (baseLeft + rect.width);
    const maxX = window.innerWidth - 96 - baseLeft;
    const minY = 8 - baseTop;
    const maxY = window.innerHeight - 64 - baseTop;
    return { x: Math.min(Math.max(x, minX), maxX), y: Math.min(Math.max(y, minY), maxY) };
  }, []);

  const applyOffset = useCallback((animate = false) => {
    const el = moverRef.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.style.transition = animate && !reduced ? "transform 320ms cubic-bezier(0.34, 1.3, 0.64, 1)" : "none";
    el.style.transform = `translate3d(${offset.current.x}px, ${offset.current.y}px, 0)`;
    applied.current = { ...offset.current };
  }, []);

  const onBarPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!desktop || event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    const start = { px: event.clientX, py: event.clientY, x: offset.current.x, y: offset.current.y };
    let moving = false;
    let frame = 0;

    const onMove = (move: PointerEvent) => {
      const dx = move.clientX - start.px;
      const dy = move.clientY - start.py;
      // A click (to place the caret in the input) must stay a click: only start moving after a few pixels.
      if (!moving && Math.hypot(dx, dy) < 4) return;
      if (!moving) {
        moving = true;
        setDragging(true);
        document.body.style.userSelect = "none";
        document.body.style.cursor = "grabbing";
        window.getSelection()?.removeAllRanges();
      }
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        offset.current = clamp(start.x + dx, start.y + dy);
        applyOffset();
      });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      cancelAnimationFrame(frame);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      if (moving) setDragging(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const recenter = () => {
    offset.current = { x: 0, y: 0 };
    applyOffset(true);
  };

  // The panel mounts through a portal a tick after `open`, so the remembered position is restored when the element attaches.
  const attachMover = useCallback(
    (el: HTMLDivElement | null) => {
      moverRef.current = el;
      if (!el) return;
      applied.current = { x: 0, y: 0 }; // freshly mounted, untranslated
      offset.current = clamp(offset.current.x, offset.current.y);
      applyOffset();
    },
    [clamp, applyOffset]
  );

  // Keep the panel on screen when the window is resized.
  useEffect(() => {
    if (!open || !desktop) return;
    const onResize = () => {
      offset.current = clamp(offset.current.x, offset.current.y);
      applyOffset();
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open, desktop, clamp, applyOffset]);

  const entries = useMemo<Entry[]>(() => {
    const allowedSet = new Set(allowed);
    const perms = new Set(permissions);
    const list: Entry[] = [];
    for (const app of APPLICATIONS) {
      const locked = !allowedSet.has(app.id);
      list.push({ key: app.id, label: app.name, detail: locked ? "Not in your plan · upgrade" : app.tagline, href: locked ? upgradeHref : app.href, icon: app.icon, locked, kind: "app" });
      if (!locked) {
        for (const group of app.nav) {
          for (const item of group.items) {
            if ((item.permission && !perms.has(item.permission)) || (item.ai && !aiFeatures)) continue;
            if (item.href === app.href) continue;
            list.push({ key: `${app.id}:${item.href}`, label: item.label, detail: `${app.name} · ${group.label}`, href: item.href, icon: app.icon, locked: false, kind: "page" });
          }
        }
      }
    }
    return list;
  }, [allowed, permissions, aiFeatures, upgradeHref]);

  const results = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) {
      const apps = entries.filter((e) => e.kind === "app");
      return [...apps.filter((e) => !e.locked), ...apps.filter((e) => e.locked)];
    }
    return entries.filter((e) => `${e.label} ${e.detail}`.toLowerCase().includes(term)).slice(0, 30);
  }, [entries, query]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActive(0);
  }, []);

  useEffect(() => {
    if (!hotkey) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hotkey]);

  useScrollLock(open);

  // The dialog renders through a portal one tick after `open`, so focus is requested with autoFocus on the input;
  // Escape is also handled on the window so it works even if focus has moved.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  // Keep the highlighted result visible while navigating with the arrow keys.
  useEffect(() => {
    if (!open) return;
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, open, listId]);

  const go = (entry: Entry | undefined) => {
    if (!entry) return;
    close();
    router.push(entry.href);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label="Search and switch applications"
        className={cn(
          "inline-flex items-center gap-2 rounded-[10px] text-sm text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]",
          trigger === "button" ? "h-10 border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-3 hover:border-[var(--color-border-control)]" : "h-11 w-11 justify-center"
        )}
      >
        <IconSearch size={16} />
        {trigger === "button" && (
          <>
            <span className="hidden sm:inline">Search apps and pages</span>
            <kbd className="ml-2 hidden rounded border border-[var(--color-border-subtle)] px-1.5 text-[11px] font-medium md:inline">⌘K</kbd>
          </>
        )}
      </button>

      {open && (
        <Portal>
        <div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/45 backdrop-blur-sm motion-safe:animate-[anops-fade_160ms_ease-out_both] sm:items-start sm:p-4 sm:pt-[10vh]"
          onMouseDown={close}
        >
          {/* The mover carries the drag translation; the dialog inside keeps its own entrance animation. */}
          <div ref={attachMover} className="w-full will-change-transform sm:max-w-[640px]">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Search applications and pages"
            onMouseDown={(event) => event.stopPropagation()}
            className={cn(
              "flex max-h-[min(86dvh,640px)] w-full flex-col overflow-hidden rounded-t-[22px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] pb-[env(safe-area-inset-bottom)] motion-safe:animate-[anops-rise_240ms_var(--ease-out)_both] sm:max-h-[min(70dvh,560px)] sm:rounded-[18px] sm:pb-0",
              "transition-shadow duration-200",
              dragging ? "shadow-[0_60px_120px_-30px_rgba(0,0,0,0.75)] ring-1 ring-[var(--color-border-control)]" : "shadow-[0_40px_100px_-30px_rgba(0,0,0,0.6)]"
            )}
          >
            <div
              onPointerDown={onBarPointerDown}
              onDoubleClick={(event) => !(event.target as HTMLElement).closest("input, button") && recenter()}
              className={cn(
                "flex shrink-0 items-center gap-3 border-b border-[var(--color-border-subtle)] px-4 transition-colors focus-within:border-[var(--color-text-secondary)]",
                desktop && (dragging ? "cursor-grabbing" : "cursor-grab")
              )}
            >
              <IconSearch size={18} className="shrink-0 text-[var(--color-text-secondary)]" />
              <input
                autoFocus
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setActive((i) => Math.min(i + 1, results.length - 1));
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setActive((i) => Math.max(i - 1, 0));
                  } else if (event.key === "Enter") {
                    event.preventDefault();
                    go(results[active]);
                  } else if (event.key === "Escape") {
                    close();
                  }
                }}
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
                aria-autocomplete="list"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="go"
                placeholder="Search applications and pages…"
                // text-base (16px) prevents iOS from zooming the page on focus; the global focus outline is replaced by the container ring below.
                style={{ outline: "none", boxShadow: "none" }}
                className="h-14 min-w-0 flex-1 cursor-text appearance-none bg-transparent text-base text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)]"
              />
              <button
                type="button"
                onClick={close}
                aria-label="Close search"
                className="shrink-0 rounded-md border border-[var(--color-border-subtle)] px-2 py-1 text-[11px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
              >
                <span className="sm:hidden">Close</span>
                <span className="hidden sm:inline">Esc</span>
              </button>
            </div>
            <ul id={listId} role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 [scrollbar-width:thin]">
              {results.length === 0 && <li className="p-8 text-center text-sm text-[var(--color-text-secondary)]">Nothing matches “{query}”.</li>}
              {results.map((entry, index) => (
                <li
                  key={entry.key}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  onMouseMove={() => index !== active && setActive(index)}
                  onClick={() => go(entry)}
                  className={cn(
                    "flex min-h-[52px] cursor-pointer items-center gap-3 rounded-[12px] px-3 py-2 transition-colors duration-100 active:bg-[var(--color-bg-subtle)]",
                    index === active && "bg-[var(--color-bg-subtle)]",
                    entry.locked && "opacity-60"
                  )}
                >
                  <AnimatedIcon icon={entry.icon} size={entry.kind === "app" ? 36 : 28} play="never" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
                      <span className="truncate">{entry.label}</span>
                      {entry.kind === "app" && entry.key === currentAppId && <span className="shrink-0 rounded-full bg-[var(--color-bg-subtle)] px-2 text-[11px] font-medium text-[var(--color-text-secondary)]">Current</span>}
                    </span>
                    <span className="block truncate text-xs text-[var(--color-text-secondary)]">{entry.detail}</span>
                  </span>
                  {entry.locked && <span className="shrink-0 rounded-full border border-[var(--color-border-subtle)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-text-secondary)]">Upgrade</span>}
                </li>
              ))}
            </ul>
            <div className="hidden shrink-0 items-center gap-4 border-t border-[var(--color-border-subtle)] px-4 py-2 text-[11px] text-[var(--color-text-secondary)] sm:flex">
              <span>↑↓ navigate</span>
              <span>↵ open</span>
              <span>Esc close</span>
              {desktop && <span className="ml-auto">Drag the bar to move · double-click to reset</span>}
            </div>
          </div>
          </div>
        </div>
        </Portal>
      )}
    </>
  );
}
