"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { generateReplenishmentAction } from "@/features/purchasing/actions/purchasing.action";
import { LoaderCircle, Sparkles } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Field, Select } from "@/shared/components/ui/form-kit";
import { FormMessage } from "@/shared/components/ui/form-message";
import { filterInputClass } from "@/shared/components/data-display/filter-bar";

/**
 * Requests a new proposal. The server calculates the quantities and then asks the AI provider for explanations.
 * The button stays disabled until the server replies, so a double click cannot start two generations.
 */
export function ReplenishmentGenerateForm({ warehouses }: { warehouses: { id: string; code: string; name: string }[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await generateReplenishmentAction({
        warehouseId: String(form.get("warehouseId") ?? ""),
        horizonDays: String(form.get("horizonDays") ?? ""),
      });
      if (!result.ok) {
        setError(`${result.error.message} (ref ${result.error.requestId.slice(0, 8)})`);
        return;
      }
      router.push(`/purchasing/replenishment?proposal=${result.data.id}`);
      router.refresh();
    });
  }

  if (warehouses.length === 0) {
    return (
      <p className="text-sm text-[var(--color-text-secondary)]">
        Create an active warehouse before generating a proposal.{" "}
        <a className="underline" href="/inventory/warehouses">Go to warehouses</a>
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px_auto] sm:items-end" aria-busy={pending}>
      <fieldset disabled={pending} className="contents">
        <Field label="Warehouse" htmlFor="warehouseId" required>
          <Select id="warehouseId" name="warehouseId" required defaultValue={warehouses[0].id}>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.code} · {w.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Days to cover" htmlFor="horizonDays" required>
          <input id="horizonDays" name="horizonDays" type="number" inputMode="numeric" min={1} max={90} step={1} defaultValue={14} required placeholder="e.g. 14" className={filterInputClass} />
        </Field>
        <Button type="submit" variant="primary">{pending ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <Sparkles aria-hidden className="size-4" />}{pending ? "Generating…" : "Generate proposal"}</Button>
      </fieldset>
      <p className="text-xs text-[var(--color-text-secondary)] sm:col-span-3" role={pending ? "status" : undefined}>
        {pending
          ? "Calculating quantities and requesting AI explanations. This can take several seconds; please keep this page open."
          : "Quantities are calculated from stock facts. Writing the AI explanations can take several seconds."}
      </p>
      {error && (
        <div className="sm:col-span-3">
          <FormMessage kind="error">{error}</FormMessage>
        </div>
      )}
    </form>
  );
}
