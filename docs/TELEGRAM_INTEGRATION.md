# TASK: COMPLETE TELEGRAM BOT API INTEGRATION — ANOPS MARKETING & SOCIAL MANAGEMENT (NESRINE)

## OBJECTIVE

Implement a complete, production-ready Telegram Bot API integration into AnOps, specifically within Nesrine's existing Marketing & Social Management module.

Telegram must become a fully supported third messaging channel alongside the existing Email and SMS channels.

The objective is to allow AnOps companies to connect their customers to the official AnOps Telegram bot, manage Telegram subscriptions, create Telegram marketing campaigns, send automated notifications, schedule messages, track campaign execution and manage everything through the existing Marketing dashboard.

**IMPORTANT: Telegram is an alternative messaging channel, NOT a replacement for traditional SMS.**

- Email continues using the existing SMTP provider (and existing Brevo fallback where configured).
- SMS continues using the existing Brevo SMS provider.
- Telegram uses the official Telegram Bot API.
- All three channels must coexist independently.

The integration must be genuinely functional, not a UI-only implementation or a simulated connection.

---

## 1. FIRST: AUDIT THE EXISTING IMPLEMENTATION

Before modifying anything, carefully inspect:

- `MARKETING_GUIDE.md`
- `MARKETING.md`
- `AnOps.md`
- Existing Marketing module implementation.
- Existing provider adapters.
- Campaign and delivery schemas.
- Contact and consent services.
- Audience eligibility and recipient snapshot logic.
- Background worker and dispatch system.
- Webhook implementations.
- Integrations dashboard.
- Marketing permissions and audit logging.
- Existing tests.

Use the current repository implementation as the source of truth.

The project documentation describes the existing architecture as:

- Pages: `src/app/(dashboard)/marketing/**`
- API routes: `src/app/api/v1/marketing/**`
- Actions: `src/features/marketing/actions/*.action.ts`
- Services: `src/server/marketing/*.service.ts`
- Providers: `src/server/marketing/providers/**`
- Schemas: `src/features/marketing/schemas/marketing.schema.ts`
- AI: `src/server/marketing/ai/**`
- Workers: existing marketing worker and job dispatch infrastructure.
- Tests: `tests/unit/**` and `tests/integration/**`.

Do not blindly create parallel services or duplicate existing functionality.

Follow the established project conventions, Zod validation, ActionResult patterns, MongoDB access patterns, tenant security and error handling.

The existing guide mentions Telegram variables in `.env.example` that are unrelated to the current Marketing implementation. Investigate them before adding anything. Reuse only settings that are genuinely compatible.

## 2. TELEGRAM BOT CONFIGURATION

Integrate the official Telegram Bot API using one centrally managed AnOps bot.

Bot identity:
- Display name: AnOps Notifications
- Username: The actual username created through BotFather.
- Description:

"Welcome to AnOps Notifications!

Stay connected with your business through automated updates, important announcements, marketing campaigns, and real-time notifications.

Receive relevant messages, customer updates, and business alerts directly from AnOps.

Connect your account to get started. Your information and notification preferences are respected."

Use the official API:
`https://api.telegram.org/bot<TOKEN>/`

Required environment variables:

```env
TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_USERNAME=
TELEGRAM_WEBHOOK_SECRET=
```

Add appropriate entries to `.env.example` without exposing real credentials.

Requirements:
- Never expose the bot token to the frontend.
- Never use NEXT_PUBLIC_ for Telegram secrets.
- Never return tokens in API responses, logs, DTOs or error messages.
- Never hardcode credentials.
- Validate configuration server-side.
- Provide clear integration statuses when configuration is missing, invalid or unavailable.

The Telegram bot must be centrally managed and shared across tenants, while all company-specific contacts, subscriptions, campaigns and deliveries remain isolated.

## 3. TELEGRAM CONTACT CONNECTION SYSTEM

Implement a real customer connection flow using Telegram deep links.

Example:

`https://t.me/AnOpsNotificationsBot?start=<TEMPORARY_TOKEN>`

Replace the example username with the configured bot username.

### Connection workflow

1. An authorized company user opens Marketing → Contacts.
2. They select a contact and choose Connect Telegram.
3. AnOps generates a cryptographically secure, temporary, single-use connection token.
4. AnOps creates a Telegram deep link.
5. The customer opens the link and presses Start.
6. Telegram sends `/start <TOKEN>` to the configured webhook.
7. The backend validates and consumes the token.
8. The backend securely associates the Telegram chat ID with the correct company and contact.
9. The contact becomes Telegram-connected.
10. The UI updates to show the connection status.

Implement:
- Token hashing before storage.
- Short token expiration.
- Atomic single-use token consumption.
- Company/contact association validation.
- Protection against replay attacks.
- Protection against linking one Telegram account to unrelated contacts without explicit authorization.
- Duplicate subscription prevention.
- Expired and invalid token handling.
- Reconnection and disconnection workflows.

Never accept arbitrary chat IDs from browser requests as proof of ownership.

### Contact integration

Extend the existing contact details page with:

- Telegram connection status.
- Telegram username, when available.
- Connection date.
- Connect Telegram action.
- Regenerate connection link action.
- Disconnect action.
- Telegram marketing consent status.
- Telegram subscription history.

Do not create an unrelated second contact-management system.

## 4. TELEGRAM WEBHOOK

Implement a production-ready webhook using the project's established API routing conventions.

Suggested endpoint:

`POST /api/v1/marketing/webhooks/telegram`

Requirements:

- Validate `X-Telegram-Bot-Api-Secret-Token` using constant-time comparison.
- Reject invalid requests.
- Validate incoming update structures.
- Handle `/start` and connection tokens.
- Handle `/stop` and unsubscribe requests.
- Handle Telegram blocking and bot interaction errors where detectable.
- Prevent duplicate update processing.
- Avoid processing the same update twice.
- Never trust company IDs supplied by Telegram payloads.
- Resolve company ownership through the stored connection token or subscription.
- Return appropriate HTTP responses.
- Log meaningful events without logging sensitive credentials or raw personal data.

Only process the update types required by the Marketing integration.

Register the webhook through Telegram's `setWebhook` API using the configured HTTPS endpoint and secret token.

Provide a documented setup procedure and a server-side webhook configuration/test action.

For local development, support the existing development workflow using Telegram polling if appropriate. Do not run polling and webhook simultaneously.

## 5. EXTEND THE EXISTING CAMPAIGN ENGINE

This is the most important implementation requirement.

Extend the existing campaign channel model:

Current:
- email
- sms

New:
- email
- sms
- telegram

Telegram must participate in the SAME campaign architecture.

Implement all required changes consistently across:

- Zod schemas.
- TypeScript types.
- Campaign CRUD.
- Campaign validation.
- Templates.
- Campaign details.
- Approval workflow.
- Recipient snapshot.
- Delivery records.
- Dispatch jobs.
- Background worker.
- Provider selection.
- Campaign state transitions.
- Analytics.
- Audit logs.
- UI filters and selectors.

Do not implement a second independent Telegram campaign engine.

### Telegram campaign creation

Users must be able to:

1. Create a campaign.
2. Choose Telegram as the channel.
3. Select an existing audience.
4. Choose a Telegram template or write custom content.
5. Preview the final message.
6. Save a draft.
7. Submit for approval.
8. Get approval from an authorized user.
9. Schedule the campaign or send immediately.
10. Track execution and results.

Reuse the existing separation-of-duties rules.

The creator/submitting user must not approve their own campaign unless the existing documented dispatch permission exception applies. Preserve its audit behavior.

### Telegram message validation

Implement Telegram-specific validation based on the official Bot API.

Support safe plain-text messages and explicitly supported formatting such as HTML or MarkdownV2 if implemented correctly.

Escape user-provided content appropriately. Never introduce arbitrary HTML injection.

Respect Telegram's message length and formatting limitations.

Do not silently truncate messages.

Provide clear validation errors in the UI.

## 6. TELEGRAM CONSENT AND ELIGIBILITY

Extend the existing consent architecture.

Current consent channels:
- email
- sms

New:
- telegram

Add Telegram to the existing per-channel consent system.

CRITICAL:

- Email consent does not authorize SMS.
- SMS consent does not authorize Telegram.
- Telegram consent must be explicitly granted.
- Starting a bot connection alone must not silently grant marketing consent.
- Transactional notifications and marketing campaigns must have clearly distinguished purposes and authorization rules.
- Withdrawal must immediately prevent future marketing sends.
- Unsubscribed users must never receive new marketing messages.

Extend the existing eligibility service instead of duplicating its logic.

The eligibility rules must continue to verify:

1. Contact is active.
2. Contact is not in the inactive lifecycle stage.
3. A valid destination exists.
4. Channel-specific consent is granted.
5. Destination is not suppressed.
6. Telegram subscription is active and usable.

Eligibility must be checked:
- When approving a campaign.
- When creating the frozen recipient snapshot.
- Immediately before each individual send.

An unsubscribe or consent withdrawal after campaign approval must still prevent delivery.

Extend suppression and unsubscribe handling to Telegram without breaking email or SMS.

## 7. TELEGRAM PROVIDER ADAPTER

Implement a dedicated provider following the current provider architecture.

Suggested location:

`src/server/marketing/providers/telegram/`

Responsibilities:

- Send messages.
- Validate bot configuration.
- Test connection using `getMe`.
- Return normalized provider results.
- Capture Telegram message IDs.
- Classify errors.
- Handle rate limits.
- Handle blocked bots and invalid chat IDs.
- Support safe retry decisions.

Use:

`POST /sendMessage`

The provider must return a normalized result compatible with the existing delivery engine.

A successful Telegram API response means the message was accepted by Telegram, NOT necessarily delivered to or read by the user.

Do not report a read receipt or confirmed delivery when Telegram does not provide one.

### Error handling

Handle:
- Invalid bot token.
- Invalid chat ID.
- User blocked bot.
- Bot unavailable.
- Telegram HTTP 429.
- Retry-after instructions.
- Network timeouts.
- Invalid message formatting.
- Unreadable provider responses.
- Temporary provider failures.

Preserve the existing duplicate-send safety policy.

Never blindly retry ambiguous sends because that could send duplicate marketing messages.

Respect Telegram's documented standard broadcast limits and implement suitable pacing and throttling in the existing worker.

Do not introduce uncontrolled parallel sending.

## 8. BACKGROUND WORKER INTEGRATION

Telegram campaigns must use the existing `marketing_jobs` infrastructure.

Reuse:
- Job claiming.
- Leases.
- Job idempotency.
- Delivery claiming.
- Retry policy.
- Exponential backoff and jitter.
- Execution logs.
- Campaign completion.
- Failure handling.

Do not create an independent Telegram cron service.

The existing worker should recognize Telegram campaigns and dispatch them through the Telegram provider.

Maintain the existing behavior:
- A campaign can have a large recipient snapshot.
- Each worker execution processes a bounded batch.
- Campaigns are requeued until all eligible deliveries are processed.
- Duplicate concurrent workers must not send the same delivery twice.

Add Telegram-specific pacing and provider error handling.

## 9. DELIVERY TRACKING AND ANALYTICS

Integrate Telegram deliveries into the existing delivery history and campaign analytics.

Store:
- Company ID.
- Campaign ID.
- Contact ID.
- Channel.
- Telegram chat destination, appropriately protected/masked.
- Provider message ID.
- Delivery status.
- Attempt count.
- Timestamps.
- Error code when applicable.

Use existing delivery statuses wherever possible.

Important metric distinction:

`sent` = Telegram accepted the message and returned a valid message ID.

Do not invent:
- Telegram open rates.
- Telegram read rates.
- Confirmed delivery rates without actual delivery evidence.
- Click analytics without implementing a real, privacy-conscious tracking mechanism.

Show Telegram-specific metrics such as:
- Eligible recipients.
- Suppressed recipients.
- Accepted by Telegram.
- Failed.
- Pending.
- Unsubscribed.

Update campaign analytics to distinguish unsupported metrics from zero values.

Do not show misleading empty percentages.

## 10. MARKETING INTEGRATIONS DASHBOARD

Extend:

`/marketing/integrations`

Add a dedicated Telegram integration card.

Display:
- Telegram bot name.
- Telegram bot username.
- Configuration status.
- Webhook status, when verifiable.
- Last successful connection test.
- Last error, sanitized.
- Test connection button.
- Configure webhook action or documented setup instructions.

Support the existing integration states:
- Tested.
- Configured.
- Unverified.
- Setup needed.

### Test connection

Use the actual Telegram `getMe` API.

The test must:
- Verify the configured token.
- Confirm that the expected bot exists.
- Return a clear success/failure result.
- Never expose the token.

A connection test must not send an unsolicited message to a customer.

Optionally provide a separate Send Test Message action that requires an explicitly connected administrator destination and user confirmation.

## 11. MARKETING UI INTEGRATION

Keep the existing AnOps visual identity.

Do not redesign the entire Marketing module.

Extend existing pages consistently.

### Overview

Add Telegram campaign statistics and channel-specific summaries.

### Contacts

Add Telegram connection and consent information.

### Campaigns

Add Telegram to the channel selector, filters, campaign creation, details and preview.

### Templates

Support Telegram-specific reusable message templates and validation.

### Audiences

Allow Telegram consent and eligibility conditions using the existing typed audience-rule architecture.

### Analytics

Include Telegram campaigns and accurate channel-specific statistics.

### Integrations

Add Telegram bot configuration and testing.

### AI Copywriter

Extend the existing AI copywriting assistant to support Telegram.

Add `telegram` to the supported channel options.

The generated content must:
- Respect Telegram message limits.
- Support the existing English, French and Arabic language choices.
- Respect the selected tone and audience.
- Return validated structured output.
- Remain a draft until explicitly approved.
- Never send automatically.
- Be applicable to a Telegram campaign draft through the existing approval workflow.

Do not send customer personal information to the AI provider.

## 12. AUTOMATED BUSINESS NOTIFICATIONS

In addition to marketing campaigns, provide a reusable server-side Telegram notification service for future AnOps modules.

Suggested interface:

`sendTelegramNotification(companyId, contactId, message, options)`

Adapt the signature to existing AnOps conventions.

The service must:
- Resolve the Telegram destination through the stored company/contact subscription.
- Enforce tenant isolation.
- Respect channel preferences and the appropriate purpose authorization.
- Validate message content.
- Record the notification result.
- Prevent arbitrary cross-tenant sending.

Make the service reusable by other modules, but do not modify unrelated modules as part of this task.

Do not introduce a new business-event automation engine if one does not already exist.

## 13. SECURITY REQUIREMENTS

This integration must preserve AnOps multi-tenancy and production security.

Mandatory:

- Strict companyId isolation.
- Server-side permission checks.
- Zod validation for all external inputs.
- Cryptographically secure connection tokens.
- Hashed temporary tokens.
- Single-use and expiring tokens.
- Webhook secret verification.
- No token leakage in browser bundles.
- No secrets in logs.
- No arbitrary chat ID sending.
- No unauthorized cross-company contact access.
- Rate limiting for sensitive actions.
- Audit logging for connection, disconnection, consent changes, campaign approval, dispatch and failures.
- Safe handling of Telegram HTML/Markdown formatting.
- No weakening of existing campaign approval and eligibility checks.

Reuse existing permission names and role mappings wherever possible.

## 14. TESTING REQUIREMENTS

Create comprehensive automated tests.

### Unit tests

Test:
- Telegram provider.
- `getMe` connection test.
- Successful message sending.
- Invalid token.
- Invalid chat ID.
- Blocked bot.
- HTTP 429 and retry-after.
- Formatting validation.
- Connection-token generation.
- Token expiration.
- Single-use token consumption.
- Telegram consent.
- Eligibility and suppression.
- Telegram-specific campaign validation.
- Analytics calculations.

### Integration tests

Test:
- Complete Telegram connection flow.
- Webhook authentication.
- Invalid webhook secret rejection.
- Duplicate webhook update handling.
- Multi-tenant subscription isolation.
- Contact connection and disconnection.
- Campaign creation.
- Campaign submission.
- Campaign approval.
- Recipient snapshot creation.
- Scheduling.
- Worker dispatch.
- Delivery recording.
- Unsubscribe after approval.
- Provider failure and retry behavior.
- No duplicate sends.
- Integration dashboard connection status.

Mock Telegram API requests in automated tests.

Never depend on a real Telegram account or live bot token for the test suite.

Preserve every existing Marketing test.

## 15. DOCUMENTATION

Update the existing:

- `MARKETING_GUIDE.md`
- `MARKETING.md`
- `.env.example`

Document:
- BotFather creation.
- Bot token configuration.
- Bot description and username configuration.
- Webhook registration.
- Local development setup.
- Contact connection workflow.
- Telegram consent.
- Telegram campaign creation.
- Worker integration.
- Delivery status semantics.
- Analytics limitations.
- Troubleshooting.
- Security considerations.

Do not claim the integration is live-verified unless an actual live connection test has been performed.

## 16. ACCEPTANCE CRITERIA

The task is complete ONLY when all of the following are true:

[ ] Existing Email campaigns still work.

[ ] Existing Brevo SMS campaigns still work.

[ ] Telegram is a genuine third campaign channel.

[ ] The official bot token is configured securely.

[ ] The bot connection can be tested through the real Telegram API.

[ ] Webhook registration and authentication work.

[ ] Contacts can connect to Telegram through deep links.

[ ] Telegram subscriptions are securely associated with the correct tenant/contact.

[ ] Telegram consent is independent of email and SMS consent.

[ ] Contacts can unsubscribe and disconnect.

[ ] Telegram templates work.

[ ] Telegram audiences and eligibility work.

[ ] Campaign creation, approval and scheduling work.

[ ] The existing background worker sends Telegram campaigns.

[ ] Provider errors and retries are handled safely.

[ ] Delivery records and analytics are accurate.

[ ] The AI copywriter supports Telegram.

[ ] The Integrations dashboard displays Telegram status.

[ ] No cross-tenant access is possible.

[ ] All existing tests remain passing.

[ ] New unit and integration tests pass.

[ ] Production build succeeds.

[ ] Documentation is updated.

---

## 17. FINAL EXECUTION INSTRUCTIONS

Work directly in the existing repository.

Do not stop after writing an implementation plan.

Do not return only code snippets or instructions.

Actually implement the integration, run the tests, fix regressions, and verify the production build.

Do not replace existing functionality with mock data.

Do not introduce unnecessary dependencies.

Do not refactor unrelated modules.

Do not weaken existing security or multi-tenant rules to make integration easier.

If a required external credential is unavailable, implement the complete integration and clearly identify the exact manual configuration or live verification still required. Never fabricate a successful connection.

At completion, provide a concise engineering report containing:

1. What was implemented.
2. Files created and modified.
3. Database/schema changes.
4. Environment variables required.
5. BotFather and webhook setup instructions.
6. How to connect a contact.
7. How to create and send a Telegram campaign.
8. Tests executed and their actual results.
9. Build result.
10. Any remaining manual deployment or credential requirements.

**FINAL PRIORITY: Nesrine must be able to use Telegram directly inside her existing AnOps Marketing & Social Management module, with the same professional workflow and security standards as Email and SMS. It must be a real, fully integrated feature, not a separate demo or prototype.**