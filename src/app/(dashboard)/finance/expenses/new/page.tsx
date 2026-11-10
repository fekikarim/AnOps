import type { Metadata } from "next";
import { getFinanceService } from "@/server/services/finance.service";
import { ExpenseForm } from "@/features/finance/components/expense-form";
import Link from "next/link";
import type { FinanceService } from "@/server/services/finance.service";

export const metadata: Metadata = {
  title: "New Expense | Finance | AnOps ERP",
  description: "Record a new business expense or employee reimbursement claim.",
};

export default async function NewExpensePage({
  searchParams,
}: {
  searchParams: Promise<{
    vendor?: string;
    amount?: string;
    tax?: string;
    date?: string;
    currency?: string;
    categoryHint?: string;
    receiptDocumentId?: string;
  }>;
}) {
  const params = await searchParams;

  let categories: Awaited<ReturnType<FinanceService["listExpenseCategories"]>> = [];
  try {
    const service = await getFinanceService();
    categories = await service.listExpenseCategories();
  } catch {
    categories = [];
  }

  const initialData = {
    vendor: params.vendor,
    amount: params.amount ? parseFloat(params.amount) : undefined,
    tax: params.tax ? parseFloat(params.tax) : 0,
    date: params.date,
    currency: params.currency || "TND",
    categoryHint: params.categoryHint,
    receiptDocumentId: params.receiptDocumentId,
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs text-[var(--color-text-secondary)] mb-1">
          <Link href="/finance/expenses" className="hover:underline">
            ← Back to Expenses
          </Link>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-text-primary)]">
          Record New Expense
        </h1>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Submit an operational or capital expenditure with vendor, tax, and categorization
        </p>
      </div>

      <ExpenseForm categories={categories} initialData={initialData} />
    </div>
  );
}
