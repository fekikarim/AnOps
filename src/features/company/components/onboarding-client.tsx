"use client";

import { useState, useTransition } from "react";
import { Building2, Sparkles, ArrowRight, Loader2 } from "lucide-react";
import { createCompanyAction } from "@/features/company/actions/company.action";
import { useRouter } from "next/navigation";

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

export function OnboardingClient({ userName }: { userName: string }) {
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState(INDUSTRIES[0]);
  const [currency, setCurrency] = useState("TND");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Please provide a company name.");
      return;
    }

    setError(null);
    startTransition(async () => {
      const result = await createCompanyAction({ name, industry, currency });
      if (result.error) {
        setError(result.error);
        return;
      }
      router.push("/hr");
      router.refresh();
    });
  };

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] p-6 sm:p-8 shadow-[0_10px_35px_rgba(0,0,0,0.06)]">
      {/* Brand & Badge */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex h-12 w-12 items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-action-primary)]/10 text-[var(--color-action-primary)]">
          <Building2 className="h-6 w-6" />
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-action-primary)]/10 px-3 py-1 text-xs font-semibold text-[var(--color-action-primary)]">
          <Sparkles className="h-3 w-3" /> Step 1 of 1
        </span>
      </div>

      <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">
        Welcome, {userName}!
      </h1>
      <p className="mt-1.5 text-sm text-[var(--color-text-secondary)] leading-relaxed">
        To get started with AnOps, set up your organization. You&apos;ll be able to invite team members and configure departments right after.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        {error && (
          <div className="rounded-[var(--radius-control)] border border-[var(--color-status-danger)]/30 bg-[var(--color-status-danger)]/10 p-3 text-xs text-[var(--color-status-danger)]">
            {error}
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-[var(--color-text-primary)] mb-1.5">
            Organization / Company Name <span className="text-[var(--color-status-danger)]">*</span>
          </label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Acme Corporation"
            className="w-full h-11 px-3.5 rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:ring-[2px] focus:ring-[var(--color-focus-ring)]"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-[var(--color-text-primary)] mb-1.5">
              Industry Sector
            </label>
            <select
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              className="w-full h-11 px-3 rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-[2px] focus:ring-[var(--color-focus-ring)]"
            >
              {INDUSTRIES.map((ind) => (
                <option key={ind} value={ind}>
                  {ind}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[var(--color-text-primary)] mb-1.5">
              Default Currency
            </label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="w-full h-11 px-3 rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-[2px] focus:ring-[var(--color-focus-ring)]"
            >
              {CURRENCIES.map((curr) => (
                <option key={curr.code} value={curr.code}>
                  {curr.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] p-3 text-xs text-[var(--color-text-secondary)]">
          💡 Default HR departments, predefined roles, and initial policies will be configured automatically for this company.
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="w-full flex min-h-[46px] items-center justify-center gap-2 rounded-[var(--radius-control)] bg-[var(--color-action-primary)] text-sm font-bold text-[var(--color-action-on-primary)] hover:bg-[var(--color-action-hover)] transition-colors disabled:opacity-50 mt-2 shadow-[0_2px_8px_rgba(0,0,0,0.1)]"
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <span>Create Company & Launch AnOps</span>
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>
      </form>
    </div>
  );
}
