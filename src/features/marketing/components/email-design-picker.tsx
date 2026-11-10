"use client";

import { EMAIL_DESIGN_OPTIONS, renderEmailHtml, type EmailDesign } from "@/features/marketing/utils/email-design";
import { cn } from "@/shared/lib/utils";

const SAMPLE_SUBJECT = "Your October update from Acme";
const SAMPLE_BODY = [
  "Hi Amina,",
  "",
  "Here is what is new this month: seasonal boxes have landed, orders placed before Thursday ship the same week, and our team is available for advice every weekday.",
  "",
  "Reply to this email if you would like a recommendation.",
].join("\n");

/**
 * The same sample content rendered through every design, once at module load. The thumbnails are
 * static on purpose: they compare layouts without re-rendering an iframe on every keystroke.
 */
const THUMBNAILS = EMAIL_DESIGN_OPTIONS.map((option) => ({
  ...option,
  html: renderEmailHtml({
    design: option.id,
    subject: SAMPLE_SUBJECT,
    body: SAMPLE_BODY,
    companyName: "Acme",
    unsubscribeUrl: "#unsubscribe",
    unsubscribeInBody: false,
  }),
}));

export function EmailDesignPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: EmailDesign;
  onChange: (design: EmailDesign) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-sm font-semibold">Email design</legend>
      <p className="text-xs text-[var(--color-text-secondary)]">
        Your message stays plain text. The design adds layout, typography and a styled unsubscribe footer.
        Designs marked <span className="font-semibold">Motion</span> animate in Apple Mail and iOS; other
        clients show the static version.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {THUMBNAILS.map((option) => {
          const selected = value === option.id;
          return (
            <label
              key={option.id}
              className={cn(
                "group relative block cursor-pointer overflow-hidden rounded-[var(--radius-card)] border bg-[var(--color-bg-surface)] transition",
                selected
                  ? "border-[var(--color-action-primary)] ring-2 ring-[var(--color-action-primary)]"
                  : "border-[var(--color-border-subtle)] hover:border-[var(--color-border-control)]",
                disabled && "cursor-not-allowed opacity-60"
              )}
            >
              <input
                type="radio"
                name="email-design"
                value={option.id}
                checked={selected}
                disabled={disabled}
                onChange={() => onChange(option.id)}
                className="sr-only"
              />
              <span aria-hidden="true" className="relative block h-[112px] overflow-hidden border-b border-[var(--color-border-subtle)] bg-white">
                <iframe
                  title=""
                  srcDoc={option.html}
                  sandbox=""
                  tabIndex={-1}
                  loading="lazy"
                  className="pointer-events-none absolute left-0 top-0 h-[430px] w-[600px] origin-top-left scale-[0.42]"
                />
              </span>
              <span className="flex items-start justify-between gap-2 p-3">
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
                    {option.label}
                    {option.motion && (
                      <span className="rounded-[var(--radius-pill)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-secondary)]">
                        Motion
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs leading-snug text-[var(--color-text-secondary)]">{option.description}</span>
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-1 grid h-4 w-4 shrink-0 place-items-center rounded-full border",
                    selected ? "border-transparent" : "border-[var(--color-border-control)]"
                  )}
                  style={selected ? { backgroundColor: option.accent } : undefined}
                >
                  {selected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
