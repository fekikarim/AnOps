"use client";

import { confirmAction } from "@/shared/components/ui/confirm-dialog";
import { useToast } from "@/shared/components/ui/toast";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { audienceRuleSchema, type AudienceRuleInput } from "@/features/marketing/schemas/marketing.schema";
import { createAudienceAction, deleteAudienceAction, previewAudienceAction, updateAudienceAction } from "@/features/marketing/actions/audiences.action";
import { Button, selectClass } from "@/shared/components/ui/button";
import { TextField } from "@/shared/components/ui/text-field";
import { CONTACT_SOURCES, LIFECYCLE_STAGES, MARKETING_CHANNELS } from "@/features/marketing/types/constants";
import { CHANNEL_LABELS, EXCLUSION_LABELS, LIFECYCLE_LABELS, SOURCE_LABELS } from "@/features/marketing/labels";
import type { AudiencePreviewDto, AudienceDto } from "@/server/marketing/audience.service";
import type { TagDto } from "@/server/marketing/tag.service";
import type { MarketingChannel } from "@/features/marketing/types/constants";

type Condition = AudienceRuleInput["conditions"][number];
type ConditionType = Condition["type"];

const TYPE_LABELS: Record<ConditionType, string> = {
  lifecycle_stage: "Lifecycle stage is one of",
  source: "Source is one of",
  active: "Contact is",
  tags: "Has tags",
  consent: "Marketing consent",
  created_after: "Added after",
};

function emptyCondition(type: ConditionType, firstTag: string | undefined): Condition {
  switch (type) {
    case "lifecycle_stage":
      return { type, values: ["lead"] };
    case "source":
      return { type, values: ["manual"] };
    case "active":
      return { type, value: true };
    case "tags":
      return { type, tagIds: firstTag ? [firstTag] : [], match: "any" };
    case "consent":
      return { type, channel: "email", status: "granted" };
    case "created_after":
      return { type, date: new Date().toISOString().slice(0, 10) };
  }
}

/**
 * Builds the typed rule that the server validates. The builder can express only the supported conditions,
 * so nothing outside that set can be submitted, and the server re-checks every field.
 */
export function AudienceBuilder({
  audience,
  tags,
  canManage,
}: {
  audience?: AudienceDto;
  tags: TagDto[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(audience?.name ?? "");
  const [description, setDescription] = useState(audience?.description ?? "");
  const [isActive, setIsActive] = useState(audience?.isActive ?? true);
  const [rule, setRule] = useState<AudienceRuleInput>(audience?.rule ?? { match: "all", conditions: [{ type: "lifecycle_stage", values: ["lead"] }] });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<AudiencePreviewDto | null>(null);
  const [previewChannel, setPreviewChannel] = useState<MarketingChannel>("email");
  const [pending, startTransition] = useTransition();
  const toast = useToast();
  const firstTag = tags[0]?.id;

  const setCondition = (index: number, next: Condition) =>
    setRule((current) => ({ ...current, conditions: current.conditions.map((item, i) => (i === index ? next : item)) }));

  const removeCondition = (index: number) =>
    setRule((current) => ({ ...current, conditions: current.conditions.filter((_, i) => i !== index) }));

  const addCondition = () => {
    const used = new Set(rule.conditions.map((condition) => condition.type));
    const type = (["lifecycle_stage", "source", "active", "tags", "consent", "created_after"] as ConditionType[]).find((item) => !used.has(item)) ?? "active";
    setRule((current) => ({ ...current, conditions: [...current.conditions, emptyCondition(type, firstTag)] }));
  };

  const toggleValue = <T extends string>(values: T[], value: T): T[] =>
    values.includes(value) ? values.filter((item) => item !== value) : [...values, value];

  const runPreview = () =>
    startTransition(async () => {
      const parsed = audienceRuleSchema.safeParse(rule);
      if (!parsed.success) return toast.error(parsed.error.issues[0]?.message ?? "Check the rule.");
      const result = await previewAudienceAction({ rule: parsed.data, channel: previewChannel });
      if (!result.ok) return toast.fromError(result.error);
      setPreview(result.data);
    });

  const save = () =>
    startTransition(async () => {
      setErrors({});
      const payload = { name, description, isActive, rule };
      const result = audience
        ? await updateAudienceAction(audience.id, { ...payload, expectedVersion: audience.version })
        : await createAudienceAction(payload);
      if (!result.ok) {
        setErrors(result.error.details ?? {});
        return toast.fromError(result.error);
      }
      if (audience) {
        toast.success("Audience saved.");
        router.refresh();
      } else {
        router.push(`/marketing/audiences/${result.data.id}`);
        router.refresh();
      }
    });

  const remove = async () => {
    if (!audience) return;
    if (!(await confirmAction({ title: `Delete "${audience.name}"?`, message: "The audience is permanently removed.", tone: "danger", confirmLabel: "Delete audience" }))) return;
    startTransition(async () => {
      const result = await deleteAudienceAction(audience.id);
      if (!result.ok) return toast.fromError(result.error);
      router.push("/marketing/audiences");
      router.refresh();
    });
  };

  const summary = useMemo(() => {
    const parts = rule.conditions.map((condition) => {
      switch (condition.type) {
        case "lifecycle_stage":
          return `stage: ${condition.values.map((v) => LIFECYCLE_LABELS[v]).join(", ")}`;
        case "source":
          return `source: ${condition.values.map((v) => SOURCE_LABELS[v]).join(", ")}`;
        case "active":
          return condition.value ? "active" : "inactive";
        case "tags":
          return `tags (${condition.match}): ${condition.tagIds.length}`;
        case "consent":
          return `${CHANNEL_LABELS[condition.channel]} consent ${condition.status === "granted" ? "granted" : "not granted"}`;
        case "created_after":
          return `added after ${condition.date}`;
      }
    });
    return parts.join(rule.match === "all" ? " AND " : " OR ");
  }, [rule]);

  const disabled = !canManage || pending;

  return (
    <div className="space-y-6">
      <section aria-labelledby="audience-details" className="space-y-4 rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5">
        <h2 id="audience-details" className="text-base font-semibold">Details</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Audience name" value={name} onChange={(event) => setName(event.target.value)} disabled={disabled} error={errors.name} />
          <label className="inline-flex min-h-[44px] items-center gap-3 self-end text-sm">
            <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} disabled={disabled} className="h-4 w-4 accent-[var(--color-action-primary)]" />
            Active (can be used by campaigns)
          </label>
          <div className="space-y-1.5 sm:col-span-2">
            <label htmlFor="audience-description" className="text-sm font-semibold">Description</label>
            <textarea id="audience-description" rows={2} value={description} maxLength={500} onChange={(event) => setDescription(event.target.value)} disabled={disabled} className="w-full rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] p-3 text-sm" />
          </div>
        </div>
      </section>

      <section aria-labelledby="audience-rules" className="space-y-4 rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="audience-rules" className="text-base font-semibold">Selection rule</h2>
            <p className="text-sm text-[var(--color-text-secondary)]">Membership is evaluated when you preview and when a campaign is approved. It is never stored as a list.</p>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <label htmlFor="rule-match" className="font-semibold">Match</label>
            <select id="rule-match" className={selectClass} value={rule.match} disabled={disabled} onChange={(event) => setRule((current) => ({ ...current, match: event.target.value as "all" | "any" }))}>
              <option value="all">all conditions</option>
              <option value="any">any condition</option>
            </select>
          </div>
        </div>

        <ol className="space-y-3">
          {rule.conditions.map((condition, index) => (
            <li key={index} className="space-y-3 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <label className="sr-only" htmlFor={`cond-type-${index}`}>Condition type</label>
                <select
                  id={`cond-type-${index}`}
                  className={selectClass}
                  value={condition.type}
                  disabled={disabled}
                  onChange={(event) => setCondition(index, emptyCondition(event.target.value as ConditionType, firstTag))}
                >
                  {(Object.keys(TYPE_LABELS) as ConditionType[]).map((type) => (
                    <option key={type} value={type}>{TYPE_LABELS[type]}</option>
                  ))}
                </select>
                {canManage && (
                  <Button variant="ghost" onClick={() => removeCondition(index)} aria-label={`Remove condition ${index + 1}`} disabled={disabled}>Remove</Button>
                )}
              </div>

              {condition.type === "lifecycle_stage" && (
                <fieldset className="flex flex-wrap gap-2">
                  <legend className="sr-only">Stages</legend>
                  {LIFECYCLE_STAGES.map((stage) => (
                    <label key={stage} className="inline-flex min-h-[44px] items-center gap-2 rounded-[var(--radius-pill)] border border-[var(--color-border-control)] px-3 text-sm">
                      <input type="checkbox" checked={condition.values.includes(stage)} disabled={disabled} onChange={() => setCondition(index, { type: "lifecycle_stage", values: toggleValue(condition.values, stage) })} className="h-4 w-4 accent-[var(--color-action-primary)]" />
                      {LIFECYCLE_LABELS[stage]}
                    </label>
                  ))}
                </fieldset>
              )}
              {condition.type === "source" && (
                <fieldset className="flex flex-wrap gap-2">
                  <legend className="sr-only">Sources</legend>
                  {CONTACT_SOURCES.map((source) => (
                    <label key={source} className="inline-flex min-h-[44px] items-center gap-2 rounded-[var(--radius-pill)] border border-[var(--color-border-control)] px-3 text-sm">
                      <input type="checkbox" checked={condition.values.includes(source)} disabled={disabled} onChange={() => setCondition(index, { type: "source", values: toggleValue(condition.values, source) })} className="h-4 w-4 accent-[var(--color-action-primary)]" />
                      {SOURCE_LABELS[source]}
                    </label>
                  ))}
                </fieldset>
              )}
              {condition.type === "active" && (
                <select aria-label="Contact active state" className={selectClass} value={String(condition.value)} disabled={disabled} onChange={(event) => setCondition(index, { type: "active", value: event.target.value === "true" })}>
                  <option value="true">active</option>
                  <option value="false">inactive</option>
                </select>
              )}
              {condition.type === "tags" && (
                <div className="space-y-2">
                  {tags.length === 0 ? (
                    <p className="text-sm text-[var(--color-text-secondary)]">Create a tag first. <Link className="underline" href="/marketing/tags">Go to tags</Link></p>
                  ) : (
                    <fieldset className="flex flex-wrap gap-2">
                      <legend className="sr-only">Tags</legend>
                      {tags.map((tag) => (
                        <label key={tag.id} className="inline-flex min-h-[44px] items-center gap-2 rounded-[var(--radius-pill)] border border-[var(--color-border-control)] px-3 text-sm">
                          <input type="checkbox" checked={condition.tagIds.includes(tag.id)} disabled={disabled} onChange={() => setCondition(index, { ...condition, tagIds: toggleValue(condition.tagIds, tag.id) })} className="h-4 w-4 accent-[var(--color-action-primary)]" />
                          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tag.color }} />
                          {tag.name}
                        </label>
                      ))}
                    </fieldset>
                  )}
                  <select aria-label="Tag match" className={selectClass} value={condition.match} disabled={disabled} onChange={(event) => setCondition(index, { ...condition, match: event.target.value as "any" | "all" })}>
                    <option value="any">any of these tags</option>
                    <option value="all">all of these tags</option>
                  </select>
                </div>
              )}
              {condition.type === "consent" && (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <select aria-label="Consent channel" className={selectClass} value={condition.channel} disabled={disabled} onChange={(event) => setCondition(index, { ...condition, channel: event.target.value as MarketingChannel })}>
                    {MARKETING_CHANNELS.map((channel) => <option key={channel} value={channel}>{CHANNEL_LABELS[channel]}</option>)}
                  </select>
                  <select aria-label="Consent state" className={selectClass} value={condition.status} disabled={disabled} onChange={(event) => setCondition(index, { ...condition, status: event.target.value as "granted" | "not_granted" })}>
                    <option value="granted">consent granted</option>
                    <option value="not_granted">consent not granted</option>
                  </select>
                </div>
              )}
              {condition.type === "created_after" && (
                <input type="date" aria-label="Added after" value={condition.date} disabled={disabled} onChange={(event) => setCondition(index, { type: "created_after", date: event.target.value })} className="min-h-[44px] rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3 text-sm" />
              )}
            </li>
          ))}
        </ol>

        {canManage && rule.conditions.length < 10 && (
          <Button onClick={addCondition} disabled={disabled}>Add condition</Button>
        )}
        <p className="text-sm text-[var(--color-text-secondary)]"><span className="font-semibold">Rule:</span> {summary || "No conditions"}</p>
      </section>

      <section aria-labelledby="audience-preview" className="space-y-4 rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="audience-preview" className="text-base font-semibold">Preview</h2>
            <p className="text-sm text-[var(--color-text-secondary)]">Estimated recipients for a channel, after consent and suppression rules.</p>
          </div>
          <div className="flex gap-2">
            <label htmlFor="preview-channel" className="sr-only">Channel for preview</label>
            <select id="preview-channel" className={selectClass} value={previewChannel} onChange={(event) => setPreviewChannel(event.target.value as MarketingChannel)}>
              {MARKETING_CHANNELS.map((channel) => <option key={channel} value={channel}>{CHANNEL_LABELS[channel]}</option>)}
            </select>
            <Button onClick={runPreview} disabled={pending}>{pending ? "Calculating…" : "Preview"}</Button>
          </div>
        </div>
        {preview && (
          <div className="space-y-4" aria-live="polite">
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div className="rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)] p-3"><dt className="text-[var(--color-text-secondary)]">Matching contacts</dt><dd className="text-xl font-semibold tabular-nums">{preview.matchedCount}</dd></div>
              <div className="rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)] p-3"><dt className="text-[var(--color-text-secondary)]">Eligible</dt><dd className="text-xl font-semibold tabular-nums">{preview.eligibleCount}</dd></div>
              {(Object.keys(EXCLUSION_LABELS) as (keyof typeof EXCLUSION_LABELS)[]).map((reason) => (
                <div key={reason} className="rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)] p-3"><dt className="text-[var(--color-text-secondary)]">{EXCLUSION_LABELS[reason]}</dt><dd className="text-xl font-semibold tabular-nums">{preview.exclusions[reason]}</dd></div>
              ))}
            </dl>
            {preview.truncated && (
              <p className="text-sm text-[var(--color-status-warning)]">More than {preview.evaluatedCount.toLocaleString("en-US")} contacts match. Only the first {preview.evaluatedCount.toLocaleString("en-US")} were evaluated. Narrow the rule for an exact count.</p>
            )}
            {preview.sample.length > 0 && (
              <ul className="divide-y divide-[var(--color-border-subtle)] text-sm">
                {preview.sample.map((item) => (
                  <li key={item.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
                    <Link href={`/marketing/contacts/${item.id}`} className="break-words font-medium underline-offset-2 hover:underline">{item.name || "Unnamed contact"}</Link>
                    <span className="break-all text-[var(--color-text-secondary)]">{item.email || "No email"} · {item.reason ? EXCLUSION_LABELS[item.reason] : "Eligible"}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>


      {canManage && (
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
          {audience ? (
            <Button variant="danger" onClick={remove} disabled={pending}>Delete audience</Button>
          ) : <span />}
          <Button variant="primary" onClick={save} disabled={pending || name.trim() === ""}>
            {pending ? "Saving…" : audience ? "Save audience" : "Create audience"}
          </Button>
        </div>
      )}
    </div>
  );
}
