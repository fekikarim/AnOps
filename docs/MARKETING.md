# Marketing, Campaigns & Social — Architecture and Operations

Owner: Marketing module (Nesrine Derouiche's domain). Status and limits are stated per section. Anything not
listed as implemented here is not implemented.

## 1. Scope at a glance

| Area | Status |
| --- | --- |
| Contacts (CRUD, search, filters, sort, duplicates, archive/delete rules) | Implemented, tested |
| Tags (CRUD, many-to-many assignment, bulk assign/remove, tag filters) | Implemented, tested |
| Consent by channel and purpose, history, ordering rules | Implemented, tested |
| Suppression and unsubscribe (signed, idempotent links) | Implemented, tested |
| Audiences (typed rules, preview, exclusion breakdown) | Implemented, tested |
| Templates (CRUD, duplicate, activate, variable allowlist, SMS length, email designs) | Implemented, tested |
| Campaigns (state machine, approval, recipient snapshot, scheduling) | Implemented, tested |
| Dispatch worker (durable jobs, leases, retries, per-send consent recheck) | Implemented, tested against fake SMTP and Brevo providers |
| Delivery events and webhook receiver (signed, deduplicated) | Implemented, tested; not verified against any real provider |
| SMS sending (Brevo API) | Implemented, unit and integration tested with a fake Brevo client. **Not verified against a live Brevo account.** Requires a registered SMS sender |
| Email sending (Gmail/SMTP) | Implemented, unit and integration tested with a fake SMTP sender. Reuses `EMAIL_SERVER_*` / `EMAIL_FROM`. **Verified with one live Gmail delivery on 2026-10-26** to a controlled recipient; SMTP reports no delivery receipt |
| Email sending (Brevo API) | Implemented, tested with a fake client. Fallback only when SMTP is not configured. Disabled until `BREVO_EMAIL_MARKETING_APPROVED=true` |
| Facebook Page connection and publishing | Implemented against Meta's Graph API; **not verified against a live Meta app** |
| Instagram publishing | Not implemented (needs separate Meta review) |
| Social posts (draft, schedule, publish, cancel, ambiguous-result handling) | Implemented, tested with a fake publisher |
| AI copywriter (drafts, approval, copy into campaign/post) | Implemented, tested with a fake AI provider |
| Analytics (dashboard, campaign report, rates with denominators) | Implemented, tested |
| Telegram (third channel: connect, consent, campaigns, `/stop`, notifications) | Implemented; unit and integration tested against a mocked Telegram API. **Not verified against a live bot** (§14) |
| CRM / Sales integration | Contract defined (§3). No CRM code consumes it yet |

## 2. Domain entities and collections

All collections are prefixed `marketing_` and every document carries `companyId` (the tenant key).

| Collection | Purpose | Key constraints |
| --- | --- | --- |
| `marketing_contacts` | Canonical contact identity | Unique `(companyId, normalizedEmail)` where an email exists |
| `marketing_tags` | Tag definitions | Unique `(companyId, normalizedName)` |
| `marketing_contact_tags` | Many-to-many assignments | Unique `(companyId, contactId, tagId)` |
| `marketing_consent_events` | Append-only consent history | Never updated or deleted |
| `marketing_consent_states` | Effective consent per contact/channel/purpose | Unique `(companyId, contactId, channel, purpose)` |
| `marketing_suppressions` | Company suppression list (unsubscribed, bounced, complained, manual) | Unique `(companyId, channel, normalizedDestination)` |
| `marketing_audiences` | Saved selection rules (evaluated dynamically) | Unique `(companyId, normalizedName)` |
| `marketing_templates` | Reusable text, versioned | Unique `(companyId, normalizedName)` |
| `marketing_campaigns` | Campaign header, content, frozen snapshot summary | Versioned (optimistic concurrency) |
| `marketing_deliveries` | One row per campaign recipient, including suppressed ones | Unique `(companyId, campaignId, contactId)`; `providerMessageId` unique when set |
| `marketing_delivery_events` | Provider events | Unique `(companyId, providerEventId)` |
| `marketing_jobs` | Durable background jobs | Unique `(companyId, key)` |
| `marketing_social_accounts` | Connected Pages; encrypted token envelope | Unique `(companyId, platform, externalAccountId)` |
| `marketing_social_oauth_states` | Single-use OAuth states (SHA-256 of the state) | TTL on `expiresAt` |
| `marketing_social_posts` | Post drafts, schedules and publication records | Status machine (§6) |
| `marketing_ai_generations` | AI drafts, approval status, model metadata | Company and user indexes |
| `marketing_telegram_subscriptions` / `_link_tokens` / `_updates` | Telegram chat links, hashed single-use tokens, processed update ids | See §14.1 |

Indexes are declared in `src/server/marketing/indexes.ts` and merged into `src/server/db/indexes.ts`. They run
through the existing idempotent `ensureIndexes()`.

### Canonical contact identity and the CRM contract

`marketing_contacts` is the only person record for marketing. Rules for CRM and Sales:

1. CRM and Sales must reference a contact by its `_id` (`contactId`). They must not create a second record for the same person.
2. Identity is company-scoped. The same email address in two companies is two unrelated contacts. Nothing is merged across companies.
3. `email` is unique per company. Phone numbers are not unique, because households and businesses legitimately share them.
4. Campaign history for a contact is read from `marketing_deliveries` by `(companyId, contactId)`. CRM may report on it through `listDeliveries`-style queries; it must not copy it.
5. Lifecycle stage (`lead`, `prospect`, `customer`, `inactive`) is a single field on the contact. Tags are independent.
6. A contact with campaign or consent history cannot be deleted, only deactivated. CRM must follow the same rule.

## 3. Tenancy, permissions and routes

- Every service takes `WorkspaceContext` from `resolveWorkspace()` and never accepts a company id from input.
- Every read and write filters on `ctx.companyId`. Cross-company identifiers return `NOT_FOUND`.
- Permissions live in `src/server/security/permissions.ts` (`marketing.*`). Role mapping:

| Permission | owner | admin | operator | viewer |
| --- | :-: | :-: | :-: | :-: |
| `marketing.read` | ✓ | ✓ | ✓ | ✓ |
| `marketing.contact.manage` | ✓ | ✓ | ✓ | |
| `marketing.tag.manage` | ✓ | ✓ | ✓ | |
| `marketing.audience.manage` | ✓ | ✓ | ✓ | |
| `marketing.template.manage` | ✓ | ✓ | ✓ | |
| `marketing.consent.manage` | ✓ | ✓ | ✓ | |
| `marketing.campaign.manage` (drafts, submit) | ✓ | ✓ | ✓ | |
| `marketing.campaign.approve` (approve, return) | ✓ | ✓ | | |
| `marketing.campaign.dispatch` (schedule, cancel approved/scheduled) | ✓ | ✓ | | |
| `marketing.social.manage` (connect, disconnect, drafts) | ✓ | ✓ | ✓ | |
| `marketing.social.publish` (schedule, cancel posts) | ✓ | ✓ | ✓ | |
| `marketing.ai.generate` | ✓ | ✓ | ✓ | |

Separation of duties: the person who created or submitted a campaign cannot approve it. The owner (who holds
`dispatch`) may approve their own campaign; that exception is written to the audit event as `selfApproval: true`.

Pages live under `src/app/(dashboard)/marketing/`. Public routes: `/unsubscribe` (signed token only).
API routes:

| Route | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `/api/v1/marketing/worker` | POST | `Authorization: Bearer MARKETING_WORKER_SECRET` | Runs a bounded batch of due jobs |
| `/api/v1/marketing/webhooks/delivery` | POST | `x-anops-signature` HMAC | Records provider delivery events |
| `/api/v1/marketing/social/callback` | GET | Session + single-use OAuth state | Completes Facebook Page connection |
| `/api/v1/marketing/webhooks/telegram` | POST | `X-Telegram-Bot-Api-Secret-Token` | Receives Telegram updates (`/start`, `/stop`, blocked) |

Server actions live in `src/features/marketing/actions/`. Every action validates input with the shared Zod schema,
resolves the workspace, checks permission in the service, and returns `ActionResult`.

## 4. Consent and suppression

- Consent is recorded per channel (`email`, `sms`) and purpose (`marketing`). Email consent never authorises SMS.
- `marketing_consent_events` keeps everything. `marketing_consent_states` holds the effective state.
- Ordering: an event changes the effective state only if its `occurredAt` is newer than the stored one. On equal times, a
  withdrawal wins. Older events are kept in history but do not change the state.
- Eligibility (`src/server/marketing/eligibility.ts`) is the only rule set. It is checked in order:
  1. contact is active and not `inactive` stage
  2. a destination exists for the channel
  3. effective marketing consent for that channel is `granted`
  4. the destination is not on the suppression list
- Eligibility is evaluated when a campaign is approved (to build the snapshot) and again immediately before every provider call.
- Unsubscribe links are HMAC-signed (key derived from `AUTH_SECRET` with a fixed label). They carry company, contact, channel
  and optional campaign, and cannot be edited. Confirmation is a button (not a GET), so mail scanners that prefetch links
  change nothing. Repeated confirmations are idempotent.
- Bounces and complaints add the destination to the suppression list.

Legal basis: the code records and enforces the consent state it is given. Whether a given jurisdiction requires opt-in,
opt-out, or a particular notice is a business decision that needs qualified review. The module does not assert compliance.

## 5. Audiences and recipient snapshots

- Audiences store a typed rule (`all`/`any` over at most 10 conditions: lifecycle stage, source, active, tags (any/all),
  consent (granted/not granted), created after). Rule values are validated by Zod and become typed Mongo clauses; no
  client-supplied operators are possible.
- Membership is **evaluated dynamically**. It is never stored as a list.
- Preview evaluates at most 20,000 contacts and reports when it truncates.
- **Snapshot rule:** at approval, every matching contact is evaluated once. Eligible contacts become `pending` delivery rows,
  and the rest become `suppressed` rows with a reason. The unique `(companyId, campaignId, contactId)` index makes a contact
  appear at most once. Snapshots are capped at 20,000 recipients.
- Approval rebuilds the snapshot idempotently. A failed approval leaves no approved state.
- Audience edits never change an approved campaign. Campaign content is locked from submission onward.

## 6. State machines

**Campaign** (`src/features/marketing/utils/campaign-state.ts`):

```
draft → pending_approval → approved → scheduled → processing → completed
  │          │  ↑ (return)     │           │            └────→ failed
  └──→ cancelled ←─────────────┴───────────┘  (cancel allowed until processing)
```

Every transition is a conditional update that checks the expected status and version. Two users cannot both approve or
schedule the same campaign. Delivery state is separate: a campaign completes even when some deliveries failed.

**Delivery:** `pending → sending → sent → delivered | bounced | complained`; `pending|sending → failed`; any
unsent recipient at dispatch → `suppressed` with a reason. A late `delivered` never overwrites a bounce.

**Job:** `queued → running → succeeded | queued (retry or requeue) | dead | cancelled`.

**Social post:** `draft → scheduled → publishing → published`; `publishing → failed | needs_reconciliation`;
`failed → scheduled | draft`; `scheduled → cancelled | draft`. `needs_reconciliation` is terminal for the automatic
flow because the provider may have accepted the post.

**AI draft:** `generated_draft → edited → approved_for_use`; editing an approved draft clears approval; `failed` is terminal.

### Email designs

Templates and campaigns store a `design`: `plain` (default), `classic`, `minimal`, `newsletter`, `promo`, `aurora`,
`spotlight`, `neon`, `glass` or `confetti`. The body stays plain text with the same variable allowlist; the server
wraps it in table-based HTML with inline CSS. Author HTML is never accepted or rendered. `plain` keeps the previous
output. Designed layouts fold a trailing `Unsubscribe: …` line into a styled footer so the link appears once, while
the text part is unchanged. Documents created before designs existed render as `plain`. SMS always uses `plain`, and
the schema rejects any other value.

`aurora`, `spotlight`, `neon`, `glass` and `confetti` add gradients, shadows and CSS motion. Motion is progressive
enhancement: it plays in Apple Mail and iOS, while clients that strip `<style>` (Gmail, most Outlook versions) show
the static inline colours. `prefers-reduced-motion` disables every animation.

## 7. Background processing

Scheduled work is stored as a row in `marketing_jobs` with a `runAt` time. Nothing runs on a timer in the web process.

- `POST /api/v1/marketing/worker` claims up to 5 due jobs per call. Each claim takes a 10-minute lease; a crashed
  worker's lease expires and another worker takes the job.
- Campaign dispatch advances at most 20 deliveries per run and requeues itself until none are pending.
- Per-delivery retry: exponential backoff with full jitter, up to 5 attempts. Permanent errors fail immediately.
- Job retry: up to 6 attempts, then `dead`. A dead campaign job marks the campaign `failed`.
- Provider rate limit: `minIntervalMs` between sends, sequential. Brevo adapters use 200 ms; the SMTP adapter uses
  1,000 ms (60 messages/minute) because a Gmail account also carries authentication mail and has daily quotas.
- Send timeout: 15 seconds per provider call.
- **Duplicate-send safety:** a delivery is retried only when the provider did not process the request (SMTP 4xx,
  HTTP 429, or a failure before the provider was called). A timeout, mid-stream disconnect, 5xx, or unreadable reply
  may mean the message was accepted, so the delivery ends as `failed` with code `AMBIGUOUS_SEND` and is never retried
  automatically. Check the provider's logs before resending. Definite rejections (SMTP 5xx, bad credentials, bad
  recipient, not allowlisted, invalid content) also fail without retry. A row left in `sending` by a crashed run is
  also failed as `AMBIGUOUS_SEND`, never resent.
- **Accepted is not delivered.** A successful SMTP or API call moves the delivery to `sent`. `delivered`, `bounced`,
  `complained`, `opened` and `clicked` are only recorded from explicit provider events. SMTP provides no automatic
  delivery receipts, so an SMTP campaign normally stays at `sent` until a provider event says otherwise.

**Operating requirement:** an external scheduler must call the worker endpoint every minute:

```bash
curl -X POST "https://<your-host>/api/v1/marketing/worker" \
  -H "Authorization: Bearer $MARKETING_WORKER_SECRET"
```

For local development, `npm run marketing:worker` performs one call against `http://localhost:3000`, and
`npm run marketing:worker:watch` repeats it every 60 seconds. Set `MARKETING_WORKER_URL` to target another host.
Scheduling a campaign in the UI only writes a `queued` job; until a worker call happens, every delivery stays `pending`.

Examples (choose one; none is created by this repository):

```cron
# crontab -e  (every minute)
* * * * * curl -fsS -X POST "https://your-host/api/v1/marketing/worker" -H "Authorization: Bearer $MARKETING_WORKER_SECRET" >/dev/null
```

```ini
# /etc/systemd/system/anops-marketing-worker.timer
[Unit]
Description=Call the AnOps marketing worker every minute

[Timer]
OnBootSec=60
OnUnitActiveSec=60
AccuracySec=5s

[Install]
WantedBy=timers.target
```

```yaml
# Platform scheduler (for example a container cron sidecar), every minute
schedule: "* * * * *"
command: 'curl -fsS -X POST "$APP_URL/api/v1/marketing/worker" -H "Authorization: Bearer $MARKETING_WORKER_SECRET"'
```

Without a scheduler, scheduled campaigns and posts never run. The Integrations page reports whether the secret is set;
it **cannot** verify that a scheduler is calling. Scheduler activation is a deployment step, not a code state. In this
repository no scheduler is configured or verified.

Run one worker invocation at a time. Pacing (`minIntervalMs`) and the 20-delivery batch are enforced per worker; two
overlapping workers would each send at that rate and together could exceed the Gmail account's quota.

## 8. Providers, webhooks and what "sent" means

- `src/server/marketing/providers.ts` returns an adapter for a channel only when its settings are valid. Otherwise the
  channel is unconfigured and scheduling is refused. **Nothing is reported as sent unless the provider returns or
  accepts a message identifier.**
- **SMTP email (preferred when configured):** reuses the authentication account (`EMAIL_SERVER_HOST`,
  `EMAIL_SERVER_PORT`, `EMAIL_SERVER_SECURE`, `EMAIL_SERVER_USER`, `EMAIL_SERVER_PASSWORD`, `EMAIL_FROM`). The adapter
  validates the recipient and content, honours `MARKETING_SEND_ALLOWLIST`, sets a deterministic `Message-ID` from the
  delivery id, and paces at one message per second. SMTP acceptance moves the row to `sent`, never `delivered`.
  Connection test: `transporter.verify()` (handshake + login, no message). The transport is shared with sign-in mail;
  the marketing policy and templates are not.
- Brevo SMS: `POST https://api.brevo.com/v3/transactionalSMS/send` with `type: "marketing"`. The response `messageId`
  is stored. Recipients are digits with the country code. The sender must be 11 letters/digits or 15 digits.
- Brevo email: `POST https://api.brevo.com/v3/smtp/email`, response `messageId`. Used only when SMTP is not configured.
  Offered only when `BREVO_EMAIL_MARKETING_APPROVED=true`. Brevo's policy for marketing mail through this transactional
  endpoint must be confirmed by the account owner first.
- **Brevo webhooks are not signed.** Brevo's documentation describes no signature, shared secret or IP allowlist for
  event callbacks. The receiver is therefore `POST /api/v1/marketing/webhooks/brevo/<BREVO_WEBHOOK_TOKEN>`, with the
  token compared in constant time. Treat the full URL as a secret. Rotate `BREVO_WEBHOOK_TOKEN` if it leaks. This is a
  weaker control than a signature.
- Event dedupe: Brevo events carry no documented unique id per event. A SHA-256 over the event's stable fields is the
  dedupe key, so a repeated event is stored once. A company is taken from the stored delivery, never the payload.
- Brevo email events mapped: delivered, hard bounce (bounced), spam (complained), blocked and invalid email (failed),
  opened, click, unsubscribed. Soft bounces and deferrals are ignored. SMS mapping (`delivered`, `hard_bounce`,
  `rejected`, `blacklisted`, `unsubscribe`) is based on documented event names. Confirm the exact status strings against
  a real payload from your account before relying on SMS reporting. Unknown values are ignored.
- Controlled recipients: set `MARKETING_SEND_ALLOWLIST` for the first live sends. Non-listed destinations are refused
  before any request is made.

## 9. Integrations setup

### SMTP email (Gmail or any SMTP account)
1. Reuse the values already used for authentication mail. For Gmail: `EMAIL_SERVER_HOST=smtp.gmail.com`,
   `EMAIL_SERVER_PORT=587`, `EMAIL_SERVER_SECURE=false`, `EMAIL_SERVER_USER=<address>`,
   `EMAIL_SERVER_PASSWORD=<16-character App Password>`. Enable 2-Step Verification and create an App Password; a normal
   account password will be rejected.
2. Set `EMAIL_FROM` to a mailbox the account may send as (normally the same address as `EMAIL_SERVER_USER`).
3. Set `APP_URL` to the public address of the deployment (for example `https://app.example.com`). Every campaign email
   contains an unsubscribe link built from it. In production, scheduling an email campaign is refused while the resolved
   URL is localhost, a private address or a `.local` name, because recipients could not open the link.
4. Optional but recommended for the first live send: set `MARKETING_SEND_ALLOWLIST` to your own address. Every other
   recipient is refused before SMTP is contacted.
5. Open **Marketing → Integrations** and press **Test connection**. It calls `transporter.verify()`; no message is sent.
   The page then shows **Tested** (success within 7 days), **Configured** (no test yet), **Unverified** (last test
   failed or is stale), or **Setup needed** (missing settings).
6. The SMTP account's daily quota is shared with sign-in mail. The adapter paces at one message per second and the
   worker sends at most 20 deliveries per run. For large lists, use a dedicated transactional provider.
7. Live verification requires one real message to a controlled address and one provider event if delivery/bounce
   reporting is expected. SMTP itself does not report delivery, opens, clicks or bounces.

### Brevo (SMS and optional email fallback)
1. Create the API key in Brevo under SMTP & API. Set `BREVO_API_key`. Do not use Brevo's SMTP key or MCP key here.
2. Verify the sender domain for email (SPF, DKIM, DMARC) in Brevo, then set `BREVO_SENDER_EMAIL` and `BREVO_SENDER_NAME`.
3. For SMS, register the sender ID in every country you message (required for accounts created after 13 March 2026, per
   Brevo's help centre). Set `BREVO_SMS_SENDER`.
4. Generate `BREVO_WEBHOOK_TOKEN` (for example `openssl rand -base64 48`). In Brevo, add the event callback URL
   `<APP_URL>/api/v1/marketing/webhooks/brevo/<BREVO_WEBHOOK_TOKEN>`. For SMS, the adapter also sends this URL per
   message as `webUrl`.
5. Start with `MARKETING_SEND_ALLOWLIST` set to your own test numbers and addresses. Remove it only after successful
   controlled sends.
6. Leave `BREVO_EMAIL_MARKETING_APPROVED=false` until you have confirmed Brevo's policy for this use.

Required live checks before production: a controlled SMS send, a delivered callback, a bounce callback, and an
unsubscribe callback, each observed in Brevo and in the Campaign delivery list.

### Facebook Pages
1. Create a Meta app. Add the *Facebook Login* product. Set the valid OAuth redirect URI to
   `<NEXTAUTH_URL>/api/v1/marketing/social/callback`.
2. Request only: `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`. Publishing to Pages requires Meta app review.
3. Set `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` and `SOCIAL_TOKEN_ENCRYPTION_KEY`.
4. The Graph API version is `META_GRAPH_VERSION` in `src/server/marketing/config.ts`. Confirm it against Meta's current
   version before enabling.

Flow: `startSocialConnection` stores a hash of a random 256-bit state (10-minute expiry, bound to the company and user).
The callback consumes the state atomically, re-checks the user's live membership and role, exchanges the code, upgrades
to a long-lived token, lists Pages, and stores each Page token encrypted.

### Token encryption
- `SOCIAL_TOKEN_ENCRYPTION_KEY`: 32 random bytes, encoded as **base64 (44 characters, ending in `=`)** or **hex (64 characters)**.
  Generate with `openssl rand -base64 32`. Anything else disables the integration with a message naming the variable.
- Envelope: `v1.<iv>.<tag>.<ciphertext>` (AES-256-GCM, 12-byte random IV per encryption, 16-byte tag).
- Tokens are never returned by any DTO, log line, or error message.
- **Rotation:** the envelope has a version field. Rotation requires decrypting with the old key and re-encrypting with the new
  one. No rotation tool is provided yet; plan for it before the first production rotation.

### AI copywriter
Uses the shared server-side provider master (`@/server/ai`). It is unavailable until a provider key is set. Generation is
rate-limited to 10 per user per hour in-process; a multi-instance deployment needs a shared limiter. Prompts put the brief
inside `<brief>` tags with instructions in the system prompt. No contact data is sent to the model. No entitlement check
exists yet for AI features; add one when plans are enforced.

### Environment variables

| Variable | Required for | Notes |
| --- | --- | --- |
| `APP_URL` | Emailed links (verification, reset, unsubscribe) | Public HTTPS base URL. Falls back to `NEXTAUTH_URL`; a local/private value blocks email scheduling in production |
| `EMAIL_SERVER_HOST` / `EMAIL_SERVER_PORT` / `EMAIL_SERVER_SECURE` / `EMAIL_SERVER_USER` / `EMAIL_SERVER_PASSWORD` / `EMAIL_FROM` | SMTP email (auth and campaigns) | Existing variables. One account for both. `EMAIL_SERVER_USER` and password must be set together |
| `MARKETING_SEND_ALLOWLIST` | Controlled live sends | Comma-separated addresses/numbers; applies to SMTP and Brevo |
| `FACEBOOK_APP_ID` | Facebook Pages | Not secret, but keep in configuration |
| `FACEBOOK_APP_SECRET` | Facebook Pages | Server only |
| `SOCIAL_TOKEN_ENCRYPTION_KEY` | Facebook Pages | Format in §9 |
| `MARKETING_WEBHOOK_SECRET` | Delivery webhooks | At least 32 characters |
| `MARKETING_WORKER_SECRET` | Background worker | At least 32 characters |
| `AUTH_SECRET` | Unsubscribe links | Existing variable; changing it invalidates existing links |
| `GROQ_API_KEYS` / `OPENROUTER_API_KEY` / `GEMINI_API_KEYS` | AI copywriter | Any one |

## 10. Analytics definitions

All rates use stated denominators and return "No data" when the denominator is zero.

- **Accepted** = sent + delivered + bounced + complained (the provider took the message).
- **Delivery rate** = delivered ÷ accepted.
- **Bounce rate** = bounced ÷ accepted. **Complaint rate** = complained ÷ accepted.
- **Failure rate** = failed ÷ eligible recipients at approval (failed messages were never accepted).
- **Open rate (estimate)** = unique opens ÷ delivered. Mail privacy features and scanners inflate opens. Shown only when the
  provider reports opens. **Click rate** = unique clicks ÷ delivered, shown only when clicks are reported.
- **Unsubscribes** = unsubscribe confirmations attributed to the campaign.

## 11. Demo data

`npm run marketing:seed-demo` fills one or both workspaces with realistic, fully clickable demo data. Pass company
slugs to limit the run; the default is both demo workspaces:

```bash
npm run marketing:seed-demo                 # Farmy and Flybox
npm run marketing:seed-demo -- farmy        # one workspace
SEED_COMPANIES=flybox npm run marketing:seed-demo
```

What it creates per workspace: 5 tags, 20 contacts (every lifecycle stage and source, mixed email/SMS consent, one
withdrawn consent, two inactive contacts, two manually suppressed destinations), 5 audiences, 5 templates
(4 email + 1 SMS) and 6 campaigns. Campaigns stop at **draft**, **pending approval**, **approved** or **cancelled**.

Safety properties:

- Every record is prefixed with `[Demo]` and is created through the normal services, so rules and audits match the UI.
- Rerunning is idempotent: records are matched by unique email and normalized name, and campaign states only move forward
  to the seeded target.
- The script never calls `scheduleCampaign`. An approved demo campaign has `pending` delivery rows but **no dispatch job**,
  so the worker cannot send it. The script fails if it finds a job or any delivery past `pending` for a demo campaign.
- Demo addresses use the reserved `example.test` domain, so even an accidental send is undeliverable.
- The script refuses to run when `NODE_ENV=production` unless `ALLOW_DEMO_SEED=1` is set explicitly.

## 12. Testing

```bash
npx vitest run tests/unit/marketing-domain.test.ts          # pure rules, schemas, crypto, tokens, signatures
npx vitest run tests/unit/smtp-provider.test.ts             # SMTP config, validation, error classes, registry, status
npx vitest run tests/integration/marketing.test.ts          # contacts, tags, consent, audiences, campaigns, dispatch, webhooks, unsubscribe, tenancy
npx vitest run tests/integration/marketing-smtp.test.ts     # SMTP adapter through dispatch: consent, retries, partial failure, tenancy
npx vitest run tests/integration/marketing-social-ai.test.ts # Facebook OAuth flow, social posts, AI copy (Meta and AI mocked)
npx vitest run tests/integration/marketing-routes.test.ts    # worker, webhook and callback route handlers
```

Integration tests need a MongoDB replica set on `127.0.0.1:27018` (see `tests/helpers/workspace.ts`). The
social and AI tests mock the Meta configuration, Graph API and AI provider. No real message, post or model call is made.

## 13. Known limitations

- Brevo has not been exercised against a live account from this repository. Every Brevo call is mocked in tests.
- Brevo webhooks are unauthenticated apart from the URL token. Delivery reporting is only as trustworthy as that token.
- Email marketing through the transactional endpoint is disabled until policy is confirmed.
- Facebook publishing and OAuth follow Meta's documented endpoints but were not exercised against a live Meta app.
- Rate limits and AI quotas are per process. They are not global across instances.
- Provider webhooks use a generic signed contract; no provider-specific verification exists.
- No token-rotation tool exists for `SOCIAL_TOKEN_ENCRYPTION_KEY`.
- Contact list search on free text uses an anchored-or-contains regex scoped by company; large companies need a text index.
- Pagination is page-based (skip). Deep pages get slower; keyset pagination is the next step.
- Standalone MongoDB (no replica set) runs multi-document writes with compensation. That is for development only.
- Calendar view for social posts is a chronological list, not a month grid.
- Audience evaluation is capped at 20,000 contacts; larger audiences must be narrowed.
- No contact merge or duplicate-resolution workflow. Two contacts with the same email in one company are blocked at creation; existing duplicates created by other means must be resolved by hand.
- No contact import (CSV). Contacts are created one at a time.
- No Instagram publishing, no provider-side revocation on disconnect, and no social post analytics.
- Telegram: not verified against a live bot; no delivery, read or click data exists; `/stop` applies to every company that linked the chat; rich formatting (HTML/MarkdownV2), media and inline buttons are not supported; the polling script is for development only.

## 14. Telegram channel

Telegram is a third campaign channel next to email and SMS. It uses the same contacts, audiences, templates, campaigns,
approval workflow, snapshot, `marketing_jobs` worker, deliveries and reports. There is no separate Telegram engine.
**Status: implemented and tested with a mocked Telegram API. Not verified against a live bot.** The checks below under
"Live verification" are still to be done by someone holding the real bot token.

### 14.1 Data

| Collection | Purpose | Key constraints |
| --- | --- | --- |
| `marketing_telegram_subscriptions` | One linked chat per contact (`chatId`, `username`, `status` active / blocked / disconnected, bounded `history`) | Unique `(companyId, contactId)` and unique `(companyId, chatId)` |
| `marketing_telegram_link_tokens` | Single-use connection tokens, stored as SHA-256 only | TTL on `expiresAt` (15 minutes) |
| `marketing_telegram_updates` | Processed Telegram `update_id`s, so a retry is a no-op | TTL of 7 days |

Consent, suppression and deliveries reuse the existing collections with `channel: "telegram"`. The suppression destination and
the delivery destination are the chat id. `providerMessageId` is stored as `<chatId>:<messageId>` because Telegram message ids
are only unique within a chat and the delivery index requires a globally unique value.

### 14.2 Connecting a contact

1. A user with `marketing.contact.manage` opens a contact and presses **Connect Telegram**. The server creates a 256-bit random
   token, stores only its hash (15 minute expiry) and returns `https://t.me/<bot>?start=<token>`. Creating a new link deletes
   unused earlier links for that contact.
2. The customer opens the link and presses Start. Telegram posts `/start <token>` to the webhook.
3. The webhook consumes the token atomically (`consumedAt: null` and not expired), reads the company and contact from the stored
   token, and writes the chat id. Replays, expired and unknown tokens all answer "invalid".
4. The contact page polls every 4 seconds while a link is waiting and flips to **Connected**.

Rules: only private chats are linked; a chat already linked to a *different* contact of the same company is refused; the same
Telegram account can be linked to contacts of different companies independently; no browser request can supply a chat id.
**Connecting is not consent.** It records no consent event.

### 14.3 Consent and eligibility

- `telegram` is a third consent channel. Email or SMS consent never authorises it.
- Recording Telegram consent (contact page, consent form) needs an active chat link and the `marketing.consent.manage` permission.
- Saving the contact form never grants or withdraws Telegram consent (the form only manages email and SMS).
- Eligibility adds one check for Telegram: an `active` subscription must exist (otherwise `missing_destination`, shown as
  "No valid address or chat"). The same rule set runs at approval, at snapshot creation and immediately before each send.
- `/stop` (sent in the chat) withdraws Telegram consent, adds the chat to the suppression list and attributes the opt-out to the most
  recent Telegram campaign. Because one bot serves every company and the customer cannot name one, `/stop` applies to **every company**
  that linked that chat. A later explicit consent grant by a team member lifts the `/stop` suppression for that chat. Bounce or manual
  suppressions are not lifted.
- If Telegram reports the bot was blocked or the chat does not exist, the subscription becomes `blocked` and later campaigns skip it.
  The customer must press Start on a new link. Telegram's `my_chat_member` updates (blocked / unblocked) do the same.

### 14.4 Messages

Plain text only. No `parse_mode` is ever sent, so customer-supplied values cannot become markup. Allowed variables: `{{first_name}}`,
`{{last_name}}`, `{{company_name}}`. There is no subject, no design and no unsubscribe link. Every message ends with a blank line and
`Send /stop to stop receiving marketing messages.` The body limit is 4,096 minus that footer (`TELEGRAM_BODY_MAX`). A message that
would exceed Telegram's 4,096 limit after variable substitution fails with `CONTENT_INVALID`; nothing is truncated.

### 14.5 Sending

- Provider: `src/server/marketing/providers/telegram/` (`config.ts`, `client.ts`, `adapters.ts`). Registered only when
  `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` and `TELEGRAM_WEBHOOK_SECRET` are all valid.
- Pacing: 50 ms between sends (about 20 per second, under Telegram's documented 30 per second broadcast limit), sequential, inside the
  existing 20-delivery batch.
- Errors: HTTP 429 is retryable and the retry is never earlier than Telegram's `retry_after`. 403 (blocked), 400 chat not found, 401
  and 400 bad content are definite failures and are not retried. Timeouts, 5xx, an unreadable reply, or an `ok` reply without a message
  id are `AMBIGUOUS_SEND` and are never retried automatically.
- `sent` means Telegram accepted the message and returned a message id. **Telegram gives no delivery, read or click signal**, so
  `delivered`, `opened` and `clicked` are never recorded for it.
- `MARKETING_SEND_ALLOWLIST` also applies to Telegram; list chat ids (digits) there for controlled first sends.

### 14.6 Analytics

Telegram reports show Eligible, Suppressed, Accepted by Telegram, Failed, Pending and Unsubscribes. Delivery rate, bounce rate,
complaint rate, open rate and click rate are marked **"Not reported by Telegram"** instead of showing 0 %. The Overview has a Channels
summary with campaigns, accepted messages and connected / unreachable contacts per channel.

### 14.7 Notification service for other modules

`sendTelegramNotification(db, { companyId, contactId, message, purpose, actorUserId, requestId })` in
`src/server/marketing/telegram-notify.ts`. The destination is always read from the stored subscription of that company and contact;
callers cannot pass a chat id. `purpose: "transactional"` needs an active chat link but no marketing consent and adds no opt-out
line. `purpose: "marketing"` runs the full eligibility rules and adds the opt-out line. The result is audited without the text.
No other module calls it yet.

### 14.8 Setup

1. In Telegram, open `@BotFather` and send `/newbot`. Name it **AnOps Notifications** and choose a username ending in `bot`. BotFather
   returns the token. Optionally set the description with `/setdescription` (text in `docs/TELEGRAM_INTEGRATION.md` section 2) and the
   command list with `/setcommands`: `start - Connect your account` and `stop - Stop marketing messages`.
2. Set in the server environment (never with a `NEXT_PUBLIC_` prefix):
   ```env
   TELEGRAM_BOT_TOKEN=<token from BotFather>
   TELEGRAM_BOT_USERNAME=<username without @>
   TELEGRAM_WEBHOOK_SECRET=<openssl rand -hex 32>
   ```
3. Set `APP_URL` to the public **HTTPS** address, then open **Marketing -> Integrations**. Press **Test connection** (calls `getMe`;
   sends nothing) and **Register webhook** (calls `setWebhook` with the secret and `allowed_updates: message, my_chat_member`, then reads
   `getWebhookInfo` back and only reports success if Telegram shows the same address).
4. The webhook endpoint is `POST /api/v1/marketing/webhooks/telegram`. It requires the `X-Telegram-Bot-Api-Secret-Token` header, compared
   in constant time. Wrong or missing secret: 401. Not configured: 503. Bad body: 400 / 413. Processing failure: 500 so Telegram retries.
5. Local development (no public address): run `npm run telegram:poll`. It refuses to start while a webhook is registered; remove one
   with `npm run telegram:poll -- --delete-webhook`. Never run polling and a webhook together.
6. A worker must still call `/api/v1/marketing/worker` every minute (section 7). Telegram campaigns wait for it like any other.

### 14.9 Live verification still required

Nothing in this repository has been run against Telegram itself. Before relying on it: (1) press Test connection with the real token;
(2) register the webhook and confirm the page says confirmed; (3) connect your own account through a link and receive the reply;
(4) grant consent, approve and send a campaign to yourself (use `MARKETING_SEND_ALLOWLIST=<your chat id>`); (5) send `/stop` and
confirm a new campaign skips you; (6) block the bot, send again, and confirm the contact turns Unreachable.

### 14.10 Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Integrations says Setup needed and names a variable | The variable is missing or malformed (token must look like `123456:ABC...`, secret 32-256 of `A-Za-z0-9_-`) |
| Test fails with `AUTH_REJECTED` | Wrong or revoked token. Re-issue it in BotFather |
| Test fails with `USERNAME_MISMATCH` | `TELEGRAM_BOT_USERNAME` is not the bot that owns the token |
| Register webhook button missing | `APP_URL` is local or not HTTPS. Use polling locally |
| Pressing Start does nothing | Webhook not registered, secret mismatch (check the 401s in your logs), or polling is not running |
| "Link is invalid" reply | Expired (15 min), already used, or replaced by a newer link |
| Contact shows Unreachable | The customer blocked the bot. Ask for a new link |
| Campaign shows everyone suppressed | No Telegram consent recorded, or the chat is not linked. See the exclusion breakdown |

### 14.11 Security notes

The bot token stays on the server and is never put in a DTO, log or error message (the API URL contains it, so request URLs are never
logged). Link tokens and OAuth-style secrets are hashed at rest. Webhook updates are validated with Zod, deduplicated by `update_id`
(the claim is released if processing fails, so Telegram's retry still works) and never trusted for company identity. Link creation,
disconnects and the integration actions are rate limited per user. Audit events: `marketing.telegram.link_created`, `.connected`,
`.disconnected`, `.stopped`, `.blocked`, `.unblocked`, `.notification_sent`, `.notification_failed`, plus the existing consent and
campaign events. Webhook-driven events use the contact's last editor as the audit actor because no user is present.
