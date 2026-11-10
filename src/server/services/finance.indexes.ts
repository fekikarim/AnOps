import "server-only";
import type { IndexDescription } from "mongodb";

/**
 * Finance indexes. Every finance query filters on companyId first, so every index leads with it.
 * Registered in src/server/db/indexes.ts and created once per connection by ensureIndexes.
 */
export const FINANCE_INDEXES: Record<string, IndexDescription[]> = {
  finance_customers: [{ key: { companyId: 1, name: 1 }, name: "fin_customer_name" }],
  finance_invoices: [
    // Numbers come from a per-company counter; this makes a duplicate impossible rather than unlikely.
    { key: { companyId: 1, invoiceNumber: 1 }, name: "fin_invoice_number_unique", unique: true },
    { key: { companyId: 1, createdAt: -1 }, name: "fin_invoice_created" },
    { key: { companyId: 1, status: 1, dueDate: 1 }, name: "fin_invoice_status_due" },
    { key: { companyId: 1, customerId: 1, status: 1 }, name: "fin_invoice_customer" },
  ],
  finance_payments: [{ key: { companyId: 1, paymentDate: -1 }, name: "fin_payment_date" }],
  finance_payment_allocations: [
    { key: { companyId: 1, invoiceId: 1 }, name: "fin_alloc_invoice" },
    { key: { companyId: 1, paymentId: 1 }, name: "fin_alloc_payment" },
  ],
  finance_expenses: [
    { key: { companyId: 1, expenseDate: -1 }, name: "fin_expense_date" },
    { key: { companyId: 1, status: 1, expenseDate: -1 }, name: "fin_expense_status_date" },
  ],
  finance_expense_categories: [{ key: { companyId: 1, name: 1 }, name: "fin_category_name" }],
  finance_counters: [{ key: { companyId: 1, key: 1 }, name: "fin_counter_unique", unique: true }],
  finance_receipt_extractions: [
    { key: { companyId: 1, createdAt: -1 }, name: "fin_extraction_created" },
    { key: { companyId: 1, receiptDocumentId: 1 }, name: "fin_extraction_document" },
  ],
  // One cached AI dashboard summary per company, currency and day.
  finance_ai_insights: [{ key: { companyId: 1, currency: 1, day: 1 }, name: "fin_ai_insight_day_unique", unique: true }],
  // Staff Telegram receipt capture. One link per member per company; a chat may serve several companies.
  finance_telegram_links: [
    { key: { companyId: 1, userId: 1 }, name: "fin_tg_member_unique", unique: true },
    { key: { chatId: 1, active: 1 }, name: "fin_tg_chat" },
  ],
  finance_telegram_link_tokens: [
    { key: { companyId: 1, userId: 1, consumedAt: 1 }, name: "fin_tg_token_member" },
    { key: { expiresAt: 1 }, name: "fin_tg_token_ttl", expireAfterSeconds: 86_400 },
  ],
  // One stored copy per file per company; the hash is how duplicate uploads are recognised.
  // Partial: documents written before files were stored have no hash.
  finance_receipt_documents: [
    { key: { companyId: 1, sha256: 1 }, name: "fin_receipt_sha_unique", unique: true, partialFilterExpression: { sha256: { $type: "string" } } },
  ],
};
