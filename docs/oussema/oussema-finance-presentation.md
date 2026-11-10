# How to Present the Finance & Invoicing Module

**Presenter:** Oussema Issaoui · **Module 2 of AnOps:** Finance & Invoicing
**Suggested length:** 15 minutes (5 explaining + 8 live demo + 2 questions). Shorter version at the end.

---

## 1. Before you present (checklist)

Do this the day before, not 5 minutes before.

- [ ] Use a **test company**, not your real one. Load demo data:
  ```bash
  npm run finance:seed-demo -- --company <companyId>
  ```
  (If `vite-node` is not found: `npx vite-node -c vitest.config.mts scripts/seed-finance-demo.ts -- --company <companyId>`.)
- [ ] **AnOps AI is ON** for that company (`/ai/access`) and `GROQ_API_KEYS` is in `.env`. Add `GEMINI_API_KEYS` if you want to show a **PDF** receipt.
- [ ] Have **2 or 3 real receipt photos** on your laptop (a supermarket ticket, a fuel receipt, a café bill). Test them once.
- [ ] If you'll show Telegram: the bot is reachable (production webhook, or `telegram:poll` running locally), and your phone is connected in **Receipts › Connect Telegram**.
- [ ] Open these tabs in order: `/finance`, `/finance/receipts`, `/finance/invoices`, `/finance/payments`, `/finance/expenses`, `/finance/reports`.
- [ ] Have one terminal ready with the tests, in case you're asked to prove they pass:
  ```bash
  npx vitest run tests/integration/finance-service.test.ts tests/integration/finance-receipt-ocr.test.ts tests/unit/finance-insights.test.ts
  ```
- [ ] **Plan B:** take screenshots of every step of the demo. If the internet or the AI is down, you present from the screenshots.

---

## 2. The story (what to say in the first 2 minutes)

Start with the problem, not with the code.

> "A small business in Tunisia spends hours every month typing receipts, chasing unpaid invoices and guessing its cash flow. My module is the finance part of AnOps: invoicing, payments, expenses and reports, with AI doing the boring work. But the AI never touches the money on its own: **figures come from code, the AI only reads and explains**, and a person always confirms."

Then give the **one-sentence promise** of each requirement from the project brief:

| Brief requirement | What I built |
|---|---|
| Invoice builder tied to products | Invoices from the product catalogue, Tunisian VAT (19/13/7/0 %), **timbre fiscal**, draft → posted, credit notes, duplicate, e-mail to the customer |
| Expense management with categories and approval | Draft → submitted → approved/rejected → paid, **nobody approves their own expense**, AI category suggestion, anomaly flags |
| Payment tracking, paid/unpaid, balances | Payments split across invoices, exact balances in cents, **smart matching** of payments to invoices, reversals |
| Financial dashboard, income vs expenses | 6-month chart, **30/60/90-day cash-flow forecast**, AI insights, reports page with Excel export |
| AI expense OCR (receipt → amount, date, vendor) | Photo or PDF → **vision AI** reads it → checks → **draft expense**; also from **Telegram**; bulk upload |

**Extra (beyond the brief):** a **Finance Copilot** (chat assistant limited to finance), Telegram receipt capture, receivables aging, customer payment-risk badges.

---

## 3. Live demo script (8 minutes)

Follow this order: it tells a story from "money spent" to "money understood". Say the **bold sentence** at each step.

### Step 1: Scan a receipt (the wow moment, ~2 min)
1. Open **Receipts**. Drop a real receipt photo.
2. Click **Scan receipt**. In 1 to 2 seconds the review panel appears: photo on the left, fields on the right.
3. Point at: vendor, date, amounts, the **category picked from the company's own list**, the **confidence badge**.
4. **"The AI only proposes. I check the values, and nothing is saved until I click."** Click **Save as draft**.
5. Drop the **same photo again**: "Already scanned". **"Duplicate receipts are detected by their content, so the same ticket can't be paid twice."**

> If the receipt has a **timbre fiscal** (1.000 DT), say: "The checks know Tunisian receipts: the timbre fiscal is added to the tax, so the expense equals exactly what was paid."

### Step 2: Telegram (optional, ~1 min, very impressive if it works)
1. On your phone, send a receipt photo to the AnOps bot.
2. Show the reply ("Draft expense saved ✓", vendor · date · total, link), then refresh **Expenses**.
3. **"An employee in a café takes a photo, and the expense is already in the system. The bot knows who they are from a secure one-time link, never from the message."**

### Step 3: Expenses (~1 min)
1. Open **Expenses**: point at the flags (**Possible duplicate** on the two Mytek monitors, **No receipt** on the laptop).
2. Click **+ New Expense**, type the vendor `Ooredoo`, press Tab: the **category suggestion** appears with its reason.
3. **"Flags are computed by code, so they're the same every time; the AI is used only where understanding text helps."**

### Step 4: Invoices and payments (~2 min)
1. **Invoices** → click **Overdue**: the late invoices.
2. Open a posted invoice: show **Credit note**, **Send by email**, **Draft payment reminder**. Click the reminder: **"It writes a polite reminder in French with the exact amount and due date taken from the invoice; it can't invent numbers."**
3. **Payments** → the green **Match** button on an unallocated payment → the dialog is already filled. **"It reads the bank reference and finds the invoice."**

### Step 5: Dashboard, Copilot, reports (~2 min)
1. **Dashboard**: the cash-flow forecast → click **Get insights** (3 sentences quoting real figures).
2. Open the **Finance Copilot** → click "Show the receivables aging". **"It's the same AI engine as the rest of AnOps, but it can only see finance tools, and any change goes through a review form."**
3. **Reports** → click **Excel**: open the file.

---

## 4. Technical part (if the teacher asks "how does it work?")

Keep a simple picture in mind:

```
 Photo / PDF ──► Storage (GridFS, file type checked from its bytes, SHA-256 duplicate check)
                     │
                     ▼
              AI gate (permissions, limits, token budget)
                     │
                     ▼
        Vision model (Gemini first, Groq as fallback)
                     │   returns JSON: vendor, date, amounts, category, confidence
                     ▼
        Code checks: totals add up? date valid? currency? category in the company's list?
                     │   failed checks lower the confidence and become warnings
                     ▼
        Review screen ──► person confirms ──► DRAFT expense (linked to the receipt)
```

**Stack:** Next.js 16 (App Router, Server Components, Server Actions), TypeScript, MongoDB, Zod validation, Tailwind; AI through the project's provider layer (Groq / Gemini / OpenRouter); Vitest for tests.

**Code organisation (point at the folders):**

| Layer | Folder | Role |
|---|---|---|
| Pages | `src/app/(dashboard)/finance/` | Screens only, no business logic |
| Actions | `src/features/finance/actions/` | Validate input, call the service |
| Business rules | `src/server/services/finance.service.ts` | Every rule, every query |
| Receipts / Telegram / AI | `src/server/finance/` | OCR pipeline, storage, bot handler, AI helpers |
| Pure calculations | `src/features/finance/utils/` | Money in cents, timbre, flags, matching, forecast: unit-tested |

---

## 5. Points that show quality (say at least three)

These are what separate a "student CRUD" from a real product. Pick the ones you can explain confidently.

1. **Money is exact.** Every calculation is done in whole cents, so `0.1 + 0.2` is never `0.30000000000000004`. Currencies are never added together; the dashboard switches currency instead.
2. **No race conditions on money.** Payment allocation, credit notes and reversals run in a **database transaction** with conditional updates. *I have a test where two payments hit the same invoice at the same time: only one succeeds, the invoice is never overpaid. That test fails on the old code.*
3. **Multi-tenant security.** Every query is filtered by `companyId`; another company's invoice id just returns "not found". Tested.
4. **Permissions by role** (owner, admin, operator, viewer), checked on the server for every action, not only by hiding buttons. **Separation of duties:** you can't approve your own expense.
5. **Audit trail:** every finance change is logged (who, what, when), without storing private text.
6. **AI safety:** the AI never decides alone. It proposes, code checks, a person confirms. AI output is validated with a schema; if it's unreadable, one repair attempt, then a clear error. The confidence shown is honest (the old version invented "92 %").
7. **File safety:** a `.exe` renamed to `.jpg` is refused, because the type is read from the file's bytes, not its name.
8. **Tested:** over 200 finance tests (unit + integration on a real MongoDB replica set), plus "evals" proving the Copilot can't use other modules' tools or write without confirmation.

---

## 6. Likely questions and good answers

| Question | Answer |
|---|---|
| *"What if the AI reads the receipt wrong?"* | "It never saves anything by itself. Code checks the result (totals, date, tax), lowers the confidence and shows warnings; the person corrects the fields before saving." |
| *"Why not let the AI calculate the totals?"* | "Language models are not reliable at arithmetic. Numbers come from code; the AI only reads text and writes explanations." |
| *"What happens if the AI provider is down?"* | "It falls back to another provider. If none works, there's a clear message and everything can still be entered by hand. The AI is a helper, not a dependency." |
| *"How do you prevent one company seeing another's data?"* | "The company comes from the session, never from the request; every query has `companyId`; there are tests that try to read another company's records." |
| *"How is the Telegram bot secure?"* | "Staff connect with a one-time link that expires in 15 minutes and is stored only as a hash. Every photo re-checks that the person is still a member with the right role." |
| *"Why MongoDB transactions?"* | "Allocating a payment changes three documents (payment, invoice, allocation). Without a transaction, a crash or two simultaneous clicks could leave them inconsistent." |
| *"How did you test it?"* | "Unit tests for the pure logic (money, OCR checks, matching, forecast), integration tests on a real MongoDB, concurrency tests, AI tests with a stubbed model, and a manual test guide (`docs/oussema/oussema-finance-manual-test.md`)." |
| *"What would you add next?"* | "PDF attachment for invoice e-mails, recurring invoices, bank statement import for automatic matching, and an accountant-confirmed tax configuration." |
| *"What was the hardest part?"* | Choose a true one: "Making receipt OCR reliable: the first vision model I configured had been removed by the provider, and the timbre fiscal was silently lost in the total; live testing found both." |

---

## 7. Mistakes to avoid

- ❌ Starting with the code or the folder structure. Start with the **problem and the demo**.
- ❌ Saying "the AI does everything". Say **"the AI reads and explains; code calculates; people decide."**
- ❌ Demoing on your real company data or sending a real e-mail to a customer.
- ❌ Reading slides word for word. Use this guide as notes; talk to the teacher.
- ❌ Claiming something you didn't check. If you don't know, say "I'd check that in the code," then show where (`finance.service.ts`).

---

## 8. Short version (5 minutes)

1. **Problem + promise** (30 s): Section 2's quote.
2. **Scan a receipt** (2 min): drop a photo → review → save → drop again ("Already scanned").
3. **Dashboard + Copilot** (1.5 min): forecast, Get insights, "Show the receivables aging".
4. **Three quality points** (1 min): exact money in cents, transactions (the race test), AI proposes / people confirm.

---

## 9. Where everything is documented

| Document | Use it for |
|---|---|
| `docs/oussema/oussema-finance-plan.md` | The plan and design decisions |
| `docs/oussema/oussema-finance-tasks.md` | Every task and its status |
| `docs/oussema/oussema-finance-progress.md` | What was done, how it was verified, bugs found |
| `docs/oussema/oussema-finance-manual-test.md` | Step-by-step test of every feature |
| `docs/ARCHITECTURE.md` (Finance section) | Where the code lives |
| `docs/ROLES_AND_PERMISSIONS.md` | Who can do what |

Good luck: you built a real product. Show it with confidence.
