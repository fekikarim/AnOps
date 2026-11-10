"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  ClipboardList,
  Factory,
  FolderTree,
  Info,
  LoaderCircle,
  Lock,
  PackagePlus,
  Plus,
  Truck,
  Warehouse,
} from "lucide-react";
import { Button, ButtonLink } from "@/shared/components/ui/button";
import { Field, Select } from "@/shared/components/ui/form-kit";
import { FormMessage } from "@/shared/components/ui/form-message";
import { TextField } from "@/shared/components/ui/text-field";
import { StatusBadge } from "@/shared/components/data-display/status-badge";
import { QuickCategoryForm, QuickProductForm, QuickWarehouseForm } from "@/features/inventory/components/quick-create-forms";
import { QuickSupplierForm } from "@/features/purchasing/components/quick-supplier-form";
import { createCategoryAction, recordOpeningStockAction } from "@/features/inventory/actions/inventory.action";
import { isSetupStepId, type SetupStepId } from "@/features/inventory/setup-progress";
import type { InventorySetupData } from "@/server/inventory/onboarding.service";
import { cn } from "@/shared/lib/utils";

const STEP_ICONS: Record<SetupStepId, React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  warehouse: Warehouse,
  categories: FolderTree,
  products: PackagePlus,
  stock: ClipboardList,
  suppliers: Truck,
  review: Check,
};

const CATEGORY_SUGGESTIONS = ["Raw materials", "Finished goods", "Packaging", "Consumables"];

/** The shape the wizard needs from the server. Declared as a type-only import so no server code reaches the browser. */
export type SetupWizardData = InventorySetupData;

function Callout({ tone, icon: Icon, children }: { tone: "info" | "warning"; icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "flex gap-3 rounded-[var(--radius-control)] border p-3 text-sm",
        tone === "warning"
          ? "border-[var(--color-status-warning)] bg-[var(--color-status-warning-bg)] text-[var(--color-status-warning)]"
          : "border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)]"
      )}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Why({ children }: { children: React.ReactNode }) {
  return (
    <details className="group rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-canvas)] px-3 py-2 text-sm text-[var(--color-text-secondary)]">
      <summary className="flex min-h-[32px] cursor-pointer list-none items-center gap-2 font-semibold text-[var(--color-text-primary)] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)]">
        <Info aria-hidden className="size-4" />
        Why does this matter?
      </summary>
      <div className="pb-1 pt-2">{children}</div>
    </details>
  );
}

function RecordList({ title, items, empty }: { title: string; items: { id: string; primary: string; secondary?: string }[]; empty: string }) {
  return (
    <section aria-label={title} className="space-y-2">
      <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
        {title} <span className="font-normal text-[var(--color-text-secondary)]">({items.length})</span>
      </h3>
      {items.length === 0 ? (
        <p className="text-sm text-[var(--color-text-secondary)]">{empty}</p>
      ) : (
        <ul className="divide-y divide-[var(--color-border-subtle)] rounded-[var(--radius-control)] border border-[var(--color-border-subtle)]">
          {items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
              <span className="min-w-0 truncate font-medium text-[var(--color-text-primary)]">{item.primary}</span>
              {item.secondary && <span className="shrink-0 text-xs text-[var(--color-text-secondary)]">{item.secondary}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function SetupWizard({ data, initialStep }: { data: SetupWizardData; initialStep?: string }) {
  const router = useRouter();
  const { progress, can } = data;
  const [step, setStep] = useState<SetupStepId>(isSetupStepId(initialStep) ? initialStep : progress.nextStepId);
  const [notice, setNotice] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);

  const index = progress.steps.findIndex((item) => item.id === step);
  const current = progress.steps[index] ?? progress.steps[0]!;
  const previous = progress.steps[index - 1];
  const next = progress.steps[index + 1];

  const go = (id: SetupStepId) => {
    setStep(id);
    setNotice(null);
    // Keep the step in the address so a refresh or a shared link resumes here.
    window.history.replaceState(null, "", `?step=${id}`);
    requestAnimationFrame(() => document.getElementById("setup-panel")?.focus());
  };

  const created = (message: string) => {
    setNotice(message);
    setFormKey((key) => key + 1);
    router.refresh();
  };

  const warehouseOptions = data.warehouses.map((w) => ({ id: w.id, label: `${w.code} · ${w.name}` }));

  return (
    <div className="space-y-6">
      <section aria-label="Setup progress" className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-[var(--color-text-primary)]">
            Step {index + 1} of {progress.steps.length} · {current.title}
          </p>
          <span className="text-sm text-[var(--color-text-secondary)]">{progress.percent}% configured</span>
        </div>
        <div
          role="progressbar"
          aria-label="Inventory setup progress"
          aria-valuenow={progress.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--color-bg-subtle)]"
        >
          <div className="h-full rounded-full bg-[var(--color-action-primary)] transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${progress.percent}%` }} />
        </div>
        <ol className="-mx-1 mt-4 flex gap-1 overflow-x-auto px-1 pb-1">
          {progress.steps.map((item, i) => {
            const Icon = STEP_ICONS[item.id];
            const active = item.id === step;
            return (
              <li key={item.id} className="shrink-0">
                <button
                  type="button"
                  onClick={() => go(item.id)}
                  aria-current={active ? "step" : undefined}
                  className={cn(
                    "flex min-h-[44px] items-center gap-2 rounded-[var(--radius-control)] border px-3 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)]",
                    active
                      ? "border-[var(--color-action-primary)] bg-[var(--color-action-primary)] text-[var(--color-action-on-primary)]"
                      : "border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-subtle)]"
                  )}
                >
                  <span className={cn("flex size-6 items-center justify-center rounded-full text-xs", item.status === "done" && !active ? "bg-[var(--color-status-success-bg)] text-[var(--color-status-success)]" : "bg-black/10")}>
                    {item.status === "done" ? <Check aria-hidden className="size-3.5" /> : item.status === "blocked" ? <Lock aria-hidden className="size-3" /> : <span aria-hidden>{i + 1}</span>}
                  </span>
                  <Icon aria-hidden className="hidden size-4 sm:block" />
                  <span className="hidden md:inline">{item.title}</span>
                  <span className="sr-only md:hidden">{item.title}</span>
                  <span className="sr-only">{item.status === "done" ? ", done" : item.status === "blocked" ? ", blocked" : item.required ? ", required" : ", optional"}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </section>

      <section
        id="setup-panel"
        tabIndex={-1}
        aria-labelledby="setup-step-title"
        className="space-y-5 rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 outline-none sm:p-6"
      >
        <header className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="setup-step-title" className="text-lg font-semibold text-[var(--color-text-primary)]">{current.title}</h2>
            <StatusBadge
              label={current.status === "done" ? "Done" : current.status === "blocked" ? "Blocked" : current.required ? "Required" : "Optional"}
              tone={current.status === "done" ? "success" : current.status === "blocked" ? "warning" : current.required ? "info" : "neutral"}
            />
          </div>
          <p className="text-sm text-[var(--color-text-secondary)]">{current.summary}</p>
        </header>

        {notice && <FormMessage kind="success">{notice}</FormMessage>}

        {step === "warehouse" && (
          <div className="space-y-5">
            <Why>
              A warehouse is any place you keep goods: a building, a storeroom or a shelf area. Every stock quantity belongs to one warehouse, so you need at least one before you can record stock.
            </Why>
            <RecordList title="Your warehouses" items={data.warehouses.map((w) => ({ id: w.id, primary: w.name, secondary: w.code }))} empty="None yet." />
            {can.manageWarehouses ? (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold">{data.warehouses.length === 0 ? "Add your first warehouse" : "Add another warehouse"}</h3>
                <QuickWarehouseForm key={formKey} onCreated={(option) => created(`${option.label} added.`)} submitLabel="Add warehouse" />
              </div>
            ) : (
              <Callout tone="warning" icon={Lock}>You do not have permission to add warehouses. Ask an administrator to add one.</Callout>
            )}
          </div>
        )}

        {step === "categories" && (
          <div className="space-y-5">
            <Why>Categories group similar products so you can filter lists and read reports by type. They are optional: skip this and add them whenever you need.</Why>
            <RecordList title="Your categories" items={data.categories.map((c) => ({ id: c.id, primary: c.name, secondary: `${c.productCount} product${c.productCount === 1 ? "" : "s"}` }))} empty="None yet." />
            {can.manageProducts ? (
              <div className="space-y-4">
                <SuggestedCategories existing={data.categories.map((c) => c.name)} onAdded={(name) => created(`${name} added.`)} />
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold">Or name your own</h3>
                  <QuickCategoryForm key={formKey} onCreated={(option) => created(`${option.label} added.`)} submitLabel="Add category" />
                </div>
              </div>
            ) : (
              <Callout tone="warning" icon={Lock}>You do not have permission to add categories.</Callout>
            )}
          </div>
        )}

        {step === "products" && (
          <div className="space-y-5">
            <Why>
              A product is anything you buy, make or sell. The SKU is your own unique code. Standard cost is what one unit costs you; it is used to value your stock. If you already own some, enter it as opening stock and it is recorded as a normal, traceable stock receipt.
            </Why>
            <RecordList title="Products added" items={data.products.map((p) => ({ id: p.id, primary: `${p.sku} · ${p.name}`, secondary: p.unitOfMeasure }))} empty="None yet." />
            {can.manageProducts ? (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold">{data.products.length === 0 ? "Add your first product" : "Add another product"}</h3>
                {data.warehouses.length === 0 && can.moveStock && (
                  <Callout tone="info" icon={Info}>
                    No warehouse yet, so opening stock is hidden. <button type="button" className="font-semibold underline underline-offset-4" onClick={() => go("warehouse")}>Add a warehouse</button> first if you want to record quantities now.
                  </Callout>
                )}
                <QuickProductForm
                  key={formKey}
                  categories={data.categories.map((c) => ({ id: c.id, name: c.name }))}
                  warehouses={can.moveStock && data.warehouses.length > 0 ? warehouseOptions : undefined}
                  currencyCode={data.currencyCode}
                  onResult={(result) => {
                    if (result.openingStock.status === "failed") {
                      setNotice(null);
                    }
                  }}
                  onCreated={(option) => created(`${option.label.split(" (")[0]} added.`)}
                 
                  submitLabel="Add product"
                />
              </div>
            ) : (
              <Callout tone="warning" icon={Lock}>You do not have permission to add products.</Callout>
            )}
            <p className="text-xs text-[var(--color-text-secondary)]">
              Have many products? Add the first few here, then continue from the <Link href="/inventory/products" className="font-semibold underline underline-offset-4">Products</Link> page.
            </p>
          </div>
        )}

        {step === "stock" && (
          <OpeningStockStep
            data={data}
            warehouseOptions={warehouseOptions}
            goTo={go}
            onDone={(message) => {
              setNotice(message);
              router.refresh();
            }}
          />
        )}

        {step === "suppliers" && (
          <div className="space-y-5">
            <Why>A supplier is a company you buy from. Saving them once lets you raise a purchase order in a few taps. Optional until you start buying.</Why>
            {!can.readSuppliers ? (
              <Callout tone="warning" icon={Lock}>Your role cannot open Purchasing, so suppliers are not shown here.</Callout>
            ) : (
              <>
                <RecordList title="Your suppliers" items={data.suppliers.map((s) => ({ id: s.id, primary: s.name }))} empty="None yet." />
                {can.manageSuppliers ? (
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold">{data.suppliers.length === 0 ? "Add your first supplier" : "Add another supplier"}</h3>
                    <QuickSupplierForm key={formKey} onCreated={(option) => created(`${option.label} added.`)} submitLabel="Add supplier" />
                  </div>
                ) : (
                  <Callout tone="warning" icon={Lock}>You do not have permission to add suppliers.</Callout>
                )}
              </>
            )}
          </div>
        )}

        {step === "review" && <ReviewStep data={data} goTo={go} />}

        <footer className="flex flex-col-reverse gap-3 border-t border-[var(--color-border-subtle)] pt-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            {previous && (
              <Button variant="ghost" onClick={() => go(previous.id)}>
                <ArrowLeft aria-hidden className="size-4" />
                Back
              </Button>
            )}
          </div>
          <div className="flex flex-col-reverse gap-3 sm:flex-row">
            {next && current.status !== "done" && !current.required && current.status !== "blocked" && (
              <Button onClick={() => go(next.id)}>Skip for now</Button>
            )}
            {next ? (
              <Button
                variant="primary"
                onClick={() => go(next.id)}
                disabled={current.required && current.status !== "done"}
                aria-describedby={current.required && current.status !== "done" ? "setup-continue-hint" : undefined}
              >
                Continue
                <ArrowRight aria-hidden className="size-4" />
              </Button>
            ) : (
              <ButtonLink href="/inventory" variant="primary">
                Go to inventory
                <ArrowRight aria-hidden className="size-4" />
              </ButtonLink>
            )}
          </div>
        </footer>
        {next && current.required && current.status !== "done" && (
          <p id="setup-continue-hint" className="-mt-3 text-xs text-[var(--color-text-secondary)]">Add at least one to continue. Your progress is saved as you go.</p>
        )}
      </section>
    </div>
  );
}

function SuggestedCategories({ existing, onAdded }: { existing: string[]; onAdded: (name: string) => void }) {
  const [pendingName, setPendingName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const known = new Set(existing.map((name) => name.toLowerCase()));
  const suggestions = CATEGORY_SUGGESTIONS.filter((name) => !known.has(name.toLowerCase()));
  if (suggestions.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">Common starting points</h3>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((name) => (
          <Button
            key={name}
            disabled={pendingName !== null}
            onClick={async () => {
              setPendingName(name);
              setError(null);
              const result = await createCategoryAction({ name, description: "" });
              setPendingName(null);
              if (!result.ok) return setError(result.error.message);
              onAdded(name);
            }}
          >
            {pendingName === name ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <Plus aria-hidden className="size-4" />}
            {name}
          </Button>
        ))}
      </div>
      {error && <FormMessage kind="error">{error}</FormMessage>}
    </div>
  );
}

function OpeningStockStep({
  data,
  warehouseOptions,
  goTo,
  onDone,
}: {
  data: SetupWizardData;
  warehouseOptions: { id: string; label: string }[];
  goTo: (id: SetupStepId) => void;
  onDone: (message: string) => void;
}) {
  const [warehouseId, setWarehouseId] = useState(warehouseOptions.length === 1 ? (warehouseOptions[0]?.id ?? "") : "");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const rows = data.products.filter((product) => product.needsOpeningStock);

  if (data.warehouses.length === 0 || data.products.length === 0) {
    const target: SetupStepId = data.warehouses.length === 0 ? "warehouse" : "products";
    return (
      <Callout tone="warning" icon={CircleAlert}>
        {data.warehouses.length === 0 ? "Stock lives in a warehouse, so add one first." : "There is nothing to count yet, so add a product first."}{" "}
        <button type="button" className="font-semibold underline underline-offset-4" onClick={() => goTo(target)}>
          {data.warehouses.length === 0 ? "Add a warehouse" : "Add a product"}
        </button>
      </Callout>
    );
  }
  if (!data.can.moveStock) {
    return <Callout tone="warning" icon={Lock}>You do not have permission to record stock. Ask a manager to enter opening quantities.</Callout>;
  }
  if (rows.length === 0) {
    return (
      <Callout tone="info" icon={Check}>
        Every stored product already has a quantity. To change a quantity later, use <Link href="/inventory/stock" className="font-semibold underline underline-offset-4">Stock</Link>, where each change is recorded.
      </Callout>
    );
  }

  const entries = rows
    .map((row) => ({ productId: row.id, quantity: (quantities[row.id] ?? "").trim(), cost: Number(row.cost) }))
    .filter((entry) => entry.quantity !== "" && Number(entry.quantity) !== 0);
  const totalValue = entries.reduce((sum, entry) => sum + (Number(entry.quantity) || 0) * entry.cost, 0);

  const submit = () => {
    setMessage(null);
    setErrors({});
    startTransition(async () => {
      const result = await recordOpeningStockAction({ warehouseId, entries: entries.map(({ productId, quantity }) => ({ productId, quantity })) });
      if (!result.ok) {
        setMessage(`${result.error.message}`);
        return;
      }
      const failed = Object.fromEntries(result.data.failed.map((item) => [item.productId, item.message]));
      setErrors(failed);
      setQuantities((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id in failed)));
      if (result.data.posted.length > 0) {
        onDone(`Opening stock recorded for ${result.data.posted.length} product${result.data.posted.length === 1 ? "" : "s"}.`);
      }
      if (result.data.failed.length > 0) {
        setMessage(`${result.data.failed.length} could not be recorded. Fix the quantities marked below and try again.`);
      }
    });
  };

  return (
    <div className="space-y-5">
      <Why>
        Opening stock is what you already own today. Each quantity becomes a stock receipt in the history, so counts stay traceable. Valued at each product&apos;s standard cost.
      </Why>
      {message && <FormMessage kind="error">{message}</FormMessage>}
      <Field label="Warehouse holding these goods" htmlFor="opening-warehouse" required hint="All quantities below are recorded in this warehouse.">
        <Select id="opening-warehouse" value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>
          <option value="">Choose a warehouse…</option>
          {warehouseOptions.map((option) => (
            <option key={option.id} value={option.id}>{option.label}</option>
          ))}
        </Select>
      </Field>
      <ul className="divide-y divide-[var(--color-border-subtle)] rounded-[var(--radius-control)] border border-[var(--color-border-subtle)]">
        {rows.map((row) => (
          <li key={row.id} className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_160px] sm:items-start">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{row.sku}</p>
              <p className="truncate text-xs text-[var(--color-text-secondary)]">{row.name} · cost {row.cost}</p>
            </div>
            <TextField
              label={`Quantity (${row.unitOfMeasure})`}
              placeholder="0"
              inputMode="decimal"
              value={quantities[row.id] ?? ""}
              onChange={(event) => setQuantities((current) => ({ ...current, [row.id]: event.target.value }))}
              error={errors[row.id]}
              disabled={pending}
            />
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-[var(--color-text-secondary)]" aria-live="polite">
          {entries.length === 0 ? "Enter a quantity for the products you already have." : `${entries.length} product${entries.length === 1 ? "" : "s"} · value ${totalValue.toFixed(3)} ${data.currencyCode}`}
        </p>
        <Button variant="primary" onClick={submit} disabled={pending || entries.length === 0 || !warehouseId}>
          {pending ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <Check aria-hidden className="size-4" />}
          {pending ? "Recording…" : "Record opening stock"}
        </Button>
      </div>
    </div>
  );
}

function ReviewStep({ data, goTo }: { data: SetupWizardData; goTo: (id: SetupStepId) => void }) {
  const { progress, can, counts } = data;
  const missingRequired = progress.steps.filter((step) => step.required && step.status !== "done");
  const remainingOptional = progress.steps.filter((step) => !step.required && step.id !== "review" && step.status !== "done");

  const nextActions: { href: string; label: string; description: string; icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }> }[] = [];
  if (counts.products > 0 && counts.suppliers > 0 && can.createOrders) {
    nextActions.push({ href: "/purchasing/orders/new", label: "Create a purchase order", description: "Order goods from a supplier. Stock updates when you receive them.", icon: Truck });
  }
  if (counts.products > 1 && can.manageBoms) {
    nextActions.push({ href: "/manufacturing/boms/new", label: "Define a bill of materials", description: "List the components needed to make a product.", icon: Factory });
  }
  nextActions.push({ href: "/inventory/stock", label: "See your stock", description: "Quantities by product and warehouse, with full history.", icon: ClipboardList });

  return (
    <div className="space-y-6">
      {missingRequired.length > 0 ? (
        <Callout tone="warning" icon={CircleAlert}>
          <p className="font-semibold">Not usable yet. Still needed:</p>
          <ul className="mt-1 list-disc pl-5">
            {missingRequired.map((step) => (
              <li key={step.id}>
                {step.title}.{" "}
                <button type="button" className="font-semibold underline underline-offset-4" onClick={() => goTo(step.id)}>Do this now</button>
              </li>
            ))}
          </ul>
        </Callout>
      ) : (
        <Callout tone="info" icon={Check}>
          <p className="font-semibold text-[var(--color-text-primary)]">Your inventory is ready to use.</p>
          <p>Everything below is real data you can open from the Inventory menu.</p>
        </Callout>
      )}

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Warehouses", value: counts.warehouses },
          { label: "Categories", value: counts.categories },
          { label: "Products", value: counts.products },
          { label: "With opening stock", value: `${counts.productsWithStock}/${counts.storableProducts}` },
        ].map((item) => (
          <div key={item.label} className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-canvas)] p-3">
            <dt className="text-xs text-[var(--color-text-secondary)]">{item.label}</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums text-[var(--color-text-primary)]">{item.value}</dd>
          </div>
        ))}
      </dl>

      <section aria-label="Checklist" className="space-y-2">
        <h3 className="text-sm font-semibold">Checklist</h3>
        <ul className="divide-y divide-[var(--color-border-subtle)] rounded-[var(--radius-control)] border border-[var(--color-border-subtle)]">
          {progress.steps
            .filter((step) => step.id !== "review")
            .map((step) => (
              <li key={step.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-full",
                      step.status === "done" ? "bg-[var(--color-status-success-bg)] text-[var(--color-status-success)]" : "bg-[var(--color-status-neutral-bg)] text-[var(--color-status-neutral)]"
                    )}
                  >
                    {step.status === "done" ? <Check aria-hidden className="size-3.5" /> : <span aria-hidden className="size-1.5 rounded-full bg-current" />}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[var(--color-text-primary)]">{step.title}</p>
                    <p className="truncate text-xs text-[var(--color-text-secondary)]">{step.summary}</p>
                  </div>
                </div>
                <Button variant="ghost" className="shrink-0" onClick={() => goTo(step.id)}>
                  {step.status === "done" ? "Edit" : "Open"}
                </Button>
              </li>
            ))}
        </ul>
        {remainingOptional.length > 0 && <p className="text-xs text-[var(--color-text-secondary)]">Optional steps can be finished any time. This page always shows what remains.</p>}
      </section>

      <section aria-label="What to do next" className="space-y-2">
        <h3 className="text-sm font-semibold">What to do next</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {nextActions.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className="flex min-h-[72px] items-start gap-3 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-3 transition-colors hover:bg-[var(--color-bg-subtle)] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)]"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)]">
                <action.icon aria-hidden className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-[var(--color-text-primary)]">{action.label}</span>
                <span className="block text-xs text-[var(--color-text-secondary)]">{action.description}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
