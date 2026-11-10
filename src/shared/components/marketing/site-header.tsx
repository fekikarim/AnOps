"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useEffect, useRef, useState } from "react";
import { IconChevronDown, IconClose, IconMenu } from "@/shared/components/ui/brand-icons";
import { Building2, ChevronRight, Compass, LifeBuoy, Tag, Users } from "lucide-react";
import { UserMenu } from "@/shared/components/marketing/user-menu";
import { ThemeToggle } from "@/shared/components/theme-toggle";
import { categories, appsInCategory } from "@/shared/config/catalog";
import { primaryNav } from "@/shared/config/site";
import { btnPrimary } from "@/shared/components/marketing/styles";
import { AnimatedIcon } from "@/shared/components/portal/animated-icon";
import { StatusBadge } from "@/shared/components/marketing/status-badge";
import { cn } from "@/shared/lib/utils";

const MOBILE_ICONS: Record<string, typeof Compass> = {
  "/industries": Building2,
  "/pricing": Tag,
  "/community-hub": Users,
  "/help": LifeBuoy,
};

type SiteHeaderUser = {
  name?: string | null;
  email?: string | null;
  role?: string | null;
  image?: string | null;
};

export function SiteHeader({ user }: { user?: SiteHeaderUser | null }) {
  const pathname = usePathname();
  const [appsOpen, setAppsOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const appsPanelId = useId();
  const mobilePanelId = useId();

  useEffect(() => {
    if (!appsOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setAppsOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAppsOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [appsOpen]);

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const closeAll = () => {
    setAppsOpen(false);
    setMobileOpen(false);
  };

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-canvas)]/95 backdrop-blur">
      <div className="relative mx-auto flex h-[72px] w-full max-w-[1200px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex shrink-0 items-center" onClick={closeAll} aria-label="AnOps home">
          <img
            src="/brand-kit/01-brand-identity/logos/anops-logo-horizontal-dark.svg"
            alt=""
            className="h-7 block dark:hidden"
          />
          <img
            src="/brand-kit/01-brand-identity/logos/anops-logo-horizontal-white.svg"
            alt=""
            className="h-7 hidden dark:block"
          />
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
          <div ref={menuRef}>
            <button
              type="button"
              aria-expanded={appsOpen}
              aria-controls={appsPanelId}
              onClick={() => setAppsOpen((open) => !open)}
              className={cn(
                "relative inline-flex min-h-[44px] items-center gap-1.5 rounded-[var(--radius-control)] px-3.5 text-sm font-medium transition-colors duration-200 hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]",
                isActive("/apps") || appsOpen ? "bg-[var(--color-bg-subtle)] font-semibold text-[var(--color-text-primary)]" : "text-[var(--color-text-secondary)]"
              )}
            >
              Apps
              <IconChevronDown size={12} className={cn("transition-transform", appsOpen && "rotate-180")} />
              <span aria-hidden="true" className={cn("pointer-events-none absolute inset-x-3.5 -bottom-px h-[3px] origin-center rounded-full bg-[var(--color-action-primary)] transition-transform duration-300 ease-out", isActive("/apps") ? "scale-x-100" : "scale-x-0")} />
            </button>
            <div
              id={appsPanelId}
              hidden={!appsOpen}
              className="menu-in absolute inset-x-4 top-[calc(100%-4px)] max-h-[calc(100dvh-88px)] overflow-y-auto overscroll-contain rounded-[16px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-3 shadow-[0_24px_60px_-24px_rgba(17,31,29,0.35)] sm:inset-x-6 lg:inset-x-8"
            >
              <div className="grid grid-cols-3 gap-x-2 gap-y-1">
                {categories.map((category) => (
                  <div key={category.id} className="min-w-0 p-2">
                    <p className="px-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-secondary)]">{category.label}</p>
                    <ul className="mt-1.5 space-y-0.5">
                      {appsInCategory(category.id).map((app) => (
                        <li key={app.slug}>
                          <Link
                            href={`/apps/${app.slug}`}
                            onClick={closeAll}
                            className="group flex min-w-0 items-start gap-3 rounded-[10px] px-2 py-2 transition-colors duration-150 hover:bg-[var(--color-bg-subtle)] focus-visible:bg-[var(--color-bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
                          >
                            <AnimatedIcon icon={app.icon} size={36} />
                            <span className="min-w-0 flex-1 pt-0.5">
                              <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-[var(--color-text-primary)]">
                                {app.name}
                                {app.status !== "available" && <StatusBadge status={app.status} />}
                              </span>
                              <span className="mt-0.5 block text-xs leading-snug text-[var(--color-text-secondary)] [overflow-wrap:anywhere]">{app.tagline}</span>
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex items-center justify-between rounded-[12px] bg-[var(--color-bg-subtle)] px-4 py-3 text-sm">
                <span className="text-[var(--color-text-secondary)]">11 managements, one shared set of records.</span>
                <Link href="/apps" onClick={closeAll} className="font-semibold text-[var(--color-text-primary)] hover:underline">
                  Browse the app directory
                </Link>
              </div>
            </div>
          </div>
          {primaryNav
            .filter((item) => item.href !== "/apps")
            .map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive(item.href) ? "page" : undefined}
                className={cn(
                  "relative inline-flex min-h-[44px] items-center rounded-[var(--radius-control)] px-3.5 text-sm font-medium transition-colors duration-200 hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]",
                  isActive(item.href) ? "bg-[var(--color-bg-subtle)] font-semibold text-[var(--color-text-primary)]" : "text-[var(--color-text-secondary)]"
                )}
              >
                {item.label}
                <span aria-hidden="true" className={cn("pointer-events-none absolute inset-x-3.5 -bottom-px h-[3px] origin-center rounded-full bg-[var(--color-action-primary)] transition-transform duration-300 ease-out", isActive(item.href) ? "scale-x-100" : "scale-x-0")} />
              </Link>
            ))}
        </nav>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          {user ? null : (
            <>
              <Link
                href="/login"
                className="hidden min-h-[44px] items-center rounded-[var(--radius-control)] px-3 text-sm font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text-primary)] sm:inline-flex"
              >
                Sign in
              </Link>
              <Link href="/trial" className={cn(btnPrimary, "hidden px-4 sm:inline-flex")}>
                Try it free
              </Link>
            </>
          )}
          {user && <UserMenu user={user} />}
          <button
            type="button"
            aria-expanded={mobileOpen}
            aria-controls={mobilePanelId}
            aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
            onClick={() => setMobileOpen((open) => !open)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-control)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-subtle)] lg:hidden"
          >
            {mobileOpen ? <IconClose size={14} /> : <IconMenu size={18} />}
          </button>
        </div>
      </div>

      <div
        id={mobilePanelId}
        hidden={!mobileOpen}
        className="h-[calc(100dvh-72px)] overflow-y-auto overscroll-contain border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-canvas)] lg:hidden"
      >
        <nav aria-label="Mobile" className="menu-in mx-auto flex min-h-full max-w-[640px] flex-col px-4 pt-5">
          {/* Explore */}
          <p className="px-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-secondary)]">Explore</p>
          <ul className="mt-2 overflow-hidden rounded-[18px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
            {primaryNav
              .filter((item) => item.href !== "/apps")
              .map((item) => {
                const Icon = MOBILE_ICONS[item.href] ?? Compass;
                const active = isActive(item.href);
                return (
                  <li key={item.href} className="border-b border-[var(--color-border-subtle)] last:border-b-0">
                    <Link
                      href={item.href}
                      onClick={closeAll}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group relative flex min-h-[56px] items-center gap-3.5 px-4 text-[15px] font-semibold text-[var(--color-text-primary)] transition-colors active:bg-[var(--color-bg-subtle)]",
                        active && "bg-[var(--color-bg-subtle)]"
                      )}
                    >
                      <span aria-hidden="true" className={cn("absolute inset-y-3 left-0 w-1 rounded-r-full bg-[var(--color-action-primary)] transition-opacity", active ? "opacity-100" : "opacity-0")} />
                      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]", active ? "bg-[var(--color-action-primary)] text-[var(--color-action-on-primary)]" : "bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)]")}>
                        <Icon size={18} aria-hidden="true" />
                      </span>
                      <span className="flex-1">{item.label}</span>
                      <ChevronRight size={16} aria-hidden="true" className="text-[var(--color-text-secondary)] transition-transform group-active:translate-x-0.5" />
                    </Link>
                  </li>
                );
              })}
          </ul>

          {/* Applications */}
          <div className="mt-6 flex items-center justify-between px-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-secondary)]">Applications</p>
            <Link href="/apps" onClick={closeAll} className="inline-flex min-h-[32px] items-center gap-1 text-xs font-semibold text-[var(--color-text-primary)] hover:underline">
              Browse all
              <ChevronRight size={14} aria-hidden="true" />
            </Link>
          </div>
          <ul className="mt-2 grid grid-cols-2 gap-2">
            {categories.flatMap((category) => appsInCategory(category.id)).map((app) => {
              const active = pathname.startsWith(`/apps/${app.slug}`);
              return (
                <li key={app.slug}>
                  <Link
                    href={`/apps/${app.slug}`}
                    onClick={closeAll}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex min-h-[64px] items-center gap-2.5 rounded-[14px] border bg-[var(--color-bg-surface)] p-2.5 text-[13px] font-semibold leading-tight text-[var(--color-text-primary)] transition-[border-color,transform,background-color] active:scale-[0.98] active:bg-[var(--color-bg-subtle)]",
                      active ? "border-[var(--color-action-primary)] ring-1 ring-[var(--color-action-primary)]" : "border-[var(--color-border-subtle)]"
                    )}
                  >
                    <AnimatedIcon icon={app.icon} size={34} play="never" />
                    <span className="min-w-0 break-words">{app.name}</span>
                  </Link>
                </li>
              );
            })}
          </ul>

          {/* Account / sign-in actions stay reachable at the bottom of the sheet */}
          {!user && (
            <div className="sticky bottom-0 -mx-4 mt-6 grid grid-cols-2 gap-2 border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-canvas)]/95 px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
              <Link href="/login" onClick={closeAll} className="flex min-h-[48px] items-center justify-center rounded-[var(--radius-control)] border border-[var(--color-border-control)] text-sm font-semibold text-[var(--color-text-primary)] active:bg-[var(--color-bg-subtle)]">
                Sign in
              </Link>
              <Link href="/trial" onClick={closeAll} className={cn(btnPrimary, "min-h-[48px] justify-center")}>
                Try it free
              </Link>
            </div>
          )}
          {user && <div className="h-[max(24px,env(safe-area-inset-bottom))] shrink-0" />}
        </nav>
      </div>
    </header>
  );
}
