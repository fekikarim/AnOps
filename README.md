<div align="center">

<a href="https://anops.tache-lik.tn">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/brand-kit/01-brand-identity/logos/anops-logo-horizontal-white.svg">
    <img alt="AnOps" src="public/brand-kit/01-brand-identity/logos/anops-logo-horizontal-dark.svg" height="56">
  </picture>
</a>

<h3>One platform. Every operation.</h3>

<p>
  A multi-tenant, AI-native business platform for small and mid-sized companies.<br/>
  People, finance, stock, purchasing, production, marketing and community in one calm workspace,<br/>
  with an AI that <b>prepares the work and waits for your confirmation</b>.
</p>

<p>
  <a href="https://anops.tache-lik.tn"><img alt="Live" src="https://img.shields.io/badge/live-anops.tache--lik.tn-C8F03E?style=for-the-badge&labelColor=111F1D"></a>
  <img alt="Next.js 16" src="https://img.shields.io/badge/Next.js-16-111F1D?style=for-the-badge&logo=nextdotjs&logoColor=white">
  <img alt="React 19" src="https://img.shields.io/badge/React-19-111F1D?style=for-the-badge&logo=react&logoColor=61DAFB">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-111F1D?style=for-the-badge&logo=typescript&logoColor=3178C6">
  <img alt="MongoDB" src="https://img.shields.io/badge/MongoDB-transactions-111F1D?style=for-the-badge&logo=mongodb&logoColor=47A248">
  <img alt="Tailwind CSS 4" src="https://img.shields.io/badge/Tailwind-4-111F1D?style=for-the-badge&logo=tailwindcss&logoColor=38BDF8">
</p>

<p>
  <a href="#-screenshots">Screenshots</a> ·
  <a href="#-applications">Applications</a> ·
  <a href="#-anops-ai-command-center">AI</a> ·
  <a href="#-architecture">Architecture</a> ·
  <a href="#-getting-started">Getting started</a> ·
  <a href="#-deployment">Deployment</a> ·
  <a href="#-the-team">Team</a>
</p>

</div>

<br/>

<p align="center">
  <img src="docs/screenshots/desktop-home.png" alt="AnOps home page" width="92%">
</p>

---

## Table of contents

- [Why AnOps](#-why-anops)
- [Screenshots](#-screenshots)
- [Applications](#-applications)
- [AnOps AI Command Center](#-anops-ai-command-center)
- [Plans and subscriptions](#-plans-and-subscriptions)
- [Architecture](#-architecture)
- [Multi-tenancy, roles and security](#-multi-tenancy-roles-and-security)
- [Tech stack](#-tech-stack)
- [Project structure](#-project-structure)
- [Getting started](#-getting-started)
- [Configuration](#-configuration)
- [Scripts](#-scripts)
- [Testing](#-testing)
- [Deployment](#-deployment)
- [Design system](#-design-system)
- [UML diagrams](#-uml-diagrams)
- [Documentation index](#-documentation-index)
- [Roadmap](#-roadmap)
- [The team](#-the-team)

---

## ✦ Why AnOps

Small and mid-sized companies run on a patchwork of spreadsheets and disconnected tools. AnOps replaces the patchwork with **one workspace where every application shares the same records**: a product bought in Purchasing is the product stocked in Inventory, consumed in Manufacturing and invoiced in Finance.

| | |
| --- | --- |
| **Pay for applications, not people** | Every plan includes unlimited users. One application is free forever. |
| **One organization, many applications** | An organization subscribes to applications; each member only sees what their role and access allow. |
| **AI with a seatbelt** | The model proposes, deterministic services validate and execute, and every write is confirmed by a person and recorded in the audit log. |
| **Built for the phone as much as the desk** | A responsive interface, installable as a PWA with offline support. |
| **Tenant-safe by construction** | The active company, user and role are resolved on the server for every request. Nothing about identity is taken from the client. |

---

## 📸 Screenshots

> All captures are taken from the running application (desktop 1440×900 and phone 390×844). The signed-in screens use a demo organization populated with the project's seed scripts.

### Desktop

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/desktop-home.png" alt="Home"><br/><sub><b>Home</b> — the public portal</sub></td>
    <td width="50%"><img src="docs/screenshots/desktop-apps.png" alt="Applications directory"><br/><sub><b>Applications</b> — the application directory</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/desktop-trial.png" alt="Trial selector"><br/><sub><b>Try it free</b> — pick up to three applications</sub></td>
    <td width="50%"><img src="docs/screenshots/desktop-get-started.png" alt="Create your workspace"><br/><sub><b>Create your workspace</b> — one minute, no card</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/desktop-pricing.png" alt="Pricing"><br/><sub><b>Pricing</b> — unlimited users on every plan</sub></td>
    <td width="50%"><img src="docs/screenshots/desktop-pricing-signed-in.png" alt="Pricing, signed in"><br/><sub><b>Pricing (signed in)</b> — the current plan is recognised, upgrades are highlighted</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/desktop-activation.png" alt="Activation dialog"><br/><sub><b>Activation</b> — 12-hour reservation of a new organization</sub></td>
    <td width="50%"><img src="docs/screenshots/desktop-workspace-home.png" alt="Workspace home"><br/><sub><b>Workspace home</b> — applications, plan status and profile completion</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/desktop-hr.png" alt="HR and Payroll"><br/><sub><b>HR &amp; Payroll</b> — directory, leave, attendance, payroll</sub></td>
    <td width="50%"><img src="docs/screenshots/desktop-finance.png" alt="Finance dashboard"><br/><sub><b>Finance</b> — cash flow, receivables, income vs expenses</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/desktop-finance-invoices.png" alt="Invoices"><br/><sub><b>Invoices</b> — statuses, balances, due dates</sub></td>
    <td width="50%"><img src="docs/screenshots/desktop-marketing.png" alt="Marketing"><br/><sub><b>Marketing</b> — contacts, consent, campaigns</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/desktop-marketing-campaigns.png" alt="Campaigns"><br/><sub><b>Campaigns</b> — draft, approval and delivery states</sub></td>
    <td width="50%"><img src="docs/screenshots/desktop-industries.png" alt="Industries"><br/><sub><b>Industries</b> — how each sector uses AnOps</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/desktop-login.png" alt="Sign in"><br/><sub><b>Sign in</b></sub></td>
    <td width="50%"></td>
  </tr>
</table>

### Mobile

<table>
  <tr>
    <td align="center" width="20%"><img src="docs/screenshots/mobile-home.png" alt="Home on a phone"><br/><sub><b>Home</b></sub></td>
    <td align="center" width="20%"><img src="docs/screenshots/mobile-menu.png" alt="Navigation sheet"><br/><sub><b>Navigation</b></sub></td>
    <td align="center" width="20%"><img src="docs/screenshots/mobile-apps.png" alt="Applications on a phone"><br/><sub><b>Applications</b></sub></td>
    <td align="center" width="20%"><img src="docs/screenshots/mobile-pricing.png" alt="Pricing on a phone"><br/><sub><b>Pricing</b></sub></td>
    <td align="center" width="20%"><img src="docs/screenshots/mobile-trial.png" alt="Trial selector on a phone"><br/><sub><b>Try it free</b></sub></td>
  </tr>
  <tr>
    <td align="center" width="20%"><img src="docs/screenshots/mobile-get-started.png" alt="Create your workspace on a phone"><br/><sub><b>Create workspace</b></sub></td>
    <td align="center" width="20%"><img src="docs/screenshots/mobile-login.png" alt="Sign in on a phone"><br/><sub><b>Sign in</b></sub></td>
    <td align="center" width="20%"><img src="docs/screenshots/mobile-workspace-home.png" alt="Workspace home on a phone"><br/><sub><b>Workspace</b></sub></td>
    <td align="center" width="20%"><img src="docs/screenshots/mobile-hr.png" alt="HR on a phone"><br/><sub><b>HR &amp; Payroll</b></sub></td>
    <td align="center" width="20%"><img src="docs/screenshots/mobile-finance.png" alt="Finance on a phone"><br/><sub><b>Finance</b></sub></td>
  </tr>
  <tr>
    <td align="center" width="20%"><img src="docs/screenshots/mobile-marketing.png" alt="Marketing on a phone"><br/><sub><b>Marketing</b></sub></td>
    <td align="center" width="20%"><img src="docs/screenshots/mobile-pricing-signed-in.png" alt="Pricing, signed in, on a phone"><br/><sub><b>Pricing (signed in)</b></sub></td>
    <td width="20%"></td>
    <td width="20%"></td>
    <td width="20%"></td>
  </tr>
</table>

---

## 🧩 Applications

AnOps ships **ten applications**. Eight are available today; CRM and Sales are announced and appear as "Coming soon". Every application is a self-contained domain module under `src/features/<module>` with its own server services under `src/server/<module>`.

| Application | Status | What it does |
| --- | :-: | --- |
| **AnOps AI** | ✅ | The AI Command Center: a role-aware assistant that reads and, after confirmation, changes data in seven modules. Requires the MaxOps plan. |
| **HR & Payroll** | ✅ | Employee directory, departments and job titles, leave balances and approval workflow, attendance (check-in/out, punctuality), monthly payroll with unpaid-leave deductions and payslips, and an AI HR policy assistant. |
| **Finance** | ✅ | Customers, invoices (paid, partial, overdue, credited, with fiscal stamp), payments with bank references, expenses with approval workflow, receipt scanning (OCR), reports and a finance copilot. |
| **Inventory** | ✅ | Product catalog and categories, warehouses, an append-only stock ledger with balances, receipts, issues, transfers and audited count adjustments. |
| **Purchasing** | ✅ | Suppliers, purchase orders (draft → approved → received), goods receipts that post stock transactionally, and AI-assisted replenishment suggestions. |
| **Manufacturing** | ✅ | Bills of materials with revisions, work orders that snapshot components, start / complete / cancel lifecycle that consumes and produces stock. |
| **Marketing** | ✅ | Contacts, tags, consent by channel and purpose, audiences with typed rules, templates, campaigns with approval, a durable dispatch worker (email and SMS), social posts, Telegram connection and an AI copywriter. |
| **Blogs & Community** | ✅ | Blog, forum, comments and live chat, with AI summaries, reply suggestions and a visitor chat widget. |
| **CRM** | 🕒 | Announced. Pipeline and customer records. |
| **Sales** | 🕒 | Announced. Quotes and orders. |

### Platform features shared by every application

- **Organizations and members** with owner, admin, manager and employee roles, invitations, and per-member application access.
- **Subscriptions and entitlements** computed from one pure domain module, so the server, route guards and UI can never disagree.
- **Audit log** for sensitive actions, and **exports** (Excel via ExcelJS).
- **Organization branding** with an AI **Logo Studio**.
- **PWA**: web app manifest, service worker, offline page and an offline indicator.
- **Light and dark themes**, accessible focus handling, and a branded dialog, toast and inline-validation system.

---

## 🤖 AnOps AI Command Center

A company-scoped assistant at `/ai`. A person manages operations in natural language or with guided slash commands. **The model interprets and orchestrates; deterministic AnOps services perform every read and write**, so validation, authorization, tenancy and business rules are never bypassed.

```mermaid
flowchart LR
    U([Person]) -->|"/command or natural language"| O[Orchestrator]
    O -->|bounded tool loop| M[(LLM provider)]
    M -->|proposes a tool call| O
    O --> P{Write?}
    P -- "read" --> S[Deterministic service]
    P -- "write" --> C[Pending action card]
    C -->|person confirms| S
    S --> D[(MongoDB)]
    S --> A[[Audit log]]
```

| Principle | How it is enforced |
| --- | --- |
| **Confirm every write** | Writes become pending actions shown to the person first. Destructive and financial actions need stronger confirmation. |
| **Access is an intersection** | What the company granted to AI **and** what the person's role already allows, checked live on every request. |
| **Slash commands never call a model** | `/posts`, `/newinvoice` and the other typed commands are parsed and executed deterministically. |
| **Private by default** | Conversations belong to the employee. Transcript auditing is a separate, explicit, audited permission. |
| **Bounded and metered** | Tool-step and call caps per turn, per-user and company usage limits, a global kill switch. |
| **Provider resilience** | Groq first, then OpenRouter, then Gemini, with rotating keys and cooldown on rate limits. |

Scale of the current implementation: **144 registered tools**, **135 module commands**, and AI-assisted forms in which the model fills a form but ids and critical values (money, quantities) are matched by the server.

Read more: [Architecture](docs/AI_COMMAND_CENTER_ARCHITECTURE.md) · [Security](docs/AI_COMMAND_CENTER_SECURITY.md) · [Operations](docs/AI_COMMAND_CENTER_OPERATIONS.md) · [Deployment](docs/AI_COMMAND_CENTER_DEPLOYMENT.md) · [Providers](docs/AI_PROVIDERS.md)

---

## 💳 Plans and subscriptions

Pricing is computed from a single source of truth, [`src/shared/domain/plans.ts`](src/shared/domain/plans.ts).

| Plan | Applications | AI | Price (per organization) |
| --- | --- | :-: | --- |
| **OneOps** | 1, chosen once | — | **Free forever** |
| **Custom** | 2 to 8 of your choice | optional add-on | US$9 / €8 per application, capped below AllOps |
| **AllOps** | 9 (everything except AnOps AI) | — | **US$49** / €45 per month |
| **MaxOps** | All 10, including AnOps AI | ✅ | **US$99** / €89 per month |

- Every plan includes **unlimited users**. Annual billing charges ten months out of twelve.
- **15-day trial**: pick two or three applications, no credit card. AnOps AI is reserved for MaxOps and cannot be selected for a trial or the free plan.
- A new organization is **reserved for 12 hours** until the owner confirms their email.
- Billing is handled with **Stripe** (checkout, webhooks, invoices) and a scheduled platform maintenance job.
- The pricing page recognises a signed-in organization: it shows the current plan, highlights upgrades and explains what a downgrade would cost.

---

## 🏗 Architecture

```mermaid
flowchart TB
    subgraph Client["Browser / PWA"]
        UI["React 19 · Tailwind 4 · App Router pages"]
    end

    subgraph Next["Next.js 16 (Turbopack)"]
        direction TB
        PX["proxy.ts<br/>auth gate · CSP nonce"]
        RSC["Server Components<br/>+ Server Actions"]
        API["Route handlers<br/>/api/v1/*"]
    end

    subgraph Server["src/server (server-only)"]
        direction TB
        SVC["Domain services<br/>hr · finance · inventory · purchasing<br/>manufacturing · marketing · community"]
        SEC["Tenancy · permissions · entitlements"]
        AI["AI layer<br/>orchestrator · tools · providers"]
        PLT["Platform<br/>subscriptions · billing · activation"]
    end

    subgraph Ext["External services"]
        DB[("MongoDB")]
        LLM["Groq · OpenRouter · Gemini"]
        PAY["Stripe"]
        MAIL["SMTP · Brevo"]
        SOC["Meta Graph · Telegram"]
    end

    UI --> PX --> RSC
    UI --> API
    RSC --> SVC
    API --> SVC
    SVC --> SEC
    SVC --> DB
    AI --> SVC
    AI --> LLM
    PLT --> PAY
    SVC --> MAIL
    SVC --> SOC
```

### Layering rules

1. **`src/app`**: routes only. Thin pages that import from `features` and `shared`.
2. **`src/features/<module>`**: UI components, server actions, Zod schemas, hooks and types of one domain.
3. **`src/server`**: server-only infrastructure and business services. No UI.
4. **`src/shared`**: reusable components, hooks, domain rules and configuration used by every module.
5. A **hidden button is never the only control**: every service asserts the permission it needs.

Full rules: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

### Money, stock and concurrency

- Quantities are **integer micro-units** and money is **integer minor units**, so there is no floating-point drift.
- Stock is an **append-only ledger** with a balances projection written only by one module; issues use a conditional update so stock can never go negative.
- Multi-document operations run in **majority-committed transactions** on a replica set; the standalone development server degrades to ordered, idempotent steps.

---

## 🔐 Multi-tenancy, roles and security

AnOps has **one authorization model per company**. A user's role is defined by their membership in the company they are working in, never globally.

| Company role | Workspace role | Typical access |
| --- | --- | --- |
| `owner` | owner | Full control, including company settings, members and billing |
| `admin` | admin | Full control of company data, approvals and count corrections |
| `manager` | operator | Day-to-day operations: staff, stock, receipts, production |
| `employee` | viewer | Read-only access to company data |

Security measures in place:

- **Tenant isolation**: the active company, user and role are resolved server-side on every request; every query is scoped by company.
- **Authentication**: Auth.js (NextAuth v5) credentials with bcrypt, email verification, password reset and forced reset flows.
- **Route guard** in `proxy.ts` plus a **per-request Content-Security-Policy** with a nonce.
- **Entitlement guard** on every application layout, and again inside services and server actions.
- **Zod validation** of every input and of the environment itself (`src/config/env.ts`).
- **Signed, idempotent unsubscribe links**, consent recheck on every marketing send, and an optional send allow-list for safe testing.
- **Encrypted social tokens**, webhook signature checks and deduplication.
- **Audit log** for sensitive and AI-made changes.

Permission catalogue and matrix: [docs/ROLES_AND_PERMISSIONS.md](docs/ROLES_AND_PERMISSIONS.md).

---

## 🧰 Tech stack

| Layer | Technology |
| --- | --- |
| Framework | **Next.js 16** (App Router, Server Components, Server Actions, Turbopack), **React 19** |
| Language | **TypeScript** (strict) |
| Database | **MongoDB** (native driver, transactions on a replica set) |
| Auth | **Auth.js / NextAuth v5** (credentials, MongoDB adapter), `bcryptjs` |
| Validation | **Zod 4**, React Hook Form |
| Styling | **Tailwind CSS 4**, design tokens in `globals.css`, `lucide-react` icons |
| AI | Groq, OpenRouter, Google Gemini through one provider layer |
| Payments | **Stripe** |
| Email / SMS | **Nodemailer** (SMTP), **Brevo** |
| Social | Meta Graph API (Facebook Pages), Telegram Bot API |
| Files | ExcelJS exports |
| Testing | **Vitest** (unit and integration) |
| CI / CD | GitHub Actions → Docker → GitHub Container Registry → Dokploy |

---

## 🗂 Project structure

```
AnOps/
├── src/
│   ├── app/                    # Routes only
│   │   ├── (marketing)/        # Public portal: home, apps, pricing, trial, industries…
│   │   ├── (auth)/             # Login, register, verify, reset
│   │   ├── (workspace)/        # /anops home, organization, profile, settings
│   │   ├── (dashboard)/        # Application areas: hr, finance, inventory, ai, marketing…
│   │   └── api/                # Route handlers (/api/v1/*)
│   ├── features/               # Domain modules (UI, actions, schemas, hooks)
│   │   ├── hr · finance · inventory · purchasing · manufacturing
│   │   ├── marketing · community · company · platform · ai · auth
│   ├── server/                 # Server-only services
│   │   ├── ai/                 # Orchestrator, tools, commands, providers, access, usage
│   │   ├── tenancy · tenant · security   # Workspace context, permissions
│   │   ├── platform/           # Subscriptions, billing, activation, invitations
│   │   ├── email · db · audit · exports
│   │   └── hr · finance · inventory · purchasing · manufacturing · marketing …
│   ├── shared/                 # Components, hooks, domain rules, config
│   ├── config/env.ts           # Zod-validated environment
│   └── proxy.ts                # Auth gate and CSP (replaces middleware)
├── tests/                      # unit/ and integration/
├── scripts/                    # Seeders, workers, maintenance
├── docs/                       # Module documentation and screenshots
├── uml-diagrams/               # Class diagrams (Mermaid + PNG)
├── public/                     # PWA manifest, service worker, brand kit
├── Dockerfile
└── .github/workflows/deploy.yml
```

---

## 🚀 Getting started

### Prerequisites

- **Node.js 22** and npm
- **MongoDB**. A single local server is enough for development; run a **replica set** to get real transactions (required by the integration tests).

### 1. Install

```bash
git clone https://github.com/HamaBTW/AnOps.git
cd AnOps
npm install
```

### 2. Configure

```bash
cp .env.example .env
```

At minimum set these three values:

```bash
MONGODB_URI=mongodb://localhost:27017
AUTH_SECRET=<output of: openssl rand -base64 32>
NEXTAUTH_URL=http://localhost:3000
```

Everything else is optional: a missing value disables only the integration that needs it. See [Configuration](#-configuration).

### 3. Run

```bash
npm run dev
```

Open <http://localhost:3000>, choose **Try it free**, pick up to three applications and create a workspace. Without SMTP configured, emailed links are printed in the server console in development.

### 4. Optional demo data

Populate a workspace so the dashboards are not empty (replace `<companyId>` with the organization id from the `companies` collection):

```bash
node scripts/seed-hr-demo.mjs --company <companyId>
npx vite-node -c vitest.config.mts scripts/seed-finance-demo.ts -- --company <companyId>
npx vite-node -c vitest.config.mts scripts/seed-marketing-demo.ts "<Organization name>"
```

Each seeder tags its records and has a `--clean` option. Marketing demo data never schedules or sends anything.

---

## ⚙️ Configuration

Environment variables are validated at startup by [`src/config/env.ts`](src/config/env.ts).

| Variable | Required | Purpose |
| --- | :-: | --- |
| `MONGODB_URI` | ✅ | MongoDB connection string |
| `AUTH_SECRET` | ✅ | Auth.js secret |
| `NEXTAUTH_URL` | recommended | Public URL of the app |
| `APP_URL` | production | Public base URL used in **every emailed link**. Falls back to `NEXTAUTH_URL`, then the platform host, then `http://localhost:3000`. Set it to `https://anops.tache-lik.tn` in production. |
| `EMAIL_SERVER_HOST` `EMAIL_SERVER_PORT` `EMAIL_SERVER_SECURE` `EMAIL_SERVER_USER` `EMAIL_SERVER_PASSWORD` `EMAIL_FROM` | optional | SMTP for transactional email. Unset in development = links are logged to the console. |
| `EMAIL_LOGO_URL` | optional | Overrides the logo embedded in emails |
| `GROQ_API_KEYS` `OPENROUTER_API_KEY` `GEMINI_API_KEYS` | optional | AI providers (comma-separated keys rotate on rate limits) |
| `AI_KILL_SWITCH` `AI_PRICE_PER_1K_TOKENS` `AI_PRICE_CURRENCY` `AI_COMPANY_DAILY_COST_LIMIT` | optional | AI safety and cost controls |
| `BREVO_*` | optional | Brevo email / SMS delivery and webhook token |
| `TELEGRAM_BOT_TOKEN` `TELEGRAM_BOT_USERNAME` `TELEGRAM_WEBHOOK_SECRET` | optional | Telegram integration |
| `FACEBOOK_APP_ID` `FACEBOOK_APP_SECRET` `SOCIAL_TOKEN_ENCRYPTION_KEY` | optional | Facebook Page publishing |
| `MARKETING_WEBHOOK_SECRET` `MARKETING_WORKER_SECRET` `MARKETING_SEND_ALLOWLIST` | optional | Marketing delivery events, worker and safe-send list |
| `STRIPE_API_KEY` `STRIPE_WEBHOOK_SECRET` | optional | Subscriptions and billing |
| `PLATFORM_CRON_SECRET` | optional | Protects the platform maintenance endpoint |

> Never commit `.env`. Real secrets are injected at runtime in production and are never baked into the Docker image.

---

## 📜 Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` / `npm start` | Production build and server |
| `npm run lint` · `npm run typecheck` | ESLint and TypeScript checks |
| `npm test` · `npm run test:watch` | Run the test suite |
| `npm run hr:seed-demo` · `hr:clean-demo` | Seed or remove HR demo data |
| `npm run finance:seed-demo` | Seed finance demo data |
| `npm run marketing:seed-demo` | Seed marketing demo data (never sends anything) |
| `npm run marketing:worker` · `marketing:worker:watch` | Run the campaign dispatch worker once or continuously |
| `npm run telegram:poll` | Telegram long polling for local development |
| `npm run platform:maintenance` · `:watch` | Expire unactivated organizations, trials and reminders |
| `npm run db:migrate-tenancy` | One-off migration to the multi-tenant model |
| `npm run hr:ai-eval` | Evaluate the HR assistant against its policy set |
| `npm run finance:ocr-check` | Live receipt-OCR check |

---

## 🧪 Testing

```bash
npm test
```

- **Unit tests** (41 files) cover domain rules: plans and entitlements, permissions, marketing state machines, money and stock maths.
- **Integration tests** (46 files) exercise the services and the AI layer against a real MongoDB **replica set**. Each test file gets its own database. Point `MONGODB_TEST_URI` at a disposable instance (default `mongodb://127.0.0.1:27018/?replicaSet=rs0&directConnection=true`).
- To run only the unit tests without a database: `ANOPS_SKIP_DB_PREFLIGHT=1 npx vitest run tests/unit`.

Before opening a pull request, run `npm run lint`, `npm run typecheck` and the tests.

---

## 🚢 Deployment

Production is served at **<https://anops.tache-lik.tn>**.

```mermaid
flowchart LR
    A[Push to main] --> B[GitHub Actions]
    B --> C[Docker build<br/>multi-stage]
    C --> D[(GitHub Container Registry<br/>:latest · :sha)]
    B --> E[Dokploy webhook]
    E --> F[Dokploy pulls image<br/>and restarts]
    F --> G[anops.tache-lik.tn]
```

- **Docker**: a multi-stage build (`deps` → `builder` → slim `runner`, Node 22) running as the non-root `node` user on port 3000.
- **CI/CD**: [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) builds and pushes the image to GHCR with a layer cache, then triggers the **Dokploy** webhook.
- **Secrets** are injected by Dokploy at runtime. Build-time values are placeholders only.
- **Required production settings**: `MONGODB_URI` (a replica set), `AUTH_SECRET`, `APP_URL=https://anops.tache-lik.tn`, SMTP, and the optional integration keys above.
- **Background jobs**: run `platform:maintenance:watch` and, when marketing is used, `marketing:worker:watch` next to the web process.
- AI deployment checklist: [docs/AI_COMMAND_CENTER_DEPLOYMENT.md](docs/AI_COMMAND_CENTER_DEPLOYMENT.md).

---

## 🎨 Design system

The brand is **forest-dark and warm-paper surfaces with a lime primary action**, **Manrope** headings and **Inter** UI text, in light and dark themes.

<p align="center">
  <img src="public/brand-kit/01-brand-identity/logos/anops-logo-primary-citron-on-deep-ink.svg" alt="AnOps logo on deep ink" height="90">
  &nbsp;&nbsp;
  <img src="public/brand-kit/02-app-icons/anops-app-icon-dark-512.png" alt="AnOps app icon" height="90">
</p>

| Token | Value |
| --- | --- |
| Action primary (citron) | `#C8F03E` |
| Deep ink | `#111F1D` |
| Warm paper | `#F7F7F2` |

Principles: responsive by default (a phone is as common as a desk), accessible focus handling, branded confirmation dialogs, toasts and inline validation instead of browser defaults, and honest empty states. Details: [docs/design-system.md](docs/design-system.md) · [docs/layout-rules.md](docs/layout-rules.md) · the brand kit in [`public/brand-kit`](public/brand-kit).

---

## 📐 UML diagrams

The domain model is documented as five module class diagrams plus a master diagram that connects the platform. Sources are Mermaid (`.mmd`) with rendered PNGs; the narrative is in [uml-diagrams/DIAGRAMS.md](uml-diagrams/DIAGRAMS.md).

<details>
<summary><b>Master class diagram</b></summary>
<br/>
<img src="uml-diagrams/class-diagrams/master-classDiagram-anops.png" alt="AnOps master class diagram">
</details>

<details>
<summary><b>Inventory, Purchasing & Manufacturing</b></summary>
<br/>
<img src="uml-diagrams/class-diagrams/inventory-manufacturing-management-diagram.png" alt="Inventory and manufacturing class diagram">
</details>

<details>
<summary><b>Human Resources, Time-off & Payroll</b></summary>
<br/>
<img src="uml-diagrams/class-diagrams/human-resources-timeOff-payroll-diagram.png" alt="HR class diagram">
</details>

<details>
<summary><b>Finance, Invoicing & Expenses</b></summary>
<br/>
<img src="uml-diagrams/class-diagrams/finance-invoicing-expense-management-diagram.png" alt="Finance class diagram">
</details>

<details>
<summary><b>Marketing, Campaigns & Social</b></summary>
<br/>
<img src="uml-diagrams/class-diagrams/marketing-campaigns-social-management-diagram.png" alt="Marketing class diagram">
</details>

<details>
<summary><b>Blog, Forum, Comments & Live chat</b></summary>
<br/>
<img src="uml-diagrams/class-diagrams/blog-forum-comments-live-chat-diagram.png" alt="Community class diagram">
</details>

---

## 📚 Documentation index

| Area | Documents |
| --- | --- |
| Architecture and rules | [ARCHITECTURE](docs/ARCHITECTURE.md) · [ROLES_AND_PERMISSIONS](docs/ROLES_AND_PERMISSIONS.md) · [design-system](docs/design-system.md) · [layout-rules](docs/layout-rules.md) |
| AI Command Center | [Architecture](docs/AI_COMMAND_CENTER_ARCHITECTURE.md) · [Security](docs/AI_COMMAND_CENTER_SECURITY.md) · [Operations](docs/AI_COMMAND_CENTER_OPERATIONS.md) · [Deployment](docs/AI_COMMAND_CENTER_DEPLOYMENT.md) · [Providers](docs/AI_PROVIDERS.md) |
| HR | [HR AI Copilot](docs/HR_AI_COPILOT.md) |
| Inventory, Purchasing, Manufacturing | [Implementation notes](docs/inventory-purchasing-manufacturing.md) |
| Finance | [Module tasks](docs/FINANCE_MODULE_TASKS.md) |
| Marketing | [Architecture and operations](docs/MARKETING.md) · [User guide](docs/MARKETING_GUIDE.md) · [Telegram](docs/TELEGRAM_INTEGRATION.md) · [Facebook login](docs/facebook-login.md) · [Brevo SMS](docs/brevo-sms.md) |
| Billing | [Stripe API notes](docs/STRIPE_API_DOCS.md) |
| Product | [PRODUCT.md](PRODUCT.md) · [Roadmaps](ANOPS_PLATFORM_WORKFLOW_ROADMAP.md) · [Production readiness](ANOPS_PRODUCTION_READINESS_ROADMAP.md) |

---

## 🗺 Roadmap

- **CRM** and **Sales** applications (announced, no backend yet).
- Instagram publishing (needs a separate Meta review).
- Migrating the remaining HR server actions to the shared permission catalogue.
- Reservations and FIFO / average costing in Inventory; partial production and scrap in Manufacturing.
- A production shared store for AI rate limits.

Items listed here are planned and not implemented.

---

## 👥 The team

AnOps is a team project, academic year **2026/2027**. Each member owns the design, implementation and documentation of their domain.

<table>
  <tr>
    <td align="center" width="20%">
      <a href="https://github.com/fekikarim">
        <img src="https://github.com/fekikarim.png?size=160" width="96" alt="Karim Feki"><br/>
        <b>Karim Feki</b>
      </a><br/>
      <sub>Full Design · AnOps AI · Inventory, Purchasing &amp; Manufacturing · UML</sub>
    </td>
    <td align="center" width="20%">
      <a href="https://github.com/nesrine-derouiche">
        <img src="https://github.com/nesrine-derouiche.png?size=160" width="96" alt="Nesrine Derouiche"><br/>
        <b>Nesrine Derouiche</b>
      </a><br/>
      <sub>Marketing &amp; Branding · Subscriptions</sub>
    </td>
    <td align="center" width="20%">
      <a href="https://github.com/hamabtw">
        <img src="https://github.com/hamabtw.png?size=160" width="96" alt="Mohamed Abidi"><br/>
        <b>Mohamed Abidi</b>
      </a><br/>
      <sub>HR &amp; Payroll · Sales · Multi-tenancy · Company · User management</sub>
    </td>
    <td align="center" width="20%">
      <a href="https://github.com/oussemaissaoui">
        <img src="https://github.com/oussemaissaoui.png?size=160" width="96" alt="Oussema Issaoui"><br/>
        <b>Oussema Issaoui</b>
      </a><br/>
      <sub>Finance &amp; CRM</sub>
    </td>
    <td align="center" width="20%">
      <a href="https://github.com/fatmahidouss">
        <img src="https://github.com/fatmahidouss.png?size=160" width="96" alt="Fatma Hidoussi"><br/>
        <b>Fatma Hidoussi</b>
      </a><br/>
      <sub>Blog &amp; Community</sub>
    </td>
  </tr>
</table>

| Member | GitHub | Responsibilities |
| --- | --- | --- |
| **Karim Feki** | [@fekikarim](https://github.com/fekikarim) | Full design, AnOps AI, Inventory, Purchasing, Manufacturing, UML |
| **Nesrine Derouiche** | [@nesrine-derouiche](https://github.com/nesrine-derouiche) | Marketing, Branding, Subscriptions |
| **Mohamed Abidi** | [@hamabtw](https://github.com/hamabtw) | HR & Payroll, Sales, Multi-tenancy, Company, User management |
| **Oussema Issaoui** | [@oussemaissaoui](https://github.com/oussemaissaoui) | Finance, CRM |
| **Fatma Hidoussi** | [@fatmahidouss](https://github.com/fatmahidouss) | Blog & Community |

---

<div align="center">

**AnOps** · One platform. Every operation.<br/>
<a href="https://anops.tache-lik.tn">anops.tache-lik.tn</a>

<sub>Built with care by the AnOps team · 2026/2027</sub>

</div>
