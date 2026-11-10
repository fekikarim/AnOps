"use client";

import { useEffect, useState } from "react";
import { useScrollLock } from "@/shared/hooks/use-scroll-lock";
import { Sidebar } from "@/shared/components/layout/sidebar";
import { Topbar } from "@/shared/components/layout/topbar";

import type { Company } from "@/features/company/types";
import type { ApplicationId } from "@/shared/domain/applications";

type ShellUser = {
  name: string;
  email: string;
};

export function DashboardShell({
  children,
  user,
  companies = [],
  activeCompanyId,
  allowedApps = [],
  permissions = [],
  aiFeatures = true,
}: {
  children: React.ReactNode;
  user: ShellUser;
  companies?: Company[];
  activeCompanyId?: string;
  allowedApps?: ApplicationId[];
  permissions?: string[];
  aiFeatures?: boolean;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // While the mobile drawer is open, the page behind it must not scroll, and Escape closes it.
  useScrollLock(sidebarOpen);
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sidebarOpen]);

  return (
    <div className="flex h-[100dvh] min-h-0 overflow-hidden bg-[var(--color-bg-canvas)]">
      <Sidebar
        user={user}
        mobileOpen={sidebarOpen}
        onMobileClose={() => setSidebarOpen(false)}
        allowedApps={allowedApps}
        permissions={permissions}
        aiFeatures={aiFeatures}
        orgId={activeCompanyId}
      />
      {sidebarOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-black/40 transition-opacity duration-300 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar
          onMenuClick={() => setSidebarOpen(true)}
          companies={companies}
          activeCompanyId={activeCompanyId}
          allowedApps={allowedApps}
          permissions={permissions}
          aiFeatures={aiFeatures}
        />
        <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">
          <div className="mx-auto w-full max-w-[1320px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
