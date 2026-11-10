"use client";

import { useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Check, LoaderCircle } from "lucide-react";
import { categoryInputSchema, productWithOpeningStockSchema, warehouseInputSchema } from "@/features/inventory/schemas/inventory.schema";
import { createCategoryAction, createProductWithStockAction, createWarehouseAction } from "@/features/inventory/actions/inventory.action";
import { UNIT_LABELS, UNITS_OF_MEASURE } from "@/shared/domain/units";
import { Button } from "@/shared/components/ui/button";
import { Field, Select, Textarea } from "@/shared/components/ui/form-kit";
import { FormMessage } from "@/shared/components/ui/form-message";
import { TextField } from "@/shared/components/ui/text-field";
import { suggestSku, suggestWarehouseCode } from "@/features/inventory/suggestions";
import type { CreateFormProps } from "@/shared/components/ui/creatable-select";
import type { ProductCreatedResult } from "@/features/inventory/types";

/**
 * Compact creation forms shown inside a drawer or a wizard step. Each one calls the same server action as the
 * full page and hands back the record the server created. They stop submit events from bubbling, because React
 * forwards events from a portal to the form that opened it and that form must not submit by accident.
 */

function Actions({ pending, submitLabel, onCancel }: { pending: boolean; submitLabel: string; onCancel?: () => void }) {
  return (
    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
      {onCancel && <Button onClick={onCancel} disabled={pending}>Cancel</Button>}
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <Check aria-hidden className="size-4" />}
        {pending ? "Saving…" : submitLabel}
      </Button>
    </div>
  );
}

type CategoryValues = z.input<typeof categoryInputSchema>;

export function QuickCategoryForm({ onCreated, onCancel, submitLabel = "Create category" }: CreateFormProps & { submitLabel?: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { register, handleSubmit, setError, formState: { errors } } = useForm<CategoryValues>({
    resolver: zodResolver(categoryInputSchema),
    mode: "onBlur",
    defaultValues: { name: "", description: "" },
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
            const result = await createCategoryAction(values);
            if (!result.ok) {
              const nameError = result.error.details?.name;
              if (nameError) setError("name", { message: nameError });
              setMessage(result.error.message);
              return;
            }
            onCreated({ id: result.data.id, label: result.data.name });
          })
        )(event);
      }}
    >
      {message && <FormMessage kind="error">{message}</FormMessage>}
      <TextField label="Category name" required placeholder="e.g. Raw materials" maxLength={80} error={errors.name?.message} {...register("name")} />
      <Field label="Description" htmlFor="quick-category-description" hint="Optional. Helps your team pick the right one." error={errors.description?.message}>
        <Textarea id="quick-category-description" rows={2} maxLength={300} placeholder="e.g. Components used in production" {...register("description")} />
      </Field>
      <Actions pending={pending} submitLabel={submitLabel} onCancel={onCancel} />
    </form>
  );
}

type WarehouseValues = z.input<typeof warehouseInputSchema>;

export function QuickWarehouseForm({ onCreated, onCancel, submitLabel = "Create warehouse" }: CreateFormProps & { submitLabel?: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { register, handleSubmit, setError, setValue, getFieldState, formState: { errors, dirtyFields } } = useForm<WarehouseValues>({
    resolver: zodResolver(warehouseInputSchema),
    mode: "onBlur",
    defaultValues: { name: "", code: "", address: "", isActive: true },
  });
  const nameField = register("name");
  return (
    <form
      noValidate
      className="grid gap-5"
      onSubmit={(event) => {
        event.stopPropagation();
        void handleSubmit((values) =>
          startTransition(async () => {
            setMessage(null);
            const result = await createWarehouseAction(values);
            if (!result.ok) {
              for (const [field, text] of Object.entries(result.error.details ?? {})) {
                if (field === "name" || field === "code" || field === "address") setError(field, { message: text });
              }
              setMessage(result.error.message);
              return;
            }
            onCreated({ id: result.data.id, label: `${result.data.code} · ${result.data.name}` });
          })
        )(event);
      }}
    >
      {message && <FormMessage kind="error">{message}</FormMessage>}
      <TextField
        label="Warehouse name"
        required
        placeholder="e.g. Main warehouse"
        hint="Where the goods physically are: a building, a room or a shelf area."
        maxLength={120}
        error={errors.name?.message}
        {...nameField}
        onChange={(event) => {
          void nameField.onChange(event);
          // Suggest a code until the user types their own.
          if (!dirtyFields.code && !getFieldState("code").isTouched) setValue("code", suggestWarehouseCode(event.target.value));
        }}
      />
      <TextField label="Short code" required placeholder="e.g. MAIN" hint="2 to 12 letters or digits. Shown next to stock quantities." maxLength={12} autoCapitalize="characters" error={errors.code?.message} {...register("code")} />
      <TextField label="Address" placeholder="e.g. Zone industrielle, Sfax" hint="Optional." maxLength={300} error={errors.address?.message} {...register("address")} />
      <Actions pending={pending} submitLabel={submitLabel} onCancel={onCancel} />
    </form>
  );
}

type QuickProductValues = z.input<typeof productWithOpeningStockSchema>;
type QuickProductSubmit = z.output<typeof productWithOpeningStockSchema>;

export function QuickProductForm({
  onCreated,
  onCancel,
  categories,
  warehouses,
  currencyCode = "",
  onResult,
  submitLabel = "Create product",
}: CreateFormProps & {
  categories?: { id: string; name: string }[];
  /** When given, the form also records opening stock in one of these warehouses. */
  warehouses?: { id: string; label: string }[];
  currencyCode?: string;
  /** Receives the full server result, including whether opening stock was posted. */
  onResult?: (result: ProductCreatedResult) => void;
  submitLabel?: string;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { register, control, handleSubmit, setError, setValue, getFieldState, formState: { errors, dirtyFields } } = useForm<QuickProductValues, unknown, QuickProductSubmit>({
    resolver: zodResolver(productWithOpeningStockSchema),
    mode: "onBlur",
    defaultValues: {
      sku: "",
      name: "",
      description: "",
      categoryId: "",
      unitOfMeasure: "unit",
      isStorable: true,
      isActive: true,
      cost: "0.000",
      salePrice: "0.000",
      reorderPoint: "0",
      openingWarehouseId: "",
      openingQuantity: "0",
    },
  });
  const nameField = register("name");
  const cost = useWatch({ control, name: "cost" });
  const quantity = useWatch({ control, name: "openingQuantity" });
  const stockValue = Number(quantity) > 0 && Number.isFinite(Number(cost)) ? (Number(quantity) * Number(cost)).toFixed(3) : null;
  return (
    <form
      noValidate
      className="grid gap-5"
      onSubmit={(event) => {
        event.stopPropagation();
        void handleSubmit((values) =>
          startTransition(async () => {
            setMessage(null);
            const result = await createProductWithStockAction({ ...values, categoryId: values.categoryId ?? "", openingWarehouseId: values.openingWarehouseId ?? "" });
            if (!result.ok) {
              for (const [field, text] of Object.entries(result.error.details ?? {})) {
                if (["sku", "name", "cost", "unitOfMeasure", "openingWarehouseId", "openingQuantity"].includes(field)) setError(field as keyof QuickProductValues, { message: text });
              }
              setMessage(result.error.message);
              return;
            }
            onResult?.(result.data);
            onCreated({
              id: result.data.product.id,
              label: `${result.data.product.sku} · ${result.data.product.name} (${result.data.product.unitOfMeasure})`,
              data: { cost: result.data.product.cost },
            });
          })
        )(event);
      }}
    >
      {message && <FormMessage kind="error">{message}</FormMessage>}
      <TextField
        label="Product name"
        required
        placeholder="e.g. Steel sheet 2 mm"
        maxLength={120}
        error={errors.name?.message}
        {...nameField}
        onChange={(event) => {
          void nameField.onChange(event);
          if (!dirtyFields.sku && !getFieldState("sku").isTouched) setValue("sku", suggestSku(event.target.value));
        }}
      />
      <TextField label="SKU" required placeholder="e.g. STEEL-SHEET-2-MM" hint="Your unique code for this product. We suggest one from the name." error={errors.sku?.message} {...register("sku")} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Unit of measure" htmlFor="quick-product-unit" required hint="How you count it." error={errors.unitOfMeasure?.message}>
          <Select id="quick-product-unit" {...register("unitOfMeasure")}>
            {UNITS_OF_MEASURE.map((unit) => (
              <option key={unit} value={unit}>{UNIT_LABELS[unit]}</option>
            ))}
          </Select>
        </Field>
        <TextField label="Standard cost" placeholder="0.000" inputMode="decimal" hint="What one unit costs you." error={errors.cost?.message} {...register("cost")} />
      </div>
      {categories && categories.length > 0 && (
        <Field label="Category" htmlFor="quick-product-category" hint="Optional." error={errors.categoryId?.message}>
          <Select id="quick-product-category" {...register("categoryId")}>
            <option value="">No category</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>{category.name}</option>
            ))}
          </Select>
        </Field>
      )}
      {warehouses ? (
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Warehouse" htmlFor="quick-product-warehouse" hint="Only needed if you already have some." error={errors.openingWarehouseId?.message}>
            <Select id="quick-product-warehouse" {...register("openingWarehouseId")}>
              <option value="">Choose a warehouse…</option>
              {warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>{warehouse.label}</option>
              ))}
            </Select>
          </Field>
          <TextField
            label="Quantity on hand"
            placeholder="0"
            inputMode="decimal"
            hint={stockValue ? `Stock value: ${stockValue} ${currencyCode}`.trim() : "Leave at 0 to add stock later."}
            error={errors.openingQuantity?.message}
            {...register("openingQuantity")}
          />
        </div>
      ) : (
        <p className="text-xs text-[var(--color-text-secondary)]">You can add a description, reorder point and opening stock later from the product page.</p>
      )}
      <Actions pending={pending} submitLabel={submitLabel} onCancel={onCancel} />
    </form>
  );
}
