"use client";

import { confirmAction } from "@/shared/components/ui/confirm-dialog";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { consentChangeSchema } from "@/features/marketing/schemas/marketing.schema";
import {
  assignTagsAction,
  changeConsentAction,
  deleteContactAction,
  removeTagsAction,
  setContactActiveAction,
} from "@/features/marketing/actions/contacts.action";
import { Button, selectClass } from "@/shared/components/ui/button";
import { StatusBadge } from "@/shared/components/data-display/status-badge";
import { formatDateTime } from "@/shared/lib/format";
import { CHANNEL_LABELS, consentLabel, LIFECYCLE_LABELS, SOURCE_LABELS } from "@/features/marketing/labels";
import { ContactForm } from "@/features/marketing/components/contact-form";
import { TelegramConnection } from "@/features/marketing/components/telegram-connection";
import type { TelegramConnectionDto } from "@/server/marketing/telegram.service";
import { tunisiaLocalToIso } from "@/features/marketing/utils/datetime";
import { MARKETING_CHANNELS } from "@/features/marketing/types/constants";
import type { ContactDetailDto } from "@/server/marketing/contact.service";
import type { ConsentEventDto } from "@/server/marketing/consent.service";
import type { TagDto } from "@/server/marketing/tag.service";
import type { MarketingChannel } from "@/features/marketing/types/constants";
import { useToast } from "@/shared/components/ui/toast";

/**
 * The form holds the browser's local date-time text. It is checked here, on the field, and converted to a UTC
 * instant only at submit. Server validation still applies to the converted value.
 */
const consentFormSchema = z.object({
  channel: z.enum(MARKETING_CHANNELS),
  status: z.enum(["granted", "withdrawn"]),
  source: z.enum(["manual", "import", "form"]),
  occurredAt: z.string().refine((value) => tunisiaLocalToIso(value).ok, "Enter a complete date and time, or leave it empty."),
});
type ConsentForm = z.infer<typeof consentFormSchema>;

/** Full contact view: edit, activate/deactivate, tags, consent with history, and deletion (only without history). */
export function ContactDetail({
  contact,
  history,
  tags,
  canManage,
  canConsent,
  canTag,
  telegram,
  telegramBotReady,
}: {
  contact: ContactDetailDto;
  history: ConsentEventDto[];
  tags: TagDto[];
  canManage: boolean;
  canConsent: boolean;
  canTag: boolean;
  telegram: TelegramConnectionDto;
  telegramBotReady: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [tagChoice, setTagChoice] = useState("");
  const assigned = new Set(contact.tags.map((tag) => tag.id));
  const available = tags.filter((tag) => !assigned.has(tag.id));

  const run = (fn: () => Promise<{ ok: boolean; error?: { message: string } }>, success: string) =>
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) return toast.fromError(result.error);
      toast.success(success);
      router.refresh();
    });

  return (
    <div className="space-y-6">

      <section aria-labelledby="contact-summary" className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 id="contact-summary" className="break-words text-xl font-semibold">{contact.fullName || "Unnamed contact"}</h2>
            <p className="mt-1 break-all text-sm text-[var(--color-text-secondary)]">{contact.email || "No email address"}</p>
            <p className="text-sm text-[var(--color-text-secondary)]">{contact.phone || "No phone number"}</p>
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <dt className="text-[var(--color-text-secondary)]">Stage</dt>
              <dd>{LIFECYCLE_LABELS[contact.lifecycleStage]}</dd>
              <dt className="text-[var(--color-text-secondary)]">Source</dt>
              <dd>{SOURCE_LABELS[contact.source]}</dd>
              <dt className="text-[var(--color-text-secondary)]">Created</dt>
              <dd>{formatDateTime(contact.createdAt)}</dd>
            </dl>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge label={contact.isActive ? "Active" : "Inactive"} tone={contact.isActive ? "success" : "neutral"} />
            {canManage && !editing && <Button onClick={() => setEditing(true)}>Edit</Button>}
            {canManage && (
              <Button
                disabled={pending}
                onClick={() => run(() => setContactActiveAction(contact.id, { isActive: !contact.isActive, expectedVersion: contact.version }), contact.isActive ? "Contact deactivated." : "Contact activated.")}
              >
                {contact.isActive ? "Deactivate" : "Activate"}
              </Button>
            )}
          </div>
        </div>
        {editing && (
          <div className="mt-6 border-t border-[var(--color-border-subtle)] pt-6">
            <ContactForm mode="edit" contact={contact} onDone={() => setEditing(false)} />
          </div>
        )}
      </section>

      <section aria-labelledby="contact-tags" className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5">
        <h2 id="contact-tags" className="mb-3 text-base font-semibold">Tags</h2>
        {contact.tags.length === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)]">No tags yet.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {contact.tags.map((tag) => (
              <li key={tag.id} className="inline-flex items-center gap-1 rounded-[var(--radius-pill)] border border-[var(--color-border-control)] py-1 pl-3 pr-1 text-sm">
                <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tag.color }} />
                <span className="break-words">{tag.name}</span>
                {canTag && (
                  <button
                    type="button"
                    aria-label={`Remove tag ${tag.name}`}
                    disabled={pending}
                    onClick={() => run(() => removeTagsAction({ contactIds: [contact.id], tagId: tag.id }), "Tag removed.")}
                    className="ml-1 flex h-8 w-8 items-center justify-center rounded-full text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text-primary)]"
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canTag && available.length > 0 && (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <label htmlFor="add-tag" className="sr-only">Add a tag</label>
            <select id="add-tag" className={selectClass} value={tagChoice} onChange={(event) => setTagChoice(event.target.value)}>
              <option value="">Choose a tag to add</option>
              {available.map((tag) => (
                <option key={tag.id} value={tag.id}>{tag.name}</option>
              ))}
            </select>
            <Button
              variant="primary"
              disabled={pending || !tagChoice}
              onClick={() => {
                const choice = tagChoice;
                setTagChoice("");
                run(() => assignTagsAction({ contactIds: [contact.id], tagId: choice }), "Tag added.");
              }}
            >
              Add tag
            </Button>
          </div>
        )}
      </section>

      <TelegramConnection
        contactId={contact.id}
        connection={telegram}
        botReady={telegramBotReady}
        canManage={canManage}
        consentGranted={contact.consent.telegram?.status === "granted"}
      />

      <ConsentSection contact={contact} history={history} canConsent={canConsent} onChanged={() => router.refresh()} />

      {canManage && (
        <section aria-labelledby="contact-danger" className="rounded-[var(--radius-card)] border border-[var(--color-status-error)] p-5">
          <h2 id="contact-danger" className="text-base font-semibold">Delete contact</h2>
          {contact.hasHistory ? (
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
              This contact has campaign or consent history, so it cannot be deleted. Deactivate it instead. Deactivated contacts are never
              sent to.
            </p>
          ) : (
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-[var(--color-text-secondary)]">This removes the contact and its tags. It cannot be undone.</p>
              <Button
                variant="danger"
                disabled={pending}
                onClick={async () => {
                  if (!(await confirmAction({ title: "Delete this contact?", message: "The contact and their history are permanently removed.", tone: "danger", confirmLabel: "Delete contact" }))) return;
                  startTransition(async () => {
                    const result = await deleteContactAction(contact.id);
                    if (!result.ok) return toast.fromError(result.error);
                    router.push("/marketing/contacts");
                    router.refresh();
                  });
                }}
              >
                Delete contact
              </Button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function ConsentSection({
  contact,
  history,
  canConsent,
  onChanged,
}: {
  contact: ContactDetailDto;
  history: ConsentEventDto[];
  canConsent: boolean;
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const toast = useToast();
  const { register, handleSubmit, watch, formState: { errors } } = useForm<ConsentForm>({
    resolver: zodResolver(consentFormSchema),
    mode: "onBlur",
    defaultValues: { channel: "email", status: "granted", source: "manual", occurredAt: "" },
  });
  const channel = watch("channel");
  const current = contact.consent[channel];

  const submit = (values: ConsentForm) =>
    startTransition(async () => {
      const when = tunisiaLocalToIso(values.occurredAt);
      if (!when.ok) return toast.error("Check the date", when.message);
      const result = await changeConsentAction(contact.id, {
        channel: values.channel,
        status: values.status,
        source: values.source,
        occurredAt: when.iso,
      });
      if (!result.ok) return toast.fromError(result.error);
      toast.success(values.status === "granted" ? "Consent recorded." : "Consent withdrawn.");
      onChanged();
    });

  return (
    <section aria-labelledby="consent" className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5">
      <h2 id="consent" className="text-base font-semibold">Marketing consent</h2>
      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
        Consent is kept per channel. Email consent never authorises SMS, and neither authorises Telegram. Withdrawals are recorded and never deleted.
      </p>
      <dl className="mt-4 grid gap-3 sm:grid-cols-3">
        {(["email", "sms", "telegram"] as const).map((item) => {
          const state = contact.consent[item];
          return (
            <div key={item} className="rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)] p-3 text-sm">
              <dt className="font-semibold">{CHANNEL_LABELS[item]}</dt>
              <dd className="mt-1">
                {state ? (
                  <>
                    {consentLabel(state.status)} · {formatDateTime(state.occurredAt)}
                    {state.source && <span className="text-[var(--color-text-secondary)]"> · {state.source.replace("_", " ")}</span>}
                  </>
                ) : (
                  <span className="text-[var(--color-text-secondary)]">{consentLabel("not_granted")}</span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>

      {canConsent && (
        <form noValidate onSubmit={handleSubmit(submit)} className="mt-5 grid gap-4 sm:grid-cols-2" aria-label="Record consent change">
          <div className="space-y-1.5">
            <label htmlFor="consent-channel" className="text-sm font-semibold">Channel</label>
            <select id="consent-channel" className={selectClass} {...register("channel")}>
              <option value="email">Email</option>
              <option value="sms">SMS</option>
              <option value="telegram">Telegram (needs a connected chat)</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="consent-status" className="text-sm font-semibold">Change</label>
            <select id="consent-status" className={selectClass} {...register("status")}>
              <option value="granted">Record consent (granted)</option>
              <option value="withdrawn">Record withdrawal</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="consent-source" className="text-sm font-semibold">Source</label>
            <select id="consent-source" className={selectClass} {...register("source")}>
              <option value="manual">Given to us directly</option>
              <option value="form">Sign-up form</option>
              <option value="import">Imported from a list</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="consent-when" className="text-sm font-semibold">When it happened (optional)</label>
            <input
              id="consent-when"
              type="datetime-local"
              aria-invalid={Boolean(errors.occurredAt)}
              aria-describedby="consent-when-hint"
              className={`min-h-[44px] w-full rounded-[var(--radius-control)] border bg-[var(--color-bg-surface)] px-3 text-sm ${errors.occurredAt ? "border-[#c0392b]" : "border-[var(--color-border-control)]"}`}
              {...register("occurredAt")}
            />
            {errors.occurredAt ? (
              <p role="alert" className="text-xs text-[#c0392b]">{errors.occurredAt.message}</p>
            ) : (
              <p id="consent-when-hint" className="text-xs text-[var(--color-text-secondary)]">
                Optional. Use the date the consent was actually given, in Tunisia time (UTC+1). Leave empty to record it now. A date older than the latest change is kept in history but does not replace it.
              </p>
            )}
          </div>
          <p className="text-xs text-[var(--color-text-secondary)] sm:col-span-2">Current {CHANNEL_LABELS[channel]} state: {current ? consentLabel(current.status) : consentLabel("not_granted")}</p>
          <div className="sm:col-span-2 flex justify-end">
            <Button type="submit" variant="primary" disabled={pending}>{pending ? "Saving…" : "Record"}</Button>
          </div>
        </form>
      )}

      <h3 className="mt-6 text-sm font-semibold">History</h3>
      {history.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">No consent events yet.</p>
      ) : (
        <ol className="mt-2 divide-y divide-[var(--color-border-subtle)] text-sm">
          {history.map((event) => (
            <li key={event.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:justify-between">
              <span>{CHANNEL_LABELS[event.channel]} · {consentLabel(event.status)}</span>
              <span className="text-[var(--color-text-secondary)]">
                {formatDateTime(event.occurredAt)} · {event.source.replace("_", " ")} · {event.recordedByUser ? "by a team member" : "by the contact"}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
