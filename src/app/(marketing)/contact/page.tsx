import type { Metadata } from "next";
import { card, container, eyebrow, headingXl, lead, sectionY } from "@/shared/components/marketing/styles";
import { categories } from "@/shared/config/catalog";

export const metadata: Metadata = {
  title: "Contact",
  description: "Contact AnOps to discuss your operations, plans and the apps that fit your work.",
};

const fieldClass =
  "mt-2 h-12 w-full rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:ring-[3px] focus:ring-[var(--color-focus-ring)] focus:ring-offset-[2px] focus:ring-offset-[var(--color-bg-canvas)] disabled:opacity-60";

export default function ContactPage() {
  return (
    <div className={`${container} ${sectionY} scroll-reveal`}>
      <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
        <div>
          <p className={eyebrow}>Contact</p>
          <h1 className={`${headingXl} mt-3`}>Tell us about your operations.</h1>
          <p className={`${lead} mt-5`}>
            Share a few details about your business and the areas you want to improve. We will talk through the apps and plans
            that fit.
          </p>
          <p className="mt-8 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] p-4 text-sm text-[var(--color-text-secondary)]">
            Contact details will be published here. Until then, the form below is shown for layout only and does not send messages.
          </p>
        </div>

        <form className={`${card} space-y-6 p-6 sm:p-8`} aria-describedby="form-status">
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor="name" className="text-sm font-semibold text-[var(--color-text-primary)]">
                Full name
              </label>
              <input id="name" name="name" type="text" autoComplete="name" disabled className={fieldClass} />
            </div>
            <div>
              <label htmlFor="email" className="text-sm font-semibold text-[var(--color-text-primary)]">
                Work email
              </label>
              <input id="email" name="email" type="email" autoComplete="email" disabled className={fieldClass} />
            </div>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor="company" className="text-sm font-semibold text-[var(--color-text-primary)]">
                Company
              </label>
              <input id="company" name="company" type="text" autoComplete="organization" disabled className={fieldClass} />
            </div>
            <div>
              <label htmlFor="interest" className="text-sm font-semibold text-[var(--color-text-primary)]">
                Area of interest
              </label>
              <select id="interest" name="interest" disabled className={fieldClass}>
                <option value="">Choose an area</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="message" className="text-sm font-semibold text-[var(--color-text-primary)]">
              Message
            </label>
            <textarea
              id="message"
              name="message"
              rows={5}
              disabled
              placeholder="Tell us which operations you would like to organize"
              className="mt-2 w-full rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] p-3 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:ring-[3px] focus:ring-[var(--color-focus-ring)] focus:ring-offset-[2px] focus:ring-offset-[var(--color-bg-canvas)] disabled:opacity-60"
            />
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="submit"
              disabled
              className="inline-flex min-h-[44px] items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-action-primary)] px-6 text-sm font-semibold text-[var(--color-action-on-primary)] disabled:opacity-50"
            >
              Send message
            </button>
            <p id="form-status" className="text-xs text-[var(--color-text-secondary)]">
              Form delivery is not connected yet.
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}
