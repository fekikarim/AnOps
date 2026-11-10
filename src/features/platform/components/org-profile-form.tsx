"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { updateOrganizationProfileAction } from "@/features/platform/actions/organization.action";
import { BUSINESS_INTERESTS, ORGANIZATION_CURRENCIES, ORGANIZATION_SIZES } from "@/features/platform/schemas";
import type { OrganizationProfileView } from "@/server/platform/organization.service";
import { useToast } from "@/shared/components/ui/toast";
import { cn } from "@/shared/lib/utils";

const INTEREST_LABEL: Record<(typeof BUSINESS_INTERESTS)[number], string> = {
  operations: "Operations & stock",
  finance: "Finance & invoicing",
  people: "People & HR",
  "sales-marketing": "Sales & marketing",
  manufacturing: "Manufacturing",
  "ai-automation": "AI & automation",
};

const field = "mt-1.5 h-12 w-full sm:h-11 rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3 text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-[3px] focus:ring-[var(--color-focus-ring)] disabled:bg-[var(--color-bg-subtle)] disabled:text-[var(--color-text-secondary)]";
const label = "text-sm font-semibold text-[var(--color-text-primary)]";

export function OrgProfileForm({ orgId, profile, canEdit }: { orgId: string; profile: OrganizationProfileView; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = (form: FormData) => {
    const value = (name: string) => String(form.get(name) ?? "");
    start(async () => {
      const result = await updateOrganizationProfileAction(orgId, {
        name: value("name"),
        website: value("website"),
        industry: value("industry"),
        size: value("size") || null,
        primaryInterest: value("primaryInterest") || null,
        country: value("country"),
        address: value("address"),
        contactEmail: value("contactEmail"),
        contactPhone: value("contactPhone"),
        currency: value("currency"),
      });
      if (result.ok) {
        setErrors({});
        toast.success("Organization profile saved");
        router.refresh();
      } else {
        setErrors(result.error.details ?? {});
        toast.fromError(result.error);
      }
    });
  };

  const input = (name: keyof OrganizationProfileView, title: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <label htmlFor={`org-${name}`} className={label}>
        {title}
      </label>
      <input id={`org-${name}`} name={name} defaultValue={(profile[name] as string | null) ?? ""} disabled={!canEdit} className={cn(field, errors[name] && "border-[var(--color-status-error-fg)]")} {...props} />
      {errors[name] && <p className="mt-1 text-xs text-[var(--color-status-error-fg)]">{errors[name]}</p>}
    </div>
  );

  return (
    <form action={submit} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        {input("name", "Organization name", { required: true, maxLength: 80 })}
        {input("website", "Website", { placeholder: "https://", inputMode: "url" })}
        {input("industry", "Industry sector", { placeholder: "e.g. Food distribution", maxLength: 80, list: "industry-suggestions" })}
        <datalist id="industry-suggestions">
          {["Information Technology", "Software & SaaS", "Manufacturing & Production", "Retail & E-commerce", "Finance & Accounting", "Healthcare & Pharma", "Consulting & Professional Services", "Education & Training", "Construction & Real Estate", "Food & Beverage", "Logistics & Distribution"].map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <div>
          <label htmlFor="org-size" className={label}>
            Company size
          </label>
          <select id="org-size" name="size" defaultValue={profile.size ?? ""} disabled={!canEdit} className={field}>
            <option value="">Not specified</option>
            {ORGANIZATION_SIZES.map((size) => (
              <option key={size} value={size}>
                {size} people
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="org-primaryInterest" className={label}>
            Primary business interest
          </label>
          <select id="org-primaryInterest" name="primaryInterest" defaultValue={profile.primaryInterest ?? ""} disabled={!canEdit} className={field}>
            <option value="">Not specified</option>
            {BUSINESS_INTERESTS.map((key) => (
              <option key={key} value={key}>
                {INTEREST_LABEL[key]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="org-currency" className={label}>
            Preferred currency
          </label>
          <select id="org-currency" name="currency" defaultValue={profile.currency} disabled={!canEdit} className={field}>
            {ORGANIZATION_CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </div>
        {input("country", "Country", { maxLength: 80, autoComplete: "country-name" })}
        {input("address", "Address", { maxLength: 240, autoComplete: "street-address" })}
        {input("contactEmail", "Contact email", { type: "email" })}
        {input("contactPhone", "Contact phone", { type: "tel" })}
      </div>
      {canEdit ? (
        <div className="sticky bottom-0 z-10 -mx-5 border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]/95 px-5 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none sm:flex sm:justify-end">
          <button type="submit" disabled={pending} className="inline-flex min-h-[48px] w-full items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-action-primary)] px-6 text-sm font-semibold text-[#111F1D] transition-colors hover:bg-[var(--color-action-hover)] disabled:opacity-70 sm:min-h-[44px] sm:w-auto">
            {pending ? "Saving…" : "Save changes"}
          </button>
        </div>
      ) : (
        <p className="text-sm text-[var(--color-text-secondary)]">Only owners and administrators can change the organization profile.</p>
      )}
    </form>
  );
}
