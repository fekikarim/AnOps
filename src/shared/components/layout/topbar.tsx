"use client";

import { IconNotification, IconMenu } from "@/shared/components/ui/brand-icons";
import { AppSwitcher } from "@/features/platform/components/app-switcher";
import { applicationForPath, type ApplicationId } from "@/shared/domain/applications";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/shared/components/theme-toggle";
import { CompanySwitcher } from "@/features/company/components/company-switcher";
import type { Company } from "@/features/company/types";

export function Topbar({
  onMenuClick,
  companies = [],
  activeCompanyId = "",
  allowedApps = [],
  permissions = [],
  aiFeatures = true,
}: {
  onMenuClick?: () => void;
  companies?: Company[];
  activeCompanyId?: string;
  allowedApps?: ApplicationId[];
  permissions?: string[];
  aiFeatures?: boolean;
}) {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-20 flex h-[72px] items-center gap-2 sm:gap-4 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]/95 backdrop-blur px-3 sm:px-4 md:px-6">
      {onMenuClick && (
        <button
          type="button"
          onClick={onMenuClick}
          className="lg:hidden h-10 w-10 rounded-[var(--radius-control)] flex items-center justify-center hover:bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)] shrink-0"
          aria-label="Open navigation"
        >
          <IconMenu size={18} />
        </button>
      )}

      {companies.length > 0 && (
        <div className="shrink-0">
          <CompanySwitcher companies={companies} activeCompanyId={activeCompanyId} />
        </div>
      )}

      <div className="flex-1">
        <AppSwitcher allowed={allowedApps} permissions={permissions} aiFeatures={aiFeatures} currentAppId={applicationForPath(pathname)?.id ?? null} />
      </div>
      <ThemeToggle />
      <button
        className="relative h-10 w-10 rounded-[var(--radius-control)] flex items-center justify-center hover:bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)]"
        aria-label="Notifications"
      >
        <IconNotification size={18} />
        <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-[var(--color-action-primary)] ring-2 ring-[var(--color-bg-surface)]" />
      </button>
    </header>
  );
}
