"use client";

import { useToast } from "@/shared/components/ui/toast";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useTransition } from "react";
import { useForm, type Resolver } from "react-hook-form";
import type { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { templateInputSchema } from "@/features/marketing/schemas/marketing.schema";
import { createTemplateAction, updateTemplateAction } from "@/features/marketing/actions/templates.action";
import { Button, selectClass } from "@/shared/components/ui/button";
import { TextField } from "@/shared/components/ui/text-field";
import { CHANNEL_LABELS } from "@/features/marketing/labels";
import { MARKETING_CHANNELS, type MarketingChannel } from "@/features/marketing/types/constants";
import { renderTemplate, smsSegmentCount, SMS_BODY_MAX, SMS_OPT_OUT_FOOTER, TELEGRAM_BODY_MAX, TELEGRAM_VARIABLES, TEMPLATE_VARIABLES, type TemplateVariable } from "@/features/marketing/utils/template";
import { DEFAULT_EMAIL_DESIGN, renderEmailHtml, type EmailDesign } from "@/features/marketing/utils/email-design";
import { EmailDesignPicker } from "@/features/marketing/components/email-design-picker";
import { EmailPreview } from "@/features/marketing/components/email-preview";
import { TelegramPreview } from "@/features/marketing/components/telegram-preview";
import type { TemplateDto } from "@/server/marketing/template.service";

const SAMPLE: Record<TemplateVariable, string> = {
  first_name: "Amina",
  last_name: "Ben Ali",
  email: "amina@example.test",
  company_name: "Your company",
  unsubscribe_url: "#unsubscribe",
};

type TemplateFormValues = z.input<typeof templateInputSchema>;

/**
 * Template editor with a live preview rendered from sample values. The preview is a convenience only:
 * the server validates the same allowlist and length rules before saving.
 */
export function TemplateForm({ template, canManage }: { template?: TemplateDto; canManage: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const toast = useToast();
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<TemplateFormValues>({
    resolver: zodResolver(templateInputSchema) as unknown as Resolver<TemplateFormValues>,
    mode: "onBlur",
    defaultValues: template
      ? { name: template.name, channel: template.channel, design: template.design, subject: template.subject, body: template.body, isActive: template.isActive }
      : { name: "", channel: "email", design: DEFAULT_EMAIL_DESIGN, subject: "", body: "", isActive: true },
  });
  const channel = watch("channel") as MarketingChannel;
  const design = (watch("design") ?? DEFAULT_EMAIL_DESIGN) as EmailDesign;
  const subject = watch("subject") ?? "";
  const body = watch("body") ?? "";

  const rendered = useMemo(() => renderTemplate(body, SAMPLE), [body]);
  const renderedSubject = useMemo(() => renderTemplate(subject, SAMPLE), [subject]);
  const emailHtml = useMemo(
    () =>
      renderEmailHtml({
        design,
        subject: renderedSubject || "Your subject",
        body: rendered || "Your message appears here.",
        companyName: SAMPLE.company_name,
        unsubscribeUrl: SAMPLE.unsubscribe_url,
        unsubscribeInBody: body.includes("{{unsubscribe_url}}"),
      }),
    [design, rendered, renderedSubject, body]
  );
  const allowedVariables: readonly string[] = channel === "telegram" ? TELEGRAM_VARIABLES : TEMPLATE_VARIABLES;
  const smsText = `${rendered} ${SMS_OPT_OUT_FOOTER}`;
  const smsLength = smsText.length;

  const insert = (token: TemplateVariable) => {
    const field = getValues("body") ?? "";
    setValue("body", `${field}{{${token}}}`, { shouldDirty: true, shouldValidate: true });
  };

  const submit = (values: TemplateFormValues) =>
    startTransition(async () => {
      const payload = {
        ...values,
        design: values.channel === "email" ? values.design ?? DEFAULT_EMAIL_DESIGN : DEFAULT_EMAIL_DESIGN,
        subject: values.channel === "email" ? values.subject : "",
      };
      const result = template
        ? await updateTemplateAction(template.id, { ...payload, expectedVersion: template.version })
        : await createTemplateAction(payload);
      if (!result.ok) return toast.fromError(result.error);
      if (template) {
        toast.success("Template saved. Campaigns that already copied it keep their own text.");
        router.refresh();
      } else {
        router.push(`/marketing/templates/${result.data.id}`);
        router.refresh();
      }
    });

  return (
    <form
      noValidate
      onSubmit={handleSubmit(submit)}
      className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start"
    >
      <aside aria-label="Preview" className="order-2 space-y-3 lg:order-1 lg:sticky lg:top-6">
        <h2 className="text-base font-semibold">Preview</h2>
        <p className="text-xs text-[var(--color-text-secondary)]">Shown with sample values. Real messages use each contact&apos;s details.</p>
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4">
          {channel === "email" ? (
            <>
              <p className="break-words text-sm"><span className="font-semibold">Subject:</span> {renderedSubject || "—"}</p>
              <EmailPreview html={emailHtml} title="Email preview" className="mt-3" />
            </>
          ) : channel === "telegram" ? (
            <TelegramPreview body={rendered} />
          ) : (
            <>
              <p className="whitespace-pre-wrap break-words text-sm">{smsText.trim() === SMS_OPT_OUT_FOOTER ? "Your SMS appears here." : smsText}</p>
              <p className={`mt-3 text-xs ${smsLength > SMS_BODY_MAX ? "text-[#c0392b]" : "text-[var(--color-text-secondary)]"}`} aria-live="polite">
                {smsLength} / {SMS_BODY_MAX} characters · {smsSegmentCount(smsText)} segment(s). Longer messages are charged per segment by the carrier.
              </p>
            </>
          )}
        </div>
        <p className="text-xs text-[var(--color-text-secondary)]">
          Allowed variables: {allowedVariables.map((name) => `{{${name}}}`).join(", ")}. Any other {"{{…}}"} is rejected on save.
        </p>
      </aside>

      <div className="order-1 space-y-5 lg:order-2">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Template name" disabled={!canManage} error={errors.name?.message} {...register("name")} />
          <div className="space-y-1.5">
            <label htmlFor="channel" className="text-sm font-semibold">Channel</label>
            <select id="channel" className={selectClass} disabled={!canManage || Boolean(template)} {...register("channel")}>
              {MARKETING_CHANNELS.map((item) => <option key={item} value={item}>{CHANNEL_LABELS[item]}</option>)}
            </select>
            {template && <p className="text-xs text-[var(--color-text-secondary)]">The channel is fixed once a template exists.</p>}
          </div>
        </div>

        {channel === "email" && (
          <TextField label="Subject" maxLength={150} disabled={!canManage} error={errors.subject?.message} {...register("subject")} />
        )}

        {channel === "email" && (
          <EmailDesignPicker
            value={design}
            disabled={!canManage}
            onChange={(next) => setValue("design", next, { shouldDirty: true, shouldValidate: true })}
          />
        )}
        {errors.design?.message && <p role="alert" className="text-xs text-[#c0392b]">{errors.design.message}</p>}

        <div className="space-y-1.5">
          <label htmlFor="body" className="text-sm font-semibold">{channel === "email" ? "Message" : channel === "telegram" ? "Telegram message" : "SMS message"}</label>
          <textarea
            id="body"
            rows={channel === "email" ? 10 : 5}
            disabled={!canManage}
            aria-invalid={Boolean(errors.body)}
            aria-describedby="body-help"
            className="w-full rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] p-3 text-sm focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)]"
            {...register("body")}
          />
          <p id="body-help" className="text-xs text-[var(--color-text-secondary)]">
            {channel === "email"
              ? "Plain text. Line breaks are kept; the chosen design supplies the layout and unsubscribe footer."
              : channel === "telegram"
                ? `Plain text, up to ${TELEGRAM_BODY_MAX.toLocaleString("en-US")} characters. Nothing is formatted or shortened. "Send /stop to stop receiving marketing messages." is added automatically.`
                : `Up to ${SMS_BODY_MAX - SMS_OPT_OUT_FOOTER.length - 1} characters. "${SMS_OPT_OUT_FOOTER}" is added automatically.`}
          </p>
          {errors.body?.message && <p role="alert" className="text-xs text-[#c0392b]">{errors.body.message}</p>}
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">Insert a variable</legend>
          <div className="flex flex-wrap gap-2">
            {TEMPLATE_VARIABLES.filter((name) => (channel === "telegram" ? (TELEGRAM_VARIABLES as readonly string[]).includes(name) : name !== "unsubscribe_url" || channel === "email")).map((name) => (
              <button
                key={name}
                type="button"
                disabled={!canManage}
                onClick={() => insert(name)}
                className="min-h-[44px] rounded-[var(--radius-pill)] border border-[var(--color-border-control)] px-3 text-sm hover:bg-[var(--color-bg-subtle)] disabled:opacity-60"
              >
                {`{{${name}}}`}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="inline-flex min-h-[44px] items-center gap-3 text-sm">
          <input type="checkbox" disabled={!canManage} className="h-4 w-4 accent-[var(--color-action-primary)]" {...register("isActive")} />
          Available for new campaigns
        </label>

        {canManage && (
          <div className="flex flex-col-reverse gap-2 border-t border-[var(--color-border-subtle)] pt-4 sm:flex-row sm:justify-end">
            <Link
              href="/marketing/templates"
              className="inline-flex min-h-[44px] items-center justify-center rounded-[var(--radius-control)] border border-[var(--color-border-control)] px-4 text-sm"
            >
              Back
            </Link>
            <Button type="submit" variant="primary" disabled={pending}>{pending ? "Saving…" : template ? "Save template" : "Create template"}</Button>
          </div>
        )}
      </div>
    </form>
  );
}
