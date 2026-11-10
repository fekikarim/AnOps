"use client";

import { confirmAction } from "@/shared/components/ui/confirm-dialog";
import { useToast } from "@/shared/components/ui/toast";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { tagInputSchema } from "@/features/marketing/schemas/marketing.schema";
import type { TagInput } from "@/features/marketing/schemas/marketing.schema";
import { createTagAction, deleteTagAction, updateTagAction } from "@/features/marketing/actions/contacts.action";
import { Button } from "@/shared/components/ui/button";
import { FormMessage } from "@/shared/components/ui/form-message";
import { TextField } from "@/shared/components/ui/text-field";
import type { TagDto } from "@/server/marketing/tag.service";

const PRESET_COLOURS = ["#1f7a5c", "#2563eb", "#b45309", "#be123c", "#6d28d9", "#475569"];

function TagForm({
  tagId,
  defaultValues,
  submitLabel,
  onDone,
}: {
  /** Present when editing an existing tag; absent when creating one. */
  tagId?: string;
  defaultValues: TagInput;
  submitLabel: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const toast = useToast();
  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<TagInput>({
    resolver: zodResolver(tagInputSchema),
    mode: "onBlur",
    defaultValues,
  });
  const colour = watch("color");

  return (
    <form
      noValidate
      className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end"
      onSubmit={handleSubmit((values) =>
        startTransition(async () => {
          const result = tagId ? await updateTagAction(tagId, values) : await createTagAction(values);
          if (!result.ok) return toast.fromError(result.error);
          onDone();
          router.refresh();
        })
      )}
    >
      <TextField label="Tag name" error={errors.name?.message} {...register("name")} />
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Colour</legend>
        <div className="flex flex-wrap items-center gap-2">
          {PRESET_COLOURS.map((preset) => (
            <button
              key={preset}
              type="button"
              aria-label={`Use colour ${preset}`}
              aria-pressed={colour === preset}
              onClick={() => setValue("color", preset, { shouldValidate: true })}
              className="h-11 w-11 rounded-full border-2 border-[var(--color-bg-surface)] shadow-[0_0_0_1px_var(--color-border-control)] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)]"
              style={{ backgroundColor: preset, outline: colour === preset ? "2px solid var(--color-text-primary)" : undefined, outlineOffset: 2 }}
            />
          ))}
        </div>
        <input type="hidden" {...register("color")} />
        {errors.color?.message && <p role="alert" className="text-xs text-[#c0392b]">{errors.color.message}</p>}
      </fieldset>
      <div className="flex gap-2 sm:col-span-2 sm:justify-end">
        <Button onClick={onDone} disabled={pending}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={pending}>{pending ? "Saving…" : submitLabel}</Button>
      </div>
    </form>
  );
}

export function TagManager({ tags, canManage }: { tags: TagDto[]; canManage: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  const remove = async (tag: TagDto) => {
    if (!(await confirmAction({ title: `Delete the tag "${tag.name}"?`, message: `It will be removed from ${tag.contactCount} contact(s).`, tone: "danger", confirmLabel: "Delete tag" }))) return;
    startTransition(async () => {
      const result = await deleteTagAction(tag.id);
      if (!result.ok) return toast.fromError(result.error);
      toast.success(`Tag "${tag.name}" deleted.`);
      router.refresh();
    });
  };

  return (
    <div className="space-y-5">
      {canManage && editing === null && <Button variant="primary" onClick={() => setEditing("new")}>New tag</Button>}

      {canManage && editing === "new" && (
        <section aria-labelledby="new-tag" className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5">
          <h2 id="new-tag" className="mb-4 text-base font-semibold">New tag</h2>
          <TagForm defaultValues={{ name: "", color: PRESET_COLOURS[0] }} submitLabel="Create tag" onDone={() => setEditing(null)} />
        </section>
      )}

      {tags.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border-control)] p-6 text-sm text-[var(--color-text-secondary)]">
          No tags yet. Tags group contacts without changing their lifecycle stage. A contact can carry many tags.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--color-border-subtle)] rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
          {tags.map((tag) => (
            <li key={tag.id} className="p-4">
              {editing === tag.id ? (
                <TagForm
                  tagId={tag.id}
                  defaultValues={{ name: tag.name, color: tag.color }}
                  submitLabel="Save tag"
                  onDone={() => setEditing(null)}
                />
              ) : (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <span aria-hidden="true" className="h-4 w-4 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
                    <div className="min-w-0">
                      <p className="break-words font-medium">{tag.name}</p>
                      <p className="text-sm text-[var(--color-text-secondary)]">{tag.contactCount} contact{tag.contactCount === 1 ? "" : "s"}</p>
                    </div>
                  </div>
                  {canManage && (
                    <div className="flex gap-2">
                      <Button onClick={() => setEditing(tag.id)} disabled={pending}>Edit</Button>
                      <Button variant="danger" onClick={() => remove(tag)} disabled={pending}>Delete</Button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
