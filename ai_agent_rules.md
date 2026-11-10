# Agent Rules: Next.js + NextAuth PWA

## Core Architecture
- **Mobile-First:** Design and build for mobile screens first using Tailwind CSS (e.g., `flex-col`, `w-full` by default). Apply desktop styles using breakpoint modifiers (`md:`, `lg:`).
- **App Router:** Use Server Components (RSC) by default. Only use `'use client'` when browser APIs, state, or hooks are required.
- **Strict TypeScript:** No `any`. Use explicit types for props, API routes, and NextAuth session extensions.

## PWA & Offline Support
- **Manifest:** Maintain `public/manifest.json` with app icons (`192x192`, `512x512`, `maskable`), `display: "standalone"`, theme colors, and metadata.
- **Service Worker:** Configure `@ducanh2912/next-pwa` (or Serwist) for offline caching of static assets and critical routes.
- **Offline Fallback:** Provide a clean offline page (`/offline`) when requests fail and cache is unavailable.

## NextAuth (Auth.js)
- Configure auth in `app/api/auth/[...nextauth]/route.ts` (or `auth.ts`).
- Extend `Session` and `JWT` types explicitly in `types/next-auth.d.ts`.
- Protect routes via `middleware.ts` with graceful offline fallback handling.

## Multi-Tenancy & Data Isolation
- **Tenant Scoping:** The platform is multi-tenant. Every user belongs to one or more companies.
- **Mandatory `companyId`:** Every database query and insert must be filtered or populated with the active tenant's `companyId`.
- **Zero Cross-Tenant Leaks:** Never query business entities (employees, departments, attendance, payroll, invoices) globally without `companyId`.
- **Onboarding Flow:** Users without a company must be guided to create an initial company before accessing module dashboards.
- **One tenant boundary:** the company. Do not introduce organization, workspace or team scopes. Tenant-owned documents carry `companyId` only.
- **Required scope in code:** service functions take a required `companyId`. Never write `companyId?`, `cId ? {...} : {}`, or any fallback that runs without a company.
- **Selection is not authority:** the active-company cookie only chooses among companies the user already belongs to. Re-read the membership on every request.
- **Attendance and staff are per company:** employees, job titles, departments and attendance records belong to exactly one company. Never copy them between companies.

## UI/UX Rules
- Touch target sizes must be at least `44x44px`.
- Handle notch and navigation safe areas (`env(safe-area-inset-*)`).
- Multi-tenant company switcher must be accessible from mobile and desktop shells.

## AI Provider Rules

> Full reference: `docs/AI_PROVIDERS.md`

- **Single entry point:** ALL AI features MUST import from `@/server/ai` only.
  ```typescript
  import { ai } from "@/server/ai"; // ✅ correct
  import { GroqProvider } from "@/server/ai/providers/groq.provider"; // ❌ NEVER
  ```
- **Never call provider SDKs directly** — no `new Groq()`, `new GoogleGenerativeAI()`, or direct OpenRouter fetch.
- **Never hardcode API keys** — keys are read from env vars by provider constructors.
- **Server-only** — `@/server/ai` uses `import "server-only"`. Never import in client components or `proxy.ts`.
- **Prefer `ai.ask()`** for simple prompts; use `ai.complete()` when you need provider/model/usage metadata.
- **Always handle AI errors gracefully** — wrap calls in try/catch; AI outages must not break core features.
- **Multi-tenancy:** AI calls operating on company data must still scope queries with `companyId` before passing to AI.
- **Provider order (automatic):** Groq → OpenRouter → Gemini. Keys rotate on 429 automatically.
