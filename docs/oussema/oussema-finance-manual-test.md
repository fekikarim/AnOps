# Finance Module: Manual Test Guide

A walk-through of the whole Finance module on realistic data. Each step says what to do and what you should see.
Plan and progress: [oussema-finance-plan.md](oussema-finance-plan.md) · [oussema-finance-progress.md](oussema-finance-progress.md)

## 0. Setup

1. Sign in as the **owner** of a test company (not a company with real books).
2. Find the company id (in MongoDB, `companies` collection), then load the demo data:

   ```bash
   npm run finance:seed-demo -- --company <companyId>
   ```

   Expect: `Demo finance data added to <company>: 6 customers, 14 invoices, 8 payments, 18 expenses.`
   Remove it afterwards with `npm run finance:seed-demo -- --company <companyId> --clean`. Only records the script created are removed.
3. AI features need **AnOps AI turned on** for the company (`/ai/access`, owner or admin) and a provider key in `.env` (`GROQ_API_KEYS` for photos; add `GEMINI_API_KEYS` to also read PDFs).
4. If `npm run …` says `vite-node` is not recognised, run the same command with `npx vite-node -c vitest.config.mts scripts/<file>.ts -- …`.

## 1. Dashboard (`/finance`)

| Step | Expected |
|---|---|
| Open `/finance` | KPIs, the 6-month income vs expenses chart, the 30/60/90-day **cash-flow forecast**, and Finance modules including **Reports**. |
| Look at **Overdue Receivables** | 4 overdue invoices: 2 unpaid (Atlas Distribution, Bizerte Marine) and 2 partly paid (Sousse Hospitality, Nabeul Ceramics), with their balances. |
| Click **Get insights** | Three bullets quoting your real figures (with "TND"). Clicking again the same day shows "From earlier today" (cached). |
| If invoices exist in another currency | A **Currency** switcher; EUR figures never appear on the TND dashboard. |

## 2. Customers (`/finance/customers`)

| Step | Expected |
|---|---|
| Read the list | Each customer shows a badge: **Reliable payer** (paid on time), **Watch**, **Payment risk** (2+ overdue) or **No payment history**, plus "pays in N days · X% on time · owes …". |
| Delete a customer that has invoices | Two-step **Delete → Confirm**; the customer is **deactivated**, not deleted, with a message saying so. |

## 3. Invoices (`/finance/invoices`)

| Step | Expected |
|---|---|
| Use the filters | **Overdue** shows 4; **Drafts** 2; **Credited** 1 (Sfax Olive Export). |
| Search `atlas`, then an invoice number | The matching invoices; regex characters like `(.*` find nothing (searched literally). |
| **+ New Invoice**: add a line, keep **Timbre fiscal** ticked | Total = subtotal + VAT + 1.000 TND. Unticking it removes the 1.000. Not shown for EUR/USD. |
| Open a **draft** | **Edit Draft**, **Delete Draft** (two-step), **Duplicate**, **Post Invoice → Confirm post**. |
| Open a **posted** invoice | No Edit/Delete. **Duplicate** opens a new draft dated today. **Credit note**: an amount up to the balance plus a reason gives `CN-YYYY-NNNNN`, and the balance drops by that amount. |
| **Send by email** (use your own address) | The e-mail contains the full invoice (lines, VAT, timbre, paid, credits, balance). The page shows "Last sent … to …". |
| **Draft payment reminder** on an overdue invoice | A firm reminder with the exact invoice number, balance and due date, editable; **Copy** / **Open in mail app**. Nothing is sent automatically. |
| In **Payments and credits** on a paid invoice, **Reverse** a payment with a reason | The balance comes back, the payment's unallocated amount goes up, and the entry stays visible as reversed. |

## 4. Payments (`/finance/payments`)

| Step | Expected |
|---|---|
| Find the payment "Virement INV-…" | A green **Match INV-…** button. Clicking it opens the dialog already filled in. |
| Find "Cheque 004512" | **Match** on the invoice whose balance equals the amount. |
| **Allocate →**, then **Auto distribute** | Only invoices in the payment's currency are offered. Allocating more than the balance is refused. |

## 5. Expenses (`/finance/expenses`)

| Step | Expected |
|---|---|
| Read the list | Flags under the vendor: **Possible duplicate** (the two Mytek monitors), **No receipt** (anything over 200 without a receipt, e.g. the Mytek laptop), **Weekend** (depending on the dates). **Unusually high** appears only when a category has at least 5 earlier expenses (the demo's Utilities & Rent has enough history; an unusually large internet bill would be flagged). Hover for the reason. |
| **+ New Expense**, type vendor `Ooredoo`, press Tab | **Utilities & Rent** suggested, with "Used for N earlier expenses from Ooredoo" and a **Use** button. The category starts empty (no silent default). |
| Edit the **rejected** "Le Golfe" expense | The rejection reason is shown; saving puts it back to draft. |
| Approve an expense you created, as an **admin** who isn't the owner | Refused: someone else must approve it. |

## 6. Receipts (`/finance/receipts`)

| Step | Expected |
|---|---|
| Drop a receipt photo or click to choose one | A thumbnail, then **Scan receipt**: "Reading receipt…" and, in a few seconds, a review panel with the photo next to the fields. |
| Check the review | Vendor, date (DD/MM/YYYY becomes YYYY-MM-DD), net, tax, currency, a category from **your** list, a confidence badge, and warnings if the totals don't add up. A receipt with a 1.000 timbre: tax includes it, total = what was paid. |
| **Save as draft** | The row shows **Expense created**; the expense is a draft with the receipt attached. The same receipt can't create a second expense. |
| Scan the same file again | "Already scanned", showing the earlier result with no new AI call. |
| Upload a `.exe` renamed to `.jpg` | Refused: the type comes from the file's content, not its name. |
| A PDF invoice | Works only with `GEMINI_API_KEYS` set; otherwise "No configured AI provider can read this file type". |

## 7. Telegram receipts

Needs the bot (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`) and either the production webhook (`APP_URL` public HTTPS, registered from Marketing › Integrations) or, locally, the poller: `npx vite-node -c vitest.config.mts scripts/telegram-poll.ts --`. Only one poller or webhook can be active for the shared bot.

| Step | Expected |
|---|---|
| Receipts › **Connect Telegram** → **Open in Telegram** → **Start** | The bot: "Connected to <company> on AnOps Finance" plus tips. The card shows "Connected as @you". |
| Send a receipt photo (with a caption) | "Reading your receipt…", then "Draft expense saved ✓", vendor · date · total, category, confidence and a link. The caption is in the expense notes. |
| Send the same photo again | "You already sent this receipt." |
| Send a zip file | Refused: only photos and PDFs. |
| `/company` | The companies this chat sends to; `/company 2` switches. |
| Remove that member from the company, then send a photo | The chat is disconnected with a message. |

## 8. Finance Copilot (button on every Finance page)

| Step | Expected |
|---|---|
| Open it on the dashboard | "On: Finance dashboard", with prompts for that page. |
| "How is our cash flow for the next 90 days?" | A forecast card with the dashboard's exact figures. |
| "Show the receivables aging" / "Which expenses need a second look?" | An aging table, then the flagged expenses. |
| "Create a customer Test Ltd" | A **review form**; nothing is saved until you confirm. |
| Type `/products` | Refused in the Copilot (an inventory command); it still works in the full `/ai` workspace. |

## 9. Reports (`/finance/reports`)

| Step | Expected |
|---|---|
| Open it | Income, expenses, net, open receivables; aging per customer; expenses by category with shares; monthly P&L. |
| Switch the year or currency | The figures change; nothing is added across currencies. |
| **Excel** | `finance-reports-<year>-<cur>-<date>.xlsx` with Summary, Aging, Expenses by category and Monthly P&L sheets. |

## 10. Roles (sign in as each)

| Role | Can | Cannot |
|---|---|---|
| Viewer (employee) | See everything in Finance, reports, the Copilot (read) | Create, edit, post, allocate, approve; the scan button is replaced by a notice |
| Operator (manager) | Drafts, customers, expenses, receipts | Post or void invoices, credit notes, send invoices, allocate or reverse payments, approve |
| Admin | Everything except approving their own expenses | Approve an expense they created or submitted |
| Owner | Everything | — |
