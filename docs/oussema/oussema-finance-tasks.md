# Finance Module: Task List

Status: `[ ]` todo · `[~]` in progress · `[x]` done · `[-]` dropped
Plan: [oussema-finance-plan.md](oussema-finance-plan.md) · Progress log: [oussema-finance-progress.md](oussema-finance-progress.md)

## Phase 0: Hardening and fixes
- [x] **F0.1** Make `allocatePayment` atomic (transaction plus conditional updates on balance and unallocated amount); test a concurrent double allocation.
- [x] **F0.2** Dashboard: cents-safe sums for monthly totals and net cash flow; totals grouped by currency.
- [x] **F0.3** Overdue: work out `overdue` consistently (query-time flag on lists and detail) and keep it out of the stored status machine; test it.
- [x] **F0.4** Add the company filter to the customer lookup in `listUnpaidInvoices` (and check all `$lookup`s).
- [x] **F0.5** Finance indexes in `src/server/services/finance.indexes.ts`, registered in `src/server/db/indexes.ts` (companyId + status/date, unique invoiceNumber per company, allocations by invoice/payment).
- [x] **F0.6** `updateInvoiceDraft` + `deleteInvoiceDraft` (drafts only), with actions and edit UI.
- [x] **F0.7** `updateExpense` + `deleteExpense` (draft/rejected only), with actions and edit UI.
- [x] **F0.8** Replace `any` in the finance service (service is now lint-clean; the `any`s left in finance UI components and pages are covered by F5.7).

## Phase 1: Real receipt OCR
- [x] **F1.1** GridFS receipt storage service (`src/server/finance/receipt-storage.ts`): put/get/delete, company-scoped, size and type limits, SHA-256 hash.
- [x] **F1.2** Authenticated route `GET /api/v1/finance/receipts/[id]/file`: streams the file after a company and permission check.
- [x] **F1.3** AI layer: `AiMessage.attachments` plus Gemini `inlineData` / OpenAI-style `image_url` mapping, and routing that only picks vision-capable providers.
- [x] **F1.4** Extraction pipeline (`src/server/finance/receipt-ocr.service.ts`): vision call, Zod result schema, deterministic checks, honest confidence, category matched to the company's categories.
- [x] **F1.5** Duplicate detection (same file hash, or same vendor + date + total).
- [x] **F1.6** Rewrite `scanReceiptAction` on top of F1.1–F1.5 (no raw database access in the action).
- [x] **F1.7** Receipts UI: image/PDF preview beside the editable proposal, per-field confidence, warnings.
- [x] **F1.8** "Apply → draft expense": creates the expense, sets `appliedToExpenseId`, marks it reviewed; the receipt opens from a **Receipt** link on the expense list and on the expense edit page.
- [x] **F1.9** Bulk upload: drop or pick up to 10 receipts; files that aren't photos or PDFs are skipped with a reason; read one after another with a progress bar, a status per file and **Review** on each result.
- [x] **F1.10** Tests: extraction validation (unit), pipeline with a stubbed model (integration).

## Phase 4: Telegram receipt capture
- [x] **F4.1** Staff Telegram link: collection plus a single-use deep-link token bound to (userId, companyId); connect/disconnect UI in Finance settings.
- [x] **F4.2** Webhook dispatch: `/start fin_<token>` and messages from linked staff chats go to a finance handler; marketing flow unchanged.
- [x] **F4.3** Photo/document handler: `getFile` → download (≤10 MB) → F1 pipeline → draft expense → summary reply with link.
- [x] **F4.4** Commands `/start` (help), `/company` (list/switch), `/unlink`; `/stop` stays with Marketing; 30 receipts per chat per hour; duplicate photos recognised by content hash (stronger than Telegram's `file_unique_id`); member and permissions re-checked on every photo; audit log.
- [x] **F4.5** Tests for the handler (stubbed Telegram + model) and a local polling path.

## Phase 2: AI in every screen
- [x] **F2.1** Expense auto-categorization (suggestion with a reason) on the expense form.
- [x] **F2.2** Expense anomaly flags computed by code (duplicate, unusual amount, weekend, no receipt) with an explanation on hover, on the expense list; the Copilot's `finance_expense_flags` tool explains them in chat.
- [-] **F2.3** (moved to F3.1: the AI command center already drafts invoices from text with `/newinvoice <description>`; the Finance Copilot will expose it) Invoice from a description ("Invoice ACME for 10 chairs, due in 30 days") → prefilled builder.
- [x] **F2.4** Payment smart match (suggested allocations, ranked, one-click apply).
- [x] **F2.5** Overdue reminder email drafted by AI (editable, then sent with F5.2).
- [x] **F2.6** Customer insight card (days to pay, risk).
- [x] **F2.7** Dashboard AI insights + 30/60/90-day cash-flow forecast.

## Phase 3: Finance AI agent
- [x] **F3.1** Finance Copilot panel in `/finance` (finance-scoped orchestrator, aware of the current page).
- [x] **F3.2** New tools: cash-flow forecast, aging report, match payment, expense flags. (Scanning a receipt from chat links to the Receipts page; editing drafts stays on the edit screens, since the review-form flow already covers creates.)
- [x] **F3.3** Suggested prompts per page + a "Scan a receipt" shortcut. (Attaching a file inside the chat is not done: the chat endpoint takes 8 KB of text; receipts go through the Receipts page or Telegram.)
- [x] **F3.4** Evals: tenant isolation, viewer can't write, no write without confirmation.

## Phase 5: Modern features and UX
- [x] **F5.1** Duplicate invoice; credit notes on posted invoices with an open balance (a credit on a fully paid invoice would be a refund, not handled).
- [x] **F5.2** Send invoice by email (full HTML invoice + text copy; last sent at/to recorded; audited). A PDF attachment would need a PDF library (not added); customers get the complete invoice in the e-mail body.
- [x] **F5.3** Tunisian VAT presets (19/13/7/0) + optional timbre fiscal.
- [x] **F5.4** Invoices: server-side search (number or customer), status filter incl. Overdue/Open/Credited, pages of 25, shareable URLs. Expenses already had client-side search and status tabs; payments list is small (kept as is).
- [x] **F5.5** Reports: AR aging, expenses by category, monthly P&L, XLSX export.
- [x] **F5.6** Reverse an allocation from the invoice page (reason required, kept as reversed, atomic). A separate payment detail page was not needed.
- [x] **F5.7** UI polish: no `any` and no native `alert`/`confirm` left in Finance (inline confirm steps, toasts, in-page messages); designed empty and no-match states on the new screens. Loading skeletons for the older list pages were not added.

## Phase 6: Production readiness
- [x] **F6.1** RBAC + audit log for every finance write.
- [x] **F6.2** Rate limits on OCR/AI; magic-byte file validation.
- [x] **F6.3** Error boundaries; user-safe error messages.
- [x] **F6.4** Demo seed script `finance:seed-demo`.
- [x] **F6.5** Manual test guide; `docs/ROLES_AND_PERMISSIONS.md` and a Finance section in `docs/ARCHITECTURE.md`.
- [x] **F6.6** Full test run (1178/1182: 3 Windows path tests that also fail without these changes, and an HR Copilot test that timed out under full-suite load and passes on its own, 46/46), `tsc` clean, Finance lint clean, production build succeeds.
