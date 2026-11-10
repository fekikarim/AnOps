# AnOps Platform Workflow — Implementation Roadmap

Spec: `docs/karim-feki/ANOPS_PLATFORM_WORKFLOW_IMPLEMENTATION.md` · Pricing: `docs/karim-feki/PRICING_RESEARCH.md`
Statuses: Not Started / In Progress / Completed / Blocked.

## Exact next step

> All 11 batches are implemented and verified (see Batch 10). Remaining work is configuration and owner decisions, not code:
> 1. Owner sign-off on prices in `docs/karim-feki/PRICING_RESEARCH.md` before Stripe live mode.
> 2. Per environment: set `STRIPE_WEBHOOK_SECRET` (Stripe Dashboard webhook → `/api/v1/billing/stripe/webhook`, events listed in Batch 8), `PLATFORM_CRON_SECRET` (≥ 32 chars) and a cron calling `POST /api/v1/platform/maintenance` every 5 min (`npm run platform:maintenance:watch` locally); configure the Stripe Customer Portal.
> 3. Review and commit (nothing in this phase is committed).

---

## Batch 0 — Architecture & workflow audit · Completed

**Stack**: Next.js 16 App Router, React 19, MongoDB (native driver), NextAuth v5 (credentials + JWT, MongoDB adapter), Tailwind v4, Vitest (unit + integration on a replica set), nodemailer SMTP.

**Tenancy & RBAC**
- Tenant = `companies` document; membership = `company_members` {companyId, userId, role owner|admin|manager|employee, status active|invited}. Unique (companyId,userId).
- Active company via HTTP-only cookie `anops_active_company_id` (`server/tenant/context.ts`), validated against memberships.
- `resolveWorkspace()` builds `WorkspaceContext` {db, userId, companyId, role, permissions}; role → workspace role (owner/admin/operator/viewer) → permission set (`server/security/permissions.ts`). Services assert permissions.
- `runAction()` wraps server actions (tenant resolution, rate limit, typed errors). `withTransaction()` = real transactions on replica sets, compensating undo on standalone.
- Audit: `audit_events` via `recordAudit()`.
- Rate limiting: shared Mongo-backed fixed window (`consumeSharedRateLimit`).

**Auth today**: `/register` creates `users` {status unverified}; sign-in is **blocked until email verified** (`authorize` throws `unverified`); `requireActive()`, `resolveWorkspace()` and `proxy.ts` all require verified status. Verification tokens are stored **in plain text** on the user document (24 h). Users without a company → `/onboarding` (create company form). `createCompany()` is not transactional.

**AI**: `resolveAiAccess()` (company settings `ai_settings`, member grants `ai_access_grants`, role ceiling, kill switch) is the single gate for every AI feature (`gate.ts`, orchestrator, copilots).

**Applications**: 11 sidebar entries; module routes `/ai`, `/company`, `/hr`, `/crm`, `/sales`, `/finance`, `/inventory`, `/purchasing`, `/manufacturing`, `/marketing`, `/community`. Module pages use `ModuleTabs` (horizontal tabs). Public catalog (11 apps, icons, accents) in `src/shared/config/catalog.ts`.

**Email**: SMTP via nodemailer (`EMAIL_SERVER_*`, `EMAIL_FROM` configured in `.env`), branded templates in `server/email/templates.ts`.

**Stripe**: only `STRIPE_API_KEY` (test mode, `sk_test_…`) in `.env`. No SDK, no models, no webhook secret. Stripe CLI 1.35 available locally.

**Background jobs**: no scheduler in-process; the marketing worker pattern is a bearer-secured `POST` endpoint called by cron/script.

**Gaps vs spec**: no subscription/entitlement model, no trial, no invitations with tokens (members are created with temporary passwords), verification before access (spec wants after), no organization profile fields, no user profile page, no `/anops` home, no Stripe, no per-app sidebars or app switcher, no route guard by entitlement.

**Risks**: changing verification rules touches sign-in; entitlement guard must not lock existing companies out (legacy companies get a grandfathered entitlement); cleanup must never delete activated organizations or retained records.

**Baseline tests**: unit 33 files / 429 passed; integration 41 files / 753 passed (local replica set on 127.0.0.1:27018).

---

## Batch 1 — Core data & entitlement architecture · Completed

| Task | Status |
|---|---|
| Central application registry `src/shared/domain/applications.ts` (11 apps, routes, grouped navigation; copy/icons from the public catalog) | Completed |
| Plans, prices, entitlement rules `src/shared/domain/plans.ts` (pure: `resolveEntitlements`, `validateTrialSelection`, `quotePrice`, `freeFallbackChoices`, `effectiveApps`) | Completed |
| Collections + indexes `src/server/platform/collections.ts` (registered in `ensureIndexes`) | Completed |
| Hashed single-use tokens `src/server/platform/tokens.ts` | Completed |
| Subscription service (state, entitlements, one-time free fallback with optimistic concurrency, trial lapse) | Completed |
| Registration service (transactional user + organization + owner membership + subscription + activation token + audit; email lock; rate limits) | Completed |
| Activation service (atomic single-use claim, generic errors, resend cooldown + hourly cap, deadline never extended) | Completed |
| Cleanup/maintenance service (claim pending→expiring, purge tenant data except retained collections, remove provisional users, audit, idempotent, concurrent-safe) | Completed |
| Invitation service (hashed tokens, 7-day expiry, unique pending per email, role rules, accept for new/existing accounts, revoke/resend) | Completed |
| Access layer `src/server/platform/access.ts` (`requireAppAccess`, `resolveOrganizationById` with IDOR-safe membership check) | Completed |
| Tenancy changes: provisional owners allowed in workspace during activation window (`isEmailTrusted`), expired pending orgs hidden in `getUserCompanies`, sign-in refused after window | Completed |
| AI gate: `resolveAiAccess` adds `plan_excluded` (subscription AI entitlement) before company/member grants | Completed |

**Data model** (MongoDB, additive — no destructive migration):
- `users` + `firstName`, `lastName`, `phone`, `jobTitle`, `language`, `notificationPreferences`, `provisionalUntil` (removed on activation).
- `companies` + `activationStatus` (pending|active|expiring; absent = legacy active), `activationDeadline`, `activatedAt`, profile fields (`website`, `industry`, `size`, `primaryInterest`, `country`, `address`, `contactEmail`, `contactPhone`).
- `company_members` + `appAccess` (null = all entitled apps), `status` may be `suspended`, `joinedAt`, `invitedBy`.
- New: `organization_subscriptions` (1 per company), `activation_tokens`, `organization_invitations`, `billing_invoices`, `stripe_events` (TTL 90 d), `registration_locks` (TTL 10 min).
- Legacy organizations without a subscription document resolve to `legacy` = all apps + AI (grandfathered, no behaviour change).

**Tests**: `tests/unit/platform-plans.test.ts` (14), `tests/integration/platform-lifecycle.test.ts` (17). Full suite: 76 files / 1213 tests passed. Note: `hr-copilot.test.ts` "expired actions" case failed once under full-suite load and passed on re-run and in isolation (pre-existing timing sensitivity, unrelated).

**Dependency added**: `stripe@23.1.0` (official SDK, server-only).
## Batch 2 — Trial selection & registration · Completed
- `/trial` (`src/app/(marketing)/trial/page.tsx`, `features/platform/components/trial-selector.tsx`): 11 apps with animated icons, capabilities, selected states, max 3 (others disabled with explanation, nothing silently removed), Coming-soon apps (CRM, Sales) not selectable, AnOps AI alone refused (needs AI), sticky summary (icons, count, Permanent Free / 15-day trial, explanation, Continue), selection persisted in sessionStorage + query.
- `/get-started` (`registration-form.tsx`, `actions/registration.action.ts`): first/last name, organization, email, phone, currency; existing password rules; terms; deferred fields explained; server re-validates selection; on success signs the owner in → `/anops?welcome=1`.
- Public CTAs: header "Try it free" → `/trial`; `/register` now redirects to `/trial`; login form "create account" → `/trial`.

## Batch 3 — Main workspace `/anops` · Completed
- `src/app/(workspace)/anops/page.tsx` + `features/platform/components/anops-home.tsx`: animated welcome ("Welcome to AnOps."), desktop app grid / iOS-style mobile grid (safe-area aware), floating Dock (organization avatar + switcher, profile, ⌘K search, settings), plan badge, trial/grace banners, locked-app notice, plan gate for expired trials/lapsed plans (owner: upgrade or one-time OneOps choice; others: explanation), "More applications" (not in plan), organization profile completion card.
- Entitlement guard on all 11 application layouts (`requireAppAccess`), so typed URLs are blocked (redirect `/anops?locked=<app>`; `/anops` never redirects on entitlements → no loops).

## Batch 4 — Email activation & onboarding · Completed
- Activation email (`server/email/templates.ts`), stacked activation dialog with live 12 h countdown, resend (60 s cooldown + 5/h), destination email, instructions, link to organization; collapses to a banner.
- `/activate` requires a button press (POST server action) so link scanners cannot consume tokens; hashed single-use tokens, generic errors, no identifiers in URLs.
- 12 h expiry: requests to expired pending organizations are refused immediately; `POST /api/v1/platform/maintenance` (bearer `PLATFORM_CRON_SECRET`, timing-safe) purges them idempotently; `scripts/platform-maintenance.mjs` + `npm run platform:maintenance[:watch]`.
- `/onboarding/ready`: screen 1 "Your organization is ready!", screen 2 invite colleagues (rows, roles, validation, skip) → `/anops`.
- `/invite?token=`: preview, new-account form or "sign in as <email>", single-use, 7-day expiry, bound to organization + role.

## Batch 5 — Organization management · Completed
- `/organization/[orgId]` (IDOR-safe: membership checked for the URL org, same answer for missing and foreign): Overview (stats, status, editable profile with completion), Members (invite, pending invitations resend/cancel, directory with search, role change, suspend/reactivate, remove, per-member application access, AI status + link to AI grants, member profile page), Subscription & billing, Settings (profile, regional/currency, security, members, app access, AI permissions with live state, integrations, notifications, audit, billing — filtered by role), Audit log (owners/admins, paginated).
- Rules: owner can never be changed/removed; admins cannot manage admins or appoint admins; nobody changes their own membership; all checks server-side and audited.

## Batch 6 — User profiles · Completed
- `/profile`: personal info (first/last name, phone, position, language), notification preferences (security always on), password change (current password, rate-limited, audited), active organization, list of organizations, profile completion. Kept separate from organization settings.

## Batch 7 — Subscriptions & pricing · Completed
- Research + proposal: `docs/karim-feki/PRICING_RESEARCH.md` (Odoo, Zoho One, Frappe Cloud/ERPNext, Tunisian benchmarks; sources and caveats).
- OneOps free · Custom US$9/€8 per app capped at US$45/€42 (+ AI add-on US$29/€27) · AllOps US$49/€45 · MaxOps US$99/€89 · annual = 10 months. Single source: `src/shared/domain/plans.ts`; public `/pricing`, homepage teaser, plan finder and FAQ now use these plans.
- Trial expiry → plan gate; one-time immutable OneOps fallback among trial apps; paid lapse handled per Stripe status (grace 7 days for past-due, access until period end on cancel); data never deleted.
- Organizations created through the legacy `/onboarding` path now start with "choose a plan" (no free paid access).

## Batch 8 — Stripe integration · Completed
- `src/server/platform/billing.service.ts`: server-only SDK, Customer per organization (idempotency key), Checkout (inline prices from the server catalogue, SaaS tax code `txcd_10103001` required by the account's Managed Payments), success-page reconciliation verified against Stripe (redirect is never trusted), webhook handler with idempotent event log and re-fetch of the subscription (out-of-order safe), customer/organization cross-check, plan change cancels the replaced subscription, invoice history, cancel/resume at period end, Customer Portal.
- `POST /api/v1/billing/stripe/webhook`: raw-body signature verification, 400 on bad signature, 500 releases the event for retry. Events: checkout.session.completed, customer.subscription.created/updated/deleted, invoice.paid/payment_failed/finalized/voided.

## Batch 9 — Application navigation · Completed
- Sidebar is application-aware: app identity, grouped collapsible navigation from the registry, current page highlighted, "All applications" → `/anops`, user menu links (profile, organization settings, help) now real.
- Topbar: global `AppSwitcher` (⌘K/Ctrl K, searches apps and their pages, locked apps shown with Upgrade), replacing the non-functional search box. `ModuleTabs` remain as mobile section navigation (hidden ≥ lg).

## Batch 10 — Integration & QA · Completed
- Unit + integration: 77 files, 1219 tests passed (new: `tests/unit/platform-plans.test.ts`, `tests/integration/platform-lifecycle.test.ts`, `tests/integration/platform-billing.test.ts`). `hr-copilot.test.ts` "expired actions" fails intermittently only under full-suite load (passes alone; pre-existing timing).
- `tsc` clean for `src/`; ESLint: no new errors (3 pre-existing in `company.service.ts` / `sidebar.tsx`).
- `npm run build` succeeds.
- E2E on a production build (port 3100, disposable replica-set DB, local SMTP sink, Stripe CLI forwarding, test mode), verified:
  - Journey A: 1 app → OneOps free, only that app, other app URLs redirected.
  - Journey B: 3-app trial → `/anops` with welcome + activation dialog → activation link (GET does not activate; button does; reuse rejected) → onboarding → invitation → colleague created account and joined as Employee → trial expired (simulated) → plan gate → OneOps fallback kept 1 app.
  - Journey C: AllOps via Stripe Checkout (test card) → 4 signed webhooks 200 → subscription active, invoice stored → all 11 apps, AI still excluded → cancel at period end + resume via Stripe.
  - Journey D: profile update (completion 33 % → 67 %), role change, per-member app access, employee restrictions (audit 404, no billing/invite controls), foreign org ID → `/anops`.
  - Journey E: Inventory sidebar with all pages, ⌘K search → Finance › Receipts.
  - Security: forged webhook → 400; maintenance without secret → 401; expiry purge removed org + provisional user and kept the audit record; activated org untouched.
  - Mobile 390 px `/anops`: no horizontal overflow.
- Not verified: the in-app browser could not open the dev server at the end, so an existing legacy account was not re-checked visually (covered by tests: no subscription record ⇒ full access).

---

## Follow-up: AllOps has no AI at all (Completed)
- Rule (single place, `resolveEntitlements` in `src/shared/domain/plans.ts`): an entitlement without AI features never contains an AI-native application. AllOps = 10 applications (no AnOps AI), MaxOps = 11, Custom = 2–9 apps (AnOps AI only with the AI add-on), OneOps/grace/cancelling follow the same rule. Trials include AI.
- `/anops`, sidebar, ⌘K search and app guards stop listing/allowing AnOps AI (`/ai`, `/ai/access` → `/anops?locked=ai`); AnOps AI shows as a locked "More applications" tile.
- AI features inside other apps are removed from the UI when the plan has no AI: nav items flagged `ai` (Marketing "AI copy", HR "AI activity") are hidden and their routes redirect (`requireAiFeatures`), Finance Copilot and receipt OCR/Telegram capture hidden, HR "AI HR Assistant" tab hidden, community "AI Summary" button hidden (`AiFeaturesProvider`/`useAiFeatures`). The server independently refuses every AI call (`resolveAiAccess` → `plan_excluded`).
- Billing: Custom cannot include AnOps AI without the add-on (validated server-side); public pricing, comparison table, FAQ, trial copy and `PRICING_RESEARCH.md` updated (AllOps = 10 apps, no AI).
- Verified with a production build: AllOps org sees 10 apps, no AnOps AI, no AI nav/controls, AI routes redirect; switching the same org to MaxOps restores all 11 and AI pages. Tests: new entitlement test; full suite passes (one timing-sensitive `ai-hardening` case passes alone).

## Follow-up: organization and profile screens redesign (Completed)
- Organization (`/organization/[orgId]/**`): identity hero card (lime avatar tile, name wraps to 2 lines, badges on their own row), sticky swipeable pill navigation on phones (vertical rail on desktop), `min-w-0` grid fix that removed the horizontal overflow, compact stat cards, stacked status/completion layout, 48px inputs on phones, sticky safe-area Save bar on the profile form.
- Profile (`/profile`): stacked hero (avatar + name, completion card below instead of squeezing the title), sticky Save bar on phones, security form stacks below `md`.
- Verified: 6 screens × widths 390/440/768/1440 with no horizontal overflow; visual checks on 440 px and desktop.

## Follow-up: movable search window on /anops (Completed)
- `app-switcher.tsx`: on desktop with a mouse (`min-width: 768px`, `hover: hover`, `pointer: fine`) the ⌘K search panel behaves like a macOS window: drag it by the search bar (a click still just focuses the input; dragging starts after 4 px), grabbing cursor, lifted shadow while moving, GPU-translated with requestAnimationFrame, clamped so the bar always stays partly on screen, position remembered while the page stays open, double-click the bar (outside the input) to re-center with a springy ease. Phones and touch devices keep the bottom sheet, with no drag and no hint.

## Follow-up: /anops sign out + Dock website button (Completed)
- Header: `LogoutButton` (`features/platform/components/logout-button.tsx`) beside the theme toggle: server-action sign-out, spinner while signing out, icon-only on phones and "Sign out" label from `md`, red hover. Signed-out `/anops` redirects to `/login?callbackUrl=/anops`.
- Dock: first item is the AnOps app icon linking to `/` (public portal), with tooltip "Public website" and a divider; Dock fits at 360 px.

## Follow-up: Company merged into Organization (Completed)
- The Company application is removed (registry, public catalog, plans, docs, industries, `/apps/company` → `/apps`). The platform now has 10 applications: AllOps = 9 (no AnOps AI), MaxOps = 10, Custom = 2–8. Counts are derived from the registry (`TOTAL_APP_COUNT`, `ALLOPS_APP_COUNT`, `CUSTOM_MAX_APPS`) so copy cannot drift; stored `company` values in old subscriptions/members are ignored safely.
- `/company` (legacy bookmarks) redirects to `/organization/<active id>`. Old Company UI deleted, and the unused server actions (temp-password member creation, role change, remove, stats) removed; only create/switch remain (`features/company/actions/company.action.ts`: rate limit 5/h, max 20 organizations, audit `organization.created`, membership-checked switch).
- `/organization` lists all organizations of the person (role, plan, apps, active badge, Manage / Use in apps, New organization). Organization pages gained an `OrgSwitcher` (switches the active-workspace cookie and opens the organization), an "Use this organization in apps" banner when managing a non-active organization, slug, HR counters (staff, departments, job titles when HR is in the plan), industry suggestions, "Your organizations" settings card, and "Leave organization" for non-owners. Colleague management is invitations only (no more temporary passwords).
- Verified: unit + integration 1225 tests; production build; browser: two organizations, switching changes apps/plan gate, create flow, banner, legacy redirects, no overflow at 360/390.

## Decisions & assumptions
- Prices: see `PRICING_RESEARCH.md` (proposal pending owner sign-off before live mode).
- Application access and AI feature access are separate entitlements. The AnOps AI application is included in AllOps (settings visible) but its AI features require MaxOps, the Custom AI add-on, or an active trial.
- Legacy companies (created before this phase, no subscription document) keep **all applications + AI (grandfathered `legacy` access)** so nothing breaks; owners can pick a plan from billing.

## Known issues / blocked items
- Configuration needed per environment: `STRIPE_WEBHOOK_SECRET`, `PLATFORM_CRON_SECRET` (+ scheduler), Stripe Customer Portal settings. Without them, webhooks/maintenance return 503 and checkout still works via success-page reconciliation.
- Server actions of an application are not individually entitlement-gated (pages and layouts are). They remain tenant-scoped and role-checked, so this cannot leak another organization's data; per-action gating is a possible hardening step.
- Prices await owner approval; Stripe TND billing not evaluated (TND organizations billed in EUR).
- Pre-existing: `/dashboard` page shows static demo KPIs (now only reachable from old links); contact form has no backend.
