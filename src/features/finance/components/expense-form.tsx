"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, useId } from "react";
import { Sparkles } from "lucide-react";
import { createExpenseAction, submitExpenseAction, updateExpenseAction } from "@/features/finance/actions/finance.actions";
import { Button, selectClass, textareaClass } from "@/shared/components/ui/button";
import { TextField } from "@/shared/components/ui/text-field";
import { FormMessage } from "@/shared/components/ui/form-message";
import { suggestCategoryAction } from "@/features/finance/actions/finance-ai.actions";

type CategoryOption = {
  id: string;
  name: string;
};

export function ExpenseForm({
  categories,
  initialData,
  expenseId,
}: {
  categories: CategoryOption[];
  /** Set when editing an existing draft or rejected expense. */
  expenseId?: string;
  initialData?: {
    categoryId?: string;
    notes?: string;
    vendor?: string;
    amount?: number;
    tax?: number;
    date?: string;
    currency?: string;
    description?: string;
    categoryHint?: string;
    receiptDocumentId?: string;
  };
}) {
  const uid = useId();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);

  const [expenseDate, setExpenseDate] = useState(initialData?.date || today);
  const [categoryId, setCategoryId] = useState(
    initialData?.categoryId ||
    categories.find((c) => c.name.toLowerCase() === initialData?.categoryHint?.toLowerCase())?.id ||
    // No silent default: an expense is uncategorized until the person or a suggestion picks one.
    ""
  );
  const [suggestion, setSuggestion] = useState<{ categoryId: string; categoryName: string; reason: string; source: "history" | "ai" } | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const lastAsked = useRef("");

  async function askSuggestion() {
    const key = `${vendor.trim().toLowerCase()}|${description.trim().toLowerCase()}`;
    if (key === lastAsked.current || (vendor.trim().length < 2 && description.trim().length < 3)) return;
    lastAsked.current = key;
    setSuggesting(true);
    const res = await suggestCategoryAction({ vendor, description });
    setSuggesting(false);
    // No suggestion (AI off, busy, nothing fits) simply shows nothing: the field stays manual.
    setSuggestion(res.data && res.data.categoryId !== categoryId ? res.data : null);
  }
  const [vendor, setVendor] = useState(initialData?.vendor || "");
  const [description, setDescription] = useState(initialData?.description || "");
  const [amount, setAmount] = useState<number | string>(initialData?.amount ?? "");
  const [tax, setTax] = useState<number | string>(initialData?.tax ?? 0);
  const [currency, setCurrency] = useState(initialData?.currency || "TND");
  const [notes, setNotes] = useState(initialData?.notes || "");
  // A new expense is usually sent for approval right away; an edit keeps it a draft unless asked.
  const [submitImmediately, setSubmitImmediately] = useState(!expenseId);

  const total = (parseFloat(String(amount)) || 0) + (parseFloat(String(tax)) || 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const numAmount = parseFloat(String(amount));
    if (isNaN(numAmount) || numAmount <= 0) {
      setError("Please enter a valid expense amount greater than 0.");
      return;
    }

    if (!description.trim()) {
      setError("Description is required.");
      return;
    }

    startTransition(async () => {
      const values = {
        expenseDate,
        categoryId: categoryId || undefined,
        vendor: vendor.trim() || undefined,
        description: description.trim(),
        amount: numAmount,
        tax: parseFloat(String(tax)) || 0,
        currency,
        notes: notes.trim() || undefined,
        receiptDocumentId: initialData?.receiptDocumentId || undefined,
      };
      const res = expenseId ? await updateExpenseAction(expenseId, values) : await createExpenseAction(values);

      if (res.error) {
        setError(res.error);
        return;
      }

      if (submitImmediately && res.data?.id) {
        await submitExpenseAction(res.data.id);
      }

      router.push("/finance/expenses");
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-6 shadow-sm space-y-4">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
          Expense Information
        </h2>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* Expense Date */}
          <div className="space-y-1">
            <label htmlFor={`${uid}-0`} className="text-sm font-medium text-[var(--color-text-secondary)]">Date *</label>
            <input id={`${uid}-0`}
              type="date"
              required
              value={expenseDate}
              onChange={(e) => setExpenseDate(e.target.value)}
              className={selectClass}
            />
          </div>

          {/* Category */}
          <div className="space-y-1">
            <label htmlFor={`${uid}-1`} className="text-sm font-medium text-[var(--color-text-secondary)]">Category</label>
            <select id={`${uid}-1`}
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className={selectClass}
            >
              <option value="">-- Uncategorized --</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {suggesting && <p className="text-xs text-[var(--color-text-secondary)]">Finding a category…</p>}
            {suggestion && !suggesting && (
              <div role="status" className="flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] bg-[var(--color-action-primary)]/10 px-2.5 py-1.5 text-xs text-[var(--color-text-primary)]">
                <Sparkles aria-hidden className="size-3.5 shrink-0 text-[var(--color-action-primary)]" />
                <span className="min-w-0">
                  <strong>{suggestion.categoryName}</strong>: {suggestion.reason}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setCategoryId(suggestion.categoryId);
                    setSuggestion(null);
                  }}
                  className="ml-auto rounded px-2 py-0.5 font-semibold text-[var(--color-action-primary)] hover:bg-[var(--color-action-primary)]/15 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)]"
                >
                  Use
                </button>
              </div>
            )}
          </div>

          {/* Vendor */}
          <div className="sm:col-span-2">
            <TextField
              label="Merchant / Vendor Name"
              placeholder="e.g. Ooredoo, Amazon AWS, Shell, Carrefour..."
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              onBlur={askSuggestion}
            />
          </div>

          {/* Description */}
          <div className="sm:col-span-2">
            <TextField
              label="Description *"
              placeholder="e.g. Monthly cloud hosting, client dinner, printer paper..."
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={askSuggestion}
            />
          </div>

          {/* Amount */}
          <div className="space-y-1">
            <label htmlFor={`${uid}-2`} className="text-sm font-medium text-[var(--color-text-secondary)]">
              Amount (Net) *
            </label>
            <input id={`${uid}-2`}
              type="number"
              step="0.001"
              required
              placeholder="0.000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={selectClass}
            />
          </div>

          {/* Tax */}
          <div className="space-y-1">
            <label htmlFor={`${uid}-3`} className="text-sm font-medium text-[var(--color-text-secondary)]">
              Tax / VAT Amount
            </label>
            <input id={`${uid}-3`}
              type="number"
              step="0.001"
              value={tax}
              onChange={(e) => setTax(e.target.value)}
              className={selectClass}
            />
          </div>

          {/* Currency */}
          <div className="space-y-1">
            <label htmlFor={`${uid}-4`} className="text-sm font-medium text-[var(--color-text-secondary)]">Currency</label>
            <select id={`${uid}-4`}
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className={selectClass}
            >
              <option value="TND">TND (Tunisian Dinar)</option>
              <option value="USD">USD ($)</option>
              <option value="EUR">EUR (€)</option>
              <option value="GBP">GBP (£)</option>
            </select>
          </div>

          {/* Computed Total */}
          <div className="space-y-1">
            <span id={`${uid}-total`} className="block text-sm font-medium text-[var(--color-text-secondary)]">Total Expenditure</span>
            <output aria-labelledby={`${uid}-total`} className="min-h-[44px] flex items-center px-3 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)]/60 font-semibold text-[var(--color-text-primary)]">
              {total.toFixed(3)} {currency}
            </output>
          </div>

          {/* Notes */}
          <div className="sm:col-span-2 space-y-1">
            <label htmlFor={`${uid}-5`} className="text-sm font-medium text-[var(--color-text-secondary)]">Additional Notes</label>
            <textarea id={`${uid}-5`}
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Project code, reimbursement details, etc..."
              className={textareaClass}
            />
          </div>

          {/* Submit immediately checkbox */}
          <div className="sm:col-span-2 pt-2">
            <label className="inline-flex items-center gap-2 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                checked={submitImmediately}
                onChange={(e) => setSubmitImmediately(e.target.checked)}
                className="h-4 w-4 rounded border border-[var(--color-border-control)] accent-[var(--color-action-primary)]"
              />
              <span className="text-[var(--color-text-primary)] font-medium">
                Submit immediately for management approval
              </span>
            </label>
          </div>
        </div>

        {error && <FormMessage kind="error">{error}</FormMessage>}

        <div className="flex justify-end gap-3 pt-4 border-t border-[var(--color-border-subtle)]">
          <Button onClick={() => router.push("/finance/expenses")} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Saving..." : submitImmediately ? "Submit Expense" : "Save as Draft"}
          </Button>
        </div>
      </div>
    </form>
  );
}
