import Link from "next/link";
import type { Metadata } from "next";
import { ProfileForms } from "@/features/platform/components/profile-forms";
import { ToastProvider } from "@/shared/components/ui/toast";
import { ThemeToggle } from "@/shared/components/theme-toggle";
import { getPageOrgAccess } from "@/server/platform/access";
import { getUserProfile } from "@/server/platform/profile.service";
import { getUserCompanies } from "@/server/services/company.service";

export const metadata: Metadata = { title: "Your profile" };

export default async function ProfilePage() {
  const access = await getPageOrgAccess();
  const [profile, organizations] = await Promise.all([getUserProfile(access.ctx.db, access.ctx.userId), getUserCompanies(access.ctx.userId.toHexString())]);
  const initials = `${profile.firstName[0] ?? ""}${profile.lastName[0] ?? ""}`.toUpperCase() || "A";

  return (
    <ToastProvider>
      <div className="min-h-[100dvh] bg-[var(--color-bg-canvas)]">
        <header className="sticky top-0 z-30 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-canvas)]/90 backdrop-blur">
          <div className="mx-auto flex h-16 w-full max-w-[960px] items-center justify-between px-4 sm:px-6">
            <Link href="/anops" className="inline-flex min-h-[44px] items-center text-sm font-semibold text-[var(--color-text-primary)] hover:underline">
              ← AnOps home
            </Link>
            <ThemeToggle />
          </div>
        </header>
        <main className="mx-auto w-full max-w-[960px] px-4 pb-16 pt-6 sm:px-6 sm:pt-10">
          <section className="relative overflow-hidden rounded-[24px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 sm:p-7" aria-label="Your profile">
            <div aria-hidden="true" className="portal-grid pointer-events-none absolute inset-0 opacity-70 [mask-image:radial-gradient(ellipse_at_top_right,black,transparent_70%)]" />
            <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[var(--color-action-primary)] opacity-[0.14] blur-3xl" />
            <div className="relative grid gap-5 sm:grid-cols-[1fr_260px] sm:items-center">
              <div className="flex min-w-0 items-center gap-4 sm:gap-5">
                <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[var(--color-action-primary)] font-[family-name:var(--font-heading)] text-2xl font-bold text-[#111F1D] shadow-[0_14px_30px_-14px_var(--color-action-primary)] sm:h-20 sm:w-20 sm:text-3xl">
                  {initials}
                </span>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-text-secondary)]">Your profile</p>
                  <h1 className="mt-0.5 break-words font-[family-name:var(--font-heading)] text-[26px] leading-[1.1] tracking-[-0.035em] text-[var(--color-text-primary)] sm:text-[34px]">
                    {profile.firstName} {profile.lastName}
                  </h1>
                  <p className="mt-1 truncate text-sm text-[var(--color-text-secondary)]">{profile.jobTitle ?? "No position set"}</p>
                </div>
              </div>
              <div className="rounded-[16px] bg-[var(--color-bg-subtle)] p-4">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-[var(--color-text-secondary)]">Profile completion</span>
                  <span className="font-semibold tabular-nums text-[var(--color-text-primary)]">{profile.completion.percent}%</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--color-bg-surface)]" role="progressbar" aria-valuenow={profile.completion.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Profile completion">
                  <div className="h-full rounded-full bg-[var(--color-action-primary)] transition-[width] duration-700" style={{ width: `${profile.completion.percent}%` }} />
                </div>
                {profile.completion.missing.length > 0 ? (
                  <p className="mt-2 text-xs leading-relaxed text-[var(--color-text-secondary)]">Missing: {profile.completion.missing.map((m) => m.label.toLowerCase()).join(", ")}.</p>
                ) : (
                  <p className="mt-2 text-xs text-[var(--color-text-secondary)]">Your profile is complete.</p>
                )}
              </div>
            </div>
            <p className="relative mt-4 flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-secondary)]">
              <span className="rounded-full border border-[var(--color-border-subtle)] px-3 py-1">
                Active in <strong className="font-semibold text-[var(--color-text-primary)]">{access.organization.name}</strong>
              </span>
              <span className="rounded-full border border-[var(--color-border-subtle)] px-3 py-1 capitalize">{access.companyRole}</span>
            </p>
          </section>

          <div className="mt-6">
            <ProfileForms profile={profile} />
          </div>

          <section className="mt-6 rounded-[22px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 sm:p-6" aria-labelledby="orgs-title">
            <h2 id="orgs-title" className="text-base font-semibold text-[var(--color-text-primary)]">
              Your organizations
            </h2>
            <ul className="mt-4 divide-y divide-[var(--color-border-subtle)]">
              {organizations.map((org) => (
                <li key={org.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <span className="font-medium text-[var(--color-text-primary)]">
                    {org.name}
                    {org.id === access.organization.id && <span className="ml-2 rounded-full bg-[var(--color-bg-subtle)] px-2 py-0.5 text-[11px] text-[var(--color-text-secondary)]">Active</span>}
                  </span>
                  <Link href={`/organization/${org.id}`} className="font-semibold text-[var(--color-text-primary)] underline underline-offset-4">
                    Open
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </main>
      </div>
    </ToastProvider>
  );
}
