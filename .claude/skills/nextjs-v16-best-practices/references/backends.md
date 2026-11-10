# Secure Backend Connections for Next.js 16

Use these patterns for PostgreSQL, MySQL, MongoDB, Supabase, and Neon. Each database module must be server-only.

## Shared rules

- Put clients in `lib/db/` and import `server-only` at the top.
- Read connection strings from `lib/env.ts` (validated with zod). Never hardcode.
- Cache the client on `globalThis` in development to avoid exhausting connections during hot reload.
- Set timeouts on every connection. Set pool sizes deliberately.
- Require TLS in production (`sslmode=require` or the driver's SSL option with certificate validation).
- Use a dedicated least-privilege database role for the app.

Shared env validation:

```ts
// lib/env.ts
import 'server-only'
import { z } from 'zod'

const schema = z.object({
  DATABASE_URL: z.string().url(),
  MONGODB_URI: z.string().optional(),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(), // server only, never NEXT_PUBLIC_
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
})

export const env = schema.parse(process.env)
```

## PostgreSQL (node-postgres `pg`)

```ts
// lib/db/postgres.ts
import 'server-only'
import { Pool } from 'pg'
import { env } from '@/lib/env'

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined
}

export const pool =
  globalThis.__pgPool ??
  new Pool({
    connectionString: env.DATABASE_URL,
    max: 10,                       // per instance; lower in serverless
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 10_000,     // kills runaway queries
    ssl: env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : undefined,
    application_name: 'my-nextjs-app',
  })

if (env.NODE_ENV !== 'production') globalThis.__pgPool = pool

pool.on('error', (err) => {
  // Log, do not crash the process on idle client errors.
  console.error('pg idle client error', { message: err.message })
})
```

Query with parameters and a transaction:

```ts
import { pool } from '@/lib/db/postgres'

export async function getOrdersForUser(userId: string, limit = 20) {
  const { rows } = await pool.query(
    'SELECT id, total_cents, status, created_at FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
    [userId, Math.min(limit, 100)],
  )
  return rows
}

export async function transferCredits(from: string, to: string, amount: number) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('UPDATE wallets SET balance = balance - $1 WHERE user_id = $2 AND balance >= $1', [amount, from])
    await client.query('UPDATE wallets SET balance = balance + $1 WHERE user_id = $2', [amount, to])
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
```

Notes:
- If you use PgBouncer or Supavisor in transaction mode, disable prepared statements in the driver.
- Use `pg` directly or an ORM (Drizzle with `drizzle-orm/node-postgres`, Prisma, Kysely). Do not mix ORMs in one feature.

## MySQL (`mysql2`)

```ts
// lib/db/mysql.ts
import 'server-only'
import mysql from 'mysql2/promise'
import { env } from '@/lib/env'

declare global {
  var __mysqlPool: mysql.Pool | undefined
}

export const mysqlPool =
  globalThis.__mysqlPool ??
  mysql.createPool({
    uri: process.env.MYSQL_URL,           // validate in lib/env.ts
    connectionLimit: 10,
    waitForConnections: true,
    queueLimit: 100,                      // bounded queue, fail fast under load
    connectTimeout: 5_000,
    enableKeepAlive: true,
    ssl: env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : undefined,
  })

if (env.NODE_ENV !== 'production') globalThis.__mysqlPool = mysqlPool
```

Parameterized query:

```ts
const [rows] = await mysqlPool.execute(
  'SELECT id, name FROM products WHERE category_id = ? LIMIT ?',
  [categoryId, 50],
)
```

- Use `execute` (prepared) or `query` with `?` placeholders. Never build SQL with template strings from input.
- Set `timezone` and `dateStrings` explicitly to avoid date bugs.

## MongoDB (official driver or Mongoose)

```ts
// lib/db/mongo.ts
import 'server-only'
import { MongoClient, type Db } from 'mongodb'
import { env } from '@/lib/env'

declare global {
  var __mongoClientPromise: Promise<MongoClient> | undefined
}

const options = {
  maxPoolSize: 10,
  minPoolSize: 0,
  serverSelectionTimeoutMS: 5_000,
  socketTimeoutMS: 30_000,
  retryWrites: true,
  tls: env.NODE_ENV === 'production',
}

const clientPromise =
  globalThis.__mongoClientPromise ??
  new MongoClient(env.MONGODB_URI!, options).connect()

if (env.NODE_ENV !== 'production') globalThis.__mongoClientPromise = clientPromise

export async function getDb(): Promise<Db> {
  const client = await clientPromise
  return client.db('app')
}
```

Safe queries:

```ts
import { ObjectId } from 'mongodb'

export async function getPost(id: string, ownerId: string) {
  if (!ObjectId.isValid(id)) return null
  const db = await getDb()
  // Build the filter from validated values only. Never pass raw user objects as filters.
  return db.collection('posts').findOne(
    { _id: new ObjectId(id), ownerId },
    { projection: { title: 1, body: 1, createdAt: 1 } },
  )
}
```

- Reject keys beginning with `$` from any user-supplied object before using it in a query (NoSQL injection).
- Validate documents with zod before insert.
- Create indexes in a migration script, not at request time.
- With Mongoose, use `strictQuery: true` and `lean()` for read-only queries.

## Supabase (`@supabase/ssr`)

Create three clients by context:

```ts
// lib/db/supabase/server.ts
import 'server-only'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,         // anon key is public by design; RLS protects data
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (items) => {
          try {
            items.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          } catch {
            // Called from a Server Component: ignore, the proxy refreshes sessions.
          }
        },
      },
    },
  )
}
```

```ts
// lib/db/supabase/browser.ts
import { createBrowserClient } from '@supabase/ssr'
export const createBrowserSupabase = () =>
  createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
```

Rules:
- Enable Row Level Security on every table in an exposed schema, and write policies that check `auth.uid()`. A table without RLS is readable by anyone with the anon key.
- Use the anon key plus the user's session for user-facing reads and writes, so RLS applies.
- Use `SUPABASE_SERVICE_ROLE_KEY` only in server-only modules for admin tasks (webhooks, background jobs). It bypasses RLS. Never expose it or prefix it with `NEXT_PUBLIC_`.
- Refresh sessions in `proxy.ts` using `supabase.auth.getClaims()` or `getUser()` (the server-validated call), not `getSession()` alone, because `getSession()` trusts the cookie.
- Use the pooled connection string (Supavisor, transaction mode) for direct Postgres access from serverless code, and disable prepared statements for that driver.
- Use `supabase gen types typescript` to type the client and keep types in sync with migrations.

## Neon (serverless Postgres)

Two options. Choose by workload:

HTTP driver for single queries in serverless or edge-like code:

```ts
// lib/db/neon.ts
import 'server-only'
import { neon } from '@neondatabase/serverless'
import { env } from '@/lib/env'

export const sql = neon(env.DATABASE_URL)

export async function getProject(id: string, ownerId: string) {
  const rows = await sql`SELECT id, name FROM projects WHERE id = ${id} AND owner_id = ${ownerId}`
  return rows[0] ?? null
}
```

Pooled connections for transactions or many queries per request:

```ts
import { Pool } from '@neondatabase/serverless'
export const pool = new Pool({ connectionString: env.DATABASE_URL, max: 5 })
```

With Drizzle: `drizzle-orm/neon-http` for HTTP, `drizzle-orm/neon-serverless` for transactions.

Rules:
- Use the pooled endpoint (host contains `-pooler`) for app traffic in serverless. Use the direct endpoint for migrations.
- Tagged template literals (`sql\`...\``) parameterize automatically. Do not use string concatenation.
- Neon scales to zero. Expect a cold start on the first query and set timeouts with that in mind.
- Keep pool `max` small. Neon enforces connection limits per compute size.
- Branch databases per preview environment and run migrations on the branch first.

## Migrations and schema

- Pick one tool: Drizzle Kit, Prisma Migrate, Knex, Atlas, or node-pg-migrate.
- Commit migration files. Run them in CI and as a deploy step, never from request handlers.
- Make migrations backward-compatible for zero-downtime deploys: add columns nullable first, backfill, then enforce constraints.
- Keep seed data separate from migrations.

## Connection health

- Expose a health route (`app/api/health/route.ts`) that runs `SELECT 1` with a short timeout. Return a generic status, not connection details.
- Handle transient errors (`ECONNRESET`, `57P01` admin shutdown, `ETIMEDOUT`) with a single retry for idempotent reads.

## Never do

- Create a pool per request.
- Connect from client components, or import any `lib/db` module from a `'use client'` file.
- Log connection strings, passwords, or full query params containing tokens.
- Use the Supabase service role key or a superuser database role in the app.
- Run unbounded `SELECT *` on large tables without pagination.
