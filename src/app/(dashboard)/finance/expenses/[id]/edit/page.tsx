import type { Metadata } from "next";
import Link from "next/link";
import { Paperclip } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { getFinanceService } from "@/server/services/finance.service";
import { ExpenseForm } from "@/features/finance/components/expense-form";

export const metadata: Metadata = {
  title: "Edit Expense | Finance | AnOps ERP",
  description: "Correct a draft or rejected expense before submitting it.",
};

export default async function EditExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = await getFinanceService().catch(() => null);
  if (!service) notFound();

  const expense = await service.getExpense(id).catch(() => null);
  if (!expense) notFound();
  // Submitted, approved and paid expenses are locked.
  if (!["draft", "rejected"].includes(expense.status) || !service.hasPermission("finance.expense.manage")) redirect("/finance/expenses");

  const categories = await service.listExpenseCategories();

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs text-[var(--color-text-secondary)] mb-1">
          <Link href="/finance/expenses" className="hover:underline">
            ← Back to Expenses
          </Link>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-text-primary)]">Edit Expense</h1>
        {expense.status === "rejected" && expense.rejectionReason ? (
          <p className="text-sm text-[var(--color-status-error)]">Rejected: {expense.rejectionReason}. Saving puts it back to draft.</p>
        ) : (
          <p className="text-sm text-[var(--color-text-secondary)]">Draft expenses can be changed until they are submitted.</p>
        )}
        {expense.receiptDocumentId && (
          <a href={`/api/v1/finance/receipts/${expense.receiptDocumentId}/file`} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-action-primary)] hover:underline">
            <Paperclip aria-hidden className="size-4" /> View the attached receipt
          </a>
        )}
      </div>
      <ExpenseForm
        categories={categories}
        expenseId={expense.id}
        initialData={{
          categoryId: expense.categoryId,
          vendor: expense.vendor,
          amount: expense.amount,
          tax: expense.tax,
          date: expense.expenseDate,
          currency: expense.currency,
          description: expense.description,
          notes: expense.notes,
          receiptDocumentId: expense.receiptDocumentId,
        }}
      />
    </div>
  );
}
