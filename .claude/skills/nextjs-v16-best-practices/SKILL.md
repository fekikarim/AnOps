---
name: nextjs-v16-best-practices
description: Production standards for Next.js 16 (App Router) projects covering architecture, caching (use cache, cacheLife, cacheTag, updateTag), async request APIs, proxy.ts, Server Actions and Route Handlers, security hardening, performance, responsive UI, and secure database connections (PostgreSQL, MySQL, MongoDB, Supabase, Neon). Use for any Next.js coding, review, refactor, or upgrade task.
---

# Next.js 16 Best Practices

Apply these rules whenever you write, review, or refactor Next.js code in this project. When a rule conflicts with a quick hack, follow the rule and say why. When unsure about an API detail, check the official docs at https://nextjs.org/docs before inventing a signature.

## 0. Version baseline

- Next.js 16 requires Node.js 20.9+ and React 19.2+. Check `package.json` and `node -v` before writing code.
- Turbopack is the default bundler for `next dev` and `next build`. Do not add custom webpack config unless you have verified it works with Turbopack; builds with custom webpack config can fail.
- Use TypeScript with `strict: true`.
- Keep `next` and `eslint-config-next` on the same version.
- Use the App Router (`app/`). Do not start new code in the Pages Router unless the project is already there and migration is out of scope.

Breaking changes from Next.js 15 that you must respect:

| Area | Next.js 15 | Next.js 16 |
|---|---|---|
| Network layer | `middleware.ts` (Edge or Node) | `proxy.ts`, exported function `proxy`, Node.js runtime only, no Edge runtime |
| Request APIs | `params`, `searchParams`, `cookies()`, `headers()`, `draftMode()` could be read synchronously (deprecated path) | All are async. Always `await` them |
| Caching | Implicit caching of `fetch` and route segments | Opt-in via `cacheComponents: true` and the `'use cache'` directive |
| Cache flag | `experimental.dynamicIO`, `experimental.ppr` | `cacheComponents`. Route-level `export const experimental_ppr` is removed |
| Revalidation | `revalidateTag(tag)` | `revalidateTag(tag, cacheLifeProfile)` (second argument required). Use `updateTag(tag)` in Server Actions for read-your-writes |
| Images | `images.domains` and `next/legacy/image` | `images.remotePatterns` and `next/image` only |

Remove `experimental.dynamicIO` and `experimental.ppr` when you migrate. Do not keep deprecated flags.

## 1. Project structure

Use a feature-oriented layout that keeps server-only code isolated:

```
app/                      routes, layouts, loading, error, not-found, route handlers
  (marketing)/            route groups for layout separation
  (app)/dashboard/page.tsx
  api/webhooks/[provider]/route.ts
components/
  ui/                     presentational, reusable, no data fetching
features/<feature>/       components, actions.ts, queries.ts, schemas.ts, types.ts
lib/
  db/                     database clients (server only)
  auth/                   session and authorization helpers (server only)
  env.ts                  validated environment variables (server only)
  dal.ts                  data access layer entry point
proxy.ts                  optimistic routing checks only (see section 4)
```

Rules:
- Put `import 'server-only'` at the top of every module that touches secrets, database clients, or privileged APIs. This turns accidental client imports into build errors.
- Use `import 'client-only'` for browser-only modules that read `window` or `localStorage`.
- Colocate private files with their feature. Only `page`, `layout`, `route`, `loading`, `error`, `not-found`, `template`, `default`, and `global-error` are routes.

## 2. Server vs Client Components

- Components are Server Components by default. Keep them that way.
- Add `'use client'` only to the smallest leaf that needs state, effects, event handlers, or browser APIs. Never put `'use client'` on a layout or page just to fix an error.
- Pass server data down as props. Do not import server modules into client components.
- Client components cannot receive functions or class instances as props. Pass Server Actions via `action={}` or as serializable data.
- Use `children` and composition to keep server-rendered content inside client wrappers (for example a client `Modal` that receives server-rendered `children`).
- Keep the `'use client'` boundary below expensive data-heavy trees to keep the JS bundle small.

## 3. Async request APIs (Next.js 16)

```tsx
// app/products/[id]/page.tsx
type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string }> }

export default async function Page({ params, searchParams }: Props) {
  const { id } = await params
  const { q } = await searchParams
  // ...
}
```

```ts
import { cookies, headers, draftMode } from 'next/headers'
const jar = await cookies()
const h = await headers()
const { isEnabled } = await draftMode()
```

- Type `params` and `searchParams` as `Promise<...>`. Do not read them synchronously.
- Run `npx next typegen` (or `next build`) to refresh route types if you use typed routes.
- Do not call `cookies()` or `headers()` inside a `'use cache'` function. Those values are request-specific. Read them outside the cache and pass the needed values in as arguments.

## 4. Proxy (`proxy.ts`), not a security boundary

File: `proxy.ts` at the project root (or in `src/`), next to `app/`.

```ts
// proxy.ts
import { NextResponse, type NextRequest } from 'next/server'

export function proxy(request: NextRequest) {
  const session = request.cookies.get('session')?.value
  if (!session && request.nextUrl.pathname.startsWith('/dashboard')) {
    return NextResponse.redirect(new URL('/login', request.url))
  }
  return NextResponse.next()
}

export const config = { matcher: ['/dashboard/:path*'] }
```

Rules:
- Use `proxy.ts` for optimistic checks, redirects, rewrites, locale routing, and adding headers. Keep it fast and small.
- Never treat proxy as the only auth check. Every Server Action, Route Handler, and data-access function must verify the session and authorization itself. Past Next.js releases had a middleware authorization bypass (CVE-2025-29927), which is why defense in depth is required.
- Do not run heavy database queries in proxy.
- If you must migrate from `middleware.ts`, confirm you do not depend on the Edge runtime first.

## 5. Caching (Cache Components)

Enable explicitly in `next.config.ts`:

```ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  cacheComponents: true,
}
export default nextConfig
```

With `cacheComponents: true`, nothing is cached unless you opt in. Dynamic code runs per request.

Pattern: keep pages dynamic and cache the deterministic parts.

```ts
// features/catalog/queries.ts
import { cacheLife, cacheTag } from 'next/cache'
import 'server-only'

export async function getProducts(categoryId: string) {
  'use cache'
  cacheLife('hours')
  cacheTag('products', `category:${categoryId}`)
  return db.product.findMany({ where: { categoryId } })
}
```

Rules:
- Put `'use cache'` on a function or a component that is pure with respect to the request: its output must depend only on its arguments. Pass user ids, locale, or tenant ids as arguments.
- Never put user-specific or session-specific data inside a cached function without including the user id in the args and the tags. Leaking one user's data to another is a critical security bug.
- Do not place `'use cache'` on a page component as your first step. Cache the data functions and leaf components.
- Use `cacheLife` profiles (`'seconds'`, `'minutes'`, `'hours'`, `'days'`, `'weeks'`, `'max'`) based on how fast the content changes. Do not invent durations in code.
- Tag every cached read with `cacheTag` so you can invalidate precisely.
- Wrap uncached dynamic parts in `<Suspense>` with a fallback so the static shell streams immediately.

Invalidation after mutations:

| API | Where | Behavior | Use when |
|---|---|---|---|
| `updateTag(tag)` | Server Actions only | Expires and refreshes immediately in the same request | The user must see their own change right away (read-your-writes) |
| `revalidateTag(tag, profile)` | Server Actions and Route Handlers | Stale-while-revalidate. Pass a `cacheLife` profile such as `'max'` or `'hours'` | Background refresh is fine, for example CMS webhooks |
| `refresh()` | Server Actions only | Refreshes uncached dynamic data on the current page. Does not touch the cache | Notification counts, live status badges |
| `revalidatePath(path)` | Server Actions and Route Handlers | Invalidates by route | Only when no tag exists. Prefer tags |

Server Action example:

```ts
'use server'
import { updateTag } from 'next/cache'

export async function renameProduct(prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser()
  const input = renameSchema.safeParse(Object.fromEntries(formData))
  if (!input.success) return { ok: false, errors: input.error.flatten().fieldErrors }

  await productRepo.rename({ id: input.data.id, ownerId: user.id, name: input.data.name })
  updateTag(`product:${input.data.id}`)
  return { ok: true }
}
```

Do not use the old `unstable_cache` or implicit `fetch` caching patterns in new code.

## 6. Data access layer (DAL)

All database and privileged reads go through `lib/dal.ts` or feature `queries.ts` files. Components never query the database directly.

```ts
// lib/dal.ts
import 'server-only'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { verifySession } from '@/lib/auth/session'

// React cache() dedupes this within one request.
export const getCurrentUser = cache(async () => {
  const token = (await cookies()).get('session')?.value
  if (!token) return null
  return verifySession(token) // returns null if expired or invalid
})

export async function requireUser() {
  const user = await getCurrentUser()
  if (!user) throw new AuthError('UNAUTHENTICATED')
  return user
}
```

Rules:
- Authorize per resource, not only per route. Check `resource.ownerId === user.id` or the relevant role/policy in the DAL.
- Select only the columns you need. Never return password hashes, tokens, internal ids, or other sensitive fields to the client.
- Map DB rows to DTOs before returning them to Client Components.
- Pass data from Server Components to Client Components as serializable props only (no class instances, no Dates unless converted, no functions).

## 7. Server Actions and Route Handlers

Server Actions:
- Put `'use server'` at the top of the file or inside the function. Keep action files in `features/<feature>/actions.ts`.
- Every action must: (1) authenticate, (2) authorize the target resource, (3) validate input with a schema, (4) perform the mutation, (5) invalidate cache with `updateTag` or `revalidateTag`, (6) return a typed result. Never trust client-side validation.
- Return `{ ok: true, data }` or `{ ok: false, error, errors? }` instead of throwing for expected failures. Reserve throws for unexpected errors.
- Use `useActionState` with `<form action={...}>` for forms, and `useFormStatus` for pending UI.
- Use `useOptimistic` for instant UI. On failure, the UI must roll back.
- Call `redirect()` only after the mutation is complete and cache invalidation is done. `redirect` throws internally, so do not wrap it in `try/catch`.
- Server Actions are POST endpoints reachable by anyone. Treat them as public APIs.

Validation pattern with zod:

```ts
import { z } from 'zod'
const renameSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(2).max(120),
})
```

Route Handlers (`app/api/.../route.ts`):
- Export only the HTTP methods you need. Set `export const dynamic` only when required.
- `params` is a Promise in Next.js 16: `const { id } = await ctx.params`.
- Validate method, content type, body size, and schema. Return `Response.json(...)` with explicit status codes.
- Verify webhook signatures (Stripe, GitHub, Supabase, etc.) using the raw body, before parsing.
- Use route handlers for webhooks and public APIs. Prefer Server Actions for in-app mutations.

## 8. Security hardening

Authentication and sessions:
- Use an established library (Auth.js, Clerk, Supabase Auth, Better Auth, Lucia-style session stores). Do not write your own crypto.
- Store sessions in `httpOnly`, `secure`, `sameSite: 'lax'` (or `strict`) cookies. Set short expiry plus refresh.
- Hash passwords with argon2id or bcrypt (cost 12+). Never store plaintext.
- Rate-limit login, password reset, OTP, and public mutations (use Upstash Ratelimit, a Redis-backed limiter, or your database).

Secrets and environment:
- Validate env vars at startup in `lib/env.ts` with zod. Fail fast on missing values.
- Only variables prefixed with `NEXT_PUBLIC_` reach the browser. Never prefix secrets with it.
- Use `server-only` on every module that reads secrets.
- Never commit `.env*.local`. Keep `.env.example` with placeholder values.

Input, output, and injection:
- Validate every input (params, search params, form data, headers, JSON bodies) with a schema.
- Use parameterized queries or an ORM (Drizzle, Prisma, Kysely). Never concatenate user input into SQL or NoSQL query objects. For MongoDB, reject `$`-prefixed keys from user input.
- Avoid `dangerouslySetInnerHTML`. If unavoidable, sanitize with DOMPurify on the server or a strict allowlist.
- Never build file paths, redirects, or fetch URLs from raw user input. Validate against an allowlist. For redirects, accept only relative paths.
- Restrict `images.remotePatterns` and `fetch` targets to known hosts to avoid SSRF.
- Escape or validate content in emails, PDFs, and HTML you generate.

Headers and browser policy (set in `next.config.ts` or proxy):

```ts
// next.config.ts
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
]
const nextConfig: NextConfig = {
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}
```

- For a strict Content Security Policy, generate a nonce per request in `proxy.ts`, set it in the CSP header, and read it in the root layout. Note that a nonce-based CSP makes routes dynamic, which fits Cache Components since you keep caching for data functions.
- Server Actions include built-in origin checks. Still set `serverActions.allowedOrigins` only if you proxy the app behind another domain. Do not disable checks.
- Set `poweredByHeader: false` in `next.config.ts`.

Errors:
- Never send stack traces or raw database errors to the client. Log them server-side with context and a request id.
- Use `error.tsx`, `global-error.tsx`, and `not-found.tsx` for user-facing messages.
- Add `app/error.tsx` as a client component with a reset button. Do not render `error.message` from server errors.

Taint protection (optional but recommended for sensitive data): `experimental.taint` can mark objects such as user records so they cannot be passed to the client by accident. Check the current docs before enabling it.

## 9. Performance

Rendering and streaming:
- Start with static or cached shells and stream dynamic parts behind `<Suspense>`.
- Fetch in parallel with `Promise.all`. Avoid sequential awaits in the same component tree (waterfalls).
- Preload data for children in parents when the child depends only on params.
- Use `loading.tsx` and `<Suspense>` for every slow segment.

Bundle size:
- Keep `'use client'` leaves small. Measure with `@next/bundle-analyzer` or `next build` output.
- Use `next/dynamic` (or `React.lazy`) for heavy, non-critical client code like charts, editors, and maps. Set `ssr: false` only for browser-only modules.
- Import only what you use from libraries (`import { x } from 'lib/x'`, not whole barrels). Use `optimizePackageImports` in `next.config.ts` for large icon or UI libraries.
- Avoid moment.js, lodash (full), and other large libraries. Prefer date-fns or dayjs and native APIs.

Images, fonts, and media:
- Use `next/image` with `width`/`height` or `fill` plus `sizes`. Always set `sizes` for responsive images so the browser downloads the right variant.
- Mark the hero or LCP image with `priority`.
- Configure `images.remotePatterns` for external hosts. Use modern formats (AVIF/WebP are automatic).
- Use `next/font` for fonts (self-hosted, no layout shift). Use `display: 'swap'`.
- Lazy-load video and heavy media. Use `preload="none"` where possible.

Data and caching:
- Cache by default for public read-mostly data (section 5). Keep per-user data dynamic.
- Deduplicate requests within a render with `React.cache`.
- Use `fetch` with `next: { tags }` only if you are not using `'use cache'` for the same data. Pick one model per data source.
- Paginate or cursor-paginate every list. Never return unbounded collections.

Core Web Vitals targets: LCP under 2.5 s, INP under 200 ms, CLS under 0.1. Verify with `next build` plus Lighthouse or Vercel Speed Insights.

## 10. Responsive design and smoothness

- Build mobile first. Use Tailwind breakpoints (`sm:`, `md:`, `lg:`) or CSS container queries for components that appear in different layouts.
- Set the viewport in `app/layout.tsx` via the `viewport` export, not a manual meta tag:

```ts
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#000' }
```

- Use fluid units: `clamp()` for type and spacing, `min-h-dvh` instead of `100vh` on mobile.
- Respect safe areas on notched devices with `env(safe-area-inset-*)`.
- Touch targets at least 44 by 44 px. Avoid hover-only interactions.
- Animate only `transform` and `opacity`. Respect `prefers-reduced-motion`.
- Use `view-transitions` or the Next.js-supported patterns for page transitions where they add value. Do not add motion for its own sake.
- Use `<Link>` for navigation so prefetching and client transitions work. Keep `prefetch` at its default unless a route is very large.
- Avoid layout shift: reserve space for images, fonts, ads, and async sections with skeletons that match final dimensions.
- Test at 360, 768, 1024, and 1440 px widths and with reduced motion enabled.

## 11. Database and backend connections

Read `references/backends.md` before writing any database code. Core rules that apply to every database:

1. One client or pool per process. Create it in a module that caches it on `globalThis` in development to survive hot reload. Never create a new pool per request.
2. Put every connection string in validated env vars. Require TLS in production.
3. Set explicit timeouts (connect, query or socket, server selection). A hung database must not hang requests.
4. Size pools to your database limits. In serverless, keep per-instance pools small (about 1 to 5) and use a pooler (PgBouncer, Supavisor, Neon pooled endpoint).
5. Use parameterized queries or an ORM. Never interpolate user input into SQL.
6. Wrap multi-step writes in transactions. Keep transactions short. Never call external APIs inside a transaction.
7. Retry only idempotent operations, with exponential backoff and jitter, capped at a small number of attempts.
8. Run migrations through a tool (Drizzle Kit, Prisma Migrate, Knex, Atlas, or Mongo migrations). Never edit production schemas by hand.
9. Use least-privilege database users: the app role should not own tables or have superuser rights.
10. Index every column used in `WHERE`, `JOIN`, and `ORDER BY` on hot paths. Check query plans with `EXPLAIN`.
11. Close resources in scripts and workers. Do not leave connections open in long-running jobs.
12. Log slow queries and errors with a request id. Never log secrets or full connection strings.

Supabase and Neon specifics are in `references/backends.md`: Supabase requires RLS on every exposed table and the `service_role` key must never reach the browser; Neon's serverless driver and pooled endpoints are the default choice for edge-friendly and serverless deploys.

## 12. Testing and quality gates

- Unit tests for schemas, pure utilities, and DAL authorization rules (Vitest).
- Integration tests against a real database container (Testcontainers or Docker Compose), not mocks, for queries and migrations.
- End-to-end tests for critical flows (Playwright), including mobile viewports.
- Run `tsc --noEmit`, ESLint (`eslint-config-next`), and tests in CI before merging.
- Add authorization tests: a user must not read or mutate another user's resources.
- Check the build with `next build` before deploying. Fail the pipeline on warnings you have not triaged.

## 13. Review checklist (run before finishing any task)

- [ ] Node 20.9+, Next.js 16, React 19.2 in use
- [ ] No `middleware.ts`; logic lives in `proxy.ts` and is not the only auth check
- [ ] `params`, `searchParams`, `cookies()`, `headers()`, `draftMode()` are awaited
- [ ] `cacheComponents` enabled only if the app uses `'use cache'`; deprecated flags removed
- [ ] No cached function reads request context; user-specific data is passed as args and tagged
- [ ] Every mutation authenticates, authorizes the resource, validates input, and invalidates cache
- [ ] `revalidateTag` has its second argument; `updateTag` used only in Server Actions
- [ ] `'use client'` is at the leaves; no secrets or DB clients reach the client bundle
- [ ] Modules with secrets import `server-only`
- [ ] Env vars validated; no secrets prefixed with `NEXT_PUBLIC_`
- [ ] Security headers and CSP configured; `poweredByHeader` disabled
- [ ] Errors are logged server-side and generic to users
- [ ] Lists are paginated; queries select only needed columns and are indexed
- [ ] `next/image` has `sizes`; fonts via `next/font`; heavy client code is dynamically imported
- [ ] Layout checked at mobile and desktop widths and with reduced motion
- [ ] Database client is a cached singleton with timeouts, bounded pool, and TLS

## 14. Anti-patterns to reject

- Adding `'use client'` to a whole page to fix one hook error
- Fetching data in `useEffect` in client components when a Server Component can fetch it
- Checking auth only in `proxy.ts`, a layout, or the client
- Creating a database client inside a component, route handler body, or action body without caching
- `await` inside loops that issue one query per item (N+1). Batch or join instead
- Using `revalidateTag('x')` without a profile in Next.js 16
- Calling `updateTag` from a Route Handler (it is Server Actions only)
- Calling `cookies()` or `headers()` inside `'use cache'`
- Caching responses that depend on the current user without the user id in the cache key
- Returning full database rows, password hashes, or tokens to the client
- `dangerouslySetInnerHTML` with unsanitized content
- Disabling TypeScript or ESLint rules to get a build through
- Using `any` on API boundaries. Type inputs with zod and infer types from schemas
- Storing JWTs or session tokens in `localStorage`

## 15. Source of truth

When this skill and the official docs disagree, trust the official docs and update this skill. Start from:
- Docs: https://nextjs.org/docs
- Upgrade guide: https://nextjs.org/docs/app/guides/upgrading/version-16
- Learn course: https://nextjs.org/learn
- Repository and release notes: https://github.com/vercel/next.js
