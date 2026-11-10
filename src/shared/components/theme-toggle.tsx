"use client";

import { MoonStar, SunMedium } from "lucide-react";
import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** The theme script in the root layout has already applied the stored or system theme to <html> before hydration. */
function readTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "dark") {
    root.classList.add("dark");
    root.setAttribute("data-theme", "dark");
  } else {
    root.classList.remove("dark");
    root.setAttribute("data-theme", "light");
  }
}

const noopSubscribe = () => () => {};

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, readTheme, () => "light" as Theme);
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);

  const toggle = () => {
    const next: Theme = readTheme() === "dark" ? "light" : "dark";
    applyTheme(next);
    try {
      localStorage.setItem("anops:theme", next);
    } catch {
      // Private mode or blocked storage: the theme still changes for this visit.
    }
    listeners.forEach((listener) => listener());
  };

  if (!hydrated) {
    return <div className="h-11 w-11 rounded-full" aria-hidden="true" />;
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="group relative flex h-11 w-11 items-center justify-center rounded-full text-[var(--color-text-secondary)] transition-colors duration-200 hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] motion-safe:active:scale-90"
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      {/* Both icons stay mounted so the swap can rotate and fade instead of popping. */}
      <SunMedium
        size={20}
        strokeWidth={1.9}
        aria-hidden="true"
        className={`absolute transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none ${theme === "dark" ? "rotate-0 scale-100 opacity-100" : "rotate-90 scale-50 opacity-0"}`}
      />
      <MoonStar
        size={20}
        strokeWidth={1.9}
        aria-hidden="true"
        className={`absolute transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none ${theme === "dark" ? "-rotate-90 scale-50 opacity-0" : "rotate-0 scale-100 opacity-100"}`}
      />
    </button>
  );
}
