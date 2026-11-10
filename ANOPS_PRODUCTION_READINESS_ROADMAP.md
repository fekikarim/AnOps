# AnOps — Production Readiness Roadmap

Continues `docs/karim-feki/FULL_PROJECT_AUDIT.md`. Rules: no commits/pushes, disposable DBs only (`anops_ready` on the local replica set `127.0.0.1:27018`, never the dev DB on 27017), Stripe test mode only, no real e-mail/SMS/AI calls, no secrets in output.
Test server: `next start -p 3100` with `MONGODB_URI=…/anops_ready…`, `EMAIL_SERVER_HOST=127.0.0.1 EMAIL_SERVER_PORT=2525` (dead port, nothing is sent).
Resume rule: read the "Exact next step" of the first batch that is not Completed.

## Status

| Batch | Scope | Status |
|---|---|---|
| 0 | Repository verification and remediation planning | Completed |
| 1 | Authentication and security hardening | Completed |
| 2 | RBAC, application entitlements, AI authorization | Completed (live role matrix verified in Batch 5) |
| 3 | Accessibility and Finance UX | Completed (live keyboard checks in Batch 5/8) |
| 4 | ESLint and code quality | Completed |
| 5 | Manufacturing, Marketing, Community, HR browser testing | Completed |
| 6 | Stripe and subscription lifecycle | Completed (see limits) |
| 7 | Performance and scalability | Completed (measured; remote-DB test blocked) |
| 8 | Full regression and final verification | Completed |

## Batch 0 — Verification (Completed)
Verified against the current tree (branch `feat/ui-and-payment`; earlier work already committed by the owner, audit fixes uncommitted):
- Reset tokens stored raw (`passwordResetToken`) — present. No CSP header — present. Viewer role reads Finance/Marketing — present. `/api/v1/ai/health` open to any signed-in user — present. Legacy register enumerates — present. Email in auth logs — present. `===` admin password compare — present.
- Lint: 30 errors reported by `eslint src tests` (29 in `src`, 1 in `tests/unit/hr-assistant-agent.test.ts`); the root `eslint .` also scans `.agents/.claude/.opencode` agent-tooling folders (not project code).
- Dependencies between fixes: reset tokens and auth hardening are independent; RBAC change must precede browser tests (they exercise roles); lint last-but-one so earlier edits are included; Stripe/perf tests need the final build.
- Order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8.

## Batch 1 — Authentication and security hardening (Completed)
Done:
- **Reset tokens:** `server/auth/reset-token.ts` (256-bit CSPRNG token, SHA-256 hash, constant-time compare, `maskEmail`). Only `passwordResetTokenHash` is stored; consumption is one atomic `findOneAndUpdate` (single use, race-safe); expiry 1 h kept; password change/reset clears all reset fields; new request replaces the old link; legacy plain-text field no longer honoured.
- **CSP:** `server/security/csp.ts` + `proxy.ts`: per-request nonce, `script-src 'self' 'nonce-…' 'strict-dynamic'` (no unsafe-inline/eval in production), `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action` self + Stripe, `upgrade-insecure-requests`; root layout reads `x-nonce` and passes it to `<Script>`. Fonts were hot-linked from `fonts.gstatic.com` and were blocked by the policy — self-hosted under `public/fonts/` instead of widening `font-src`. Styles keep `'unsafe-inline'` (React `style=` attributes cannot carry a nonce; documented in the module).
- **Auth hardening:** legacy registration answers identically for new/existing addresses and sends nothing for existing ones; e-mail addresses masked in all auth/reset/verification logs; environment-admin password compared in constant time.
Files: `server/auth/reset-token.ts` (new), `server/security/csp.ts` (new), `proxy.ts`, `app/layout.tsx`, `app/globals.css`, `public/fonts/*` (new), `features/auth/actions/{password-reset,password-reset-request,force-reset,register,resend-verification}.action.ts`, `server/auth/index.ts`, `server/platform/profile.service.ts`.
Tests: `tests/integration/password-reset.test.ts` (8: hashed storage, valid, reused, concurrent, expired, unknown, hash-replay, legacy plain token, replaced link, unknown account, enumeration, helpers), `tests/unit/csp.test.ts` (4).
Evidence (live, production build): response header `content-security-policy` present with fresh nonce per request; 0 CSP violations on `/`, `/apps`, `/pricing`, `/help`, `/login`, `/get-started`, `/anops`, `/finance`, `/finance/invoices/new`, `/hr`, `/inventory/products`, `/organization`; theme toggle, AI demo, login, Stripe Checkout redirect and service-worker registration all work; both self-hosted fonts load.
Outstanding: none for this batch. Next step: Batch 2.

## Batch 2 — RBAC, entitlements, AI authorization (Completed)
Decision: the employee-role reads of Finance (incl. reports and payments), Purchasing (supplier terms/prices) and Marketing (contact list, personal data) were a side effect of one shared `READ_PERMISSIONS` list, not a documented rule, and no UI or HR privacy rule depends on them. Default is now least privilege.
- `server/security/permissions.ts`: `TEAM_READ_PERMISSIONS` (HR own-records, Inventory, Manufacturing, Community) for every role; `BUSINESS_READ_PERMISSIONS` (Purchasing, Finance, Finance reports, Marketing) for manager (operator), admin, owner only. `roleMayOpenApp()` maps Finance/Purchasing/Marketing to their read permission.
- `server/platform/access.ts`: the application list (`access.apps`, used by /anops, Dock, ⌘K switcher, sidebars, layouts) and the server guard `assertAppAccessFor` both apply plan ∩ member app access ∩ role. So the UI hides the apps and the server refuses direct URLs, server actions and exports (403) for the same reasons. `assertAiEntitled` added for AI features (trial / MaxOps / Custom with add-on).
- `/api/v1/ai/health`: owner/admin only (unchanged) **plus** AI-features entitlement; returns only `{available, paused}` (no provider names, env-variable names, limits or database facts) via `toTenantHealth`. Platform diagnostics (`getAiHealth`) remain for scripts only.
- Company AI switch, per-member AI grants and the AI capability ceiling are untouched; the ceiling correctly now rejects granting AI finance/marketing/purchasing access to an employee.
Files: `server/security/permissions.ts`, `server/platform/access.ts`, `server/ai/health.ts`, `app/api/v1/ai/health/route.ts`.
Tests: new `tests/unit/role-permissions.test.ts` (3), `tests/unit/ai-health.test.ts` (2), `platform-lifecycle` (+AI-by-plan matrix: trial, OneOps, AllOps, MaxOps, Custom without/with add-on, lapsed; employee role gate); adapted `ai-guards`, `ai-access`, `ai-finance`, `ai-purchasing`, `ai-marketing`, `marketing` tests to the new default (employees: FORBIDDEN on contact list, AI finance grant rejected).
Outstanding: live per-role browser matrix → Batch 5.

## Batch 3 — Accessibility and Finance UX (Completed)
- New `useDialog` hook + `DialogOverlay` component (`shared/hooks/use-dialog.ts`, `shared/components/ui/dialog-overlay.tsx`): `role="dialog"`, `aria-modal`, name, focus moves into the dialog (first field), Tab trapped, Escape closes only the topmost dialog (nested-safe stack), focus restored to the opener. Applied to the five audited modals (invoice void, expense reject, payment allocation, leave review, policy library) and upgraded on the 8 HR modals (they previously had Escape + role only). The unused `useEscapeKey` was removed (superseded).
- Finance forms: every label linked to its control (invoice builder 12, expense form 8, void/reject/notes textareas); computed totals use `<output aria-labelledby>`; existing `TextField` fields already associated.
- Record Payment: new `PaymentForm` (design-system styled): date defaults to today (browser time zone, set after hydration), success confirmation with link, error `role=alert`, labelled controls, 44 px targets; server page now has its own title "Record payment | Finance | AnOps ERP".
- Copilot overlap (Batch audit F6) kept; `<main>` added to `AuthCard` (login/register/reset…), onboarding and offline pages (invite/activate/ready already had it via `PlatformShell`; organization layout done earlier).
Tests: covered by the live checks in Batch 5/8; component-level behaviour is not unit-tested (no DOM test environment in this repo).

## Batch 4 — ESLint (Completed)
`npx eslint .` → **0 errors** (75 pre-existing warnings: unused vars, `<img>`). 30 → 0:
- 12 unescaped quotes/apostrophes (HR) → HTML entities.
- 10 `set-state-in-effect`: Portal and ThemeToggle → `useSyncExternalStore`; sidebar app switcher and offline indicator → state adjusted during render + timer effect only; attendance clock → new `useNow` (external store); departure-review and leave-history modals → derived loading state + async effects (no synchronous setState); employee modal → reseed on open/employee change during render; offline sync manager → promise callbacks.
- 8 `any` → `unknown` + exact types (`offline-store`, sync manager, one test).
- Scope: `.agents/**`, `.claude/**`, `.opencode/**` (vendored assistant tooling, 53 `require` errors) added to `globalIgnores`; no rule disabled anywhere.
Evidence: tsc 0 errors; full suite 82 files / 1,246 tests passed.

## Batch 5 — Browser testing (Completed)
Production build, disposable DB `anops_ready`, org "MfgCo" (grandfathered full access) with owner, admin, manager, employee and an inventory-only manager. Nothing external was sent.
| Area | Workflow tested | Expected | Actual | Result |
|---|---|---|---|---|
| Manufacturing | BOM: empty submit, product as its own component, valid 2-component BOM, activate | Validation, then Active locked BOM | "A product cannot be a component of itself"; BOM Active | Pass (note: empty selects say "Invalid identifier" — wording could be friendlier) |
| Manufacturing | Work order qty 0, qty 20, start, complete | Refuse 0; consume 20 frames + 40 glass; +20 windows | Refused; stock FRAME 100→80, GLASS 50→10, WINDOW +20 with "Production (output)" movement | Pass |
| Manufacturing | Work order for 30 (needs 60 glass, 10 on hand) | Completion refused, stock untouched | "Insufficient stock for GLASS: 10 available, 60 required"; stays In progress | Pass |
| Marketing | Contact: invalid email, valid with consent, duplicate | Validation; saved; duplicate refused | Pass; **defect**: duplicate showed generic "A record with the same unique value… Reload the page" | Fixed: `isDuplicateKeyError` (survives the transaction wrapper) + test |
| Marketing | Template with unknown variable / valid; audience; campaign draft → submit for approval | Validation; draft; pending approval, nothing sent | "Unknown variable {{firstName}}. Allowed: …" (correct); campaign Pending approval, not approved/sent | Pass |
| Marketing | Manager on the pending campaign; employee on all Marketing URLs | Manager cannot approve; employee locked out | No approve button for manager; employee redirected to /anops?locked=marketing | Pass |
| Community | Manager writes article (draft), owner publishes; forum topic; employee view | Draft hidden from employee; employee read-only | Draft → Published (counter 1); topic created; employee sees only the published article, no write/edit controls | Pass (observation: article Category dropdown is empty and unlabeled when no categories exist) |
| HR | Department; employee (validation: bad email, negative salary, custom job title); keyboard (Escape, focus restore) | Validation; created; dialog semantics | Native validation; custom title needs the "Add" confirm first (otherwise "Please select or enter a job title" — UX friction, unchanged); Escape closes and focus returns to opener; dialog named "Employee" | Pass |
| HR | Employee requests leave (reversed dates, valid 3 days) → admin approves via review dialog | Only valid request created; balance preview; approval | One request (reversed range not created); "Available 24, requesting 3, leaving 21"; dialog "Review leave request" focus/Escape/restore OK; Approved | Pass |
| HR | Payroll generation (admin); employee view | Payslip PAY-2026-10 gross 2,400 TND; employee sees own data only | 2,400 TND, deductions 0 (no statutory deductions modelled); employee sees only own balance, no colleagues | Pass (payroll deductions are not a legal-compliance claim) |
| Roles | owner/admin/manager/employee/limited × Finance, Marketing, Purchasing, Manufacturing, Inventory, exports, AI health | Per Batch 2 matrix | Employee: Finance/Marketing/Purchasing hidden + redirected, supplier/PO/finance exports 403; limited: Inventory only; AI health 200 owner/admin, 403 manager/employee/limited | Pass |
Defects found in this batch: duplicate-contact message (fixed + `tests/unit/duplicate-key.test.ts`); CSP `upgrade-insecure-requests` broke plain-HTTP deployments (fixed, only sent on HTTPS requests; test added). Unfixed minor UX: "Invalid identifier" wording on empty product selects; empty article Category select; job-title custom entry needs "Add".

## Batch 6 — Stripe lifecycle (Completed, test mode)
Environment: Stripe test mode through the app's own test key (the CLI's saved login had expired — needs a user `stripe login`); `stripe listen` forwarded signed events to the disposable server with a real signing secret; no card numbers were typed (Stripe `pm_card_visa` / `pm_card_chargeCustomerFail` test tokens).
| Check | Result |
|---|---|
| Checkout session creation (UI → checkout.stripe.com) | Pass |
| Checkout cancellation (cancel URL) | Pass: "Checkout was cancelled. Nothing was charged.", plan unchanged |
| Forged success redirect (`?checkout=success&session_id=cs_test_forged`) | Pass: no change — the redirect is never proof of payment |
| Signature: missing / garbage / tampered body / stale timestamp | Pass: 400 "Invalid signature" |
| Idempotency: same signed event twice | Pass: 1st processed, 2nd `duplicate`, one stored row |
| Successful subscription (AllOps, €45) → webhooks | Pass: org plan allops/active, invoice synced (paid), audit trail `billing.subscription_synced` |
| Entitlements after AllOps | Pass: 9 apps, no AnOps AI, AI health 403, /ai locked |
| Upgrade → MaxOps | Pass: AnOps AI app appears, AI health 200, /ai opens |
| Downgrade → Custom (Finance+Inventory, no AI) | Pass: only 2 apps; Purchasing locked, supplier export 403, AI health 403 |
| Cancel at period end (UI, confirm dialog) | Pass: "Cancels at period end — access until Dec 10", access kept |
| Immediate cancel in Stripe | Status `canceled`; access follows the app rule "paid period stays usable until its end" (business decision — noted) |
| Failed payment (declined test card) | `invoice.payment_failed` received (200), invoice stored as `open`, no access granted by an incomplete subscription |
| Expiry / lapse and past-due grace | Covered by integration tests (`platform-billing`, `platform-lifecycle`: lapsed → everything closes); not reproduced live (needs Stripe test clocks) |
Limits: Stripe-hosted Checkout payment page was not driven (no card entry); subscriptions were created through the Stripe API with the same metadata and amounts the app's Checkout produces. OneOps free-plan and trial → paid transitions are covered by tests, not by Stripe.

## Batch 7 — Performance and scalability (Completed; findings documented, not changed)
Conditions: production build, `next start`, local MongoDB 8 replica set on the same machine (no network latency), disposable DB `anops_ready`, one org with **10,003 products + balances, 20,001 invoices, 1,001 customers, 50,005 stock movements, 501 employees** (cloned from real documents created through the UI so shapes are exact), measured with `fetch` from the signed-in browser (HTML incl. RSC payload), 2 requests per page (cold, warm), MongoDB profiler for query plans.
| Page / API | Cold | Warm | Payload | Note |
|---|---|---|---|---|
| /anops, /organization, /marketing, /manufacturing/work-orders | 14–22 ms | 15–22 ms | 18–67 KB | |
| /inventory/products (paginated) | 47 ms | 47 ms | 104 KB | search "SEED-0999": 19 ms |
| /inventory/stock | 71 ms | 82 ms | 187 KB | |
| /inventory (dashboard) | 460 ms | 443 ms | 89 KB | reads all 10k products to compute low stock (profiler: ~10 batches of 1,000) and scans movements |
| /finance/invoices (paginated, 20k rows) | 22 ms | 22 ms | 135 KB | status filter 21 ms |
| /finance | 238 ms | 229 ms | 102 KB | |
| /finance/payments | 236 ms | 237 ms | **1.8 MB** | loads every unpaid invoice for allocation suggestions |
| /finance/customers | 111 ms | 103 ms | **4.4 MB** | all 1,001 customers rendered, search is client-side |
| /finance/reports | 100 ms | 95 ms | **1.5 MB** | |
| /hr | 91 ms | 89 ms | **3.7 MB** | whole employee directory (501) in one page |
| Excel export finance-reports (1,012 rows) | 73 ms | | 38 KB | |
| Excel export products / stock-on-hand (10,003 rows), stock-movements (50,005) | 15–72 ms | | | refused by design: "limit is 10,000. Narrow the filters" (clear 400); filtered export (`q=SEED-00`) 200, 8 KB |
Query plans: no collection scans on application data (new indexes in effect); slowest single queries 38–58 ms; 4 pages ≈ 112 DB operations (about 28 each, mostly data queries — identity/tenant plumbing is the 10–13 measured earlier). Stock-movement dashboard queries examine all 50,005 index keys to return 8–25 rows (index `{companyId, createdAt}` plus an unindexed filter) — fine at 50 k, will grow linearly.
What is fine: paginated lists (products, invoices, stock), search, tenant-scoped indexes, export row cap and its message, sub-100 ms server time on every paginated page.
What does not scale (recommendations, in priority order): (1) paginate/search server-side the Customers, Payments (cap/limit the unpaid-invoice list used for suggestions), HR directory and Finance Reports pages — payloads of 1.5–4.4 MB make phones slow long before the server is; (2) compute the Inventory dashboard low-stock figures with an indexed query/aggregation instead of scanning every product; (3) add an index covering the filtered field of the movement dashboard queries. N+1: none found in the measured pages (operations per page are constant, not proportional to rows).
Not measured / blocked: remote managed MongoDB (no safe remote test environment available) — with ~13 sequential-ish identity/tenant lookups per page, a 30 ms round trip would add roughly 150–400 ms per page (estimate from op count, **not measured**); concurrency/load testing; mobile-network timing.

## Batch 8 — Regression and final verification (Completed)
Final results on the last build: `tsc` 0 errors; `eslint .` 0 errors (75 warnings); `vitest` 83 files / 1,248 tests passed; `npm run build` compiles. Live re-checks on the final build: CSP header and no violations, hashed reset token only, duplicate-contact message, Record payment (labels, default date incl. after save, confirmation, title), invoice form 0 unlabelled controls, `<main>` on login/register/forgot/organization/profile/finance. One late defect found and fixed: the Record-payment date was cleared by React's automatic form reset after saving (now a controlled submit with explicit reset).
Cleanup: test server stopped, disposable DB `anops_ready` dropped, Stripe listener stopped and temporary key/secret files deleted, remaining Stripe test objects are test-mode only.
Final report: `docs/karim-feki/PRODUCTION_READINESS_REPORT.md`.
Exact next step for whoever continues: (1) in staging, test against a remote MongoDB and complete a hosted Stripe Checkout payment; (2) add server-side pagination to Customers, Payments, HR directory, Finance Reports; (3) decide the two policy questions in report §9.4–9.5. Nothing in this phase is committed.
