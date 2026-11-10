# Manual Testing Guide — Leave Balance & HR Ledger System

> [!IMPORTANT]
> Run `npm run dev` first (app at `http://localhost:3000`). You need a company with at least one employee. If starting fresh, complete the onboarding flow — `seedHrDefaultsForCompany` will auto-seed leave types, policies, and public holidays.

---

## Prerequisites Checklist

- [ ] `npm run dev` running on port 3000
- [ ] Logged in as a user with **hr_admin** role (company owner or admin)
- [ ] At least **1 active employee** with a `hireDate` set
- [ ] Switch to an active company via the company switcher

---

## Section 1 — Leave Balance KPI Cards

**Where:** `/hr` → "Time-off & Leave" tab → select any employee

1. Open the Leave tab for an employee
2. **Verify** 4 KPI cards are visible with English labels:
   - 🟢 **Earned** — total earned days (ledger sum of ACCRUALs + ADJUSTMENTs)
   - 🔴 **Taken** — days taken (ledger sum of TAKEN)
   - 🟡 **Reserved** — days reserved/pending (RESERVATION - RELEASE)
   - 🔵 **Available** — available balance (`Earned − Taken − Reserved`)
3. **Verify** legal disclaimer pill below cards reads:
   > *"Leave accrual regime: Tunisian Labour Code (Art. 113–114) — Monthly accrual & append-only ledger"*
4. If a new employee with no ledger entries: Available should equal the initial hire accrual (usually 1.0d for adults).

---

## Section 2 — Monthly Accrual

**Where:** Leave tab → admin button bar (top right)

1. Log in as **hr_admin**
2. Go to Time-off & Leave tab for any employee
3. Click the **"Monthly Accrual"** button (calendar icon)
4. Confirm the dialog: *"Run the monthly leave accrual for the current month?"*
5. **Verify** toast: `"Monthly accrual complete: X employee(s) credited."`
6. Refresh the page / re-select employee
7. **Verify** "Earned" card increased by the policy accrual rate:
   - Adult (21+): `+1.0 d`
   - Young adult (18–20): `+1.5 d`
   - Under 18: `+2.0 d`
8. Click **"History"** → verify a new `ACCRUAL` row appears with today's date

> [!NOTE]
> Accrual is **idempotent per month** — running it twice in the same month does nothing the second time. The toast will still appear but Earned won't double.

---

## Section 3 — Half-Day Leave Request

**Where:** Leave tab → "Request Leave" button

1. Click **"Request Leave"**
2. Set **Start Date = End Date** (same day)
3. **Verify** a new checkbox appears: `"Half-day request (0.5 day)"`
4. Check the checkbox
5. **Verify** two radio buttons appear: `Morning` / `Afternoon`
6. Select **Morning**, fill in a reason, submit
7. **Verify** the request in the list shows **0.5 days**
8. Set different start/end dates → **Verify** the half-day checkbox is hidden

---

## Section 4 — Public Holiday Exclusion

**Where:** "Request Leave" form

1. Click **"Request Leave"**
2. Set dates that span a seeded Tunisian holiday:
   - `2026-05-01` → `2026-05-01` (Labour Day)
   - `2026-03-20` → `2026-03-20` (Independence Day)
3. **Verify** the computed duration shows **0 working day(s)**
4. **Verify** submit is blocked (cannot request 0-day leave)
5. Try `2026-05-04` (Monday after holiday) → **Verify** shows **1 working day**

---

## Section 5 — Leave Approval → RESERVATION Posted

**Where:** Leave tab → pending requests list → Approve

1. Submit a leave request (Section 3 above)
2. As admin, find the request in the pending list
3. Click **Approve** (✓ button) — optionally add a note
4. **Verify** status changes to `approved`
5. Click **"History"** → **Verify** a `RESERVATION` entry appears with `+X d`
6. Back on KPI cards:
   - **Reserved** increased by approved days
   - **Available** decreased by same amount
   - **Earned** unchanged

---

## Section 6 — Leave Cancellation → RELEASE Posted

**Where:** Leave tab → approved requests list → Cancel

1. Using an approved future leave request from Section 5
2. Click the **Cancel** button on the approved request
3. Enter a cancellation reason (prompt in English: *"Reason for cancelling this request:"*)
4. Confirm
5. **Verify** status changes to `cancelled`
6. Click **"History"** → **Verify** a `RELEASE` entry appears with negative days (restoring the reservation)
7. Back on KPI cards:
   - **Reserved** decreased (released)
   - **Available** restored

---

## Section 7 — Leave History Modal ("History")

**Where:** Leave tab → **"History"** button

1. Click **"History"** (clock icon)
2. **Verify** modal opens with ledger table titled **"Leave Balance History"**:
   - Type badge (ACCRUAL / RESERVATION / TAKEN / RELEASE / ADJUSTMENT / REVERSAL / COMPENSATION)
   - Date
   - Days (green `+` or red `−`)
   - Description / Reason
   - Author
3. **Admin only — Reversal test:**
   a. Find an ACCRUAL entry
   b. Click the **↩** (reversal) icon on that row
   c. Enter a reversal reason (required)
   d. Click **"Confirm Reversal"**
   e. **Verify** a new `REVERSAL` row appears with negative days
   f. **Verify** Earned on KPI cards decreased accordingly

> [!CAUTION]
> Reversals are permanent ledger entries — they cannot be deleted. Corrections create new offsetting entries.

---

## Section 8 — Manual Adjustment (Admin)

**Where:** Leave tab → **"Adjust Balance"** button (orange sliders icon)

1. Click **"Adjust Balance"**
2. **Verify** modal shows employee selector, mandatory reason field, and days input
3. Enter `+3` days with reason `"Balance correction bonus"`
4. Click **"Save Adjustment"** → **Verify** toast success
5. Check KPI cards → **Verify** Earned increased by 3
6. Open History → **Verify** ADJUSTMENT entry with `+3 d`
7. Now try `-1.5` days with a reason
8. Submit → **Verify** Earned decreased by 1.5
9. **Edge case:** Try `0` days → **Verify** form validation blocks submission: *"Adjusted days cannot be zero."*

---

## Section 9 — Overdraft Protection

**Where:** "Request Leave" form & admin review

1. Note the employee's current **Available** balance (e.g., 2 days)
2. Try to submit a leave request for **more** than Available (e.g., 5 days)
3. **Verify** submission is blocked with error:
   > *"Requested X days exceeds available Solde de congé (Y days available)"*
4. **Admin overdraft override:**
   a. If an admin reviews a request that exceeds available balance
   b. Provide an **Override reason if balance is exceeded**
   c. **Verify** approval succeeds and logs an exceptional overdraft adjustment

---

## Section 10 — Departure Review Modal

**Where:** Employees tab → Deactivate employee

1. Go to the **Employees** tab
2. Find an active employee with accrued leave
3. Click **Deactivate** on the employee
4. Confirm deactivation prompt
5. **Verify** modal opens: **"Departure Review — Unused Leave Balance"**
6. **Verify** the modal displays:
   - Days Earned
   - Days Taken
   - Unused Balance (`Earned − Taken`)
7. **Verify** legal notice is shown (Tunisian Labour Code Art. 120 caveat)
8. Enter HR validation reason (e.g. *"Contract end - served notice"*)
9. Click **"Confirm compensation (Xd)"**
10. Open History for that employee → **Verify** a `COMPENSATION` transaction appears with the unused days settled

---

## Section 11 — AI HR Assistant

**Where:** `/hr` → "AI Assistant" tab

### Test 1 — Balance query
- Ask: `"How many leave days do I have left in my leave balance?"`
- **Verify:**
  - Response includes numbers for Earned, Taken, Reserved, Available
  - Interactive card appears titled **"Real-time Leave Balance"** with 4 columns: Earned / Taken / Reserved / Available
  - Action buttons: *"View Leave Balance"* and *"Request Leave"*

### Test 2 — Accrual rules & Step-by-Step Derivation
- Ask: `"Explain how my Solde de Congé is counted step-by-step"`
- **Verify:**
  - Response breaks down the calculation into numbered steps:
    1. **Monthly Accrual (Acquis)**: Effective months × accrual rate (Art. 113–114)
    2. **Consumed Leave (Pris)**: Past completed leaves
    3. **Active Reservations (Réservé)**: Approved future leaves locking balance
    4. **Available Balance (Disponible)**: Equation `Earned − Taken − Reserved + Adjustments`
    5. **Departure Indemnity (Art. 120)**: `Earned − Taken` unused days × Daily Rate
  - Renders the interactive **Real-time Leave Balance** visual card

### Test 3 — Departure compensation & Payroll Unpaid Deduction
- Ask: `"How is unpaid leave deducted from my salary in payroll?"`
- **Verify:**
  - Explains the formula: `daily_rate = base_salary / 22`, `deduction = daily_rate × unpaid_days`, `net_salary = base_salary − deduction`
  - Uses personalized salary and daily rate

### Test 4 — Admin querying any employee in the organization
- Log in as **hr_admin** (or company owner)
- Ask: `"What is Sarah Ben Salem's leave balance and history?"`
- **Verify:**
  - AI identifies Sarah Ben Salem in the company records
  - Displays her exact live Solde numbers and calculation derivation
  - Visual card renders labeled **"Sarah Ben Salem's Leave Balance"**

### Test 5 — Admin querying a non-existent worker (Not Found check)
- Log in as **hr_admin**
- Ask: `"Check leave for John Doe"`
- **Verify:**
  - AI reports: `🔍 Employee Not Found: Employee 'John Doe' was not found in company records. Please verify the spelling or check the Employees directory to ensure they are registered in this organization.`

### Test 6 — Non-admin querying peer employee (Strict RBAC Denial)
- Log in as a standard **employee** (e.g. Nour Khemir)
- Ask: `"What is Sarah Ben Salem's leave balance?"` or `"Check Karim Mansour's salary"`
- **Verify:**
  - AI immediately refuses access:
    `⛔ Access Denied: In accordance with AnOps security and privacy policies (docs/ROLES_AND_PERMISSIONS.md), you are only authorized to view your own personal HR records, leave balances, and payslips. You do not have permission to view records for other employees.`
  - Zero information about Sarah or Karim is disclosed

---

## Section 12 — Payroll Regression (Unpaid Leave Deduction)

**Where:** Payroll tab → generate payslip

1. Create (or use existing) employee with `baseSalary = 4400`
2. Approve an **UNPAID** leave request for **2 working days** in the current period
3. Go to **Payroll** tab → generate payslip for current period
4. **Verify:**
   - `daily_rate = 4400 / 22 = 200`
   - `unpaid_deduction = 200 × 2 = 400`
   - `net_salary = 4400 − 400 = 4000`
5. **Verify** standard paid leaves (Annual Leave, Sick) do not cause unpaid deductions

---

## Section 13 — Multi-Tenancy Isolation

**Where:** Company switcher → switch between 2 companies

1. In **Company A**: add employee, run monthly accrual, submit leave
2. Switch to **Company B** (different tenant)
3. Check Leave tab and History
4. **Verify:**
   - Zero transactions from Company A appear in Company B
   - Balances and policies are strictly isolated per `companyId`

---

## Quick Smoke Test (5-minute version)

| # | Action | Expected |
|---|--------|----------|
| 1 | Open Leave tab for an employee | 4 KPI cards visible (Earned, Taken, Reserved, Available) |
| 2 | Click "Monthly Accrual" | Toast: "Monthly accrual complete...", Earned +1.0 |
| 3 | Submit same-day leave request | "Half-day request (0.5 day)" checkbox visible |
| 4 | Open "History" | Ledger entries shown with badges, dates, and authors |
| 5 | Click "Adjust Balance", enter +2d | Earned increases by 2 |
| 6 | Deactivate an employee | "Departure Review — Unused Leave Balance" modal appears |
| 7 | Ask AI assistant: "How many leave days do I have left?" | Live card with Earned / Taken / Reserved / Available |
