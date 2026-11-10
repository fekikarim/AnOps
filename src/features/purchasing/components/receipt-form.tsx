"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { receiptEntrySchema } from "@/features/purchasing/schemas/purchasing.schema";
import { Controller, useWatch } from "react-hook-form";
import { createReceiptAction, postReceiptAction } from "@/features/purchasing/actions/purchasing.action";
import { QuickWarehouseForm } from "@/features/inventory/components/quick-create-forms";
import { PackageCheck, Save } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { CreatableSelect } from "@/shared/components/ui/creatable-select";
import { FormMessage } from "@/shared/components/ui/form-message";
import { TextField } from "@/shared/components/ui/text-field";
import { isCountableUnit, type UnitOfMeasure } from "@/shared/domain/units";

type FormValues = z.input<ReturnType<typeof receiptEntrySchema>>;

/** Keys that can produce a negative, exponent, or sign-prefixed value. Blocked so the field only takes plain digits. */
/** "22.500" becomes "22.5" and "100.000" becomes "100"; a value without a decimal point is left alone. */
function trimTrailingZeros(value: string): string {
  return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
}

const BLOCKED_KEYS = new Set(["-", "+", "e", "E"]);

export function ReceiptForm({
  orderId,
  lines,
  warehouses,
  canPost = false,
  canCreateWarehouse = false,
}: {
  orderId: string;
  lines: { id: string; sku: string; productName: string; unitOfMeasure: string; remaining: string }[];
  warehouses: { id: string; label: string }[];
  /** The caller may post receipts, so "Receive and update stock" can do both steps in one go. */
  canPost?: boolean;
  canCreateWarehouse?: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // A number input reports text it cannot parse (for example a pasted "1e3") as an empty value. Such
  // input must never be read as "nothing received", so it is tracked here and blocks submission.
  const [inputErrors, setInputErrors] = useState<Record<number, string>>({});
  const schema = useMemo(
    () => receiptEntrySchema(lines.map((line) => ({ id: line.id, sku: line.sku, unitOfMeasure: line.unitOfMeasure, remaining: line.remaining }))),
    [lines]
  );
  const [activeMode, setActiveMode] = useState<"draft" | "post" | null>(null);
  const { register, control, handleSubmit, setValue, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: "onBlur",
    defaultValues: {
      purchaseOrderId: orderId,
      // A single warehouse needs no decision.
      warehouseId: warehouses.length === 1 ? (warehouses[0]?.id ?? "") : "",
      // Blank means "nothing received on this line". It is sent as 0 and never shown as a typed zero.
      lines: lines.map((line) => ({ purchaseOrderLineId: line.id, quantity: "" })),
    },
  });

  const watched = useWatch({ control, name: "lines" });
  const impact = lines
    .map((line, index) => ({ id: line.id, sku: line.sku, unitOfMeasure: line.unitOfMeasure, quantity: (watched?.[index]?.quantity ?? "").trim() }))
    .filter((item) => item.quantity !== "" && Number(item.quantity) > 0);

  const onQuantityChange = (index: number, event: React.ChangeEvent<HTMLInputElement>) => {
    const invalid = event.target.validity.badInput;
    setInputErrors((previous) => {
      const next = { ...previous };
      if (invalid) next[index] = "Enter digits only, such as 4 or 2.5. The value was not accepted.";
      else delete next[index];
      return next;
    });
  };

  const onSubmit = (values: FormValues, postNow: boolean) => {
    setMessage(null);
    if (Object.keys(inputErrors).length > 0) return;
    const payload = {
      ...values,
      lines: values.lines.map((line) => ({ ...line, quantity: line.quantity.trim() === "" ? "0" : line.quantity.trim() })),
    };
    const shouldPost = canPost && postNow;
    startTransition(async () => {
      const result = await createReceiptAction(payload);
      if (!result.ok) {
        setMessage(`${result.error.message} (ref ${result.error.requestId.slice(0, 8)})`);
        return;
      }
      if (shouldPost) {
        // Two real operations in a row: the draft receipt exists first, then posting moves the stock.
        const posted = await postReceiptAction(result.data.id);
        if (!posted.ok) {
          setMessage(`The receipt ${result.data.receiptNumber} was saved as a draft, but posting it failed: ${posted.error.message} Stock has not changed. Open the receipt to retry.`);
          router.push(`/purchasing/receipts/${result.data.id}`);
          return;
        }
      }
      router.push(`/purchasing/receipts/${result.data.id}`);
    });
  };

  return (
    <form
      noValidate
      onSubmit={(event) => {
        // Which button was pressed decides between saving a draft and receiving into stock.
        const postNow = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("data-mode") === "post";
        setActiveMode(postNow ? "post" : "draft");
        void handleSubmit((values) => onSubmit(values, postNow))(event);
      }}
      className="space-y-6"
    >
      <p className="text-sm text-[var(--color-text-secondary)]">
        Enter what physically arrived. Stock only increases when the receipt is posted. &quot;Receive and update stock&quot; saves and posts in one step, or save a draft to check it first.
      </p>
      {message && <FormMessage kind="error">{message}</FormMessage>}
      {(errors.lines as { message?: string } | undefined)?.message && (
        <FormMessage kind="error">{(errors.lines as { message?: string }).message}</FormMessage>
      )}
      <fieldset disabled={pending} className="grid gap-5 sm:grid-cols-2">
        <legend className="sr-only">Receipt</legend>
        <Controller
          control={control}
          name="warehouseId"
          render={({ field }) => (
            <CreatableSelect
              id="warehouseId"
              label="Receive into warehouse"
              required
              value={field.value}
              onChange={field.onChange}
              options={warehouses}
              placeholder="Select a warehouse…"
              createLabel="New warehouse"
              createTitle="New warehouse"
              createDescription="A place where stock is kept."
              emptyHint="You need a warehouse to receive goods into. Create one here."
              error={errors.warehouseId?.message}
              className="sm:col-span-2"
              renderCreate={canCreateWarehouse ? (props) => <QuickWarehouseForm {...props} /> : undefined}
            />
          )}
        />
        <div className="flex sm:col-span-2">
          <Button
            onClick={() => lines.forEach((line, index) => setValue(`lines.${index}.quantity`, trimTrailingZeros(line.remaining) || "0", { shouldDirty: true }))}
            disabled={pending}
          >
            Everything arrived: fill all remaining
          </Button>
        </div>
        {lines.map((line, index) => {
          const countable = isCountableUnit(line.unitOfMeasure as UnitOfMeasure);
          const quantityField = register(`lines.${index}.quantity`);
          return (
            <div key={line.id} className="sm:col-span-2 grid gap-2 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] p-4 sm:grid-cols-[1fr_180px] sm:items-end">
              <div>
                <p className="font-medium">{line.sku}</p>
                <p className="text-sm text-[var(--color-text-secondary)]">{line.productName} · remaining {line.remaining} {line.unitOfMeasure}</p>
              </div>
              <TextField
                label="Received quantity"
                type="number"
                inputMode="decimal"
                min={0}
                step={countable ? 1 : "0.000001"}
                placeholder="0"
                hint={`Up to ${line.remaining} ${line.unitOfMeasure}. Leave blank to receive nothing on this line.`}
                error={inputErrors[index] ?? errors.lines?.[index]?.quantity?.message}
                onFocus={(event) => event.currentTarget.select()}
                onKeyDown={(event) => {
                  if (BLOCKED_KEYS.has(event.key)) event.preventDefault();
                }}
                onWheel={(event) => event.currentTarget.blur()}
                {...quantityField}
                onChange={(event) => {
                  onQuantityChange(index, event);
                  return quantityField.onChange(event);
                }}
              />
            </div>
          );
        })}
        {impact.length > 0 && (
          <div role="status" className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] p-3 text-sm sm:col-span-2">
            <p className="font-semibold text-[var(--color-text-primary)]">{canPost ? "Receiving will increase stock:" : "Once posted, this will increase stock:"}</p>
            <ul className="mt-1 space-y-0.5 text-[var(--color-text-secondary)]">
              {impact.map((item) => (
                <li key={item.id} className="tabular-nums">+{item.quantity} {item.unitOfMeasure} · {item.sku}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-col-reverse gap-3 sm:col-span-2 sm:flex-row sm:justify-end">
          <Button
            type="submit"
            disabled={pending || warehouses.length === 0}
            data-mode="draft"
          >
            <Save aria-hidden className="size-4" />
            {pending && activeMode === "draft" ? "Saving…" : "Save receipt draft"}
          </Button>
          {canPost && (
            <Button
              type="submit"
              variant="primary"
              disabled={pending || warehouses.length === 0}
              data-mode="post"
            >
              <PackageCheck aria-hidden className="size-4" />
              {pending && activeMode === "post" ? "Updating stock…" : "Receive and update stock"}
            </Button>
          )}
        </div>
      </fieldset>
    </form>
  );
}
