"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, useId } from "react";
import Link from "next/link";
import { createInvoiceDraftAction, updateInvoiceDraftAction } from "@/features/finance/actions/finance.actions";
import { Button, selectClass } from "@/shared/components/ui/button";
import { FormMessage } from "@/shared/components/ui/form-message";
import { computeLineTotal, roundMoney, stampDutyFor, TIMBRE_FISCAL_TND } from "@/features/finance/utils/money";
import type { Customer } from "@/features/finance/types";

type ProductOption = {
  id: string;
  name: string;
  sku: string;
  unitPrice: number;
  description: string;
};

type FormLine = {
  id: string;
  productId?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
};

type Currency = "TND" | "USD" | "EUR" | "GBP";

/** An existing draft to edit. Without it the form creates a new draft. */
export type InvoiceDraftValues = {
  id: string;
  customerId: string;
  currency: Currency;
  issueDate: string;
  dueDate?: string;
  notes?: string;
  terms?: string;
  lines: Array<{ productId?: string; description: string; quantity: number; unitPrice: number; taxRate: number }>;
  stampDuty?: boolean;
};

export function InvoiceBuilderForm({
  customers,
  products,
  preselectedCustomerId,
  initialInvoice,
}: {
  customers: Customer[];
  products: ProductOption[];
  preselectedCustomerId?: string;
  initialInvoice?: InvoiceDraftValues;
}) {
  const uid = useId();
  const editing = !!initialInvoice;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  // Computed once when the form opens, not on every render.
  const [{ today, in30Days }] = useState(() => {
    const now = new Date();
    return { today: now.toISOString().slice(0, 10), in30Days: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) };
  });

  const [customerId, setCustomerId] = useState(initialInvoice?.customerId || preselectedCustomerId || (customers[0]?.id ?? ""));
  const [currency, setCurrency] = useState<Currency>(initialInvoice?.currency || "TND");
  const [issueDate, setIssueDate] = useState(initialInvoice?.issueDate || today);
  const [dueDate, setDueDate] = useState(initialInvoice ? initialInvoice.dueDate || "" : in30Days);
  const [notes, setNotes] = useState(initialInvoice?.notes || "");
  // Tunisian invoices usually carry the timbre fiscal; on by default for new TND invoices.
  const [stampDuty, setStampDuty] = useState(initialInvoice ? !!initialInvoice.stampDuty : true);
  const [terms, setTerms] = useState(initialInvoice ? initialInvoice.terms || "" : "Payment due within 30 days of issue.");

  const [lines, setLines] = useState<FormLine[]>(initialInvoice ? initialInvoice.lines.map((l, i) => ({ ...l, id: `line_${i}` })) : [
    {
      id: "line_1",
      productId: products[0]?.id || "",
      description: products[0]?.description || "Consulting & Services",
      quantity: 1,
      unitPrice: products[0]?.unitPrice || 100,
      taxRate: 19,
    },
  ]);

  const activeCustomer = customers.find((c) => c.id === customerId);

  function handleProductSelect(lineIndex: number, prodId: string) {
    const prod = products.find((p) => p.id === prodId);
    setLines((prev) =>
      prev.map((line, idx) => {
        if (idx !== lineIndex) return line;
        if (!prod) return { ...line, productId: "" };
        return {
          ...line,
          productId: prod.id,
          description: prod.name + (prod.sku ? ` (${prod.sku})` : ""),
          unitPrice: prod.unitPrice || line.unitPrice,
        };
      })
    );
  }

  function updateLine<K extends keyof FormLine>(index: number, field: K, value: FormLine[K]) {
    setLines((prev) =>
      prev.map((line, idx) => {
        if (idx !== index) return line;
        return { ...line, [field]: value };
      })
    );
  }

  function addLine() {
    setLines((prev) => [
      ...prev,
      {
        id: `line_${Date.now()}`,
        productId: "",
        description: "",
        quantity: 1,
        unitPrice: 0,
        taxRate: 19,
      },
    ]);
  }

  function removeLine(index: number) {
    if (lines.length <= 1) return;
    setLines((prev) => prev.filter((_, idx) => idx !== index));
  }

  // Calculate live totals
  const subtotal = lines.reduce(
    (acc, l) => acc + roundMoney((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0)),
    0
  );
  const taxTotal = lines.reduce(
    (acc, l) =>
      acc +
      roundMoney(
        (Number(l.quantity) || 0) *
          (Number(l.unitPrice) || 0) *
          ((Number(l.taxRate) || 0) / 100)
      ),
    0
  );
  const stamp = stampDutyFor(currency, stampDuty);
  const grandTotal = subtotal + taxTotal + stamp;

  const fmt = (n: number) =>
    new Intl.NumberFormat("fr-TN", { style: "currency", currency }).format(n || 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!customerId) {
      setFormError("Please select a customer for this invoice.");
      return;
    }

    if (lines.length === 0) {
      setFormError("Please add at least one line item.");
      return;
    }

    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].description.trim()) {
        setFormError(`Line #${i + 1} requires a description.`);
        return;
      }
      if (lines[i].quantity <= 0) {
        setFormError(`Line #${i + 1} quantity must be greater than 0.`);
        return;
      }
    }

    const payload = new FormData();
    payload.append("customerId", customerId);
    payload.append("currency", currency);
    payload.append("issueDate", issueDate);
    if (dueDate) payload.append("dueDate", dueDate);
    if (notes) payload.append("notes", notes);
    if (terms) payload.append("terms", terms);
    payload.append("stampDuty", String(stampDuty && currency === "TND"));

    const formattedLines = lines.map((l) => ({
      productId: l.productId || undefined,
      description: l.description.trim(),
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      taxRate: Number(l.taxRate) || 0,
    }));

    payload.append("lines", JSON.stringify(formattedLines));

    startTransition(async () => {
      const res = initialInvoice ? await updateInvoiceDraftAction(initialInvoice.id, payload) : await createInvoiceDraftAction(payload);
      if (res.error) {
        setFormError(res.error);
        return;
      }
      router.push(initialInvoice ? `/finance/invoices/${initialInvoice.id}` : "/finance/invoices");
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Top Section: Customer, Currency & Dates */}
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 shadow-sm space-y-4">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
          Invoice Header & Client Info
        </h2>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Customer Selection */}
          <div className="space-y-1 sm:col-span-2">
            <div className="flex items-center justify-between">
              <label htmlFor={`${uid}-customer`} className="text-sm font-medium text-[var(--color-text-secondary)]">
                Bill To Customer *
              </label>
              <Link
                href="/finance/customers"
                className="text-xs text-[var(--color-action-primary)] hover:underline font-medium"
              >
                + New Customer
              </Link>
            </div>
            {customers.length === 0 ? (
              <div className="p-3 rounded-[var(--radius-control)] border border-[var(--color-status-warning)] bg-[var(--color-status-warning-bg)]/20 text-xs text-[var(--color-text-primary)] flex items-center justify-between">
                <span>No customers created yet. Please create one first.</span>
                <Link
                  href="/finance/customers"
                  className="font-semibold text-[var(--color-action-primary)] hover:underline"
                >
                  Create Customer
                </Link>
              </div>
            ) : (
              <select
                id={`${uid}-customer`}
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                required
                className={selectClass}
              >
                <option value="">-- Choose Customer --</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.taxId ? `(Tax ID: ${c.taxId})` : ""} {c.status === "inactive" ? "(Inactive)" : ""}
                  </option>
                ))}
              </select>
            )}

            {activeCustomer && (
              <div className="mt-2 p-2.5 rounded bg-[var(--color-bg-subtle)]/70 text-xs text-[var(--color-text-secondary)] space-y-0.5">
                <div className="font-semibold text-[var(--color-text-primary)]">{activeCustomer.name}</div>
                {activeCustomer.taxId && <div>Tax ID: {activeCustomer.taxId}</div>}
                {activeCustomer.email && <div>Email: {activeCustomer.email}</div>}
                {activeCustomer.address && <div>Address: {activeCustomer.address}</div>}
              </div>
            )}
          </div>

          {/* Currency */}
          <div className="space-y-1">
            <label htmlFor={`${uid}-0`} className="text-sm font-medium text-[var(--color-text-secondary)]">Currency</label>
            <select id={`${uid}-0`}
              value={currency}
              onChange={(e) => setCurrency(e.target.value as Currency)}
              className={selectClass}
            >
              <option value="TND">TND (Tunisian Dinar)</option>
              <option value="USD">USD ($)</option>
              <option value="EUR">EUR (€)</option>
              <option value="GBP">GBP (£)</option>
            </select>
          </div>

          {/* Issue Date */}
          <div className="space-y-1">
            <label htmlFor={`${uid}-1`} className="text-sm font-medium text-[var(--color-text-secondary)]">Issue Date *</label>
            <input id={`${uid}-1`}
              type="date"
              required
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
              className={selectClass}
            />
          </div>

          {/* Due Date */}
          <div className="space-y-1">
            <label htmlFor={`${uid}-2`} className="text-sm font-medium text-[var(--color-text-secondary)]">Due Date</label>
            <input id={`${uid}-2`}
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className={selectClass}
            />
          </div>
        </div>
      </div>

      {/* Line Items Builder Section */}
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] pb-3">
          <div>
            <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
              Invoice Line Items
            </h2>
            <p className="text-xs text-[var(--color-text-secondary)]">
              Select products from catalog or enter custom line items
            </p>
          </div>
          <Button type="button" onClick={addLine} variant="secondary">
            + Add Line Item
          </Button>
        </div>

        <div className="space-y-3">
          {lines.map((line, index) => (
            <div
              key={line.id}
              className="p-3 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)]/30 space-y-3"
            >
              <div className="grid gap-3 sm:grid-cols-12 items-start">
                {/* Product catalog selector (optional) */}
                {products.length > 0 && (
                  <div className="sm:col-span-4 space-y-1">
                    <label htmlFor={`${uid}-line${index}-3`} className="text-xs font-medium text-[var(--color-text-secondary)]">
                      Catalog Item (Optional)
                    </label>
                    <select id={`${uid}-line${index}-3`}
                      value={line.productId || ""}
                      onChange={(e) => handleProductSelect(index, e.target.value)}
                      className="w-full min-h-[38px] rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-2 text-xs text-[var(--color-text-primary)]"
                    >
                      <option value="">-- Custom item --</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.sku}) - {fmt(p.unitPrice)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Description */}
                <div className={products.length > 0 ? "sm:col-span-8" : "sm:col-span-12"}>
                  <label htmlFor={`${uid}-line${index}-4`} className="text-xs font-medium text-[var(--color-text-secondary)]">
                    Item Description *
                  </label>
                  <input id={`${uid}-line${index}-4`}
                    type="text"
                    required
                    value={line.description}
                    onChange={(e) => updateLine(index, "description", e.target.value)}
                    placeholder="Description of product or service..."
                    className="w-full min-h-[38px] rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3 text-sm text-[var(--color-text-primary)]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-12 gap-3 items-end">
                {/* Quantity */}
                <div className="sm:col-span-3 space-y-1">
                  <label htmlFor={`${uid}-line${index}-5`} className="text-xs font-medium text-[var(--color-text-secondary)]">Qty *</label>
                  <input id={`${uid}-line${index}-5`}
                    type="number"
                    min="1"
                    step="1"
                    required
                    value={line.quantity}
                    onChange={(e) => updateLine(index, "quantity", Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full min-h-[38px] rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3 text-sm text-[var(--color-text-primary)] text-right"
                  />
                </div>

                {/* Unit Price */}
                <div className="sm:col-span-3 space-y-1">
                  <label htmlFor={`${uid}-line${index}-6`} className="text-xs font-medium text-[var(--color-text-secondary)]">
                    Unit Price ({currency}) *
                  </label>
                  <input id={`${uid}-line${index}-6`}
                    type="number"
                    min="0"
                    step="0.001"
                    required
                    value={line.unitPrice}
                    onChange={(e) => updateLine(index, "unitPrice", Math.max(0, parseFloat(e.target.value) || 0))}
                    className="w-full min-h-[38px] rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3 text-sm text-[var(--color-text-primary)] text-right"
                  />
                </div>

                {/* Tax Rate % */}
                <div className="sm:col-span-3 space-y-1">
                  <label htmlFor={`${uid}-line${index}-7`} className="text-xs font-medium text-[var(--color-text-secondary)]">VAT / Tax %</label>
                  <select id={`${uid}-line${index}-7`}
                    value={line.taxRate}
                    onChange={(e) => updateLine(index, "taxRate", parseFloat(e.target.value) || 0)}
                    className="w-full min-h-[38px] rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-2 text-sm text-[var(--color-text-primary)] text-right"
                  >
                    <option value="0">0%</option>
                    <option value="7">7%</option>
                    <option value="13">13%</option>
                    <option value="19">19% (Standard)</option>
                  </select>
                </div>

                {/* Line Total & Remove */}
                <div className="sm:col-span-3 flex items-center justify-between sm:justify-end gap-3 pb-1">
                  <div className="text-right">
                    <div className="text-[10px] text-[var(--color-text-secondary)] uppercase">Line Total</div>
                    <div className="text-sm font-semibold text-[var(--color-text-primary)]">
                      {fmt(computeLineTotal(line.quantity, line.unitPrice, line.taxRate))}
                    </div>
                  </div>
                  {lines.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeLine(index)}
                      className="text-xs text-[var(--color-status-error)] hover:opacity-80 p-1"
                      title="Remove line"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Totals Summary */}
        <div className="border-t border-[var(--color-border-subtle)] pt-4 flex flex-col sm:flex-row sm:justify-end">
          <div className="w-full sm:w-72 space-y-2 text-sm">
            <div className="flex justify-between text-[var(--color-text-secondary)]">
              <span>Subtotal (Net):</span>
              <span className="font-medium text-[var(--color-text-primary)]">{fmt(subtotal)}</span>
            </div>
            <div className="flex justify-between text-[var(--color-text-secondary)]">
              <span>Tax / VAT:</span>
              <span className="font-medium text-[var(--color-text-primary)]">{fmt(taxTotal)}</span>
            </div>
            {currency === "TND" && (
              <label className="flex cursor-pointer items-center justify-between gap-3 text-[var(--color-text-secondary)]">
                <span className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={stampDuty} onChange={(e) => setStampDuty(e.target.checked)} className="size-4 accent-[var(--color-action-primary)]" />
                  Timbre fiscal
                </span>
                <span className="font-medium text-[var(--color-text-primary)]">{fmt(stampDuty ? TIMBRE_FISCAL_TND : 0)}</span>
              </label>
            )}
            <div className="flex justify-between text-base font-bold text-[var(--color-text-primary)] border-t border-[var(--color-border-subtle)] pt-2">
              <span>Grand Total:</span>
              <span className="text-[var(--color-action-primary)]">{fmt(grandTotal)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Notes and Terms */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor={`${uid}-8`} className="text-sm font-medium text-[var(--color-text-secondary)]">Payment Terms</label>
          <input id={`${uid}-8`}
            type="text"
            value={terms}
            onChange={(e) => setTerms(e.target.value)}
            className="w-full min-h-[44px] rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3 text-sm text-[var(--color-text-primary)]"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${uid}-9`} className="text-sm font-medium text-[var(--color-text-secondary)]">Notes (Displayed on Invoice)</label>
          <input id={`${uid}-9`}
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Thank you for your business!"
            className="w-full min-h-[44px] rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3 text-sm text-[var(--color-text-primary)]"
          />
        </div>
      </div>

      {formError && <FormMessage kind="error">{formError}</FormMessage>}

      {/* Actions */}
      <div className="flex justify-end gap-3 pt-2">
        <Button onClick={() => router.push(initialInvoice ? `/finance/invoices/${initialInvoice.id}` : "/finance/invoices")} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={pending || customers.length === 0}>
          {editing ? (pending ? "Saving..." : "Save Draft") : pending ? "Creating Invoice..." : "Create Draft Invoice"}
        </Button>
      </div>
    </form>
  );
}
