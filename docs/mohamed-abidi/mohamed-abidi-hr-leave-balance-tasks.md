# AnOps — HR & Payroll Module: Task Brief #2 (Solde de congé)

## 0. How to use this file
I am **Mohamed Abidi**, a member of the AnOps team. This is the **second task brief** for my **HR & Payroll** module. The first brief (`mohamed-abidi-hr-payroll-tasks.md`) is **fully implemented**. This file extends the existing module; it does not restart it.

- Source of truth for the leave rules: `solde_de_conge_hr_module.md` (Tunisian "Solde de congé" system).
- Source of truth for the current code: the existing HR & Payroll module in the repo. **Read it first** and adapt to it.
- Follow the team's stack and conventions; don't introduce new frameworks without asking.
- If something is unclear, ask me or state your assumption explicitly before building on it.
- This brief contains **Task 1 only**. More tasks will be added later as separate sections or files.

---

## 1. Current state (already built — do not rebuild)
From brief #1, the module already has:
- Employee + Department management (CRUD, soft-delete, search/filter/pagination).
- Leave requests: types (annual, sick, unpaid), `is_paid`, weekday-based day count, `Pending → Approved/Rejected`, overlap and balance validation, "My requests" / "All requests" views.
- **Simple leave balance:** `annual allowance − approved paid leave days` (flat allowance per employee per year).
- Attendance (check-in/check-out), Payroll generator (`net = base − daily_rate × unpaid_days`), payslips.
- AI HR Assistant: policy docs as context + read-only leave-balance tool scoped to the current user.
- Multi-tenant isolation: every record is scoped to a company.

---

## 2. Task 1 — Make "Solde de congé" the default leave system

### Goal
Replace the flat-allowance balance with the **ledger-based, policy-driven Solde de congé system** described in `solde_de_conge_hr_module.md`, and make it the **default** for every employee and every new company, with no manual setup needed.

### Core principles (from the spec)
1. **Balance is derived from a transaction ledger**, never silently overwritten. Mistakes are fixed with a reversal/adjustment, not an edit.
2. **Rules are configurable data (`LeavePolicy`)**, not hard-coded numbers.
3. **An approved request is a reservation first**, and becomes "taken" only when its dates pass. Never deduct twice.
4. **Default policy = Tunisian standard** (see §2.2), editable per company by an admin.
5. Legal values are a **starting point**, flagged as "verify with HR/legal" in the UI and docs.

---

### 2.1 Feature A — Data model & migration

**Tasks**
- Add `LeaveType` (id, company_id, name, code, is_paid, requires_approval, requires_document, is_active). Seed per company: Annual Paid Leave (`CP`), Sick Leave, Exceptional Leave, Unpaid Leave.
- Add `LeavePolicy` (id, company_id, name, country, employee_category, accrual_rate, accrual_period, annual_cap, reference_period_start/end, calculation_method, rounding_rule, effective_from, effective_to, legal_reference, is_active).
- Add `EmployeeLeavePolicy` (employee_id, leave_policy_id, effective_from, effective_to, assigned_by) so an employee's policy can change over time without rewriting history.
- Add `LeaveTransaction` (id, company_id, employee_id, leave_type_id, transaction_type, days, effective_date, reference_id, description, created_by, created_at).
  - `transaction_type`: `ACCRUAL`, `TAKEN`, `RESERVATION`, `RELEASE`, `ADJUSTMENT`, `COMPENSATION`, `REVERSAL`.
  - Append-only: no update/delete endpoints.
- Extend `LeaveRequest`: add `leave_type_id`, `requested_days`, `approved_days`, `reviewed_at`, `review_comment`, and statuses `PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`, `TAKEN`.
- Keep `LeaveBalance` only as an optional **cached view**, reconciled against the ledger (add a `recalculate` function).
- **Migration of existing data:** convert existing approved requests into ledger transactions so no history is lost; map old leave type strings to the new `LeaveType` rows; give every existing employee the default policy.

**Acceptance criteria**
- Migration runs on the seeded demo DB without data loss.
- Every table is company-scoped; no cross-company reads.
- There is no code path that edits or deletes a ledger row.

---

### 2.2 Feature B — Default Tunisian leave policy

**Tasks**
- Seed a default `LeavePolicy` for every company (and for every new company at creation), based on the spec:
  - Standard adult: **1 day per month of effective work**.
  - Age 18–20: **1.5 days per month**.
  - Under 18: **2 days per month**.
  - Annual cap per the spec (standard: 15 calendar days incl. 12 working days — store as configurable fields, don't hard-code).
  - `legal_reference`: Labour Code Art. 113–114 (display with a "verify with HR/legal" note).
- Auto-assign the matching policy to each employee by age category (needs **date of birth** on Employee — add the field, nullable, default to standard adult if missing).
- Admin screen to view/edit policies and change an employee's policy (creates a new `EmployeeLeavePolicy` row with effective dates; never overwrites the old one).

**Acceptance criteria**
- A new company and a new employee get a working default policy with zero configuration.
- Changing a policy only affects calculations from its `effective_from` date.

---

### 2.3 Feature C — Accrual engine

**Tasks**
- Service that posts `ACCRUAL` transactions per employee per month of effective work, using the employee's active policy at that date.
- Respect the annual cap and the reference period.
- Idempotent: running accrual twice for the same employee and month must not double-post.
- Trigger options: scheduled monthly job **and** an admin "Run accrual for period" button (needed for the demo).
- Backfill: when an employee is created with a past hire date, optionally generate accruals from hire date.
- Do **not** assume "10 calendar days = 0.5 day". Partial months follow the configured `calculation_method` / `rounding_rule` (default assumption in §4).

**Acceptance criteria**
- Running accrual for a month posts the expected days per employee, once.
- Hand-checking 6 months for a standard employee gives 6 days (subject to the cap).

---

### 2.4 Feature D — Balance calculation & dashboard (Solde de congé)

**Tasks**
- Balance function (derived from the ledger):
  ```
  Earned    = sum of ACCRUAL (+ positive carry-over)
  Taken     = sum of confirmed TAKEN
  Reserved  = sum of active RESERVATION (approved, future, not released)
  Available = Earned − Taken − Reserved + Adjustments
  ```
- Decide and document whether adjustments are inside Earned or separate, to avoid counting them twice (assumption in §4).
- Support "balance as of date X".
- Employee page **"Mon solde de congé"**: Earned / Taken / Reserved / Available, applicable policy summary, reference period.
- Label clearly whether a number is *remaining total* or *currently available*.
- Admin/HR page: all employees' balances, filters by department, employee, leave type, date.

**Acceptance criteria**
- Example from the spec (Earned 12, Taken 5, Reserved 2) shows Available = 5.
- Balance matches the ledger exactly; a reconcile check reports 0 differences.

---

### 2.5 Feature E — Leave request lifecycle (reservation → taken)

**Tasks**
- Update the request form: leave type (from `LeaveType`), dates, requested days, comment, optional supporting document (required when the type says so).
- Day counting: weekdays by default; configurable handling of **public holidays** (simple holidays table per company) and **half-days**.
- Lifecycle with ledger effects:
  - `PENDING` → no balance change.
  - `APPROVED` → post `RESERVATION` for the days.
  - `REJECTED` → nothing posted.
  - `CANCELLED` (before start) → post `RELEASE`.
  - Dates passed → scheduled job converts `RESERVATION` into `TAKEN` and sets status `TAKEN`.
- Overdraft rule: block approval if Available < requested days, unless an admin explicitly overrides (override is logged as an `ADJUSTMENT` with a reason).
- Overlap validation kept from brief #1.
- Unpaid leave still feeds payroll (see 2.7); only **paid annual leave** consumes the Solde.

**Acceptance criteria**
- A request is never deducted twice.
- Approve → reserved; cancel → released; date passes → taken, each visible in history.

---

### 2.6 Feature F — Leave history & manual adjustments (Historique des congés)

**Tasks**
- Per-employee history page listing every ledger movement (type, days, date, reference, description, who).
- Admin manual adjustment form: employee, leave type, ± days, **mandatory reason**, optional evidence note/attachment. Stored as `ADJUSTMENT` with user + timestamp.
- Correction flow: "Reverse" action posts a `REVERSAL` linked to the original transaction.
- Role rules: employees see only their own history; admins see all within their company.

**Acceptance criteria**
- Every balance change can be traced to a transaction with an author.
- An adjustment without a reason is rejected.

---

### 2.7 Feature G — Integrations with existing features

**Tasks**
- **Payroll:** keep `net = base − daily_rate × unpaid_days`; unpaid days now come from approved requests whose `LeaveType.is_paid = false`. Add regression tests so brief #1 payroll results are unchanged.
- **AI HR Assistant:** update the read-only leave-balance tool to return Earned / Taken / Reserved / Available, the applicable policy, and request statuses for the **logged-in employee only**. Replace the sample leave policy document with one that matches the Solde de congé rules (including the "verify with HR/legal" caveat). Re-test the sample questions ("How many leave days do I have left?", "How is my leave calculated?", "What happens to my unused leave if I leave the company?").
- **UI wording:** use **"Solde de congé"**, **"Demande de congé"**, **"Congés payés"**, **"Indemnité compensatrice de congé payé"** (add French labels; keep the app's existing language switch if there is one).

**Acceptance criteria**
- Payroll tests from brief #1 still pass.
- The assistant reports balances that match the Solde page and never exposes other employees' data.

---

### 2.8 Feature H — Departure / unused-leave review (lightweight)

**Tasks**
- When an employee is deactivated, show an admin review screen: earned eligible leave − taken − other valid deductions = **potential unused leave**.
- Record a `COMPENSATION` transaction **only after explicit admin validation**, and keep the calculation details.
- Show a warning: eligibility depends on the reason for termination (e.g. gross-misconduct exception, Art. 120), the collective agreement, and payroll rules — do not auto-pay the displayed balance.
- Out of scope: computing the actual monetary amount (flag as future work).

**Acceptance criteria**
- Deactivating an employee never auto-creates compensation.
- The review shows the calculation and requires an admin confirmation.

---

## 3. Roadmap (suggested, adjust to the remaining time)

### Phase A — Read & plan
1. Read the existing HR module (models, balance logic, request flow, AI tool).
2. Confirm the assumptions in §4 with me; list the files that will change.

### Phase B — Schema & migration (2.1, 2.2)
- New tables, default policy seeding, data migration, tests.

### Phase C — Accrual & balance (2.3, 2.4)
- Accrual service, balance function, reconcile check, dashboards.

### Phase D — Request lifecycle & history (2.5, 2.6)
- Reservation/taken/release flow, scheduled job, history and adjustments.

### Phase E — Integrations (2.7, 2.8)
- Payroll regression, AI assistant update, departure review.

### Phase F — Testing & docs
- Tests for: partial months, policy change mid-year, overlapping requests, cancellations, holidays, age-bracket change, employee departure, double accrual, cross-company isolation.
- Update the module README (rules, formulas, assumptions) and the demo script/seed data.

---

## 4. Assumptions to confirm with me (defaults in bold)
1. Reference period: **calendar year** (alternative: work anniversary).
2. Accrual timing: **monthly, posted at month end**.
3. Partial first month: **no accrual until a full month of effective work** (rounding: **keep fractions to 0.5**).
4. Age category assessed **on the accrual date**.
5. Adjustments tracked **separately from Earned** (Available formula in 2.4).
6. Carry-over of unused leave: **allowed, no expiry** (configurable on the policy).
7. Working calendar: **Mon–Fri, public holidays from a per-company table**, half-days allowed.
8. Overdraft: **blocked; admin override only, with a reason**.
9. Manager role: **out of scope for now** (employee vs. admin only, as in brief #1); manager approval portal is optional later.
10. Language: **English UI with French labels for the four key terms**.
11. Sick/exceptional leave: **do not use annual accrual**; tracked as requests only.

## 5. Definition of done
- [ ] New Solde de congé system is the default for every existing and new company/employee.
- [ ] Balance is derived from an append-only ledger and reconciles to 0 differences.
- [ ] Default Tunisian policy seeded and editable; policy changes keep history.
- [ ] Request lifecycle works: approve → reserve → taken; cancel → release.
- [ ] History page and mandatory-reason adjustments work.
- [ ] Payroll and AI assistant updated; brief #1 tests still pass.
- [ ] Multi-tenant isolation and employee-only data access verified.
- [ ] README and demo script updated.

## 6. What I expect from the AI
- Read the existing code first; tell me which phase we're in.
- Make changes incrementally and keep the app runnable after each phase.
- Flag assumptions and ask when requirements are ambiguous.
- Write clean, commented, tested code that matches the team's stack.
- Never present legal values as final; keep the "verify with HR/legal" notes.
