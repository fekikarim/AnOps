import Link from "next/link";
import type { Metadata } from "next";
import { AnimatedIcon } from "@/shared/components/portal/animated-icon";
import { getPageOrganization, isOrgManager } from "@/server/platform/access";
import { resolveAiAccess } from "@/server/ai/access/access.service";

export const metadata: Metadata = { title: "Organization settings" };

type Section = { id: string; title: string; body: string; icon: string; href: string; cta: string; managerOnly?: boolean; status?: string };

export default async function OrganizationSettingsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const access = await getPageOrganization(orgId);
  const manager = isOrgManager(access);
  const base = `/organization/${orgId}`;
  const ai = await resolveAiAccess(access.ctx);
  const aiStatus = {
    ready: "On for you",
    platform_disabled: "Paused platform-wide",
    plan_excluded: "Not in your plan",
    company_disabled: "Off for the organization",
    not_granted: "Not granted to you",
    inactive: "Inactive",
  }[ai.state];

  const sections: Section[] = [
    { id: "organizations", title: "Your organizations", body: "Switch between organizations or create a new one. Each has its own members, plan and data.", icon: "wired-lineal-3308-building-office-in-reveal.webp", href: "/organization", cta: "All organizations" },
    { id: "profile", title: "Organization profile", body: "Name, website, industry, size, address and contact details.", icon: "wired-lineal-3308-building-office-in-reveal.webp", href: `${base}#profile`, cta: manager ? "Edit profile" : "View profile" },
    { id: "brand", title: "Brand identity", body: "Create the organization logo with AI, edit it, and apply it across AnOps.", icon: "wired-lineal-1027-marketing-hover-pinch.webp", href: `${base}/settings/brand`, cta: "Open logo studio", managerOnly: true },
    { id: "regional", title: "Regional settings & currency", body: `Preferred currency: ${access.organization.currency}. Used by Finance, reports and default billing currency.`, icon: "wired-lineal-1863-renewables-hover-pinch.webp", href: `${base}#profile`, cta: "Change currency", managerOnly: true },
    { id: "security", title: "Security", body: "Your password and sign-in settings. Permissions are enforced on the server for every request.", icon: "wired-lineal-1004-avatars-settings-hover-smooth.webp", href: "/profile#security", cta: "Security settings" },
    { id: "members", title: "Members & roles", body: "Invite people, assign roles, suspend or remove access.", icon: "wired-lineal-957-avatars-team-work-hover-pinch.webp", href: `${base}/members`, cta: "Manage members" },
    { id: "apps", title: "Application access", body: `${access.entitlements.appIds.length} application${access.entitlements.appIds.length === 1 ? "" : "s"} in your plan. Limit individual members from the Members page.`, icon: "wired-lineal-12-layers-hover-slide.webp", href: `${base}/members`, cta: "Set access", managerOnly: true },
    { id: "ai", title: "AI permissions", body: "Turn AI on for the organization, then grant it per member, module and operation.", icon: "wired-lineal-256x256-ai-chip-hover-pinch.webp", href: access.entitlements.aiFeatures ? "/ai/access" : `${base}/billing`, cta: access.entitlements.aiFeatures ? "AI access and limits" : "See plans with AI", status: aiStatus, managerOnly: true },
    { id: "integrations", title: "Integrations", body: "Email, SMS, Telegram and Facebook for Marketing; Telegram receipts for Finance.", icon: "wired-lineal-963-multichannel-hover-pinch.webp", href: "/marketing/integrations", cta: "Open integrations", managerOnly: true },
    { id: "notifications", title: "Notifications", body: "Choose which product and billing emails you receive. Security emails are always sent.", icon: "wired-lineal-3094-mail-open-marketing-hover-pinch.webp", href: "/profile#notifications", cta: "Notification preferences" },
    { id: "audit", title: "Audit logs", body: "Every sensitive change: who did it and when.", icon: "wired-lineal-728-notebook-pen-hover-pinch.webp", href: `${base}/audit`, cta: "View audit log", managerOnly: true },
    { id: "billing", title: "Subscription & billing", body: "Plan, trial, invoices, payment method and cancellation.", icon: "wired-lineal-799-credit-card-hover-pinch.webp", href: `${base}/billing`, cta: "Open billing" },
  ];

  return (
    <div>
      <p className="mb-5 text-sm text-[var(--color-text-secondary)]">Organization-level settings. Your personal settings live in your <Link href="/profile" className="font-semibold text-[var(--color-text-primary)] underline">profile</Link>.</p>
      <ul className="grid gap-4 sm:grid-cols-2">
        {sections
          .filter((section) => manager || !section.managerOnly)
          .map((section) => (
            <li key={section.id} id={section.id}>
              <Link href={section.href} className="group flex h-full gap-4 rounded-[20px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 transition-colors hover:border-[var(--color-border-control)]">
                <AnimatedIcon icon={section.icon} size={48} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2 text-base font-semibold text-[var(--color-text-primary)]">
                    {section.title}
                    {section.status && <span className="rounded-full bg-[var(--color-bg-subtle)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-text-secondary)]">{section.status}</span>}
                  </span>
                  <span className="mt-1 block text-sm leading-relaxed text-[var(--color-text-secondary)]">{section.body}</span>
                  <span className="mt-3 inline-block text-sm font-semibold text-[var(--color-text-primary)] underline decoration-[var(--color-border-control)] underline-offset-4 group-hover:decoration-[var(--color-text-primary)]">{section.cta}</span>
                </span>
              </Link>
            </li>
          ))}
      </ul>
    </div>
  );
}
