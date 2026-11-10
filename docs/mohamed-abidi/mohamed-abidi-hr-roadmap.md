# AnOps — HR & Payroll Module: Master Roadmap

> **Module Owner:** Mohamed Abidi  
> **Module:** HR & Payroll with Integrated AI Assistant  
> **Repository:** `AnOps` (Next.js 16 App Router, React 19, TypeScript 5, MongoDB, Tailwind CSS v4)  
> **Status:** Phase 1–8 Completed (Brief #1) | Brief #2 (Solde de congé & AI Enhancement) In Progress  
> **Last Updated:** November 2026

---

## 📌 How to Use This Roadmap
- Every step is organized sequentially by phase and feature.
- Tasks from **Brief #1** are verified and marked as **`[x] DONE`**.
- Tasks from **Brief #2** (Ledger-based *Solde de congé* & AI integration) are listed step-by-step with **`[ ]`** checkboxes.
- When an engineer or AI agent finishes a step, change its checkbox to **`[x]`** and log the date or commit reference.
- All implementations **must** adhere to:
  - `RULES.md` & `ai_agent_rules.md`
  - `docs/ARCHITECTURE.md` (Strict multi-tenancy: mandatory `companyId: ObjectId` on every read/write)
  - `docs/AI_PROVIDERS.md` (Sole entry point `import { ai } from "@/server/ai"`)
  - `docs/design-system.md` & `docs/layout-rules.md` (Flat design, mobile-first, 44px touch targets)

---

## 🏛️ Architecture & Ground Rules

| Domain | Strict Requirement |
| :--- | :--- |
| **Multi-Tenancy** | Every collection doc has `companyId: ObjectId`. Every service function takes a required `companyId: string`. No cross-tenant reads or writes. |
| **Persistence** | MongoDB native driver (`clientPromise` from `@/server/db/client`). |
| **Ledger Invariant** | `leave_transactions` is **append-only**. No updates, no deletes. Corrections use `REVERSAL` or `ADJUSTMENT`. |
| **AI Integration** | `import { ai } from "@/server/ai"` server-only. Never call Groq/Gemini/OpenRouter SDKs directly. Safe graceful fallbacks. |
| **Presentation** | Next.js Server Components by default; `"use client"` only for interactive modals and forms; actions in `src/features/hr/actions/`. |
| **Legal Status** | Tunisian Labour Code (Articles 113–114) values are starting baselines, always marked with *"Verify with HR/legal"*. |

---

## Part 1: Completed Core Module (Brief #1 — `mohamed-abidi-hr-payroll-tasks.md`)

All 5 core features and foundational phases from Brief #1 have been fully implemented, tested, and integrated:

### Phase 1: Setup & Foundations
- [x] **1.1 Skeleton & Routing:** HR navigation entry and dashboard routes at `src/app/(dashboard)/hr/page.tsx`.
- [x] **1.2 Multi-tenant Seeding:** `seedHrDefaultsForCompany()` in `src/server/services/hr.service.ts` for default departments and predefined job titles.
- [x] **1.3 Data Models:** Base schemas and MongoDB collections for `departments`, `job_titles`, `employees`, `attendance`, `leave_requests`, `payslips`.

### Phase 2: Feature 1 — Employee & Department Management
- [x] **2.1 Employee CRUD:** Full CRUD with soft-delete (`active`/`inactive`), role assignment (`employee`, `manager`, `hr_admin`), auto-provisioning linked user credentials.
- [x] **2.2 Department Management:** Create, rename, delete (with validation blocking deletion if employees are assigned).
- [x] **2.3 Predefined & Custom Job Titles:** Management modal and combobox integration.
- [x] **2.4 Filters & Search:** Search by name/email, filter by department and status, responsive pagination.
- [x] **2.5 Validation:** Zod schemas (`src/features/hr/schemas/hr.schema.ts`) for emails, base salary >= 0, hire dates.

### Phase 3: Feature 2 — Time-off (Leave) Requests (Legacy Flat-Allowance Model)
- [x] **3.1 Leave Request Form:** Modal with leave type selection (`annual`, `sick`, `unpaid`, etc.), date pickers, reason, and validation.
- [x] **3.2 Day Calculation:** Weekend exclusion (`calculateBusinessDays()` in `date-utils.ts`).
- [x] **3.3 Workflow & Approval:** `pending` → `approved` / `rejected` workflow with reviewer name, timestamp, and admin comments.
- [x] **3.4 Flat Balance Tracking:** Annual allowance (default 25 days) minus approved paid leave days.
- [x] **3.5 Overlap & Balance Validations:** Rejects overlapping dates and requests exceeding remaining allowance.
- [x] **3.6 Role Scoping:** "My Requests" tab for employees vs. "All Requests / Pending Approvals" for HR admins.

### Phase 4: Feature 3 — Attendance Tracking
- [x] **4.1 Punch System:** Daily check-in / check-out with timestamps and worked hours calculation.
- [x] **4.2 Prevention of Double Punch:** Prevents double check-in and unauthenticated check-out.
- [x] **4.3 Attendance Roster:** Admin view for "Present / Absent Today" with deduplicated daily attendance.
- [x] **4.4 History Log:** Per-employee attendance history with date-range filters.

### Phase 5: Feature 4 — Payroll Generator
- [x] **5.1 Net Salary Formula:** `daily_rate = base_salary / 22`, `deduction = daily_rate * unpaid_leave_days`, `net_salary = base_salary - deduction`.
- [x] **5.2 Payslip Generation:** Generates and locks payslips per employee per period (`YYYY-MM`).
- [x] **5.3 Duplicate Protection:** Upsert logic preventing duplicate payslips for the same period.
- [x] **5.4 Detail & Print View:** Printable/exportable payslip modal with breakdowns.
- [x] **5.5 Payroll Summary:** Period aggregates (total gross, deductions, net, employees count).

### Phase 6: Feature 5 — AI HR Assistant (Initial Implementation)
- [x] **6.1 Chat UI:** Embedded chat panel in HR dashboard (`src/features/hr/components/ai-hr-assistant.tsx`).
- [x] **6.2 Policy Context:** Static knowledge base with 4 policy documents in `src/features/hr/policies/company-policies.ts`.
- [x] **6.3 Leave Balance Tool:** Real-time lookup of the current user's flat leave balance and pending requests.
- [x] **6.4 Guardrails & Scope:** Refusal to answer out-of-scope queries; employee data isolation; action links to HR sections.
- [x] **6.5 Agent Architecture:** `HRAssistantAgent` in `src/features/hr/ai/hr-assistant.agent.ts` extending `BaseAgent` and communicating via `ai` provider master.

### Phase 7 & 8: Polish, Testing & Documentation
- [x] **7.1 Unit Tests:** `src/features/hr/hr-payroll.test.ts` for formulas, date math, and deductions.
- [x] **7.2 Multi-tenant Isolation Tests:** `tests/integration/hr-tenancy.test.ts` ensuring complete company-level data isolation.
- [x] **7.3 Task Brief #1 Documentation:** Requirements, formulas, and acceptance criteria documented in `mohamed-abidi-hr-payroll-tasks.md`.

---

## Part 2: New Module Extension (Brief #2 — `mohamed-abidi-hr-leave-balance-tasks.md`)
### *Solde de Congé* (Ledger-based & Policy-Driven System) + Upgraded AI Assistant

---

### 📋 Phase A — Read, Plan & Baseline Setup
- [x] **A.1 Architectural Review:** Inspect existing HR schemas, services, AI agents, and multi-tenant helpers.
- [x] **A.2 Roadmap Establishment:** Create comprehensive `mohamed-abidi-hr-roadmap.md` with step-by-step implementation milestones.
- [x] **A.3 Assumption Alignment (§4 of Brief #2):**
  - Reference period: Calendar year (`YYYY-01-01` to `YYYY-12-31`).
  - Accrual timing: Monthly, posted at month end.
  - Partial first month: Rounding to 0.5 fractions.
  - Age category assessed on accrual date.
  - Adjustments tracked separately from Earned (`Available = Earned - Taken - Reserved + Adjustments`).
  - Carry-over: Allowed, no expiry by default (configurable per policy).
  - Working calendar: Mon–Fri, public holidays from per-company table.
  - Overdraft: Blocked by default; admin override with mandatory reason.
  - UI Language: English UI with standard French terms (*Solde de congé*, *Demande de congé*, *Congés payés*, *Indemnité compensatrice de congé payé*).

---

### 🗄️ Phase B — Data Models & Schema Migration (Features A & B)
Target files:
- `src/features/hr/types/index.ts`
- `src/features/hr/schemas/hr.schema.ts`
- `src/server/services/hr.service.ts`

- [x] **B.1 TypeScript Definitions (`src/features/hr/types/index.ts`):**
  - Define `LeaveTypeRecord` (`id`, `companyId`, `name`, `code`, `isPaid`, `requiresApproval`, `requiresDocument`, `isActive`, `createdAt`).
  - Define `LeavePolicyRecord` (`id`, `companyId`, `name`, `country`, `employeeCategory`, `accrualRate`, `accrualPeriod`, `annualCap`, `referencePeriodType`, `calculationMethod`, `roundingRule`, `effectiveFrom`, `effectiveTo`, `legalReference`, `isActive`).
  - Define `EmployeeLeavePolicyRecord` (`id`, `companyId`, `employeeId`, `leavePolicyId`, `effectiveFrom`, `effectiveTo`, `assignedBy`, `assignedAt`).
  - Define `LeaveTransactionRecord` (`id`, `companyId`, `employeeId`, `leaveTypeId`, `transactionType`, `days`, `effectiveDate`, `referenceId`, `description`, `createdBy`, `createdAt`).
    - Transaction types: `ACCRUAL`, `TAKEN`, `RESERVATION`, `RELEASE`, `ADJUSTMENT`, `COMPENSATION`, `REVERSAL`.
  - Define `PublicHolidayRecord` (`id`, `companyId`, `name`, `date`, `isHalfDay`).
  - Update `Employee` type: add `dateOfBirth?: string`.
  - Update `LeaveRequest`: add `leaveTypeId`, `requestedDays`, `approvedDays`, `halfDayOption`, `supportingDocumentUrl`, `cancellationReason`.
  - Update `LeaveBalance`: replace flat view with `SoldeDeConge` (`earned`, `taken`, `reserved`, `adjustments`, `available`, `asOfDate`, `policySummary`).

- [x] **B.2 Zod Validation Schemas (`src/features/hr/schemas/hr.schema.ts`):**
  - Add schema for `LeavePolicyInput` (accrual rates, caps, category, effective dates).
  - Add schema for `LeaveAdjustmentInput` (employeeId, leaveTypeId, days [+ or -], mandatory reason, optional document).
  - Add schema for `PublicHolidayInput` (date, name, isHalfDay).
  - Update `EmployeeInput` to include optional `dateOfBirth`.
  - Update `LeaveRequestInput` to use `leaveTypeId`, half-day flag, and document URL.

- [x] **B.3 Default Tunisian Leave Policies Seeding:**
  - Create default Tunisian policies per Labour Code Art. 113–114:
    - **Adult (>= 21):** 1.0 day/month of effective work, annual cap 15 calendar days (12 working days).
    - **Age 18–20:** 1.5 days/month of effective work, annual cap 22.5 calendar days (18 working days).
    - **Under 18:** 2.0 days/month of effective work, annual cap 30 calendar days (24 working days).
  - Seed system `LeaveType`s per company: `CP` (Congés Payés / Annual Paid), `SICK` (Maladie), `EXCEPTIONAL` (Événements familiaux), `UNPAID` (Sans solde).
  - Seed default public holidays (Tunisian national holidays) in `seedHrDefaultsForCompany()`.
  - Auto-assign age-matched policy when a new employee is created.

- [x] **B.4 Data Migration Script / Service Routine:**
  - Convert existing legacy `leave_requests` into initial ledger transactions (`ACCRUAL` for allowance, `RESERVATION`/`TAKEN` for approved leaves).
  - Assign default policy to all existing employees without policies.
  - Safe, idempotent, non-destructive migration helper in `src/server/services/hr.service.ts`.

---

### ⚙️ Phase C — Accrual Engine & Solde de Congé Calculations (Features C & D)
Target files:
- `src/server/services/hr.service.ts`
- `src/features/hr/actions/leave.action.ts`
- `src/features/hr/utils/date-utils.ts`

- [x] **C.1 Append-Only Transaction Ledger Service:**
  - `createLeaveTransaction()` helper in `hr.service.ts` with strict multi-tenancy.
  - Assert that no endpoint or service allows `update` or `delete` on `leave_transactions`.

- [x] **C.2 Monthly Accrual Engine:**
  - `runMonthlyAccrual(companyId, periodDate, options)`:
    - Determine active policy for each employee on accrual date.
    - Check working status (hire date, active status).
    - Prevent duplicate accrual for the same employee, leave type, and month (idempotency check).
    - Apply annual cap check so accrued days do not exceed policy maximum.
    - Post `ACCRUAL` transaction to the ledger.
  - Backfill routine for employees hired mid-year.

- [x] **C.3 Ledger-Derived Balance Function:**
  - `getSoldeDeConge(employeeId, companyId, asOfDate?)`:
    - `Earned = sum(ACCRUAL) + positive carry-over`
    - `Taken = sum(TAKEN)`
    - `Reserved = sum(RESERVATION)` (active approved requests not yet past)
    - `Adjustments = sum(ADJUSTMENT)`
    - `Available = Earned - Taken - Reserved + Adjustments`
  - Reconcile validation function verifying cached balance against full ledger sum.

- [x] **C.4 Server Actions for Accrual:**
  - `runAccrualAction(periodDate)`: Admin trigger button to run monthly accrual on demand.
  - `recalculateEmployeeBalanceAction(employeeId)`: Audit & reconcile balance.

---

### 🔄 Phase D — Leave Lifecycle, History & Adjustments (Features E & F)
Target files:
- `src/server/services/hr.service.ts`
- `src/features/hr/actions/leave.action.ts`
- `src/features/hr/components/leave-section.tsx`
- `src/features/hr/components/leave-request-modal.tsx`
- New: `src/features/hr/components/leave-history-modal.tsx`
- New: `src/features/hr/components/manual-adjustment-modal.tsx`

- [x] **D.1 Upgraded Leave Request Lifecycle:**
  - Request submission (`PENDING`): Checks available balance; does NOT deduct yet.
  - Approval (`APPROVED`):
    - Verifies `Available >= requestedDays` (or requires admin overdraft override with logged reason).
    - Creates `RESERVATION` transaction on the ledger.
  - Rejection (`REJECTED`): No ledger change.
  - Cancellation (`CANCELLED`):
    - If request was `APPROVED`, creates `RELEASE` transaction to restore available balance.
  - Execution (`TAKEN`):
    - Scheduled job / check converts `RESERVATION` to `TAKEN` once the leave end date passes (`syncTakenLeaveRequests`).
  - Public holiday and half-day deduction logic in day counter.

- [x] **D.2 History Ledger View ("Historique des congés"):**
  - Component displaying chronologically ordered transaction log for an employee:
    - Date, Transaction Type (`ACCRUAL`, `TAKEN`, `RESERVATION`, `RELEASE`, `ADJUSTMENT`, etc.), Days, Description, Reference, Author.
  - Filter by leave type and date range.
  - Employee view (own history only) vs. Admin view (all employees).

- [x] **D.3 Manual Adjustments & Reversals:**
  - Admin adjustment modal: Select employee, leave type, days (+/-), **mandatory reason**.
  - Posts an `ADJUSTMENT` transaction with actor ID and audit details.
  - Reversal action for specific transactions: Posts `REVERSAL` referencing the original transaction ID.

- [x] **D.4 UI Upgrades ("Mon solde de congé"):**
  - Employee card displaying the 4 key Solde metrics: **Earned (Acquis)**, **Taken (Consommé)**, **Reserved (Réservé)**, **Available (Disponible)**.
  - French terminology: *Solde de congé*, *Demande de congé*, *Congés payés*, *Indemnité compensatrice de congé payé*.
  - Reference period & legal disclaimer badge (*"Verify with HR/legal"*).

---

### 🤖 Phase E — AI HR Assistant Upgrade & Policy Knowledge (Feature G & H)
Target files:
- `src/features/hr/ai/hr-assistant.agent.ts`
- `src/features/hr/policies/company-policies.ts`
- `src/server/services/hr.service.ts`
- `src/features/hr/components/ai-hr-assistant.tsx`
- New: `src/features/hr/components/departure-review-modal.tsx`

- [x] **E.1 Rewritten HR Policy Documents (`company-policies.ts`):**
  - Replace flat-allowance text with comprehensive *Solde de congé* documentation:
    - Tunisian Labour Code Articles 113–114 accrual rules (1 day/mo for standard adults, 1.5 for 18–20, 2.0 for <18).
    - Reservation vs. Taken lifecycle.
    - Reference period, annual caps, carry-over rules.
    - Unpaid leave salary deduction formula.
    - Explicit *"Verify with HR/legal"* clause in policy text.

- [x] **E.2 Upgraded AI Assistant Leave Tool (`HRAssistantAgent`):**
  - Upgrade `enrichContext()` to call `getSoldeDeConge()`:
    - Provides real-time breakdown: **Earned**, **Taken**, **Reserved**, **Available**.
    - Lists active policy and legal reference.
    - Lists pending and recent approved leave reservations.
  - Teach the AI system prompt to understand and explain *Solde de congé* concepts in French and English.
  - Answer specific questions:
    - *"How many leave days do I have left?"* (Reports Available, clarifies Reserved)
    - *"How is my leave balance calculated?"* (Explains Tunisian monthly accrual and formula)
    - *"Is unpaid leave deducted from my salary?"* (Quotes formula and provides employee personalized example)
    - *"What happens to my unused leave if I leave the company?"* (Explains potential *Indemnité compensatrice de congé payé* subject to legal review)
  - Ensure zero cross-employee data exposure (strict current user boundary).

- [x] **E.3 Departure & Unused Leave Review (Feature H):**
  - When employee status is changed to `inactive`, display the Departure Review modal.
  - Calculates potential unused leave (`Earned - Taken`).
  - Clear warning: *Indemnité compensatrice de congé payé* depends on termination cause (Art. 120), collective agreement, and legal review.
  - Only logs `COMPENSATION` transaction upon explicit admin confirmation.

- [x] **E.4 Payroll Regression Verification:**
  - Verify that `isPaid: false` leave requests continue to feed the payroll generator formula without regressions.

---

### 🧪 Phase F — Testing, Verification & Final Polish
Target files:
- `src/features/hr/hr-payroll.test.ts`
- New: `tests/unit/solde-de-conge.test.ts`
- `tests/integration/hr-tenancy.test.ts`
- `README.md` / `mohamed-abidi-hr-leave-balance-tasks.md`

- [x] **F.1 Unit Tests for Solde de Congé:**
  - Accrual math (standard adult 1 day/mo = 12 working days cap).
  - Age category transitions (under 18 = 2 days/mo, 18–20 = 1.5 days/mo).
  - Balance formula (`Available = Earned - Taken - Reserved + Adjustments`).
  - Overdraft prevention and admin override reason requirement.
  - Append-only ledger invariant.
- [x] **F.2 Multi-tenant Isolation Verification:**
  - Ensure leave policies, transactions, and balances are strictly scoped by `companyId`.
- [x] **F.3 AI HR Assistant Verification:**
  - Grounded in official policy documents and real-time ledger data; safe refusal for out-of-scope inquiries.
- [x] **F.4 Documentation & Demo Walkthrough:**
  - Updated tracking roadmap and verified clean test suite.

---

## 🎯 Progress Tracker Summary

| Phase | Milestone | Status |
| :--- | :--- | :--- |
| **Phase 1–8 (Brief #1)** | Full HR & Payroll MVP (5 Features + AI Assistant) | **`[x] COMPLETED`** |
| **Phase A** | Read, Plan & Baseline Setup | **`[x] COMPLETED`** |
| **Phase B** | Data Models, Policies & Ledger Migration | **`[x] COMPLETED`** |
| **Phase C** | Accrual Engine & Solde de Congé Calculations | **`[x] COMPLETED`** |
| **Phase D** | Leave Lifecycle, History & Adjustments | **`[x] COMPLETED`** |
| **Phase E** | AI Assistant Upgrade & Departure Review | **`[x] COMPLETED`** |
| **Phase F** | Testing, Tenancy Validation & Documentation | **`[x] COMPLETED`** |

