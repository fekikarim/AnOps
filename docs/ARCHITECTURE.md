# AnOps Architecture (Next.js App Router)

This document defines the canonical structure and rules for this project. Follow it strictly to keep the codebase scalable and maintainable.

## Folder Structure

```
src/
├── app/                    # Next.js App Router - ROUTES ONLY
│   ├── (auth)/            # Auth route group (no shell)
│   ├── (dashboard)/       # Dashboard route group (uses DashboardShell)
│   ├── api/               # Route handlers
│   ├── layout.tsx         # Root layout - minimal only
│   ├── global-error.tsx   # Global error boundary (must be 'use client')
│   └── not-found.tsx      # Root 404 (standalone)
│
├── features/              # Domain-driven modules
│   ├── auth/              # Authentication domain
│   │   ├── components/    # Auth UI components
│   │   ├── actions/       # Server actions
│   │   ├── schemas/       # Zod validation schemas
│   │   ├── hooks/         # Feature-specific hooks
│   │   └── types/         # Feature types
│   ├── crm/               # CRM module
│   ├── sales/             # Sales module
│   ├── finance/           # Finance module
│   ├── inventory/         # Inventory module
│   ├── purchasing/        # Purchasing module
│   ├── hr/                # HR module
│   ├── projects/          # Projects module
│   └── documents/         # Documents module
│
├── server/                # Server-only infrastructure
│   ├── auth/              # NextAuth configuration
│   │   ├── index.ts       # Auth config, providers, callbacks
│   │   └── types.ts       # NextAuth type augmentations
│   ├── db/                # Database layer
│   │   ├── client.ts      # MongoDB connection
│   │   └── schemas/       # Collection schemas/models
│   ├── ai/                # AI Provider Master (server-only)
│   │   ├── index.ts       # THE only import for AI features (AiMaster singleton)
│   │   ├── types.ts       # AiProvider interface, message & result types
│   │   ├── key-pool.ts    # Rotating key pool with 429 cooldown
│   │   └── providers/     # Provider adapters (Groq, OpenRouter, Gemini)
│   └── services/          # Shared business logic services
│
├── shared/                # Reusable across all features
│   ├── components/
│   │   ├── layout/        # App shell, sidebar, topbar
│   │   └── ui/            # Design system components
│   ├── hooks/             # Generic hooks (use-debounce, etc.)
│   ├── lib/               # Utilities (cn, helpers)
│   └── constants/         # App-wide constants
│
├── config/                # Configuration
│   └── env.ts             # Zod-validated environment variables
│
├── proxy.ts               # Next.js proxy (must stay at src/ root)
└── middleware.ts          # DO NOT USE - use proxy.ts instead
```

## Core Principles

### 1. App Router (`src/app/`)
- **Routes only** - Pages, layouts, route groups, API routes. NO business logic.
- **Thin by default** - Import from `features/` or `shared/`. Keep components minimal.
- **Route groups** - Use `(auth)` for unauthenticated flows, `(dashboard)` for authenticated app routes.
- **Root layout minimal** - Only `<html>`, `<body>`, globals.css, metadata. Never mount DashboardShell here.

### 2. Features (`src/features/`)
- **Domain-driven** - Each business module is self-contained.
- **Own everything** - Components, actions, schemas, hooks, types live here.
- **Server actions preferred** - Put mutations in `actions/` as server actions.
- **Validation** - Use Zod schemas in `schemas/`.

### 3. Server (`src/server/`)
- **Server-only** - All code here runs only on the server. Use `import 'server-only'` when appropriate.
- **Infrastructure** - Auth, DB, external services, business services.
- **No UI** - Never import React components here.
- **Repositories pattern** - DB queries should go through services/repositories.

### 4. Shared (`src/shared/`)
- **Truly reusable** - Used by multiple features with no feature-specific logic.
- **Design system** - UI components in `components/ui/`.
- **Layout** - App shell components in `components/layout/`.
- **Utilities** - Pure functions in `lib/`.

## Import Rules

```typescript
// ✅ Good
import { Button } from '@/shared/components/ui/button'
import { auth } from '@/server/auth'
import { loginSchema } from '@/features/auth/schemas'
import { DashboardShell } from '@/shared/components/layout/dashboard-shell'

// ❌ Bad - business logic in app
// Don't put DB queries directly in app/page.tsx

// ❌ Bad - importing server code in client components
// Don't import from '@/server/*' in 'use client' components
```

Use path aliases: `@/*` maps to `./src/*`

## File Conventions

- **Server components by default** - Only add `'use client'` when needed (hooks, event handlers, browser APIs)
- **Server actions** - Mark with `'use server'` in `actions/` files
- **Type safety** - No `any`. Extend types in `server/auth/types.ts` or feature `types/`
- **CSS Modules** - Use for fragile structural styles (pinned footers, complex layouts). Keep tokens in `globals.css`
- **Env vars** - Validate in `config/env.ts` with Zod. Never access `process.env` directly in features

## Special Cases

- **proxy.ts** - Must remain at `src/proxy.ts` (Next.js convention for this version). Do NOT rename/move.
- **global-error.tsx** - Must be a Client Component with `'use client'` and must include `<html>/<body>`.
- **not-found.tsx** - Root one is standalone (no shell). Dashboard routes can have their own in `(dashboard)/not-found.tsx`.
- **Type extensions** - Global type augmentations go in `server/auth/types.ts` or appropriate places.

## Auth Architecture

The auth system is split into an **edge-safe config** and a **full server config** so `proxy.ts` can run on the edge without importing MongoDB.

```
src/
├── server/auth/
│   ├── config.ts   # Edge-safe: JWT callbacks, pages, empty providers (NO db)
│   ├── index.ts    # Full: spreads config + MongoDB adapter + Credentials provider
│   └── types.ts    # Session/JWT augmentation (id, status, emailVerified)
├── server/db/
│   └── client.ts   # MongoDB client (imports "server-only")
├── features/auth/
│   ├── actions/    # Server actions (login, register, reset, verify, guards)
│   ├── components/ # AuthCard, Field, Button, client forms (useActionState)
│   └── schemas/    # Zod schemas
└── app/(auth)/     # login, register, forgot-password, reset-password, verify, unverified, banned
```

**Rules:**
- `proxy.ts` imports ONLY `server/auth/config.ts` (edge-safe). Never import `server/auth/index.ts` in proxy.
- Route handlers/actions import the full `server/auth/index.ts`.
- Account status: `active | unverified | banned`. Store on the user document and mirror into JWT/session.
- `(dashboard)` routes call `requireActive()` in the layout (defense-in-depth) AND are guarded by `proxy.ts`.
- Forms use client components with `useActionState` for inline errors; actions return `{ error?, success? }` or `redirect()`.

## Validation (Client + Server)

Every form validates on **both** sides using the **same Zod schema** (single source of truth).

- **Schemas** live in `src/features/<feature>/schemas/*.schema.ts` and export inferred types.
- **Client**: forms use `react-hook-form` + `zodResolver` (mode `onBlur`). Inputs use `TextField` (`src/shared/components/ui/text-field.tsx`) which renders accessible `aria-invalid`/`aria-describedby` errors. Forms use `noValidate` and never rely on native browser validation.
- **Server**: server actions and `authorize()` re-run the identical schema. Never trust the client. Helpers live in `src/shared/lib/validation.ts` (`parseWithSchema`, `toFieldErrors`).
- **Server errors**: actions return `{ error }` / `{ success }`; forms surface them as a root alert.
- **Rules**: trim strings, enforce password strength (min 8, letter + number, max 72), validate tokens (`/verify`, `/reset-password`), and normalize email to lowercase before DB use.

## Email (Verification + Password Reset)

- **Module**: `src/server/email/` — `client.ts` (nodemailer transport), `templates.ts` (branded HTML/text), `index.ts` (`sendVerificationEmail`, `sendPasswordResetEmail`).
- **Config**: `src/config/env.ts` validates `EMAIL_SERVER_HOST`, `EMAIL_SERVER_PORT`, `EMAIL_SERVER_SECURE` (`"true"`/`"false"`), `EMAIL_SERVER_USER`, `EMAIL_SERVER_PASSWORD`, `EMAIL_FROM`. All optional.
- **Dev fallback**: when `EMAIL_SERVER_HOST` or `EMAIL_FROM` is unset, `sendMail` logs the email to the server console (including the link) instead of sending. In production it throws.
- **Never block auth**: registration/reset actions wrap sends in `try/catch` and log failures, so a mail outage can't break sign-up or reset requests.
- **Links** use `NEXTAUTH_URL` via `getAppUrl()`: `/verify?token=…` (24h) and `/reset-password?token=…` (1h).
- Requires `nodemailer` (installed) and `@types/nodemailer` (dev).

## PWA

- `public/manifest.json` - icons, standalone display, theme color.
- `public/sw.js` - static asset cache + `/offline` navigation fallback.
- `src/shared/components/pwa-register.tsx` - registers SW in production only.
- `/offline` route - clean offline fallback page.

## Multi-Tenancy Architecture

AnOps is built on a **Shared-Database, Tenant-Discriminator (`companyId`)** multi-tenant architecture:

```
Tenant Boundary: Company
├── Core: companies, company_members
└── Feature Data (Strictly scoped by companyId):
    ├── HR: employees, departments, job_titles, attendance, leave_requests, payslips
    ├── CRM & Sales: customers, leads, opportunities, orders
    ├── Finance: finance_customers, finance_invoices, finance_payments, finance_payment_allocations,
    │            finance_credit_notes, finance_expenses, finance_receipt_documents (+ GridFS finance_receipts),
    │            finance_receipt_extractions, finance_telegram_links
    └── Inventory: products, stock_movements, purchase_orders
```

### 1. Data Isolation Rules
- **Foreign Key Enforcement**: Every feature document MUST store `companyId: ObjectId`.
- **Query Scoping**: Every database read, insert, update, or delete MUST include `{ companyId: activeCompanyId }` in the query filter. No cross-tenant data leaks.
- **Required Scope**: Services take `companyId` as a required string parameter. A missing or malformed id throws. There is no unscoped code path, and no filter may be built as `cId ? {companyId} : {}`.
- **Role Isolation**: A user's role and permissions are evaluated within the context of their active company membership (`owner` | `admin` | `manager` | `employee`). The mapping to permissions is in docs/ROLES_AND_PERMISSIONS.md.
- **No Personal Workspace**: Accounts are not given a hidden tenant. A user acquires data access only by creating or joining a company.

### 2. Active Tenant Context & Cookie
- The user's currently selected company ID is stored in an HTTP-only cookie: `anops_active_company_id`.
- `getActiveTenant()` / `requireActiveTenant()` in `src/server/tenant/context.ts` resolve the active company for server components and actions. The cookie only selects among companies the user already belongs to; authority always comes from the membership, which is read from the database on each request.
- If the cookie is absent or names a company the user does not belong to, the first company the user belongs to is used.
- Inventory, purchasing and manufacturing services receive a `WorkspaceContext` built from the same tenant by `src/server/tenancy/workspace.ts` (`resolveWorkspace()` / `getPageWorkspace()`). HR pages and actions take the company from the same source.

### 3. Onboarding & Company Switcher
- **Zero-Company Guard**: If an authenticated user has no company memberships, the dashboard layout redirects them to `/onboarding`. The page is `src/app/onboarding/page.tsx`. It is outside the dashboard layout, so the redirect cannot loop, and it sends users who already have a company to `/hr`. Company creation seeds that company's departments and predefined job titles (`seedHrDefaultsForCompany`). It does not create staff.
- **Tenant Switcher**: A company selector in the top navigation allows multi-organization users to switch active companies seamlessly or provision additional companies.

### 4. Migration From the Earlier Organization Model
Data written before this change used an `organizations` / `memberships` model. Run the migration once per database:

```bash
npm run db:migrate-tenancy            # dry run: prints the planned changes, writes nothing
npm run db:migrate-tenancy -- --apply # performs them
```

The script (`scripts/migrate-multi-tenant.mjs`) keeps legacy company ids, so references stay valid. It makes the legacy owner the company owner, converts memberships to `company_members`, assigns unscoped HR documents to the default company "AnOps Technologies", removes `organizationId`, and renames the old collections with a `_legacy_` prefix. Nothing is deleted. It is idempotent. The older `scripts/migrate-to-multitenant.mjs` uses the same default company and is safe to run before or after it.

## Finance Module

Owner: Oussema. Plan, task list, progress log and manual test guide: `docs/oussema/`.

| Layer | Where |
|---|---|
| Pages | `src/app/(dashboard)/finance/**`: dashboard, customers, invoices (list, new, `[id]`, `[id]/edit`), payments, expenses (list, new, `[id]/edit`), receipts, reports. `layout.tsx` adds the Finance Copilot; `error.tsx` keeps errors inside Finance. |
| Routes | `GET /api/v1/finance/receipts/[id]/file` (stored receipt, company-scoped), `GET /api/v1/exports/finance-reports` (Excel). |
| Actions | `src/features/finance/actions/*.ts`: thin; only person-facing errors are returned. |
| Rules and data | `src/server/services/finance.service.ts` (every query scoped by `companyId`, permission checked per method, audit event per write); indexes in `finance.indexes.ts`. |
| Receipts | `src/server/finance/receipt-storage.ts` (GridFS, type from magic bytes, SHA-256 dedupe), `receipt-extraction.ts` (pure checks), `receipt-ocr.service.ts` (vision model through the AI gate, then a draft expense only after review). |
| Telegram | `src/server/finance/telegram-receipts.service.ts`, dispatched from the shared bot webhook in `src/server/marketing/telegram.service.ts` (`/start fin_…` and linked staff chats). |
| AI | `finance-ai.service.ts` (category suggestion, reminders, dashboard insights), `src/server/ai/tools/finance*.ts` (Copilot tools), `orchestrator.ts` scope `"finance"`. |
| Calculations | `src/features/finance/utils/money.ts` (cents, timbre fiscal), `utils/insights.ts` (flags, payment matching, customer behaviour, forecast). Pure and unit-tested; the screens, the Copilot and the reports use the same functions. |

Rules: money is computed in whole cents and never added across currencies; multi-document writes (allocations, reversals, credit notes, applying a receipt) run in `withTransaction` with conditional updates; posted invoices change only through credit notes, voids or payments; AI proposes, people confirm.

## Adding New Features

1. Create `src/features/[feature-name]/` with subfolders as needed
2. Add route in `src/app/(dashboard)/[feature-name]/page.tsx` (thin, imports from feature)
3. Keep business logic in feature, infra in server, UI primitives in shared
4. Ensure all database models include `companyId`
5. Update proxy.ts protected routes if needed

## Quick Checklist

- [ ] Routes in `app/` are thin
- [ ] Server code in `server/`, UI in `shared/` or `features/`
- [ ] Multi-tenancy: every data record includes and filters by `companyId`; the service takes a required `companyId`
- [ ] No DB/auth imports in client components
- [ ] Imports follow the layer rules
- [ ] Types are explicit, no `any`
- [ ] Using server components by default

## AI Architecture

> Full reference: `docs/AI_PROVIDERS.md`

AnOps uses a **provider master** pattern for all AI features. The master is a server-side singleton at `src/server/ai/index.ts` that routes requests through three free-tier providers in priority order:

```
Groq (multi-key rotation) → OpenRouter (free models) → Gemini (Gemma family)
```

### Rules

- **Always import `{ ai } from "@/server/ai"`** — never instantiate provider classes directly.
- Provider adapters live in `src/server/ai/providers/` and implement the `AiProvider` interface.
- All AI code is `server-only` — never import in client components or `proxy.ts`.
- AI errors must be caught; AI outages must not crash core features.

### Key Rotation

Groq and Gemini accept comma-separated key lists in `.env`:

```env
GROQ_API_KEYS=gsk_key1,gsk_key2,gsk_key3
GEMINI_API_KEYS=AIza_key1,AIza_key2
```

`KeyPool` marks a key rate-limited for 60s on 429 and auto-rotates to the next key.

### Quick Usage

```typescript
// server action / service / route handler only
import { ai } from "@/server/ai";

const answer = await ai.ask("Summarise attendance for this week", "You are an HR assistant.");
```
