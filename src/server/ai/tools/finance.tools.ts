import "server-only";
import { z } from "zod";
import { defineTool, type AiToolDefinition } from "@/server/ai/tools/define-tool";
import { modelRows } from "@/server/ai/tools/inventory.parts";
import {
  customerCard,
  customersTable,
  expensesTable,
  invoiceBadge,
  invoiceCard,
  invoicesTable,
  paymentsTable,
  summaryCard,
  unpaidTable,
  type ExpenseRow,
  type InvoiceDetail,
  type PaymentRow,
} from "@/server/ai/tools/finance.parts";
import {
  CURRENCIES,
  MoneyError,
  centsText,
  fromCents,
  invoiceTotalsCents,
  lineTotalCents,
  money,
  moneyOf,
  parseAmountCents,
  parseDate,
  parsePositiveCents,
  parseQuantityInt,
  parseRate,
  toCents,
  todayTunis,
} from "@/server/ai/finance/money";
import {
  customerCreateSchema,
  customerUpdateSchema,
  expenseCategorySchema,
  expenseCreateSchema,
  expenseRejectSchema,
  invoiceCreateDraftSchema,
  invoiceVoidSchema,
  paymentAllocateSchema,
  paymentRecordSchema,
} from "@/features/finance/schemas/finance.schema";
import type { CompanyRole } from "@/features/company/types";
import { FinanceService } from "@/server/services/finance.service";
import { PERMISSIONS } from "@/server/security/permissions";
import type { WorkspaceContext } from "@/server/tenancy/workspace";
import { AppError } from "@/shared/lib/errors";
import { objectIdSchema } from "@/shared/lib/schema-primitives";
import { toFieldErrors } from "@/shared/lib/validation";
import type { AiDiffRow } from "@/server/db/documents";

/**
 * Finance tools: thin wrappers over FinanceService and its schemas. Nothing here calculates an
 * authoritative amount with a model: totals come from the module's own computeTotals, balances are
 * compared in whole cents, and every figure shown is read back from the service.
 *
 * Grant cells: view = every read and the summary; create = customers, invoice drafts, expenses,
 * categories and recording a payment received; edit = customer changes, expense submission and
 * allocating a payment to invoices; delete = voiding an invoice; approve = posting an invoice,
 * approving or rejecting an expense. Each tool also asserts the exact service permission.
 *
 * Deliberately NOT available through AI: marking an expense paid, receipt scanning, deleting a
 * customer, and anything that would move real money. "Record a payment" only records money that
 * has already been received.
 *
 * Stale-record protection: prepare() stores a fingerprint of every record the change depends on and run()
 * compares it with the live record, so a change made in the meantime stops the confirmation.
 */
const R = PERMISSIONS.FINANCE_READ;
const optText = (max: number) => z.string().max(max).optional();
const amount = z.union([z.string().max(30), z.number()]).transform((v) => String(v));
const pageNo = z.number().int().min(1).max(1000).optional();
const METHODS = ["cash", "bank_transfer", "card", "cheque", "other"] as const;
const METHOD_LABEL: Record<string, string> = { cash: "cash", bank_transfer: "bank transfer", card: "card", cheque: "cheque", other: "other" };

const COMPANY_ROLE: Record<WorkspaceContext["role"], CompanyRole> = { owner: "owner", admin: "admin", operator: "manager", viewer: "employee" };

/** The Finance service for the live member. Its own permission matrix applies on top of the tool's checks. */
export const fin = (ctx: WorkspaceContext) =>
  new FinanceService({ companyId: ctx.companyId.toHexString(), companyRole: COMPANY_ROLE[ctx.role], userId: ctx.userId.toHexString() });
const uid = (ctx: WorkspaceContext) => ctx.userId.toHexString();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new AppError("VALIDATION_ERROR", result.error.issues[0]?.message ?? "The request is invalid.", toFieldErrors(result.error));
}
/** Turns a money-rule failure into the validation error the person sees. */
function rule<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof MoneyError) throw new AppError("VALIDATION_ERROR", e.message);
    throw e;
  }
}
function same(expected: unknown, actual: unknown, what: string) {
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new AppError("CONFLICT", `${what} changed since you reviewed it. Ask again to see the latest.`);
}
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const q = (s?: string) => norm(s ?? "");
const wants = (term: string, ...hay: (string | undefined)[]) => term === "" || hay.some((h) => norm(h ?? "").includes(term));

// ─── Loaders and fingerprints ─────────────────────────────────────────────────

const invoiceFp = (i: InvoiceDetail) => ({ status: i.status, total: toCents(i.total), paid: toCents(i.amountPaid), balance: toCents(i.balance), customer: i.customerId, currency: i.currency, lines: i.lines.map((l: { description: string; quantity: number; unitPrice: number; taxRate?: number }) => [l.description, l.quantity, toCents(l.unitPrice), l.taxRate ?? 0]) });
const expenseFp = (e: ExpenseRow) => ({ status: e.status, total: toCents(e.total), amount: toCents(e.amount), currency: e.currency, date: e.expenseDate, vendor: e.vendor ?? "" });

async function findExpense(ctx: WorkspaceContext, id: string): Promise<ExpenseRow> {
  const e = (await fin(ctx).listExpenses("all")).find((x) => x.id === id);
  if (!e) throw new AppError("NOT_FOUND", "Expense not found among the latest 200 expenses.");
  return e;
}
async function findPayment(ctx: WorkspaceContext, id: string): Promise<PaymentRow> {
  const p = (await fin(ctx).listPayments()).find((x) => x.id === id);
  if (!p) throw new AppError("NOT_FOUND", "Payment not found among the latest 100 payments.");
  return p;
}

const lineView = (l: { description: string; quantity: number; unitPrice: number; taxRate: number }, currency: string) =>
  `${l.quantity} × ${centsText(toCents(l.unitPrice))}${l.taxRate ? ` (+${l.taxRate}% tax)` : ""} = ${money(lineTotalCents(l), currency)}`;

/** The most rows a proposal shows; the totals always fit after them. */
function capRows(rows: AiDiffRow[], max: number, noun: string): AiDiffRow[] {
  return rows.length <= max ? rows : [...rows.slice(0, max), { label: `${rows.length - max} more ${noun}`, after: "not shown here, all are included" }];
}

// ─── Reads ────────────────────────────────────────────────────────────────────

export const listCustomersTool = defineTool({
  name: "finance_list_customers",
  module: "finance",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "Search or list customers (q matches name, email or tax ID). status: active, inactive or all. Returns ids for later calls.",
  input: z.object({ q: optText(80), status: z.enum(["active", "inactive", "all"]).optional(), page: pageNo }).strict(),
  async run(ctx, args, { access }) {
    const term = q(args.q);
    const rows = (await fin(ctx).listCustomers()).filter((c) => (args.status ?? "all") === "all" || c.status === args.status).filter((c) => wants(term, c.name, c.email, c.taxId));
    return {
      summary: `${rows.length} customer${rows.length === 1 ? "" : "s"}`,
      parts: [customersTable(rows, args.page ?? 1, { ...(args.q ? { q: args.q } : {}), ...(args.status ? { status: args.status } : {}) }, access)],
      data: { total: rows.length, customers: modelRows(rows, (c) => ({ id: c.id, name: c.name, status: c.status })) },
    };
  },
});

export const getCustomerTool = defineTool({
  name: "finance_get_customer",
  module: "finance",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "Show one customer with contact details, the open balance they owe (per currency) and their latest invoices.",
  input: z.object({ customerId: objectIdSchema }).strict(),
  async run(ctx, args, { access }) {
    const svc = fin(ctx);
    const c = await svc.getCustomer(args.customerId);
    const unpaid = (await svc.listUnpaidInvoices()).filter((i) => i.customerId === c.id);
    const byCurrency = new Map<string, number>();
    for (const i of unpaid) byCurrency.set(i.currency, (byCurrency.get(i.currency) ?? 0) + toCents(i.balance));
    const open = [...byCurrency].map(([currency, balanceCents]) => ({ currency, balanceCents }));
    const invoices = (await svc.listInvoices()).filter((i) => i.customerId === c.id);
    return {
      summary: `${c.name} (${c.status})`,
      parts: [customerCard(c, access, open, invoices)],
      data: { id: c.id, name: c.name, status: c.status, openBalance: open.map((o) => money(o.balanceCents, o.currency)), unpaidInvoices: unpaid.length },
    };
  },
});

const invoiceStatus = z.enum(["all", "draft", "posted", "partially_paid", "paid", "voided", "overdue"]);

export const listInvoicesTool = defineTool({
  name: "finance_list_invoices",
  module: "finance",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description:
    "List invoices, newest first (the latest 100 the service returns). status: all, draft, posted, partially_paid, paid, voided, overdue (open and past due). q matches invoice number or customer name. customerId narrows to one customer.",
  input: z.object({ status: invoiceStatus.optional(), q: optText(80), customerId: objectIdSchema.optional(), page: pageNo }).strict(),
  async run(ctx, args) {
    const term = q(args.q);
    const all = await fin(ctx).listInvoices();
    const rows = all
      .filter((i) => !args.customerId || i.customerId === args.customerId)
      .filter((i) => wants(term, i.invoiceNumber, i.customer?.name))
      .filter((i) => !args.status || args.status === "all" || (args.status === "overdue" ? invoiceBadge(i).label === "Overdue" : i.status === args.status));
    const limited = all.length >= 100;
    return {
      summary: `${rows.length} invoice${rows.length === 1 ? "" : "s"}${limited ? " (latest 100 searched)" : ""}`,
      parts: [invoicesTable(rows, args.page ?? 1, { ...(args.q ? { q: args.q } : {}), ...(args.status ? { status: args.status } : {}), ...(args.customerId ? { customerId: args.customerId } : {}) }, null, limited ? "Invoices (latest 100)" : "Invoices")],
      data: { total: rows.length, searchedLatest100: limited, invoices: modelRows(rows, (i) => ({ id: i.id, number: i.invoiceNumber, customer: i.customer?.name, status: i.status, currency: i.currency, total: centsText(toCents(i.total)), balance: centsText(toCents(i.balance)), due: i.dueDate?.slice(0, 10) })) },
    };
  },
});

export const getInvoiceTool = defineTool({
  name: "finance_get_invoice",
  module: "finance",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "Show one invoice with its lines, totals, payments applied and balance.",
  input: z.object({ invoiceId: objectIdSchema }).strict(),
  async run(ctx, args, { access }) {
    const inv = await fin(ctx).getInvoice(args.invoiceId);
    return {
      summary: `${inv.invoiceNumber} (${invoiceBadge(inv).label})`,
      parts: [invoiceCard(inv, access, ctx.permissions.has(PERMISSIONS.FINANCE_INVOICE_POST), ctx.permissions.has(PERMISSIONS.FINANCE_PAYMENT_ALLOCATE))],
      data: { id: inv.id, number: inv.invoiceNumber, status: inv.status, currency: inv.currency, subtotal: centsText(toCents(inv.subtotal)), tax: centsText(toCents(inv.taxTotal)), total: centsText(toCents(inv.total)), paid: centsText(toCents(inv.amountPaid)), balance: centsText(toCents(inv.balance)), customerId: inv.customerId },
    };
  },
});

export const listUnpaidTool = defineTool({
  name: "finance_list_unpaid_invoices",
  module: "finance",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "List posted invoices that still have a balance, oldest due date first. customerId narrows to one customer.",
  input: z.object({ customerId: objectIdSchema.optional(), page: pageNo }).strict(),
  async run(ctx, args) {
    const rows = (await fin(ctx).listUnpaidInvoices()).filter((i) => !args.customerId || i.customerId === args.customerId);
    return {
      summary: `${rows.length} unpaid invoice${rows.length === 1 ? "" : "s"}`,
      parts: [unpaidTable(rows, args.page ?? 1, args.customerId ? { customerId: args.customerId } : {})],
      data: { total: rows.length, invoices: modelRows(rows, (i) => ({ id: i.id, number: i.invoiceNumber, customer: i.customerName, currency: i.currency, balance: centsText(toCents(i.balance)), due: i.dueDate?.slice(0, 10) })) },
    };
  },
});

export const listPaymentsTool = defineTool({
  name: "finance_list_payments",
  module: "finance",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "List payments received, newest first (latest 100). unallocatedOnly shows only payments with an amount not yet applied to invoices.",
  input: z.object({ unallocatedOnly: z.boolean().optional(), page: pageNo }).strict(),
  async run(ctx, args, { access }) {
    const rows = (await fin(ctx).listPayments()).filter((p) => !args.unallocatedOnly || toCents(p.unallocatedAmount) > 0);
    return {
      summary: `${rows.length} payment${rows.length === 1 ? "" : "s"}`,
      parts: [paymentsTable(rows, args.page ?? 1, args.unallocatedOnly ? { unallocatedOnly: true } : {}, access)],
      data: { total: rows.length, payments: modelRows(rows, (p) => ({ id: p.id, date: p.paymentDate?.slice(0, 10), method: p.method, reference: p.reference, currency: p.currency, amount: centsText(toCents(p.amount)), unallocated: centsText(toCents(p.unallocatedAmount)) })) },
    };
  },
});

export const listExpensesTool = defineTool({
  name: "finance_list_expenses",
  module: "finance",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "List expenses, newest first (latest 200). status: all, draft, submitted, approved, rejected, paid. q matches vendor, description or category.",
  input: z.object({ status: z.enum(["all", "draft", "submitted", "approved", "rejected", "paid"]).optional(), q: optText(80), page: pageNo }).strict(),
  async run(ctx, args, { access }) {
    const term = q(args.q);
    const rows = (await fin(ctx).listExpenses(args.status)).filter((e) => wants(term, e.vendor, e.description, e.categoryName));
    return {
      summary: `${rows.length} expense${rows.length === 1 ? "" : "s"}`,
      parts: [expensesTable(rows, args.page ?? 1, { ...(args.q ? { q: args.q } : {}), ...(args.status ? { status: args.status } : {}) }, access)],
      data: { total: rows.length, expenses: modelRows(rows, (e) => ({ id: e.id, date: e.expenseDate?.slice(0, 10), vendor: e.vendor, description: e.description, category: e.categoryName, status: e.status, currency: e.currency, total: centsText(toCents(e.total)) })) },
    };
  },
});

export const listProductsTool = defineTool({
  name: "finance_list_products",
  module: "finance",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "Search the products that can go on an invoice (q matches name or SKU). Returns productId and the product's own sale price (null when it has none or cannot be billed in cents), for finance_create_invoice lines.",
  input: z.object({ q: optText(80) }).strict(),
  async run(ctx, args) {
    const term = q(args.q);
    const rows = (await fin(ctx).listInvoiceableProducts()).filter((p) => wants(term, p.name, p.sku)).slice(0, 25);
    const price = (n: number) => (n > 0 && Math.round(n * 1000) % 10 === 0 ? centsText(toCents(n)) : null);
    return { summary: `${rows.length} product${rows.length === 1 ? "" : "s"}`, data: { products: modelRows(rows, (p) => ({ productId: p.id, sku: p.sku, name: p.name, salePrice: price(p.unitPrice) })) } };
  },
});

export const listCategoriesTool = defineTool({
  name: "finance_list_expense_categories",
  module: "finance",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "List expense categories with ids, for creating or categorizing an expense.",
  input: z.object({}).strict(),
  async run(ctx) {
    const cats = await fin(ctx).listExpenseCategories();
    return { summary: `${cats.length} categories`, data: { categories: modelRows(cats, (c) => ({ id: c.id, name: c.name, active: c.active }), 50) } };
  },
});

export const summaryTool = defineTool({
  name: "finance_get_summary",
  module: "finance",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "Finance summary: invoiced, collected, outstanding, overdue, expense counts and a 6-month cash timeline for ONE currency (default: the company currency), exactly as the Finance dashboard calculates them. Never recompute or add figures across currencies.",
  input: z.object({ currency: z.enum(CURRENCIES).optional() }).strict(),
  async run(ctx, input) {
    const svc = fin(ctx);
    const [d, currencies] = await Promise.all([svc.getDashboard(input.currency), svc.listActiveCurrencies()]);
    const notes: string[] = [];
    // Figures are for one currency only; say when other currencies have activity too.
    const others = currencies.filter((c) => c !== d.currency);
    if (others.length) notes.push(`These figures are in ${d.currency} only. There is also activity in ${others.join(", ")}; ask for the summary in that currency.`);
    return {
      summary: "Finance summary",
      parts: [summaryCard(d, notes)],
      data: {
        currency: d.currency,
        invoiced: centsText(toCents(d.totalInvoiced)),
        collected: centsText(toCents(d.totalPaid)),
        outstanding: centsText(toCents(d.outstanding)),
        overdue: centsText(toCents(d.overdue)),
        overdueInvoices: d.overdueCount,
        expensesPaid: centsText(toCents(d.totalExpensesPaidAmount)),
        netCashFlow: centsText(toCents(d.netCashFlow)),
        caveats: notes,
      },
    };
  },
});

// ─── Writes: customers ────────────────────────────────────────────────────────

const customerFields = { name: z.string().max(120), email: optText(160), phone: optText(40), taxId: optText(60), address: optText(300), notes: optText(1000) };

export const createCustomerTool = defineTool({
  name: "finance_create_customer",
  module: "finance",
  operation: "create",
  kind: "write",
  risk: "low",
  permission: PERMISSIONS.FINANCE_CUSTOMER_MANAGE,
  description: "Propose a new customer. name is required; email, phone, taxId, address and notes are optional and must come from the person, never guessed.",
  input: z.object(customerFields).strict(),
  async prepare(ctx, args) {
    const input = parse(customerCreateSchema, args);
    const dup = (await fin(ctx).listCustomers()).find((c) => norm(c.name) === norm(input.name));
    if (dup) throw new AppError("CONFLICT", `A customer named "${dup.name}" already exists.`);
    const rows: AiDiffRow[] = [{ label: "Name", after: input.name }];
    for (const [label, v] of [["Email", input.email], ["Phone", input.phone], ["Tax ID", input.taxId], ["Address", input.address], ["Notes", input.notes]] as const) if (v) rows.push({ label, after: v });
    return { context: { input }, summary: `Create customer "${input.name}".`, details: rows };
  },
  async run(ctx, _args, _env, context) {
    const input = context.input as z.infer<typeof customerCreateSchema>;
    const dup = (await fin(ctx).listCustomers()).find((c) => norm(c.name) === norm(input.name));
    if (dup) throw new AppError("CONFLICT", `A customer named "${dup.name}" already exists.`);
    const id = await fin(ctx).createCustomer(input, uid(ctx));
    return { summary: `Created customer ${input.name}.`, data: { id } };
  },
});

export const updateCustomerTool = defineTool({
  name: "finance_update_customer",
  module: "finance",
  operation: "edit",
  kind: "write",
  risk: "low",
  permission: PERMISSIONS.FINANCE_CUSTOMER_MANAGE,
  description: "Propose changes to a customer. Send customerId and only the fields that change. status active/inactive deactivates or reactivates (an inactive customer cannot get new invoices). An empty string clears a field.",
  input: z.object({ customerId: objectIdSchema, ...customerFields, name: optText(120), status: z.enum(["active", "inactive"]).optional() }).strict(),
  async prepare(ctx, args) {
    const svc = fin(ctx);
    const cur = await svc.getCustomer(args.customerId);
    const next: Record<string, string> = {};
    const rows: AiDiffRow[] = [];
    const fields = [["name", "Name"], ["email", "Email"], ["phone", "Phone"], ["taxId", "Tax ID"], ["address", "Address"], ["notes", "Notes"], ["status", "Status"]] as const;
    for (const [key, label] of fields) {
      const want = args[key as keyof typeof args] as string | undefined;
      if (want === undefined) continue;
      const before = ((cur as Record<string, unknown>)[key] as string | undefined) ?? "";
      if (want.trim() === before) continue;
      next[key] = want;
      rows.push({ label, before: before || "none", after: want.trim() || "none" });
    }
    if (rows.length === 0) throw new AppError("VALIDATION_ERROR", "That would not change anything.");
    const input = parse(customerUpdateSchema, next);
    if (input.name !== undefined && norm(input.name) !== norm(cur.name)) {
      const dup = (await svc.listCustomers()).find((c) => c.id !== cur.id && norm(c.name) === norm(input.name as string));
      if (dup) throw new AppError("CONFLICT", `A customer named "${dup.name}" already exists.`);
    }
    return { context: { input, fp: cur.updatedAt, name: cur.name }, summary: `Update customer "${cur.name}".`, details: rows };
  },
  async run(ctx, args, _env, context) {
    const svc = fin(ctx);
    same(context.fp, (await svc.getCustomer(args.customerId)).updatedAt, `Customer ${String(context.name)}`);
    await svc.updateCustomer(args.customerId, context.input as Parameters<FinanceService["updateCustomer"]>[1], uid(ctx));
    return { summary: `Updated customer ${String(context.name)}.` };
  },
});

// ─── Writes: invoices ─────────────────────────────────────────────────────────

const invoiceLine = z.object({ productId: objectIdSchema.optional(), description: optText(200), quantity: amount, unitPrice: amount.optional(), taxRate: amount.optional() }).strict();
type InvoiceLineArg = z.infer<typeof invoiceLine>;
type InvoiceDraftArgs = { customerId: string; currency?: string; issueDate?: string; dueDate?: string; notes?: string; terms?: string; lines: InvoiceLineArg[] };

/** Resolves a draft invoice from the person's values and the company's own records. Missing prices are asked about, never filled in. */
async function resolveInvoice(ctx: WorkspaceContext, raw: InvoiceDraftArgs) {
  const svc = fin(ctx);
  const customer = await svc.getCustomer(raw.customerId);
  if (customer.status !== "active") throw new AppError("VALIDATION_ERROR", `${customer.name} is inactive. Reactivate the customer first.`);
  const company = CURRENCIES.find((c) => c === ctx.currencyCode);
  const currency = raw.currency ?? company;
  if (!currency || !(CURRENCIES as readonly string[]).includes(currency)) throw new AppError("VALIDATION_ERROR", "Choose a currency: TND, USD, EUR or GBP.");
  const issueDate = raw.issueDate ? rule(() => parseDate(raw.issueDate, "Issue date")) : todayTunis();
  const dueDate = raw.dueDate ? rule(() => parseDate(raw.dueDate, "Due date")) : "";
  if (dueDate && dueDate < issueDate) throw new AppError("VALIDATION_ERROR", "The due date is before the issue date.");
  const products = raw.lines.some((l) => l.productId) ? await svc.listInvoiceableProducts() : [];
  const lines = raw.lines.map((l, n) => {
    const product = l.productId ? products.find((p) => p.id === l.productId) : undefined;
    if (l.productId && !product) throw new AppError("NOT_FOUND", `Line ${n + 1}: that product is not an active product of this company.`);
    const description = (l.description?.trim() || product?.description || product?.name || "").trim();
    if (!description) throw new AppError("VALIDATION_ERROR", `Line ${n + 1} needs a description.`);
    let priceCents: number;
    if (l.unitPrice !== undefined) priceCents = rule(() => parseAmountCents(l.unitPrice, `Line ${n + 1} unit price`));
    else if (product && product.unitPrice > 0 && Math.round(product.unitPrice * 1000) % 10 === 0) priceCents = toCents(product.unitPrice);
    else throw new AppError("VALIDATION_ERROR", `Line ${n + 1} (${description}) needs a unit price.`);
    return {
      productId: l.productId ?? "",
      description,
      quantity: rule(() => parseQuantityInt(l.quantity)),
      unitPrice: fromCents(priceCents),
      taxRate: rule(() => parseRate(l.taxRate ?? "0", `Line ${n + 1} tax rate`)),
    };
  });
  const input = parse(invoiceCreateDraftSchema, { customerId: raw.customerId, currency, issueDate, dueDate, notes: raw.notes ?? "", terms: raw.terms ?? "", lines });
  const totals = invoiceTotalsCents(input.lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, taxRate: l.taxRate ?? 0 })));
  return { input, customerName: customer.name, currency, totals };
}

export const createInvoiceTool = defineTool({
  name: "finance_create_invoice",
  module: "finance",
  operation: "create",
  kind: "write",
  risk: "sensitive",
  permission: PERMISSIONS.FINANCE_INVOICE_MANAGE,
  description:
    "Propose a new DRAFT invoice (not yet official; posting is a separate step). customerId and lines are required. Each line needs quantity (whole number) and either a productId (its sale price is used if unitPrice is omitted and the product has one) or a description with unitPrice. Never guess prices or tax: taxRate defaults to 0 only when the person gave none. Dates are YYYY-MM-DD; issueDate defaults to today. Totals are computed by the system.",
  input: z.object({ customerId: objectIdSchema, currency: z.enum(CURRENCIES).optional(), issueDate: optText(10), dueDate: optText(10), notes: optText(1000), terms: optText(1000), lines: z.array(invoiceLine).min(1).max(100) }).strict(),
  async prepare(ctx, args) {
    const { input, customerName, currency, totals } = await resolveInvoice(ctx, args);
    const lineRows: AiDiffRow[] = input.lines.map((l) => ({ label: l.description, after: lineView({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, taxRate: l.taxRate ?? 0 }, currency) }));
    return {
      context: { input, total: totals.total },
      summary: `Create a draft invoice for ${customerName}, total ${money(totals.total, currency)}. It is not official until posted.`,
      details: [
        { label: "Customer", after: customerName },
        { label: "Currency", after: currency },
        { label: "Issued", after: input.issueDate },
        { label: "Due", after: input.dueDate || "none" },
        ...capRows(lineRows, 11, "lines"),
        { label: "Subtotal", after: money(totals.subtotal, currency) },
        { label: "Tax", after: money(totals.tax, currency) },
        { label: "Total", after: money(totals.total, currency) },
      ],
    };
  },
  async run(ctx, _args, { access }, context) {
    const svc = fin(ctx);
    const input = context.input as z.infer<typeof invoiceCreateDraftSchema>;
    const customer = await svc.getCustomer(input.customerId);
    if (customer.status !== "active") throw new AppError("CONFLICT", `${customer.name} is no longer active.`);
    const id = await svc.createInvoiceDraft(input, uid(ctx));
    const inv = await svc.getInvoice(id);
    const stored = toCents(inv.total);
    const note = stored === Number(context.total) ? "" : ` Warning: the stored total is ${money(stored, inv.currency)}, not the ${money(Number(context.total), inv.currency)} shown; check the invoice.`;
    return { summary: `Created draft invoice ${inv.invoiceNumber}, total ${moneyOf(inv.total, inv.currency)}.${note}`, parts: [invoiceCard(inv, access, ctx.permissions.has(PERMISSIONS.FINANCE_INVOICE_POST), ctx.permissions.has(PERMISSIONS.FINANCE_PAYMENT_ALLOCATE))], data: { id } };
  },
});

export const postInvoiceTool = defineTool({
  name: "finance_post_invoice",
  module: "finance",
  operation: "approve",
  kind: "write",
  risk: "financial",
  permission: PERMISSIONS.FINANCE_INVOICE_POST,
  description: "Propose POSTING a DRAFT invoice, which makes it official and collectable. A posted invoice can no longer be edited, only voided. Needs the invoice number typed to confirm.",
  input: z.object({ invoiceId: objectIdSchema }).strict(),
  async prepare(ctx, args) {
    const inv = await fin(ctx).getInvoice(args.invoiceId);
    if (inv.status !== "draft") throw new AppError("INVALID_TRANSITION", `${inv.invoiceNumber} is ${inv.status}. Only draft invoices can be posted.`);
    if (toCents(inv.total) <= 0) throw new AppError("VALIDATION_ERROR", `${inv.invoiceNumber} has a zero total, so there is nothing to post.`);
    const c = inv.currency as string;
    return {
      context: { fp: invoiceFp(inv), number: inv.invoiceNumber },
      summary: `Post ${inv.invoiceNumber} to ${inv.customer?.name ?? "a direct customer"}, total ${moneyOf(inv.total, c)}. It becomes official and can then only be voided.`,
      details: [
        { label: "Invoice", after: inv.invoiceNumber },
        { label: "Customer", after: inv.customer?.name ?? "Direct customer" },
        { label: "Issued", after: inv.issueDate?.slice(0, 10) ?? "none" },
        { label: "Due", after: inv.dueDate?.slice(0, 10) ?? "none" },
        { label: "Subtotal", after: moneyOf(inv.subtotal, c) },
        { label: "Tax", after: moneyOf(inv.taxTotal, c) },
        { label: "Total", after: moneyOf(inv.total, c) },
      ],
      typedPhrase: inv.invoiceNumber,
    };
  },
  async run(ctx, args, { access }, context) {
    const svc = fin(ctx);
    same(context.fp, invoiceFp(await svc.getInvoice(args.invoiceId)), `Invoice ${String(context.number)}`);
    await svc.postInvoice(args.invoiceId, uid(ctx));
    const inv = await svc.getInvoice(args.invoiceId);
    return { summary: `Posted ${String(context.number)}.`, parts: [invoiceCard(inv, access, ctx.permissions.has(PERMISSIONS.FINANCE_INVOICE_POST), ctx.permissions.has(PERMISSIONS.FINANCE_PAYMENT_ALLOCATE))] };
  },
});

export const voidInvoiceTool = defineTool({
  name: "finance_void_invoice",
  module: "finance",
  operation: "delete",
  kind: "write",
  risk: "destructive",
  permission: PERMISSIONS.FINANCE_INVOICE_POST,
  description: "Propose VOIDING an invoice that has no payments applied. reason (at least 3 characters) must come from the person. Voiding cannot be undone. Needs the invoice number typed to confirm.",
  input: z.object({ invoiceId: objectIdSchema, reason: z.string().min(3).max(300) }).strict(),
  async prepare(ctx, args) {
    const inv = await fin(ctx).getInvoice(args.invoiceId);
    const { reason } = parse(invoiceVoidSchema, { invoiceId: args.invoiceId, reason: args.reason });
    if (!["draft", "posted", "partially_paid"].includes(inv.status)) throw new AppError("INVALID_TRANSITION", `${inv.invoiceNumber} is ${inv.status} and cannot be voided.`);
    if (toCents(inv.amountPaid) > 0) throw new AppError("INVALID_TRANSITION", `${inv.invoiceNumber} has ${moneyOf(inv.amountPaid, inv.currency as string)} of payments applied. Voiding does not reverse payments, so resolve them in Finance first.`);
    const c = inv.currency as string;
    return {
      context: { fp: invoiceFp(inv), number: inv.invoiceNumber, reason },
      summary: `Void ${inv.invoiceNumber} (${inv.customer?.name ?? "direct customer"}, ${moneyOf(inv.total, c)}). This cannot be undone.`,
      details: [{ label: "Invoice", after: `${inv.invoiceNumber} · ${inv.status}` }, { label: "Total", after: moneyOf(inv.total, c) }, { label: "Reason", after: reason }],
      typedPhrase: inv.invoiceNumber,
    };
  },
  async run(ctx, args, _env, context) {
    const svc = fin(ctx);
    same(context.fp, invoiceFp(await svc.getInvoice(args.invoiceId)), `Invoice ${String(context.number)}`);
    await svc.voidInvoice(args.invoiceId, String(context.reason), uid(ctx));
    return { summary: `Voided ${String(context.number)}.` };
  },
});

// ─── Writes: payments ─────────────────────────────────────────────────────────

export const recordPaymentTool = defineTool({
  name: "finance_record_payment",
  module: "finance",
  operation: "create",
  kind: "write",
  risk: "financial",
  permission: PERMISSIONS.FINANCE_PAYMENT_ALLOCATE,
  description:
    "Propose RECORDING a payment already received from a customer. This only writes it down; it moves no money. amount, currency (defaults to the company currency) and method are required and must come from the person; reference is optional and must be the real bank or cheque reference, never invented. paymentDate YYYY-MM-DD defaults to today. The payment starts unallocated; applying it to invoices is a separate step. Needs the amount typed to confirm.",
  input: z.object({ paymentDate: optText(10), amount, currency: z.enum(CURRENCIES).optional(), method: z.enum(METHODS), reference: optText(80), notes: optText(500) }).strict(),
  async prepare(ctx, args) {
    const cents = rule(() => parsePositiveCents(args.amount));
    const currency = args.currency ?? (CURRENCIES as readonly string[]).find((c) => c === ctx.currencyCode);
    if (!currency) throw new AppError("VALIDATION_ERROR", "Choose a currency: TND, USD, EUR or GBP.");
    const today = todayTunis();
    const date = args.paymentDate ? rule(() => parseDate(args.paymentDate, "Payment date")) : today;
    if (date > today) throw new AppError("VALIDATION_ERROR", "A payment received cannot be dated in the future.");
    const input = parse(paymentRecordSchema, { paymentDate: date, amount: fromCents(cents), currency, method: args.method, reference: args.reference ?? "", notes: args.notes ?? "" });
    const recent = await fin(ctx).listPayments();
    const ref = norm(input.reference ?? "");
    if (ref && recent.some((p) => norm(p.reference ?? "") === ref)) throw new AppError("CONFLICT", `A payment with reference "${input.reference}" is already recorded.`);
    const twin = recent.find((p) => toCents(p.amount) === cents && p.currency === currency && p.method === input.method && p.paymentDate?.slice(0, 10) === date);
    return {
      context: { input, cents },
      summary: `Record a payment of ${money(cents, currency)} received by ${METHOD_LABEL[input.method]} on ${date}. This only records it; no money moves.`,
      details: [
        { label: "Amount", after: money(cents, currency) },
        { label: "Method", after: METHOD_LABEL[input.method] },
        { label: "Date", after: date },
        { label: "Reference", after: input.reference || "none" },
        ...(input.notes ? [{ label: "Notes", after: input.notes }] : []),
        ...(twin ? [{ label: "Possible duplicate", after: "A payment with the same amount, method and date is already recorded" }] : []),
      ],
      typedPhrase: money(cents, currency),
    };
  },
  async run(ctx, _args, _env, context) {
    const input = context.input as z.infer<typeof paymentRecordSchema>;
    const ref = norm(input.reference ?? "");
    if (ref && (await fin(ctx).listPayments()).some((p) => norm(p.reference ?? "") === ref)) throw new AppError("CONFLICT", `A payment with reference "${input.reference}" is already recorded.`);
    const id = await fin(ctx).recordPayment(input, uid(ctx));
    const p = await findPayment(ctx, id);
    return {
      summary: `Recorded a payment of ${moneyOf(p.amount, p.currency)}. It is not applied to any invoice yet.`,
      parts: [
        {
          type: "record_card" as const,
          title: `Payment ${moneyOf(p.amount, p.currency)}`,
          subtitle: `${METHOD_LABEL[p.method] ?? p.method} · ${p.paymentDate?.slice(0, 10)}`,
          badges: [{ label: "To allocate", tone: "warning" as const }],
          fields: [{ label: "Reference", value: p.reference || "None" }, { label: "Unallocated", value: moneyOf(p.unallocatedAmount, p.currency) }],
          actions: [{ label: "Apply to invoices", command: "allocate", args: { paymentId: p.id }, step: "select" as const }],
        },
      ],
      data: { id },
    };
  },
});

type Alloc = { invoiceId: string; amount: string };

/** Validates an allocation against live records and returns the exact before/after the person will confirm. */
async function resolveAllocation(ctx: WorkspaceContext, paymentId: string, allocations: Alloc[]) {
  const svc = fin(ctx);
  const payment = await findPayment(ctx, paymentId);
  const ids = allocations.map((a) => a.invoiceId);
  if (new Set(ids).size !== ids.length) throw new AppError("VALIDATION_ERROR", "Each invoice can appear only once.");
  const parsedAllocs = allocations.map((a) => ({ invoiceId: a.invoiceId, cents: rule(() => parsePositiveCents(a.amount, "Allocation amount")) }));
  const total = parsedAllocs.reduce((s, a) => s + a.cents, 0);
  const free = toCents(payment.unallocatedAmount);
  if (total > free) throw new AppError("VALIDATION_ERROR", `Only ${money(free, payment.currency)} of this payment is unallocated, but ${money(total, payment.currency)} was requested.`);
  const items = [];
  for (const a of parsedAllocs) {
    const inv = await svc.getInvoice(a.invoiceId);
    if (inv.status !== "posted" && inv.status !== "partially_paid") throw new AppError("INVALID_TRANSITION", `${inv.invoiceNumber} is ${inv.status}. Payments can only be applied to posted invoices.`);
    if (inv.currency !== payment.currency) throw new AppError("VALIDATION_ERROR", `${inv.invoiceNumber} is in ${inv.currency} but the payment is in ${payment.currency}. Currencies are never converted.`);
    const balance = toCents(inv.balance);
    if (a.cents > balance) throw new AppError("VALIDATION_ERROR", `${money(a.cents, inv.currency as string)} is more than the ${money(balance, inv.currency as string)} still owed on ${inv.invoiceNumber}.`);
    items.push({ inv, cents: a.cents, balance, after: balance - a.cents });
  }
  return { payment, total, free, items };
}

export const allocatePaymentTool = defineTool({
  name: "finance_allocate_payment",
  module: "finance",
  operation: "edit",
  kind: "write",
  risk: "financial",
  permission: PERMISSIONS.FINANCE_PAYMENT_ALLOCATE,
  description:
    "Propose APPLYING part or all of an unallocated payment to posted invoices (reconciliation). allocations: each invoiceId with the amount to apply. The payment and invoice must share a currency, an invoice cannot receive more than its balance, and the total cannot exceed the payment's unallocated amount. This cannot be undone. Needs the total typed to confirm.",
  input: z.object({ paymentId: objectIdSchema, allocations: z.array(z.object({ invoiceId: objectIdSchema, amount }).strict()).min(1).max(20) }).strict(),
  async prepare(ctx, args) {
    parse(paymentAllocateSchema, { paymentId: args.paymentId, allocations: args.allocations.map((a) => ({ invoiceId: a.invoiceId, amount: 1 })) });
    const r = await resolveAllocation(ctx, args.paymentId, args.allocations);
    const cur = r.payment.currency;
    return {
      context: { pay: toCents(r.payment.unallocatedAmount), invs: r.items.map((i) => [i.inv.id, i.balance, i.inv.status]), total: r.total },
      summary: `Apply ${money(r.total, cur)} of a ${moneyOf(r.payment.amount, cur)} payment to ${r.items.length} invoice${r.items.length === 1 ? "" : "s"}. This cannot be undone.`,
      details: [
        { label: "Payment", after: `${moneyOf(r.payment.amount, cur)} · ${METHOD_LABEL[r.payment.method] ?? r.payment.method} · ${r.payment.reference || "no reference"}` },
        { label: "Unallocated", before: money(r.free, cur), after: money(r.free - r.total, cur) },
        ...r.items.map((i) => ({ label: `${i.inv.invoiceNumber} · ${i.inv.customer?.name ?? "direct customer"}`, before: `owes ${money(i.balance, cur)}`, after: `applies ${money(i.cents, cur)}, then ${i.after === 0 ? "paid in full" : `owes ${money(i.after, cur)}`}` })),
      ],
      typedPhrase: money(r.total, cur),
    };
  },
  async run(ctx, args, { access }, context) {
    const svc = fin(ctx);
    // A record that moved since the proposal is a conflict, whatever else is now wrong with the request.
    const live = { pay: toCents((await findPayment(ctx, args.paymentId)).unallocatedAmount), invs: [] as unknown[] };
    for (const a of args.allocations) {
      const now = await svc.getInvoice(a.invoiceId);
      live.invs.push([now.id, toCents(now.balance), now.status]);
    }
    same({ pay: context.pay, invs: context.invs }, live, "The payment or one of the invoices");
    const r = await resolveAllocation(ctx, args.paymentId, args.allocations);
    await svc.allocatePayment(args.paymentId, r.items.map((i) => ({ invoiceId: i.inv.id, amount: fromCents(i.cents) })), uid(ctx));
    const rows: { label: string; value: string }[] = [];
    let drift = false;
    for (const i of r.items) {
      const now = await svc.getInvoice(i.inv.id);
      if (toCents(now.balance) !== i.after || Math.abs(now.balance - i.after / 100) > 1e-9) drift = true;
      rows.push({ label: now.invoiceNumber, value: `${invoiceBadge(now).label} · balance ${moneyOf(now.balance, now.currency as string)}` });
    }
    const cur = r.payment.currency;
    return {
      summary: `Applied ${money(r.total, cur)} to ${r.items.length} invoice${r.items.length === 1 ? "" : "s"}.${drift ? " Warning: an invoice balance does not match the expected amount to the cent; check it in Finance." : ""}`,
      parts: [{ type: "record_card" as const, title: `Applied ${money(r.total, cur)}`, subtitle: "Invoices after this payment", fields: [], sections: [{ title: "Invoices", rows }], actions: access.can("finance", "view") ? [{ label: "Unpaid invoices", command: "unpaid", args: {} }] : [] }],
    };
  },
});

// ─── Writes: expenses ─────────────────────────────────────────────────────────

export const createExpenseTool = defineTool({
  name: "finance_create_expense",
  module: "finance",
  operation: "create",
  kind: "write",
  risk: "sensitive",
  permission: PERMISSIONS.FINANCE_EXPENSE_MANAGE,
  description:
    "Propose a new DRAFT expense. expenseDate (YYYY-MM-DD, not in the future), description and amount are required and must come from the person. tax is a money amount (not a percent) and defaults to 0 only when none was given. categoryId (from finance_list_expense_categories) and vendor are optional. The total is computed by the system. The expense still has to be submitted and approved.",
  input: z.object({ expenseDate: z.string().max(10), categoryId: objectIdSchema.optional(), vendor: optText(120), description: z.string().max(200), amount, tax: amount.optional(), currency: z.enum(CURRENCIES).optional(), notes: optText(500) }).strict(),
  async prepare(ctx, args) {
    const svc = fin(ctx);
    const date = rule(() => parseDate(args.expenseDate, "Expense date"));
    if (date > todayTunis()) throw new AppError("VALIDATION_ERROR", "An expense cannot be dated in the future.");
    const amountCents = rule(() => parsePositiveCents(args.amount));
    const taxCents = args.tax === undefined ? 0 : rule(() => parseAmountCents(args.tax, "Tax"));
    const currency = args.currency ?? (CURRENCIES as readonly string[]).find((c) => c === ctx.currencyCode);
    if (!currency) throw new AppError("VALIDATION_ERROR", "Choose a currency: TND, USD, EUR or GBP.");
    let categoryName = "none";
    if (args.categoryId) {
      const cat = (await svc.listExpenseCategories()).find((c) => c.id === args.categoryId);
      if (!cat || !cat.active) throw new AppError("NOT_FOUND", "That expense category does not exist or is inactive.");
      categoryName = cat.name;
    }
    const input = parse(expenseCreateSchema, { expenseDate: date, categoryId: args.categoryId ?? "", vendor: args.vendor ?? "", description: args.description.trim(), amount: fromCents(amountCents), tax: fromCents(taxCents), currency, notes: args.notes ?? "" });
    const total = amountCents + taxCents;
    const twin = input.vendor ? (await svc.listExpenses("all")).find((e) => e.expenseDate?.slice(0, 10) === date && norm(e.vendor ?? "") === norm(input.vendor as string) && toCents(e.total) === total && e.currency === currency) : undefined;
    return {
      context: { input, total },
      summary: `Create a draft expense of ${money(total, currency)}${input.vendor ? ` from ${input.vendor}` : ""} dated ${date}. It still has to be submitted and approved.`,
      details: [
        { label: "Date", after: date },
        { label: "Description", after: input.description },
        { label: "Vendor", after: input.vendor || "none" },
        { label: "Category", after: categoryName },
        { label: "Amount", after: money(amountCents, currency) },
        { label: "Tax", after: money(taxCents, currency) },
        { label: "Total", after: money(total, currency) },
        ...(input.notes ? [{ label: "Notes", after: input.notes }] : []),
        ...(twin ? [{ label: "Possible duplicate", after: "An expense with the same date, vendor and total already exists" }] : []),
      ],
    };
  },
  async run(ctx, _args, _env, context) {
    const svc = fin(ctx);
    const input = context.input as z.infer<typeof expenseCreateSchema>;
    const id = await svc.createExpense(input, uid(ctx));
    const e = await findExpense(ctx, id);
    const stored = toCents(e.total);
    const note = stored === Number(context.total) ? "" : ` Warning: the stored total is ${money(stored, e.currency)}, not the ${money(Number(context.total), e.currency)} shown; check the expense.`;
    return {
      summary: `Created draft expense ${moneyOf(e.total, e.currency)}.${note}`,
      parts: [
        {
          type: "record_card" as const,
          title: e.description,
          subtitle: e.vendor || undefined,
          badges: [{ label: "Draft", tone: "neutral" as const }],
          fields: [{ label: "Date", value: e.expenseDate?.slice(0, 10) ?? "" }, { label: "Category", value: e.categoryName || "Uncategorized" }, { label: "Total", value: moneyOf(e.total, e.currency) }],
          actions: [{ label: "Submit for approval", command: "submitexpense", args: { expenseId: e.id }, step: "select" as const }],
        },
      ],
      data: { id },
    };
  },
});

function expenseTool(opts: {
  name: string;
  operation: AiToolDefinition["operation"];
  risk: AiToolDefinition["risk"];
  permission: AiToolDefinition["permission"];
  description: string;
  from: string;
  verb: string;
  extra?: boolean;
  call: (svc: FinanceService, id: string, reason: string, user: string) => Promise<unknown>;
}) {
  return defineTool({
    name: opts.name,
    module: "finance",
    operation: opts.operation,
    kind: "write",
    risk: opts.risk,
    permission: opts.permission,
    description: opts.description,
    input: opts.extra ? z.object({ expenseId: objectIdSchema, reason: z.string().min(3).max(300) }).strict() : z.object({ expenseId: objectIdSchema }).strict(),
    async prepare(ctx, args: { expenseId: string; reason?: string }) {
      const e = await findExpense(ctx, args.expenseId);
      if (e.status !== opts.from) throw new AppError("INVALID_TRANSITION", `This expense is ${e.status}. Only ${opts.from} expenses can be ${opts.verb}.`);
      if (opts.name === "finance_approve_expense" && fin(ctx).isSelfApproval(e, uid(ctx))) throw new AppError("FORBIDDEN", "You cannot approve an expense you created or submitted. Ask another approver.");
      const reason = opts.extra ? parse(expenseRejectSchema, { expenseId: args.expenseId, reason: args.reason }).reason : "";
      const label = `${e.vendor || e.description} (${moneyOf(e.total, e.currency)})`;
      const typed = opts.risk === "financial" || opts.risk === "destructive" ? money(toCents(e.total), e.currency) : undefined;
      return {
        context: { fp: expenseFp(e), label, reason },
        summary: `${opts.verb[0].toUpperCase()}${opts.verb.slice(1)} the expense ${label} dated ${e.expenseDate?.slice(0, 10)}.`,
        details: [
          { label: "Date", after: e.expenseDate?.slice(0, 10) ?? "none" },
          { label: "Description", after: e.description },
          { label: "Vendor", after: e.vendor || "none" },
          { label: "Category", after: e.categoryName || "none" },
          { label: "Total", after: moneyOf(e.total, e.currency) },
          { label: "Status", before: e.status, after: opts.verb === "submitted" ? "submitted" : opts.verb },
          ...(reason ? [{ label: "Reason", after: reason }] : []),
        ],
        typedPhrase: typed,
      };
    },
    async run(ctx, args: { expenseId: string }, _env, context) {
      const svc = fin(ctx);
      same(context.fp, expenseFp(await findExpense(ctx, args.expenseId)), `The expense ${String(context.label)}`);
      await opts.call(svc, args.expenseId, String(context.reason), uid(ctx));
      return { summary: `${opts.verb[0].toUpperCase()}${opts.verb.slice(1)} ${String(context.label)}.` };
    },
  });
}

export const submitExpenseTool = expenseTool({
  name: "finance_submit_expense",
  operation: "edit",
  risk: "sensitive",
  permission: PERMISSIONS.FINANCE_EXPENSE_MANAGE,
  description: "Propose submitting a DRAFT expense for approval.",
  from: "draft",
  verb: "submitted",
  call: (svc, id, _r, user) => svc.submitExpense(id, user),
});
export const approveExpenseTool = expenseTool({
  name: "finance_approve_expense",
  operation: "approve",
  risk: "financial",
  permission: PERMISSIONS.FINANCE_EXPENSE_APPROVE,
  description: "Propose APPROVING a SUBMITTED expense. Approved expenses count as spending. Needs the total typed to confirm.",
  from: "submitted",
  verb: "approved",
  call: (svc, id, _r, user) => svc.approveExpense(id, user),
});
export const rejectExpenseTool = expenseTool({
  name: "finance_reject_expense",
  operation: "approve",
  risk: "destructive",
  permission: PERMISSIONS.FINANCE_EXPENSE_APPROVE,
  description: "Propose REJECTING a SUBMITTED expense. reason (at least 3 characters) must come from the person. A rejected expense cannot be resubmitted. Needs the total typed to confirm.",
  from: "submitted",
  verb: "rejected",
  extra: true,
  call: (svc, id, reason, user) => svc.rejectExpense(id, reason, user),
});

export const createCategoryTool = defineTool({
  name: "finance_create_expense_category",
  module: "finance",
  operation: "create",
  kind: "write",
  risk: "low",
  permission: PERMISSIONS.FINANCE_EXPENSE_MANAGE,
  description: "Propose a new expense category (for example 'Training'). name is required.",
  input: z.object({ name: z.string().max(80) }).strict(),
  async prepare(ctx, args) {
    const input = parse(expenseCategorySchema, { name: args.name, active: true });
    const dup = (await fin(ctx).listExpenseCategories()).find((c) => norm(c.name) === norm(input.name));
    if (dup) throw new AppError("CONFLICT", `The category "${dup.name}" already exists.`);
    return { context: { name: input.name }, summary: `Create the expense category "${input.name}".`, details: [{ label: "Name", after: input.name }] };
  },
  async run(ctx, _args, _env, context) {
    const name = String(context.name);
    if ((await fin(ctx).listExpenseCategories()).some((c) => norm(c.name) === norm(name))) throw new AppError("CONFLICT", `The category "${name}" already exists.`);
    await fin(ctx).createExpenseCategory(name);
    return { summary: `Created the category ${name}.` };
  },
});

export const FINANCE_TOOLS = [
  listCustomersTool,
  getCustomerTool,
  listInvoicesTool,
  getInvoiceTool,
  listUnpaidTool,
  listPaymentsTool,
  listExpensesTool,
  listProductsTool,
  listCategoriesTool,
  summaryTool,
  createCustomerTool,
  updateCustomerTool,
  createInvoiceTool,
  postInvoiceTool,
  voidInvoiceTool,
  recordPaymentTool,
  allocatePaymentTool,
  createExpenseTool,
  submitExpenseTool,
  approveExpenseTool,
  rejectExpenseTool,
  createCategoryTool,
];
