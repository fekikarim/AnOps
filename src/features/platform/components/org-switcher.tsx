"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { switchCompanyAction } from "@/features/company/actions/company.action";
import { CreateCompanyModal } from "@/features/company/components/create-company-modal";
import { IconCheck, IconChevronDown } from "@/shared/components/ui/brand-icons";
import { OrgAvatar } from "@/shared/components/ui/org-avatar";
import { cn } from "@/shared/lib/utils";

export type SwitcherOrg = { id: string; name: string; role: string; plan: string; logoUrl?: string | null };

/**
 * Organization switcher (multi-tenancy). Selecting an organization makes it the active workspace on the server
 * (the same cookie the applications use) and opens its management page, so apps and management always agree.
 */
export function OrgSwitcher({ organizations, currentId, className }: { organizations: SwitcherOrg[]; currentId: string; className?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [pending, start] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);
  const current = organizations.find((org) => org.id === currentId) ?? organizations[0];

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const select = (id: string) => {
    if (id === currentId) return setOpen(false);
    start(async () => {
      const result = await switchCompanyAction(id);
      if (result.success) {
        setOpen(false);
        router.push(`/organization/${id}`);
        router.refresh();
      }
    });
  };

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={pending}
        className="flex min-h-[44px] max-w-full items-center gap-2.5 rounded-[14px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] py-1.5 pl-1.5 pr-3 text-left transition-colors hover:border-[var(--color-border-control)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)] disabled:opacity-70"
      >
        <OrgAvatar name={current?.name ?? ""} logoUrl={current?.logoUrl} className="h-8 w-8 rounded-[10px] bg-[var(--color-action-primary)] text-xs font-bold text-[#111F1D]" />
        <span className="min-w-0">
          <span className="block max-w-[150px] truncate text-sm font-semibold text-[var(--color-text-primary)] sm:max-w-[200px]">{current?.name}</span>
          <span className="block text-[11px] text-[var(--color-text-secondary)]">{organizations.length > 1 ? `${organizations.length} organizations` : "Your organization"}</span>
        </span>
        <IconChevronDown size={12} className={cn("shrink-0 text-[var(--color-text-secondary)] transition-transform duration-200", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-[min(320px,calc(100vw-2rem))] rounded-[16px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-2 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.5)] motion-safe:animate-[anops-menu-in_180ms_var(--ease-out)_both]">
          <p className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-secondary)]">Switch organization</p>
          <ul role="listbox" aria-label="Organizations" className="max-h-[50dvh] overflow-y-auto overscroll-contain">
            {organizations.map((org) => (
              <li key={org.id} role="option" aria-selected={org.id === currentId}>
                <button
                  type="button"
                  onClick={() => select(org.id)}
                  className={cn("flex min-h-[48px] w-full items-center gap-3 rounded-[12px] px-2.5 py-2 text-left transition-colors", org.id === currentId ? "bg-[var(--color-bg-subtle)]" : "hover:bg-[var(--color-bg-subtle)]")}
                >
                  <OrgAvatar name={org.name} logoUrl={org.logoUrl} className="h-8 w-8 rounded-[10px] bg-[var(--color-text-primary)] text-xs font-bold text-[var(--color-bg-canvas)]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-[var(--color-text-primary)]">{org.name}</span>
                    <span className="block truncate text-xs text-[var(--color-text-secondary)]">
                      <span className="capitalize">{org.role}</span> · {org.plan}
                    </span>
                  </span>
                  {org.id === currentId && <IconCheck size={13} />}
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-1 border-t border-[var(--color-border-subtle)] pt-1">
            <Link href="/organization" onClick={() => setOpen(false)} className="flex min-h-[44px] items-center rounded-[10px] px-2.5 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-bg-subtle)]">
              All organizations
            </Link>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setCreating(true);
              }}
              className="flex min-h-[44px] w-full items-center rounded-[10px] px-2.5 text-left text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-bg-subtle)]"
            >
              + New organization
            </button>
          </div>
        </div>
      )}

      {creating && <CreateCompanyModal isOpen onClose={() => setCreating(false)} onSuccess={(company) => router.push(`/organization/${company.id}`)} />}
    </div>
  );
}
