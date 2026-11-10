# AnOps AI Command Center: deployment

## 1. Requirements

- **MongoDB replica set** (or a sharded cluster). Several operations use transactions: saving AI access, deleting a conversation together with its proposals, Community article deletion, and module workflows. On a standalone server these fail with `TRANSACTIONS_UNAVAILABLE`. `GET /api/v1/ai/health` reports `transactionsSupported`.
- At least one AI provider key.
- Node.js as required by the app; no Redis or other service. Rate limits, budgets and conversations live in MongoDB.

## 2. Environment variables

| Variable | Required | Meaning |
|---|---|---|
| `GROQ_API_KEYS` (or `GROQ_API_KEY`) | one provider needed | Comma-separated Groq keys; rotated on 429 |
| `GROQ_MODEL` | no | Override the default Groq model |
| `OPENROUTER_API_KEY` | no | Fallback provider (free models) |
| `GEMINI_API_KEYS` | no | Fallback provider |
| `AI_KILL_SWITCH` | no | `true`/`1`/`yes`/`on` blocks all AI for every company on the next request |
| `AI_PRICE_PER_1K_TOKENS` | no | Estimate price; enables the estimated-cost line |
| `AI_PRICE_CURRENCY` | no | 3-letter code, default `USD` |
| `AI_COMPANY_DAILY_COST_LIMIT` | no | Company daily spending cap in the price currency; needs a price |
| `MONGODB_URI`, `AUTH_SECRET`, `NEXTAUTH_URL` | yes | Platform |

Marketing, email, SMS, Telegram and social variables are documented in `docs/MARKETING.md`. Without a provider key AI chat answers "AI is not configured on this server" and slash commands still work. Keys are never sent to the browser or logged.

## 3. Defaults per company (changeable by an owner or admin at `/ai/access`)

AI is OFF until enabled. Retention 90 days (7 to 730). Company budget 500,000 tokens per UTC day and per-person 50,000 when no settings row exists; a saved row holds its own values (0 means no limit). The owner has built-in AI access until an explicit grant is saved.

## 4. Indexes

Created idempotently when the database is first used (`ensureIndexes`). AI: unique member grant, conversation owner/time and TTL on `expiresAt`, pending-action owner/status and TTL (24 h after expiry), usage (unique company/day/member, TTL on rows that carry `expiresAt`), per-model usage (unique, TTL), notices (TTL). Shared: `rate_limits` TTL. Community: blog, topic, reply, comment, category, chat conversation and message indexes, all leading with `companyId`.

## 5. Multi-instance behaviour

Safe across instances: rate limits, token budgets, proposals and their claim, conversations, usage. Per process only: provider key cool-downs, the in-memory limiter for the public unsubscribe form, the model list cache.

## 6. Release checklist

1. `GET /api/v1/ai/health` as an owner: `ok: true`, a provider configured, `transactionsSupported: true`, `killSwitchOn: false`.
2. `AI_KILL_SWITCH` unset or false.
3. If cost should be shown: set the price (and currency).
4. In production decide `MARKETING_SEND_ALLOWLIST` on purpose: unset means delivery is open in production.
5. Test environments: run against a disposable replica set. Tests clear `EMAIL_`, `SMTP_`, `BREVO_`, `TELEGRAM_`, `MARKETING_`, `FACEBOOK_`, `SOCIAL_`, `AI_`, `GROQ_`, `OPENROUTER_` and `GEMINI_` variables so real credentials never change a result.

## 7. Retention summary

| Data | Kept |
|---|---|
| Conversations | until `expiresAt` (last update + retention days); deleted by the person at any time |
| Open proposals | 10 minutes; row removed 24 h later; deleted conversation or disabled AI cancels them |
| Per-member and company usage rows | 400 days (rows created before this change have no expiry) |
| Per-model usage rows | 400 days |
| Rate-limit windows | about two windows |
| Notices | 365 days |
| Audit events | not expired by the AI feature |
| HR payroll and payslip cards | not stored in history |
