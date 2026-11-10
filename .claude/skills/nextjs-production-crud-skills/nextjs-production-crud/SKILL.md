---
name: nextjs-production-crud
description: Build, repair, audit, or complete production-ready CRUD management features in existing Next.js App Router projects. Use whenever the user asks for a management module, admin CRUD, create/read/update/delete workflow, data table, form-backed mutation, or end-to-end resource management feature. Covers repository audit, data modeling, secure server operations, UI, loading/error states, testing, and verified delivery.
---

# Next.js Production CRUD Engineering

## Mission

Deliver a complete, tested, secure, maintainable CRUD feature for the resource or management area the user names. Treat CRUD as an end-to-end workflow, not merely a table and a form. Every advertised action must work against the real persistence layer and obey the project's authentication, authorization, validation, business rules, design system, and architectural conventions.

Use the supporting skill references when relevant:
- `../nextjs-crud-security/SKILL.md`
- `../nextjs-crud-reliability/SKILL.md`
- `../nextjs-crud-testing/SKILL.md`

## Trigger examples

Use this skill for requests such as:
- "Implement full CRUD for suppliers."
- "Finish all CRUDs for the Marketing module."
- "Make the management screen production-ready."
- "Audit and fix create/edit/delete, filtering, pagination, and errors."
- "Implement secure Next.js forms and API handlers."

## Absolute rules

1. **Inspect before editing.** Read repository instructions (`AGENTS.md`, `CLAUDE.md`, project-specific skill files), `package.json`, lockfile, route structure, schema/models, auth, permissions, validation, API clients, UI components, and existing tests. Confirm the actual Next.js/React versions and whether the project uses App Router, Pages Router, Server Actions, Route Handlers, an external backend, or a combination.
2. **Do not guess the data model or business rules.** Search the codebase and documentation. Reuse existing schema, enums, relations, conventions, and design-system components. If an essential business decision cannot be established from the repository or user request, ask one concise question; otherwise make a conservative documented choice.
3. **Preserve the existing architecture.** Do not replace the ORM, auth provider, validation library, styling system, state-management approach, or API contract without a compelling reason and user authorization. Do not introduce dependencies before checking what is already installed.
4. **Never fake functionality.** No buttons without real actions, placeholder CRUD handlers, mock persistence in production paths, swallowed errors, hardcoded success, or fake loading indicators.
5. **Enforce security on the server.** Client-side controls are UX, not authorization. Authenticate and authorize every read and mutation at the server boundary. Validate all untrusted inputs server-side.
6. **Follow the installed framework version.** Use current repository dependencies and the official documentation appropriate to that version. Do not copy obsolete APIs from older tutorials.
7. **Make changes incrementally.** Keep diffs scoped. Do not overwrite unrelated work, discard user changes, or perform destructive git operations.
8. **Verify before claiming completion.** Run the available checks and relevant tests. Report what actually passed, what failed, and what remains unverified.

## Phase A — Repository and feature discovery

Before implementation:

- Read applicable repository/agent instructions.
- Inspect `package.json`, lockfile, TypeScript configuration, Next.js configuration, lint/test scripts, and installed dependencies.
- Determine the actual router and route conventions.
- Identify the data source: ORM/database, existing internal API, external backend, or a documented mock used only for tests.
- Locate the existing entity schema, migrations, relations, uniqueness constraints, indexes, enums, and seed/test fixtures.
- Trace the authentication and authorization flow. Identify roles, tenant/workspace boundaries, ownership rules, and permission helpers.
- Find existing validation schemas, error types, API response envelopes, toast/dialog/form/table components, design tokens, and loading/empty/error patterns.
- Identify related pages and workflows that must remain compatible.
- Establish a baseline: relevant tests, lint, typecheck, and build where practical. Record pre-existing failures.

Create a concise implementation checklist internally or in the task summary. Do not stop at a plan if the request authorizes implementation.

## Phase B — Define CRUD behavior completely

For the requested resource, explicitly map:

### Create
- Fields and types.
- Required/optional rules and normalization.
- Defaults and server-derived fields.
- Relationship validation.
- Uniqueness and duplicate handling.
- Permission requirements.
- Successful post-submit behavior.

### Read
- List and detail behavior.
- Search, filters, sort, pagination, and page-size limits if relevant.
- Field visibility and sensitive-field exclusion.
- Tenant/ownership scope.
- Empty, loading, failure, and no-results states.
- Not-found behavior.

### Update
- Editable fields versus immutable/server-managed fields.
- Partial update semantics if supported.
- Validation and uniqueness excluding the current record.
- Stale data/concurrency behavior where material.
- Missing/deleted record behavior.
- Success and failure recovery.

### Delete
- Hard delete versus soft delete based on existing domain rules.
- Relationship/dependency constraints.
- Confirmation UX for destructive actions.
- Authorization and ownership checks.
- Idempotency/duplicate-click behavior where appropriate.
- Clear handling for conflicts and already-deleted/missing records.

Also implement any actions visibly implied by the UI: view details, activate/deactivate, archive/restore, bulk actions, export, or relation management. Do not silently expand scope into unrelated features.

## Phase C — Select the correct Next.js pattern

Choose the project's existing pattern deliberately:

- **Server Components** for server-rendered page composition and server-side reads when appropriate.
- **Server Actions/Server Functions** for form-oriented mutations when they fit the app's architecture and security model.
- **Route Handlers** for HTTP APIs, client-consumed endpoints, external integrations, or when an explicit API contract is required.
- **Existing backend APIs** when the Next.js app is a frontend for a separate service. Do not duplicate business logic in the frontend.
- **Pages Router APIs** only if the project actually uses the Pages Router.

Do not create both a Server Action and a Route Handler for the same operation without a real requirement. Avoid redundant layers that add complexity without improving security, reuse, or API boundaries.

For App Router code, account for current asynchronous request APIs, including promised `params` where required by the installed Next.js version. Confirm exact APIs from installed types and official docs rather than relying on memory.

## Phase D — Data and domain layer

Keep business rules and persistence logic out of presentational components.

Use the repository's established layering, for example:

- Resource schema/validation.
- Domain/service functions.
- Data-access/repository functions.
- Server Actions or Route Handlers as transport boundaries.
- UI components and page composition.

Avoid adding layers mechanically when the repository has a simpler valid convention. The objective is clear separation of concerns and testability.

Requirements:
- Use strict TypeScript types; avoid `any` and unsafe casts.
- Parse and validate IDs before database calls.
- Validate query parameters, pagination, sort fields, filters, and request bodies.
- Whitelist sortable/filterable fields; never interpolate untrusted identifiers into raw queries.
- Use parameterized ORM/database operations.
- Select only fields needed by the UI; do not expose password hashes, secrets, internal flags, or unrelated sensitive data.
- Enforce database constraints for invariants that must hold under concurrency.
- Use transactions for multi-step writes that must succeed or fail together.
- Keep timestamps, ownership, tenant IDs, and privileged fields server-controlled.
- Map persistence errors to safe domain/API errors.
- Add indexes only when supported by query patterns and existing schema conventions.
- Do not run destructive migrations or reset data.

## Phase E — Secure mutation/read boundaries

For every entry point, including Server Actions, Route Handlers, and direct service entry points:

1. Authenticate the caller where required.
2. Authorize the exact operation and resource.
3. Validate and normalize all untrusted input.
4. Enforce tenant/workspace/ownership scope in the query itself where applicable.
5. Execute the domain operation.
6. Map expected errors to the project's standard result shape or HTTP status.
7. Revalidate or refresh affected UI/data only after successful mutations.
8. Log unexpected failures safely with useful diagnostic context.

Never rely on middleware or a hidden button as the only authorization control. Never trust IDs, role names, owner IDs, tenant IDs, or privileged flags supplied by the client.

## Phase F — Build the complete user experience

Use the project's design system and brand-kit instructions. Reuse existing components and theme tokens.

A complete management UI should include, where relevant:
- Clear page title and primary action.
- Search and filters with sensible empty/reset behavior.
- Pagination or appropriate large-data handling.
- Accessible table/list semantics and row actions.
- Create and edit forms with labels, descriptions, placeholders, validation, and preserved values on failure.
- Detail view when the user workflow requires it.
- Confirmation dialog for destructive actions.
- Pending state and duplicate-submit prevention.
- Success/error feedback based on actual server results.
- Loading skeletons or other suitable loading states.
- First-use empty state and separate no-search-results state.
- Permission-aware UI without treating UI hiding as security.
- Responsive behavior for narrow mobile screens, tablets, desktop, and zoom.
- Keyboard navigation, focus management, visible focus, and screen-reader announcements.

Do not redesign unrelated screens. Do not add decorative effects that conflict with the brand or harm performance.

## Phase G — Error and cache consistency

Use the existing error/result conventions. Expected validation, duplicate, conflict, forbidden, and not-found outcomes should be represented explicitly and displayed helpfully. Unexpected programming/infrastructure failures should reach appropriate logging and error boundaries without leaking internal details.

After a successful mutation:
- Invalidate/revalidate the exact affected paths, tags, or query cache using the project's current strategy.
- Ensure list, detail, count, and related views do not show stale contradictory data.
- Do not invalidate everything indiscriminately.
- Do not revalidate before a failed mutation.
- Do not assume `router.refresh()` fixes every stale-cache problem; understand the data/cache path first.
- Avoid caching personalized or permission-sensitive data in a way that can cross users or tenants.

## Phase H — Verification

Follow `../nextjs-crud-testing/SKILL.md`.

At minimum, verify all relevant CRUD flows:
- Create valid record.
- Reject invalid input.
- Reject unauthorized request.
- List and detail reads.
- Search/filter/sort/pagination if present.
- Update existing record.
- Reject invalid update.
- Handle missing record.
- Delete with confirmation.
- Handle constraint/duplicate/conflict errors.
- Verify data remains correct after refresh/navigation.
- Verify loading, empty, success, and error states.
- Verify mobile and keyboard behavior.
- Verify related records and existing workflows remain intact.

Run the project's actual lint, typecheck, tests, and production build scripts where feasible. Inspect changed files and diff. Fix introduced failures.

## Phase I — Completion report

Report:
- What was implemented.
- The files/modules changed.
- Which CRUD operations and supporting behaviors are covered.
- Security/authorization and validation decisions.
- Tests/checks actually run and their results.
- Any pre-existing failures or environment limitations.
- Any remaining gaps that prevent calling the feature production-ready.

Do not claim "100% working", "fully secure", or "production-ready" unless the evidence supports that level of confidence. Prefer precise, verifiable claims.

## Final acceptance criteria

The feature is complete only when:
- All advertised CRUD actions are connected to real persistence.
- Every server entry point validates input and checks authorization.
- Tenant/ownership constraints are enforced where applicable.
- Errors are explicit, safe, and recoverable.
- UI states reflect real operation outcomes.
- Cache/UI consistency is correct after mutations.
- Responsive and accessibility behavior has been checked.
- Relevant tests and static checks have been run.
- Existing application behavior is preserved.
- The final report distinguishes verified results from assumptions or untested cases.
