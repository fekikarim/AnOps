"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { workOrderInputSchema } from "@/features/manufacturing/schemas/manufacturing.schema";
import { createWorkOrderAction, previewMaterialAvailabilityAction } from "@/features/manufacturing/actions/manufacturing.action";
import { QuickWarehouseForm } from "@/features/inventory/components/quick-create-forms";
import { buildShortagePurchaseHref } from "@/features/purchasing/shortage-link";
import { Check, CircleAlert, CircleCheck, Factory, LoaderCircle, ShoppingCart } from "lucide-react";
import { Button, ButtonLink } from "@/shared/components/ui/button";
import { CreatableSelect } from "@/shared/components/ui/creatable-select";
import { FormActions, FormSection } from "@/shared/components/ui/form-kit";
import { FormMessage } from "@/shared/components/ui/form-message";
import { TextField } from "@/shared/components/ui/text-field";
import { StatusBadge } from "@/shared/components/data-display/status-badge";
import type { MaterialAvailabilityDto } from "@/features/manufacturing/types";

type FormValues = z.input<typeof workOrderInputSchema>;

const QUANTITY = /^\d{1,6}(\.\d{1,6})?$/;
const OBJECT_ID = /^[a-f0-9]{24}$/i;

export function WorkOrderForm({
  boms,
  warehouses,
  canCreateWarehouse = false,
  canCreateBom = false,
  canOrderMaterials = false,
}: {
  boms: { id: string; label: string }[];
  warehouses: { id: string; label: string }[];
  canCreateWarehouse?: boolean;
  canCreateBom?: boolean;
  canOrderMaterials?: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { register, control, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(workOrderInputSchema),
    mode: "onBlur",
    defaultValues: { bomId: boms.length === 1 ? (boms[0]?.id ?? "") : "", warehouseId: warehouses.length === 1 ? (warehouses[0]?.id ?? "") : "", quantity: "", plannedStart: "" },
  });

  const bomId = useWatch({ control, name: "bomId" });
  const warehouseId = useWatch({ control, name: "warehouseId" });
  const quantity = (useWatch({ control, name: "quantity" }) ?? "").trim();

  // Live material check. The result is stored with the inputs it answered, so an answer for older inputs is never
  // shown (no stale guard needed), and a failed check hides itself: the preview is guidance, and the server
  // re-checks everything when the order is completed.
  const checkKey =
    OBJECT_ID.test(bomId) && OBJECT_ID.test(warehouseId) && QUANTITY.test(quantity) && Number(quantity) > 0
      ? `${bomId}|${warehouseId}|${quantity}`
      : null;
  const [checked, setChecked] = useState<{ key: string; data: MaterialAvailabilityDto | null } | null>(null);
  useEffect(() => {
    if (!checkKey) return;
    const [bom, warehouse, qty] = checkKey.split("|") as [string, string, string];
    const timer = setTimeout(async () => {
      const result = await previewMaterialAvailabilityAction({ bomId: bom, warehouseId: warehouse, quantity: qty });
      setChecked({ key: checkKey, data: result.ok ? result.data : null });
    }, 350);
    return () => clearTimeout(timer);
  }, [checkKey]);
  const answered = checkKey !== null && checked?.key === checkKey;
  const availability = answered ? checked.data : null;
  const checking = checkKey !== null && !answered;

  const onSubmit = (values: FormValues) => {
    setMessage(null);
    startTransition(async () => {
      const result = await createWorkOrderAction(values);
      if (!result.ok) {
        setMessage(`${result.error.message} (ref ${result.error.requestId.slice(0, 8)})`);
        return;
      }
      router.push(`/manufacturing/work-orders/${result.data.id}`);
    });
  };

  const noBoms = boms.length === 0;
  const shortLines = availability?.materials.filter((m) => !m.sufficient) ?? [];

  if (noBoms) {
    return (
      <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border-control)] bg-[var(--color-bg-surface)] p-6 text-center">
        <p className="text-base font-semibold text-[var(--color-text-primary)]">You need a bill of materials first</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-[var(--color-text-secondary)]">
          A bill of materials (BOM) is the recipe for a product: which components, and how many of each, make one unit. A work order uses an active BOM to plan what to produce.
        </p>
        <div className="mt-5 flex justify-center">
          {canCreateBom ? (
            <ButtonLink href="/manufacturing/boms/new" variant="primary">Create a bill of materials</ButtonLink>
          ) : (
            <p className="text-sm text-[var(--color-text-secondary)]">Ask someone who can manage BOMs to create and activate one.</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <form noValidate onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {message && <FormMessage kind="error">{message}</FormMessage>}
      <p className="text-sm text-[var(--color-text-secondary)]">
        Creating a work order does not consume stock. Components are used when the order is completed.
      </p>
      <fieldset disabled={pending} className="min-w-0 space-y-6">
        <legend className="sr-only">Work order</legend>
        <FormSection title="Production run" description="What to produce, how much and where." icon={Factory}>
          <Controller
            control={control}
            name="bomId"
            render={({ field }) => (
              <CreatableSelect
                id="bomId"
                label="Bill of materials (active revision)"
                required
                value={field.value}
                onChange={field.onChange}
                options={boms}
                placeholder="Select a bill of materials…"
                hint="The recipe to follow. Only active revisions are listed."
                error={errors.bomId?.message}
                className="sm:col-span-2"
              />
            )}
          />
          <TextField label="Quantity to produce" required placeholder="e.g. 100" inputMode="decimal" error={errors.quantity?.message} {...register("quantity")} />
          <Controller
            control={control}
            name="warehouseId"
            render={({ field }) => (
              <CreatableSelect
                id="warehouseId"
                label="Warehouse for components and output"
                required
                value={field.value}
                onChange={field.onChange}
                options={warehouses}
                placeholder="Select a warehouse…"
                createLabel="New warehouse"
                createTitle="New warehouse"
                createDescription="A place where stock is kept."
                hint="Components are taken from here and the finished goods are added here."
                emptyHint="You need a warehouse for production. Create one here."
                error={errors.warehouseId?.message}
                renderCreate={canCreateWarehouse ? (props) => <QuickWarehouseForm {...props} /> : undefined}
              />
            )}
          />
          <TextField label="Planned start" type="date" hint="Optional." error={errors.plannedStart?.message} {...register("plannedStart")} />
        </FormSection>

        {(availability || checking) && (
          <section aria-labelledby="materials-check-heading" aria-busy={checking} className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border-subtle)] px-4 py-3 sm:px-6">
              <h2 id="materials-check-heading" className="text-base font-semibold">Material check</h2>
              {checking ? (
                <span className="inline-flex items-center gap-2 text-sm text-[var(--color-text-secondary)]"><LoaderCircle aria-hidden className="size-4 animate-spin" />Checking stock…</span>
              ) : availability ? (
                <StatusBadge label={availability.shortCount === 0 ? "All materials available" : `${availability.shortCount} short`} tone={availability.shortCount === 0 ? "success" : "warning"} />
              ) : null}
            </header>
            {availability && (
              <div className="space-y-4 p-4 sm:p-6">
                <ul className="divide-y divide-[var(--color-border-subtle)] rounded-[var(--radius-control)] border border-[var(--color-border-subtle)]">
                  {availability.materials.map((m) => (
                    <li key={m.productId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-3 py-2.5 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-[var(--color-text-primary)]">{m.sku}</p>
                        <p className="truncate text-xs text-[var(--color-text-secondary)]">{m.productName}</p>
                      </div>
                      <p className="text-right text-xs tabular-nums text-[var(--color-text-secondary)]">
                        need <span className="font-semibold text-[var(--color-text-primary)]">{m.planned}</span> · have {m.onHand} {m.unitOfMeasure}
                        {!m.sufficient && <span className="block font-semibold text-[var(--color-status-warning)]">short {m.shortfall}</span>}
                      </p>
                    </li>
                  ))}
                </ul>
                {shortLines.length === 0 ? (
                  <p role="status" className="flex items-center gap-2 text-sm text-[var(--color-status-success)]">
                    <CircleCheck aria-hidden className="size-4 shrink-0" />
                    {availability.warehouseCode} holds everything this run needs.
                  </p>
                ) : (
                  <div role="status" className="space-y-3 rounded-[var(--radius-control)] border border-[var(--color-status-warning)] bg-[var(--color-status-warning-bg)] p-3 text-sm text-[var(--color-status-warning)]">
                    <p className="flex gap-2">
                      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                      <span>
                        {shortLines.length} material{shortLines.length === 1 ? " is" : "s are"} short in {availability.warehouseCode}. You can still save this as a plan, but it cannot be completed until stock covers it.
                      </span>
                    </p>
                    {canOrderMaterials ? (
                      <Link
                        href={buildShortagePurchaseHref(shortLines.map((m) => ({ productId: m.productId, quantity: m.shortfallExact })))}
                        className="inline-flex min-h-[44px] items-center gap-2 rounded-[var(--radius-control)] border border-current px-4 font-semibold hover:bg-black/5 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)]"
                      >
                        <ShoppingCart aria-hidden className="size-4" />
                        Order the missing materials
                      </Link>
                    ) : (
                      <p>Ask a buyer to order the missing materials.</p>
                    )}
                  </div>
                )}
                <p className="text-xs text-[var(--color-text-secondary)]">
                  This is a live look at stock, not a reservation. Completion re-checks and consumes stock at the moment it runs.
                </p>
              </div>
            )}
          </section>
        )}

        <FormActions>
          <Button onClick={() => router.back()} disabled={pending}>Cancel</Button>
          <Button type="submit" variant="primary">
            {pending ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <Check aria-hidden className="size-4" />}
            {pending ? "Creating…" : "Create work order"}
          </Button>
        </FormActions>
      </fieldset>
    </form>
  );
}
