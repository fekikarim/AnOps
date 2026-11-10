"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  IconGrid,
  IconSettings,
  IconChevronDown,
  IconLogOut,
  IconHelpCircle,
  IconClose,
  IconProfileCard,
  IconBuilding,
} from "@/shared/components/ui/brand-icons";
import { AnimatedIcon } from "@/shared/components/portal/animated-icon";
import { APPLICATIONS, applicationForPath, visibleNavItems, type Application, type ApplicationId } from "@/shared/domain/applications";
import { cn } from "@/shared/lib/utils";
import { logoutAction } from "@/features/auth/actions/auth.action";

type SidebarUser = {
  name: string;
  email: string;
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function isActive(pathname: string, href: string, exact?: boolean) {
  return exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

/** Navigation owned by the current application: identity, grouped pages (collapsible), current page highlighted. */
function AppNavigation({ app, pathname, permissions, aiFeatures, onNavigate }: { app: Application; pathname: string; permissions: ReadonlySet<string>; aiFeatures: boolean; onNavigate?: () => void }) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const groups = visibleNavItems(app, { aiFeatures, permissions });
  const single = groups.length === 1;
  return (
    <div>
      <div className="mb-3 flex items-center gap-3 rounded-[14px] px-2 py-2" style={{ ["--accent" as string]: app.accent }}>
        <AnimatedIcon icon={app.icon} size={40} play="never" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{app.name}</p>
          <p className="truncate text-xs text-[var(--color-text-secondary)]">{app.tagline}</p>
        </div>
      </div>
      {groups.map((group) => {
        const isCollapsed = collapsed[group.label] ?? false;
        return (
          <div key={group.label} className="mb-2">
            {!single && (
              <button
                type="button"
                aria-expanded={!isCollapsed}
                onClick={() => setCollapsed((c) => ({ ...c, [group.label]: !isCollapsed }))}
                className="flex w-full items-center justify-between rounded-[8px] px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              >
                {group.label}
                <IconChevronDown size={11} className={cn("transition-transform", isCollapsed && "-rotate-90")} />
              </button>
            )}
            {!isCollapsed && (
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const active = isActive(pathname, item.href, item.exact);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onNavigate}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex min-h-[40px] items-center gap-2.5 rounded-[var(--radius-control)] px-2.5 text-sm transition-colors",
                          active ? "bg-[var(--color-action-primary)] font-semibold text-[var(--color-action-on-primary)]" : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text-primary)]"
                        )}
                      >
                        <span aria-hidden="true" className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-[var(--color-action-on-primary)]" : "bg-[var(--color-border-control)]")} />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function Sidebar({
  className,
  user,
  mobileOpen = false,
  onMobileClose,
  allowedApps = [],
  permissions = [],
  aiFeatures = true,
  orgId,
}: {
  className?: string;
  user: SidebarUser;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
  allowedApps?: ApplicationId[];
  permissions?: string[];
  aiFeatures?: boolean;
  orgId?: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const currentApp = applicationForPath(pathname);
  const permissionSet = new Set(permissions);
  const installed = APPLICATIONS.filter((app) => allowedApps.includes(app.id));

  // The app switcher closes when the page or the mobile drawer changes (state adjusted during render, not in an effect).
  const [seen, setSeen] = useState({ pathname, mobileOpen });
  if (seen.pathname !== pathname || seen.mobileOpen !== mobileOpen) {
    setSeen({ pathname, mobileOpen });
    setOpen(false);
  }

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-40 flex h-[100dvh] w-[280px] shrink-0 flex-col overflow-hidden border-r border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] lg:static lg:z-auto lg:w-[240px] lg:translate-x-0",
        mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        className
      )}
    >
      <div className="flex h-[72px] items-center justify-between px-4 sm:px-5">
        <Link href="/anops" className="flex items-center" onClick={onMobileClose} aria-label="AnOps home">
          {/* Light mode: dark logo; Dark mode: white logo */}
          <img
            src="/brand-kit/01-brand-identity/logos/anops-logo-horizontal-dark.svg"
            alt="AnOps"
            className="h-7 block dark:hidden"
          />
          <img
            src="/brand-kit/01-brand-identity/logos/anops-logo-horizontal-white.svg"
            alt="AnOps"
            className="h-7 hidden dark:block"
          />
        </Link>
        {onMobileClose && (
          <button
            type="button"
            onClick={onMobileClose}
            className="lg:hidden h-10 w-10 flex items-center justify-center rounded-[var(--radius-control)] hover:bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)]"
            aria-label="Close menu"
          >
            <IconClose size={14} />
          </button>
        )}
      </div>

      {/* min-h-0 + overflow-y-auto: on short viewports the links scroll instead of being clipped. */}
      <nav aria-label={currentApp ? `${currentApp.name} navigation` : "Applications"} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2.5 py-2">
        <Link
          href="/anops"
          onClick={onMobileClose}
          className="mb-3 flex min-h-[40px] items-center gap-2.5 rounded-[var(--radius-control)] px-2.5 text-sm font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text-primary)]"
        >
          <IconGrid size={15} />
          All applications
        </Link>
        {currentApp ? (
          <AppNavigation key={currentApp.id} app={currentApp} pathname={pathname} permissions={permissionSet} aiFeatures={aiFeatures} onNavigate={onMobileClose} />
        ) : (
          <ul className="space-y-0.5">
            {installed.map((app) => (
              <li key={app.id}>
                <Link href={app.href} onClick={onMobileClose} className="flex min-h-[44px] items-center gap-2.5 rounded-[var(--radius-control)] px-2 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text-primary)]">
                  <AnimatedIcon icon={app.icon} size={28} play="never" />
                  <span className="truncate">{app.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </nav>

      <div className="shrink-0 border-t border-[var(--color-border-subtle)] p-2">
        <button
          onClick={() => setOpen(!open)}
          className="group flex w-full items-center gap-2.5 rounded-[var(--radius-control)] px-2.5 py-2.5 min-h-[44px] text-left hover:bg-[var(--color-bg-subtle)]"
        >
          <div className="relative">
            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-[var(--color-bg-subtle)] to-[var(--color-border-subtle)] flex items-center justify-center text-xs font-semibold text-[var(--color-text-primary)]">
              {initials(user.name)}
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-[#22c55e] ring-2 ring-[var(--color-bg-surface)]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate text-[var(--color-text-primary)]">{user.name}</p>
            <p className="text-xs text-[var(--color-text-secondary)] truncate">{user.email}</p>
          </div>
          <IconChevronDown
            size={14}
            className={cn(
              "text-[var(--color-text-secondary)] transition-transform shrink-0",
              open && "rotate-180"
            )}
          />
        </button>

        {open && (
          <div className="mt-1 space-y-0.5 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-1 shadow-[0_10px_40px_-10px_rgba(17,31,29,0.25)]">
            <Link href="/profile" onClick={onMobileClose} className="flex w-full items-center gap-2 rounded-[var(--radius-control)] px-2 py-2 min-h-[44px] text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-bg-subtle)]">
              <IconProfileCard size={16} className="text-[var(--color-text-secondary)]" />
              Profile
            </Link>
            {orgId && (
              <Link href={`/organization/${orgId}/settings`} onClick={onMobileClose} className="flex w-full items-center gap-2 rounded-[var(--radius-control)] px-2 py-2 min-h-[44px] text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-bg-subtle)]">
                <IconSettings size={16} className="text-[var(--color-text-secondary)]" />
                Organization settings
              </Link>
            )}
            <Link href="/help" onClick={onMobileClose} className="flex w-full items-center gap-2 rounded-[var(--radius-control)] px-2 py-2 min-h-[44px] text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-bg-subtle)]">
              <IconHelpCircle size={16} className="text-[var(--color-text-secondary)]" />
              Help
            </Link>
            <Link
              href="/"
              onClick={onMobileClose}
              className="flex w-full items-center gap-2 rounded-[var(--radius-control)] px-2 py-2 min-h-[44px] text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-bg-subtle)]"
            >
              <IconBuilding size={16} className="text-[var(--color-text-secondary)]" />
              Public portal
            </Link>
            <div className="my-1 h-px bg-[var(--color-border-subtle)]" />
            <form action={logoutAction}>
              <button
                type="submit"
                className="flex w-full items-center gap-2 rounded-[var(--radius-control)] px-2 py-2 min-h-[44px] text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-bg-subtle)]"
              >
                <IconLogOut size={16} className="text-[var(--color-text-secondary)]" />
                Sign out
              </button>
            </form>
          </div>
        )}
      </div>
    </aside>
  );
}
