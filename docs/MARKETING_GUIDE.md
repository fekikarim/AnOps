# Marketing & Social Management — Complete Guide

This guide explains what the Marketing & Social module does today, how each feature works, and why it behaves the way it does. It is written to be read top to bottom. For the strict reference version (collections, env vars, limits), see [MARKETING.md](./MARKETING.md). Statements here were checked against the code on branch `feat/ai-sms`; where something is not verified live, it says so.

---

## 1. The big picture

The module lets a company **build a contact base, collect and respect consent, send email/SMS campaigns to selected groups, publish posts to Facebook Pages, draft copy with AI, and measure results**. Everything is multi-tenant: each record carries a `companyId`, and one company never sees another's data.

```
Contacts ──┬─ Tags
           ├─ Consent (per channel)        ┌─ Templates ──┐
           └─ Suppression / Unsubscribe    │              ▼
                    │                      │       Campaign (email | SMS)
                    ▼                      │              │ approval → frozen recipient snapshot
              Audiences (rules) ───────────┴──────────────┤ schedule → durable job
                                                          ▼
                                   Worker ──► Provider (SMTP / Brevo) ──► Deliveries
                                                          ▲                    │
                                           Webhooks (delivered/bounced/…) ◄────┘
                                                          │
                                                   Analytics & reports

Social: Facebook Page connection (OAuth) → Post draft → schedule → Worker → Meta Graph API
AI copywriter: brief → draft → human edit → approve → copy into a draft campaign or social post
```

### The ten tabs (`/marketing/*`)

| Tab | URL | What it is for |
| --- | --- | --- |
| Overview | `/marketing` | KPI cards, campaigns by status, deliveries by status, unsubscribes, published posts, AI drafts (30 days) |
| Contacts | `/marketing/contacts` | The people you can message |
| Tags | `/marketing/tags` | Labels to group contacts |
| Audiences | `/marketing/audiences` | Saved rules that select contacts |
| Campaigns | `/marketing/campaigns` | Email/SMS sends with approval workflow |
| Templates | `/marketing/templates` | Reusable message text and email designs |
| Social | `/marketing/social` | Facebook Page accounts and posts |
| AI copy | `/marketing/ai` | AI-generated drafts |
| Analytics | `/marketing/analytics` | Per-campaign reports |
| Integrations | `/marketing/integrations` | What is configured/tested (secrets never shown) |

Public page (no login): `/unsubscribe?token=…`.

If neither an email nor an SMS provider is configured, the Overview shows a warning banner: campaigns can be drafted and approved but not scheduled.

---

## 2. Who can do what (permissions)

Defined in `src/server/security/permissions.ts`. Roles: owner, admin, operator (a company "manager"), viewer (a company "employee").

| Permission | Allows | owner | admin | operator | viewer |
| --- | --- | :-: | :-: | :-: | :-: |
| `marketing.read` | See everything | ✓ | ✓ | ✓ | ✓ |
| `contact.manage` | Create/edit/archive contacts, bulk tags | ✓ | ✓ | ✓ | |
| `tag.manage` | Create/edit/delete tags | ✓ | ✓ | ✓ | |
| `audience.manage` | Create/edit audiences | ✓ | ✓ | ✓ | |
| `template.manage` | Create/edit templates | ✓ | ✓ | ✓ | |
| `consent.manage` | Record consent changes | ✓ | ✓ | ✓ | |
| `campaign.manage` | Draft, edit, submit, duplicate, delete drafts | ✓ | ✓ | ✓ | |
| `campaign.approve` | Approve or return a campaign | ✓ | ✓ | | |
| `campaign.dispatch` | Schedule / cancel a scheduled campaign | ✓ | ✓ | | |
| `social.manage` | Connect/disconnect Pages, write drafts | ✓ | ✓ | ✓ | |
| `social.publish` | Schedule / cancel posts | ✓ | ✓ | ✓ | |
| `ai.generate` | Generate, edit, approve AI drafts | ✓ | ✓ | ✓ | |

**Separation of duties.** The person who created or submitted a campaign cannot approve it. The exception is anyone who also holds `campaign.dispatch`: that exception is written to the audit log as `selfApproval: true`.

**Server-side enforcement.** Every service function calls `requireMarketing(ctx, permission)` before touching data. The UI hides buttons using a server-computed `actions` object (`canEdit`, `canSubmit`, `canApprove`, …), but the server re-checks on every action — hiding a button is never the security boundary.

---

## 3. Contacts, tags and consent

### 3.1 Contacts

A contact is the **single canonical person record** for marketing (`marketing_contacts`).

- Fields: first name (required, ≤80), last name, email (≤254, validated), phone (≤25, normalised), `source` (`manual`, `import`, `website`, `referral`, `event`, `other`), `lifecycleStage` (`lead`, `prospect`, `customer`, `inactive`), `isActive`.
- Email is **unique per company** (on the normalised address). Phone is **not** unique, since households/businesses share numbers.
- List page: free-text search, filters (lifecycle, source, active, tags with any/all), sort (name/email/created), 25 per page.
- A contact with campaign or consent history **cannot be deleted**, only deactivated, so history stays intact.
- Detail page (`/marketing/contacts/[id]`) shows the contact, its tags, per-channel consent with history, and delivery history.
- Not built: CSV import, contact merge/duplicate resolution (listed under known limitations in MARKETING.md).

### 3.2 Tags

Free-form coloured labels (name ≤40, hex colour). Many-to-many with contacts. Unique per company on the normalised name. Contacts can be bulk-tagged/untagged (up to 50 at a time). Tags feed audiences.

### 3.3 Consent

Consent is stored **per channel** (`email`, `sms`) and purpose (`marketing`). Email consent never authorises SMS.

- `marketing_consent_events` is an append-only history. `marketing_consent_states` holds the effective state.
- An event changes the effective state only if its `occurredAt` is **newer** than the stored one; on a tie, **withdrawal wins**. Older events are kept in history but do not change the state.
- Consent sources: `manual`, `import`, `form`. A consent date cannot be in the future (5-minute tolerance).

### 3.4 Eligibility — the one rule set

`src/server/marketing/eligibility.ts` decides if a contact may receive a message on a channel. Checked in order:

1. contact is active and not in `inactive` stage
2. a destination exists for the channel (email address / phone)
3. effective consent for that channel is `granted`
4. destination is not on the suppression list

It runs **twice**: when a campaign is approved (to build the recipient snapshot) and again **immediately before each send**. So withdrawing consent or unsubscribing after approval still stops the message.

### 3.5 Suppression and unsubscribe

- `marketing_suppressions` is a company-wide list (reasons: unsubscribed, bounced, complained, manual). Bounces and complaints add the destination automatically.
- Every email contains an unsubscribe link: `APP_URL/unsubscribe?token=…`. The token is an HMAC signature (key derived from `AUTH_SECRET`) over company, contact, channel and optional campaign. It cannot be edited. Changing `AUTH_SECRET` invalidates existing links.
- The page shows a **confirm button** — a plain GET changes nothing, so email scanners that prefetch links cannot unsubscribe people. Confirming is idempotent.
- SMS messages get the line `Reply STOP to opt out.` appended (it counts toward the 480-character limit).

> The code records and enforces the consent it is given. Whether your jurisdiction needs opt-in or opt-out wording is a legal decision the module does not make.

---

## 4. Audiences

An audience is a **saved rule**, not a list of people. Membership is **evaluated dynamically** each time.

A rule is `match: all | any` over 1–10 conditions of these typed kinds:

| Condition | Meaning |
| --- | --- |
| `lifecycle_stage` | one or more stages |
| `source` | one or more sources |
| `active` | active or inactive |
| `tags` | up to 20 tags, match any/all |
| `consent` | channel + `granted` / `not_granted` |
| `created_after` | date `YYYY-MM-DD` |

Rules are validated by Zod and turned into typed Mongo clauses; clients can never supply raw operators. The builder UI shows a live **preview**: how many match, how many are eligible for a channel, and **why others are excluded** (an exclusion breakdown). Preview evaluates at most 20,000 contacts and tells you when it truncated. An inactive audience cannot be used by a new campaign.

---

## 5. Templates

Reusable message content (`marketing_templates`), per channel, versioned (each edit bumps `version`). Actions: create, edit, duplicate, activate/deactivate.

**Variables** — an explicit allowlist, written `{{name}}`:
`first_name`, `last_name`, `email`, `company_name`, `unsubscribe_url`. Any other `{{…}}` is rejected at save time (never sent literally). Nothing is evaluated; templates are plain text.

**Limits:** email subject ≤150, email body ≤10,000, SMS body ≤480 including the opt-out line. SMS shows an approximate segment count (160 chars/segment for ASCII text, 70 if it contains non-ASCII; 153/67 when concatenated).

### Email designs
Email templates/campaigns pick a `design`: `plain` (default), `classic`, `minimal`, `newsletter`, `promo`, `aurora`, `spotlight`, `neon`, `glass`, `confetti`. The body is still plain text; the server wraps it in table-based HTML with inline CSS. **Author HTML is never accepted or rendered** (all text is escaped), which removes an injection risk. `aurora`/`spotlight`/`neon`/`glass`/`confetti` add gradients and CSS motion — motion works in Apple Mail/iOS, while Gmail and most Outlook strip `<style>` and show static colours; `prefers-reduced-motion` disables animation. SMS always uses `plain` (the schema rejects anything else). The form has a design picker and a live email preview.

---

## 6. Campaigns — the core workflow

A campaign = name + channel + audience + (optional template) + subject/body + design. Choosing a template **copies** its content into the campaign and remembers `templateVersion`; later template edits do not change the campaign.

### 6.1 Lifecycle

```
draft ──submit──► pending_approval ──approve──► approved ──schedule──► scheduled ──worker──► processing ──► completed
  ▲                     │  │                       │                       │                      └──► failed
  └───────return────────┘  └────────────────── cancel (draft/pending/approved/scheduled; NOT once processing) ──► cancelled
```

What each step does (`campaign.service.ts`):

| Step | Who | Effect |
| --- | --- | --- |
| Create / edit | `campaign.manage` | Only in `draft`. Edits bump `contentVersion`; a stale tab gets a `CONFLICT` (optimistic concurrency via `version`) |
| Submit | `campaign.manage` | `draft → pending_approval`. **Content is locked** from here |
| Return | `campaign.approve` | Back to `draft` for changes |
| Approve | `campaign.approve` | Verifies audience is active, **freezes recipients** (snapshot, §6.2), records `eligible`/`suppressed` counts and `selfApproval` in audit |
| Schedule | `campaign.dispatch` | Requires a configured provider. Writes the status change **and** a `campaign.dispatch` job in one transaction. Empty time = send now; max 365 days ahead; not in the past |
| Cancel | depends on state | `scheduled` needs dispatch, `approved` needs approve, others need manage. Cancels the queued job in the same transaction |
| Duplicate / Delete | `campaign.manage` | Duplicate makes a `Copy of …` draft; only drafts can be deleted |

Every transition is a **conditional update** checking expected status and version, so two people cannot approve or schedule the same campaign twice.

Production guard: scheduling an **email** campaign is refused if `APP_URL` resolves to localhost/private/`.local`, because recipients could not open the unsubscribe link.

### 6.2 The recipient snapshot

At approval every matching contact is evaluated once. Eligible contacts become `pending` rows in `marketing_deliveries`; the rest become `suppressed` rows **with a reason**. A unique `(companyId, campaignId, contactId)` index guarantees a person appears at most once. Cap: 20,000 recipients. Later audience edits don't alter an approved campaign. The campaign detail page shows matched / eligible / suppressed counts and an exclusion breakdown.

### 6.3 Campaign detail page
Sections: Edit draft (while draft) or locked Content with email preview, Recipients (snapshot), Deliveries (paginated, filter by status, **masked** addresses like `j•••@example.com` / `••••1234`), Execution (job status, attempts, next run, last error), Recent events (last 100 provider events).

---

## 7. Sending: worker, jobs and providers

### 7.1 Nothing runs by itself
Scheduling only writes a `queued` row in `marketing_jobs`. **An external scheduler must call the worker every minute** or nothing is sent:

```bash
curl -X POST "https://<host>/api/v1/marketing/worker" -H "Authorization: Bearer $MARKETING_WORKER_SECRET"
```

Local development: `npm run marketing:worker` (one call to `http://localhost:3000`) or `npm run marketing:worker:watch` (every 60 s; override with `MARKETING_WORKER_URL`). In this repository **no production scheduler is configured or verified** — that is a deployment step. The Integrations page can tell you the secret is set, not that something is calling it. Run one worker invocation at a time.

### 7.2 How a run behaves (`dispatch.ts`, `jobs.ts`)
- Claims up to **5 due jobs** per call, each under a **10-minute lease**. A crashed worker's lease expires and another worker takes over. Job keys are unique per company, so enqueueing is idempotent.
- A campaign job handles up to **20 deliveries** per run, then requeues itself until none are pending. The campaign becomes `completed` when no delivery is `pending`/`sending`, even if some failed (delivery state is tracked separately).
- Before each send: claim the delivery (`pending → sending`, so a racing duplicate run does nothing), **re-check eligibility**, render the message, call the provider with a 15-second timeout, then store the provider's message id and mark `sent`.
- Pacing: Brevo adapters 200 ms between sends; SMTP 1,000 ms (60/min) because a Gmail account is shared with sign-in mail and has daily quotas.
- Job retry: up to 6 attempts, then `dead`; a dead dispatch job marks the campaign `failed`.

### 7.3 Duplicate-send safety (important)
A delivery is retried **only** when the provider certainly did not process it (SMTP 4xx, HTTP 429), up to 5 attempts with exponential backoff and jitter. Definite rejections (bad credentials, bad recipient, not allowlisted, invalid content, SMTP 5xx) fail without retry. A timeout, dropped connection, 5xx or unreadable reply **may** mean the message went out, so it ends as `failed` with code `AMBIGUOUS_SEND` and is **never retried automatically** — an operator must check the provider's logs. A row stuck in `sending` for 10+ minutes after a crash is also failed as `AMBIGUOUS_SEND`. This prefers "maybe not sent" over "sent twice".

### 7.4 "Sent" is not "delivered"
`sent` = the provider accepted the message and returned an id. `delivered`, `bounced`, `complained`, `opened`, `clicked` appear **only** from explicit provider events. Plain SMTP gives no receipts, so SMTP campaigns normally stay at `sent`.

Delivery statuses: `pending → sending → sent → delivered | bounced | complained`; `failed`; `suppressed`. A late `delivered` never overwrites a bounce.

### 7.5 Providers (`providers.ts`)
A channel is available only if its provider settings are valid; otherwise scheduling is refused.

| Channel | Provider | Notes |
| --- | --- | --- |
| Email | **SMTP** (preferred) | Reuses the `EMAIL_SERVER_*` / `EMAIL_FROM` account. Live-verified once with Gmail on 2026-10-26 to a controlled address |
| Email | **Brevo API** (fallback) | Only when SMTP isn't configured **and** `BREVO_EMAIL_MARKETING_APPROVED=true` (Brevo's policy for marketing via the transactional endpoint must be confirmed first) |
| SMS | **Brevo API** | `POST /v3/transactionalSMS/send`, type `marketing`; needs `BREVO_SMS_SENDER` (11 letters/digits or 15 digits; must be registered per country). **Not verified against a live Brevo account** |

`MARKETING_SEND_ALLOWLIST` (comma-separated addresses/numbers) refuses every other destination *before* any request is made — use it for first live sends.

### 7.6 Delivery events (webhooks)
- **Brevo:** `POST /api/v1/marketing/webhooks/brevo/<BREVO_WEBHOOK_TOKEN>`. Brevo doesn't sign callbacks, so the URL token (constant-time compared) is the only control — treat the URL as a secret. Mapped events: delivered, hard bounce, spam (complaint), blocked/invalid (failed), opened, click, unsubscribed; soft bounces/deferrals are ignored. Events have no unique id, so a SHA-256 over stable fields dedupes them. The company comes from the stored delivery, never the payload. SMS status strings should be confirmed against a real payload.
- **Generic:** `POST /api/v1/marketing/webhooks/delivery` with an `x-anops-signature` HMAC (`MARKETING_WEBHOOK_SECRET` ≥32 chars), deduped by event id. Accepted types: delivered, bounced, complained, failed, opened, clicked.

---

## 8. Social management (Facebook Pages)

**Scope today: Facebook Pages only.** Instagram, other networks, media attachments and post analytics are not implemented. Posts are **text-only**.

### 8.1 Connecting a Page (OAuth)
On `/marketing/social` the Accounts section shows integration status and a connect button (needs `social.manage`).

1. `startSocialConnection` generates a random 256-bit `state`, stores only its **SHA-256** (10-minute expiry, bound to company + user) and builds the Facebook dialog URL requesting `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`.
2. Facebook redirects to `GET /api/v1/marketing/social/callback`.
3. The callback consumes the state **atomically** (replay fails), checks the user is the one who started the flow and **still has an active owner/admin/manager membership**, exchanges the code, upgrades to a long-lived token, lists managed Pages and keeps those that can create content.
4. Each Page token is stored **encrypted** (AES-256-GCM, envelope `v1.<iv>.<tag>.<ciphertext>`, key `SOCIAL_TOKEN_ENCRYPTION_KEY` = 32 random bytes as base64 or 64 hex). Tokens never appear in DTOs, logs or error messages.

Account statuses: `connected`, `reauthorization_required` (set automatically if Meta rejects the token with 401/403 or the token can't be decrypted), `disconnected`.

**Disconnect** removes the stored token and, in one transaction, cancels that account's scheduled posts and queued jobs. It does not revoke the grant on Facebook's side (remove the app in Facebook to do that).

Required env: `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `SOCIAL_TOKEN_ENCRYPTION_KEY`, plus a Meta app with OAuth redirect `<NEXTAUTH_URL>/api/v1/marketing/social/callback`. Graph version constant: `v21.0` in `config.ts`. **Not exercised against a live Meta app**; publishing needs Meta app review.

### 8.2 Posts
Fields: connected account, content (1–5,000 chars, enforced on save), status, schedule/publish times, `externalPostId`, `lastErrorCode`.

```
draft ──schedule──► scheduled ──worker──► publishing ──► published
  │                    │  ▲                   ├──► failed ──(reschedule)──► scheduled
  └─► cancelled ◄──────┘  └─(429 retry)───────┤
                                              └──► needs_reconciliation  (terminal for automation)
```

- **Edit/delete:** only drafts are editable; only drafts or cancelled posts can be deleted. Published posts are kept.
- **Schedule** (`social.publish`): works from `draft` or `failed`; needs a connected account and a configured integration; blank time = publish now. Writes status + a `social.publish` job in one transaction. The job key includes the post version (`social.publish:<id>:v<n>`), so rescheduling after a failure never collides with the old job.
- **Cancel:** only `scheduled`; cancels the queued job. If publishing already began it is refused.
- **Publish run (`runSocialPublishJob`):** moves `scheduled → publishing` *before* calling Meta, decrypts the token, posts to `/{pageId}/feed`.
  - Success → `published`, `externalPostId` stored **only** from Meta's confirmed response, audit logged.
  - HTTP 429 → back to `scheduled`, job retried (provider did not process it).
  - Definite rejection (4xx) → `failed`, not retried; 401/403 also flags the account for re-authorisation.
  - Timeout / network / 5xx / unreadable reply → **`needs_reconciliation`** ("Needs review" in the UI), never retried, because Meta offers no idempotency key and a retry could double-post. A person must check the Page.
- The Overview counts "Published posts (provider-confirmed)" — posts that never got a Meta id are not counted.
- The list is chronological with a status filter; there is no month-grid calendar.

---

## 9. AI copywriter

Page `/marketing/ai` (permission `ai.generate`; **nothing is sent or published from here**).

**Brief inputs:** channel (`email`, `sms`, `facebook_page`), tone (friendly, professional, playful, urgent, formal), language (`en`, `fr`, `ar`), goal (≤200, optional), product/service (10–800 chars), target audience (3–300).

**Generation:** calls the shared server-side AI provider layer (`@/server/ai`; any of `GROQ_API_KEYS`, `OPENROUTER_API_KEY`, `GEMINI_API_KEYS`). The brief is placed inside `<brief>` tags in the *user* turn, with any `</brief>` stripped, and the system prompt tells the model to treat it as data, not instructions. The model must return one JSON object `{subject, body}`; the response is strictly validated (email needs a subject; body limits: email 1,500, SMS 480 minus the opt-out line, Facebook 1,500) and **never repaired by guessing**. No contact data is sent. Rate limit: **10 generations per user per hour** (in-process, so per server instance). Failures are saved as `failed` with `AI_UNAVAILABLE` or `AI_INVALID_OUTPUT`. The audit log keeps model metadata only, not the brief or output.

**Draft states:** `generated_draft → edited → approved_for_use`. Editing an approved draft **clears the approval**, so edited text must be approved again.

**Using a draft:** only after approval.
- Email/SMS draft → "apply to campaign": copies subject/body into a **draft** campaign of the same channel (version-checked); audience, recipients and consent are untouched.
- Facebook draft → creates a social post **draft** on a connected Page.
Either way a human still goes through the normal approval/scheduling flow.

---

## 10. Analytics

`/marketing/analytics` lists campaigns with reports; `/marketing/analytics/[id]` shows recipients at approval, rates, delivery breakdown, sends per day (last 30 days, UTC) and the definitions. Every rate states its denominator and shows "No data" when it is zero.

| Metric | Formula |
| --- | --- |
| Accepted | sent + delivered + bounced + complained |
| Delivery rate | delivered ÷ accepted |
| Bounce / complaint rate | bounced (or complained) ÷ accepted |
| Failure rate | failed ÷ eligible recipients at approval |
| Open rate (estimate) | unique opens ÷ delivered — inflated by mail privacy features; shown only if the provider reports opens |
| Click rate | unique clicks ÷ delivered — shown only if clicks are reported |
| Unsubscribes | confirmations attributed to the campaign |

---

## 11. Integrations page

Shows one card per integration with status: **Tested** (successful test within 7 days), **Configured** (no test yet), **Unverified** (last test failed or stale), **Setup needed** (missing settings). "Test connection" for SMTP runs `transporter.verify()` (handshake + login, **no message sent**). Only variable *names* are ever displayed.

Environment variables used by the module: `APP_URL`, `EMAIL_SERVER_HOST/PORT/SECURE/USER/PASSWORD`, `EMAIL_FROM`, `MARKETING_SEND_ALLOWLIST`, `BREVO_API_key`, `BREVO_SENDER_EMAIL/NAME`, `BREVO_SMS_SENDER`, `BREVO_WEBHOOK_TOKEN`, `BREVO_EMAIL_MARKETING_APPROVED`, `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `SOCIAL_TOKEN_ENCRYPTION_KEY`, `MARKETING_WEBHOOK_SECRET`, `MARKETING_WORKER_SECRET`, `AUTH_SECRET`, and one AI key. Setup steps for Gmail/Brevo/Facebook are in MARKETING.md §9.

---

## 12. Data model (MongoDB, all prefixed `marketing_`)

`contacts`, `tags`, `contact_tags`, `consent_events` (append-only), `consent_states`, `suppressions`, `audiences`, `templates`, `campaigns`, `deliveries` (one per recipient, incl. suppressed), `delivery_events`, `jobs`, `social_accounts`, `social_oauth_states` (TTL), `social_posts`, `ai_generations`. Indexes in `src/server/marketing/indexes.ts`. Every document has `companyId`; cross-company ids return `NOT_FOUND`. Important actions write an audit record (e.g. `marketing.campaign.approved`, `marketing.social.published`).

---

## 13. Code map

| Area | Location |
| --- | --- |
| Pages | `src/app/(dashboard)/marketing/**` |
| API routes | `src/app/api/v1/marketing/{worker,webhooks/delivery,webhooks/brevo/[token],social/callback}` |
| Server actions | `src/features/marketing/actions/*.action.ts` (validate with Zod → service → `ActionResult`) |
| Services | `src/server/marketing/*.service.ts`, `dispatch.ts`, `jobs.ts`, `eligibility.ts`, `campaign-snapshot.ts` |
| Providers | `src/server/marketing/providers/{smtp,brevo}/` |
| Social / AI | `src/server/marketing/social/*`, `src/server/marketing/ai/copy.service.ts` |
| Schemas & constants | `src/features/marketing/schemas/marketing.schema.ts`, `types/constants.ts` |
| State machines | `src/features/marketing/utils/{campaign-state,social-state}.ts` |
| UI components | `src/features/marketing/components/*` |
| Worker script / seed | `scripts/marketing-worker.mjs`, `scripts/seed-marketing-demo.ts` |
| Tests | `tests/unit/marketing-domain.test.ts`, `tests/integration/marketing*.test.ts` |
| Diagram | `uml-diagrams/class-diagrams/marketing-campaigns-social-management-diagram.mmd` |

## 14. Trying it locally

```bash
npm run marketing:seed-demo            # realistic [Demo] data: 20 contacts, 5 audiences, 5 templates, 6 campaigns per workspace
npm run marketing:seed-demo -- farmy   # one workspace only
npm run marketing:worker:watch         # process scheduled jobs every minute
```

The seed never schedules anything (no dispatch job exists), uses the reserved `example.test` domain, and refuses to run in production unless `ALLOW_DEMO_SEED=1`. Integration tests need a MongoDB replica set on `127.0.0.1:27018`.

## 15. What is and isn't proven

- **Tested with fakes:** the whole campaign lifecycle, dispatch, retries, consent, webhooks, Facebook OAuth/publishing, AI copy.
- **Verified live:** one Gmail SMTP delivery (2026-10-26).
- **Not verified live:** Brevo SMS/email/webhooks, Meta OAuth/publishing.
- **Not built:** Instagram or other networks, media/link posts, social analytics, CSV import, contact merge, token-key rotation tool, global (multi-instance) rate limiting, month-grid post calendar, automatic scheduler, CRM consumption of the contact contract.

## 16. Things I noticed while documenting (not changed)

- Post length limit is **5,000** (`SOCIAL_CONTENT_LIMITS`) but AI-generated Facebook copy is capped at **1,500**, so AI copy is always within bounds; it's just a different ceiling.
- The OAuth callback re-checks the *company* roles `owner/admin/manager`. These line up with the permission roles owner/admin/operator, because a company `manager` is mapped to `operator` in `permissions.ts`. The callback is a second, independent check rather than a mismatch.
- `.env.example` has uncommitted Telegram variables; they are unrelated to this module.
- `docs/brevo-sms.md` is a copy of Brevo's public API overview, not project-specific documentation.

---

## 17. Telegram channel (third campaign channel)

Telegram sits next to email and SMS and reuses everything above: contacts, per-channel consent, audiences, templates, the approval
workflow, the frozen recipient snapshot, the `marketing_jobs` worker, deliveries and reports. The full reference, setup steps and
troubleshooting table are in [MARKETING.md section 14](./MARKETING.md#14-telegram-channel). In short:

- **Connecting a contact.** On a contact page, **Connect Telegram** creates a personal single-use link (valid 15 minutes). The customer
  presses Start in the AnOps bot, Telegram calls the webhook with the token, and the chat is attached to exactly that contact. The page
  updates itself. Regenerate replaces the old link; Disconnect removes the chat.
- **Consent is separate.** Pressing Start proves the chat; it does not agree to marketing. A team member records Telegram consent
  afterwards (only possible once a chat is linked). Email or SMS consent never counts for Telegram.
- **Opting out.** Every message ends with "Send /stop to stop receiving marketing messages." `/stop` withdraws consent and suppresses the
  chat for every company that linked it, because one shared bot cannot tell companies apart. A later explicit consent grant lifts it.
- **Messages.** Plain text only, variables `{{first_name}}`, `{{last_name}}`, `{{company_name}}`, up to 4,096 characters including the
  opt-out line. The campaign and template editors show a chat-style preview with the exact text and character count. Nothing is
  truncated or interpreted as markup.
- **Sending.** The same worker sends it at about 20 messages per second. Rate limits wait for Telegram's `retry_after`; a blocked bot marks
  the contact Unreachable; an unclear result is never retried.
- **Reporting.** `sent` = Telegram accepted it. Delivery, bounce, complaint, open and click rates are shown as "Not reported by Telegram",
  not as 0 %. Opt-outs are counted.
- **Where to see it.** Contact page (Telegram section and a third consent card), Campaigns / Templates / AI copy channel selectors,
  Audiences (Telegram consent condition), Analytics, Overview (Channels summary) and Integrations (Telegram bot card with Test connection
  and Register webhook).
- **Status.** Tested against a mocked Telegram API only. It has not been run against a live bot (see MARKETING.md §14.9).
