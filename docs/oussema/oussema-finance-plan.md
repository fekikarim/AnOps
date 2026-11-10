# AnOps — Finance & Invoicing (Module 2): Completion Plan

**Owner:** Oussema Issaoui
**Module:** Finance & Invoicing (`/finance`)
**Goal:** Take the module from "works for a demo" to a production-ready, AI-first finance app: real receipt OCR, AI in every screen, a Finance AI agent, and Telegram receipt capture.

Companion files:
- [oussema-finance-tasks.md](oussema-finance-tasks.md): every task with its ID and status
- [oussema-finance-progress.md](oussema-finance-progress.md): what's done, what's pending, updated after each task

---

## 1. Starting point (audit of 2026-11-07)

Already working:
- Customers: CRUD, with soft-deactivation when the customer has invoices.
- Invoices: draft → posted → partially_paid / paid, void, per-company numbering, CSV export, PDF view.
- Payments: record a payment, split it across invoices, with guards against over-allocation and currency mismatch.
- Expenses: draft → submitted → approved / rejected → paid, separation of duties, default categories.
- Dashboard: KPIs, top overdue invoices, 6-month income vs expenses chart.
- Global AI command center (`/ai`) already has about 22 finance tools (read + confirm-before-write).

Broken or missing:

| # | Problem | Where |
|---|---|---|
| B1 | **OCR never reads images or PDFs.** Only text files and pasted text reach the model; for an image the model just sees the filename. | `receipt-ocr.actions.ts` |
| B2 | The AI layer can't carry images (`AiMessage.content` is a string only). | `src/server/ai/types.ts`, providers |
| B3 | Receipt files are never stored (`storageKey: "pending/..."`), so there's no preview and no audit trail. | `receipt-ocr.actions.ts` |
| B4 | Fake confidence scores (0.92 / 0.65) when the model returns none. | `receipt-ocr.actions.ts` |
| B5 | Payment allocation isn't atomic (no transaction), so a race can overpay an invoice. | `finance.service.ts › allocatePayment` |
| B6 | Draft invoices and expenses can't be edited or deleted. | service + UI |
| B7 | The dashboard adds up all currencies as TND; monthly totals use floating-point sums. | `getDashboard` |
| B8 | The `overdue` status is never set on invoices. | service |
| B9 | One customer lookup skips the company filter (`listUnpaidInvoices`). | service |
| B10 | Heavy use of `any`; no finance database indexes. | service, `src/server/db/indexes.ts` |
| B11 | OCR results are never linked back to the expense they created (`appliedToExpenseId` unused). | OCR + expense create |

---

## 2. Architecture decisions

These are recommended defaults; the ones marked need Oussema's OK.

| Topic | Decision |
|---|---|
| Receipt file storage | **MongoDB GridFS** bucket `finance_receipts`: no new infrastructure, company-scoped metadata, streamed back through an authenticated route. Files up to 10 MB; images and PDFs only. A SHA-256 hash is used to detect duplicates. |
| Vision provider | **Gemini** first (reads images *and* PDFs natively, and `GEMINI_API_KEYS` already exists). Groq's vision model is the fallback for images only. All calls go through the existing AI gate (permissions, limits, token budget). |
| AI layer change | Add an optional `attachments: { mimeType, dataBase64 }[]` to `AiMessage`. Gemini maps it to `inlineData`; Groq and OpenRouter map it to `image_url` parts. Providers that don't support it skip it, and the router only picks providers that can see images. |
| Extraction quality | Strict Zod schema for the result, line items, a confidence score per field, and the original currency. Deterministic checks afterwards (amount + tax ≈ total, date not in the future, known currency). The confidence shown is the model's own score, lowered when a check fails, never invented. |
| Human in the loop | OCR only ever **proposes**. A person reviews and applies it, and the result is always a **draft** expense. |
| Finance AI agent | Reuse the existing orchestrator (tool calling, confirmation cards, audit log, budget) with a **finance-scoped tool set**, shown as a Copilot panel inside `/finance`. No second agent framework. |
| Telegram | Reuse the existing AnOps bot and webhook. **Staff** (not customers) link their AnOps user to the bot with a single-use deep link from Finance settings. A photo or PDF sent by a linked staff member becomes a stored receipt, then OCR, then a draft expense, and the bot replies with a summary and a link. The identity comes from the stored link, never from the message itself. |
| Money | Stay with 2-decimal numbers stored in the database, but do every calculation in whole cents (`toCents` / `fromCents`). Totals are grouped by currency. |
| Consistency | Multi-document writes (allocations, applying receipts) use MongoDB transactions. The replica set is already required by the tests. |

---

## 3. Phases

### Phase 0: Hardening and fixes (foundation)
Fix B5–B10 before building on top: atomic allocation, cents-safe and per-currency dashboard, overdue status, company-scoped lookups, indexes, typed service results, edit and delete for drafts. Add tests for each fix.

### Phase 1: Real receipt OCR
Fix B1–B4 and B11: GridFS storage, an authenticated file route, vision messages in the AI layer, a structured extraction pipeline, honest confidence, duplicate detection, a receipt preview next to the review form, "Apply → draft expense" that keeps the link, and bulk upload.

### Phase 2: AI in every screen
| Screen | AI feature |
|---|---|
| Expenses | Auto-categorize (suggested category with a reason) as you type; anomaly flags (duplicate, unusual amount for this vendor or category, weekend or large spend) |
| Invoices | "Describe the invoice" → draft lines matched to products and customers (reuses the draft engine); AI-written reminder email for overdue invoices |
| Payments | Smart match: suggests which invoices an unallocated payment belongs to (reference, amount, customer); one click to apply |
| Customers | AI customer insight: payment behaviour, average days to pay, risk level (computed by code, explained by the AI) |
| Dashboard | AI insights card: what changed this month, cash-flow forecast for the next 30/60/90 days (deterministic projection plus AI explanation), top risks |
| Receipts | The Phase 1 OCR, plus a "why this category" explanation |

Rule: **numbers come from code, the AI explains.** Every AI feature has a manual fallback and fails without breaking the page.

### Phase 3: Finance AI agent (Copilot)
- A Copilot panel or drawer on every `/finance` page, scoped to finance tools and aware of the current page.
- New tools: `finance_scan_receipt` (attached file), `finance_match_payment`, `finance_cashflow_forecast`, `finance_aging_report`, `finance_draft_reminder`, `finance_update_invoice_draft`, `finance_update_expense`.
- Every write goes through a confirmation card (existing pending-actions flow).
- Suggested prompts ("What's overdue?", "Scan this receipt", "Who owes us the most?").
- An evaluation script for guardrails: tenant isolation, a viewer can't write, no silent writes.

### Phase 4: Telegram receipt capture
- Finance settings: a "Connect my Telegram" card that creates a single-use deep link bound to (user, company), with disconnect.
- The webhook routes messages from linked **staff** chats to a finance handler: photo or document → `getFile` → download (with a size limit) → GridFS → OCR → draft expense → reply with vendor, amount, category and a link.
- Commands: `/receipt` (help), `/company` (switch company if the user belongs to several), `/stop`.
- Safety: rate limit per chat, dedupe on `file_unique_id`, images and PDFs only, permission re-checked (`finance.receipt.ocr` + `finance.expense.manage`) at processing time, audit log.
- Works through the webhook and through the `telegram:poll` script in local development.

### Phase 5: Modern finance features and UX
- Invoices: edit drafts, duplicate, send by email with the PDF attached (nodemailer already exists), credit note instead of void once paid, customer statement.
- Tunisian tax support: VAT rates 19 / 13 / 7 / 0 and the 1 TND timbre fiscal as an option per invoice.
- Lists: search, filters, sorting, pagination (cursor-based) on invoices, expenses and payments.
- Reports: AR aging (0–30 / 31–60 / 61–90 / 90+), expenses by category, profit and loss by month, with CSV/XLSX export (exceljs already exists).
- Payment detail page with its allocations; reverse an allocation (with audit).
- UI polish to match the design system: empty states, loading skeletons, toasts, mobile layouts, keyboard-friendly forms.

### Phase 6: Production readiness
- RBAC review of every action and route; audit log for every finance write.
- Rate limits on OCR and the AI endpoints; file validation by content type (magic bytes, not just the extension).
- Error boundaries per page; no raw errors shown to users.
- Tests: unit (money, extraction validation, matching), integration (service, OCR pipeline with a stubbed model, Telegram handler), AI evals.
- Demo seed script (`npm run finance:seed-demo`), a manual test guide, and updated `docs/ROLES_AND_PERMISSIONS.md`.

---

## 4. Order and estimate

| Phase | Depends on | Size |
|---|---|---|
| 0 Hardening | none | M |
| 1 Real OCR | 0 (indexes, types) | L |
| 4 Telegram | 1 | M |
| 2 AI everywhere | 0, 1 | L |
| 3 Finance agent | 1, 2 (tools) | M |
| 5 Modern features | 0 | L |
| 6 Prod readiness | all | M |

Recommended order: **0 → 1 → 4 → 2 → 3 → 5 → 6**. Telegram comes right after OCR because it reuses the same pipeline and is the most visible demo.

## 5. Definition of done (whole module)
- Every item in the AnOps.md Module 2 spec works end to end with real data.
- A photo of a receipt (uploaded or sent on Telegram) becomes a correct draft expense with no manual typing, in under 15 seconds.
- `npm run typecheck`, `npm run lint` (finance files) and the finance tests pass.
- No finance query runs without a `companyId` filter; no AI write happens without a confirmation.
