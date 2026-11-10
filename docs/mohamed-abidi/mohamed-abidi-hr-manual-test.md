# Manual Testing Guide — HR Leave Balance (Solde de Congé) & Ledger System

This document outlines step-by-step instructions to manually verify all newly implemented features in the HR & Leave module.

---

## Prerequisites
- Dev server running: `npm run dev` (available at `http://localhost:3000`)
- Logged in with an **HR Admin** account (company owner or admin)
- An active company with at least one employee (with a hire date)

---

## 1. Monthly Accrual Idempotency (The Fix Verification)

**Goal:** Verify that clicking "Monthly Accrual" multiple times in the same month only accrues once.

1. Navigate to `/hr` $\rightarrow$ **Time-off & Leave** tab.
2. Note the **Earned** count on the first KPI card (e.g., `3 days`).
3. Click the **"Monthly Accrual"** button in the top-right toolbar.
4. Confirm the prompt dialog: *"Run the monthly leave accrual for the current month?"*.
5. **Expected result:**
   - If already credited for November 2026: A banner appears saying:
     > *"All active employees have already received their accrual for this period (X checked)."*
   - The **Earned** card count **does not change**.
6. Open **"History"**:
   - Verify that **no new duplicate transaction** is added for `Period 2026-11`.
   - Verify the Author displays as **"HR Administrator"** (or your user's name), not a raw ObjectId string.

---

## 2. Leave Balance KPI Cards (Live Ledger Calculation)

**Goal:** Verify the 4-card ledger summary displays correct values and formulas.

1. In the **Time-off & Leave** tab, inspect the 4 cards:
   - 🟢 **Earned:** Total accrued days + manual adjustments.
   - 🔴 **Taken:** Approved past leave requests that have taken place.
   - 🟡 **Reserved:** Future approved leave requests holding balance.
   - 🔵 **Available:** Exactly equals `Earned - Taken - Reserved`.
2. Verify the legal disclaimer pill below the cards:
   > *"Leave accrual regime: Tunisian Labour Code (Art. 113–114) — Monthly accrual & append-only ledger"*

---

## 3. Half-Day Request (Single-Day Only)

**Goal:** Verify half-day selection appears only when start date equals end date.

1. Click **"Request Leave"** (blue button).
2. Set **Start Date** and **End Date** to the same date (e.g., `2026-11-10`).
3. **Verify:** A checkbox appears: **"Half-day request (0.5 day)"**.
4. Check the box $\rightarrow$ Radio buttons appear: **Morning** and **Afternoon**.
5. Select **Morning**, enter a reason, and submit.
6. **Verify:** The new request in the list shows **0.5 working day**.
7. Now change the **End Date** to a different day $\rightarrow$ **Verify:** The half-day option disappears automatically.

---

## 4. Public Holiday Deduction from Working Days

**Goal:** Ensure recognized national holidays are not counted as consumed leave days.

1. Click **"Request Leave"**.
2. Select dates spanning a Tunisian public holiday (e.g., Labour Day on `2026-05-01` to `2026-05-01`).
3. **Verify:** Computed duration shows **0 working day(s)**.
4. Verify you cannot submit a 0-day leave request.
5. Select `2026-04-30` to `2026-05-04` (Thursday to Monday, with Friday May 1st holiday + weekend):
   - **Verify:** Count computes to **2 working days** (Thursday April 30 & Monday May 4).

---

## 5. Leave Lifecycle: Approval $\rightarrow$ RESERVATION Posted

**Goal:** Ensure approving a request reserves days without prematurely counting them as "Taken".

1. Submit a 2-day leave request for a future date (e.g., next month).
2. As Admin, find the request under **Pending** and click **Approve** (✓).
3. Check the KPI cards:
   - **Reserved** increases by `+2 days`.
   - **Available** decreases by `-2 days`.
   - **Earned** and **Taken** remain unchanged.
4. Open **"History"**:
   - Verify a new **RESERVATION** transaction row with `+2 d` and the leave request reference.

---

## 6. Leave Cancellation $\rightarrow$ RELEASE Posted

**Goal:** Ensure cancelling an approved request releases reserved days back to Available.

1. On the approved future request from Step 5, click **Cancel**.
2. Enter a cancellation reason (e.g., *"Trip cancelled"*).
3. Check the KPI cards:
   - **Reserved** decreases back by `-2 days`.
   - **Available** increases back by `+2 days`.
4. Open **"History"**:
   - Verify a **RELEASE** transaction with `-2 d` restores the balance.

---

## 7. Leave History & Transaction Reversal

**Goal:** Verify the append-only ledger and reversal mechanism.

1. Click **"History"** (clock icon).
2. Verify all transaction types display clean badges:
   - `ACCRUAL` (Blue)
   - `RESERVATION` (Amber)
   - `RELEASE` (Purple)
   - `TAKEN` (Green)
   - `ADJUSTMENT` (Orange)
   - `REVERSAL` (Red)
3. On any previous non-reversal transaction, click the ↩ (**Reverse**) button.
4. Enter a reason (minimum 3 characters) and click **"Confirm Reversal"**.
5. **Verify:**
   - A new **REVERSAL** row is appended with offsetting days.
   - The original transaction is never deleted (preserving the append-only audit trail).
   - The close button at the bottom reads **"Close"**.

---

## 8. Manual Adjustment (Admin Only)

**Goal:** Verify administrative crediting or debiting of leave days.

1. In the Leave tab, click **"Adjust Balance"** (orange sliders icon).
2. Select an employee.
3. Enter `+2.5` days with reason *"Annual leave carryover adjustment"*.
4. Click **"Save Adjustment"**.
5. **Verify:**
   - **Earned** and **Available** increase by `2.5 days`.
   - History logs an `ADJUSTMENT` transaction of `+2.5 d`.
6. Test negative adjustment: enter `-1` day with a reason $\rightarrow$ **Verify:** balance decreases by 1.
7. Test edge case: enter `0` days $\rightarrow$ **Verify:** blocked by form validation.

---

## 9. Overdraft Protection & Admin Override

**Goal:** Prevent employees from requesting more days than they have available, while allowing admin override.

1. Note the current **Available** balance (e.g., 2 days).
2. Attempt to submit a leave request for `10 days`.
3. **Verify:** Request submission is blocked with an error:
   > *"Requested 10 days exceeds available Solde de congé (2 days available)"*
4. As Admin, approve a pending request that would exceed balance:
   - Fill in the optional field: **"Override reason if balance is exceeded"**.
   - Click **"Confirm Approval"**.
   - **Verify:** Approval succeeds and posts an exceptional overdraft adjustment.

---

## 10. Departure Review Modal (Employee Offboarding)

**Goal:** Review unused leave balance and potential compensation when an employee leaves.

1. Navigate to `/hr` $\rightarrow$ **Employees** tab.
2. Click **Deactivate** on an active employee with accrued leave.
3. Confirm deactivation prompt.
4. **Verify:** The **"Departure Review — Unused Leave Balance"** modal opens automatically:
   - Displays **Days Earned**, **Days Taken**, and **Unused Balance**.
   - Displays the **Legal Notice** regarding Tunisian Labour Code Art. 120 (gross misconduct caveat).
5. Enter an HR validation reason (e.g., *"Contract expiration, notice period served"*).
6. Click **"Confirm compensation (Xd)"**.
7. Go to **Time-off & Leave** $\rightarrow$ **History** for that employee:
   - **Verify:** A `COMPENSATION` transaction settles the remaining days.

---

## 11. AI HR Assistant

**Goal:** Verify the AI assistant understands live leave balances and rules.

1. Navigate to the **AI Assistant** tab in `/hr`.
2. **Prompt 1:** *"How many leave days do I have left in my leave balance?"*
   - **Verify:** AI returns exact values for Earned, Taken, Reserved, and Available.
   - **Verify:** A interactive **"Real-time Leave Balance"** card renders directly in chat with shortcut buttons (*"View Leave Balance"* and *"Request Leave"*).
3. **Prompt 2:** *"How is my leave accrued and calculated (Art. 113-114)?"*
   - **Verify:** Explains the monthly accrual rates (1.0d for adults, 1.5d for young adults, 2.0d for under 18).
4. **Prompt 3:** *"What happens to my unused leave if I leave the company?"*
   - **Verify:** Mentions unused leave compensation and notes the Art. 120 exception.

---

## 12. Payroll Regression (Unpaid Leave Deduction)

**Goal:** Ensure unpaid leave deductions continue to work correctly with the new leave model.

1. Submit and approve an **Unpaid Leave** request for `2 days` in the current month.
2. Switch to the **Payroll** tab and generate payslips for the current period.
3. Check the calculated slip:
   - Base salary / 22 working days = Daily rate.
   - Deduction = `Daily rate × 2 unpaid days`.
   - Net salary = `Base - Deduction`.
   - **Verify:** Regular paid leaves (Annual Leave, Sick Leave) do not trigger salary deductions.

---

## Quick 3-Minute Smoke Test Checklist

- [ ] **Accrual Idempotency:** Click "Monthly Accrual" twice $\rightarrow$ second click says already credited, balance does not double.
- [ ] **History Modal:** Displays English badges, `+Xd`, and "Close" button.
- [ ] **Half-Day:** Same-day request reveals "Half-day request (0.5 day)" with Morning/Afternoon.
- [ ] **Manual Adjustment:** Can add `+1` day with a mandatory reason.
- [ ] **AI Assistant:** Responds with live Earned/Taken/Available numbers and widget card.

