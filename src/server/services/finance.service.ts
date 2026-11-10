import "server-only";
import clientPromise from "@/server/db/client";
import { ObjectId, type Db, type Document, type WithId } from "mongodb";
import { AppError } from "@/shared/lib/errors";
import { withTransaction } from "@/server/db/transactions";
import { recordAudit } from "@/server/audit/audit.service";
import { randomUUID } from "crypto";
import { assertPermission, permissionsForRole, workspaceRoleFor } from "@/server/security/permissions";
import type { CompanyRole } from "@/features/company/types";
import { addAmounts, computeLineTotal, computeTotals, fromCents, stampDutyFor, toCents } from "@/features/finance/utils/money";
import { todayTunis } from "@/server/ai/finance/money";
import { computeCustomerInsight, type CustomerInsight, type InvoiceHistory } from "@/features/finance/utils/insights";
import { deleteReceiptFile, putReceiptFile, readReceiptFile, type ReceiptSource } from "@/server/finance/receipt-storage";

export type FinanceServiceContext = {
  companyId: string;
  companyRole: CompanyRole;
  /** Not used by the service: every write takes the acting user explicitly. */
  userId?: string;
};

async function getDb() {
  const client = await clientPromise;
  return client.db();
}

function requireCompanyId(companyId: string) {
  if (!companyId || !ObjectId.isValid(companyId)) {
    throw new AppError("VALIDATION_ERROR", "Invalid companyId");
  }
  return new ObjectId(companyId);
}

async function getNextInvoiceNumber(db: Db, companyId: ObjectId) {
  const year = new Date().getFullYear();
  const counter = db.collection("finance_counters");
  const res = await counter.findOneAndUpdate(
    { companyId, key: `invoice_${year}` },
    { $inc: { seq: 1 }, $setOnInsert: { companyId, key: `invoice_${year}`, createdAt: new Date() } },
    { upsert: true, returnDocument: "after" }
  );
  const seq = (res?.seq as number) || 1;
  return `INV-${year}-${String(seq).padStart(5, "0")}`;
}

/** A posted, not fully paid invoice past its due date (company calendar day). Computed, never stored. */
export function isInvoiceOverdue(inv: { [k: string]: unknown }, today = todayTunis()): boolean {
  return (inv.status === "posted" || inv.status === "partially_paid") && typeof inv.dueDate === "string" && !!inv.dueDate && inv.dueDate < today && toCents(Number(inv.balance) || 0) > 0;
}

export class FinanceService {
  private companyId: ObjectId;
  private permissions: ReadonlySet<import("@/server/security/permissions").Permission>;
  private companyRole: CompanyRole;

  constructor(ctx: FinanceServiceContext) {
    this.companyId = requireCompanyId(ctx.companyId);
    this.companyRole = ctx.companyRole;
    const workspaceRole = workspaceRoleFor(ctx.companyRole);
    this.permissions = permissionsForRole(workspaceRole);
  }

  hasPermission(permission: import("@/server/security/permissions").Permission): boolean {
    return this.permissions.has(permission);
  }

  private ensurePermission(permission: import("@/server/security/permissions").Permission) {
    assertPermission(this.permissions, permission);
  }

  /** Currencies that have finance activity in this company, the company's own currency first. */
  async listActiveCurrencies(): Promise<string[]> {
    this.ensurePermission("finance.read");
    const db = await getDb();
    const base = await this.baseCurrency(db);
    const [inv, exp, pay] = await Promise.all(
      ["finance_invoices", "finance_expenses", "finance_payments"].map((c) => db.collection(c).distinct("currency", { companyId: this.companyId }))
    );
    const all = new Set<string>([base, ...[...inv, ...exp, ...pay].map((c) => (typeof c === "string" && c ? c : "TND"))]);
    return [base, ...[...all].filter((c) => c !== base).sort()];
  }

  private async baseCurrency(db: Awaited<ReturnType<typeof getDb>>): Promise<string> {
    const company = await db.collection("companies").findOne({ _id: this.companyId }, { projection: { currency: 1 } });
    const c = typeof company?.currency === "string" ? company.currency.toUpperCase() : "";
    return /^[A-Z]{3}$/.test(c) ? c : "TND";
  }

  /**
   * Dashboard figures for ONE currency: amounts in different currencies are never added together.
   * Defaults to the company's currency. All sums are done in whole cents.
   */
  /**
   * One audit event per finance write: who did what to which record, with a few safe facts (amounts,
   * statuses; never document text). Written after the change; a failure is logged and never undoes it.
   */
  private async audit(action: string, entityType: string, entityId: string, userId: string, metadata?: Record<string, string | number | boolean>) {
    try {
      const db = await getDb();
      await recordAudit(db, {
        companyId: this.companyId,
        actorUserId: ObjectId.isValid(userId) ? new ObjectId(userId) : new ObjectId("000000000000000000000000"),
        action: `finance.${action}`,
        entityType,
        entityId,
        requestId: randomUUID(),
        metadata,
      });
    } catch (error) {
      console.error(`[finance.audit] ${action} not recorded`, error instanceof Error ? error.name : "unknown");
    }
  }

  async getDashboard(requestedCurrency?: string) {
    this.ensurePermission("finance.read");
    const db = await getDb();
    const currency = requestedCurrency && /^[A-Z]{3}$/.test(requestedCurrency) ? requestedCurrency : await this.baseCurrency(db);
    // Documents written before currency was stored count as TND.
    const cur = currency === "TND" ? { $in: ["TND", null] } : currency;
    // The company calendar day (Africa/Tunis), the same one the AI tools use for "overdue".
    const todayStr = todayTunis();
    // The last six calendar months, oldest first.
    const now = new Date();
    const months = Array.from({ length: 6 }, (_, k) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - k), 1);
      return { monthKey: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: d.toLocaleString("en-US", { month: "short", year: "numeric" }) };
    });
    const firstMonthKey = months[0].monthKey;

    const [invoiceAgg, expenseAgg, overdueAgg, overdueList, monthlyPayments, monthlyExpenses] = await Promise.all([
      db.collection("finance_invoices").aggregate([
        // Only invoices that are official and not cancelled count: drafts are not yet receivable, voided ones never were.
        { $match: { companyId: this.companyId, currency: cur, status: { $in: ["posted", "partially_paid", "paid"] } } },
        {
          $group: {
            _id: null,
            totalInvoicedCents: { $sum: { $round: [{ $multiply: [{ $ifNull: ["$total", 0] }, 100] }, 0] } },
            totalPaidCents: { $sum: { $round: [{ $multiply: [{ $ifNull: ["$amountPaid", 0] }, 100] }, 0] } },
            outstandingCents: { $sum: { $round: [{ $multiply: [{ $ifNull: ["$balance", 0] }, 100] }, 0] } },
          },
        },
      ]).toArray(),
      db.collection("finance_expenses").aggregate([
        { $match: { companyId: this.companyId } },
        {
          // Workflow counts cover every currency (they are a to-do list); amounts only this currency.
          $group: {
            _id: "$status",
            count: { $sum: 1 },
            amountCents: {
              $sum: {
                $cond: [
                  { $eq: [{ $ifNull: ["$currency", "TND"] }, currency] },
                  { $round: [{ $multiply: [{ $ifNull: ["$total", 0] }, 100] }, 0] },
                  0,
                ],
              },
            },
          },
        },
      ]).toArray(),
      db.collection("finance_invoices").aggregate([
        { $match: { companyId: this.companyId, currency: cur, status: { $in: ["posted", "partially_paid"] }, dueDate: { $lt: todayStr } } },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            totalOverdueCents: { $sum: { $round: [{ $multiply: [{ $ifNull: ["$balance", 0] }, 100] }, 0] } },
          },
        },
      ]).toArray(),
      db.collection("finance_invoices").aggregate([
        { $match: { companyId: this.companyId, currency: cur, status: { $in: ["posted", "partially_paid"] }, dueDate: { $lt: todayStr } } },
        { $sort: { dueDate: 1 } },
        { $limit: 5 },
        {
          $lookup: {
            from: "finance_customers",
            let: { cid: "$customerId" },
            pipeline: [{ $match: { $expr: { $and: [{ $eq: ["$_id", "$$cid"] }, { $eq: ["$companyId", this.companyId] }] } } }, { $project: { name: 1 } }],
            as: "customer",
          },
        },
        { $unwind: { path: "$customer", preserveNullAndEmptyArrays: true } },
      ]).toArray(),
      db.collection("finance_payments")
        .find({ companyId: this.companyId, currency: cur, paymentDate: { $gte: firstMonthKey } }, { projection: { paymentDate: 1, amount: 1 } })
        .toArray(),
      db.collection("finance_expenses")
        .find({ companyId: this.companyId, currency: cur, status: { $in: ["approved", "paid"] }, expenseDate: { $gte: firstMonthKey } }, { projection: { expenseDate: 1, total: 1 } })
        .toArray(),
    ]);

    const inv = invoiceAgg[0] ?? { totalInvoicedCents: 0, totalPaidCents: 0, outstandingCents: 0 };
    const expensesCount: Record<string, number> = {};
    const expensesCents: Record<string, number> = {};
    for (const e of expenseAgg) {
      expensesCount[String(e._id)] = e.count || 0;
      expensesCents[String(e._id)] = e.amountCents || 0;
    }
    const overdueData = overdueAgg[0] ?? { count: 0, totalOverdueCents: 0 };

    const monthlySummary = months.map(({ monthKey, label }) => {
      const incomeCents = monthlyPayments
        .filter((p) => typeof p.paymentDate === "string" && p.paymentDate.startsWith(monthKey))
        .reduce((acc, p) => acc + toCents(Number(p.amount) || 0), 0);
      const expenseCents = monthlyExpenses
        .filter((e) => typeof e.expenseDate === "string" && e.expenseDate.startsWith(monthKey))
        .reduce((acc, e) => acc + toCents(Number(e.total) || 0), 0);
      return { monthKey, label, income: fromCents(incomeCents), expenses: fromCents(expenseCents), net: fromCents(incomeCents - expenseCents) };
    });

    const totalExpensesPaidCents = expensesCents.paid || 0;

    return {
      totalInvoiced: fromCents(inv.totalInvoicedCents || 0),
      totalPaid: fromCents(inv.totalPaidCents || 0),
      outstanding: fromCents(inv.outstandingCents || 0),
      overdue: fromCents(overdueData.totalOverdueCents || 0),
      overdueCount: overdueData.count || 0,
      topOverdueInvoices: overdueList.map((d) => ({
        id: d._id.toString(),
        invoiceNumber: d.invoiceNumber as string,
        customerName: (d.customer?.name as string) || "Direct Customer",
        dueDate: d.dueDate as string,
        balance: d.balance || 0,
        currency: (d.currency as string) || "TND",
      })),
      expensesDraft: expensesCount.draft || 0,
      expensesSubmitted: expensesCount.submitted || 0,
      expensesApproved: expensesCount.approved || 0,
      expensesPaid: expensesCount.paid || 0,
      totalExpensesAmount: fromCents(Object.values(expensesCents).reduce((a, b) => a + b, 0)),
      totalExpensesPaidAmount: fromCents(totalExpensesPaidCents),
      netCashFlow: fromCents((inv.totalPaidCents || 0) - totalExpensesPaidCents),
      monthlySummary,
      currency,
    };
  }

  async listCustomers() {
    this.ensurePermission("finance.read");
    const db = await getDb();
    const docs = await db
      .collection("finance_customers")
      .find({ companyId: this.companyId })
      .sort({ name: 1 })
      .toArray();

    return docs.map((d) => ({
      id: d._id.toString(),
      companyId: d.companyId.toString(),
      name: d.name,
      email: d.email,
      phone: d.phone,
      taxId: d.taxId,
      address: d.address,
      notes: d.notes,
      status: d.status,
      createdAt: d.createdAt?.toISOString?.() || new Date().toISOString(),
      updatedAt: d.updatedAt?.toISOString?.() || new Date().toISOString(),
    }));
  }

  /** Payment behaviour per customer, computed from their invoices and when each was fully paid. */
  async getCustomerInsights(): Promise<Record<string, CustomerInsight>> {
    this.ensurePermission("finance.read");
    const db = await getDb();
    const invoices = await db
      .collection("finance_invoices")
      .find({ companyId: this.companyId, status: { $in: ["posted", "partially_paid", "paid"] } }, { projection: { customerId: 1, status: 1, currency: 1, issueDate: 1, dueDate: 1, total: 1, balance: 1 } })
      .toArray();
    const lastAlloc = await db
      .collection("finance_payment_allocations")
      .aggregate<{ _id: ObjectId; at: Date }>([{ $match: { companyId: this.companyId, reversedAt: { $exists: false } } }, { $group: { _id: "$invoiceId", at: { $max: "$allocatedAt" } } }])
      .toArray();
    const paidAt = new Map(lastAlloc.map((a) => [a._id.toHexString(), a.at]));
    const byCustomer = new Map<string, InvoiceHistory[]>();
    for (const i of invoices) {
      const key = i.customerId?.toString();
      if (!key) continue;
      const at = paidAt.get(i._id.toHexString());
      byCustomer.set(key, [
        ...(byCustomer.get(key) ?? []),
        { status: i.status, currency: i.currency || "TND", issueDate: i.issueDate, dueDate: i.dueDate, total: i.total || 0, balance: i.balance || 0, paidAt: i.status === "paid" && at ? at.toISOString() : undefined },
      ]);
    }
    const today = todayTunis();
    const customers = await db.collection("finance_customers").find({ companyId: this.companyId }, { projection: { _id: 1 } }).toArray();
    return Object.fromEntries(customers.map((c) => [c._id.toHexString(), computeCustomerInsight(byCustomer.get(c._id.toHexString()) ?? [], today)]));
  }

  async getCustomer(customerId: string) {
    this.ensurePermission("finance.read");
    if (!ObjectId.isValid(customerId)) throw new AppError("VALIDATION_ERROR", "Invalid customer ID");
    const db = await getDb();
    const d = await db.collection("finance_customers").findOne({
      _id: new ObjectId(customerId),
      companyId: this.companyId,
    });
    if (!d) throw new AppError("NOT_FOUND", "Customer not found");

    return {
      id: d._id.toString(),
      companyId: d.companyId.toString(),
      name: d.name,
      email: d.email,
      phone: d.phone,
      taxId: d.taxId,
      address: d.address,
      notes: d.notes,
      status: d.status,
      createdAt: d.createdAt?.toISOString?.() || new Date().toISOString(),
      updatedAt: d.updatedAt?.toISOString?.() || new Date().toISOString(),
    };
  }

  async createCustomer(input: { name: string; email?: string; phone?: string; taxId?: string; address?: string; notes?: string; status?: "active" | "inactive" }, userId: string) {
    this.ensurePermission("finance.customer.manage");
    const db = await getDb();
    const now = new Date();

    const doc = {
      companyId: this.companyId,
      name: input.name.trim(),
      email: input.email?.trim() || undefined,
      phone: input.phone?.trim() || undefined,
      taxId: input.taxId?.trim() || undefined,
      address: input.address?.trim() || undefined,
      notes: input.notes?.trim() || undefined,
      status: input.status || "active",
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      updatedBy: userId,
    };

    const result = await db.collection("finance_customers").insertOne(doc);
    const id = result.insertedId.toString();
    await this.audit("customer.created", "finance_customer", id, userId);
    return id;
  }

  async updateCustomer(
    customerId: string,
    input: {
      name?: string;
      email?: string;
      phone?: string;
      taxId?: string;
      address?: string;
      notes?: string;
      status?: "active" | "inactive";
    },
    userId: string
  ) {
    this.ensurePermission("finance.customer.manage");
    if (!ObjectId.isValid(customerId)) throw new AppError("VALIDATION_ERROR", "Invalid customer ID");
    const db = await getDb();
    const now = new Date();

    const updateFields: Record<string, unknown> = {
      updatedAt: now,
      updatedBy: userId,
    };
    if (input.name !== undefined) updateFields.name = input.name.trim();
    if (input.email !== undefined) updateFields.email = input.email?.trim() || undefined;
    if (input.phone !== undefined) updateFields.phone = input.phone?.trim() || undefined;
    if (input.taxId !== undefined) updateFields.taxId = input.taxId?.trim() || undefined;
    if (input.address !== undefined) updateFields.address = input.address?.trim() || undefined;
    if (input.notes !== undefined) updateFields.notes = input.notes?.trim() || undefined;
    if (input.status !== undefined) updateFields.status = input.status;

    const res = await db.collection("finance_customers").updateOne(
      { _id: new ObjectId(customerId), companyId: this.companyId },
      { $set: updateFields }
    );

    if (res.matchedCount === 0) throw new AppError("NOT_FOUND", "Customer not found");
    await this.audit("customer.updated", "finance_customer", customerId, userId);
    return { success: true };
  }

  async deleteCustomer(customerId: string, userId: string) {
    this.ensurePermission("finance.customer.manage");
    if (!ObjectId.isValid(customerId)) throw new AppError("VALIDATION_ERROR", "Invalid customer ID");
    const db = await getDb();

    // Check if customer has any invoices
    const invoiceCount = await db.collection("finance_invoices").countDocuments({
      companyId: this.companyId,
      customerId: new ObjectId(customerId),
    });

    if (invoiceCount > 0) {
      // Customer has historical invoices: soft-deactivate to protect financial integrity
      const now = new Date();
      await db.collection("finance_customers").updateOne(
        { _id: new ObjectId(customerId), companyId: this.companyId },
        { $set: { status: "inactive", updatedAt: now, updatedBy: userId } }
      );
      return {
        success: true,
        deactivated: true,
        message: `Customer is linked to ${invoiceCount} invoice(s) and was deactivated to preserve financial records.`,
      };
    }

    const res = await db.collection("finance_customers").deleteOne({
      _id: new ObjectId(customerId),
      companyId: this.companyId,
    });

    if (res.deletedCount === 0) throw new AppError("NOT_FOUND", "Customer not found");
    await this.audit("customer.deleted", "finance_customer", customerId, userId);
    return { success: true, deactivated: false };
  }

  async listInvoices() {
    this.ensurePermission("finance.read");
    const db = await getDb();
    const docs = await db
      .collection("finance_invoices")
      .find({ companyId: this.companyId })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();
    return this.toInvoiceRows(db, docs);
  }

  /**
   * Invoice list with search (invoice number or customer name), a status filter ("overdue" is computed:
   * posted or partly paid, past due, with a balance) and pages of 25.
   */
  async searchInvoices(opts: { q?: string; status?: string; page?: number }) {
    this.ensurePermission("finance.read");
    const db = await getDb();
    const pageSize = 25;
    const page = Math.max(1, Math.floor(Number(opts.page) || 1));
    const filter: Record<string, unknown> = { companyId: this.companyId };
    const status = opts.status ?? "all";
    if (status === "overdue") Object.assign(filter, { status: { $in: ["posted", "partially_paid"] }, dueDate: { $lt: todayTunis() }, balance: { $gt: 0 } });
    else if (status === "open") Object.assign(filter, { status: { $in: ["posted", "partially_paid"] } });
    else if (["draft", "posted", "partially_paid", "paid", "voided", "credited"].includes(status)) filter.status = status;
    const q = opts.q?.trim().slice(0, 80);
    if (q) {
      const rx = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
      const customers = await db.collection("finance_customers").find({ companyId: this.companyId, name: rx }, { projection: { _id: 1 } }).limit(200).toArray();
      filter.$or = [{ invoiceNumber: rx }, { customerId: { $in: customers.map((c) => c._id) } }];
    }
    const collection = db.collection("finance_invoices");
    const [docs, total] = await Promise.all([
      collection.find(filter).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).toArray(),
      collection.countDocuments(filter),
    ]);
    return { rows: await this.toInvoiceRows(db, docs), total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  private async toInvoiceRows(db: Db, docs: WithId<Document>[]) {
    const today = todayTunis();

    // Collect customer IDs for lookup
    const customerIds = docs
      .map((d) => d.customerId)
      .filter((id) => id && ObjectId.isValid(id));

    const customerMap = new Map<string, { id: string; name: string; email?: string }>();
    if (customerIds.length > 0) {
      const customers = await db
        .collection("finance_customers")
        .find({ _id: { $in: customerIds }, companyId: this.companyId })
        .toArray();
      for (const c of customers) {
        customerMap.set(c._id.toString(), {
          id: c._id.toString(),
          name: c.name,
          email: c.email,
        });
      }
    }

    return docs.map((d) => ({
      id: d._id.toString(),
      companyId: d.companyId.toString(),
      customerId: d.customerId?.toString(),
      customer: d.customerId ? customerMap.get(d.customerId.toString()) : undefined,
      invoiceNumber: d.invoiceNumber,
      status: d.status,
      currency: d.currency,
      issueDate: d.issueDate,
      dueDate: d.dueDate,
      subtotal: d.subtotal || 0,
      taxTotal: d.taxTotal || 0,
      total: d.total || 0,
      amountPaid: d.amountPaid || 0,
      balance: d.balance || 0,
      isOverdue: isInvoiceOverdue(d, today),
      createdAt: d.createdAt?.toISOString?.() || new Date().toISOString(),
    }));
  }

  async listInvoiceableProducts() {
    this.ensurePermission("finance.read");
    const db = await getDb();
    const docs = await db
      .collection("inventory_products")
      .find({ companyId: this.companyId, isActive: true })
      .sort({ name: 1 })
      .limit(200)
      .toArray();

    return docs.map((d) => ({
      id: d._id.toString(),
      name: d.name,
      sku: d.sku,
      unitPrice: d.salePriceMilli ? d.salePriceMilli / 1000 : 0,
      description: d.description || d.name,
    }));
  }

  async createInvoiceDraft(input: {
    customerId: string;
    currency?: string;
    issueDate: string;
    dueDate?: string;
    notes?: string;
    terms?: string;
    lines: Array<{ productId?: string; description: string; quantity: number; unitPrice: number; taxRate?: number }>;
    stampDuty?: boolean;
  }, userId: string) {
    this.ensurePermission("finance.invoice.manage");
    if (!ObjectId.isValid(input.customerId)) throw new AppError("VALIDATION_ERROR", "Invalid customer");

    const db = await getDb();
    const customer = await db.collection("finance_customers").findOne({ _id: new ObjectId(input.customerId), companyId: this.companyId });
    if (!customer) throw new AppError("NOT_FOUND", "Customer not found");

    const lineTotals = computeTotals(input.lines);
    const stampDuty = stampDutyFor(input.currency || "TND", input.stampDuty);
    const totals = { ...lineTotals, total: addAmounts(lineTotals.total, stampDuty) };
    const now = new Date();
    const invoiceNumber = await getNextInvoiceNumber(db, this.companyId);

    const doc = {
      companyId: this.companyId,
      customerId: new ObjectId(input.customerId),
      invoiceNumber,
      status: "draft",
      currency: input.currency || "TND",
      issueDate: input.issueDate,
      dueDate: input.dueDate || undefined,
      notes: input.notes?.trim() || undefined,
      terms: input.terms?.trim() || undefined,
      subtotal: totals.subtotal,
      taxTotal: totals.taxTotal,
      stampDuty,
      total: totals.total,
      amountPaid: 0,
      balance: totals.total,
      lines: input.lines.map((l) => ({
        _id: new ObjectId(),
        productId: l.productId && ObjectId.isValid(l.productId) ? new ObjectId(l.productId) : undefined,
        description: l.description.trim(),
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        taxRate: l.taxRate || 0,
        lineTotal: computeLineTotal(l.quantity, l.unitPrice, l.taxRate),
      })),
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      updatedBy: userId,
    };

    const result = await db.collection("finance_invoices").insertOne(doc);
    const id = result.insertedId.toString();
    await this.audit("invoice.created", "finance_invoice", id, userId, { total: totals.total, currency: input.currency || "TND" });
    return id;
  }

  /** Replaces a draft's header and lines. Posted invoices are immutable: corrections go through void. */
  async updateInvoiceDraft(invoiceId: string, input: {
    customerId: string;
    currency?: string;
    issueDate: string;
    dueDate?: string;
    notes?: string;
    terms?: string;
    lines: Array<{ productId?: string; description: string; quantity: number; unitPrice: number; taxRate?: number }>;
    stampDuty?: boolean;
  }, userId: string) {
    this.ensurePermission("finance.invoice.manage");
    if (!ObjectId.isValid(invoiceId)) throw new AppError("VALIDATION_ERROR", "Invalid invoice");
    if (!ObjectId.isValid(input.customerId)) throw new AppError("VALIDATION_ERROR", "Invalid customer");
    if (!input.lines.length) throw new AppError("VALIDATION_ERROR", "Add at least one line");
    const db = await getDb();
    const customer = await db.collection("finance_customers").findOne({ _id: new ObjectId(input.customerId), companyId: this.companyId });
    if (!customer) throw new AppError("NOT_FOUND", "Customer not found");

    const lineTotals = computeTotals(input.lines);
    const stampDuty = stampDutyFor(input.currency || "TND", input.stampDuty);
    const totals = { ...lineTotals, total: addAmounts(lineTotals.total, stampDuty) };
    const now = new Date();
    const res = await db.collection("finance_invoices").updateOne(
      { _id: new ObjectId(invoiceId), companyId: this.companyId, status: "draft" },
      {
        $set: {
          customerId: new ObjectId(input.customerId),
          currency: input.currency || "TND",
          issueDate: input.issueDate,
          dueDate: input.dueDate || undefined,
          notes: input.notes?.trim() || undefined,
          terms: input.terms?.trim() || undefined,
          subtotal: totals.subtotal,
          taxTotal: totals.taxTotal,
          stampDuty,
          total: totals.total,
          amountPaid: 0,
          balance: totals.total,
          lines: input.lines.map((l) => ({
            _id: new ObjectId(),
            productId: l.productId && ObjectId.isValid(l.productId) ? new ObjectId(l.productId) : undefined,
            description: l.description.trim(),
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            taxRate: l.taxRate || 0,
            lineTotal: computeLineTotal(l.quantity, l.unitPrice, l.taxRate),
          })),
          updatedAt: now,
          updatedBy: userId,
        },
      }
    );
    if (res.matchedCount === 0) {
      const exists = await db.collection("finance_invoices").countDocuments({ _id: new ObjectId(invoiceId), companyId: this.companyId });
      if (!exists) throw new AppError("NOT_FOUND", "Invoice not found");
      throw new AppError("INVALID_TRANSITION", "Only draft invoices can be edited. Void a posted invoice to correct it.");
    }
    await this.audit("invoice.updated", "finance_invoice", invoiceId, userId, { total: totals.total });
    return { success: true };
  }

  /** Deletes a draft. A draft was never sent or paid, so nothing else refers to it. Its number is not reused. */
  async deleteInvoiceDraft(invoiceId: string, userId = "") {
    this.ensurePermission("finance.invoice.manage");
    if (!ObjectId.isValid(invoiceId)) throw new AppError("VALIDATION_ERROR", "Invalid invoice");
    const db = await getDb();
    const res = await db.collection("finance_invoices").deleteOne({ _id: new ObjectId(invoiceId), companyId: this.companyId, status: "draft" });
    if (res.deletedCount === 0) {
      const exists = await db.collection("finance_invoices").countDocuments({ _id: new ObjectId(invoiceId), companyId: this.companyId });
      if (!exists) throw new AppError("NOT_FOUND", "Invoice not found");
      throw new AppError("INVALID_TRANSITION", "Only draft invoices can be deleted. Void a posted invoice instead.");
    }
    await this.audit("invoice.deleted", "finance_invoice", invoiceId, userId);
    return { success: true };
  }

  /** Copies an invoice into a new draft dated today, keeping the same payment period. Any status can be copied. */
  async duplicateInvoice(invoiceId: string, userId: string) {
    this.ensurePermission("finance.invoice.manage");
    const src = await this.getInvoice(invoiceId);
    const today = todayTunis();
    const period = src.dueDate && src.issueDate ? Math.round((Date.parse(src.dueDate) - Date.parse(src.issueDate)) / 86_400_000) : null;
    const dueDate = period !== null && period >= 0 ? new Date(Date.parse(`${today}T00:00:00Z`) + period * 86_400_000).toISOString().slice(0, 10) : undefined;
    return this.createInvoiceDraft(
      {
        customerId: src.customerId as string,
        currency: src.currency,
        issueDate: today,
        dueDate,
        notes: src.notes,
        terms: src.terms,
        stampDuty: src.stampDuty > 0,
        lines: src.lines.map((l: { productId?: string; description: string; quantity: number; unitPrice: number; taxRate: number }) => ({ productId: l.productId, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, taxRate: l.taxRate })),
      },
      userId
    );
  }

  /**
   * Issues a credit note against a posted invoice: it lowers what the customer owes, with its own number and
   * a reason, and is never edited afterwards. A fully credited invoice with nothing paid becomes "credited";
   * with payments it becomes "paid". The update is conditional on the balance it read, so it cannot race.
   */
  async createCreditNote(invoiceId: string, input: { amount: number; reason: string }, userId: string) {
    this.ensurePermission("finance.invoice.post");
    if (!ObjectId.isValid(invoiceId)) throw new AppError("VALIDATION_ERROR", "Invalid invoice");
    const cents = toCents(Number(input.amount) || 0);
    if (cents <= 0) throw new AppError("VALIDATION_ERROR", "The credit amount must be positive.");
    const reason = input.reason?.trim() ?? "";
    if (reason.length < 3) throw new AppError("VALIDATION_ERROR", "Give a reason for the credit note.");
    const db = await getDb();
    const invoices = db.collection("finance_invoices");
    const notes = db.collection("finance_credit_notes");
    const now = new Date();
    const note = await withTransaction(db, async ({ session, onRollback }) => {
      const inv = await invoices.findOne({ _id: new ObjectId(invoiceId), companyId: this.companyId }, { session });
      if (!inv) throw new AppError("NOT_FOUND", "Invoice not found");
      if (inv.status !== "posted" && inv.status !== "partially_paid") throw new AppError("INVALID_TRANSITION", "Credit notes can only be issued on posted invoices with an open balance.");
      if (cents > toCents(inv.balance || 0)) throw new AppError("VALIDATION_ERROR", "The credit cannot be more than the open balance.");
      const newBalanceCents = toCents(inv.balance || 0) - cents;
      const credited = fromCents(toCents((inv.creditedAmount as number) || 0) + cents);
      const status = newBalanceCents > 0 ? inv.status : toCents(inv.amountPaid || 0) > 0 ? "paid" : "credited";
      const res = await invoices.updateOne(
        { _id: inv._id, companyId: this.companyId, balance: inv.balance, status: inv.status },
        { $set: { balance: fromCents(newBalanceCents), creditedAmount: credited, status, updatedAt: now, updatedBy: userId } },
        { session }
      );
      if (res.matchedCount === 0) throw new AppError("CONFLICT", "The invoice changed meanwhile. Try again.");
      onRollback(() => invoices.updateOne({ _id: inv._id }, { $set: { balance: inv.balance, creditedAmount: inv.creditedAmount ?? 0, status: inv.status, updatedAt: inv.updatedAt } }));
      const year = new Date().getFullYear();
      const counter = await db.collection("finance_counters").findOneAndUpdate(
        { companyId: this.companyId, key: `credit_note_${year}` },
        { $inc: { seq: 1 }, $setOnInsert: { companyId: this.companyId, key: `credit_note_${year}`, createdAt: now } },
        { upsert: true, returnDocument: "after", session }
      );
      const number = `CN-${year}-${String((counter?.seq as number) || 1).padStart(5, "0")}`;
      const inserted = await notes.insertOne({ companyId: this.companyId, invoiceId: inv._id, number, amount: fromCents(cents), currency: inv.currency || "TND", reason, createdAt: now, createdBy: userId }, { session });
      onRollback(() => notes.deleteOne({ _id: inserted.insertedId }));
      return { id: inserted.insertedId.toHexString(), number };
    });
    await this.audit("invoice.credit_note", "finance_invoice", invoiceId, userId, { amount: fromCents(cents), number: note.number });
    return note;
  }

  async listCreditNotes(invoiceId: string) {
    this.ensurePermission("finance.read");
    if (!ObjectId.isValid(invoiceId)) return [];
    const db = await getDb();
    const docs = await db.collection("finance_credit_notes").find({ companyId: this.companyId, invoiceId: new ObjectId(invoiceId) }).sort({ createdAt: 1 }).toArray();
    return docs.map((d) => ({ id: d._id.toHexString(), number: d.number as string, amount: d.amount as number, currency: d.currency as string, reason: d.reason as string, createdAt: (d.createdAt as Date).toISOString() }));
  }

  async postInvoice(invoiceId: string, userId: string) {
    this.ensurePermission("finance.invoice.post");
    if (!ObjectId.isValid(invoiceId)) throw new AppError("VALIDATION_ERROR", "Invalid invoice");
    const db = await getDb();
    const now = new Date();

    const res = await db.collection("finance_invoices").updateOne(
      { _id: new ObjectId(invoiceId), companyId: this.companyId, status: "draft" },
      { $set: { status: "posted", postedAt: now, postedBy: userId, updatedAt: now, updatedBy: userId } }
    );

    if (res.matchedCount === 0) throw new AppError("INVALID_TRANSITION", "Invoice cannot be posted");
    await this.audit("invoice.posted", "finance_invoice", invoiceId, userId);
    return { success: true };
  }

  async voidInvoice(invoiceId: string, reason: string, userId: string) {
    this.ensurePermission("finance.invoice.post");
    if (!ObjectId.isValid(invoiceId)) throw new AppError("VALIDATION_ERROR", "Invalid invoice");
    const db = await getDb();
    const now = new Date();

    const res = await db.collection("finance_invoices").updateOne(
      { _id: new ObjectId(invoiceId), companyId: this.companyId, status: { $in: ["draft", "posted", "partially_paid"] } },
      { $set: { status: "voided", voidedAt: now, voidedBy: userId, voidReason: reason.trim(), updatedAt: now, updatedBy: userId } }
    );

    if (res.matchedCount === 0) throw new AppError("INVALID_TRANSITION", "Invoice cannot be voided");
    await this.audit("invoice.voided", "finance_invoice", invoiceId, userId);
    return { success: true };
  }

  async getInvoice(invoiceId: string) {
    this.ensurePermission("finance.read");
    if (!ObjectId.isValid(invoiceId)) throw new AppError("VALIDATION_ERROR", "Invalid invoice ID");
    const db = await getDb();
    const inv = await db.collection("finance_invoices").findOne({
      _id: new ObjectId(invoiceId),
      companyId: this.companyId,
    });
    if (!inv) throw new AppError("NOT_FOUND", "Invoice not found");

    // Fetch Customer
    let customer: { id: string; name: string; email?: string; phone?: string; taxId?: string; address?: string } | null = null;
    if (inv.customerId && ObjectId.isValid(inv.customerId)) {
      const c = await db.collection("finance_customers").findOne({
        _id: new ObjectId(inv.customerId),
        companyId: this.companyId,
      });
      if (c) {
        customer = {
          id: c._id.toString(),
          name: c.name,
          email: c.email,
          phone: c.phone,
          taxId: c.taxId,
          address: c.address,
        };
      }
    }

    // Fetch Company details
    const company = await db.collection("companies").findOne({ _id: this.companyId });

    // Fetch Payments allocated to this invoice
    const allocations = await db
      .collection("finance_payment_allocations")
      .find({ invoiceId: new ObjectId(invoiceId), companyId: this.companyId })
      .toArray();

    return {
      id: inv._id.toString(),
      companyId: inv.companyId.toString(),
      customerId: inv.customerId?.toString(),
      customer,
      company: company
        ? {
            name: company.name,
            address: company.address,
            taxId: company.taxId || company.matriculeFiscale,
            email: company.email,
            phone: company.phone,
          }
        : null,
      invoiceNumber: inv.invoiceNumber,
      status: inv.status,
      currency: inv.currency,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      notes: inv.notes,
      terms: inv.terms,
      subtotal: inv.subtotal || 0,
      taxTotal: inv.taxTotal || 0,
      stampDuty: (inv.stampDuty as number) || 0,
      creditedAmount: (inv.creditedAmount as number) || 0,
      lastSentAt: (inv.lastSentAt as Date | undefined)?.toISOString?.(),
      lastSentTo: inv.lastSentTo as string | undefined,
      total: inv.total || 0,
      amountPaid: inv.amountPaid || 0,
      balance: inv.balance || 0,
      isOverdue: isInvoiceOverdue(inv),
      lines: ((inv.lines || []) as Array<{ _id?: ObjectId; productId?: ObjectId; description: string; quantity: number; unitPrice: number; taxRate?: number; lineTotal: number }>).map((l) => ({
        id: l._id?.toString() || String(Math.random()),
        productId: l.productId?.toString(),
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        taxRate: l.taxRate || 0,
        lineTotal: l.lineTotal,
      })),
      postedAt: inv.postedAt?.toISOString?.(),
      voidedAt: inv.voidedAt?.toISOString?.(),
      voidReason: inv.voidReason,
      createdAt: inv.createdAt?.toISOString?.(),
      allocations: allocations.map((a) => ({
        id: a._id.toString(),
        paymentId: a.paymentId.toString(),
        amount: a.amount,
        reversedAt: (a.reversedAt as Date | undefined)?.toISOString?.(),
        reversalReason: a.reversalReason as string | undefined,
        allocatedAt: a.allocatedAt?.toISOString?.() || new Date().toISOString(),
      })),
    };
  }

  async exportInvoicesCsv() {
    this.ensurePermission("finance.read");
    const invoices = await this.listInvoices();
    const headers = [
      "Invoice Number",
      "Customer",
      "Status",
      "Issue Date",
      "Due Date",
      "Currency",
      "Subtotal",
      "Tax",
      "Total",
      "Amount Paid",
      "Balance",
    ];

    const rows = invoices.map((inv) => [
      `"${inv.invoiceNumber}"`,
      `"${(inv.customer?.name || "Direct Customer").replace(/"/g, '""')}"`,
      `"${inv.status}"`,
      `"${inv.issueDate || ""}"`,
      `"${inv.dueDate || ""}"`,
      `"${inv.currency}"`,
      inv.subtotal.toFixed(2),
      inv.taxTotal.toFixed(2),
      inv.total.toFixed(2),
      inv.amountPaid.toFixed(2),
      inv.balance.toFixed(2),
    ]);

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    return csvContent;
  }

  async listExpenseCategories() {
    this.ensurePermission("finance.read");
    const db = await getDb();
    let categories = await db
      .collection("finance_expense_categories")
      .find({ companyId: this.companyId })
      .sort({ name: 1 })
      .toArray();

    // If no categories yet, seed standard defaults
    if (categories.length === 0) {
      const defaults = [
        "Office & Supplies",
        "Software & Cloud",
        "Travel & Transport",
        "Hardware & Equipment",
        "Marketing & Ads",
        "Utilities & Rent",
        "Meals & Entertainment",
        "Legal & Accounting",
        "Other",
      ];
      const now = new Date();
      const docs = defaults.map((name) => ({
        companyId: this.companyId,
        name,
        active: true,
        createdAt: now,
        updatedAt: now,
      }));
      await db.collection("finance_expense_categories").insertMany(docs);
      categories = await db
        .collection("finance_expense_categories")
        .find({ companyId: this.companyId })
        .sort({ name: 1 })
        .toArray();
    }

    return categories.map((c) => ({
      id: c._id.toString(),
      companyId: c.companyId.toString(),
      name: c.name,
      active: c.active !== false,
      createdAt: c.createdAt?.toISOString?.() || new Date().toISOString(),
    }));
  }

  async createExpenseCategory(name: string) {
    this.ensurePermission("finance.expense.manage");
    const trimmed = name.trim();
    if (!trimmed || trimmed.length < 2) throw new AppError("VALIDATION_ERROR", "Category name is required");
    const db = await getDb();
    const now = new Date();
    const res = await db.collection("finance_expense_categories").insertOne({
      companyId: this.companyId,
      name: trimmed,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    return res.insertedId.toString();
  }

  async listExpenses(statusFilter?: string) {
    this.ensurePermission("finance.read");
    const db = await getDb();
    const query: Record<string, unknown> = { companyId: this.companyId };
    if (statusFilter && statusFilter !== "all") {
      query.status = statusFilter;
    }
    const docs = await db
      .collection("finance_expenses")
      .find(query)
      .sort({ expenseDate: -1 })
      .limit(200)
      .toArray();

    // Collect category IDs
    const categoryIds = docs
      .map((d) => d.categoryId)
      .filter((id) => id && ObjectId.isValid(id));

    const categoryMap = new Map<string, string>();
    if (categoryIds.length > 0) {
      const cats = await db
        .collection("finance_expense_categories")
        .find({ _id: { $in: categoryIds }, companyId: this.companyId })
        .toArray();
      for (const c of cats) {
        categoryMap.set(c._id.toString(), c.name);
      }
    }

    return docs.map((d) => ({
      id: d._id.toString(),
      companyId: d.companyId.toString(),
      categoryId: d.categoryId?.toString(),
      categoryName: d.categoryId ? categoryMap.get(d.categoryId.toString()) : undefined,
      expenseDate: d.expenseDate,
      vendor: d.vendor,
      description: d.description,
      amount: d.amount || 0,
      tax: d.tax || 0,
      total: d.total || 0,
      currency: d.currency || "TND",
      status: d.status,
      createdBy: d.createdBy as string | undefined,
      submittedBy: d.submittedBy as string | undefined,
      receiptDocumentId: d.receiptDocumentId?.toString(),
      notes: d.notes,
      rejectionReason: d.rejectionReason,
      createdAt: d.createdAt?.toISOString?.() || new Date().toISOString(),
    }));
  }

  async exportExpensesCsv() {
    this.ensurePermission("finance.read");
    const expenses = await this.listExpenses();
    const headers = ["Date", "Vendor", "Category", "Description", "Status", "Currency", "Amount", "Tax", "Total"];
    const rows = expenses.map((e) => [
      `"${e.expenseDate || ""}"`,
      `"${(e.vendor || "N/A").replace(/"/g, '""')}"`,
      `"${(e.categoryName || "Uncategorized").replace(/"/g, '""')}"`,
      `"${(e.description || "").replace(/"/g, '""')}"`,
      `"${e.status}"`,
      `"${e.currency}"`,
      (e.amount || 0).toFixed(2),
      (e.tax || 0).toFixed(2),
      (e.total || 0).toFixed(2),
    ]);
    return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  }

  async createExpense(input: { expenseDate: string; categoryId?: string; vendor?: string; description: string; amount: number; tax?: number; currency?: string; notes?: string; receiptDocumentId?: string }, userId: string) {
    this.ensurePermission("finance.expense.manage");
    const db = await getDb();
    const now = new Date();
    const amount = Number(input.amount) || 0;
    const tax = Number(input.tax) || 0;
    const total = addAmounts(amount, tax);

    const doc = {
      companyId: this.companyId,
      categoryId: input.categoryId && ObjectId.isValid(input.categoryId) ? new ObjectId(input.categoryId) : undefined,
      expenseDate: input.expenseDate,
      vendor: input.vendor?.trim() || undefined,
      description: input.description.trim(),
      amount,
      tax,
      total,
      currency: input.currency || "TND",
      status: "draft",
      receiptDocumentId: input.receiptDocumentId && ObjectId.isValid(input.receiptDocumentId) ? new ObjectId(input.receiptDocumentId) : undefined,
      notes: input.notes?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      updatedBy: userId,
    };

    const result = await db.collection("finance_expenses").insertOne(doc);
    const id = result.insertedId.toString();
    await this.audit("expense.created", "finance_expense", id, userId, { total, currency: doc.currency });
    return id;
  }

  async getExpense(expenseId: string) {
    this.ensurePermission("finance.read");
    if (!ObjectId.isValid(expenseId)) throw new AppError("VALIDATION_ERROR", "Invalid expense");
    const db = await getDb();
    const d = await db.collection("finance_expenses").findOne({ _id: new ObjectId(expenseId), companyId: this.companyId });
    if (!d) throw new AppError("NOT_FOUND", "Expense not found");
    return {
      id: d._id.toString(),
      categoryId: d.categoryId?.toString() as string | undefined,
      expenseDate: d.expenseDate as string,
      vendor: d.vendor as string | undefined,
      description: d.description as string,
      amount: (d.amount as number) || 0,
      tax: (d.tax as number) || 0,
      total: (d.total as number) || 0,
      currency: (d.currency as string) || "TND",
      status: d.status as string,
      notes: d.notes as string | undefined,
      rejectionReason: d.rejectionReason as string | undefined,
      receiptDocumentId: d.receiptDocumentId?.toString() as string | undefined,
    };
  }

  /**
   * Edits a draft or rejected expense. Editing a rejected one puts it back to draft so it can be
   * fixed and submitted again; submitted, approved and paid expenses are locked.
   */
  async updateExpense(expenseId: string, input: { expenseDate: string; categoryId?: string; vendor?: string; description: string; amount: number; tax?: number; currency?: string; notes?: string }, userId: string) {
    this.ensurePermission("finance.expense.manage");
    if (!ObjectId.isValid(expenseId)) throw new AppError("VALIDATION_ERROR", "Invalid expense");
    const amount = Number(input.amount) || 0;
    if (amount <= 0) throw new AppError("VALIDATION_ERROR", "Amount must be positive");
    const tax = Number(input.tax) || 0;
    const db = await getDb();
    let categoryId: ObjectId | undefined;
    if (input.categoryId && ObjectId.isValid(input.categoryId)) {
      const cat = await db.collection("finance_expense_categories").findOne({ _id: new ObjectId(input.categoryId), companyId: this.companyId });
      if (!cat) throw new AppError("NOT_FOUND", "Category not found");
      categoryId = cat._id;
    }
    const now = new Date();
    const res = await db.collection("finance_expenses").updateOne(
      { _id: new ObjectId(expenseId), companyId: this.companyId, status: { $in: ["draft", "rejected"] } },
      {
        $set: {
          categoryId,
          expenseDate: input.expenseDate,
          vendor: input.vendor?.trim() || undefined,
          description: input.description.trim(),
          amount,
          tax,
          total: addAmounts(amount, tax),
          currency: input.currency || "TND",
          notes: input.notes?.trim() || undefined,
          status: "draft",
          updatedAt: now,
          updatedBy: userId,
        },
        $unset: { rejectedAt: "", rejectedBy: "", rejectionReason: "", submittedAt: "", submittedBy: "" },
      }
    );
    if (res.matchedCount === 0) {
      const exists = await db.collection("finance_expenses").countDocuments({ _id: new ObjectId(expenseId), companyId: this.companyId });
      if (!exists) throw new AppError("NOT_FOUND", "Expense not found");
      throw new AppError("INVALID_TRANSITION", "Only draft or rejected expenses can be edited.");
    }
    await this.audit("expense.updated", "finance_expense", expenseId, userId, { amount, tax });
    return { success: true };
  }

  async deleteExpense(expenseId: string, userId = "") {
    this.ensurePermission("finance.expense.manage");
    if (!ObjectId.isValid(expenseId)) throw new AppError("VALIDATION_ERROR", "Invalid expense");
    const db = await getDb();
    const res = await db.collection("finance_expenses").deleteOne({ _id: new ObjectId(expenseId), companyId: this.companyId, status: { $in: ["draft", "rejected"] } });
    if (res.deletedCount === 0) {
      const exists = await db.collection("finance_expenses").countDocuments({ _id: new ObjectId(expenseId), companyId: this.companyId });
      if (!exists) throw new AppError("NOT_FOUND", "Expense not found");
      throw new AppError("INVALID_TRANSITION", "Only draft or rejected expenses can be deleted.");
    }
    // A receipt applied to this expense becomes available again.
    await db.collection("finance_receipt_extractions").updateMany(
      { companyId: this.companyId, appliedToExpenseId: new ObjectId(expenseId) },
      { $unset: { appliedToExpenseId: "" }, $set: { updatedAt: new Date() } }
    );
    await this.audit("expense.deleted", "finance_expense", expenseId, userId);
    return { success: true };
  }

  async submitExpense(expenseId: string, userId: string) {
    this.ensurePermission("finance.expense.manage");
    if (!ObjectId.isValid(expenseId)) throw new AppError("VALIDATION_ERROR", "Invalid expense");
    const db = await getDb();
    const now = new Date();
    const res = await db.collection("finance_expenses").updateOne(
      { _id: new ObjectId(expenseId), companyId: this.companyId, status: "draft" },
      { $set: { status: "submitted", submittedAt: now, submittedBy: userId, updatedAt: now, updatedBy: userId } }
    );
    if (res.matchedCount === 0) throw new AppError("INVALID_TRANSITION", "Expense cannot be submitted");
    await this.audit("expense.submitted", "finance_expense", expenseId, userId);
    return { success: true };
  }

  /**
   * Separation of duties: nobody approves an expense they created or submitted. The company owner is the one
   * exception, so a company with a single owner is never locked out of approving its own spending.
   */
  isSelfApproval(expense: { createdBy?: string; submittedBy?: string }, userId: string): boolean {
    return this.companyRole !== "owner" && (expense.createdBy === userId || expense.submittedBy === userId);
  }

  async approveExpense(expenseId: string, userId: string) {
    this.ensurePermission("finance.expense.approve");
    if (!ObjectId.isValid(expenseId)) throw new AppError("VALIDATION_ERROR", "Invalid expense");
    const db = await getDb();
    const now = new Date();
    const filter: Record<string, unknown> = { _id: new ObjectId(expenseId), companyId: this.companyId, status: "submitted" };
    // Enforced in the same atomic update that changes the status.
    if (this.companyRole !== "owner") {
      filter.createdBy = { $ne: userId };
      filter.submittedBy = { $ne: userId };
    }
    const res = await db.collection("finance_expenses").updateOne(filter, {
      $set: { status: "approved", approvedAt: now, approvedBy: userId, updatedAt: now, updatedBy: userId },
    });
    if (res.matchedCount === 0) {
      const e = await db.collection("finance_expenses").findOne({ _id: new ObjectId(expenseId), companyId: this.companyId, status: "submitted" });
      if (e && this.isSelfApproval(e as { createdBy?: string; submittedBy?: string }, userId)) throw new AppError("FORBIDDEN", "You cannot approve an expense you created or submitted. Ask another approver.");
      throw new AppError("INVALID_TRANSITION", "Expense cannot be approved");
    }
    await this.audit("expense.approved", "finance_expense", expenseId, userId);
    return { success: true };
  }

  async rejectExpense(expenseId: string, reason: string, userId: string) {
    this.ensurePermission("finance.expense.approve");
    if (!ObjectId.isValid(expenseId)) throw new AppError("VALIDATION_ERROR", "Invalid expense");
    const db = await getDb();
    const now = new Date();
    const res = await db.collection("finance_expenses").updateOne(
      { _id: new ObjectId(expenseId), companyId: this.companyId, status: "submitted" },
      { $set: { status: "rejected", rejectedAt: now, rejectedBy: userId, rejectionReason: reason.trim(), updatedAt: now, updatedBy: userId } }
    );
    if (res.matchedCount === 0) throw new AppError("INVALID_TRANSITION", "Expense cannot be rejected");
    await this.audit("expense.rejected", "finance_expense", expenseId, userId);
    return { success: true };
  }

  async markExpensePaid(expenseId: string, userId: string) {
    this.ensurePermission("finance.expense.pay");
    if (!ObjectId.isValid(expenseId)) throw new AppError("VALIDATION_ERROR", "Invalid expense");
    const db = await getDb();
    const now = new Date();
    const res = await db.collection("finance_expenses").updateOne(
      { _id: new ObjectId(expenseId), companyId: this.companyId, status: "approved" },
      { $set: { status: "paid", paidAt: now, paidBy: userId, updatedAt: now, updatedBy: userId } }
    );
    if (res.matchedCount === 0) throw new AppError("INVALID_TRANSITION", "Expense cannot be marked paid");
    await this.audit("expense.paid", "finance_expense", expenseId, userId);
    return { success: true };
  }

  async listPayments() {
    this.ensurePermission("finance.read");
    const db = await getDb();
    const docs = await db.collection("finance_payments").find({ companyId: this.companyId }).sort({ paymentDate: -1 }).limit(100).toArray();
    return docs.map((d) => ({
      id: d._id.toString(),
      companyId: d.companyId.toString(),
      paymentDate: d.paymentDate,
      amount: d.amount || 0,
      currency: d.currency,
      method: d.method,
      reference: d.reference,
      notes: d.notes as string | undefined,
      unallocatedAmount: d.unallocatedAmount || 0,
      createdAt: d.createdAt?.toISOString?.() || new Date().toISOString(),
    }));
  }

  async recordPayment(input: { paymentDate: string; amount: number; currency?: string; method?: string; reference?: string; notes?: string }, userId: string) {
    this.ensurePermission("finance.payment.allocate");
    const amount = Number(input.amount) || 0;
    if (amount <= 0) throw new AppError("VALIDATION_ERROR", "Amount must be positive");

    const db = await getDb();
    const now = new Date();
    const doc = {
      companyId: this.companyId,
      paymentDate: input.paymentDate,
      amount,
      currency: input.currency || "TND",
      method: input.method || "bank_transfer",
      reference: input.reference?.trim() || undefined,
      notes: input.notes?.trim() || undefined,
      unallocatedAmount: amount,
      receivedBy: userId,
      createdAt: now,
      updatedAt: now,
    };

    const result = await db.collection("finance_payments").insertOne(doc);
    const id = result.insertedId.toString();
    await this.audit("payment.recorded", "finance_payment", id, userId, { amount, currency: doc.currency });
    return id;
  }

  async allocatePayment(paymentId: string, allocations: Array<{ invoiceId: string; amount: number }>, userId: string) {
    this.ensurePermission("finance.payment.allocate");
    if (!ObjectId.isValid(paymentId)) throw new AppError("VALIDATION_ERROR", "Invalid payment");

    // Money is compared in whole cents: summing floats leaves residue (0.3 - 0.1 is not 0.2) that
    // would reject a legitimate allocation or leave a fraction of a cent on a balance.
    if (new Set(allocations.map((a) => a.invoiceId)).size !== allocations.length) throw new AppError("VALIDATION_ERROR", "Each invoice can appear only once");
    let totalAllocCents = 0;
    for (const a of allocations) {
      if (!ObjectId.isValid(a.invoiceId)) throw new AppError("VALIDATION_ERROR", "Invalid invoice");
      totalAllocCents += toCents(Number(a.amount) || 0);
    }
    if (totalAllocCents <= 0) throw new AppError("VALIDATION_ERROR", "Allocation amount must be positive");

    const db = await getDb();
    const now = new Date();
    const payments = db.collection("finance_payments");
    const invoices = db.collection("finance_invoices");
    const allocs = db.collection("finance_payment_allocations");
    const paymentOid = new ObjectId(paymentId);

    // One unit of work. Every update is conditional on the value it was computed from, so two
    // allocations racing on the same payment or invoice cannot both succeed: the loser matches
    // nothing and the whole operation rolls back (a real transaction on a replica set, undo steps otherwise).
    await withTransaction(db, async ({ session, onRollback }) => {
      const payment = await payments.findOne({ _id: paymentOid, companyId: this.companyId }, { session });
      if (!payment) throw new AppError("NOT_FOUND", "Payment not found");
      if (totalAllocCents > toCents(payment.unallocatedAmount || 0)) throw new AppError("VALIDATION_ERROR", "Allocation exceeds unallocated amount");

      const targets = [];
      for (const a of allocations) {
        const inv = await invoices.findOne({ _id: new ObjectId(a.invoiceId), companyId: this.companyId }, { session });
        if (!inv) throw new AppError("NOT_FOUND", "Invoice not found");
        // Only posted invoices are collectable, and money is never converted between currencies.
        if (inv.status !== "posted" && inv.status !== "partially_paid") throw new AppError("INVALID_TRANSITION", "Payments can only be applied to posted invoices");
        if ((inv.currency || "TND") !== (payment.currency || "TND")) throw new AppError("VALIDATION_ERROR", "Payment and invoice currencies differ");
        if (toCents(inv.balance || 0) < toCents(Number(a.amount) || 0)) throw new AppError("VALIDATION_ERROR", "Allocation exceeds invoice balance");
        targets.push({ inv, cents: toCents(Number(a.amount)) });
      }

      const paymentSet = await payments.updateOne(
        { _id: paymentOid, companyId: this.companyId, unallocatedAmount: payment.unallocatedAmount },
        { $set: { unallocatedAmount: fromCents(toCents(payment.unallocatedAmount || 0) - totalAllocCents), updatedAt: now } },
        { session }
      );
      if (paymentSet.matchedCount === 0) throw new AppError("CONFLICT", "The payment changed while allocating. Try again.");
      onRollback(() => payments.updateOne({ _id: paymentOid }, { $set: { unallocatedAmount: payment.unallocatedAmount, updatedAt: payment.updatedAt } }));

      for (const { inv, cents } of targets) {
        const newPaidCents = toCents(inv.amountPaid || 0) + cents;
        // From the current balance, not total - paid: credit notes have already lowered it.
        const newBalanceCents = toCents(inv.balance || 0) - cents;
        const newStatus = newBalanceCents <= 0 ? "paid" : "partially_paid";
        const invoiceSet = await invoices.updateOne(
          { _id: inv._id, companyId: this.companyId, balance: inv.balance, status: inv.status },
          { $set: { amountPaid: fromCents(newPaidCents), balance: fromCents(newBalanceCents), status: newStatus, updatedAt: now, updatedBy: userId } },
          { session }
        );
        if (invoiceSet.matchedCount === 0) throw new AppError("CONFLICT", "An invoice changed while allocating. Try again.");
        onRollback(() => invoices.updateOne({ _id: inv._id }, { $set: { amountPaid: inv.amountPaid, balance: inv.balance, status: inv.status, updatedAt: inv.updatedAt, updatedBy: inv.updatedBy } }));

        const inserted = await allocs.insertOne(
          { companyId: this.companyId, paymentId: paymentOid, invoiceId: inv._id, amount: fromCents(cents), allocatedAt: now, allocatedBy: userId },
          { session }
        );
        onRollback(() => allocs.deleteOne({ _id: inserted.insertedId }));
      }
    });

    await this.audit("payment.allocated", "finance_payment", paymentId, userId, { amount: fromCents(totalAllocCents), invoices: allocations.length });
    return { success: true };
  }

  /**
   * Undoes one allocation (a payment applied to the wrong invoice): the amount goes back to the payment's
   * unallocated balance and the invoice's balance, its status is worked out again, and the allocation is kept
   * as reversed (never deleted) with who did it and why. All of it in one unit of work.
   */
  async reverseAllocation(allocationId: string, reason: string, userId: string) {
    this.ensurePermission("finance.payment.allocate");
    if (!ObjectId.isValid(allocationId)) throw new AppError("VALIDATION_ERROR", "Invalid allocation");
    if ((reason ?? "").trim().length < 3) throw new AppError("VALIDATION_ERROR", "Give a reason for the reversal.");
    const db = await getDb();
    const allocs = db.collection("finance_payment_allocations");
    const payments = db.collection("finance_payments");
    const invoices = db.collection("finance_invoices");
    const now = new Date();
    await withTransaction(db, async ({ session, onRollback }) => {
      const alloc = await allocs.findOne({ _id: new ObjectId(allocationId), companyId: this.companyId }, { session });
      if (!alloc) throw new AppError("NOT_FOUND", "Allocation not found");
      if (alloc.reversedAt) throw new AppError("INVALID_TRANSITION", "This allocation was already reversed.");
      const cents = toCents(alloc.amount);
      const marked = await allocs.updateOne({ _id: alloc._id, reversedAt: { $exists: false } }, { $set: { reversedAt: now, reversedBy: userId, reversalReason: reason.trim().slice(0, 300) } }, { session });
      if (marked.matchedCount === 0) throw new AppError("CONFLICT", "This allocation changed meanwhile. Try again.");
      onRollback(() => allocs.updateOne({ _id: alloc._id }, { $unset: { reversedAt: "", reversedBy: "", reversalReason: "" } }));

      const pay = await payments.findOne({ _id: alloc.paymentId, companyId: this.companyId }, { session });
      const inv = await invoices.findOne({ _id: alloc.invoiceId, companyId: this.companyId }, { session });
      if (!pay || !inv) throw new AppError("NOT_FOUND", "The payment or invoice no longer exists.");
      if (inv.status === "voided") throw new AppError("INVALID_TRANSITION", "The invoice is voided.");

      const p = await payments.updateOne(
        { _id: pay._id, unallocatedAmount: pay.unallocatedAmount },
        { $set: { unallocatedAmount: fromCents(toCents(pay.unallocatedAmount || 0) + cents), updatedAt: now } },
        { session }
      );
      if (p.matchedCount === 0) throw new AppError("CONFLICT", "The payment changed meanwhile. Try again.");
      onRollback(() => payments.updateOne({ _id: pay._id }, { $set: { unallocatedAmount: pay.unallocatedAmount } }));

      const paidCents = Math.max(0, toCents(inv.amountPaid || 0) - cents);
      const balanceCents = toCents(inv.balance || 0) + cents;
      const status = balanceCents <= 0 ? inv.status : paidCents > 0 ? "partially_paid" : "posted";
      const i = await invoices.updateOne(
        { _id: inv._id, balance: inv.balance, status: inv.status },
        { $set: { amountPaid: fromCents(paidCents), balance: fromCents(balanceCents), status, updatedAt: now, updatedBy: userId } },
        { session }
      );
      if (i.matchedCount === 0) throw new AppError("CONFLICT", "The invoice changed meanwhile. Try again.");
      onRollback(() => invoices.updateOne({ _id: inv._id }, { $set: { amountPaid: inv.amountPaid, balance: inv.balance, status: inv.status } }));
    });
    await this.audit("payment.allocation_reversed", "finance_payment_allocation", allocationId, userId);
    return { success: true };
  }

  async listUnpaidInvoices() {
    this.ensurePermission("finance.read");
    const db = await getDb();
    const docs = await db
      .collection("finance_invoices")
      .find({
        companyId: this.companyId,
        status: { $in: ["posted", "partially_paid"] },
        balance: { $gt: 0 },
      })
      .sort({ dueDate: 1, createdAt: 1 })
      .toArray();

    const customerIds = docs.map((d) => d.customerId).filter((id) => id && ObjectId.isValid(id));
    const customerMap = new Map<string, string>();
    if (customerIds.length > 0) {
      const customers = await db.collection("finance_customers").find({ _id: { $in: customerIds }, companyId: this.companyId }).toArray();
      for (const c of customers) customerMap.set(c._id.toString(), c.name);
    }

    return docs.map((d) => ({
      id: d._id.toString(),
      invoiceNumber: d.invoiceNumber,
      customerId: d.customerId?.toString(),
      customerName: (d.customerId ? customerMap.get(d.customerId.toString()) : undefined) ?? "Direct Customer",
      total: d.total || 0,
      amountPaid: d.amountPaid || 0,
      balance: d.balance || 0,
      currency: d.currency || "TND",
      dueDate: d.dueDate,
      isOverdue: isInvoiceOverdue(d),
    }));
  }

  async exportPaymentsCsv() {
    this.ensurePermission("finance.read");
    const payments = await this.listPayments();
    const headers = ["Payment Date", "Method", "Reference", "Currency", "Amount", "Unallocated Amount"];
    const rows = payments.map((p) => [
      `"${p.paymentDate || ""}"`,
      `"${p.method || ""}"`,
      `"${(p.reference || "").replace(/"/g, '""')}"`,
      `"${p.currency}"`,
      (p.amount || 0).toFixed(2),
      (p.unallocatedAmount || 0).toFixed(2),
    ]);
    return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  }

  async listReceiptExtractions() {
    this.ensurePermission("finance.read");
    const db = await getDb();
    const docs = await db.collection("finance_receipt_extractions").aggregate([
      { $match: { companyId: this.companyId } },
      { $sort: { createdAt: -1 } },
      { $limit: 50 },
      {
        $lookup: {
          from: "finance_receipt_documents",
          let: { rid: "$receiptDocumentId" },
          pipeline: [{ $match: { $expr: { $and: [{ $eq: ["$_id", "$$rid"] }, { $eq: ["$companyId", this.companyId] }] } } }],
          as: "doc",
        },
      },
      { $unwind: { path: "$doc", preserveNullAndEmptyArrays: true } },
    ]).toArray();

    return docs.map((d) => ({
      id: d._id.toString(),
      receiptDocumentId: d.receiptDocumentId?.toString() || "",
      // Older scans stored only metadata; only documents with a stored file can be previewed.
      hasFile: !!d.doc?.fileId,
      originalName: d.doc?.originalName || (d.receiptDocumentId ? "Receipt file" : "Pasted text"),
      mimeType: d.doc?.mimeType || "text/plain",
      size: d.doc?.size || 0,
      source: (d.source as string) || "upload",
      proposed: d.proposed || {},
      warnings: (d.warnings as Array<{ code: string; message: string }>) || [],
      appliedToExpenseId: d.appliedToExpenseId?.toString() as string | undefined,
      possibleDuplicateExpenseId: d.possibleDuplicateExpenseId?.toString() as string | undefined,
      provider: d.provider as string | undefined,
      reviewed: !!d.reviewed,
      createdAt: d.createdAt?.toISOString?.() || new Date().toISOString(),
    }));
  }

  /** Stores a receipt file for this company (deduplicated by content hash). */
  async storeReceiptFile(input: { bytes: Uint8Array; originalName: string; source: ReceiptSource }, userId: string) {
    this.ensurePermission("finance.receipt.ocr");
    const db = await getDb();
    return putReceiptFile(db, { companyId: this.companyId, userId, ...input });
  }

  /** The stored file, for viewing. Null when it is not this company's file. */
  async getReceiptFile(documentId: string) {
    this.ensurePermission("finance.read");
    const db = await getDb();
    return readReceiptFile(db, this.companyId, documentId);
  }

  async deleteReceiptExtraction(id: string) {
    this.ensurePermission("finance.receipt.ocr");
    if (!ObjectId.isValid(id)) throw new AppError("VALIDATION_ERROR", "Invalid extraction ID");
    const db = await getDb();
    const ext = await db.collection("finance_receipt_extractions").findOne({
      _id: new ObjectId(id),
      companyId: this.companyId,
    });
    if (!ext) throw new AppError("NOT_FOUND", "Extraction not found");

    if (ext.appliedToExpenseId) throw new AppError("INVALID_TRANSITION", "This receipt is attached to an expense. Delete the expense first.");
    if (ext.receiptDocumentId) {
      // The file is removed only when no other scan still refers to it.
      const others = await db.collection("finance_receipt_extractions").countDocuments({
        companyId: this.companyId,
        receiptDocumentId: ext.receiptDocumentId,
        _id: { $ne: ext._id },
      });
      const usedByExpense = await db.collection("finance_expenses").countDocuments({ companyId: this.companyId, receiptDocumentId: ext.receiptDocumentId });
      if (!others && !usedByExpense) await deleteReceiptFile(db, this.companyId, ext.receiptDocumentId.toHexString());
    }

    await db.collection("finance_receipt_extractions").deleteOne({
      _id: new ObjectId(id),
      companyId: this.companyId,
    });

    return { success: true };
  }

  async markReceiptReviewed(id: string) {
    this.ensurePermission("finance.receipt.ocr");
    if (!ObjectId.isValid(id)) throw new AppError("VALIDATION_ERROR", "Invalid extraction ID");
    const db = await getDb();
    await db.collection("finance_receipt_extractions").updateOne(
      { _id: new ObjectId(id), companyId: this.companyId },
      { $set: { reviewed: true, updatedAt: new Date() } }
    );
    return { success: true };
  }
}

export async function getFinanceService() {
  // Loaded on demand: only the request-cookie entry point needs the session machinery, so the AI tools can use the class without it.
  const { getActiveTenant } = await import("@/server/tenant/context");
  const tenant = await getActiveTenant();
  if (!tenant) throw new AppError("UNAUTHENTICATED", "No active company");
  // Plan and per-member application access, checked on every call (layouts only guard navigation).
  const [{ auth }, { assertAppAccessFor }, { default: clientPromise }, { ObjectId }] = await Promise.all([
    import("@/server/auth"),
    import("@/server/platform/access"),
    import("@/server/db/client"),
    import("mongodb"),
  ]);
  const session = await auth();
  if (!session?.user?.id) throw new AppError("UNAUTHENTICATED", "Please sign in to continue.");
  await assertAppAccessFor((await clientPromise).db(), new ObjectId(tenant.companyId), new ObjectId(session.user.id), "finance");
  return new FinanceService({
    companyId: tenant.companyId,
    companyRole: tenant.role,
  });
}
