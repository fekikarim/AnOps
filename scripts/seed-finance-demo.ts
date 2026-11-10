/**
 * Finance demo data for one company: customers, invoices (paid, partly paid, overdue, draft, credited,
 * with timbre fiscal), payments with bank references, and expenses in every workflow state, spread over
 * the last five months. Everything is created through the real FinanceService, so numbering, totals,
 * permissions and the audit log behave exactly as in normal use.
 *
 * Every record it creates is tagged `demo: true`; --clean removes exactly those (and nothing else).
 *
 *   npx vite-node -c vitest.config.mts scripts/seed-finance-demo.ts -- --company <companyId>
 *   npx vite-node -c vitest.config.mts scripts/seed-finance-demo.ts -- --company <companyId> --clean
 */
import { existsSync } from "node:fs";
import { ObjectId } from "mongodb";

type ProcessWithEnvFile = typeof process & { loadEnvFile?: (path?: string) => void };
if (!process.env.MONGODB_URI && existsSync(".env")) (process as ProcessWithEnvFile).loadEnvFile?.(".env");
if (!process.env.MONGODB_URI) {
  console.error("MONGODB_URI is not set.");
  process.exit(1);
}

const args = process.argv.slice(2);
const companyArg = args[args.indexOf("--company") + 1];
if (!args.includes("--company") || !companyArg || !ObjectId.isValid(companyArg)) {
  console.error("Pass the company to fill: --company <companyId> (find it in the companies collection).");
  process.exit(1);
}
const clean = args.includes("--clean");

const { default: clientPromise } = await import("@/server/db/client");
const { FinanceService } = await import("@/server/services/finance.service");

const COLLECTIONS = ["finance_customers", "finance_invoices", "finance_payments", "finance_payment_allocations", "finance_expenses", "finance_credit_notes"];

const client = await clientPromise;
const db = client.db();
const companyId = new ObjectId(companyArg);
const company = await db.collection("companies").findOne({ _id: companyId });
if (!company) {
  console.error("No company with that id.");
  process.exit(1);
}
const owner = await db.collection("company_members").findOne({ companyId, role: "owner", status: "active" });
if (!owner) {
  console.error("That company has no active owner to act as.");
  process.exit(1);
}

if (clean) {
  const demoInvoices = await db.collection("finance_invoices").find({ companyId, demo: true }, { projection: { _id: 1 } }).toArray();
  const demoPayments = await db.collection("finance_payments").find({ companyId, demo: true }, { projection: { _id: 1 } }).toArray();
  await db.collection("finance_payment_allocations").deleteMany({ companyId, $or: [{ invoiceId: { $in: demoInvoices.map((d) => d._id) } }, { paymentId: { $in: demoPayments.map((d) => d._id) } }] });
  await db.collection("finance_credit_notes").deleteMany({ companyId, invoiceId: { $in: demoInvoices.map((d) => d._id) } });
  for (const c of COLLECTIONS) {
    const r = await db.collection(c).deleteMany({ companyId, demo: true });
    if (r.deletedCount) console.log(`removed ${r.deletedCount} from ${c}`);
  }
  console.log(`Demo finance data removed from ${company.name}.`);
  await client.close();
  process.exit(0);
}

const already = await db.collection("finance_customers").countDocuments({ companyId, demo: true });
if (already) {
  console.error(`${company.name} already has demo finance data. Run with --clean first.`);
  await client.close();
  process.exit(1);
}

const userId = owner.userId.toHexString();
const svc = new FinanceService({ companyId: companyArg, companyRole: "owner", userId });
const tag = (collection: string, id: string) => db.collection(collection).updateOne({ _id: new ObjectId(id), companyId }, { $set: { demo: true } });
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

// Customers
const customerSpecs = [
  { name: "Atlas Distribution SARL", email: "compta@atlas-distribution.tn", taxId: "1234567/A/M/000", address: "Rue du Lac Biwa, Les Berges du Lac, Tunis" },
  { name: "Carthage Digital", email: "finance@carthage-digital.tn", taxId: "2345678/B/P/000", address: "Avenue Habib Bourguiba, Tunis" },
  { name: "Sfax Olive Export", email: "accounts@sfaxolive.tn", taxId: "3456789/C/M/000", address: "Route de Gabès km 4, Sfax" },
  { name: "Sousse Hospitality Group", email: "ap@soussehg.tn", taxId: "4567890/D/M/000", address: "Boulevard du 14 Janvier, Sousse" },
  { name: "Bizerte Marine Services", email: "pay@bizertemarine.tn", taxId: "5678901/E/P/000", address: "Port de Bizerte" },
  { name: "Nabeul Ceramics", email: "", taxId: "6789012/F/M/000", address: "Zone industrielle, Nabeul" },
];
const customers: string[] = [];
for (const c of customerSpecs) {
  const id = await svc.createCustomer(c, userId);
  await tag("finance_customers", id);
  customers.push(id);
}

// Invoices: [customer, issued days ago, payment days, lines, stamp, outcome]
type Outcome = "paid" | "partial" | "open" | "overdue" | "draft" | "credited";
const services = [
  { description: "Website redesign", unitPrice: 2400, taxRate: 19 },
  { description: "Monthly maintenance", unitPrice: 450, taxRate: 19 },
  { description: "Consulting day", unitPrice: 600, taxRate: 19 },
  { description: "Training session (per person)", unitPrice: 180, taxRate: 7 },
  { description: "Printed catalogues", unitPrice: 12.5, taxRate: 19 },
];
const invoiceSpecs: Array<[number, number, number, Array<[number, number]>, boolean, Outcome]> = [
  [0, 140, 30, [[0, 1], [1, 2]], true, "paid"],
  [1, 125, 30, [[2, 3]], true, "paid"],
  [2, 110, 45, [[4, 200]], true, "paid"],
  [3, 95, 30, [[3, 12]], true, "partial"],
  [0, 80, 30, [[1, 1]], true, "overdue"],
  [4, 72, 30, [[2, 2], [1, 1]], true, "overdue"],
  [1, 60, 30, [[0, 1]], true, "paid"],
  [2, 45, 45, [[4, 120]], true, "credited"],
  [5, 38, 30, [[2, 4]], true, "partial"],
  [3, 25, 30, [[1, 3]], true, "open"],
  [0, 15, 30, [[2, 5]], true, "open"],
  [4, 8, 30, [[3, 8]], true, "open"],
  [1, 2, 30, [[0, 1], [2, 2]], true, "draft"],
  [5, 1, 30, [[4, 60]], true, "draft"],
];
const posted: Array<{ id: string; outcome: Outcome; total: number; issued: number }> = [];
for (const [cust, ago, terms, lines, stamp, outcome] of invoiceSpecs) {
  const id = await svc.createInvoiceDraft(
    {
      customerId: customers[cust],
      currency: "TND",
      issueDate: day(-ago),
      dueDate: day(-ago + terms),
      terms: `Payment due within ${terms} days of issue.`,
      stampDuty: stamp,
      lines: lines.map(([s, qty]) => ({ ...services[s], quantity: qty })),
    },
    userId
  );
  await tag("finance_invoices", id);
  if (outcome !== "draft") {
    await svc.postInvoice(id, userId);
    posted.push({ id, outcome, total: (await svc.getInvoice(id)).total, issued: ago });
  }
}

// Payments, applied to their invoices; a few amounts and references are left for the matcher.
for (const inv of posted) {
  const number = (await svc.getInvoice(inv.id)).invoiceNumber;
  if (inv.outcome === "paid" || inv.outcome === "partial") {
    const amount = inv.outcome === "paid" ? inv.total : Math.round(inv.total * 0.4 * 100) / 100;
    const p = await svc.recordPayment({ paymentDate: day(-inv.issued + 18), amount, currency: "TND", method: "bank_transfer", reference: `VIR ${number.replace(/-/g, " ")}` }, userId);
    await tag("finance_payments", p);
    await svc.allocatePayment(p, [{ invoiceId: inv.id, amount }], userId);
  }
  if (inv.outcome === "credited") await svc.createCreditNote(inv.id, { amount: inv.total, reason: "Order cancelled by the customer" }, userId);
}
// Two payments not yet allocated: one names its invoice in the reference, one matches an exact balance.
const openOnes = posted.filter((p) => p.outcome === "open");
const p1 = await svc.recordPayment({ paymentDate: day(-3), amount: openOnes[0].total, currency: "TND", method: "bank_transfer", reference: `Virement ${(await svc.getInvoice(openOnes[0].id)).invoiceNumber}` }, userId);
const p2 = await svc.recordPayment({ paymentDate: day(-1), amount: openOnes[1].total, currency: "TND", method: "cheque", reference: "Cheque 004512" }, userId);
await tag("finance_payments", p1);
await tag("finance_payments", p2);

// Expenses across categories and every workflow state, including a duplicate pair and a large one without receipt.
const cats = await svc.listExpenseCategories();
const cat = (name: string) => cats.find((c) => c.name === name)?.id;
type ExpenseState = "draft" | "submitted" | "approved" | "paid" | "rejected";
const expenseSpecs: Array<[number, string, string, string, number, number, ExpenseState]> = [
  [130, "Ooredoo", "Fibre internet - monthly", "Utilities & Rent", 89, 16.91, "paid"],
  [125, "STEG", "Electricity bill", "Utilities & Rent", 240, 45.6, "paid"],
  [118, "Tunisair", "Flight Tunis - Djerba, client visit", "Travel & Transport", 310, 0, "paid"],
  [104, "Monoprix Lac 2", "Office supplies", "Office & Supplies", 71.01, 14.49, "paid"],
  [99, "Ooredoo", "Fibre internet - monthly", "Utilities & Rent", 89, 16.91, "paid"],
  [92, "Google Workspace", "Workspace licences", "Software & Cloud", 180, 0, "paid"],
  [85, "Shell Lac", "Fuel", "Travel & Transport", 120, 22.8, "paid"],
  [76, "Dar El Jeld", "Client dinner", "Meals & Entertainment", 260, 0, "approved"],
  [68, "Ooredoo", "Fibre internet - monthly", "Utilities & Rent", 89, 16.91, "paid"],
  [61, "Mytek", "Laptop for new developer", "Hardware & Equipment", 2890, 549.1, "approved"],
  [54, "Facebook Ads", "Campaign: autumn promotion", "Marketing & Ads", 600, 0, "paid"],
  [40, "Shell Lac", "Fuel", "Travel & Transport", 110, 20.9, "submitted"],
  [33, "Cabinet Ben Salah", "Quarterly accounting", "Legal & Accounting", 900, 171, "approved"],
  [26, "Ooredoo", "Fibre internet - monthly", "Utilities & Rent", 89, 16.91, "submitted"],
  [19, "Le Golfe", "Team lunch", "Meals & Entertainment", 185, 0, "rejected"],
  [12, "Mytek", "External monitor", "Hardware & Equipment", 520, 98.8, "submitted"],
  [12, "Mytek", "External monitor", "Hardware & Equipment", 520, 98.8, "draft"],
  [5, "Shell Lac", "Fuel", "Travel & Transport", 95, 18.05, "draft"],
];
for (const [ago, vendor, description, category, amount, tax, state] of expenseSpecs) {
  const id = await svc.createExpense({ expenseDate: day(-ago), vendor, description, categoryId: cat(category), amount, tax, currency: "TND" }, userId);
  await tag("finance_expenses", id);
  if (state === "draft") continue;
  await svc.submitExpense(id, userId);
  if (state === "submitted") continue;
  if (state === "rejected") {
    await svc.rejectExpense(id, "Personal expense, not reimbursable", userId);
    continue;
  }
  await svc.approveExpense(id, userId);
  if (state === "paid") await svc.markExpensePaid(id, userId);
}

console.log(`Demo finance data added to ${company.name}: ${customers.length} customers, ${invoiceSpecs.length} invoices, ${posted.filter((p) => p.outcome === "paid" || p.outcome === "partial").length + 2} payments, ${expenseSpecs.length} expenses.`);
console.log("Remove it with --clean.");
await client.close();
