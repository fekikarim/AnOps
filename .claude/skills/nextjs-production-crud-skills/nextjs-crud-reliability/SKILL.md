---
name: nextjs-crud-reliability
description: Engineer reliable CRUD user experiences in Next.js with explicit expected-error results, error boundaries, loading/pending states, empty states, cache consistency, mutation safety, retry behavior, and recovery. Use when building or fixing CRUD reliability and failure handling.
---

# Reliable CRUD, Loading, and Error Handling

## Goal

Ensure the interface always reflects the true state of the operation and gives users a safe path forward when something fails.

Follow the installed Next.js version's official guidance. For the App Router, distinguish expected operational errors from unexpected exceptions.

## 1. Classify errors

### Expected errors

These are normal business outcomes and should be modeled explicitly:
- Validation failure.
- Duplicate/unique conflict.
- Missing record.
- Permission denial.
- Invalid state transition.
- Dependency/foreign-key conflict.
- Rate limit.
- Known external-service failure.
- Network/request failure.

Return a typed result or use the existing application error contract. For form-oriented Server Actions, use the installed React version's supported `useActionState` pattern when appropriate. Avoid using thrown exceptions as ordinary form validation control flow.

### Unexpected errors

These indicate a bug or an infrastructure failure:
- Unexpected database failure.
- Invariant violation.
- Unhandled programming error.
- Unexpected serialization failure.
- Unknown external dependency error.

Log these on the server using the existing observability solution and allow them to reach the appropriate error boundary or centralized error handler. Return a generic user-safe message; never expose stack traces or secrets.

## 2. Define a stable result contract

Reuse the project's existing result envelope. If none exists, define a discriminated union with:
- `success` or `ok` discriminator.
- Safe user-facing message where appropriate.
- Field-level validation errors when relevant.
- Returned resource data only when needed.
- A stable error code for expected failures.
- Correlation/request ID if supported.

Do not return database objects wholesale. Serialize only the required fields and use types that are safe to cross the server/client boundary.

Keep the result contract consistent across create, update, and delete operations.

## 3. Loading and pending behavior

Implement the correct loading level:
- Route loading UI for route-level content.
- Skeletons when the content structure is predictable.
- Inline pending state for a row or individual action.
- Form pending state for submission.
- Progress indicators for long-running tasks.
- Disabled duplicate-submit behavior for mutations where necessary.

Rules:
- Do not show success before the server confirms success.
- Do not leave buttons permanently disabled after a rejected operation.
- Do not replace useful content with a full-screen spinner unnecessarily.
- Preserve form values after expected validation or server failures.
- Prevent repeated destructive actions while the first is pending.
- If a request can take a long time, communicate progress honestly.
- Do not retry non-idempotent mutations automatically unless idempotency is designed.

## 4. Form feedback

For each form:
- Validate on the server.
- Use client validation for quick feedback where appropriate.
- Associate field errors with their controls.
- Present a concise form-level error for failures that do not belong to a field.
- Preserve valid input on failure.
- Announce asynchronous feedback accessibly.
- Focus or scroll to errors when useful and not disruptive.
- Clear stale errors when the user corrects the relevant field.
- Disable submit only while a submission is pending or the form is genuinely invalid according to the UX contract.

Never use placeholder text as the only label. Error text must explain what to correct, not merely say "Invalid input."

## 5. Delete and destructive actions

- Ask for confirmation when the operation is destructive or difficult to reverse.
- Identify the record and consequence clearly.
- Disable duplicate confirmation while pending.
- On success, close the dialog and update/revalidate the affected data.
- On failure, keep enough context to retry or cancel.
- Handle a record already deleted by another user.
- Handle dependency conflicts without silently deleting related data.
- Use soft delete only if supported by domain requirements.

## 6. Cache and UI consistency

After a successful mutation:
- Revalidate the exact route/tag or update the relevant client cache according to the project's established architecture.
- Ensure list counts, detail pages, relationship counts, and summaries stay consistent.
- Do not refresh unrelated pages or invalidate all data indiscriminately.
- Avoid showing optimistic data as committed until the operation succeeds.
- Roll back optimistic changes on failure.
- Avoid race conditions where an older fetch overwrites a newer mutation result.
- Consider stale edits and concurrent updates for high-value records.

Do not add a second cache layer without understanding the existing one.

## 7. Not found and authorization behavior

Use the framework's `notFound()` and `not-found.tsx` conventions for genuinely missing route resources where appropriate. Use deliberate authentication/authorization handling for protected resources.

For Route Handlers, return the correct HTTP status and safe response body instead of rendering page-level UI. For Server Actions, use the application's expected-result contract for ordinary errors.

Do not use `notFound()` as a catch-all for every exception.

## 8. Error boundaries

Use App Router `error.tsx` boundaries for unexpected rendering/runtime errors at suitable route segments. They must be Client Components. Provide:
- Clear, nontechnical explanation.
- Safe retry/recovery action where appropriate.
- Optional request/reference ID if available.
- Error reporting through the project's logging/monitoring integration.

Use `global-error.tsx` only when a root-level fallback is required; it must render its own `<html>` and `<body>` because it replaces the root layout.

Error boundaries do not catch all event-handler or asynchronous errors. Handle expected mutation outcomes in the action/caller and surface them in component state. Do not expose internal error messages to users.

Use newer or experimental framework APIs only if they are actually supported by the installed version and the project deliberately accepts that dependency. Prefer stable, documented conventions.

## 9. Read and list failures

Differentiate:
- Initial load failure.
- Refresh/retry failure.
- No records exist.
- Search/filter has no matches.
- User lacks permission.
- Resource was deleted or is unavailable.

Offer a retry action only when retry is meaningful. Avoid endless automatic retries. Preserve search/filter state when useful.

## 10. Reliability acceptance tests

- Invalid form submission returns field errors.
- Server failure shows safe feedback and allows recovery.
- Pending state is visible and prevents accidental duplicates.
- Successful mutations update the correct UI.
- Failed mutations do not falsely update the UI.
- Delete conflict explains why deletion failed.
- Not-found routes render the correct fallback.
- Unexpected render failures reach the correct error boundary.
- User input survives validation/network failures where appropriate.
- Cache invalidation keeps list/detail/count data consistent.
- Keyboard and screen-reader users can perceive status changes.
