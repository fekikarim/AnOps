import "server-only";
import { callTool, field, form, nonEmpty, proposeTool } from "@/server/ai/commands/helpers";
import { ARGS, need, noText, pickCommand, requireCell, searchText } from "@/server/ai/commands/shared";
import type { CommandArgs, CommandDefinition, CommandEnv, DraftCandidate, DraftCurrent } from "@/server/ai/commands/types";
import { withAssist } from "@/server/ai/draft/assist";
import { parseRows, serializeRows, type LineRow } from "@/server/ai/draft/draft-lines";
import { CURRENCIES, centsText, money, moneyOf, toCents, todayTunis } from "@/server/ai/finance/money";
import { fin } from "@/server/ai/tools/finance.tools";
import type { AiFormField, AiProvenance } from "@/server/db/documents";
import { PERMISSIONS } from "@/server/security/permissions";
import { AppError } from "@/shared/lib/errors";

/**
 * Finance commands. Reads reuse the read tools; writes build a form (manual or AI-drafted from the SAME
 * field builders) and hand the values to the write tool, which previews the exact amounts for confirmation.
 * Workflow: customer -> draft invoice -> post -> record payment -> apply to invoices, and expense -> submit -> approve.
 * Posting, voiding, recording and applying payments, approving and rejecting are actions: pickers plus a typed confirmation, no AI draft.
 */
const MODULE = "finance" as const;
type Values = Record<string, string | boolean> | null;
const v = (cur: Values, key: string, fallback: string | boolean): string | boolean => (cur && cur[key] !== undefined ? cur[key] : fallback);
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const matches = (ref: string, ...hay: (string | undefined)[]) => {
  const t = norm(ref);
  return t !== "" && hay.some((h) => norm(h ?? "").includes(t));
};

// ─── Reads ────────────────────────────────────────────────────────────────────

const read = (name: string, description: string, tool: string, pick: (args: CommandArgs) => Record<string, unknown>, hidden = false): CommandDefinition => ({
  name,
  description,
  example: `/${name}`,
  module: MODULE,
  operation: "view",
  permission: PERMISSIONS.FINANCE_READ,
  hidden,
  args: ARGS,
  fromText: searchText,
  async start(env, args) {
    return { parts: (await callTool(env, tool, pick(args))).parts ?? [] };
  },
});

const page = (args: CommandArgs) => ({ page: Number(args.page ?? 1) });
const INVOICE_WORDS = ["draft", "posted", "partially_paid", "paid", "voided", "overdue"];
const EXPENSE_WORDS = ["draft", "submitted", "approved", "rejected", "paid"];
const word = (a: CommandArgs) => String(a.status ?? a.q ?? "").toLowerCase().replace(" ", "_");

const customers = read("customers", "Browse and search customers.", "finance_list_customers", (a) => ({ ...(a.status ? { status: String(a.status) } : {}), q: String(a.q ?? ""), ...page(a) }));
const customer = read("customer", "Show one customer.", "finance_get_customer", (a) => ({ customerId: need(a, "customerId") }), true);
const invoices = read("invoices", "List invoices (try /invoices overdue).", "finance_list_invoices", (a) => ({
  ...(INVOICE_WORDS.includes(word(a)) ? { status: word(a) } : { q: String(a.q ?? "") }),
  ...(a.customerId ? { customerId: need(a, "customerId") } : {}),
  ...page(a),
}));
const invoice = read("invoice", "Show one invoice.", "finance_get_invoice", (a) => ({ invoiceId: need(a, "invoiceId") }), true);
const unpaid = read("unpaid", "Unpaid invoices, oldest due first.", "finance_list_unpaid_invoices", (a) => ({ ...(a.customerId ? { customerId: need(a, "customerId") } : {}), ...page(a) }));
const payments = read("payments", "Payments received (try /payments unallocated).", "finance_list_payments", (a) => ({ unallocatedOnly: a.unallocatedOnly === true || String(a.q ?? "").toLowerCase().startsWith("unalloc"), ...page(a) }));
const expenses = read("expenses", "List expenses (try /expenses submitted).", "finance_list_expenses", (a) => ({
  ...(EXPENSE_WORDS.includes(word(a)) ? { status: word(a) } : { q: String(a.q ?? "") }),
  ...page(a),
}));
const financesummary = read("financesummary", "Finance summary: invoiced, collected, overdue, expenses.", "finance_get_summary", () => ({}));

// ─── Option lists and field builders ──────────────────────────────────────────

const currencyChoices = CURRENCIES.map((c) => ({ value: c, label: c }));
const defaultCurrency = (env: CommandEnv) => (CURRENCIES as readonly string[]).includes(env.ctx.currencyCode) ? env.ctx.currencyCode : "";
const METHOD_OPTIONS = [
  { value: "", label: "Choose a method" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "cheque", label: "Cheque" },
  { value: "other", label: "Other" },
];

async function customerChoices(env: CommandEnv) {
  const rows = (await fin(env.ctx).listCustomers()).filter((c) => c.status === "active").slice(0, 500);
  return [{ value: "", label: "Choose a customer" }, ...rows.map((c) => ({ value: c.id, label: c.name }))];
}

const customerRef = {
  async find(env: CommandEnv, words: string): Promise<DraftCandidate[]> {
    const all = (await fin(env.ctx).listCustomers()).filter((c) => c.status === "active");
    let hits = all.filter((c) => matches(words, c.name));
    if (hits.length === 0) {
      const token = words.split(/\s+/).find((t) => t.length >= 3);
      if (token) hits = all.filter((c) => matches(token, c.name));
    }
    return hits.slice(0, 8).map((c) => ({ id: c.id, label: c.name, detail: c.email ?? "" }));
  },
  async byId(env: CommandEnv, id: string): Promise<DraftCandidate | null> {
    try {
      const c = await fin(env.ctx).getCustomer(id);
      return c.status === "active" ? { id: c.id, label: c.name, detail: c.email ?? "" } : null;
    } catch {
      return null;
    }
  },
};

// ─── Customers ────────────────────────────────────────────────────────────────

const customerFields = (cur: Values, mode: "create" | "edit"): AiFormField[] => [
  field({ name: "name", label: "Name", kind: "text", required: true, value: v(cur, "name", "") }),
  field({ name: "email", label: "Email", kind: "text", value: v(cur, "email", "") }),
  field({ name: "phone", label: "Phone", kind: "text", value: v(cur, "phone", "") }),
  field({ name: "taxId", label: "Tax ID", kind: "text", value: v(cur, "taxId", "") }),
  field({ name: "address", label: "Address", kind: "text", value: v(cur, "address", "") }),
  field({ name: "notes", label: "Notes", kind: "textarea", value: v(cur, "notes", "") }),
  ...(mode === "edit"
    ? [field({ name: "status", label: "Status", kind: "select", value: v(cur, "status", "active"), options: [{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive (no new invoices)" }] })]
    : []),
];

async function loadCustomer(env: CommandEnv, id: string): Promise<DraftCurrent> {
  const c = await fin(env.ctx).getCustomer(id);
  return { id: c.id, label: c.name, values: { name: c.name, email: c.email ?? "", phone: c.phone ?? "", taxId: c.taxId ?? "", address: c.address ?? "", notes: c.notes ?? "", status: c.status } };
}
async function searchCustomers(env: CommandEnv, text: string): Promise<DraftCandidate[]> {
  return (await fin(env.ctx).listCustomers()).filter((c) => matches(text, c.name, c.email, c.taxId)).slice(0, 8).map((c) => ({ id: c.id, label: c.name, detail: c.email || "No email" }));
}

const newcustomer = withAssist(
  {
    name: "newcustomer",
    description: "Create a customer.",
    example: "/newcustomer",
    module: MODULE,
    operation: "create",
    permission: PERMISSIONS.FINANCE_CUSTOMER_MANAGE,
    args: ARGS,
    fromText: noText,
    async start() {
      return { parts: [form({ title: "New customer", command: "newcustomer", context: {}, submitLabel: "Review", fields: customerFields(null, "create") })] };
    },
    submit: (env, _a, values) => proposeTool(env, "finance_create_customer", nonEmpty(values)),
  },
  { kind: "create", noun: "customer", examples: ["A customer called Atlas Foods, email billing@atlasfoods.tn, tax ID 1234567/A"], tool: "finance_create_customer", criticalFields: [], fields: async () => customerFields(null, "create") }
);

const editcustomerBase = pickCommand({
  name: "editcustomer",
  description: "Edit or deactivate a customer.",
  example: "/editcustomer atlas",
  module: MODULE,
  operation: "edit",
  permission: PERMISSIONS.FINANCE_CUSTOMER_MANAGE,
  title: "Choose a customer to edit",
  key: "customerId",
  list: async (env, a) => (await callTool(env, "finance_list_customers", { q: String(a.q ?? ""), ...page(a) })).parts ?? [],
  async select(env, a) {
    const c = await loadCustomer(env, need(a, "customerId"));
    return { parts: [form({ title: `Edit ${c.label}`, command: "editcustomer", context: { customerId: c.id }, submitLabel: "Review changes", fields: customerFields(c.values, "edit") })] };
  },
});
editcustomerBase.submit = (env, a, values) => proposeTool(env, "finance_update_customer", { ...nonEmpty(values, ["email", "phone", "taxId", "address", "notes"]), customerId: need(a, "customerId") });
const editcustomer = withAssist(editcustomerBase, {
  kind: "edit",
  noun: "customer",
  examples: ["Change Atlas Foods' phone number to 71 123 456"],
  tool: "finance_update_customer",
  criticalFields: [],
  target: { label: "customer", key: "customerId", search: searchCustomers, load: loadCustomer },
  fields: async (_e, cur) => customerFields(cur?.values ?? null, "edit"),
  context: (cur) => ({ customerId: cur.id }),
});

// ─── Invoices ─────────────────────────────────────────────────────────────────

const BLANK_INVOICE_ROW: LineRow = { productId: "", description: "", quantity: "", unitPrice: "", taxRate: "0" };

async function invoiceFields(env: CommandEnv, cur: Values): Promise<AiFormField[]> {
  const products = await fin(env.ctx).listInvoiceableProducts();
  return [
    field({ name: "customerId", label: "Customer", kind: "select", required: true, value: v(cur, "customerId", ""), options: await customerChoices(env) }),
    field({ name: "currency", label: "Currency", kind: "select", required: true, value: v(cur, "currency", defaultCurrency(env)), options: currencyChoices }),
    field({ name: "issueDate", label: "Issue date", kind: "text", required: true, value: v(cur, "issueDate", todayTunis()), placeholder: "YYYY-MM-DD" }),
    field({ name: "dueDate", label: "Due date", kind: "text", value: v(cur, "dueDate", ""), placeholder: "YYYY-MM-DD" }),
    field({ name: "notes", label: "Notes", kind: "textarea", value: v(cur, "notes", "") }),
    field({
      name: "lines",
      label: "Lines",
      kind: "lines",
      required: true,
      value: v(cur, "lines", serializeRows([BLANK_INVOICE_ROW])),
      hint: "Pick a product to use its price, or leave the product empty and describe the line. Totals and tax are calculated for you on the next step.",
      lines: {
        maxRows: 100,
        addLabel: "Add line",
        columns: [
          { name: "productId", label: "Product", kind: "select", options: [{ value: "", label: "Custom line" }, ...products.map((p) => ({ value: p.id, label: `${p.sku} · ${p.name}` }))] },
          { name: "description", label: "Description", kind: "text", placeholder: "What is billed" },
          { name: "quantity", label: "Quantity", kind: "text", placeholder: "1" },
          { name: "unitPrice", label: "Unit price", kind: "text", placeholder: "0.00" },
          { name: "taxRate", label: "Tax %", kind: "text", placeholder: "0" },
        ],
      },
    }),
  ];
}

const toInvoiceLines = (json: string) =>
  parseRows(json)
    .filter((r) => [r.productId, r.description, r.quantity, r.unitPrice].some((x) => (x ?? "").trim() !== ""))
    .map((r) => ({
      ...(r.productId ? { productId: r.productId } : {}),
      ...(r.description?.trim() ? { description: r.description.trim() } : {}),
      quantity: r.quantity ?? "",
      ...(r.unitPrice?.trim() ? { unitPrice: r.unitPrice } : {}),
      ...(r.taxRate?.trim() ? { taxRate: r.taxRate } : {}),
    }));

const invoiceLinesSpec = {
  field: "lines",
  keyColumn: "productId",
  requiredColumns: ["quantity", "unitPrice"],
  criticalColumns: ["quantity", "unitPrice", "taxRate"],
  async find(env: CommandEnv, ref: string): Promise<DraftCandidate[]> {
    const all = await fin(env.ctx).listInvoiceableProducts();
    let hits = all.filter((p) => matches(ref, p.name, p.sku));
    if (hits.length === 0) {
      const token = ref.split(/\s+/).find((t) => t.length >= 3);
      if (token) hits = all.filter((p) => matches(token, p.name, p.sku));
    }
    return hits.slice(0, 8).map((p) => ({ id: p.id, label: `${p.sku} · ${p.name}`, detail: p.unitPrice > 0 && Math.round(p.unitPrice * 1000) % 10 === 0 ? centsText(toCents(p.unitPrice)) : "" }));
  },
  async byId(env: CommandEnv, id: string): Promise<DraftCandidate | null> {
    const p = (await fin(env.ctx).listInvoiceableProducts()).find((x) => x.id === id);
    return p ? { id: p.id, label: `${p.sku} · ${p.name}`, detail: p.unitPrice > 0 && Math.round(p.unitPrice * 1000) % 10 === 0 ? centsText(toCents(p.unitPrice)) : "" } : null;
  },
  /** A matched product brings its own name and sale price from the company's records; quantity and tax stay for the person to state. */
  async newRow(env: CommandEnv, c: DraftCandidate) {
    const p = (await fin(env.ctx).listInvoiceableProducts()).find((x) => x.id === c.id);
    return {
      row: { productId: c.id, label: c.label, description: p?.description || p?.name || "", quantity: "", unitPrice: c.detail, taxRate: "0" },
      provenance: { productId: "found", description: "found", unitPrice: c.detail ? "found" : "default", taxRate: "default", quantity: "default" } as Record<string, AiProvenance>,
    };
  },
};

const newinvoiceBase: CommandDefinition = {
  name: "newinvoice",
  description: "Create a draft invoice.",
  example: "/newinvoice",
  module: MODULE,
  operation: "create",
  permission: PERMISSIONS.FINANCE_INVOICE_MANAGE,
  args: ARGS,
  fromText: noText,
  async start(env, args) {
    requireCell(env, MODULE, "view");
    const fields = await invoiceFields(env, args.customerId ? { customerId: String(args.customerId) } : null);
    return { parts: [form({ title: "New invoice", description: "This creates a draft. It becomes official only when you post it.", command: "newinvoice", context: {}, submitLabel: "Review", fields })] };
  },
  submit: (env, _a, values) =>
    proposeTool(env, "finance_create_invoice", {
      customerId: String(values.customerId ?? ""),
      ...(values.currency ? { currency: String(values.currency) } : {}),
      ...(values.issueDate ? { issueDate: String(values.issueDate) } : {}),
      ...(values.dueDate ? { dueDate: String(values.dueDate) } : {}),
      ...(values.notes ? { notes: String(values.notes) } : {}),
      lines: toInvoiceLines(String(values.lines ?? "[]")),
    }),
};
const newinvoice = withAssist(newinvoiceBase, {
  kind: "create",
  noun: "invoice",
  examples: ["Invoice Atlas Foods for 12 olive oil bottles at 9.50 with 19% tax, due 2026-12-31"],
  tool: "finance_create_invoice",
  criticalFields: ["customerId"],
  refFields: { customerId: customerRef },
  lines: invoiceLinesSpec,
  fields: (env, cur) => invoiceFields(env, cur?.values ?? null),
});

const invoicePicker = (name: string, description: string, status: string | undefined, operation: CommandDefinition["operation"], permission: CommandDefinition["permission"]) =>
  pickCommand({
    name,
    description,
    example: `/${name}`,
    module: MODULE,
    operation,
    permission,
    title: `Choose an invoice: ${name}`,
    key: "invoiceId",
    list: async (env, a) => (await callTool(env, "finance_list_invoices", { ...(status ? { status } : {}), q: String(a.q ?? ""), ...page(a) })).parts ?? [],
    select: (env, a) => proposeTool(env, "finance_post_invoice", { invoiceId: need(a, "invoiceId") }),
  });
const postinvoice = invoicePicker("postinvoice", "Post a draft invoice (typed confirmation).", "draft", "approve", PERMISSIONS.FINANCE_INVOICE_POST);

const voidinvoice = pickCommand({
  name: "voidinvoice",
  description: "Void an invoice that has no payments (typed confirmation).",
  example: "/voidinvoice",
  module: MODULE,
  operation: "delete",
  permission: PERMISSIONS.FINANCE_INVOICE_POST,
  title: "Choose an invoice to void",
  key: "invoiceId",
  list: async (env, a) => (await callTool(env, "finance_list_invoices", { q: String(a.q ?? ""), ...page(a) })).parts ?? [],
  async select(env, a) {
    const inv = await fin(env.ctx).getInvoice(need(a, "invoiceId"));
    return {
      parts: [
        form({
          title: `Void ${inv.invoiceNumber}`,
          description: `${inv.customer?.name ?? "Direct customer"} · ${moneyOf(inv.total, inv.currency as string)}. Voiding cannot be undone.`,
          command: "voidinvoice",
          context: { invoiceId: inv.id },
          submitLabel: "Review",
          fields: [field({ name: "reason", label: "Reason", kind: "textarea", required: true, value: "", hint: "Why is this invoice being voided?" })],
        }),
      ],
    };
  },
});
voidinvoice.submit = (env, a, values) => proposeTool(env, "finance_void_invoice", { invoiceId: need(a, "invoiceId"), reason: String(values.reason ?? "") });

// ─── Payments ─────────────────────────────────────────────────────────────────

async function paymentFields(env: CommandEnv, cur: Values, hint?: string, currency?: string): Promise<AiFormField[]> {
  return [
    field({ name: "amount", label: "Amount received", kind: "text", required: true, value: v(cur, "amount", ""), placeholder: "0.00", hint }),
    field({ name: "currency", label: "Currency", kind: "select", required: true, value: v(cur, "currency", currency ?? defaultCurrency(env)), options: currencyChoices }),
    field({ name: "method", label: "Method", kind: "select", required: true, value: v(cur, "method", ""), options: METHOD_OPTIONS }),
    field({ name: "paymentDate", label: "Date received", kind: "text", required: true, value: v(cur, "paymentDate", todayTunis()), placeholder: "YYYY-MM-DD" }),
    field({ name: "reference", label: "Reference", kind: "text", value: v(cur, "reference", ""), hint: "The bank or cheque reference, if there is one." }),
    field({ name: "notes", label: "Notes", kind: "textarea", value: v(cur, "notes", "") }),
  ];
}

const recordpaymentBase: CommandDefinition = {
  name: "recordpayment",
  description: "Record a payment already received (typed confirmation). Moves no money.",
  example: "/recordpayment",
  module: MODULE,
  operation: "create",
  permission: PERMISSIONS.FINANCE_PAYMENT_ALLOCATE,
  args: ARGS,
  fromText: (rest) => ({ text: rest.trim().slice(0, 600) }),
  async start(env, args) {
    requireCell(env, MODULE, "view");
    let hint: string | undefined;
    let currency: string | undefined;
    if (args.invoiceId) {
      const inv = await fin(env.ctx).getInvoice(need(args, "invoiceId"));
      currency = inv.currency as string;
      hint = `Balance due on ${inv.invoiceNumber}: ${moneyOf(inv.balance, currency)}`;
    }
    return { parts: [form({ title: "Record a payment received", description: "This only records money that has already arrived. It does not send or collect anything.", command: "recordpayment", context: {}, submitLabel: "Review", fields: await paymentFields(env, null, hint, currency) })] };
  },
  submit: (env, _a, values) => proposeTool(env, "finance_record_payment", nonEmpty(values)),
};
const recordpayment = withAssist(recordpaymentBase, {
  kind: "create",
  noun: "payment",
  examples: ["Atlas Foods paid 1190 TND by bank transfer on 2026-11-03, reference VIR-4471"],
  tool: "finance_record_payment",
  criticalFields: ["amount", "method"],
  fields: (env, cur) => paymentFields(env, cur?.values ?? null),
});

// Applying a payment to invoices: rows are the open invoices in the payment's currency; the person states each amount.
async function openInvoiceRows(env: CommandEnv, currency: string): Promise<LineRow[]> {
  return (await fin(env.ctx).listUnpaidInvoices())
    .filter((i) => i.currency === currency && toCents(i.balance) > 0)
    .slice(0, 100)
    .map((i) => ({ invoiceId: i.id, label: `${i.invoiceNumber} · ${i.customerName ?? "Direct customer"}`, balance: money(toCents(i.balance), i.currency), amount: "" }));
}

const allocateFields = (rows: string): AiFormField[] => [
  field({
    name: "allocations",
    label: "Apply to invoices",
    kind: "lines",
    value: rows,
    hint: "Enter the amount to apply to each invoice. Leave the others empty.",
    lines: {
      maxRows: 100,
      fixedRows: true,
      columns: [
        { name: "label", label: "Invoice", kind: "readonly" },
        { name: "balance", label: "Balance due", kind: "readonly", align: "right" },
        { name: "amount", label: "Apply now", kind: "text", placeholder: "0.00" },
      ],
    },
  }),
];

async function loadPayment(env: CommandEnv, id: string): Promise<DraftCurrent> {
  const p = (await fin(env.ctx).listPayments()).find((x) => x.id === id);
  if (!p) throw new AppError("NOT_FOUND", "Payment not found among the latest 100 payments.");
  if (toCents(p.unallocatedAmount) <= 0) throw new AppError("INVALID_TRANSITION", "That payment is already fully applied.");
  const rows = await openInvoiceRows(env, p.currency);
  if (rows.length === 0) throw new AppError("NOT_FOUND", `There are no unpaid invoices in ${p.currency} to apply it to.`);
  return { id: p.id, label: `${moneyOf(p.amount, p.currency)}${p.reference ? ` · ${p.reference}` : ""}`, values: { allocations: serializeRows(rows) } };
}
async function searchPayments(env: CommandEnv, text: string): Promise<DraftCandidate[]> {
  return (await fin(env.ctx).listPayments())
    .filter((p) => toCents(p.unallocatedAmount) > 0)
    .filter((p) => text.trim() === "" || matches(text, p.reference, p.paymentDate, centsText(toCents(p.amount)), p.method))
    .slice(0, 8)
    .map((p) => ({ id: p.id, label: `${moneyOf(p.amount, p.currency)}${p.reference ? ` · ${p.reference}` : ""}`, detail: `${p.paymentDate?.slice(0, 10)} · ${moneyOf(p.unallocatedAmount, p.currency)} unallocated` }));
}

const allocateLines = {
  field: "allocations",
  keyColumn: "invoiceId",
  requiredColumns: [],
  criticalColumns: ["amount"],
  fixedRows: true,
  async find(env: CommandEnv, ref: string, cur: DraftCurrent | null): Promise<DraftCandidate[]> {
    if (!cur) return [];
    return parseRows(String(cur.values.allocations ?? "[]"))
      .filter((r) => matches(ref, r.label))
      .map((r) => ({ id: r.invoiceId, label: r.label, detail: r.balance }));
  },
  async byId(_env: CommandEnv, id: string, cur: DraftCurrent | null): Promise<DraftCandidate | null> {
    const r = cur ? parseRows(String(cur.values.allocations ?? "[]")).find((x) => x.invoiceId === id) : undefined;
    return r ? { id: r.invoiceId, label: r.label, detail: r.balance } : null;
  },
  async newRow(_e: CommandEnv, c: DraftCandidate) {
    return { row: { invoiceId: c.id, label: c.label, balance: c.detail, amount: "" }, provenance: {} as Record<string, AiProvenance> };
  },
};

const allocateBase = pickCommand({
  name: "allocate",
  description: "Apply a received payment to invoices (typed confirmation).",
  example: "/allocate",
  module: MODULE,
  operation: "edit",
  permission: PERMISSIONS.FINANCE_PAYMENT_ALLOCATE,
  title: "Choose a payment to apply",
  key: "paymentId",
  list: async (env, a) => (await callTool(env, "finance_list_payments", { unallocatedOnly: true, ...page(a) })).parts ?? [],
  async select(env, a) {
    const cur = await loadPayment(env, need(a, "paymentId"));
    const p = (await fin(env.ctx).listPayments()).find((x) => x.id === cur.id)!;
    return {
      parts: [
        form({
          title: `Apply ${cur.label}`,
          description: `${moneyOf(p.unallocatedAmount, p.currency)} of this payment is not applied yet. Only invoices in ${p.currency} are listed; currencies are never converted.`,
          command: "allocate",
          context: { paymentId: cur.id },
          submitLabel: "Review",
          fields: allocateFields(String(cur.values.allocations)),
        }),
      ],
    };
  },
});
allocateBase.submit = (env, a, values) =>
  proposeTool(env, "finance_allocate_payment", {
    paymentId: need(a, "paymentId"),
    allocations: parseRows(String(values.allocations ?? "[]"))
      .filter((r) => (r.amount ?? "").trim() !== "")
      .map((r) => ({ invoiceId: r.invoiceId, amount: r.amount })),
  });
const allocate = withAssist(allocateBase, {
  kind: "create",
  action: "Apply a payment",
  noun: "payment allocation",
  examples: ["Apply 500 of the 1190 TND payment ref VIR-4471 to invoice INV-2026-00003"],
  tool: "finance_allocate_payment",
  criticalFields: [],
  lines: allocateLines,
  target: { label: "payment with an unallocated amount", key: "paymentId", search: searchPayments, load: loadPayment },
  fields: async (_e, cur) => allocateFields(String(cur?.values.allocations ?? "[]")),
  context: (cur) => ({ paymentId: cur.id }),
  fromToolArgs: (a) => ({ targetId: String(a.paymentId ?? ""), values: a }),
});

// ─── Expenses ─────────────────────────────────────────────────────────────────

async function expenseFields(env: CommandEnv, cur: Values): Promise<AiFormField[]> {
  const cats = (await fin(env.ctx).listExpenseCategories()).filter((c) => c.active);
  return [
    field({ name: "expenseDate", label: "Date", kind: "text", required: true, value: v(cur, "expenseDate", ""), placeholder: "YYYY-MM-DD" }),
    field({ name: "description", label: "Description", kind: "text", required: true, value: v(cur, "description", "") }),
    field({ name: "vendor", label: "Vendor", kind: "text", value: v(cur, "vendor", "") }),
    field({ name: "categoryId", label: "Category", kind: "select", value: v(cur, "categoryId", ""), options: [{ value: "", label: "No category" }, ...cats.map((c) => ({ value: c.id, label: c.name }))] }),
    field({ name: "amount", label: "Amount", kind: "text", required: true, value: v(cur, "amount", ""), placeholder: "0.00", hint: "Before tax." }),
    field({ name: "tax", label: "Tax amount", kind: "text", value: v(cur, "tax", ""), placeholder: "0.00", hint: "An amount, not a percentage. Leave empty for none." }),
    field({ name: "currency", label: "Currency", kind: "select", required: true, value: v(cur, "currency", defaultCurrency(env)), options: currencyChoices }),
    field({ name: "notes", label: "Notes", kind: "textarea", value: v(cur, "notes", "") }),
  ];
}

const newexpense = withAssist(
  {
    name: "newexpense",
    description: "Create a draft expense.",
    example: "/newexpense",
    module: MODULE,
    operation: "create",
    permission: PERMISSIONS.FINANCE_EXPENSE_MANAGE,
    args: ARGS,
    fromText: noText,
    async start(env) {
      return { parts: [form({ title: "New expense", description: "This creates a draft. Submit it afterwards for approval.", command: "newexpense", context: {}, submitLabel: "Review", fields: await expenseFields(env, null) })] };
    },
    submit: (env, _a, values) => proposeTool(env, "finance_create_expense", nonEmpty(values)),
  },
  {
    kind: "create",
    noun: "expense",
    examples: ["Taxi to the client meeting on 2026-11-03, 18.50 TND, Travel & Transport"],
    tool: "finance_create_expense",
    criticalFields: ["expenseDate", "amount"],
    fields: (env, cur) => expenseFields(env, cur?.values ?? null),
  }
);

const expensePicker = (name: string, description: string, status: string, operation: CommandDefinition["operation"], tool: string, permission: CommandDefinition["permission"]) =>
  pickCommand({
    name,
    description,
    example: `/${name}`,
    module: MODULE,
    operation,
    permission,
    title: `Choose an expense: ${name}`,
    key: "expenseId",
    list: async (env, a) => (await callTool(env, "finance_list_expenses", { status, q: String(a.q ?? ""), ...page(a) })).parts ?? [],
    select: (env, a) => proposeTool(env, tool, { expenseId: need(a, "expenseId") }),
  });
const submitexpense = expensePicker("submitexpense", "Submit a draft expense for approval.", "draft", "edit", "finance_submit_expense", PERMISSIONS.FINANCE_EXPENSE_MANAGE);
const approveexpense = expensePicker("approveexpense", "Approve a submitted expense (typed confirmation).", "submitted", "approve", "finance_approve_expense", PERMISSIONS.FINANCE_EXPENSE_APPROVE);
const rejectexpense = expensePicker("rejectexpense", "Reject a submitted expense (typed confirmation).", "submitted", "approve", "finance_reject_expense", PERMISSIONS.FINANCE_EXPENSE_APPROVE);
rejectexpense.select = async (env, a) => {
  const e = (await fin(env.ctx).listExpenses("submitted")).find((x) => x.id === need(a, "expenseId"));
  if (!e) throw new AppError("NOT_FOUND", "That expense is not waiting for approval.");
  return {
    parts: [
      form({
        title: `Reject ${e.vendor || e.description}`,
        description: `${moneyOf(e.total, e.currency)} dated ${e.expenseDate?.slice(0, 10)}. A rejected expense cannot be resubmitted.`,
        command: "rejectexpense",
        context: { expenseId: e.id },
        submitLabel: "Review",
        fields: [field({ name: "reason", label: "Reason", kind: "textarea", required: true, value: "", hint: "Shown to the person who submitted it." })],
      }),
    ],
  };
};
rejectexpense.submit = (env, a, values) => proposeTool(env, "finance_reject_expense", { expenseId: need(a, "expenseId"), reason: String(values.reason ?? "") });

const newexpensecategory = withAssist(
  {
    name: "newexpensecategory",
    description: "Create an expense category.",
    example: "/newexpensecategory",
    module: MODULE,
    operation: "create",
    permission: PERMISSIONS.FINANCE_EXPENSE_MANAGE,
    args: ARGS,
    fromText: noText,
    async start() {
      return { parts: [form({ title: "New expense category", command: "newexpensecategory", context: {}, submitLabel: "Review", fields: [field({ name: "name", label: "Name", kind: "text", required: true, value: "" })] })] };
    },
    submit: (env, _a, values) => proposeTool(env, "finance_create_expense_category", nonEmpty(values)),
  },
  { kind: "create", noun: "expense category", examples: ["A category called Training"], tool: "finance_create_expense_category", criticalFields: [], fields: async () => [field({ name: "name", label: "Name", kind: "text", required: true, value: "" })] }
);

export const FINANCE_COMMANDS: CommandDefinition[] = [
  financesummary,
  customers,
  customer,
  newcustomer,
  editcustomer,
  invoices,
  invoice,
  unpaid,
  newinvoice,
  postinvoice,
  voidinvoice,
  payments,
  recordpayment,
  allocate,
  expenses,
  newexpense,
  submitexpense,
  approveexpense,
  rejectexpense,
  newexpensecategory,
];
