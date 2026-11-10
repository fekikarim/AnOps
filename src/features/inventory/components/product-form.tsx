"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { productWithOpeningStockSchema } from "@/features/inventory/schemas/inventory.schema";
import { createProductWithStockAction, updateProductAction } from "@/features/inventory/actions/inventory.action";
import { QuickCategoryForm, QuickWarehouseForm } from "@/features/inventory/components/quick-create-forms";
import { UNIT_LABELS, UNITS_OF_MEASURE } from "@/shared/domain/units";
import { Boxes, Check, DollarSign, LoaderCircle, PackagePlus, Tags } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { CreatableSelect } from "@/shared/components/ui/creatable-select";
import { Field, FormActions, FormSection, Select, Textarea } from "@/shared/components/ui/form-kit";
import { FormMessage } from "@/shared/components/ui/form-message";
import { TextField } from "@/shared/components/ui/text-field";
import { suggestSku } from "@/features/inventory/suggestions";
import type { ProductDto } from "@/features/inventory/types";
import type { ActionError } from "@/shared/lib/errors";

type CategoryOption = { id: string; name: string };
type WarehouseOption = { id: string; label: string };

/** Form state uses the input shape; the submit handler receives the parsed output. */
type ProductFormValues = z.input<typeof productWithOpeningStockSchema>;
type ProductSubmitValues = z.output<typeof productWithOpeningStockSchema>;

const FORM_FIELDS = ["sku", "name", "description", "categoryId", "unitOfMeasure", "cost", "salePrice", "reorderPoint", "openingWarehouseId", "openingQuantity"];

const CHECKBOX_CLASS =
  "h-4 w-4 shrink-0 rounded-[calc(var(--radius-control)*0.5)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] accent-[var(--color-action-primary)] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-offset-[2px] focus-visible:ring-offset-[var(--color-bg-surface)]";

const CREATE_DEFAULTS: ProductFormValues = {
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
};

export function ProductForm({
  mode,
  categories,
  warehouses = [],
  product,
  canManage,
  canCreateCategory = false,
  canCreateWarehouse = false,
  canMoveStock = false,
  currencyCode = "",
}: {
  mode: "create" | "edit";
  categories: CategoryOption[];
  warehouses?: WarehouseOption[];
  product?: ProductDto;
  canManage: boolean;
  canCreateCategory?: boolean;
  canCreateWarehouse?: boolean;
  canMoveStock?: boolean;
  currencyCode?: string;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string; productId?: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const {
    register,
    control,
    handleSubmit,
    setError,
    setValue,
    setFocus,
    getFieldState,
    reset,
    formState: { errors, dirtyFields },
  } = useForm<ProductFormValues, unknown, ProductSubmitValues>({
    resolver: zodResolver(productWithOpeningStockSchema),
    mode: "onBlur",
    defaultValues: product
      ? {
          sku: product.sku,
          name: product.name,
          description: product.description,
          categoryId: product.categoryId ?? "",
          unitOfMeasure: product.unitOfMeasure,
          isStorable: product.isStorable,
          isActive: product.isActive,
          cost: product.cost,
          salePrice: product.salePrice,
          reorderPoint: product.reorderPoint,
          openingWarehouseId: "",
          openingQuantity: "0",
        }
      : CREATE_DEFAULTS,
  });

  const isStorable = useWatch({ control, name: "isStorable" });
  const unit = useWatch({ control, name: "unitOfMeasure" });
  const cost = useWatch({ control, name: "cost" });
  const openingQuantity = useWatch({ control, name: "openingQuantity" });
  const quantityNumber = Number(openingQuantity);
  const costNumber = Number(cost);
  const stockValue =
    Number.isFinite(quantityNumber) && Number.isFinite(costNumber) && quantityNumber > 0 ? (quantityNumber * costNumber).toFixed(3) : null;
  const showOpeningStock = mode === "create" && canMoveStock;

  const nameField = register("name");

  const reportFailure = (error: ActionError) => {
    for (const [field, text] of Object.entries(error.details ?? {})) {
      if (FORM_FIELDS.includes(field)) {
        setError(field as keyof ProductFormValues, { message: text });
      }
    }
    setMessage({ kind: "error", text: `${error.message} (ref ${error.requestId.slice(0, 8)})` });
  };

  const onSubmit = (values: ProductSubmitValues, addAnother: boolean) => {
    setMessage(null);
    const { openingWarehouseId, openingQuantity: openingQty, ...productFields } = values;
    // Re-send the form as its input shape; the server parses it again with the same schema.
    const payload = { ...productFields, categoryId: productFields.categoryId ?? "" };
    startTransition(async () => {
      if (!navigator.onLine) {
        // True offline mode: save locally to IndexedDB and queue sync mutation
        try {
          const { queueOfflineMutation, saveOfflineRecord } = await import("@/shared/lib/offline-store");
          const offlineId = `offline_${Date.now()}`;
          const localRecord = { ...payload, id: offlineId, isOffline: true, createdAt: new Date().toISOString() };

          await saveOfflineRecord("inventory_products", offlineId, localRecord);
          await queueOfflineMutation(
            mode === "edit" && product ? "inventory.product.update" : "inventory.product.create",
            mode === "edit" && product ? { id: product.id, data: payload } : payload
          );

          setMessage({
            kind: "success",
            text:
              "Saved locally in Offline Mode! Changes are safely stored in your browser and will automatically sync when connection returns." +
              (Number(openingQty) > 0 ? " Opening stock is not stored offline: add it from the product page once you are back online." : ""),
          });
          return;
        } catch (e) {
          setMessage({ kind: "error", text: "Failed to store offline: " + (e instanceof Error ? e.message : "Unknown error") });
          return;
        }
      }

      if (mode === "edit" && product) {
        const updated = await updateProductAction(product.id, { ...payload, expectedVersion: product.version });
        if (!updated.ok) return reportFailure(updated.error);
        setMessage({ kind: "success", text: "Product saved." });
        router.refresh();
        return;
      }
      const result = await createProductWithStockAction({ ...payload, openingWarehouseId: openingWarehouseId ?? "", openingQuantity: openingQty });
      if (!result.ok) return reportFailure(result.error);
      const { product: created, openingStock: outcome } = result.data;
      if (outcome.status === "failed") {
        // The product exists but the stock did not post. Say so plainly and stay on the form.
        setMessage({
          kind: "error",
          text: `${created.sku} was created, but its opening stock was not recorded: ${outcome.message ?? "unknown error"}. Open the product to add the stock.`,
          productId: created.id,
        });
        reset({ ...CREATE_DEFAULTS });
        return;
      }
      if (addAnother) {
        reset({ ...CREATE_DEFAULTS, openingWarehouseId: values.openingWarehouseId ?? "" });
        setMessage({
          kind: "success",
          text: `${created.sku} created${outcome.status === "posted" ? " with opening stock" : ""}. Add the next product.`,
          productId: created.id,
        });
        setFocus("name");
        router.refresh();
        return;
      }
      router.push(`/inventory/products/${created.id}`);
    });
  };

  const disabled = !canManage || pending;

  return (
    <form
      noValidate
      onSubmit={(event) => {
        // Which button was pressed decides between "create" and "create and add another".
        const addAnother = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("data-mode") === "another";
        void handleSubmit((values) => onSubmit(values, addAnother))(event);
      }}
      className="space-y-6"
      aria-describedby="product-form-status"
    >
      <div id="product-form-status" aria-live="polite" className="empty:hidden">
        {message && (
          <FormMessage kind={message.kind}>
            {message.text}
            {message.productId && (
              <>
                {" "}
                <Link href={`/inventory/products/${message.productId}`} className="font-semibold underline underline-offset-4">View product</Link>
              </>
            )}
          </FormMessage>
        )}
      </div>
      {!canManage && (
        <p className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] p-3 text-sm text-[var(--color-text-secondary)]">
          You can view this product but cannot change it.
        </p>
      )}

      <fieldset disabled={disabled} className="min-w-0 space-y-6">
        <legend className="sr-only">Product details</legend>
        <FormSection title="Identification" description="How this product is named and found." icon={Boxes}>
          <TextField
            label="Name"
            required
            placeholder="e.g. Steel sheet 2 mm"
            error={errors.name?.message}
            {...nameField}
            onChange={(event) => {
              void nameField.onChange(event);
              // Suggest a SKU from the name until the user types their own.
              if (mode === "create" && !dirtyFields.sku && !getFieldState("sku").isTouched) setValue("sku", suggestSku(event.target.value));
            }}
          />
          <TextField label="SKU" required placeholder="e.g. RM-STEEL-001" hint="Your unique code for this product. Letters, digits, dots and dashes." error={errors.sku?.message} {...register("sku")} />
          <Controller
            control={control}
            name="categoryId"
            render={({ field }) => (
              <CreatableSelect
                id="categoryId"
                label="Category"
                value={field.value ?? ""}
                onChange={field.onChange}
                options={categories.map((category) => ({ id: category.id, label: category.name }))}
                placeholder="No category"
                createLabel="New category"
                createTitle="New category"
                createDescription="Groups products for filtering and reports."
                hint="Optional. Pick one or create it right here."
                error={errors.categoryId?.message}
                renderCreate={canCreateCategory ? (props) => <QuickCategoryForm {...props} /> : undefined}
              />
            )}
          />
          <Field label="Unit of measure" htmlFor="unitOfMeasure" required hint="How you count this product." error={errors.unitOfMeasure?.message}>
            <Select id="unitOfMeasure" {...register("unitOfMeasure")}>
              {UNITS_OF_MEASURE.map((option) => (
                <option key={option} value={option}>{UNIT_LABELS[option]}</option>
              ))}
            </Select>
          </Field>
          <Field label="Description" htmlFor="description" className="sm:col-span-2" hint="Optional. Specifications, grade or handling notes." error={errors.description?.message}>
            <Textarea id="description" rows={3} placeholder="e.g. Cold-rolled, 1250 × 2500 mm" {...register("description")} />
          </Field>
        </FormSection>

        <FormSection title="Pricing and reordering" description="Values used for stock valuation and low-stock alerts." icon={DollarSign}>
          <TextField label="Standard cost" placeholder="0.000" hint="What one unit costs you. Used to value your stock." inputMode="decimal" error={errors.cost?.message} {...register("cost")} />
          <TextField label="Sale price" placeholder="0.000" hint="Informational until sales are connected." inputMode="decimal" error={errors.salePrice?.message} {...register("salePrice")} />
          <TextField label="Reorder point" placeholder="e.g. 20" hint="When stock falls to this level, the product is flagged so you can reorder." inputMode="decimal" error={errors.reorderPoint?.message} {...register("reorderPoint")} />
        </FormSection>

        {showOpeningStock && (
          <FormSection
            title="Opening stock"
            description={isStorable ? "How many you already have. Recorded as a stock receipt, so it is traceable." : "Not available: this product is not tracked in stock."}
            icon={PackagePlus}
          >
            <Controller
              control={control}
              name="openingWarehouseId"
              render={({ field }) => (
                <CreatableSelect
                  id="openingWarehouseId"
                  label="Warehouse"
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  options={warehouses}
                  placeholder="Choose a warehouse…"
                  createLabel="New warehouse"
                  createTitle="New warehouse"
                  createDescription="A place where stock is kept."
                  disabled={!isStorable}
                  emptyHint="You have no warehouse yet. Create one to record opening stock."
                  hint="Where these goods are stored."
                  error={errors.openingWarehouseId?.message}
                  renderCreate={canCreateWarehouse ? (props) => <QuickWarehouseForm {...props} /> : undefined}
                />
              )}
            />
            <TextField
              label={`Quantity on hand${unit ? ` (${UNIT_LABELS[unit]})` : ""}`}
              placeholder="0"
              inputMode="decimal"
              disabled={!isStorable}
              hint={stockValue ? `Opening stock value: ${stockValue} ${currencyCode}`.trim() : "Leave at 0 to add stock later."}
              error={errors.openingQuantity?.message}
              {...register("openingQuantity")}
            />
          </FormSection>
        )}

        <FormSection title="Tracking" description="Whether this product holds stock and can be used." icon={Tags}>
          <label className="inline-flex min-h-[44px] items-center gap-3 text-sm text-[var(--color-text-primary)]">
            <input type="checkbox" className={CHECKBOX_CLASS} {...register("isStorable")} />
            Stored item (tracked in stock)
          </label>
          <label className="inline-flex min-h-[44px] items-center gap-3 text-sm text-[var(--color-text-primary)]">
            <input type="checkbox" className={CHECKBOX_CLASS} {...register("isActive")} />
            Active (available for orders and stock moves)
          </label>
        </FormSection>
      </fieldset>

      {canManage && (
        <FormActions>
          <Button variant="secondary" onClick={() => router.back()} disabled={pending}>Cancel</Button>
          {mode === "create" && (
            <Button
              type="submit"
              variant="secondary"
              disabled={pending}
              data-mode="another"
            >
              Save and add another
            </Button>
          )}
          <Button
            type="submit"
            variant="primary"
            disabled={pending}
          >
            {pending ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <Check aria-hidden className="size-4" />}
            {pending ? "Saving…" : mode === "create" ? "Create product" : "Save changes"}
          </Button>
        </FormActions>
      )}
    </form>
  );
}
