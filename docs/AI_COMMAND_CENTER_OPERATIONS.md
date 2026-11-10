# AnOps AI Command Center: operations

## 1. Stop everything

Set `AI_KILL_SWITCH=true` and restart or redeploy the app. The next request of every company is refused ("AI is temporarily switched off for the whole platform"); typed commands, clicks, drafts, confirmations and the legacy AI features all stop. Open proposals that are confirmed while the switch is on are cancelled (access is treated as revoked). Unset the variable to resume. To stop one company, an owner turns AI off at `/ai/access`: that also cancels all of that company's open proposals.

## 2. Health

`GET /api/v1/ai/health` (owner/admin): kill switch, providers configured (yes/no), price configured, transactions supported, and a list of problems.

## 3. Usage and cost

`/ai/access` shows today's tokens against the company budget, tokens per provider and model for 7 days, tokens per person, and, only when a price is configured, an estimated cost. Token counts are what the provider reported; cost is an estimate.

## 4. Recurring situations

| Symptom | Cause | Action |
|---|---|---|
| "You have reached your daily AI limit" | per-person cap | raise the person's cap or wait for 00:00 UTC |
| "Your company has reached its daily AI limit" | company budget or cost cap | raise `dailyTokenBudget` (or the cost limit) |
| "The AI service is busy" | provider rate limit | keys rotate and a fallback provider is tried; add keys |
| "AI is not configured on this server" | no provider key | set a provider key; commands keep working |
| A confirmation says it is "taking longer than expected" | the action timed out after 30 s; outcome unknown | open the record in its module and check; it is never retried automatically; the row is removed within 24 h |
| "Your AI access changed" at confirmation | grant reduced or AI switched off | the proposal was cancelled; ask again |
| Transactions unavailable | standalone MongoDB | use a replica set |

## 5. Recovering a proposal

Proposals are not meant to be recovered: they expire in 10 minutes and the person asks again. A proposal cannot be re-run, edited or confirmed by another member. If a business record changed in the meantime the tool refuses with "changed since you reviewed it".

## 6. Retention changes

An owner can change retention at `/ai/access`. The new period is re-applied to every existing conversation (last update + days). A person can delete any of their own conversations; this also cancels its open proposals.

## 7. Verification commands

```
npx tsc --noEmit
npx vitest run          # needs a disposable replica set (MONGODB_TEST_URI); set ANOPS_SKIP_DB_PREFLIGHT=1 for unit tests only
npm run build
```

## 8. Repository note: Phase 6 commit

Commit `037ab66` ("Add integration tests for community service and update unit tests for AI guards and community domain") contains the complete Phase 6 Community work, not only tests: Community permissions, the service rewrite to the workspace context with audit and transactions, the server-action and route changes, UI gating, the Community AI tools and commands, and the tests. Its message understates this. It has been pushed and is left unchanged.
