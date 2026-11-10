---
name: nextjs-crud-testing
description: Plan, implement, and execute thorough verification for Next.js CRUD modules, including unit, integration, authorization, database, route/action, browser, responsive, accessibility, error-state, and regression tests. Use when implementing or auditing management CRUD features.
---

# CRUD Testing and Verification for Next.js

## Goal

Prove that the CRUD workflow works at the boundaries that matter: domain rules, persistence, server entry points, UI state, security, and real user interactions.

Inspect the project's existing test stack first. Reuse established tools and conventions. Do not add a new test framework before checking existing dependencies and scripts.

## 1. Establish baseline

Before changing code:
- Inspect `package.json` scripts and test configuration.
- Identify existing unit, integration, browser, and accessibility tests.
- Run relevant baseline checks where practical.
- Record pre-existing failures separately.
- Inspect database test setup and whether tests use isolated data.

Do not erase existing tests or weaken assertions to make a build pass.

## 2. Build a CRUD test matrix

For every resource, adapt this matrix to the actual domain.

### Create
- Valid input creates exactly one record.
- Required fields are enforced server-side.
- Invalid types, ranges, enums, and malformed IDs are rejected.
- Normalization behaves correctly.
- Duplicate/unique constraints are handled.
- Invalid or inaccessible relationships are rejected.
- Client-supplied owner/tenant/role/system fields are ignored or rejected.
- Unauthenticated and unauthorized requests are rejected.
- Failed writes do not leave partial records.
- The UI displays success only after confirmed success.

### Read
- Authorized user can list permitted records.
- Unauthorized user cannot read protected records.
- Detail view returns the correct record.
- Missing or inaccessible records are handled correctly.
- Tenant/ownership filters are enforced.
- Search/filter/sort/pagination return correct results.
- Query parameters are bounded and validated.
- Sensitive fields are not returned.
- Large result sets are handled efficiently.

### Update
- Valid update changes only permitted fields.
- Invalid update is rejected without corrupting existing data.
- Updating to a duplicate value is handled.
- Missing record is handled.
- Cross-user/cross-tenant update is rejected.
- Server-managed fields cannot be changed.
- Concurrent/stale updates follow the product's intended policy.
- Related counts/lists/details remain consistent.

### Delete
- Correct record is deleted/archived according to domain rules.
- Unauthorized deletion is rejected.
- Cross-tenant deletion is rejected.
- Missing/already-deleted record is handled safely.
- Foreign-key/dependency conflict is handled.
- Confirmation is required where appropriate.
- Duplicate clicks do not cause harmful repeated behavior.
- UI updates only after success.

## 3. Test the real server boundary

Test the actual Server Action, Route Handler, or backend endpoint used by the feature—not only a mocked UI callback.

For Route Handlers, verify:
- HTTP method.
- Status codes.
- Request validation.
- Authentication/authorization.
- Response shape and content type.
- Error response safety.
- Query parameter validation.
- Relevant headers and rate limiting where applicable.

For Server Actions, verify:
- Input parsing and validation.
- Authentication/authorization on every action.
- Expected errors represented as result values.
- Revalidation only after successful mutation.
- No privileged fields can be forged by the caller.

Test service/data-access functions with an isolated database or appropriate test doubles according to the project's established test architecture.

## 4. Test the database invariants

Where the application uses a database:
- Test unique and foreign-key constraints.
- Test transaction rollback for multi-step writes.
- Test tenant/ownership-scoped queries.
- Test expected conflict mapping.
- Verify migrations match the model.
- Ensure tests do not depend on production data.
- Avoid running destructive database commands against an unverified environment.

Use integration tests for critical persistence behavior rather than mocking every database call.

## 5. Browser end-to-end tests

Use the existing browser test framework. Exercise complete user journeys:

1. Open the management page.
2. Confirm the list loads.
3. Search/filter/page if supported.
4. Open the create form.
5. Submit invalid data and verify accessible errors.
6. Submit valid data and verify the record appears.
7. Open the record or edit form.
8. Change a field and verify persistence after navigation/refresh.
9. Attempt an invalid update.
10. Delete with confirmation.
11. Verify the record is absent after refresh.
12. Test server/network failure behavior where the harness supports it.
13. Verify empty and no-results states.
14. Verify unauthorized users cannot access or mutate protected data.

Avoid brittle tests based on CSS implementation details. Prefer accessible roles, labels, and stable test IDs when necessary.

## 6. Responsive and accessibility verification

Test representative viewport widths, including narrow mobile, tablet, laptop, and desktop. Include intermediate widths if layout breakpoints are complex.

Verify:
- No unintended horizontal overflow.
- Table/list controls remain usable.
- Dialogs fit the viewport and scroll correctly.
- Forms remain readable.
- Navigation adapts correctly.
- Touch targets are practical.
- Keyboard navigation and focus work.
- Form errors are associated with fields.
- Async feedback is announced where appropriate.
- Color is not the only indicator of status.
- Reduced-motion preference is respected where animation exists.

Use automated accessibility scans plus manual keyboard review. Automated tools cannot establish full conformance by themselves.

## 7. Error and race-condition tests

Cover:
- Database unavailable.
- Backend returns non-2xx.
- Malformed JSON or unexpected response shape where applicable.
- Timeout.
- Duplicate submission.
- Delete during a stale list view.
- Update to a record changed by another actor.
- Revalidation failure or stale UI where relevant.
- Optimistic update rollback.
- Validation and authorization errors.
- Unexpected exception reaching the correct boundary.

Do not introduce arbitrary retries for non-idempotent operations.

## 8. Static and production checks

Run the actual project scripts for:
- Lint.
- TypeScript.
- Unit tests.
- Integration tests.
- End-to-end tests.
- Production build.

Use the existing package manager and scripts. If a check is unavailable, report it honestly and state what alternative verification was performed.

Review the final diff for:
- Unrelated changes.
- Unsafe casts and `any`.
- Missing authorization.
- Hardcoded secrets.
- Raw database errors shown to users.
- Placeholder handlers.
- Unused dependencies.
- Broken imports.
- Dead code.
- Missing responsive/error states.

## 9. Completion report

Report the exact checks run and whether each passed. Distinguish:
- Passed.
- Failed.
- Not run.
- Blocked by environment or missing configuration.
- Pre-existing failure.

Never claim tests passed when they were not executed. Never claim exhaustive security or correctness based solely on a successful build.
