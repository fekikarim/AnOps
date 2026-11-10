# Comprehensive Project Specification for AI / Developer

## 1. Project Overview
- **Name:** AnOps (Odoo-like ERP System)[cite: 1]
- **Target Audience:** Small and Medium Businesses[cite: 1]
- **Timeframe:** 2 Weeks
- **Architecture:** Multi-Tenant Modular ERP with independent feature modules and integrated AI capabilities. Each user creates or belongs to one or more companies. Each company's data (staff, job titles, attendance, stock, orders) is strictly isolated from every other company.

---

## 2. Team Member & Module Assignments

| Member | Assigned Module | Core Focus | AI Agent / Feature |
| :--- | :--- | :--- | :--- |
| **Karim** | Inventory & Manufacturing[cite: 1] | Stock, Products, Work Orders[cite: 1] | Predictive Stock & Reorder Assistant |
| **Oussema** | Finance & Invoicing[cite: 1] | Invoices, Expenses, Payments[cite: 1] | Receipt OCR & Expense Categorizer[cite: 1] |
| **Mohamed** | HR & Payroll[cite: 1] | Employees, Leave/Time-off, Salaries[cite: 1] | HR Policy & Leave FAQ Assistant |
| **Nesrin** | Marketing & Socials[cite: 1] | Email/SMS, Social Planner, Leads[cite: 1] | AI Copywriter & Campaign Generator |
| **Fatma** | Blogs, Forum & Live Chat[cite: 1] | Blog Posts, Forum Threads, Live Chat[cite: 1] | Article Summarizer & Chat FAQ Bot[cite: 1] |

---

## 3. Module Requirements & Task Specifications

### Module 1: Inventory & Manufacturing (Karim)[cite: 1]
1. **Product Catalog:** Product CRUD with SKU, Category, Price, and Stock Quantity.
2. **Stock Movements:** Record Stock In and Stock Out history.
3. **Purchase Orders (POs):** Create vendor POs and automatically increment inventory on completion[cite: 1].
4. **Manufacturing Work Orders:** Basic status pipeline (`Draft` -> `In Progress` -> `Completed`)[cite: 1].
5. **AI Stock Forecast Agent:** Analyzes stock trends and drafts automatic PO suggestions for items low in inventory.

### Module 2: Finance & Invoicing (Oussema)[cite: 1]
1. **Invoice Builder:** Create, edit, and view customer invoices tied to products[cite: 1].
2. **Expense Management:** Track business expenses with date, category, and approval status[cite: 1].
3. **Payment Tracking:** Mark invoices/expenses as `Paid` / `Unpaid` with total balance tracking.
4. **Financial Dashboard:** Visual summary of Total Income vs. Total Expenses over time.
5. **AI Expense OCR:** Scans receipt images/PDFs using OCR/LLM vision to populate expense amount, date, and vendor[cite: 1].

### Module 3: HR & Payroll (Mohamed)[cite: 1]
1. **Employee Management:** Manage staff profiles, roles, contact info, and department details[cite: 1].
2. **Time-off Requests:** Employee submit leave request; Admin approve/reject workflow[cite: 1].
3. **Attendance Tracking:** Simple check-in/check-out or weekly logged hours interface.
4. **Payroll Generator:** Calculate net salary based on base salary minus unpaid leave deductions[cite: 1].
5. **AI HR Assistant:** LLM agent trained on company policies to answer leave balance and HR policy questions.

### Module 4: Marketing & Socials (Nesrin)[cite: 1]
1. **Email / SMS Campaigns:** Draft and trigger simulated email/SMS blasts to selected customer groups[cite: 1].
2. **Campaign Metrics:** Simple view tracking open rates, clicks, or sent status counters.
3. **Social Post Planner:** Schedule, draft, and preview social media content calendars[cite: 1].
4. **Lead Management:** Simple lead pipeline (Contact info, status, lead source).
5. **AI Copywriting Assistant:** AI text generator that writes promotional content based on target audience and platform constraints.

### Module 5: Blogs, Forum & Live Chat (Fatma)[cite: 1]
1. **Blog Publishing:** CRUD system for articles with rich text content, tags, and status[cite: 1].
2. **Community Forum:** Create topics and nested reply threads for community discussion[cite: 1].
3. **Live Support Chat:** Real-time or polling-based chat widget for live user inquiries[cite: 1].
4. **Comments Engine:** Enable user comments on blog articles and forum posts.
5. **AI Article Summarizer / Chat FAQ:** 
   - Generates quick 3-bullet summaries for blog posts.
   - Fallback AI chatbot for live chat when human operators are offline[cite: 1].