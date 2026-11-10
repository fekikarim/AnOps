"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { switchCompanyAction } from "@/features/company/actions/company.action";

/** Shown when the organization being managed is not the one the applications currently work in. */
export function ActivateOrgBanner({ orgId, orgName }: { orgId: string; orgName: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div role="status" className="mt-4 flex flex-col gap-3 rounded-[16px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 sm:flex-row sm:items-center">
      <p className="flex-1 text-sm text-[var(--color-text-secondary)]">
        You are managing <strong className="text-[var(--color-text-primary)]">{orgName}</strong>, but your applications currently work in another organization.
      </p>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await switchCompanyAction(orgId);
            if (result.success) router.refresh();
          })
        }
        className="inline-flex min-h-[44px] items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-action-primary)] px-5 text-sm font-semibold text-[#111F1D] hover:bg-[var(--color-action-hover)] disabled:opacity-70"
      >
        {pending ? "Switching…" : "Use this organization in apps"}
      </button>
    </div>
  );
}
