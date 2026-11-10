"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { purchaseOrderInputSchema, MAX_PURCHASE_ORDER_LINES } from "@/features/purchasing/schemas/purchasing.schema";
import { createPurchaseOrderAction, updatePurchaseOrderAction } from "@/features/purchasing/actions/purchasing.action";
import { getStockContextAction } from "@/features/inventory/actions/inventory.action";
import { QuickProductForm } from "@/features/inventory/components/quick-create-forms";
import { QuickSupplierForm } from "@/features/purchasing/components/quick-supplier-form";
import { Check, Info, LoaderCircle, PackagePlus, Plus, StickyNote, Trash2, Truck } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { CreatableSelect, type SelectOption } from "@/shared/components/ui/creatable-select";
import { Field, FormActions, FormSection, Textarea } from "@/shared/components/ui/form-kit";
import { FormMessage } from "@/shared/components/ui/form-message";
import { TextField } from "@/shared/components/ui/text-field";
import { cn } from "@/shared/lib/utils";
import type { ProductStockContext } from "@/server/inventory/onboarding.service";

type FormValues = z.input<typeof purchaseOrderInputSchema>;

type Option = { id: string; label: string; cost?: string };

const EMPTY_LINE = { productId: "", quantity: "", unitCost: "0.000", taxRate: "0" };

/** One line of context under a product: what you have, when you reorder, what is already coming. */
function StockHint({ context }: { context: ProductStockContext | undefined }) {
  if (!context) return null;
  const onHand = Number(context.onHand);
  const reorder = Number(context.reorderPoint);
  const onOrder = Number(context.onOrder);
  const low = reorder > 0 && onHand <= reorder;
  return (
    <p className={cn("flex items-start gap-1.5 text-xs", low ? "text-[var(--color-status-warning)]" : "text-[var(--color-text-secondary)]")}>
      <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <span>
        In stock: <strong className="font-semibold tabular-nums">{context.onHand}</strong>
        {reorder > 0 && <> · reorder at {context.reorderPoint}</>}
        {onOrder > 0 && <> · {context.onOrder} already on order</>}
        {low && onOrder === 0 && <> · below the reorder point</>}
      </span>
    </p>
  );
}

export function PurchaseOrderForm({
  suppliers,
  products,
  initial,
  orderId,
  version,
  currencyCode,
  categories = [],
  canCreateSupplier = false,
  canCreateProduct = false,
  prefillNotice,
}: {
  suppliers: Option[];
  products: Option[];
  initial?: FormValues;
  orderId?: string;
  version?: number;
  currencyCode: string;
  categories?: { id: string; name: string }[];
  canCreateSupplier?: boolean;
  canCreateProduct?: boolean;
  /** Shown when lines were prefilled from another screen, so the user knows where the numbers came from. */
  prefillNotice?: string;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const isEdit = Boolean(orderId);

  const { register, control, handleSubmit, setValue, getValues, formState: { errors, touchedFields } } = useForm<FormValues>({
    resolver: zodResolver(purchaseOrderInputSchema),
    mode: "onBlur",
    defaultValues: initial ?? {
      // With a single supplier there is nothing to decide, so it is chosen for the user.
      supplierId: suppliers.length === 1 ? (suppliers[0]?.id ?? "") : "",
      expectedDate: "",
      notes: "",
      lines: [EMPTY_LINE],
    },
  });
  const { fields, append, remove } = useFieldArray({ control, name: "lines" });

  // Live stock facts per product. Fetched from the server on selection; never cached across pages.
  const [contexts, setContexts] = useState<Record<string, ProductStockContext>>({});
  const requested = useRef(new Set<string>());
  const loadContext = useCallback((ids: string[]) => {
    const missing = ids.filter((id) => id && !requested.current.has(id));
    if (missing.length === 0) return;
    missing.forEach((id) => requested.current.add(id));
    void getStockContextAction(missing).then((result) => {
      if (!result.ok) {
        // Allow a retry the next time the product is picked; a hint is never worth blocking the form.
        missing.forEach((id) => requested.current.delete(id));
        return;
      }
      setContexts((current) => ({ ...current, ...Object.fromEntries(result.data.map((item) => [item.productId, item])) }));
    });
  }, []);
  useEffect(() => {
    loadContext(getValues("lines").map((line) => line.productId));
  }, [getValues, loadContext]);

  const applyProduct = (index: number, option: SelectOption | undefined) => {
    if (!option) return;
    loadContext([option.id]);
    // Suggest the product's standard cost until the user has typed a price of their own.
    const unitCost = getValues(`lines.${index}.unitCost`);
    const cost = option.data?.cost ?? products.find((product) => product.id === option.id)?.cost;
    if (cost && (unitCost === "" || Number(unitCost) === 0) && !touchedFields.lines?.[index]?.unitCost) {
      setValue(`lines.${index}.unitCost`, cost);
    }
  };

  const onSubmit = (values: FormValues) => {
    setMessage(null);
    startTransition(async () => {
      const result = isEdit && orderId
        ? await updatePurchaseOrderAction(orderId, { ...values, expectedVersion: version })
        : await createPurchaseOrderAction(values);
      if (!result.ok) {
        setMessage(`${result.error.message} (ref ${result.error.requestId.slice(0, 8)})`);
        return;
      }
      router.push(`/purchasing/orders/${result.data.id}`);
    });
  };

  return (
    <form noValidate onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {message && <FormMessage kind="error">{message}</FormMessage>}
      {prefillNotice && (
        <p role="status" className="flex gap-2 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] p-3 text-sm text-[var(--color-text-secondary)]">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          {prefillNotice}
        </p>
      )}

      <fieldset disabled={pending} className="min-w-0 space-y-6">
        <legend className="sr-only">Purchase order</legend>
        <FormSection title="Order details" description="Who you are buying from and when you expect delivery." icon={Truck}>
          <Controller
            control={control}
            name="supplierId"
            render={({ field }) => (
              <CreatableSelect
                id="supplierId"
                label="Supplier"
                required
                value={field.value}
                onChange={field.onChange}
                options={suppliers}
                placeholder="Select a supplier…"
                createLabel="New supplier"
                createTitle="New supplier"
                createDescription="Saved to your supplier list, ready for every future order."
                emptyHint="No suppliers yet. Create the first one without leaving this order."
                error={errors.supplierId?.message}
                renderCreate={canCreateSupplier ? (props) => <QuickSupplierForm {...props} /> : undefined}
              />
            )}
          />
          <TextField label="Expected delivery" type="date" hint="Optional. The date the supplier committed to." error={errors.expectedDate?.message} {...register("expectedDate")} />
        </FormSection>

        <FormSection
          title={`Order lines (${fields.length})`}
          description="Products, quantities and prices. Totals are calculated by the server when you save."
          icon={PackagePlus}
          columns={1}
          actions={
            <Button onClick={() => append(EMPTY_LINE)} disabled={pending || fields.length >= MAX_PURCHASE_ORDER_LINES}>
              <Plus aria-hidden className="size-4" />
              Add line
            </Button>
          }
        >
          {errors.lines?.root?.message && <p role="alert" className="text-sm text-[var(--color-status-error)]">{errors.lines.root.message}</p>}
          <ul className="space-y-4">
            {fields.map((field, index) => (
              <li key={field.id} className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-canvas)] p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">Line {index + 1}</span>
                  <Button variant="ghost" onClick={() => remove(index)} disabled={pending || fields.length === 1} aria-label={`Remove line ${index + 1}`} className="min-h-[44px] px-2 text-[var(--color-status-error)]">
                    <Trash2 aria-hidden className="size-4" />
                    Remove
                  </Button>
                </div>
                <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-[minmax(0,2fr)_1fr_1fr_1fr]">
                  <div className="space-y-1.5 sm:col-span-3 lg:col-span-1">
                    <Controller
                      control={control}
                      name={`lines.${index}.productId`}
                      render={({ field: productField }) => (
                        <CreatableSelect
                          id={`lines-${index}-productId`}
                          label="Product"
                          required
                          value={productField.value}
                          onChange={productField.onChange}
                          onSelectOption={(option) => applyProduct(index, option)}
                          options={products.map((product) => ({ id: product.id, label: product.label, data: product.cost ? { cost: product.cost } : undefined }))}
                          placeholder="Select a product…"
                          createLabel="New product"
                          createTitle="New product"
                          createDescription="Created in your catalogue and added to this line."
                          emptyHint="No products yet. Create one here to keep going."
                          error={errors.lines?.[index]?.productId?.message}
                          renderCreate={canCreateProduct ? (props) => <QuickProductForm {...props} categories={categories} /> : undefined}
                        />
                      )}
                    />
                    <ProductHint control={control} index={index} contexts={contexts} />
                  </div>
                  <TextField label="Quantity" required placeholder="e.g. 25" inputMode="decimal" error={errors.lines?.[index]?.quantity?.message} {...register(`lines.${index}.quantity`)} />
                  <TextField label={`Unit cost (${currencyCode})`} placeholder="0.000" inputMode="decimal" error={errors.lines?.[index]?.unitCost?.message} {...register(`lines.${index}.unitCost`)} />
                  <TextField label="Tax rate (%)" placeholder="e.g. 19" inputMode="decimal" error={errors.lines?.[index]?.taxRate?.message} {...register(`lines.${index}.taxRate`)} />
                </div>
              </li>
            ))}
          </ul>
        </FormSection>

        <FormSection title="Notes" description="Optional. Visible on the order for your team." icon={StickyNote} columns={1}>
          <Field label="Internal notes" htmlFor="notes" error={errors.notes?.message}>
            <Textarea id="notes" rows={3} maxLength={1000} placeholder="e.g. Deliver to dock 2, call the supplier before dispatch" {...register("notes")} />
          </Field>
        </FormSection>
      </fieldset>

      <FormActions>
        <Button onClick={() => router.back()} disabled={pending}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <Check aria-hidden className="size-4" />}
          {pending ? "Saving…" : isEdit ? "Save draft" : "Create draft order"}
        </Button>
      </FormActions>
    </form>
  );
}

/** Reads the selected product for a line from the form so the hint follows the choice. */
function ProductHint({
  control,
  index,
  contexts,
}: {
  control: ReturnType<typeof useForm<FormValues>>["control"];
  index: number;
  contexts: Record<string, ProductStockContext>;
}) {
  return (
    <Controller
      control={control}
      name={`lines.${index}.productId`}
      render={({ field }) => <StockHint context={field.value ? contexts[field.value] : undefined} />}
    />
  );
}
