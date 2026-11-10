import Link from "next/link";
import type { Metadata } from "next";
import { OrgProfileForm } from "@/features/platform/components/org-profile-form";
import { AnimatedIcon } from "@/shared/components/portal/animated-icon";
import { getPageOrganization, isOrgManager } from "@/server/platform/access";
import { getOrganizationProfile, getOrganizationStats } from "@/server/platform/organization.service";
import { getApplication } from "@/shared/domain/applications";

export const metadata: Metadata = { title: "Organization" };

const card = "rounded-[22px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 sm:p-6";
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—");

export default async function OrganizationOverviewPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const access = await getPageOrganization(orgId);
  const profile = await getOrganizationProfile(access);
  const hr = access.entitlements.appIds.includes("hr-payroll") ? await getOrganizationStats(access) : null;
  const manager = isOrgManager(access);

  const stats = [
    { label: "Members", value: String(profile.membersCount), href: `/organization/${orgId}/members` },
    { label: "Pending invitations", value: String(profile.pendingInvitations), href: `/organization/${orgId}/members` },
    { label: "Applications", value: String(access.entitlements.appIds.length), href: `/organization/${orgId}/billing` },
    { label: "Created", value: date(profile.createdAt), href: null },
    ...(hr
      ? [
          { label: "Staff directory", value: String(hr.staff), href: "/hr" },
          { label: "Departments", value: String(hr.departments), href: "/hr" },
          { label: "Job titles", value: String(hr.jobTitles), href: "/hr" },
        ]
      : []),
  ];

  return (
    <div className="space-y-6">
      <ul className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {stats.map((stat) => (
          <li key={stat.label} className={`${card} min-w-0 !p-4 sm:!p-5`}>
            <p className="text-xs text-[var(--color-text-secondary)]">{stat.label}</p>
            {stat.href ? (
              <Link href={stat.href} className="mt-1 block truncate font-[family-name:var(--font-heading)] text-[28px] font-semibold tracking-[-0.03em] text-[var(--color-text-primary)] hover:underline">
                {stat.value}
              </Link>
            ) : (
              <p className="mt-2 truncate font-[family-name:var(--font-heading)] text-lg font-semibold leading-8 text-[var(--color-text-primary)]">{stat.value}</p>
            )}
          </li>
        ))}
      </ul>

      <section className={card} aria-labelledby="status-title">
        <h2 id="status-title" className="text-base font-semibold text-[var(--color-text-primary)]">
          Status
        </h2>
        <dl className="mt-4 grid gap-5 text-sm sm:grid-cols-2 xl:grid-cols-4">
          <div>
            <dt className="text-[var(--color-text-secondary)]">Organization slug</dt>
            <dd className="mt-1 break-all font-mono text-[13px] font-semibold text-[var(--color-text-primary)]">{profile.slug}</dd>
          </div>
          <div>
            <dt className="text-[var(--color-text-secondary)]">Activation</dt>
            <dd className="mt-1 font-semibold text-[var(--color-text-primary)]">{profile.activationStatus === "pending" ? "Awaiting email confirmation" : `Active${profile.activatedAt ? ` since ${date(profile.activatedAt)}` : ""}`}</dd>
          </div>
          <div>
            <dt className="text-[var(--color-text-secondary)]">Account status</dt>
            <dd className="mt-1 font-semibold text-[var(--color-text-primary)]">{access.entitlements.needsPlanSelection ? (
                <Link href={`/organization/${orgId}/billing`} className="underline underline-offset-4">
                  Plan required · choose one
                </Link>
              ) : (
                "In good standing"
              )}</dd>
          </div>
          <div>
            <dt className="text-[var(--color-text-secondary)]">Applications</dt>
            <dd className="mt-2 flex flex-wrap gap-1.5">
              {access.entitlements.appIds.length === 0 && <span className="text-[var(--color-text-secondary)]">None</span>}
              {access.entitlements.appIds.map((id) => (
                <span key={id} title={getApplication(id).name}>
                  <AnimatedIcon icon={getApplication(id).icon} size={28} play="never" />
                </span>
              ))}
            </dd>
          </div>
        </dl>
      </section>

      <section id="profile" className={`${card} scroll-mt-24`} aria-labelledby="profile-title">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 id="profile-title" className="text-base font-semibold text-[var(--color-text-primary)]">
              Organization profile
            </h2>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Optional details help AnOps tailor defaults, guides and documents. Nothing here blocks your work.</p>
          </div>
          <div className="w-full rounded-[14px] bg-[var(--color-bg-subtle)] p-3.5 sm:max-w-[240px]">
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-[var(--color-text-secondary)]">Completion</span>
              <span className="font-semibold text-[var(--color-text-primary)]">{profile.completion.percent}%</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--color-bg-subtle)]" role="progressbar" aria-valuenow={profile.completion.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Organization profile completion">
              <div className="h-full rounded-full bg-[var(--color-action-primary)] transition-[width] duration-700" style={{ width: `${profile.completion.percent}%` }} />
            </div>
          </div>
        </div>
        {profile.completion.missing.length > 0 && (
          <ul className="mt-5 grid gap-2 sm:grid-cols-2">
            {profile.completion.missing.map((item) => (
              <li key={item.key} className="rounded-[12px] bg-[var(--color-bg-subtle)] px-3 py-2 text-sm">
                <span className="font-semibold text-[var(--color-text-primary)]">{item.label}</span>
                <span className="block text-xs text-[var(--color-text-secondary)]">{item.why}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-6 border-t border-[var(--color-border-subtle)] pt-6">
          <OrgProfileForm orgId={orgId} profile={profile} canEdit={manager} />
        </div>
      </section>
    </div>
  );
}
