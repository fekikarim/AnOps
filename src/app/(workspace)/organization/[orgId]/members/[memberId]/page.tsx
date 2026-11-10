import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AnimatedIcon } from "@/shared/components/portal/animated-icon";
import { getPageOrganization, isOrgManager } from "@/server/platform/access";
import { listMembers } from "@/server/platform/organization.service";
import { getApplication } from "@/shared/domain/applications";
import { effectiveApps } from "@/shared/domain/plans";

export const metadata: Metadata = { title: "Member profile" };

const ROLE_LABEL = { owner: "Owner", admin: "Administrator", manager: "Manager", employee: "Employee" } as const;
const ROLE_SCOPE = {
  owner: "Full control, including organization settings, billing and members.",
  admin: "Full control of organization data, approvals and members (except administrators).",
  manager: "Runs day-to-day operations: staff, attendance, stock, receipts and production.",
  employee: "Read-only access to organization data.",
} as const;

export default async function MemberProfilePage({ params }: { params: Promise<{ orgId: string; memberId: string }> }) {
  const { orgId, memberId } = await params;
  const access = await getPageOrganization(orgId);
  const member = (await listMembers(access)).find((m) => m.id === memberId);
  // Employees and managers can open their own profile only; owners and administrators can open everyone's.
  if (!member || (!isOrgManager(access) && !member.isSelf)) notFound();
  const apps = effectiveApps(access.entitlements, { companyRole: member.role, appAccess: member.appAccess });
  const card = "rounded-[20px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 sm:p-6";

  return (
    <div className="space-y-6">
      <Link href={`/organization/${orgId}/members`} className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:underline">
        ← All members
      </Link>
      <section className={card}>
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--color-action-primary)] text-xl font-bold text-[#111F1D]">
            {member.name
              .split(" ")
              .slice(0, 2)
              .map((p) => p[0])
              .join("")
              .toUpperCase()}
          </span>
          <div>
            <h2 className="font-[family-name:var(--font-heading)] text-2xl font-semibold tracking-[-0.03em] text-[var(--color-text-primary)]">{member.name}</h2>
            <p className="text-sm text-[var(--color-text-secondary)]">{member.jobTitle ?? "No position set"}</p>
          </div>
          {member.isSelf && (
            <Link href="/profile" className="ml-auto inline-flex min-h-[40px] items-center rounded-[8px] border border-[var(--color-border-control)] px-4 text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-bg-subtle)]">
              Edit my profile
            </Link>
          )}
        </div>
        <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {[
            ["Email", member.email],
            ["Phone", member.phone ?? "—"],
            ["Account status", `${member.status === "suspended" ? "Suspended" : "Active"} · ${member.emailVerified ? "email confirmed" : "email unconfirmed"}`],
            ["Joined", member.joinedAt ? new Date(member.joinedAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : "—"],
            ["Role", ROLE_LABEL[member.role]],
            ["AI access", member.aiEnabled ? "Granted" : "Not granted"],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-[var(--color-text-secondary)]">{k}</dt>
              <dd className="mt-1 font-semibold text-[var(--color-text-primary)]">{v}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className={card}>
        <h3 className="text-base font-semibold text-[var(--color-text-primary)]">Role and permissions</h3>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{ROLE_SCOPE[member.role]}</p>
      </section>
      <section className={card}>
        <h3 className="text-base font-semibold text-[var(--color-text-primary)]">Application access</h3>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{member.appAccess ? "Limited by an administrator." : "Every application in the organization's plan."}</p>
        <ul className="mt-4 flex flex-wrap gap-3">
          {apps.length === 0 && <li className="text-sm text-[var(--color-text-secondary)]">No application available right now.</li>}
          {apps.map((id) => (
            <li key={id} className="flex items-center gap-2 rounded-full border border-[var(--color-border-subtle)] py-1 pl-1 pr-3 text-sm text-[var(--color-text-primary)]">
              <AnimatedIcon icon={getApplication(id).icon} size={28} play="never" />
              {getApplication(id).name}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
