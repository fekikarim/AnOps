<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Quick commands
- `npm run dev` - Next.js dev (Turbopack). Port 3000.
- `npm run build` / `npm run start` - Production build/start.
- `npm run lint` - ESLint (flat config, Next core-web-vitals + TS).
- `npm run typecheck` - `tsc --noEmit`.
- `npm run test` - Vitest run (`tests/**/*.test.ts`, node env). `npm run test:watch` for watch.
- `npm run db:migrate-tenancy` - Dry run multi-tenant migration; add `-- --apply` to write. Idempotent; see `scripts/migrate-multi-tenant.mjs`.

## Architecture (must follow)
- **App Router only**: `src/app/` is routes/layouts/route handlers only. Business logic goes in `src/features/`.
- **Layers**: `features/` (domain UI/actions/schemas/hooks/types), `server/` (auth/db/ai/services, server-only), `shared/` (reusable UI/layout/hooks/lib), `config/env.ts` (Zod). Use `@/*` → `./src/*`.
- **Server components by default**; `'use client'` only when needed. Server actions live in `features/*/actions/` with `'use server'`.
- **`proxy.ts` at `src/proxy.ts` (required)**: imports **only** `@/server/auth/config` (edge-safe). Never import `@/server/auth/index` there. Route handlers/actions use full `@/server/auth/index`. Do not use `src/middleware.ts`.
- **Auth**: NextAuth v5 (beta). Extend session/JWT in `src/server/auth/types.ts`. Account status `active|unverified|banned`. `(dashboard)` layout calls `requireActive()`; `proxy.ts` also guards.
- **Env**: Validate via `src/config/env.ts` (Zod). Never read `process.env` directly in features. Email optional (dev logs to console if missing).

## Multi-tenancy (critical)
- **Tenant = Company**. Shared DB, every tenant doc has `companyId: ObjectId`. **Every** read/write must filter by active `companyId`.
- **Services take required `companyId`** (no `companyId?`, no `cId ? {...}:{}` fallbacks). Missing/malformed throws.
- **Active tenant**: `anops_active_company_id` cookie; resolved via `getActiveTenant()`/`requireActiveTenant()` in `src/server/tenant/context.ts`. Cookie only selects companies user belongs to; membership re-checked each request.
- **Onboarding**: users with no memberships redirect to `/onboarding` (outside dashboard). Company creation seeds HR defaults via `seedHrDefaultsForCompany`.
- **Workspace context**: Inventory/Purchasing/Manufacturing use `src/server/tenancy/workspace.ts` (`resolveWorkspace/getPageWorkspace`). HR uses same tenant source.
- **HR roles**: resolved by `src/server/auth/rbac.ts` (company owner/admin → `hr_admin`, company manager or employee.role `manager` → `manager`, else employee record role). `requireAdminUser()` enforces HR admin.

## AI (strict)
- **Single entry**: `import { ai } from "@/server/ai"` only. Never import provider classes/SDKs directly. `@/server/ai` is server-only.
- **Order/failover**: Groq (multi-key, 429→60s cooldown via `KeyPool`) → OpenRouter → Gemini. Keys: `GROQ_API_KEYS`, `OPENROUTER_API_KEY`, `GEMINI_API_KEYS` (comma lists). If all fail, throws plain Error.
- **Usage**: `ai.ask()` simple; `ai.complete()` for messages/metadata. Handle errors (AI outages must not break core features). Company data passed to AI must still be scoped by `companyId`.

## Testing / gotchas
- **Vitest**: `tests/**/*.test.ts`, node env, `@` alias, `server-only` stubbed to `tests/stubs/server-only.ts` (so server modules load in tests).
- **Typecheck before commit**: `npm run typecheck`. Lint: `npm run lint`.
- **PWA**: `public/manifest.json`, `public/sw.js`, SW registered in prod via `src/shared/components/pwa-register.tsx`, `/offline` fallback.
- **Global errors**: `src/app/global-error.tsx` must be `'use client'` and include `<html>/<body>`.
- **Validation**: same Zod schema on client (react-hook-form + zodResolver, `noValidate`) and server. Helpers in `src/shared/lib/validation.ts`. Email verification/reset links use `getAppUrl()`; dev logs emails if not configured.
- **Security headers** set in `next.config.ts`. `outputFileTracingRoot` points up one level.
