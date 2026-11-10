"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Link from "next/link";
import {
  submitExpenseAction,
  deleteExpenseAction,
  approveExpenseAction,
  rejectExpenseAction,
  markExpensePaidAction,
  exportExpensesCsvAction,
} from "@/features/finance/actions/finance.actions";
import { Button } from "@/shared/components/ui/button";
import { StatusBadge, type BadgeTone } from "@/shared/components/data-display/status-badge";
import { FormMessage } from "@/shared/components/ui/form-message";
import type { ExpenseFlag } from "@/features/finance/utils/insights";
import { Paperclip } from "lucide-react";
import { DialogOverlay } from "@/shared/components/ui/dialog-overlay";

type ExpenseItem = {
  id: string;
  receiptDocumentId?: string;
  companyId: string;
  categoryId?: string;
  categoryName?: string;
  expenseDate: string;
  vendor?: string;
  description: string;
  amount: number;
  tax: number;
  total: number;
  currency: string;
  status: "draft" | "submitted" | "approved" | "rejected" | "paid" | "voided";
  notes?: string;
  rejectionReason?: string;
  createdAt: string;
};

function statusTone(status: string): BadgeTone {
  switch (status) {
    case "paid":
      return "success";
    case "approved":
      return "info";
    case "submitted":
      return "warning";
    case "rejected":
    case "voided":
      return "error";
    default:
      return "neutral";
  }
}

export function ExpenseManager({
  expenses,
  canManage,
  canApprove,
  canPay,
  flags = {},
}: {
  /** Computed by code (see utils/insights): duplicates, unusual amounts, weekend spend, missing receipts. */
  flags?: Record<string, ExpenseFlag[]>;
  expenses: ExpenseItem[];
  canManage: boolean;
  canApprove: boolean;
  canPay: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Rejection modal
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");

  const filtered = expenses.filter((e) => {
    if (filter !== "all" && e.status !== filter) return false;
    const q = search.toLowerCase().trim();
    if (!q) return true;
    return (
      e.description.toLowerCase().includes(q) ||
      (e.vendor && e.vendor.toLowerCase().includes(q)) ||
      (e.categoryName && e.categoryName.toLowerCase().includes(q))
    );
  });

  const fmt = (n: number, c: string) =>
    new Intl.NumberFormat("fr-TN", { style: "currency", currency: c || "TND" }).format(n || 0);

  function handleAction(actionFn: () => Promise<{ error?: string }>, successMsg: string) {
    setMessage(null);
    startTransition(async () => {
      const res = await actionFn();
      if (res?.error) {
        setMessage({ type: "error", text: res.error });
        return;
      }
      setMessage({ type: "success", text: successMsg });
      router.refresh();
    });
  }

  function handleRejectSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!rejectingId || !rejectionReason.trim()) return;
    const expId = rejectingId;
    const reason = rejectionReason.trim();
    setRejectingId(null);
    setRejectionReason("");
    handleAction(
      () => rejectExpenseAction({ expenseId: expId, reason }),
      "Expense rejected."
    );
  }

  function handleExport() {
    startTransition(async () => {
      const res = await exportExpensesCsvAction();
      if (res.error) {
        setMessage({ type: "error", text: res.error });
        return;
      }
      if (res.data?.csv) {
        const blob = new Blob([res.data.csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.setAttribute("download", res.data.filename || "expenses.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }
    });
  }

  // Summary counts
  const totalAmount = expenses
    .filter((e) => e.status !== "rejected" && e.status !== "voided")
    .reduce((sum, e) => sum + (e.total || 0), 0);
  const submittedCount = expenses.filter((e) => e.status === "submitted").length;
  const approvedCount = expenses.filter((e) => e.status === "approved").length;
  const paidCount = expenses.filter((e) => e.status === "paid").length;

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="p-4 bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-[var(--radius-control)]">
          <div className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
            Total Active Expenses
          </div>
          <div className="mt-1 text-xl font-semibold text-[var(--color-text-primary)]">
            {fmt(totalAmount, "TND")}
          </div>
        </div>
        <div className="p-4 bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-[var(--radius-control)]">
          <div className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
            Needs Approval
          </div>
          <div className="mt-1 text-xl font-semibold text-[var(--color-status-warning)]">
            {submittedCount}
          </div>
        </div>
        <div className="p-4 bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-[var(--radius-control)]">
          <div className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
            Approved (Pending Pay)
          </div>
          <div className="mt-1 text-xl font-semibold text-[var(--color-action-primary)]">
            {approvedCount}
          </div>
        </div>
        <div className="p-4 bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-[var(--radius-control)]">
          <div className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
            Paid Out
          </div>
          <div className="mt-1 text-xl font-semibold text-[var(--color-status-success)]">
            {paidCount}
          </div>
        </div>
      </div>

      {message && (
        <FormMessage kind={message.type === "success" ? "success" : "error"}>
          {message.text}
        </FormMessage>
      )}

      {/* Control Bar: Filters, Search, Export & New */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Status filter tabs */}
        <div className="flex flex-wrap gap-1 p-1 rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)]/70 text-xs font-medium">
          {["all", "submitted", "approved", "paid", "draft", "rejected"].map((st) => (
            <button
              key={st}
              onClick={() => setFilter(st)}
              className={`px-3 py-1.5 rounded-[calc(var(--radius-control)*0.7)] capitalize transition-colors ${
                filter === st
                  ? "bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-sm font-semibold"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              }`}
            >
              {st === "submitted" ? "Pending Approval" : st}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search vendor, category, description..."
            className="w-full sm:w-56 min-h-[38px] rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3 text-xs text-[var(--color-text-primary)] focus:outline-none focus:ring-[3px] focus:ring-[var(--color-focus-ring)]"
          />
          {expenses.length > 0 && (
            <Button variant="secondary" onClick={handleExport} disabled={pending} className="text-xs min-h-[38px] px-3">
              ⬇ Export
            </Button>
          )}
          {canManage && (
            <Link
              href="/finance/expenses/new"
              className="inline-flex min-h-[38px] items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-action-primary)] text-[var(--color-action-on-primary)] px-3 text-xs font-semibold hover:bg-[var(--color-action-hover)]"
            >
              + New Expense
            </Link>
          )}
        </div>
      </div>

      {/* Expenses Table */}
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)]/50 text-[var(--color-text-secondary)] font-medium text-xs">
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Vendor</th>
                <th className="py-3 px-4">Category</th>
                <th className="py-3 px-4">Description</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Total</th>
                <th className="py-3 px-4 text-right">Workflow Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border-subtle)]">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-[var(--color-text-secondary)] text-sm">
                    No expenses found matching the current filter.
                  </td>
                </tr>
              ) : (
                filtered.map((e) => (
                  <tr key={e.id} className="hover:bg-[var(--color-bg-subtle)]/40 transition-colors">
                    <td className="py-3 px-4 text-xs text-[var(--color-text-primary)] whitespace-nowrap">
                      {e.expenseDate}
                    </td>
                    <td className="py-3 px-4 font-medium text-[var(--color-text-primary)]">
                      {e.vendor || "—"}
                      {e.receiptDocumentId && (
                        <a
                          href={`/api/v1/finance/receipts/${e.receiptDocumentId}/file`}
                          target="_blank"
                          rel="noreferrer"
                          className="ml-2 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-action-primary)] hover:bg-[var(--color-action-primary)]/10"
                          title="Open the receipt attached to this expense"
                        >
                          <Paperclip aria-hidden className="size-3" /> Receipt
                        </a>
                      )}
                      {flags[e.id]?.length ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {flags[e.id].map((f) => (
                            <span
                              key={f.code}
                              title={f.detail}
                              aria-label={`${f.label}: ${f.detail}`}
                              className={
                                f.code === "duplicate" || f.code === "unusual_amount"
                                  ? "rounded bg-[var(--color-status-warning-bg)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-status-warning)]"
                                  : "rounded bg-[var(--color-bg-subtle)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-text-secondary)]"
                              }
                            >
                              {f.label}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </td>
                    <td className="py-3 px-4 text-xs">
                      {e.categoryName ? (
                        <span className="px-2 py-0.5 rounded bg-[var(--color-bg-subtle)] border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)]">
                          {e.categoryName}
                        </span>
                      ) : (
                        <span className="text-[var(--color-text-secondary)]">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-[var(--color-text-primary)]">
                      <div>{e.description}</div>
                      {e.rejectionReason && (
                        <div className="text-xs text-[var(--color-status-error)] mt-0.5">
                          Rejected: {e.rejectionReason}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <StatusBadge label={e.status.replace("_", " ")} tone={statusTone(e.status)} />
                    </td>
                    <td className="py-3 px-4 text-right font-medium text-[var(--color-text-primary)] tabular-nums">
                      {fmt(e.total, e.currency)}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        {canManage && (e.status === "draft" || e.status === "rejected") && (
                          <>
                            <Link
                              href={`/finance/expenses/${e.id}/edit`}
                              className="px-2 py-1 rounded text-xs font-semibold border border-[var(--color-border-subtle)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-subtle)]"
                            >
                              Edit
                            </Link>
                            {confirmDeleteId === e.id ? (
                              <>
                                <button
                                  onClick={() => {
                                    setConfirmDeleteId(null);
                                    handleAction(() => deleteExpenseAction(e.id), "Expense deleted.");
                                  }}
                                  disabled={pending}
                                  className="px-2 py-1 rounded text-xs font-semibold bg-[var(--color-status-error-bg)] text-[var(--color-status-error)] hover:opacity-80"
                                >
                                  Confirm
                                </button>
                                <button
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="px-2 py-1 rounded text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)]"
                                >
                                  Keep
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => setConfirmDeleteId(e.id)}
                                disabled={pending}
                                title="Delete this expense permanently"
                                className="px-2 py-1 rounded text-xs font-semibold text-[var(--color-status-error)] hover:bg-[var(--color-status-error-bg)]"
                              >
                                Delete
                              </button>
                            )}
                          </>
                        )}

                        {/* Draft -> Submit */}
                        {canManage && e.status === "draft" && (
                          <button
                            onClick={() =>
                              handleAction(
                                () => submitExpenseAction(e.id),
                                "Expense submitted for approval."
                              )
                            }
                            disabled={pending}
                            className="px-2 py-1 rounded text-xs font-semibold bg-[var(--color-action-primary)]/10 text-[var(--color-action-primary)] hover:bg-[var(--color-action-primary)]/20"
                          >
                            Submit
                          </button>
                        )}

                        {/* Submitted -> Approve / Reject */}
                        {canApprove && e.status === "submitted" && (
                          <>
                            <button
                              onClick={() =>
                                handleAction(
                                  () => approveExpenseAction(e.id),
                                  "Expense approved."
                                )
                              }
                              disabled={pending}
                              className="px-2 py-1 rounded text-xs font-semibold bg-[var(--color-status-success-bg)] text-[var(--color-status-success)] hover:opacity-80"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => {
                                setRejectingId(e.id);
                                setRejectionReason("");
                              }}
                              disabled={pending}
                              className="px-2 py-1 rounded text-xs font-semibold bg-[var(--color-status-error-bg)] text-[var(--color-status-error)] hover:opacity-80"
                            >
                              Reject
                            </button>
                          </>
                        )}

                        {/* Approved -> Mark Paid */}
                        {canPay && e.status === "approved" && (
                          <button
                            onClick={() =>
                              handleAction(
                                () => markExpensePaidAction(e.id),
                                "Expense marked as paid."
                              )
                            }
                            disabled={pending}
                            className="px-2 py-1 rounded text-xs font-semibold bg-[var(--color-status-success-bg)] text-[var(--color-status-success)] hover:opacity-80"
                          >
                            Mark Paid
                          </button>
                        )}

                        {e.status === "paid" && (
                          <span className="text-xs text-[var(--color-status-success)] font-medium">
                            ✓ Settled
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Rejection Modal */}
      {rejectingId && (
        <DialogOverlay label="Reject expense" onClose={() => setRejectingId(null)} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-6 shadow-xl space-y-4">
            <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">
              Reject Expense
            </h3>
            <p className="text-xs text-[var(--color-text-secondary)]">
              Please enter the reason for rejecting this expense claim.
            </p>
            <form onSubmit={handleRejectSubmit} className="space-y-4">
              <div className="space-y-1">
                <label htmlFor="reject-reason" className="text-sm font-medium text-[var(--color-text-secondary)]">
                  Rejection Reason *
                </label>
                <textarea id="reject-reason"
                  required
                  rows={3}
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  placeholder="e.g. Missing receipt, exceeds travel policy limit..."
                  className="w-full rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-[3px] focus:ring-[var(--color-focus-ring)]"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setRejectingId(null)}>
                  Cancel
                </Button>
                <Button variant="danger" type="submit" disabled={!rejectionReason.trim()}>
                  Confirm Rejection
                </Button>
              </div>
            </form>
          </div>
        </DialogOverlay>
      )}
    </div>
  );
}
