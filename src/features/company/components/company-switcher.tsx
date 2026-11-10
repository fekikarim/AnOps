"use client";

import Link from "next/link";
import { useState, useTransition, useRef, useEffect } from "react";
import { Building2, ChevronsUpDown, Check, Plus, Loader2, Settings } from "lucide-react";
import type { Company } from "@/features/company/types";
import { switchCompanyAction } from "@/features/company/actions/company.action";
import { useRouter } from "next/navigation";
import { CreateCompanyModal } from "@/features/company/components/create-company-modal";

type CompanySwitcherProps = {
  companies: Company[];
  activeCompanyId: string;
};

export function CompanySwitcher({ companies, activeCompanyId }: CompanySwitcherProps) {
  const [open, setOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const activeCompany = companies.find((c) => c.id === activeCompanyId) || companies[0];

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelectCompany = (companyId: string) => {
    if (companyId === activeCompanyId) {
      setOpen(false);
      return;
    }

    startTransition(async () => {
      const result = await switchCompanyAction(companyId);
      if (result.success) {
        setOpen(false);
        router.refresh();
      }
    });
  };

  return (
    <>
      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          disabled={isPending}
          className="flex min-h-[40px] items-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-2.5 py-1.5 text-xs font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-bg-subtle)] focus:outline-none focus:ring-[2px] focus:ring-[var(--color-focus-ring)] transition-colors"
          title="Switch Company"
        >
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-action-primary)]/10 text-[var(--color-action-primary)]">
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Building2 className="h-3.5 w-3.5" />}
          </div>
          <span className="max-w-[130px] sm:max-w-[180px] truncate">
            {activeCompany?.name || "Select Company"}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-secondary)]" />
        </button>

        {open && (
          <div className="absolute left-0 mt-2 z-50 w-64 rounded-[var(--radius-card)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] p-1.5 shadow-[0_10px_25px_rgba(0,0,0,0.12)] animate-in fade-in zoom-in-95 duration-150">
            <div className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
              Organizations ({companies.length})
            </div>

            <div className="max-h-56 overflow-y-auto space-y-0.5">
              {companies.map((company) => {
                const isSelected = company.id === activeCompany?.id;
                return (
                  <button
                    key={company.id}
                    type="button"
                    onClick={() => handleSelectCompany(company.id)}
                    className={`flex w-full items-center justify-between gap-2 rounded-[var(--radius-control)] px-2.5 py-2 text-left text-xs transition-colors ${
                      isSelected
                        ? "bg-[var(--color-action-primary)]/10 text-[var(--color-action-primary)] font-semibold"
                        : "text-[var(--color-text-primary)] hover:bg-[var(--color-bg-subtle)]"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Building2 className="h-3.5 w-3.5 shrink-0 opacity-70" />
                      <span className="truncate">{company.name}</span>
                    </div>
                    {isSelected && <Check className="h-3.5 w-3.5 shrink-0" />}
                  </button>
                );
              })}
            </div>

            <div className="my-1 border-t border-[var(--color-border-subtle)]" />

            <Link
              href={`/organization/${activeCompany?.id ?? ""}`}
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-2 rounded-[var(--radius-control)] px-2.5 py-2 text-left text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              <Settings className="h-3.5 w-3.5 shrink-0" />
              <span>Manage Organization</span>
            </Link>

            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setCreateModalOpen(true);
              }}
              className="flex w-full items-center gap-2 rounded-[var(--radius-control)] px-2.5 py-2 text-left text-xs font-semibold text-[var(--color-action-primary)] hover:bg-[var(--color-action-primary)]/10 transition-colors"
            >
              <Plus className="h-3.5 w-3.5 shrink-0" />
              <span>Create New Company</span>
            </button>
          </div>
        )}
      </div>

      {createModalOpen && (
        <CreateCompanyModal
          isOpen={createModalOpen}
          onClose={() => setCreateModalOpen(false)}
        />
      )}
    </>
  );
}
