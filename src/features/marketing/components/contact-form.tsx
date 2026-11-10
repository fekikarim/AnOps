"use client";

import { Switch } from "@/shared/components/ui/switch";
import { useRouter } from "next/navigation";
import { useTransition, type ComponentType } from "react";
import { Controller, useForm, type Resolver, type UseFormRegisterReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Mail, Megaphone, Target, UserRound, type LucideProps } from "lucide-react";
import { contactCreateSchema } from "@/features/marketing/schemas/marketing.schema";
import { createContactAction, updateContactAction } from "@/features/marketing/actions/contacts.action";
import { Button, selectClass } from "@/shared/components/ui/button";
import { useToast } from "@/shared/components/ui/toast";
import { TextField } from "@/shared/components/ui/text-field";
import { CONTACT_SOURCES, LIFECYCLE_STAGES, type DirectContactChannel } from "@/features/marketing/types/constants";
import { LIFECYCLE_HINTS, LIFECYCLE_LABELS, SOURCE_HINTS, SOURCE_LABELS } from "@/features/marketing/labels";
import type { ContactDto } from "@/server/marketing/contact.service";
import type { ConsentDto } from "@/server/marketing/consent.service";
import { cn } from "@/shared/lib/utils";

export type ContactFormValues = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  source: (typeof CONTACT_SOURCES)[number];
  lifecycleStage: (typeof LIFECYCLE_STAGES)[number];
  isActive: boolean;
  consent: Record<DirectContactChannel, boolean>;
};

const checkboxClass =
  "mt-0.5 h-4 w-4 shrink-0 rounded-[calc(var(--radius-control)*0.5)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] accent-[var(--color-action-primary)] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)]";

const CHANNEL_COPY: Record<DirectContactChannel, { name: string; needs: string; consentHint: string }> = {
  email: {
    name: "Email marketing",
    needs: "Add an email address above to enable this.",
    consentHint: "Tick only if this person clearly agreed. Recorded with today's date and your account.",
  },
  sms: {
    name: "SMS marketing",
    needs: "Add a phone number above to enable this.",
    consentHint: "Tick only if this person clearly agreed. Recorded with today's date and your account.",
  },
};

/**
 * Create and edit share one form. The same Zod schema validates here and in the server action.
 * Consent is part of the form: saving records a grant or withdrawal only for the channels that changed.
 */
export function ContactForm({
  mode,
  contact,
  onDone,
}: {
  mode: "create" | "edit";
  contact?: ContactDto & { consent?: ConsentDto };
  onDone?: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const initialConsent: Record<DirectContactChannel, boolean> = {
    email: contact?.consent?.email?.status === "granted",
    sms: contact?.consent?.sms?.status === "granted",
  };
  const defaultValues: ContactFormValues = {
    firstName: contact?.firstName ?? "",
    lastName: contact?.lastName ?? "",
    email: contact?.email ?? "",
    phone: contact?.phone ?? "",
    source: contact?.source ?? "manual",
    lifecycleStage: contact?.lifecycleStage ?? "lead",
    isActive: contact?.isActive ?? true,
    consent: initialConsent,
  };
  const {
    register,
    control,
    handleSubmit,
    watch,
    formState: { errors },
    setError,
  } = useForm<ContactFormValues>({
    // The resolver validates every visible field. The version is added at submit time, so it can never
    // block saving with a message the user cannot see.
    resolver: zodResolver(contactCreateSchema) as unknown as Resolver<ContactFormValues>,
    mode: "onBlur",
    defaultValues,
  });

  const selectedSource = watch("source");
  const selectedStage = watch("lifecycleStage");
  const selectedEmail = watch("email");
  const selectedPhone = watch("phone");
  const consent = watch("consent");
  const hasAddress: Record<DirectContactChannel, boolean> = {
    email: selectedEmail.trim() !== "",
    sms: selectedPhone.trim() !== "",
  };

  // Edit mode shows what saving will record, so consent changes are never a surprise.
  const pendingConsent = (["email", "sms"] as const).flatMap((channel) => {
    if (consent[channel] === initialConsent[channel]) return [];
    return [`${CHANNEL_COPY[channel].name} ${consent[channel] ? "granted" : "withdrawn"}`];
  });

  const submit = (values: ContactFormValues) =>
    startTransition(async () => {
      const result =
        mode === "create"
          ? await createContactAction(values)
          : await updateContactAction(contact?.id, { ...values, expectedVersion: contact?.version ?? 1 });
      if (!result.ok) {
        for (const [field, message] of Object.entries(result.error.details ?? {})) {
          if (field === "email" || field === "phone") setError(field, { message });
        }
        toast.fromError(result.error);
        return;
      }
      if (mode === "create") {
        toast.success("Contact created.");
        router.push(`/marketing/contacts/${result.data.id}`);
        router.refresh();
      } else {
        toast.success(pendingConsent.length > 0 ? `Contact saved. ${pendingConsent.join(", ")}.` : "Contact saved.");
        onDone?.();
        router.refresh();
      }
    });

  return (
    <form
      noValidate
      onSubmit={handleSubmit(submit)}
      aria-label={mode === "create" ? "New contact" : "Edit contact"}
      className="space-y-8"
    >
      <FormSection icon={UserRound} title="Identity" description="Who this person is. Only the first name is required.">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="First name"
            required
            placeholder="e.g. Amina"
            hint="The person's given name."
            autoComplete="given-name"
            error={errors.firstName?.message}
            {...register("firstName")}
          />
          <TextField
            label="Last name"
            placeholder="e.g. Ben Ali"
            hint="Family name, or the full name if you prefer."
            autoComplete="family-name"
            error={errors.lastName?.message}
            {...register("lastName")}
          />
        </div>
      </FormSection>

      <FormSection
        icon={Mail}
        title="Ways to reach them"
        description="Each channel needs its own address. Consent is recorded separately for each one, and email consent never covers SMS."
      >
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="space-y-3">
            <TextField
              label="Email"
              type="email"
              inputMode="email"
              autoComplete="off"
              placeholder="e.g. amina@example.com"
              hint="Saved in lowercase. Each email belongs to one contact in your company."
              error={errors.email?.message}
              {...register("email")}
            />
            <ConsentOption
              id="consent-email"
              channel="email"
              checked={consent.email}
              hasAddress={hasAddress.email}
              registration={register("consent.email")}
            />
          </div>
          <div className="space-y-3">
            <TextField
              label="Phone"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              placeholder="e.g. +216 20 123 456"
              hint="Start with the country code (+216 for Tunisia). Spaces and dashes are removed automatically."
              error={errors.phone?.message}
              {...register("phone")}
            />
            <ConsentOption
              id="consent-sms"
              channel="sms"
              checked={consent.sms}
              hasAddress={hasAddress.sms}
              registration={register("consent.sms")}
            />
          </div>
        </div>
      </FormSection>

      <FormSection icon={Target} title="Classification" description="How this contact came to you and where they are in their journey. Tags are managed on the contact page.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="source" className="text-sm font-semibold">Source</label>
            <select id="source" className={selectClass} aria-describedby="source-hint" {...register("source")}>
              {CONTACT_SOURCES.map((source) => (
                <option key={source} value={source}>{SOURCE_LABELS[source]}</option>
              ))}
            </select>
            <p id="source-hint" className="text-xs text-[var(--color-text-secondary)]">
              {SOURCE_HINTS[selectedSource] ?? ""}
            </p>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="lifecycleStage" className="text-sm font-semibold">Lifecycle stage</label>
            <select id="lifecycleStage" className={selectClass} aria-describedby="stage-hint" {...register("lifecycleStage")}>
              {LIFECYCLE_STAGES.map((stage) => (
                <option key={stage} value={stage}>{LIFECYCLE_LABELS[stage]}</option>
              ))}
            </select>
            <p id="stage-hint" className="text-xs text-[var(--color-text-secondary)]">
              {LIFECYCLE_HINTS[selectedStage] ?? ""}
            </p>
          </div>
        </div>

        <Controller
          name="isActive"
          control={control}
          render={({ field }) => (
            <div className="mt-4 flex items-start justify-between gap-4 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] p-4">
              <div className="min-w-0">
                <p id="active-label" className="text-sm font-semibold">Eligible for campaigns</p>
                <p id="active-hint" className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                  Turn off to pause this contact without deleting their history. Inactive contacts are never sent to.
                </p>
              </div>
              <Switch checked={field.value} labelledBy="active-label" describedBy="active-hint" onChange={(next) => field.onChange(next)} />
            </div>
          )}
        />
      </FormSection>

      {mode === "edit" && (
        <p
          role="status"
          className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-4 py-3 text-sm text-[var(--color-text-secondary)]"
        >
          {pendingConsent.length > 0 ? (
            <>
              <span className="font-semibold text-[var(--color-text-primary)]">Saving will record:</span> {pendingConsent.join(", ")}.
            </>
          ) : (
            "No consent changes. Saving updates the details only."
          )}
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 border-t border-[var(--color-border-subtle)] pt-6 sm:flex-row sm:justify-end">
        {onDone && (
          <Button onClick={onDone} disabled={pending}>Cancel</Button>
        )}
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : mode === "create" ? "Create contact" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

function FormSection({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: ComponentType<LucideProps>;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <header className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)] text-[var(--color-action-primary)]">
          <Icon size={18} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{title}</h3>
          <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{description}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

function ConsentOption({
  id,
  channel,
  checked,
  hasAddress,
  registration,
}: {
  id: string;
  channel: DirectContactChannel;
  checked: boolean;
  hasAddress: boolean;
  registration: UseFormRegisterReturn<`consent.${DirectContactChannel}`>;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex cursor-pointer gap-3 rounded-[var(--radius-control)] border p-3 transition-colors",
        checked
          ? "border-[var(--color-action-primary)] bg-[var(--color-bg-subtle)]"
          : "border-[var(--color-border-control)] bg-[var(--color-bg-surface)]"
      )}
    >
      <input id={id} type="checkbox" className={checkboxClass} aria-describedby={`${id}-hint`} {...registration} />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          <Megaphone size={14} aria-hidden="true" className="text-[var(--color-text-secondary)]" />
          Agreed to receive {channel === "email" ? "email" : "SMS"} marketing
        </span>
        <span id={`${id}-hint`} className="mt-0.5 block text-xs text-[var(--color-text-secondary)]">
          {hasAddress ? CHANNEL_COPY[channel].consentHint : CHANNEL_COPY[channel].needs}
        </span>
      </span>
    </label>
  );
}
