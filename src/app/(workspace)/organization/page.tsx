import Link from "next/link";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { OrganizationsList } from "@/features/platform/components/organizations-list";
import { ToastProvider } from "@/shared/components/ui/toast";
import { ThemeToggle } from "@/shared/components/theme-toggle";
import { getPageOrgAccess } from "@/server/platform/access";
import { listMyOrganizations } from "@/server/platform/organization.service";
import { ACTIVE_COMPANY_COOKIE } from "@/server/tenant/context";

export const metadata: Metadata = { title: "Your organizations" };

export default async function OrganizationsPage() {
  const access = await getPageOrgAccess();
  const cookieId = (await cookies()).get(ACTIVE_COMPANY_COOKIE)?.value ?? "";
  const organizations = await listMyOrganizations(access.ctx.db, access.ctx.userId, cookieId || access.organization.id);

  return (
    <ToastProvider>
      <div className="min-h-[100dvh] bg-[var(--color-bg-canvas)]">
        <header className="sticky top-0 z-30 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-canvas)]/90 backdrop-blur">
          <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center justify-between px-4 sm:px-6">
            <Link href="/anops" className="inline-flex min-h-[44px] items-center text-sm font-semibold text-[var(--color-text-primary)] hover:underline">
              ← AnOps home
            </Link>
            <ThemeToggle />
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1200px] px-4 pb-16 pt-8 sm:px-6 sm:pt-12">
          <OrganizationsList organizations={organizations} />
        </main>
      </div>
    </ToastProvider>
  );
}
