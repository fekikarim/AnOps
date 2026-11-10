# AnOps — Production Readiness Report

Date: 2026-11-10 · Continues `FULL_PROJECT_AUDIT.md` · Roadmap with per-batch evidence: `ANOPS_PRODUCTION_READINESS_ROADMAP.md`
Method: production build (`next start`), disposable MongoDB replica set (never the development database), Stripe **test mode** only, e-mail pointed at a dead local port (nothing sent), no paid AI calls, no commits or pushes.

Legend — **Verified** = exercised live and/or by automated tests in this phase · **Partial** = some of it tested · **Untested** = not exercised.

## 1. Executive summary

All high-priority security findings of the audit are fixed and verified. The code base is clean (TypeScript 0 errors, ESLint **0 errors**, 83 test files / **1,248 tests passing**, production build compiles). The previously untested applications (Manufacturing, Marketing, Community, HR) were exercised in the browser and behave correctly; two defects found on the way were fixed. The Stripe lifecycle works end to end in test mode, including webhook signature, replay and idempotency protection.

**Verdict: ready for a controlled production launch (pilot customers), with one condition and three known scale limits.**
Condition: complete a pass of the platform's real Stripe Checkout payment page and a remote-database test in your staging environment (not possible here, see §9).
Known limits: Customers, Payments, HR directory and Finance Reports pages send everything in one response (1.5–4.4 MB at 1,000 customers / 501 employees); the Inventory dashboard scans all products; Excel exports are capped at 10,000 rows. None breaks correctness; they affect speed for large customers.

## 2. Issues fixed in this phase

| # | Area | Fix |
|---|---|---|
| 1 | Password reset | Tokens: 256-bit CSPRNG, only a **SHA-256 hash** is stored, atomic single-use consumption (race-safe), 1 h expiry kept, password change/reset clears every outstanding reset, newer request replaces older link, old plain-text tokens no longer accepted |
| 2 | CSP | Per-request nonce, `script-src 'self' 'nonce-…' 'strict-dynamic'` (no unsafe-inline/eval in production), `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action` self + Stripe; `upgrade-insecure-requests` only on HTTPS requests. Fonts were hot-linked from Google and blocked → **self-hosted** (`public/fonts`) |
| 3 | Employee role | Employees no longer read Finance (incl. reports/payments), supplier/purchasing data, or the Marketing contact list; managers/admins/owners keep them. Enforced in the app list (UI hides the apps), on pages, server actions, services and exports |
| 4 | AI health endpoint | Owner/admin **and** AI-features plan; returns only `{available, paused}` (no providers, env names, limits) |
| 5 | Auth | Legacy registration no longer reveals existing accounts and sends nothing for them; e-mails masked in all auth logs; environment-admin password compared in constant time |
| 6 | Dialogs | `useDialog`/`DialogOverlay`: role, aria-modal, name, focus in, Tab trap, topmost-only Escape (nested-safe), focus restored. Applied to the 5 audited modals and 8 HR modals |
| 7 | Finance forms | Every label linked to its control (invoice 12, expense 8, textareas); computed total is an `<output>`; new accessible **Record payment** form: date defaults to today, success confirmation, labelled, correct page title |
| 8 | Landmarks | `<main>` on auth cards, onboarding, offline (invite/activate/ready already had it via `PlatformShell`) |
| 9 | Lint | 30 errors → 0 without disabling any rule (state-in-effect patterns rewritten with external stores/derived state; `any` → proper types; quotes escaped); only non-project tooling folders (`.agents`, `.claude`, `.opencode`) excluded from the lint scope |
| 10 | Duplicate contact | Specific "email already a contact" message instead of "Reload the page" (duplicate detection now survives the transaction wrapper) |

## 3. Security verification evidence

| Requirement | Evidence | Status |
|---|---|---|
| Reset tokens hashed; valid / expired / reused / invalid / concurrent / replayed-hash / legacy-plain | `tests/integration/password-reset.test.ts` (8) + live DB check: only a 64-char hash stored, plain field absent | Verified |
| CSP | Live header on every page; **0 violations** on 12 public/auth/app pages, theme toggle, AI demo, login, Stripe Checkout redirect, service worker; unit tests (4) | Verified |
| Employees cannot read restricted Finance/Marketing/Purchasing data | Unit matrix (3), AI ceiling tests, live: employee tiles hide the apps, URLs redirect, supplier/PO/finance exports 403 | Verified |
| Unauthorized apps by plan/member | Integration (`assertAppAccessFor`: plan, member restriction, role, lapsed), live exports 403 | Verified |
| AI health restricted | Unit (2) + AI-by-plan integration (trial, OneOps, AllOps, MaxOps, Custom ± add-on, lapsed) + live: 200 owner/admin on MaxOps, 403 on AllOps/Custom/manager/employee/limited | Verified |
| Cross-tenant access | Live in the audit (IDs, URLs, forged cookie) and unchanged architecture; AI/finance tenant tests in the suite | Verified |
| Auth rate limits | Integration test + live (11th wrong password blocked, valid user unaffected) | Verified |
| Stripe webhook invalid signatures | Live: missing, garbage, tampered body, stale timestamp → 400 | Verified |
| Registration enumeration | Integration test: identical response and no mail for existing accounts | Verified |
| Server actions & exports enforce authorization | Central guard in `runAction`, export handler, `getCurrentAuthUser(app)`; tests + live | Verified |
| UI restrictions match server | Same `access.apps` feeds UI and server guard; live employee/limited matrix | Verified |

## 4. Application browser-testing results
Full table in the roadmap (Batch 5). Summary:
- **Manufacturing — Verified:** BOM validation (self-component refused), activation, work order create/start/complete: frames 100→80, glass 50→10, windows +20 with movement log; shortage refused with clear message, stock untouched.
- **Marketing — Verified:** contact (validation, consent, duplicate), template variable validation, audience, campaign draft → pending approval (**not** approved, nothing dispatched); manager cannot approve; employee locked out.
- **Community — Verified:** article draft by manager → published by owner, forum topic; employee read-only and cannot see drafts.
- **HR — Verified (smoke+workflows):** department, employee creation with validation, leave request (reversed dates not created) → admin approval through the new dialog, payroll generation (2,400 TND, no statutory deductions modelled), employee sees only own data; keyboard behaviour of dialogs.
- **Not covered:** attendance punching, monthly accrual, manual balance adjustment, departure review, AI HR assistant, Marketing social/Telegram/integrations, live chat, Finance receipt OCR/Telegram (external services; service-level tests exist).
- Minor unfixed UX notes: empty product selects say "Invalid identifier"; Community article "Category" dropdown is empty/unlabeled when no category exists; a typed custom job title needs the "Add" click before "Create Employee".

## 5. Stripe lifecycle results (test mode)
Verified: Checkout session creation; cancel URL (plan unchanged); forged success redirect ignored; signature failures 400; idempotent replay (processed once); subscription → plan active, invoice synced (paid), audit trail; entitlements after AllOps (9 apps, no AI), upgrade to MaxOps (AI app + health 200), downgrade to Custom (2 apps, Purchasing locked), cancel at period end (access until Dec 10), immediate cancel (`canceled`, paid period remains usable — business rule to confirm), declined card (`invoice.payment_failed` stored, no access from an incomplete subscription).
Partial: expiry and past-due grace are covered by integration tests, not reproduced live (needs Stripe test clocks); subscriptions were created through the Stripe API with the exact metadata/amounts Checkout produces.
Untested: completing Stripe's hosted payment page (card entry is not something I may do), OneOps/trial → paid transitions on Stripe (covered by tests only), tax/Managed Payments behaviour beyond session creation.
Environment note: the Stripe CLI's saved login is expired (`stripe login` needed by you); the app's own test key was used instead.

## 6. Accessibility results
Verified live: dialogs named and focus-managed (HR employee, leave review; Escape closes, focus returns), 0 unlabelled controls on invoice and payment forms, `<main>` present on login/register/forgot/organization/profile/finance. Unit/behaviour of `useDialog` is exercised through the browser only (no DOM test environment in the repo). Not audited with a screen reader or automated axe run; the modals not in the audited list (blog, forum, support chat, finance copilot) were not changed.

## 7. Performance measurements
Conditions: production build, local MongoDB replica set (no network latency), 10,003 products, 20,001 invoices, 1,001 customers, 50,005 stock movements, 501 employees (cloned from real UI-created documents).
- Server time under 100 ms on paginated pages (products 47 ms, search 19 ms, invoices 22 ms, stock 71 ms); Finance dashboard 238 ms; Inventory dashboard **460 ms**.
- **Payload problems:** Customers 4.4 MB, HR 3.7 MB, Payments 1.8 MB, Reports 1.5 MB (no server-side pagination).
- No collection scans on application data; slowest query 58 ms; no N+1 (operations per page constant). Stock-movement dashboard queries examine all 50k index keys for 8–25 rows.
- Exports: refused above 10,000 rows with a clear message (verified), filtered export fine.
- Identity/tenant lookups per page: 25 → 13 (previous phase). A remote database was **not** available; the latency impact (~150–400 ms per page at 30 ms RTT) is an estimate, not a measurement.

## 8. Automated test results
`tsc --noEmit`: 0 errors · `eslint .`: 0 errors, 75 warnings (unused variables, `<img>`) · `vitest`: **83 files, 1,248 tests passed** (was 1,225) · production build compiles.
New tests: password reset (8), CSP (4), role matrix (3), AI health (2), duplicate key (2), plan-by-plan AI entitlement, employee role gate, sign-in throttling, export app guard, app access (+ adapted AI/marketing tests to the new employee default).

## 9. Remaining risks and blockers
1. **Remote database / real network** untested (blocker: no safe remote environment). Do a staging run before launch.
2. **Large-customer payloads** (§7) — plan pagination for Customers, Payments, HR, Reports; Inventory dashboard aggregation.
3. **Stripe hosted payment** and clock-driven lifecycle not driven end to end; `stripe login` expired.
4. **Policy to confirm:** employee role is now least-privilege (no Finance/Marketing/Purchasing). If employees must submit expense claims or view customers, add a deliberate permission rather than restoring the broad read.
5. **Business rule to confirm:** immediate Stripe cancellation keeps access until the paid period ends.
6. CSP keeps `style-src 'unsafe-inline'` (React inline `style=` attributes cannot carry a nonce); scripts are locked down. JWT sessions cannot be revoked server-side before expiry (a password change does not log out other sessions).
7. Payroll shows no statutory deductions (CNSS/tax) — functionality gap, not a defect of this phase.
8. Not tested: remaining HR/Marketing/Finance integrations listed in §4, mobile devices on real hardware, load/concurrency.

## 10. Production-readiness verdict
**Ready for a controlled launch** (pilot/limited customers): security posture, authorization, payment handling, accessibility of the audited flows and code quality meet the acceptance criteria, and everything that could be tested here passed. **Not yet recommended for unrestricted launch** until the staging checks in §9 (remote DB, hosted Stripe payment, large-list pagination) are done.
