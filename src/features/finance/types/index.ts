export type FinanceStatus =
  | "draft"
  | "submitted"
  | "posted"
  | "partially_paid"
  | "paid"
  | "overdue"
  | "voided"
  | "cancelled"
  | "approved"
  | "rejected"
  | "credited";

export type CurrencyCode = "TND" | "USD" | "EUR" | "GBP";

export type PaymentMethod = "cash" | "bank_transfer" | "card" | "cheque" | "other";

export type Customer = {
  id: string;
  companyId: string;
  name: string;
  email?: string;
  phone?: string;
  taxId?: string;
  address?: string;
  notes?: string;
  status: "active" | "inactive";
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;
};

export type InvoiceLine = {
  id: string;
  invoiceId: string;
  productId?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate?: number;
  lineTotal: number;
};

export type Invoice = {
  id: string;
  companyId: string;
  customerId: string;
  customer?: Pick<Customer, "id" | "name" | "email" | "taxId">;
  invoiceNumber: string;
  status: Extract<FinanceStatus, "draft" | "posted" | "partially_paid" | "paid" | "overdue" | "voided" | "cancelled" | "credited">;
  currency: CurrencyCode;
  issueDate: string;
  dueDate?: string;
  notes?: string;
  terms?: string;
  subtotal: number;
  taxTotal: number;
  total: number;
  amountPaid: number;
  balance: number;
  lines: InvoiceLine[];
  postedAt?: string;
  postedBy?: string;
  voidedAt?: string;
  voidedBy?: string;
  voidReason?: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;
};

export type Payment = {
  id: string;
  companyId: string;
  paymentDate: string;
  amount: number;
  currency: CurrencyCode;
  method: PaymentMethod;
  reference?: string;
  receivedBy?: string;
  notes?: string;
  unallocatedAmount: number;
  createdAt: string;
  updatedAt: string;
};

export type PaymentAllocation = {
  id: string;
  companyId: string;
  paymentId: string;
  invoiceId: string;
  amount: number;
  allocatedAt: string;
  allocatedBy?: string;
};

export type ExpenseCategory = {
  id: string;
  companyId: string;
  name: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Expense = {
  id: string;
  companyId: string;
  categoryId?: string;
  category?: ExpenseCategory;
  expenseDate: string;
  vendor?: string;
  description: string;
  amount: number;
  tax?: number;
  total: number;
  currency: CurrencyCode;
  status: Extract<FinanceStatus, "draft" | "submitted" | "approved" | "rejected" | "paid" | "voided">;
  receiptDocumentId?: string;
  submittedAt?: string;
  submittedBy?: string;
  approvedAt?: string;
  approvedBy?: string;
  rejectedAt?: string;
  rejectedBy?: string;
  rejectionReason?: string;
  paidAt?: string;
  paidBy?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;
};

export type ReceiptDocument = {
  id: string;
  companyId: string;
  storageKey: string;
  mimeType: string;
  originalName: string;
  size?: number;
  uploadedBy: string;
  uploadedAt: string;
};

export type ReceiptExtraction = {
  id: string;
  companyId: string;
  receiptDocumentId: string;
  provider: string;
  model: string;
  rawText?: string;
  proposed: {
    vendor?: string | null;
    date?: string | null;
    amount?: number | null;
    currency?: string | null;
    tax?: number | null;
    total?: number | null;
    categoryHint?: string | null;
    notes?: string | null;
    confidence?: number | null;
  };
  reviewed: boolean;
  reviewedBy?: string;
  reviewedAt?: string;
  appliedToExpenseId?: string;
  createdAt: string;
  updatedAt: string;
};

export type FinanceDashboardKpi = {
  totalInvoiced: number;
  totalPaid: number;
  outstanding: number;
  overdue: number;
  expensesDraft: number;
  expensesSubmitted: number;
  expensesApproved: number;
  expensesPaid: number;
  currency: CurrencyCode;
};
