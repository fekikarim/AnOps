"use client";

import { useState, useTransition } from "react";
import { X, Loader2, Building2 } from "lucide-react";
import { Portal } from "@/shared/components/ui/portal";
import { useScrollLock } from "@/shared/hooks/use-scroll-lock";
import { createCompanyAction } from "@/features/company/actions/company.action";
import { useRouter } from "next/navigation";
import type { Company } from "@/features/company/types";

type CreateCompanyModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (company: Company) => void;
};

const INDUSTRIES = [
  "Information Technology",
  "Software & SaaS",
  "Manufacturing & Production",
  "Retail & E-commerce",
  "Finance & Accounting",
  "Healthcare & Pharma",
  "Consulting & Professional Services",
  "Education & Training",
  "Construction & Real Estate",
  "Other",
];

const CURRENCIES = [
  { code: "TND", label: "TND — Tunisian Dinar" },
  { code: "USD", label: "USD — US Dollar" },
  { code: "EUR", label: "EUR — Euro" },
  { code: "GBP", label: "GBP — British Pound" },
];

export function CreateCompanyModal({ isOpen, onClose, onSuccess }: CreateCompanyModalProps) {
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState(INDUSTRIES[0]);
  const [currency, setCurrency] = useState("TND");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  useScrollLock(isOpen);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Organization name is required.");
      return;
    }

    setError(null);
    startTransition(async () => {
      const result = await createCompanyAction({ name, industry, currency });
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.data) onSuccess?.(result.data);
      onClose();
      router.refresh();
    });
  };

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex flex-col justify-end sm:justify-center sm:items-center overflow-hidden p-0 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
        <div
          className="relative w-full sm:max-w-md max-h-[92dvh] sm:max-h-[88vh] flex flex-col rounded-t-[var(--radius-card)] sm:rounded-[var(--radius-card)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] p-5 sm:p-6 shadow-[0_20px_50px_rgba(0,0,0,0.2)] animate-in slide-in-from-bottom-5 duration-200"
          role="dialog"
          aria-modal="true"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] pb-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-action-primary)]/10 text-[var(--color-action-primary)]">
                <Building2 className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-[var(--color-text-primary)]">Create New Company</h2>
                <p className="text-xs text-[var(--color-text-secondary)]">Set up an organization tenant</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] items-center justify-center rounded-[var(--radius-control)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text-primary)] transition-colors"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4 pt-4">
            {error && (
              <div className="rounded-[var(--radius-control)] border border-[var(--color-status-danger)]/30 bg-[var(--color-status-danger)]/10 p-3 text-xs text-[var(--color-status-danger)]">
                {error}
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-[var(--color-text-primary)] mb-1">
                Company Name <span className="text-[var(--color-status-danger)]">*</span>
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Acme Corporation"
                className="w-full h-10 px-3 rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:ring-[2px] focus:ring-[var(--color-focus-ring)]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[var(--color-text-primary)] mb-1">
                Industry
              </label>
              <select
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                className="w-full h-10 px-3 rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-[2px] focus:ring-[var(--color-focus-ring)]"
              >
                {INDUSTRIES.map((ind) => (
                  <option key={ind} value={ind}>
                    {ind}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[var(--color-text-primary)] mb-1">
                Base Currency
              </label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full h-10 px-3 rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-[2px] focus:ring-[var(--color-focus-ring)]"
              >
                {CURRENCIES.map((curr) => (
                  <option key={curr.code} value={curr.code}>
                    {curr.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--color-border-subtle)]">
              <button
                type="button"
                onClick={onClose}
                className="flex min-h-[44px] sm:min-h-[38px] px-4 items-center justify-center rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] text-xs font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-bg-subtle)]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="flex min-h-[44px] sm:min-h-[38px] px-5 items-center justify-center gap-2 rounded-[var(--radius-control)] bg-[var(--color-action-primary)] text-xs font-bold text-[var(--color-action-on-primary)] hover:bg-[var(--color-action-hover)] disabled:opacity-50"
              >
                {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>Create Organization</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </Portal>
  );
}
