# AnOps HR AI Copilot: Roadmap (Brief #3)

> Source brief: `mohamed-abidi-hr-ai-copilot-tasks.md`. Earlier work: `mohamed-abidi-hr-roadmap.md`.
> To continue: read this file, take the first unchecked item, tick it when it is verified.

## Decisions and assumptions

Brief §11 defaults were accepted as written. Deviations from the brief:

| Topic | Brief | Implemented | Why |
| :--- | :--- | :--- | :--- |
| Confirm / cancel | `POST /ai/actions/{id}/confirm` | Server actions (`confirmAiActionAction`, `cancelAiActionAction`) | Repo convention. Same guarantees, plus Next's built-in origin check. |
| Advisor loading | not specified | Route handler `/api/v1/hr/leave-requests/[id]/advisor` | Next runs server actions one at a time, so a slow analysis would block Approve clicks. |
| Tables / migrations | SQL-style tables | MongoDB collections, indexes in `src/server/db/indexes.ts` | Project database. |
| Blocked requests | LLM phrases the explanation | Rule template only, no LLM call | Always correct and costs no tokens. |
| Advisor card | LLM on every pending request | Rules card by default, AI via "Ask AI" | One LLM call per card on every page load used up free-tier limits. |
| Direct questions | Agent calls tools through the LLM | Answered from the tool with no LLM call | A simple question cost about 4,000 tokens, and Groq's free tier allows about 8,000 a minute. |
| Extra read tools | not listed | `search_hr_policies`, `get_my_payroll_preview` | Needed for truthful sources and to keep brief #2's personalised salary answers. |
| Admin role | "admin" | `hr_admin` only. Managers get employee tools. | Least privilege. Widen later if needed. |
| Eval data | seeded demo DB | Throwaway eval companies in the same DB, removed afterwards | Stable numbers, and the demo data stays clean. |

## Progress

### Phase A: Read and plan
- [x] Read assistant, leave service, ledger, auth scoping and provider code

### Phase B: Foundations
- [x] Feature A: tool calling in all 3 providers (`src/server/ai/providers`, `openai-wire.ts`)
- [x] Feature A: `ai.chat()` task routing, env overrides, fallback (`src/server/ai/routing.ts`)
- [x] Feature B: tool registry with role scoping (`src/features/hr/ai/tool-registry.ts`)
- [x] Feature D: collections, indexes, append-only audit service (`src/server/services/hr-ai.service.ts`)

### Phase C: Copilot actions
- [x] Employee and admin tools (`src/features/hr/ai/hr-tools.ts`)
- [x] Copilot loop, guardrails, sources (`hr-copilot.ts`, `guardrails.ts`, `policy-search.ts`)
- [x] Feature C: confirm/cancel with re-validation and idempotency
- [x] Confirmation card UI, chat wiring, suggested prompts
- [x] Feature D: admin "AI Activity" page

### Phase D: Approval Advisor
- [x] Feature E: `gatherRequestFacts`, hard rules, LLM JSON, cache, template fallback
- [x] Feature E: advisor card in pending approvals and the review dialog

### Phase E: Polish and proof
- [x] Feature F: language handling, sources line
- [x] Feature G: eval script and cases (`npm run hr:ai-eval`)
- [x] Unit and integration tests
- [x] Seed tweaks, README section, demo script, docs

### Phase F: Token optimization (added after the first live use)
- [x] No-LLM answers, policy answer cache, policy text fallback (`fast-answers.ts`, `hr-copilot.ts`)
- [x] Context compression: prompt, tools, schemas, tool results, history (`context-compression.ts`)
- [x] Fewer rounds, smaller output reservation, `economy` flag, no retry on rate limits
- [x] End dates computed in code from `workingDays` (a model produced 5 days for "3 days")

### Stretch (not started, only if time remains)
- [ ] Anomaly detector
- [ ] Admin write tools via chat (`commit_payroll`, approve/reject)
- [ ] Embeddings RAG over uploaded policy PDFs

## Verification log

Run on 2026-11-06 against local MongoDB (`anops`, standalone) and the configured free-tier providers.

| Check | Result |
| :--- | :--- |
| `npm run typecheck` | Pass |
| `npm run build` | Pass |
| `eslint` on all new and changed AI/HR files | 0 errors, 0 warnings (repo-wide `npm run lint`: 126 errors, 79 warnings, in other files) |
| New tests: `ai-routing`, `hr-ai-rules`, `hr-copilot` (real MongoDB, scripted model) | All pass |
| Full `vitest run` with `MONGODB_TEST_URI=mongodb://127.0.0.1:27017` | 572/574. The 2 failures are in `marketing-routes.test.ts`, and fail the same on a clean `HEAD`. |
| `npm run hr:ai-eval`, live | See below |
| Browser, as employee | Booking card, Confirm, French answer and injection refusal work. 403 on the advisor API, redirected away from AI Activity. |
| Browser, as admin | Advisor cards match the Solde, AI Activity table and filters work. |

**Eval, last full run (after token optimization):** 36/36 scored cases passed, 1 skipped, 0 critical failures, 15,656 tokens for the whole suite, no rate limit retries. The skip is `resilience-fallback`: with Groq disabled, Gemini and OpenRouter had no quota left that day, so fallback to another provider was not exercised live in this run. It passed live in the first run of the day, and is covered by unit tests.

**Not verified live:** Gemini's no-thinking setting (`economy`), because Gemini was rate limited all through this work. If Gemini rejects it, routing falls back to the next provider.

## Next steps

- [ ] Run `npm run hr:seed-demo` to get the new advisor demo scenarios. It rewrites the demo employees' HR data.
- [ ] Add more keys to `GROQ_API_KEYS` (there is 1 now). Each key adds about 8,000 tokens a minute.
- [ ] Run `npm run hr:ai-eval` with fresh quota and keep the table for the presentation.
- [ ] Review the changes and commit. Nothing is committed yet.

## Found along the way (not part of this brief)

- Fixed: `cancelLeaveRequestAction` had no ownership check, so any logged-in user in a company could cancel anyone's leave request by id. Now only the owner or an HR admin of the same company can (`tests/integration/hr-leave-cancel.test.ts`).
- `npm run marketing:seed-demo` uses `vite-node`, which is not installed.
