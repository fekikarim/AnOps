"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Check, LoaderCircle } from "lucide-react";
import { supplierInputSchema } from "@/features/purchasing/schemas/purchasing.schema";
import { createSupplierAction } from "@/features/purchasing/actions/purchasing.action";
import { Button } from "@/shared/components/ui/button";
import { FormMessage } from "@/shared/components/ui/form-message";
import { TextField } from "@/shared/components/ui/text-field";
import type { CreateFormProps } from "@/shared/components/ui/creatable-select";

type SupplierValues = z.input<typeof supplierInputSchema>;

/** Compact supplier creation for drawers and wizard steps. Same server action as the Suppliers page. */
export function QuickSupplierForm({ onCreated, onCancel, submitLabel = "Create supplier" }: CreateFormProps & { submitLabel?: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { register, handleSubmit, setError, formState: { errors } } = useForm<SupplierValues>({
    resolver: zodResolver(supplierInputSchema),
    mode: "onBlur",
    defaultValues: { name: "", email: "", phone: "", taxIdentifier: "", address: "", isActive: true },
  });
  return (
    <form
      noValidate
      className="grid gap-5"
      onSubmit={(event) => {
        event.stopPropagation();
        void handleSubmit((values) =>
          startTransition(async () => {
            setMessage(null);
            const result = await createSupplierAction(values);
            if (!result.ok) {
              for (const [field, text] of Object.entries(result.error.details ?? {})) {
                if (field === "name" || field === "email" || field === "phone") setError(field, { message: text });
              }
              setMessage(result.error.message);
              return;
            }
            onCreated({ id: result.data.id, label: result.data.name });
          })
        )(event);
      }}
    >
      {message && <FormMessage kind="error">{message}</FormMessage>}
      <TextField label="Supplier name" required placeholder="e.g. Acme Metals Ltd" maxLength={120} error={errors.name?.message} {...register("name")} />
      <TextField label="Email" type="email" autoComplete="off" placeholder="e.g. orders@acme-metals.com" hint="Optional. How you contact them about orders." error={errors.email?.message} {...register("email")} />
      <TextField label="Phone" type="tel" placeholder="e.g. +216 71 234 567" hint="Optional. Include the country code." error={errors.phone?.message} {...register("phone")} />
      <p className="text-xs text-[var(--color-text-secondary)]">Tax identifier and address can be added later from the Suppliers page.</p>
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        {onCancel && <Button onClick={onCancel} disabled={pending}>Cancel</Button>}
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <Check aria-hidden className="size-4" />}
          {pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
