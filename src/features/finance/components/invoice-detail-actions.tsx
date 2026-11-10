"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Link from "next/link";
import { createCreditNoteAction, deleteInvoiceDraftAction, duplicateInvoiceAction, postInvoiceAction, voidInvoiceAction } from "@/features/finance/actions/finance.actions";
import { Button } from "@/shared/components/ui/button";
import { FormMessage } from "@/shared/components/ui/form-message";
import { DialogOverlay } from "@/shared/components/ui/dialog-overlay";

export function InvoiceDetailActions({
  invoiceId,
  invoiceNumber,
  status,
  canPost,
  canManage = false,
  balance = 0,
  currency = "TND",
}: {
  invoiceId: string;
  invoiceNumber: string;
  status: string;
  canPost: boolean;
  canManage?: boolean;
  balance?: number;
  currency?: string;
}) {
  const [creditOpen, setCreditOpen] = useState(false);
  const [creditAmount, setCreditAmount] = useState(String(balance));
  const [creditReason, setCreditReason] = useState("");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showVoidModal, setShowVoidModal] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingPost, setConfirmingPost] = useState(false);

  function handlePrint() {
    window.print();
  }

  function handlePost() {
    setConfirmingPost(false);
    setError(null);
    startTransition(async () => {
      const res = await postInvoiceAction(invoiceId);
      if (res.error) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  function handleDuplicate() {
    setError(null);
    startTransition(async () => {
      const res = await duplicateInvoiceAction(invoiceId);
      if (res.error || !res.data) return setError(res.error ?? "Could not duplicate.");
      router.push(`/finance/invoices/${res.data.id}/edit`);
    });
  }

  function handleCredit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createCreditNoteAction(invoiceId, { amount: Number(creditAmount), reason: creditReason });
      if (res.error) return setError(res.error);
      setCreditOpen(false);
      setCreditReason("");
      router.refresh();
    });
  }

  function handleDelete() {
    setConfirmingDelete(false);
    setError(null);
    startTransition(async () => {
      const res = await deleteInvoiceDraftAction(invoiceId);
      if (res.error) {
        setError(res.error);
        return;
      }
      router.push("/finance/invoices");
      router.refresh();
    });
  }

  function handleVoid(e: React.FormEvent) {
    e.preventDefault();
    if (!voidReason.trim()) {
      setError("Please provide a reason for voiding this invoice.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await voidInvoiceAction({ invoiceId, reason: voidReason.trim() });
      if (res.error) {
        setError(res.error);
        return;
      }
      setShowVoidModal(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {/* Action buttons (hidden when printing) */}
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href="/finance/invoices"
          className="text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] flex items-center gap-1"
        >
          ← Back to Invoices
        </Link>

        <div className="flex flex-wrap items-center gap-2">
          {/* Print / Download PDF */}
          <Button variant="secondary" onClick={handlePrint} className="flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" />
              <path d="M6 14h12v8H6z" />
            </svg>
            Print / Save as PDF
          </Button>

          {canManage && status === "draft" && (
            <>
              <Link
                href={`/finance/invoices/${invoiceId}/edit`}
                className="inline-flex items-center min-h-[38px] px-3.5 text-sm font-medium rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-subtle)]"
              >
                Edit Draft
              </Link>
              {confirmingDelete ? (
                <>
                  <Button variant="danger" onClick={handleDelete} disabled={pending}>
                    {pending ? "Deleting..." : "Confirm delete"}
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmingDelete(false)} disabled={pending}>
                    Keep draft
                  </Button>
                </>
              ) : (
                <Button variant="danger" onClick={() => setConfirmingDelete(true)} disabled={pending} title="Delete this draft permanently">
                  Delete Draft
                </Button>
              )}
            </>
          )}

          {canManage && (
            <Button onClick={handleDuplicate} disabled={pending} title="Copy this invoice into a new draft dated today">
              Duplicate
            </Button>
          )}

          {canPost && (status === "posted" || status === "partially_paid") && balance > 0 && (
            <Button onClick={() => setCreditOpen((v) => !v)} disabled={pending} title="Lower what the customer owes with a numbered credit note">
              Credit note
            </Button>
          )}

          {/* Post Invoice Button */}
          {canPost && status === "draft" &&
            (confirmingPost ? (
              <>
                <Button variant="primary" onClick={handlePost} disabled={pending} title={`Make ${invoiceNumber} official. Posted invoices can no longer be edited.`}>
                  {pending ? "Posting..." : "Confirm post"}
                </Button>
                <Button variant="ghost" onClick={() => setConfirmingPost(false)} disabled={pending}>Not yet</Button>
              </>
            ) : (
              <Button variant="primary" onClick={() => setConfirmingPost(true)} disabled={pending} title="Make this invoice official">
                Post Invoice
              </Button>
            ))}

          {/* Void Invoice Button */}
          {canPost && status !== "voided" && status !== "cancelled" && (
            <Button
              variant="danger"
              onClick={() => setShowVoidModal(true)}
              disabled={pending}
            >
              Void Invoice
            </Button>
          )}
        </div>
      </div>

      {creditOpen && (
        <form onSubmit={handleCredit} className="grid gap-3 rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-end print:hidden">
          <div className="space-y-1">
            <label htmlFor="cn-amount" className="text-sm font-semibold text-[var(--color-text-primary)]">Credit ({currency})</label>
            <input id="cn-amount" type="number" inputMode="decimal" step="0.01" min="0.01" max={balance} required value={creditAmount} onChange={(e) => setCreditAmount(e.target.value)} placeholder="0.00" className="w-full min-h-[44px] rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3 text-sm text-[var(--color-text-primary)]" />
          </div>
          <div className="space-y-1">
            <label htmlFor="cn-reason" className="text-sm font-semibold text-[var(--color-text-primary)]">Reason</label>
            <input id="cn-reason" required minLength={3} maxLength={300} value={creditReason} onChange={(e) => setCreditReason(e.target.value)} placeholder="e.g. Returned item, agreed discount, billing error" className="w-full min-h-[44px] rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3 text-sm text-[var(--color-text-primary)]" />
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setCreditOpen(false)} disabled={pending}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={pending}>{pending ? "Issuing..." : "Issue credit note"}</Button>
          </div>
          <p className="text-xs text-[var(--color-text-secondary)] sm:col-span-3">At most the open balance ({balance.toFixed(2)} {currency}). A credit note gets its own number and cannot be edited afterwards.</p>
        </form>
      )}

      {error && (
        <div className="print:hidden">
          <FormMessage kind="error">{error}</FormMessage>
        </div>
      )}

      {/* Void Reason Modal */}
      {showVoidModal && (
        <DialogOverlay label="Void invoice" onClose={() => setShowVoidModal(false)} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 print:hidden backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-6 shadow-xl space-y-4">
            <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">
              Void Invoice: {invoiceNumber}
            </h3>
            <p className="text-xs text-[var(--color-text-secondary)]">
              Voiding cancels this invoice and zeros its receivable balance. A mandatory reason is required for tax and audit logs.
            </p>
            <form onSubmit={handleVoid} className="space-y-4">
              <div className="space-y-1">
                <label htmlFor="void-reason" className="text-sm font-medium text-[var(--color-text-secondary)]">
                  Reason for Voiding *
                </label>
                <textarea id="void-reason"
                  required
                  rows={3}
                  value={voidReason}
                  onChange={(e) => setVoidReason(e.target.value)}
                  placeholder="e.g. Billing address error, customer order cancelled..."
                  className="w-full rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-[3px] focus:ring-[var(--color-focus-ring)]"
                />
              </div>

              <div className="flex justify-end gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setShowVoidModal(false)}
                  disabled={pending}
                >
                  Cancel
                </Button>
                <Button variant="danger" type="submit" disabled={pending || !voidReason.trim()}>
                  {pending ? "Voiding..." : "Confirm Void"}
                </Button>
              </div>
            </form>
          </div>
        </DialogOverlay>
      )}
    </div>
  );
}
