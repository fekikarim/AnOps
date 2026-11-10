# AnOps — Full Project Audit

Date: 2026-11-09 · Scope: whole repository (public portal, platform lifecycle, organization management, all 10 applications, payments, permissions, security, performance, accessibility).
Method: automated checks, code review of every entry point, and live testing of a production build against a disposable database (never the development database; email sent to a dead local port; Stripe in test mode, no payment made).

## 1. Verdict

The platform is in good shape: architecture is consistent (server-resolved tenant, per-method permission checks, audited writes), no dependency vulnerabilities, 1,228 automated tests pass, and every core business flow tested live gave correct numbers.
The audit found **one high-severity authorization gap, one high-severity brute-force gap, and a set of medium issues. All of those were fixed and re-verified in this pass.** A short list of lower-risk items and recommendations remains (section 5).

| Check | Result |
|---|---|
| TypeScript | 0 errors |
| Tests | 78 files, **1,228 passed** (3 new regression tests added) |
| Production build | Compiles |
| `npm audit` (production deps) | 0 vulnerabilities |
| ESLint | 29 pre-existing errors in `src` (HR/offline components, style-level) — see 5.1 |
| Secrets in git | None (only `.env.example`) |
| Cross-tenant data access | No leak found (by ID, by URL, forged active-organization cookie) |

## 2. Fixed in this audit

### F1 — Plan and per-member app limits were not enforced on the server (HIGH)
Page layouts redirected users away from applications outside their plan, but nothing checked it for server actions, services or API routes. `assertAppAccess` existed and was never called.
Proof: an organization on the free plan (Finance only) received `200` and an Excel file from `/api/v1/exports/{products,suppliers,purchase-orders,stock-on-hand,stock-movements,goods-receipts}`; a member restricted to one app could use the others; an expired trial could still write through actions.
Fix: one guard (`assertAppAccessFor` / `assertWorkspaceAppAccess` in `server/platform/access.ts`) applied at every entry point:
- `runAction` derives the application from the operation name (`inventory.*`, `purchasing.*`, `manufacturing.*`, `marketing.*`) — no action module can forget it;
- `handleExport` takes the application (7 export routes updated);
- `getCurrentAuthUser/requireAuthUser/requireAdminUser(app)` for HR (all actions), Finance (all actions + service factory), Community;
- Finance receipts/AI/Telegram actions, HR assistant and advisor route, community chat route.
Verified live: locked app → `403`, own app → `200`; unit/integration tests added (`platform-lifecycle`, `exports`).

### F2 — No brute-force protection on sign-in (HIGH)
Unlimited password guesses per account. Fix: shared MongoDB-backed limits (per address+account 10, per account 40, per address 120 / 15 min) checked before any password work, a clear "Too many sign-in attempts" message, no account enumeration. Same protection added to password-reset requests, resend-verification and the legacy registration form (which could re-send verification mail to a victim, bypassing the one-minute throttle). Verified live: the 11th wrong attempt is blocked, a real user from the same address still signs in. Test added.

### F3 — Missing database indexes at runtime (MEDIUM, scales badly)
`users` (login lookup) and the original HR collections (`employees`, `departments`, `job_titles`, `leave_*`, `public_holidays`) were indexed only by a one-off migration script. On a fresh database every sign-in and every HR/Finance request did a full collection scan of every tenant's data (`getCurrentAuthUser` queries `employees` on each request). Fix: non-unique indexes added to `ensureIndexes` (default names kept so migrated databases do not conflict). Verified on a fresh database.

### F4 — Redundant identity/tenant lookups per request (MEDIUM, performance)
One page load cost 25 database operations, 21 of them repeated user/membership/company/subscription lookups (layout, nested layout, page each resolved the workspace again). With a remote database (20–50 ms per round trip) this becomes the main source of waiting. Fix: per-render memoization (`React.cache`) of the read-only page helpers `getPageWorkspace` and `getPageOrgAccess`. Result: **25 → 13 operations per page (−48 %)**; actions are unaffected (no staleness risk).

### F5 — Placeholder dashboard with fake numbers (MEDIUM)
`/dashboard` showed fixed sample KPIs ("Ordered Sales €96,000", "12 SKUs low stock") and linked to non-existent Projects/Documents (404s). The offline page and the PWA pre-cache still pointed at it. Fix: redirects to `/anops`; offline page and pre-cache updated.

### F6 — Floating Finance Copilot button covered the submit button (MEDIUM, UX)
At the bottom of Finance pages (e.g. New invoice) "Create Draft Invoice" sat flush with the viewport edge, partly under the button (3,500 px² overlap) and could not be clicked normally. Fix: scroll clearance below Finance pages when the Copilot is shown.

### F7 — Wrong payment status wording (LOW)
A payment with nothing allocated showed "Partially Allocated". Now "Unallocated" / "Partially allocated" / "Fully allocated".

### F8 — Keyboard and screen-reader access (MEDIUM, accessibility)
- HR modals (8) did not close on Escape and had no dialog semantics → now `role="dialog"`, `aria-modal`, named, Escape closes (`useEscapeKey`). Verified live.
- Organization management pages had no `<main>` landmark → added.
- `/ai` was missing from the proxy's protected routes (redirected to login without a return URL) → added.

## 3. Verified working (live, production build)

- **Public portal:** 24 public routes return 200 (all < 100 ms), 404 handled, sitemap/robots OK; all protected routes redirect to login; every API route refuses unauthenticated calls (401).
- **Account lifecycle:** registration with app selection, trial, free OneOps, activation window, login, logout.
- **Inventory:** warehouse, category, product with opening stock, low-stock alert, stock balances.
- **Purchasing → Inventory:** supplier, purchase order (draft → approved), goods receipt → stock 100 → 150 (exact).
- **Finance:** customer, invoice draft (10 × 25 + 19 % VAT + 1 DT stamp = 298.500 ✔), post, record payment, allocate, invoice becomes Paid, dashboard consistent.
- **HR:** department create, role-aware views (an employee sees only their own leave balance, never colleagues' salaries).
- **Roles (owner, admin, manager, employee, app-restricted employee):** pages, write controls and exports behave per role; app restriction enforced on pages and API after F1.
- **Multi-tenancy:** another organization's owner gets no data by invoice ID, organization ID, product ID, or with a forged `anops_active_company_id` cookie.
- **Payments:** Stripe test-mode Checkout session is created and redirects to `checkout.stripe.com`; the webhook, cron and Telegram/Brevo/delivery endpoints fail closed without their secrets/signatures (401/503).
- **Security headers:** nosniff, frame deny, referrer policy, COOP, HSTS, permissions policy; AI markdown renderer escapes HTML and only allows `http(s)` and `/` links; Stripe signature verified on the raw body; secrets compared in constant time; bcrypt cost 12.

## 4. Performance and smoothness

- Server-rendered pages respond in 20–160 ms on the local database with the full app set (empty/small data). After F4 each page needs 13 DB operations instead of 25; with F3 no hot query scans a collection.
- Client JS: `.next/static` 3.1 MB total; largest chunks 71 KB and 40 KB gzipped. No oversized bundle found.
- Homepage: animations use transform/opacity only, scroll progress is written to a CSS variable (no React re-render per frame), reduced-motion respected, no horizontal overflow from 320 px to 2560 px.
- Not measured: behaviour with large datasets (thousands of invoices/products) and with a remote managed database — recommended next (5.4).

## 5. Open items and recommendations (not changed)

### 5.1 Code quality
- 29 ESLint errors in `src` (HR/offline/sidebar `react-hooks/set-state-in-effect`, unescaped quotes, `any` in `offline-store`). Style-level, not user-facing bugs, but the lint step cannot pass in CI until they are fixed or the rule is scoped. (1 trivial error was fixed.)

### 5.2 Security (medium/low)
1. **Password-reset tokens are stored in plain text** (`users.passwordResetToken`, 1 h validity). A database read leak allows account takeover within the hour. Store a SHA-256 of the token and compare hashes.
2. **No Content-Security-Policy header.** All other headers are present. Add a nonce-based CSP (Next supports it) once inline scripts are inventoried.
3. **Viewer role is broad by design:** a plain `employee` can read Finance reports, payments, customers, supplier lists and Marketing contacts (personal data). HR is correctly restricted. Decide whether employees should see Finance/Marketing at all; if not, remove `FINANCE_REPORT_VIEW`, `FINANCE_READ`, `MARKETING_READ` from the viewer set. The UI also shows "+ Create invoice" style buttons to viewers; the server refuses the write (verified by service-level checks), but the buttons should be hidden.
4. `/api/v1/ai/health` is open to any signed-in user on any plan and lists which AI providers are configured. Restrict it to AI-entitled owners/admins.
5. Legacy `/register` form reveals whether an email is registered ("already exists"). The newer `/get-started` flow is the primary path; consider retiring the legacy form.
6. Sign-in/reset logs include the user's email address (PII in logs); the environment-admin bootstrap compares the password with `===` (not constant time). Low risk, easy to tighten.
7. Unique index on `users.email` is recommended after confirming the production data has no duplicates (the index added in F3 is deliberately non-unique so startup cannot fail).

### 5.3 Accessibility and UX polish
- Finance forms (invoice, payment, expense): labels are not associated with their inputs (11 of 12 invoice controls have no accessible name; clicking a label does not focus the field).
- 5 modals still lack dialog semantics/Escape: `invoice-detail-actions`, `expense-manager`, `payment-manager`, `leave-section`, `ai-hr-assistant`. Reuse `useEscapeKey` and the same attributes.
- `invite`, `onboarding`, `activate` pages have no `<main>` landmark.
- Record Payment: date field starts empty (default to today), no visible confirmation after saving, and the page title falls back to the marketing title.
- 12 modals total were checked; 8 were fixed.

### 5.4 Scale and operations
- Remaining per-request plumbing (13 operations) can drop further with a short-lived cache of membership + entitlements keyed by user/organization and invalidated on role/plan changes.
- Load-test with seeded volume (e.g. 10k products, 20k invoices) and a remote database before launch; check list pages for pagination and the Excel exports for row limits.
- Rate limits and sessions are stored in MongoDB (shared across instances) — good; consider adding monitoring on `RATE_LIMITED` and webhook failures.

### 5.5 Not covered by this audit
- Live calls to external AI providers (cost/privacy; the AI gate, privacy and budget logic are covered by the integration suite), real e-mail delivery, Telegram/Brevo/social integrations, Stripe webhook with a real signed event (covered by integration tests), a paid checkout to completion.
- UI-level CRUD for Manufacturing, Marketing and Community beyond page-load smoke (service-level behaviour is covered by the integration tests), HR employee/leave/payroll UI flows beyond smoke, and testing on physical phones.

## 6. Files changed by this audit
Security/authorization: `server/platform/access.ts`, `server/actions/run-action.ts`, `server/exports/route-handler.ts` + 7 export routes, `server/auth/rbac.ts`, `server/auth/index.ts`, `server/security/auth-throttle.ts` (new), HR/Finance/Community actions and routes, `features/auth/actions/*`.
Performance: `server/db/indexes.ts`, `server/tenancy/workspace.ts`.
UX/accessibility/cleanup: `app/(dashboard)/dashboard/page.tsx`, `app/(dashboard)/finance/layout.tsx`, `app/(workspace)/organization/[orgId]/layout.tsx`, `proxy.ts`, `shared/hooks/use-escape-key.ts` (new), 8 HR modals, `payment-manager.tsx`, offline page and PWA pre-cache.
Tests: `tests/integration/platform-lifecycle.test.ts`, `tests/integration/exports.test.ts`.
