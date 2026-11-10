import type { HRPolicyDocument } from "@/features/hr/types";

export const COMPANY_POLICIES: HRPolicyDocument[] = [
  {
    id: "policy-leave-annual",
    title: "Solde de Congé & Annual Paid Leave Policy",
    category: "leave",
    summary: "Tunisian Labour Code (Art. 113-114) Solde de congé ledger system, monthly accrual, reservations, and departure rules.",
    content: `
# AnOps Solde de Congé Policy (Code du Travail Tunisien Art. 113–114)

> **Important Notice:** The legal values below represent statutory baseline standards per the Tunisian Labour Code. Specific collective agreements (Conventions Collectives) or enterprise agreements may grant more favorable terms. Always verify with HR and legal counsel.

1. **Monthly Accrual Rules (Mensualisation)**:
   - **Standard Adults (Age 21 and above)**: Accrue **1.0 day of paid leave per month of effective work** (Art. 113), subject to a standard annual cap of **15 calendar days (including 12 working days)**.
   - **Young Workers (Age 18 to 20)**: Accrue **1.5 days of paid leave per month of effective work** (Art. 114), with an annual cap of **22.5 calendar days (18 working days)**.
   - **Workers Under 18**: Accrue **2.0 days of paid leave per month of effective work** (Art. 114), with an annual cap of **30 calendar days (24 working days)**.
   - The reference period corresponds to the **calendar year** (January 1st to December 31st).

2. **Ledger-Based Balance Formula (Solde de Congé)**:
   - Your real-time available leave balance is derived strictly from an append-only transaction ledger:
     \`Earned    = Sum of monthly ACCRUAL transactions (+ positive carry-over)\`
     \`Taken     = Sum of confirmed TAKEN leaves whose dates have elapsed\`
     \`Reserved  = Sum of active RESERVATION for approved future leaves\`
     \`Available = Earned - Taken - Reserved + Adjustments\`
   - Approved leaves immediately create a **RESERVATION**, protecting against double booking.
   - When the leave dates elapse, reservations transition to **TAKEN**.
   - If an approved leave is cancelled prior to start, a **RELEASE** transaction restores the available balance.

3. **Advance Notice & Public Holidays**:
   - Leave requests must be submitted through the HR Portal at least **3 business days in advance** for short leaves (1–3 days), and **2 weeks in advance** for leaves of 5 days or more.
   - Standard working week is Monday through Friday. Weekends and official Tunisian national public holidays are **automatically excluded** from leave day deductions.
   - Half-day leaves (0.5 day) are supported for morning or afternoon absence.

4. **Overdraft & Discretionary Adjustments**:
   - Submitting leave beyond your available balance is blocked by default.
   - An administrator may approve an exceptional overdraft only with a mandatory, recorded business reason, logged as an **ADJUSTMENT** transaction.

5. **Departure & Unused Leave (Indemnité Compensatrice de Congé Payé)**:
   - When an employment contract terminates, the employee is potentially entitled to an *Indemnité compensatrice de congé payé* for accrued, unconsumed leave (\`Earned - Taken\`).
   - Eligibility depends on the reason for termination (e.g. gross misconduct exceptions under Article 120 of the Labour Code) and applicable collective agreements.
    `.trim(),
  },
  {
    id: "policy-leave-sick-unpaid",
    title: "Sick Leave, Unpaid Leave & Special Absence",
    category: "leave",
    summary: "Rules for medical sick leave, unpaid leave deduction from salary, maternity, and bereavement.",
    content: `
# AnOps Sick, Unpaid & Special Leave Guidelines

1. **Sick Leave**:
   - Employees are entitled to up to **10 days of paid sick leave** per year.
   - For absences exceeding **2 consecutive business days**, an official medical certificate must be submitted to HR within 48 hours of return to work.

2. **Unpaid Leave & Salary Deductions**:
   - Unpaid leave may be requested when an employee has exhausted their annual leave allowance or for special personal leaves.
   - **Crucial Payroll Rule**: Unpaid leave days are **directly deducted from that month's salary**.
   - Formula applied in the Payroll Generator:
     \`daily_rate = base_salary / 22 working days\`
     \`deduction = daily_rate * approved_unpaid_leave_days\`
     \`net_salary = base_salary - deduction\`

3. **Maternity, Paternity & Family Leave**:
   - Maternity leave: **60 calendar days** fully paid.
   - Paternity leave: **5 business days** fully paid.
   - Bereavement leave: **3 business days** fully paid for immediate family members (spouse, child, parent, sibling).
    `.trim(),
  },
  {
    id: "policy-attendance-hours",
    title: "Working Hours, Attendance & Punctuality Policy",
    category: "attendance",
    summary: "Standard 40-hour work week, flexible arrival window, check-in punch protocols, and remote work.",
    content: `
# AnOps Attendance, Working Hours & Punctuality

1. **Standard Working Hours**:
   - The standard work week is **40 hours**, Monday through Friday.
   - Standard daily schedule: **8:00 AM to 5:00 PM**, including a mandatory 1-hour lunch break (usually between 12:30 PM and 2:00 PM).

2. **Flexible Arrival Window**:
   - AnOps operates a flexible morning arrival window between **8:30 AM and 9:30 AM**.
   - Employees arriving at 9:30 AM are expected to complete their 8 working hours by working until 6:30 PM.

3. **Daily Punch & Attendance Tracking**:
   - All team members must log their attendance daily using the **HR Attendance Check-in / Check-out button** on the dashboard.
   - Double check-in on the same day is prohibited by the system.
   - Check-out must follow an active check-in on the same date.
   - Daily and weekly worked hours are automatically computed and monitored.

4. **Absence Notification**:
   - In case of unplanned emergency absence or illness, notify your manager or HR by 9:00 AM on the day of absence.
    `.trim(),
  },
  {
    id: "policy-payroll-compensation",
    title: "Payroll, Salary Structure & Disbursement Policy",
    category: "payroll",
    summary: "Monthly pay cycles, payment disbursement date, default currency (TND), and deduction calculations.",
    content: `
# AnOps Payroll & Compensation Guidelines

1. **Pay Schedule**:
   - Salaries are calculated monthly and disbursed on the **last business day of each calendar month**.
   - Currency: All base salaries, deductions, and net payouts are denominated in **Tunisian Dinars (TND)**.

2. **Salary Calculation Structure**:
   - Standard working days per month is fixed at **22 working days** for daily rate computations.
   - Gross Base Salary is fixed per employee contract.
   - Deductions are triggered by **approved unpaid leave days** logged in that pay period:
     \`daily_rate = base_salary / 22\`
     \`unpaid_deduction = daily_rate * unpaid_leave_days\`
     \`net_salary = base_salary - unpaid_deduction\`
   - Statutory taxes and social security contributions are managed separately according to local labor regulation.

3. **Payslip Generation & Records**:
   - HR generates and locks official monthly payslips through the Payroll Generator.
   - Employees can view and download their official digital payslips at any time via the HR portal.
    `.trim(),
  },
];
