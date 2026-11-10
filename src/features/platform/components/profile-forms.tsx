"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { changePasswordAction, updateProfileAction } from "@/features/platform/actions/organization.action";
import type { UserProfileView } from "@/server/platform/profile.service";
import { Switch } from "@/shared/components/ui/switch";
import { useToast } from "@/shared/components/ui/toast";
import { cn } from "@/shared/lib/utils";

const field = "mt-1.5 h-12 w-full sm:h-11 rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3 text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-[3px] focus:ring-[var(--color-focus-ring)]";
const label = "text-sm font-semibold text-[var(--color-text-primary)]";
const card = "scroll-mt-24 rounded-[22px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 sm:p-6";
const button = "inline-flex min-h-[44px] items-center rounded-[var(--radius-control)] bg-[var(--color-action-primary)] px-6 text-sm font-semibold text-[#111F1D] hover:bg-[var(--color-action-hover)] disabled:opacity-70";

export function ProfileForms({ profile }: { profile: UserProfileView }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pwErrors, setPwErrors] = useState<Record<string, string>>({});
  const [notifications, setNotifications] = useState(profile.notifications);

  const saveProfile = (form: FormData) =>
    start(async () => {
      const result = await updateProfileAction({
        firstName: String(form.get("firstName") ?? ""),
        lastName: String(form.get("lastName") ?? ""),
        phone: String(form.get("phone") ?? ""),
        jobTitle: String(form.get("jobTitle") ?? ""),
        language: String(form.get("language") ?? "en"),
        notifications,
      });
      if (result.ok) {
        setErrors({});
        toast.success("Profile saved");
        router.refresh();
      } else {
        setErrors(result.error.details ?? {});
        toast.fromError(result.error);
      }
    });

  const savePassword = (form: FormData) =>
    start(async () => {
      const result = await changePasswordAction({ currentPassword: form.get("currentPassword"), password: form.get("password"), confirmPassword: form.get("confirmPassword") });
      if (result.ok) {
        setPwErrors({});
        toast.success("Password changed");
        (document.getElementById("password-form") as HTMLFormElement | null)?.reset();
      } else {
        setPwErrors(result.error.details ?? {});
        toast.fromError(result.error);
      }
    });

  const err = (map: Record<string, string>, key: string) => (map[key] ? <p className="mt-1 text-xs text-[var(--color-status-error-fg)]">{map[key]}</p> : null);

  return (
    <div className="space-y-6">
      <form action={saveProfile} className="space-y-6">
        <section id="personal" className={card} aria-labelledby="personal-title">
          <h2 id="personal-title" className="text-base font-semibold text-[var(--color-text-primary)]">
            Personal information
          </h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="firstName" className={label}>
                First name
              </label>
              <input id="firstName" name="firstName" defaultValue={profile.firstName} required maxLength={60} autoComplete="given-name" className={cn(field, errors.firstName && "border-[var(--color-status-error-fg)]")} />
              {err(errors, "firstName")}
            </div>
            <div>
              <label htmlFor="lastName" className={label}>
                Last name
              </label>
              <input id="lastName" name="lastName" defaultValue={profile.lastName} required maxLength={60} autoComplete="family-name" className={cn(field, errors.lastName && "border-[var(--color-status-error-fg)]")} />
              {err(errors, "lastName")}
            </div>
            <div>
              <label htmlFor="email" className={label}>
                Email
              </label>
              <input id="email" value={profile.email} readOnly className={cn(field, "bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)]")} />
              <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{profile.emailVerified ? "Confirmed" : "Not confirmed yet"}</p>
            </div>
            <div>
              <label htmlFor="phone" className={label}>
                Phone number
              </label>
              <input id="phone" name="phone" type="tel" defaultValue={profile.phone ?? ""} autoComplete="tel" className={cn(field, errors.phone && "border-[var(--color-status-error-fg)]")} />
              {err(errors, "phone")}
            </div>
            <div>
              <label htmlFor="jobTitle" className={label}>
                Position / title
              </label>
              <input
                id="jobTitle"
                name="jobTitle"
                defaultValue={profile.jobTitle ?? ""}
                maxLength={80}
                autoComplete="organization-title"
                placeholder="e.g. Operations manager"
                aria-invalid={errors.jobTitle ? true : undefined}
                className={cn(field, errors.jobTitle && "border-[var(--color-status-error-fg)]")}
              />
              {err(errors, "jobTitle")}
            </div>
            <div>
              <label htmlFor="language" className={label}>
                Preferred language
              </label>
              <select id="language" name="language" defaultValue={profile.language} className={field}>
                <option value="en">English</option>
                <option value="fr">Français</option>
              </select>
            </div>
          </div>
        </section>

        <section id="notifications" className={card} aria-labelledby="notif-title">
          <h2 id="notif-title" className="text-base font-semibold text-[var(--color-text-primary)]">
            Notification preferences
          </h2>
          <ul className="mt-4 divide-y divide-[var(--color-border-subtle)]">
            {(
              [
                ["product", "Product updates and tips", "New features and guides for the applications you use."],
                ["billing", "Billing", "Receipts, failed payments and plan changes (owners)."],
                ["security", "Security", "Sign-in and account changes. Always on."],
              ] as const
            ).map(([key, title, body]) => (
              <li key={key} className="flex items-center justify-between gap-4 py-2.5">
                <span>
                  <span className="block text-sm font-semibold text-[var(--color-text-primary)]">{title}</span>
                  <span className="block text-xs text-[var(--color-text-secondary)]">{body}</span>
                </span>
                <Switch checked={notifications[key]} label={title} disabled={key === "security"} onChange={(next) => setNotifications((n) => ({ ...n, [key]: next }))} />
              </li>
            ))}
          </ul>
        </section>

        {/* Sticky on phones so Save is always reachable, inline on larger screens. */}
        <div className="sticky bottom-0 z-10 -mx-4 border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-canvas)]/90 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
          <button type="submit" disabled={pending} className={cn(button, "w-full justify-center sm:ml-auto sm:flex sm:w-auto")}>
            {pending ? "Saving…" : "Save profile"}
          </button>
        </div>
      </form>

      <section id="security" className={card} aria-labelledby="security-title">
        <h2 id="security-title" className="text-base font-semibold text-[var(--color-text-primary)]">
          Security
        </h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Change your password. You need your current password.</p>
        <form id="password-form" action={savePassword} className="mt-5 grid gap-4 md:grid-cols-3">
          <div>
            <label htmlFor="currentPassword" className={label}>
              Current password
            </label>
            <input id="currentPassword" name="currentPassword" type="password" required autoComplete="current-password" className={field} />
            {err(pwErrors, "currentPassword")}
          </div>
          <div>
            <label htmlFor="newPassword" className={label}>
              New password
            </label>
            <input id="newPassword" name="password" type="password" required minLength={8} maxLength={72} autoComplete="new-password" className={field} />
            {err(pwErrors, "password")}
          </div>
          <div>
            <label htmlFor="confirmNew" className={label}>
              Confirm new password
            </label>
            <input id="confirmNew" name="confirmPassword" type="password" required autoComplete="new-password" className={field} />
            {err(pwErrors, "confirmPassword")}
          </div>
          <div className="md:col-span-3 flex justify-end">
            <button type="submit" disabled={pending} className={cn(button, "w-full justify-center sm:w-auto")}>
              Change password
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
