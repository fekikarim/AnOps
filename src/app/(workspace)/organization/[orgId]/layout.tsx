import Link from "next/link";
import { OrgNav } from "@/features/platform/components/org-nav";
import { ToastProvider } from "@/shared/components/ui/toast";
import { ThemeToggle } from "@/shared/components/theme-toggle";
import { cookies } from "next/headers";
import { OrgAvatar } from "@/shared/components/ui/org-avatar";
import { OrgSwitcher } from "@/features/platform/components/org-switcher";
import { ActivateOrgBanner } from "@/features/platform/components/activate-org-banner";
import { listMyOrganizations } from "@/server/platform/organization.service";
import { ACTIVE_COMPANY_COOKIE } from "@/server/tenant/context";
import { getPageOrganization, isOrgManager } from "@/server/platform/access";
import { PLANS } from "@/shared/domain/plans";

export default async function OrganizationLayout({ children, params }: { children: React.ReactNode; params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const access = await getPageOrganization(orgId);
  const cookieId = (await cookies()).get(ACTIVE_COMPANY_COOKIE)?.value;
  const organizations = await listMyOrganizations(access.ctx.db, access.ctx.userId, cookieId ?? "");
  // The applications follow the active-organization cookie (or the first organization when it is unset).
  const activeId = organizations.find((org) => org.id === cookieId)?.id ?? organizations[0]?.id;
  const ent = access.entitlements;
  const plan = ent.kind === "trial" ? `Trial · ${ent.trialDaysLeft}d left` : ent.kind === "legacy" ? "Full access" : ent.plan ? PLANS[ent.plan].name : ent.kind === "trial_expired" ? "Trial ended" : "No active plan";

  return (
    <ToastProvider>
      <div className="min-h-[100dvh] bg-[var(--color-bg-canvas)]">
        <header className="sticky top-0 z-30 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-canvas)]/90 backdrop-blur">
          <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center justify-between gap-3 px-4 sm:px-6">
            <Link href="/anops" className="inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)] hover:underline">
              <span aria-hidden="true">←</span>
              <span className="hidden sm:inline">AnOps home</span>
              <span className="sr-only sm:hidden">AnOps home</span>
            </Link>
            <div className="flex min-w-0 items-center gap-2">
              <OrgSwitcher organizations={organizations} currentId={orgId} />
              <ThemeToggle />
            </div>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-[1200px] px-4 pb-16 pt-6 sm:px-6 sm:pt-10">
          {activeId && activeId !== orgId && <div className="mb-5"><ActivateOrgBanner orgId={orgId} orgName={access.organization.name} /></div>}
          {/* Identity */}
          <section className="relative overflow-hidden rounded-[24px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 sm:p-7" aria-label="Organization">
            <div aria-hidden="true" className="portal-grid pointer-events-none absolute inset-0 opacity-70 [mask-image:radial-gradient(ellipse_at_top_right,black,transparent_70%)]" />
            <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[var(--color-action-primary)] opacity-[0.14] blur-3xl" />
            <div className="relative flex items-center gap-4 sm:gap-5">
              <OrgAvatar name={access.organization.name} logoUrl={access.organization.logoUrl} className="h-16 w-16 shrink-0 items-center justify-center rounded-[20px] bg-[var(--color-action-primary)] font-[family-name:var(--font-heading)] text-2xl font-bold text-[#111F1D] shadow-[0_14px_30px_-14px_var(--color-action-primary)] sm:h-20 sm:w-20 sm:text-3xl" />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-text-secondary)]">Organization</p>
                <h1 className="mt-0.5 line-clamp-2 break-words font-[family-name:var(--font-heading)] text-[26px] leading-[1.1] tracking-[-0.035em] text-[var(--color-text-primary)] sm:text-[36px]">
                  {access.organization.name}
                </h1>
              </div>
            </div>
            <div className="relative mt-4 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[var(--color-text-primary)] px-3 py-1 text-xs font-semibold text-[var(--color-bg-canvas)]">{plan}</span>
              {access.organization.activationStatus === "pending" && (
                <span className="rounded-full bg-[var(--color-status-warning-bg)] px-3 py-1 text-xs font-semibold text-[var(--color-status-warning)]">Awaiting activation</span>
              )}
              <span className="rounded-full border border-[var(--color-border-subtle)] px-3 py-1 text-xs font-medium capitalize text-[var(--color-text-secondary)]">You: {access.companyRole}</span>
            </div>
          </section>

          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[230px_minmax(0,1fr)] lg:gap-8">
            <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">
              <OrgNav orgId={orgId} isManager={isOrgManager(access)} />
            </aside>
            <div className="min-w-0">{children}</div>
          </div>
        </main>
      </div>
    </ToastProvider>
  );
}
