# AnOps — HR & Payroll Module: Task Brief for the AI

## 0. How to use this file
I am **Mohamed Abidi**, a member of the AnOps team. This file describes **only my part** of the project: the **HR & Payroll** module. Use it as the source of truth when helping me plan, design, code, test, and document this module. If something is unclear, ask me or state your assumption explicitly before building on it. Follow the team's shared stack and conventions; don't introduce new frameworks without asking.

---

## 1. Project context
- **Project:** AnOps — an Odoo-like, modular ERP for small and medium businesses.
- **Timeframe:** 2 weeks.
- **Architecture:** 5 independent feature modules, each with its own integrated AI feature.

| Member | Module | AI feature |
| :--- | :--- | :--- |
| Karim | Inventory & Manufacturing | Predictive Stock & Reorder Assistant |
| Oussema | Finance & Invoicing | Receipt OCR & Expense Categorizer |
| **Mohamed (me)** | **HR & Payroll** | **HR Policy & Leave FAQ Assistant** |
| Nesrin | Marketing & Socials | AI Copywriter & Campaign Generator |
| Fatma | Blogs, Forum & Live Chat | Article Summarizer & Chat FAQ Bot |

**My module:** HR & Payroll — Employees, Leave/Time-off, Attendance, Salaries.
**My AI feature:** HR Policy & Leave FAQ Assistant.

---

## 2. My deliverables (5 features)

### Feature 1 — Employee Management
Manage staff profiles, roles, contact info, and department details.

**Tasks**
- Employee CRUD (create, list, view, edit, deactivate).
- Fields: full name, email, phone, job title/role, department, hire date, base salary, status (active/inactive), manager (optional).
- Department management (simple list: create/rename/delete, assign employees).
- List page with search, filter by department/status, and pagination.
- Validation: unique email, required fields, salary ≥ 0.
- Soft-delete (deactivate) instead of hard delete so leave/payroll history stays intact.

**Acceptance criteria**
- An admin can add, edit, and deactivate an employee and see the change immediately in the list.
- Invalid or duplicate data is rejected with clear error messages.

---

### Feature 2 — Time-off (Leave) Requests
Employees submit leave requests; an admin approves or rejects them.

**Tasks**
- Leave request form: employee, leave type (e.g. annual, sick, unpaid), start date, end date, reason.
- Auto-compute number of days (exclude weekends; make this easy to adjust).
- Status workflow: `Pending` → `Approved` / `Rejected` (with optional admin comment).
- Leave balance per employee (annual allowance minus approved paid leave days).
- Validation: end date ≥ start date, no overlapping approved requests, can't exceed balance for paid leave types.
- Views: "My requests" for employees, "All requests / pending approvals" for admins.
- Mark leave as **paid or unpaid** — unpaid days feed the payroll deduction.

**Acceptance criteria**
- An employee can submit a request and see its status; an admin can approve/reject it.
- Approved leave updates the employee's balance and is visible to payroll.

---

### Feature 3 — Attendance Tracking
Simple check-in/check-out or a weekly logged-hours interface.

**Tasks**
- Pick **one** approach (ask me which; default = check-in/check-out buttons) and implement it:
  - Check-in / check-out with timestamps, **or**
  - Weekly timesheet with hours per day.
- Compute daily and weekly worked hours.
- Attendance history per employee with a date-range filter.
- Admin view: who is present/absent today.
- Prevent double check-in and check-out without a check-in.

**Acceptance criteria**
- Employees can log attendance; admins can see per-employee history and totals.

---

### Feature 4 — Payroll Generator
Calculate net salary = base salary − unpaid leave deductions.

**Tasks**
- Select employee(s) and a pay period (month/year).
- Pull base salary from the employee record and unpaid leave days from approved unpaid leave in that period.
- Formula (state it in the UI and docs):
  ```
  daily_rate      = base_salary / working_days_in_month
  deduction       = daily_rate * unpaid_leave_days
  net_salary      = base_salary - deduction
  ```
- Generate a payslip record per employee per period (base, unpaid days, deduction, net, generated date).
- Prevent duplicate payslips for the same employee and period (or allow regenerate with confirmation).
- Payslip detail view + printable/exportable (PDF or print-friendly page).
- Payroll summary for a period: total gross, total deductions, total net.

**Acceptance criteria**
- Generating payroll for a month produces correct net salaries from base salary and unpaid leave.
- Results can be re-checked by hand against the formula.

**Assumptions to confirm with me:** working-days convention (e.g. 22 days vs. actual weekdays), currency (default TND), and whether tax/social-security deductions are in scope (default: **out of scope**).

---

### Feature 5 — AI HR Assistant (HR Policy & Leave FAQ)
An LLM agent that answers leave balance and HR policy questions.

**Tasks**
- Chat UI inside the HR module (simple message thread + input).
- Backend endpoint that receives a question and returns an answer.
- **Policy knowledge:** load company HR policies (a markdown/text file or a few sample policy documents) and use them as context (simple RAG or direct prompt context — keep it as simple as the timeframe allows).
- **Leave balance lookup:** let the assistant call a function/tool to read the logged-in employee's real leave balance and request statuses from the database.
- Guardrails:
  - Answer only from provided policies and database data; say "I don't know / contact HR" when unsure.
  - An employee can only see **their own** data; never expose other employees' salaries or leave details.
  - Don't invent policy.
- Create 1–2 sample policy documents (leave policy, working hours/attendance policy) for demo and testing.
- Test with a set of sample questions, e.g.: "How many leave days do I have left?", "How do I request sick leave?", "Is unpaid leave deducted from my salary?"

**Acceptance criteria**
- The assistant answers policy questions from the documents and correctly reports a user's leave balance, and refuses/defers when it lacks information.

---

## 3. Suggested data model (adapt to the team's DB/ORM)

- **Department**: id, name
- **Employee**: id, full_name, email (unique), phone, job_title, department_id, hire_date, base_salary, status, manager_id (nullable), role (employee/admin)
- **LeaveRequest**: id, employee_id, leave_type, is_paid, start_date, end_date, days, reason, status (pending/approved/rejected), admin_comment, reviewed_by, created_at
- **LeaveBalance** (or computed): employee_id, year, allowance, used
- **Attendance**: id, employee_id, date, check_in, check_out, hours_worked
- **Payslip**: id, employee_id, period (YYYY-MM), base_salary, unpaid_days, deduction, net_salary, generated_at

---

## 4. Integration notes with other modules
- **Finance (Oussema):** payroll totals could later appear as an expense/summary — design payslip data so it's easy to expose via an endpoint, but don't depend on Finance to finish my module.
- **Shared auth/roles:** use the team's common user/role system (employee vs. admin). Ask before creating my own.
- **Shared UI/layout:** follow the common layout, navigation, and design components so the 5 modules feel like one ERP.
- Keep my module **independent**: its own routes, models, and service layer.

---

## 5. Roadmap (2 weeks)

### Phase 1 — Setup & foundations (Days 1–2)
1. Sync with the team: agree on stack, repo structure, branching, auth/roles, and shared layout.
2. Set up my module skeleton (routes, models, pages, navigation entry "HR & Payroll").
3. Create the database schema/migrations for Department, Employee, LeaveRequest, Attendance, Payslip.
4. Seed sample data (a few departments, ~8 employees, one admin).

**Milestone:** module skeleton runs inside the main app with seeded data.

### Phase 2 — Employee Management (Days 3–4)
1. Employee CRUD API + UI (list, create, edit, view, deactivate).
2. Department management.
3. Search/filter/pagination and validation.
4. Basic tests for CRUD.

**Milestone:** admin can fully manage employees and departments.

### Phase 3 — Leave / Time-off (Days 5–6)
1. Leave request form and day calculation.
2. Approve/reject workflow with admin comments.
3. Leave balance logic and validations (overlap, balance).
4. Employee and admin views.

**Milestone:** full leave lifecycle works end to end.

### Phase 4 — Attendance (Day 7)
1. Check-in/check-out (or timesheet) implementation.
2. Daily/weekly hours computation and history view.
3. Admin "present/absent today" view.

**Milestone:** attendance is logged and viewable.

### Phase 5 — Payroll Generator (Days 8–9)
1. Implement the net-salary calculation using unpaid leave days.
2. Payslip generation per employee/period; duplicate protection.
3. Payslip detail view + print/export; period summary.
4. Unit tests for the formula (edge cases: no unpaid leave, leave spanning two months, month with zero working days).

**Milestone:** payroll for a month is generated and verified by hand.

### Phase 6 — AI HR Assistant (Days 10–12)
1. Write sample HR policy documents.
2. Build the chat UI and backend endpoint.
3. Connect the LLM with policy context.
4. Add the leave-balance tool (read-only, scoped to the current user).
5. Add guardrails and test with a list of sample questions.

**Milestone:** assistant answers policy questions and reports real leave balances safely.

### Phase 7 — Integration, polish & testing (Day 13)
1. Merge and integrate with the main app; fix conflicts with other modules.
2. Consistent UI, error handling, empty/loading states.
3. End-to-end test of the full flow: add employee → leave request → approve → generate payroll → ask the AI.
4. Fix bugs found.

**Milestone:** the module is stable inside the combined ERP.

### Phase 8 — Documentation & demo prep (Day 14)
1. Short README for the module (features, setup, formulas, assumptions).
2. Prepare demo script and seed data for the presentation.
3. Final review with the team; buffer for last-minute fixes.

**Milestone:** the module is demo-ready.

---

## 6. Definition of done (my module)
- [ ] All 5 features work end to end with seeded demo data.
- [ ] Role-based access: employees see only their own data; admins manage everything.
- [ ] Payroll results verified against the formula.
- [ ] AI assistant answers from policies, reports real leave balances, and refuses safely.
- [ ] Integrated into the main app with consistent UI.
- [ ] Module README and demo script ready.

## 7. What I expect from the AI
- Work step by step following the roadmap; tell me which phase we're in.
- Produce clean, commented, testable code that matches the team's stack.
- Flag assumptions and ask when requirements are ambiguous.
- Prioritize a **working, demo-ready** version over extra features, given the 2-week limit.
