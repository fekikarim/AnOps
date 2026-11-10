"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { switchCompanyAction } from "@/features/company/actions/company.action";
import { CreateCompanyModal } from "@/features/company/components/create-company-modal";
import type { MyOrganization } from "@/server/platform/organization.service";
import { OrgAvatar } from "@/shared/components/ui/org-avatar";
import { cn } from "@/shared/lib/utils";

/** All organizations of the signed-in person: open management, make one the active workspace, or create a new one. */
export function OrganizationsList({ organizations }: { organizations: MyOrganization[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, start] = useTransition();

  const activateInApps = (id: string) => {
    setPendingId(id);
    start(async () => {
      const result = await switchCompanyAction(id);
      setPendingId(null);
      if (result.success) router.refresh();
    });
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-text-secondary)]">Multi-organization</p>
          <h1 className="mt-1 font-[family-name:var(--font-heading)] text-[28px] leading-tight tracking-[-0.035em] text-[var(--color-text-primary)] sm:text-[36px]">Your organizations</h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--color-text-secondary)]">
            Each organization is a separate workspace with its own members, plan, applications and data. Switch between them at any time.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-[var(--color-action-primary)] px-6 text-sm font-semibold text-[#111F1D] transition-colors hover:bg-[var(--color-action-hover)] sm:w-auto"
        >
          <span aria-hidden="true" className="text-lg leading-none">+</span> New organization
        </button>
      </div>

      <ul className="mt-8 grid gap-4 md:grid-cols-2">
        {organizations.map((org, index) => (
          <li key={org.id} className="motion-safe:animate-[anops-rise_450ms_var(--ease-out)_both]" style={{ animationDelay: `${index * 50}ms` }}>
            <article
              className={cn(
                "flex h-full flex-col rounded-[22px] border bg-[var(--color-bg-surface)] p-5 transition-[border-color,box-shadow] duration-300",
                org.active ? "border-[var(--color-text-primary)] shadow-[0_20px_40px_-30px_rgba(17,31,29,0.7)]" : "border-[var(--color-border-subtle)] hover:border-[var(--color-border-control)]"
              )}
            >
              <div className="flex items-start gap-4">
                <OrgAvatar name={org.name} logoUrl={org.logoUrl} className="h-14 w-14 items-center justify-center rounded-[16px] bg-[var(--color-action-primary)] font-[family-name:var(--font-heading)] text-xl font-bold text-[#111F1D]" />
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-lg font-semibold tracking-[-0.02em] text-[var(--color-text-primary)]">{org.name}</h2>
                  <p className="truncate text-xs text-[var(--color-text-secondary)]">
                    <span className="font-mono">{org.slug}</span> · {org.currency}
                  </p>
                </div>
                {org.active && <span className="shrink-0 rounded-full bg-[var(--color-text-primary)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-bg-canvas)]">Active</span>}
              </div>
              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                <span className="rounded-full border border-[var(--color-border-subtle)] px-3 py-1 font-medium capitalize text-[var(--color-text-secondary)]">{org.role}</span>
                <span className="rounded-full bg-[var(--color-bg-subtle)] px-3 py-1 font-medium text-[var(--color-text-primary)]">{org.plan}</span>
                <span className="rounded-full bg-[var(--color-bg-subtle)] px-3 py-1 text-[var(--color-text-secondary)]">
                  {org.appCount} app{org.appCount === 1 ? "" : "s"}
                </span>
                {org.pendingActivation && <span className="rounded-full bg-[var(--color-status-warning-bg)] px-3 py-1 font-semibold text-[var(--color-status-warning)]">Awaiting activation</span>}
              </div>
              <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                <Link href={`/organization/${org.id}`} className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-[var(--radius-control)] border border-[var(--color-border-control)] px-4 text-sm font-semibold text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-bg-subtle)]">
                  Manage
                </Link>
                {org.active ? (
                  <Link href="/anops" className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-action-primary)] px-4 text-sm font-semibold text-[#111F1D] hover:bg-[var(--color-action-hover)]">
                    Open workspace
                  </Link>
                ) : (
                  <button
                    type="button"
                    disabled={pendingId === org.id}
                    onClick={() => activateInApps(org.id)}
                    className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-text-primary)] px-4 text-sm font-semibold text-[var(--color-bg-canvas)] transition-opacity hover:opacity-90 disabled:opacity-60"
                  >
                    {pendingId === org.id ? "Switching…" : "Use in apps"}
                  </button>
                )}
              </div>
            </article>
          </li>
        ))}
      </ul>

      {creating && <CreateCompanyModal isOpen onClose={() => setCreating(false)} onSuccess={(company) => router.push(`/organization/${company.id}`)} />}
    </div>
  );
}
