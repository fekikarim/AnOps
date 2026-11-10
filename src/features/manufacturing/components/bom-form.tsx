"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { bomInputSchema, MAX_BOM_COMPONENTS } from "@/features/manufacturing/schemas/manufacturing.schema";
import { createBomAction, updateBomAction } from "@/features/manufacturing/actions/manufacturing.action";
import { Check, Layers, LoaderCircle, PackageOpen, Plus, StickyNote, Trash2, Factory } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Field, FormActions, FormSection, Select, Textarea } from "@/shared/components/ui/form-kit";
import { FormMessage } from "@/shared/components/ui/form-message";
import { TextField } from "@/shared/components/ui/text-field";

type FormValues = z.input<typeof bomInputSchema>;
type Option = { id: string; label: string };

export function BomForm({
  products,
  initial,
  bomId,
  version,
}: {
  products: Option[];
  initial?: FormValues;
  bomId?: string;
  version?: number;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { register, control, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(bomInputSchema),
    mode: "onBlur",
    defaultValues: initial ?? {
      finishedProductId: "",
      notes: "",
      components: [{ productId: "", quantityPerUnit: "" }],
    },
  });
  const { fields, append, remove } = useFieldArray({ control, name: "components" });

  const onSubmit = (values: FormValues) => {
    setMessage(null);
    startTransition(async () => {
      const result = bomId
        ? await updateBomAction(bomId, { ...values, expectedVersion: version })
        : await createBomAction(values);
      if (!result.ok) {
        setMessage(`${result.error.message} (ref ${result.error.requestId.slice(0, 8)})`);
        return;
      }
      router.push(`/manufacturing/boms/${result.data.id}`);
    });
  };

  return (
    <form noValidate onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {message && <FormMessage kind="error">{message}</FormMessage>}
      <fieldset disabled={pending} className="min-w-0 space-y-6">
        <legend className="sr-only">Bill of materials</legend>
        <FormSection title="Finished product" description="The product this bill of materials produces." icon={Factory} columns={1}>
          <Field label="Finished product" htmlFor="finishedProductId" required error={errors.finishedProductId?.message}>
            <Select id="finishedProductId" aria-invalid={Boolean(errors.finishedProductId)} {...register("finishedProductId")}>
              <option value="">Select the product to manufacture…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </Select>
          </Field>
        </FormSection>

        <FormSection
          title={`Components per unit (${fields.length})`}
          description="What is consumed to produce one unit of the finished product."
          icon={Layers}
          columns={1}
          actions={
            <Button onClick={() => append({ productId: "", quantityPerUnit: "" })} disabled={pending || fields.length >= MAX_BOM_COMPONENTS}>
              <Plus aria-hidden className="size-4" />
              Add component
            </Button>
          }
        >
          {errors.components?.root?.message && <p role="alert" className="text-sm text-[var(--color-status-error)]">{errors.components.root.message}</p>}
          {fields.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-[var(--radius-card)] border border-dashed border-[var(--color-border-control)] px-4 py-8 text-center">
              <PackageOpen aria-hidden className="size-6 text-[var(--color-text-secondary)]" />
              <p className="text-sm text-[var(--color-text-secondary)]">No components yet. Add at least one component to define this bill of materials.</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {fields.map((field, index) => (
                <li key={field.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-3 rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-canvas)] p-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-start">
                  <Field label={`Component ${index + 1}`} htmlFor={`components-${index}-productId`} required error={errors.components?.[index]?.productId?.message} className="col-span-2 sm:col-span-1">
                    <Select id={`components-${index}-productId`} aria-invalid={Boolean(errors.components?.[index]?.productId)} {...register(`components.${index}.productId`)}>
                      <option value="">Select a component…</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>{p.label}</option>
                      ))}
                    </Select>
                  </Field>
                  <TextField label="Quantity per unit" required placeholder="e.g. 2.5" inputMode="decimal" error={errors.components?.[index]?.quantityPerUnit?.message} {...register(`components.${index}.quantityPerUnit`)} />
                  <div className="self-start pt-[26px]">
                    <Button variant="ghost" onClick={() => remove(index)} disabled={pending || fields.length === 1} aria-label={`Remove component ${index + 1}`} className="w-11 px-0 text-[var(--color-status-error)]">
                      <Trash2 aria-hidden className="size-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </FormSection>

        <FormSection title="Additional notes" description="Optional. Assembly remarks or revision context." icon={StickyNote} columns={1}>
          <Field label="Notes" htmlFor="notes" error={errors.notes?.message}>
            <Textarea id="notes" rows={3} placeholder="e.g. Use supplier-approved gaskets only" {...register("notes")} />
          </Field>
        </FormSection>
      </fieldset>

      <FormActions>
        <Button onClick={() => router.back()} disabled={pending}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <Check aria-hidden className="size-4" />}
          {pending ? "Saving…" : bomId ? "Save draft" : "Create draft BOM"}
        </Button>
      </FormActions>
    </form>
  );
}
