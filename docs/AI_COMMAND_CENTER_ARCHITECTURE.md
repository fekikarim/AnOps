# AnOps AI Command Center: architecture

This document describes what is implemented. Anything not listed here does not exist.

## 1. What it is

A company-scoped assistant at `/ai` that reads and, after a person confirms, changes data in seven modules: Inventory, Purchasing, Manufacturing, Finance, HR, Marketing and Community. It never touches the database directly for business operations. Every read and write goes through the module's own service, which asserts its own permission.

CRM, Sales, Projects and Documents have no backend and no AI tools. Company member and role management is not available to AI.

## 2. Request paths

| Path | Entry | Uses a model? |
|---|---|---|
| Typed slash command (`/posts`, `/newinvoice` ...) | `POST /api/v1/ai/chat` -> `orchestrator.runTurn` -> `command-runner.executeCommand` | No |
| Click in a guided flow (picker row, form, card button) | server action `runAiCommandAction` -> `command-runner.runCommandStep` | No |
| AI-assisted draft ("describe it to AI") | command step `draft` -> `draft/draft-engine.runDraft` | Yes, once per draft |
| Natural-language chat | `orchestrator.runTurn` tool loop | Yes |
| Confirming or cancelling a proposal | server actions `confirmAiActionAction` / `cancelAiActionAction` -> `pending-actions.service` | No |
| Legacy AI features (HR assistant, Community summary / bot / reply suggestions, receipt OCR, replenishment rationale, Marketing copy) | their own actions or services -> `ai/gate.gatedComplete` | Yes, through the gate |

The slash-command path is deterministic: `commands.parse(text)` runs before any model code, and a typed command never calls a provider.

## 3. Components (all under `src/server/ai` unless noted)

- `orchestrator.ts`: one chat turn as an event stream. Bounded tool loop (4 tool steps, at most 8 provider calls per turn), 20 s tool timeout, cancellation through the request's abort signal, shared rate limits, measured usage settlement. A failing tool becomes an error message to the model and the turn continues.
- `command-runner.ts` and `commands/*`: slash commands. 135 module commands plus `/help` and `/access`. Each declares its module, operation and exact permission.
- `tools/*`: 144 registered tools (reads and writes). `tools/registry.ts` rejects, at startup, tool names that are malformed or duplicated, inputs that contain identity fields (`companyId`, `userId`, `role`, `permission` ...), writes without a server-built summary, and destructive or financial writes without a typed confirmation phrase.
- `draft/*`: AI-assisted forms. The model fills a form; values are matched to real records by the server; ids and critical values (money, quantities) are never taken from the model's word alone.
- `pending-actions.service.ts`: proposals and confirmation (section 6).
- `access/*`: company settings, per-member grants and the role ceiling (section 5).
- `usage.service.ts`: atomic token reservation and settlement, measured per provider and model.
- `gate.ts`: the single door to a model for every feature that is not the orchestrator or the draft engine (section 7).
- `platform.ts`: the global kill switch, the optional price, the per-turn call cap.
- `providers/*`, `index.ts`: Groq, then OpenRouter, then Gemini. All have a 20 s timeout and honour the caller's abort signal. Keys rotate on rate limits (per process).
- `conversation.service.ts`: per-member history with a TTL.
- `transcript-audit.service.ts`: the one deliberate exception to conversation privacy (section 5 of the security document).
- `data/scope.ts`: the only door to AI collections. Every query is AND-ed with the company and, for private collections, the owning user. A test enforces that no other file opens an AI collection.
- `health.ts` and `GET /api/v1/ai/health`: yes/no operational facts for owners and administrators.

Front end (`src/features/ai`): `ai-workspace.tsx` (thread, history, states), `composer.tsx` (command palette), `message-parts.tsx` and `result-parts.tsx` (renderers for text, tool status, record tables and cards, forms, confirmation cards, access summary, errors), `conversation-rail.tsx`, `access-admin.tsx` and `member-editor.tsx` (the `/ai/access` page).

## 4. Tool and module catalogue

| Module | Reads | Writes | Notes |
|---|---|---|---|
| core | 1 | 0 | `show_my_access` |
| Inventory | 6 | 13 | stock adjustments are financial-risk, product deletion destructive |
| Purchasing | 7 | 11 | order approval financial, cancellation destructive |
| Manufacturing | 5 | 8 | completion financial, cancellation and BOM archive destructive |
| Finance | 10 | 10 | posting, payments, allocation financial; voiding destructive |
| HR | 14 | 10 | payroll tools need the sensitive-HR switch; writes are owner/admin only |
| Marketing | 14 | 16 | no send-now, no consent changes, contacts masked; sending is owner/admin only, typed, and needs an allowlist outside production |
| Community | 9 | 10 | AI edits drafts only; publishing, archiving and pinning are owner/admin only |

Deliberately absent: deleting Community content, posting as the support bot, demo data, Marketing consent and contact deletion, Telegram linking, social publishing, Company roles and members.

## 5. Data model (MongoDB)

AI collections: `ai_settings` (one per company), `ai_access_grants` (per member), `ai_conversations`, `ai_pending_actions`, `ai_usage` (per member and per company per UTC day), `ai_usage_models` (measured tokens per provider and model per company per day), `ai_notices`. Shared: `rate_limits` (windows, TTL), `audit_events`.

Every tenant-owned document carries `companyId`. There is no other tenancy level.

## 6. Pending-action lifecycle

`proposed` -> (`executing` -> `executed` | `failed`) or `cancelled` or `expired`.

1. **Propose.** A write tool's `prepare()` runs with the member's live role and builds the summary, the diff rows and, for destructive or financial tools, the phrase to type. The summary is built on the server; model text is never shown as a summary. Raw arguments are stored with a SHA-256 hash of (arguments + prepared context). A member may hold 10 open proposals; the cap is checked after inserting, so simultaneous proposals cannot both pass.
2. **Confirm.** Looked up in the caller's own scope (another member gets "not found"). The typed phrase is checked first (a typo does not burn the proposal). Then one conditional update claims it (`pending` -> `executing`): only one confirmation can win. Access is re-resolved after the claim; the hash is re-verified; the arguments are re-validated; the tool runs with the live role, and the tool's own `run()` re-checks versions and state. A timeout (30 s) leaves it `executing`: the outcome is unknown and it is never retried automatically (audit action `ai.action.unknown_outcome`).
3. **End states.** A proposal is cancelled when: the person cancels it; its conversation is deleted (same transaction); the member's AI access is reduced or removed; AI is switched off for the company; or the member's access is found revoked at confirmation. It expires after 10 minutes. Rows are removed 24 hours after expiry.

## 7. The gate

`gatedComplete(ctx, {module, operation, feature, sensitiveHr?}, options)` requires, in order: the platform kill switch off, the company switch on, an active member, the member's own AI grant for that module and operation, the sensitive-HR switch where salary data is involved, a configured provider, the shared per-user and per-company rate limits, and a reservation against the member's and the company's daily token budget. Measured usage (provider, model, tokens) is settled whatever the outcome. A unit test fails if any file other than the router, the gate, the structured-completion helper, the orchestrator and the draft engine calls `ai.complete` or `ai.ask`.

Feature to grant mapping: HR assistant: HR view; Community bot: Community view; Community summary and reply suggestions: Community create; receipt OCR: Finance create; replenishment rationale: Purchasing create; Marketing copy: Marketing create.

## 8. Rate limits and budgets

| Limit | Value | Scope |
|---|---|---|
| Chat turns | 20 / minute | per person; company: 200 / minute |
| Slash command steps | 90 / minute | per person |
| AI drafts | 20 / minute | per person |
| Model calls through the gate | 30 / minute | per person; company: 300 / minute |
| Confirm actions | 30 / minute | per person |
| Provider calls in one chat turn | 8 | per turn |
| Tool steps in one chat turn | 4 | per turn |
| Daily tokens | per-person cap (grant or company default) and company budget | atomic in MongoDB, UTC day |

Rate-limit windows are one MongoDB document per (key, window) with an atomic increment and a TTL, so the limits hold across server instances. Token reservations use one atomic conditional update, so parallel requests cannot pass a cap that only has room for one. The estimate taken at the start of a turn is replaced by the provider's measured total when the turn ends.

## 9. Cost

Only measured provider token counts are stored. If `AI_PRICE_PER_1K_TOKENS` is set, the usage view also shows an estimated cost, labelled as an estimate. Without a price no cost is shown. `AI_COMPANY_DAILY_COST_LIMIT` (needs a price) is enforced as the equivalent token count.

## 10. Known limitations

- Two simultaneous turns in one conversation both proceed (limits and budgets still hold; message order may interleave).
- A tool that is already running is not interrupted when the stream closes; only later steps and provider calls are.
- A cancelled provider call may still have been billed by the provider.
- Provider key cool-downs are per process.
- The unauthenticated unsubscribe form keeps a per-process limiter.
- History keeps tool-result cards for every module except HR payroll and payslip data (replaced by a neutral line). HR forms that echo salary values for AI-assisted employee edits are not covered by that rule.
