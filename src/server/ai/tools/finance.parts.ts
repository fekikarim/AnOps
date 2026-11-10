import "server-only";
import type { AiAccess } from "@/server/ai/access/access.service";
import { centsText, money, moneyOf, toCents, todayTunis } from "@/server/ai/finance/money";
import type { AiAction, AiBadge, AiRecordCardPart, AiRecordTablePart } from "@/server/db/documents";
import type { FinanceService } from "@/server/services/finance.service";
import type { AiOperation } from "@/shared/domain/ai";

/**
 * Finance results as structured parts. Every amount is printed from the service's own figures
 * (or whole-cent sums of them) with its currency. Actions are offered only when the member's live access
 * and the record's state allow them; each goes back through the command runner, which authorises it again.
 */
type Svc = FinanceService;
export type CustomerRow = Awaited<ReturnType<Svc["listCustomers"]>>[number];
export type InvoiceRow = Awaited<ReturnType<Svc["listInvoices"]>>[number];
export type InvoiceDetail = Awaited<ReturnType<Svc["getInvoice"]>>;
export type PaymentRow = Awaited<ReturnType<Svc["listPayments"]>>[number];
export type ExpenseRow = Awaited<ReturnType<Svc["listExpenses"]>>[number];
export type UnpaidRow = Awaited<ReturnType<Svc["listUnpaidInvoices"]>>[number];
type InvLine = { description: string; quantity: number; unitPrice: number; taxRate?: number };
export type Dashboard = Awaited<ReturnType<Svc["getDashboard"]>>;

export const PAGE_SIZE = 20;
const can = (access: AiAccess, op: AiOperation) => access.can("finance", op);

export function paginate<T>(items: T[], page: number) {
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const p = Math.min(Math.max(1, page), totalPages);
  return { slice: items.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE), page: p, totalPages, total: items.length };
}

type Args = Record<string, string | number | boolean>;

export const INVOICE_STATUS: Record<string, AiBadge> = {
  draft: { label: "Draft", tone: "neutral" },
  posted: { label: "Posted", tone: "info" },
  partially_paid: { label: "Partially paid", tone: "warning" },
  paid: { label: "Paid", tone: "success" },
  voided: { label: "Voided", tone: "error" },
  overdue: { label: "Overdue", tone: "error" },
};
export const EXPENSE_STATUS: Record<string, AiBadge> = {
  draft: { label: "Draft", tone: "neutral" },
  submitted: { label: "Submitted", tone: "info" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "error" },
  paid: { label: "Paid", tone: "success" },
};

/** Overdue is derived the way the Finance dashboard derives it: open, with a due date before today. */
export function isOverdue(i: { status: string; dueDate?: string; balance: number }, today = todayTunis()): boolean {
  return (i.status === "posted" || i.status === "partially_paid") && toCents(i.balance) > 0 && !!i.dueDate && i.dueDate.slice(0, 10) < today;
}
export const invoiceBadge = (i: { status: string; dueDate?: string; balance: number }): AiBadge => (isOverdue(i) ? INVOICE_STATUS.overdue : INVOICE_STATUS[i.status] ?? { label: i.status, tone: "neutral" });

export function customersTable(rows: CustomerRow[], page: number, args: Args, access: AiAccess, select = false, command = "customers"): AiRecordTablePart {
  const p = paginate(rows, page);
  return {
    type: "record_table",
    title: select ? "Choose a customer" : "Customers",
    columns: [
      { key: "name", label: "Customer" },
      { key: "email", label: "Email" },
      { key: "phone", label: "Phone" },
      { key: "taxId", label: "Tax ID" },
    ],
    rows: p.slice.map((c) => ({
      id: c.id,
      cells: { name: c.name, email: c.email || "None", phone: c.phone || "None", taxId: c.taxId || "None" },
      badge: c.status === "active" ? { label: "Active", tone: "success" } : { label: "Inactive", tone: "neutral" },
      actions: select
        ? [{ label: "Select", command, args: { customerId: c.id }, step: "select" as const }]
        : [{ label: "Open", command: "customer", args: { customerId: c.id } }, ...(can(access, "edit") ? [{ label: "Edit", command: "editcustomer", args: { customerId: c.id }, step: "select" as const }] : [])],
    })),
    total: p.total,
    emptyMessage: "No customers match. Add one with /newcustomer.",
    paging: { page: p.page, totalPages: p.totalPages, command: select ? command : "customers", args },
  };
}

export function customerCard(c: CustomerRow, access: AiAccess, open: { currency: string; balanceCents: number }[], invoices: InvoiceRow[]): AiRecordCardPart {
  const args = { customerId: c.id };
  const actions: AiAction[] = [];
  if (can(access, "create") && c.status === "active") actions.push({ label: "New invoice", command: "newinvoice", args, step: "manual" });
  if (can(access, "edit")) actions.push({ label: "Edit customer", command: "editcustomer", args, step: "select" });
  if (can(access, "view")) actions.push({ label: "Invoices", command: "invoices", args: { customerId: c.id } });
  return {
    type: "record_card",
    title: c.name,
    subtitle: c.email || undefined,
    badges: [c.status === "active" ? { label: "Active", tone: "success" } : { label: "Inactive", tone: "neutral" }],
    fields: [
      { label: "Phone", value: c.phone || "None" },
      { label: "Tax ID", value: c.taxId || "None" },
      { label: "Address", value: c.address || "None" },
      { label: "Open balance", value: open.length ? open.map((o) => money(o.balanceCents, o.currency)).join(" · ") : "Nothing owed" },
      ...(c.notes ? [{ label: "Notes", value: c.notes }] : []),
    ],
    sections: invoices.length
      ? [{ title: `Latest invoices (${invoices.length})`, rows: invoices.slice(0, 8).map((i) => ({ label: `${i.invoiceNumber} · ${invoiceBadge(i).label}`, value: `${moneyOf(i.total, i.currency)} · balance ${moneyOf(i.balance, i.currency)}` })) }]
      : undefined,
    actions,
  };
}

export function invoicesTable(rows: InvoiceRow[], page: number, args: Args, select: { command: string } | null = null, title = "Invoices"): AiRecordTablePart {
  const p = paginate(rows, page);
  return {
    type: "record_table",
    title,
    columns: [
      { key: "number", label: "Invoice" },
      { key: "customer", label: "Customer" },
      { key: "due", label: "Due" },
      { key: "total", label: "Total", align: "right" },
      { key: "balance", label: "Balance", align: "right" },
    ],
    rows: p.slice.map((i) => ({
      id: i.id,
      cells: { number: i.invoiceNumber, customer: i.customer?.name ?? "Direct customer", due: i.dueDate?.slice(0, 10) ?? "None", total: moneyOf(i.total, i.currency), balance: moneyOf(i.balance, i.currency) },
      badge: invoiceBadge(i),
      actions: [select ? { label: "Select", command: select.command, args: { invoiceId: i.id }, step: "select" as const } : { label: "Open", command: "invoice", args: { invoiceId: i.id } }],
    })),
    total: p.total,
    emptyMessage: "No invoices match. Create one with /newinvoice.",
    paging: { page: p.page, totalPages: p.totalPages, command: select ? select.command : "invoices", args },
  };
}

export function invoiceCard(inv: InvoiceDetail, access: AiAccess, canPost: boolean, canPay: boolean): AiRecordCardPart {
  const args = { invoiceId: inv.id };
  const actions: AiAction[] = [];
  if (inv.status === "draft" && canPost && can(access, "approve")) actions.push({ label: "Post invoice", command: "postinvoice", args, step: "select" });
  if ((inv.status === "posted" || inv.status === "partially_paid") && canPay && can(access, "create")) actions.push({ label: "Record a payment", command: "recordpayment", args: { invoiceId: inv.id }, step: "manual" });
  if ((inv.status === "posted" || inv.status === "partially_paid") && canPay && can(access, "edit")) actions.push({ label: "Allocate a payment", command: "allocate", args: { invoiceId: inv.id }, step: "start" });
  if (["draft", "posted", "partially_paid"].includes(inv.status) && toCents(inv.amountPaid) === 0 && canPost && can(access, "delete")) actions.push({ label: "Void invoice", command: "voidinvoice", args, step: "select" });
  const c = inv.currency as string;
  return {
    type: "record_card",
    title: inv.invoiceNumber,
    subtitle: inv.customer?.name ?? "Direct customer",
    badges: [invoiceBadge(inv)],
    fields: [
      { label: "Issued", value: inv.issueDate?.slice(0, 10) ?? "None" },
      { label: "Due", value: inv.dueDate?.slice(0, 10) ?? "None" },
      { label: "Subtotal", value: moneyOf(inv.subtotal, c) },
      { label: "Tax", value: moneyOf(inv.taxTotal, c) },
      { label: "Total", value: moneyOf(inv.total, c) },
      { label: "Paid", value: moneyOf(inv.amountPaid, c) },
      { label: "Balance", value: moneyOf(inv.balance, c) },
      ...(inv.voidReason ? [{ label: "Void reason", value: inv.voidReason }] : []),
      ...(inv.notes ? [{ label: "Notes", value: inv.notes }] : []),
    ],
    sections: [
      { title: "Lines (quantity × unit price, tax)", rows: inv.lines.map((l: InvLine) => ({ label: l.description, value: `${l.quantity} × ${centsText(toCents(l.unitPrice))} (+${l.taxRate ?? 0}%)` })) },
      ...(inv.allocations.length ? [{ title: "Payments applied", rows: inv.allocations.map((a) => ({ label: a.allocatedAt.slice(0, 10), value: moneyOf(a.amount, c) })) }] : []),
    ],
    actions,
  };
}

export function paymentsTable(rows: PaymentRow[], page: number, args: Args, access: AiAccess, select: { command: string } | null = null): AiRecordTablePart {
  const p = paginate(rows, page);
  return {
    type: "record_table",
    title: select ? "Choose a payment to allocate" : "Payments received",
    columns: [
      { key: "date", label: "Date" },
      { key: "method", label: "Method" },
      { key: "reference", label: "Reference" },
      { key: "amount", label: "Amount", align: "right" },
      { key: "unallocated", label: "Unallocated", align: "right" },
    ],
    rows: p.slice.map((r) => ({
      id: r.id,
      cells: { date: r.paymentDate?.slice(0, 10) ?? "", method: (r.method ?? "").replace("_", " "), reference: r.reference || "None", amount: moneyOf(r.amount, r.currency), unallocated: moneyOf(r.unallocatedAmount, r.currency) },
      badge: toCents(r.unallocatedAmount) > 0 ? { label: "To allocate", tone: "warning" } : { label: "Allocated", tone: "success" },
      actions: toCents(r.unallocatedAmount) > 0 && can(access, "edit") ? [{ label: select ? "Select" : "Allocate", command: select?.command ?? "allocate", args: { paymentId: r.id, ...(args.invoiceId ? { invoiceId: String(args.invoiceId) } : {}) }, step: "select" as const }] : [],
    })),
    total: p.total,
    emptyMessage: select ? "No payment has an unallocated amount. Record one with /recordpayment." : "No payments recorded yet.",
    paging: { page: p.page, totalPages: p.totalPages, command: select ? select.command : "payments", args },
  };
}

export function unpaidTable(rows: UnpaidRow[], page: number, args: Args, select: { command: string } | null = null): AiRecordTablePart {
  const p = paginate(rows, page);
  return {
    type: "record_table",
    title: select ? "Choose an invoice" : "Unpaid invoices",
    columns: [
      { key: "number", label: "Invoice" },
      { key: "customer", label: "Customer" },
      { key: "due", label: "Due" },
      { key: "balance", label: "Balance", align: "right" },
    ],
    rows: p.slice.map((i) => ({
      id: i.id,
      cells: { number: i.invoiceNumber, customer: i.customerName ?? "Direct customer", due: i.dueDate?.slice(0, 10) ?? "None", balance: moneyOf(i.balance, i.currency) },
      badge: isOverdue({ status: "posted", dueDate: i.dueDate, balance: i.balance }) ? INVOICE_STATUS.overdue : INVOICE_STATUS.posted,
      actions: [select ? { label: "Select", command: select.command, args: { invoiceId: i.id }, step: "select" as const } : { label: "Open", command: "invoice", args: { invoiceId: i.id } }],
    })),
    total: p.total,
    emptyMessage: "Nothing is unpaid.",
    paging: { page: p.page, totalPages: p.totalPages, command: select ? select.command : "unpaid", args },
  };
}

export function expensesTable(rows: ExpenseRow[], page: number, args: Args, access: AiAccess, select: { command: string } | null = null): AiRecordTablePart {
  const p = paginate(rows, page);
  return {
    type: "record_table",
    title: select ? "Choose an expense" : "Expenses",
    columns: [
      { key: "date", label: "Date" },
      { key: "vendor", label: "Vendor" },
      { key: "description", label: "Description" },
      { key: "category", label: "Category" },
      { key: "total", label: "Total", align: "right" },
    ],
    rows: p.slice.map((e) => {
      const actions: AiAction[] = [];
      if (select) actions.push({ label: "Select", command: select.command, args: { expenseId: e.id }, step: "select" });
      else {
        if (e.status === "draft" && can(access, "edit")) actions.push({ label: "Submit", command: "submitexpense", args: { expenseId: e.id }, step: "select" });
        if (e.status === "submitted" && can(access, "approve")) {
          actions.push({ label: "Approve", command: "approveexpense", args: { expenseId: e.id }, step: "select" });
          actions.push({ label: "Reject", command: "rejectexpense", args: { expenseId: e.id }, step: "select" });
        }
      }
      return {
        id: e.id,
        cells: { date: e.expenseDate?.slice(0, 10) ?? "", vendor: e.vendor || "None", description: e.description, category: e.categoryName || "Uncategorized", total: moneyOf(e.total, e.currency) },
        badge: EXPENSE_STATUS[e.status] ?? { label: e.status, tone: "neutral" },
        actions,
      };
    }),
    total: p.total,
    emptyMessage: "No expenses match. Add one with /newexpense.",
    paging: { page: p.page, totalPages: p.totalPages, command: select ? select.command : "expenses", args },
  };
}

export function summaryCard(d: Dashboard, notes: string[]): AiRecordCardPart {
  const c = d.currency;
  return {
    type: "record_card",
    title: "Finance summary",
    subtitle: "Figures as calculated by the Finance dashboard",
    fields: [
      { label: "Invoiced", value: moneyOf(d.totalInvoiced, c) },
      { label: "Collected", value: moneyOf(d.totalPaid, c) },
      { label: "Outstanding", value: moneyOf(d.outstanding, c) },
      { label: "Overdue", value: `${moneyOf(d.overdue, c)} (${d.overdueCount} invoice${d.overdueCount === 1 ? "" : "s"})` },
      { label: "Expenses", value: `${d.expensesDraft} draft · ${d.expensesSubmitted} submitted · ${d.expensesApproved} approved · ${d.expensesPaid} paid` },
      { label: "Expenses paid", value: moneyOf(d.totalExpensesPaidAmount, c) },
      { label: "Net cash flow", value: moneyOf(d.netCashFlow, c) },
    ],
    sections: [
      ...(d.topOverdueInvoices.length ? [{ title: "Most overdue", rows: d.topOverdueInvoices.map((i) => ({ label: `${i.invoiceNumber} · ${i.customerName}`, value: `${moneyOf(i.balance, i.currency)} · due ${String(i.dueDate).slice(0, 10)}` })) }] : []),
      { title: "Last 6 months (payments in, approved or paid expenses out)", rows: d.monthlySummary.map((m) => ({ label: m.label, value: `in ${moneyOf(m.income, c)} · out ${moneyOf(m.expenses, c)} · net ${moneyOf(m.net, c)}` })) },
      ...(notes.length ? [{ title: "Read this first", rows: notes.map((n) => ({ label: "Note", value: n })) }] : []),
    ],
  };
}
