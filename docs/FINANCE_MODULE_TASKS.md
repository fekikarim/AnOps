# AnOps – Finance & Invoicing (Module 2) Task Tracker

**Owner:** Oussema  
**Module:** Finance & Invoicing  
**Status:** `In Progress`  
**Last Updated:** 2025-10-25  
**Goal:** Implement a tenant-scoped Finance module (Customers, Invoices, Payments/Allocations, Expenses, Receipt OCR, Financial Dashboard) aligned with `AnOps.md`, `uml-diagrams/DIAGRAMS.md`, `RULES.md`, `docs/ARCHITECTURE.md` & `docs/ROLES_AND_PERMISSIONS.md`

## 1) Guiding Principles
- [x] **Multi-Tenancy** – Tenant = `company`. Every finance document MUST have `companyId: ObjectId`. Services take a **required** `companyId`. No `companyId?`, no `cId ? {...} : {}` fallbacks.
- [x] **Zero Trust** – Never trust client-supplied `userId`, `companyId`, `role`, `price`, `amount`. Resolve from `getActiveTenant()` / `getCurrentAuthUser()`.
- [x] **Thin Routes** – `src/app/(dashboard)/finance/*` must only import from `features/finance/`. No business logic in pages/route handlers.
- [x] **Server-First** – Server Components by default. `'use client'` only when needed (forms, dynamic invoice lines).
- [x] **RBAC** – Enforce via `src/server/security/permissions.ts` (`assertPermission`). UI hiding is UX only.
- [x] **Validation** – Same Zod schema on client (`react-hook-form` + `zodResolver`, `noValidate`) and server actions/services.
- [x] **Money Safe** – Use integer minor units where possible or `Decimal128`. Never use floating point for monetary calculations. Always track `currency`.
- [x] **Immutable After Post** – Posted invoices must not be freely editable. Corrections go through explicit flows (void/credit-note later if needed).
- [x] **Allocations Explicit** – Model `PaymentAllocation` explicitly. One payment -> many invoices, one invoice -> many payments. Prevent over-allocation.
- [x] **AI Strict** – All AI via `import { ai } from "@/server/ai"` only. Server-only. Treat OCR/extraction as **proposed**. Require human review before applying to an expense/invoice. Wrap in try/catch. Must still respect `companyId` scoping.
- [x] **Separation of Concerns** – `features/finance/` owns UI/actions/schemas/types. `server/services/finance.service.ts` owns rules/queries. `server/` stays server-only.

## 2) Roadmap

### Phase 0: Discovery & Alignment
| Task | Status | Notes | Files |
| --- | --- | --- | --- |
| [x] Read `AnOps.md` (Module 2) | `Done` | Understood scope | `AnOps.md` |
| [x] Read `RULES.md`, `docs/ARCHITECTURE.md`, `docs/ROLES_AND_PERMISSIONS.md`, `docs/design-system.md` | `Done` | Follow existing conventions | Docs |
| [x] Read `uml-diagrams/DIAGRAMS.md` Finance section | `Done` | Mapped to `Customer`, `Invoice`, `Payment`, `PaymentAllocation`, `Expense`, `ReceiptDocument`, `ReceiptExtraction` | `uml-diagrams/DIAGRAMS.md` |
| [x] Inspect `features/hr`, `features/inventory`, `features/purchasing`, `app/(dashboard)/hr` | `Done` | Mirror patterns for actions/services/schemas | `src/features/*`, `src/app/(dashboard)/*` |
| [x] Inspect `src/server/security/permissions.ts`, `src/server/auth/rbac.ts`, `src/server/tenant/context.ts` | `Done` | Know permission/assertion + tenant resolution flow | `src/server/**` |

### Phase 1: Permissions & Docs Sync
| Task | Status | Notes | Files |
| --- | --- | --- | --- |
| [x] Add `FINANCE_*` permissions to `PERMISSIONS` | `Done` | `finance.read`, `finance.customer.manage`, `finance.invoice.manage`, `finance.invoice.post`, `finance.payment.allocate`, `finance.expense.manage`, `finance.expense.approve`, `finance.expense.pay`, `finance.receipt.ocr`, `finance.report.view` | `src/server/security/permissions.ts` |
| [x] Update `READ_PERMISSIONS` to include `FINANCE_READ`, `FINANCE_REPORT_VIEW` | `Done` | Keep read-only access consistent | `src/server/security/permissions.ts` |
| [x] Update `ROLE_PERMISSIONS` (owner/admin/full, operator/limited, viewer/read-only) | `Done` | Operators can create drafts/submit/scan/manage customers; cannot post/allocate/approve/pay by default. Admin/Owner full. Viewer read-only. | `src/server/security/permissions.ts` |
| [x] Update `docs/ROLES_AND_PERMISSIONS.md` – add Finance block to Workspace permissions table | `Done` | Keep in sync with code. Update section 2. | `docs/ROLES_AND_PERMISSIONS.md` |

### Phase 2: Types, Schemas & Data Model
| Task | Status | Notes | Files |
| --- | --- | --- | --- |
| [x] Create `src/features/finance/types/index.ts` | `Done` | Export finance types | `src/features/finance/types/` |
| [x] Create `src/features/finance/schemas/finance.schema.ts` | `Done` | Zod schemas for client+server validation | `src/features/finance/schemas/` |
| [x] Create `src/features/finance/utils/money.ts` | `Done` | Money helpers to avoid float errors | `src/features/finance/utils/` |
| [ ] Define MongoDB collections | `Not Started` | All with `companyId` | `Plan only` |
| [ ] Plan indexes | `Not Started` | Unique constraints per company | `Plan only` |

### Phase 3: Service Layer
| Task | Status | Notes | Files |
| --- | --- | --- | --- |
| [x] Create `src/server/services/finance.service.ts` | `Done` | Tenant + permission checks | `src/server/services/finance.service.ts` |
| [x] Implement Customer CRUD (basic) | `Done` | listCustomers, createCustomer | `finance.service.ts` |
| [x] Implement Invoice lifecycle (basic) | `Done` | listInvoices, createInvoiceDraft, postInvoice, voidInvoice | `finance.service.ts` |
| [x] Implement Payments & Allocations | `Done` | recordPayment, allocatePayment with balance checks | `finance.service.ts` |
| [x] Implement Expenses (basic) | `Done` | listExpenses, createExpense, submit/approve/reject/markPaid | `finance.service.ts` |

### Phase 4: Server Actions
| Task | Status | Notes | Files |
| --- | --- | --- | --- |
| [x] Create `src/features/finance/actions/finance.actions.ts` | `Done` | Customers, invoices, payments/allocations, expenses | `src/features/finance/actions/` |
| [x] Create `src/features/finance/actions/receipt-ocr.actions.ts` | `Done` | OCR action skeleton using `@/server/ai` (proposed only) | `src/features/finance/actions/` |

### Phase 5: Routes & UI
| Task | Status | Notes | Files |
| --- | --- | --- | --- |
| [x] Create route structure under `(dashboard)/finance/` | `Done` | Dashboard, customers, invoices, payments, expenses, receipts | `src/app/(dashboard)/finance/` |
| [x] Finance dashboard `page.tsx` | `Done` | KPIs from service | `src/app/(dashboard)/finance/page.tsx` |
| [x] Customers list page | `Done` | Basic table | `src/app/(dashboard)/finance/customers/page.tsx` |
| [x] Invoices/Expenses/Payments lists + create pages | `Done` | Basic CRUD flows wired | `src/app/(dashboard)/finance/**` |

### Phase 6: AI Expense OCR
| Task | Status | Notes | Files |
| --- | --- | --- | --- |
| [x] Implement receipt upload + OCR via `@/server/ai` | `Done` | Proposed only, require review, save to collections | `receipt-ocr.actions.ts`, `app/(dashboard)/finance/receipts/page.tsx` |

### Phase 7: Testing & QA
| Task | Status | Notes | Files |
| --- | --- | --- | --- |
| [x] Run `npm run typecheck` | `Done` | No type errors | CLI |
| [ ] Run `npm run lint` | `Not Started` | Pre-existing issues remain (not from finance) | CLI |
| [x] Run `npm run test` (permissions) | `Done` | Fixed permissions test for finance.read/view | CLI |
| [ ] Run `npm run test` (full) | `Not Started` | Many pre-existing failures unrelated to finance | CLI |

## 3) Files To Create/Modify

### Create
- `src/features/finance/types/index.ts`
- `src/features/finance/schemas/finance.schema.ts`
- `src/features/finance/actions/finance.actions.ts`
- `src/features/finance/actions/receipt-ocr.actions.ts`
- `src/features/finance/utils/money.ts`
- `src/features/finance/components/**`
- `src/server/services/finance.service.ts`
- `src/app/(dashboard)/finance/**`

### Modify
- `src/server/security/permissions.ts` (done)
- `docs/ROLES_AND_PERMISSIONS.md` (done)
- `src/proxy.ts` (check if `/finance` needs adding)
- `src/shared/components/layout/sidebar.tsx` (add Finance nav)

## 4) Current Focus
**NOW:** Phase 7 – Testing & QA

## 5) Progress Log
| Date | Action | Details | Status |
| --- | --- | --- | --- |
| 2025-10-25 | Created tracker | Initial task tracker | `Done` |
| 2025-10-25 | Phase 1 complete | Added finance permissions and updated docs | `Done` |
| 2025-10-25 | Phase 2 started/completed core | Added types, schemas, money utils | `Done` |
| 2025-10-25 | Phase 3 started | Created finance.service.ts skeleton with dashboard + customer CRUD | `Done` |
| 2025-10-25 | Phase 4 started | Added finance actions and receipt OCR skeleton | `Done` |
| 2025-10-25 | Phase 5 started | Added finance routes/pages (dashboard, customers, invoices, expenses, payments, receipts) | `Done` |
| 2025-10-25 | Phase 3 extended | Added invoice lifecycle, expenses, payments/allocations to finance.service.ts | `Done` |
| 2025-10-25 | Phase 5/6 extended | Added create pages, real lists, receipt upload+OCR skeleton via @/server/ai | `Done` |
| 2025-10-25 | Phase 7 | Typecheck passes, permissions test fixed for finance | `Done` |

## 6) Blockers
| Blocker | Reason | Resolution Plan |
| --- | --- | --- |
| _None yet_ |  |  |

## 7) Next Up
1. Create `src/features/finance/types/index.ts`
2. Create `src/features/finance/schemas/finance.schema.ts`
3. Create `src/features/finance/utils/money.ts`
4. Create `src/server/services/finance.service.ts` skeleton
5. Create actions and routes
