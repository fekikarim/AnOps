# AnOps — Production Architecture & Engineering Implementation Standard

This is the master implementation specification for all AI coding agents and engineers working on AnOps. It translates the six class diagrams (five module diagrams plus the platform-wide diagram) into a consistent, secure, performant, and production-oriented architecture for the existing Next.js application.

The objective is not simply to make the diagrams compile into code. It is to implement a coherent SaaS platform where every module integrates correctly with the shared identity, organizations, companies, subscriptions, permissions, database, and AI services.

Mandatory principle: the diagrams define the domain model; they do not override the existing repository architecture. Before implementing a class, API, database collection, or UI screen, inspect the actual codebase, identify existing conventions and integrations, and implement the design in the way that fits the existing Next.js application.

## 1. Project context and technical constraints

Application architecture

Next.js 16.4.2 · React 19.3.0 · TypeScript 5

Use Next.js App Router conventions where the repository supports them. Keep server-side business logic separate from the presentation layer.

Current persistence and authentication dependencies

MongoDB 6.21.0 · NextAuth 5 beta · MongoDB Auth Adapter

Assume MongoDB is the current database direction until the repository proves otherwise. Do not silently introduce PostgreSQL, Prisma, Mongoose, or a second authentication framework.

Validation and forms

Zod 4 · React Hook Form 7 · bcryptjs

Reuse Zod schemas at appropriate trust boundaries, React Hook Form for interactive forms, and the established password/authentication implementation.

Quality and styling

ESLint 9 · eslint-config-next · Tailwind CSS 4 · lucide-react

Preserve the project's styling system, lint rules, reusable components, and established design language.

### Current `package.json` baseline

The following existing scripts are the starting point:

| Script          | Required use                                |
| --------------- | ------------------------------------------- |
| `npm run dev`   | Local development                           |
| `npm run build` | Production compilation and build validation |
| `npm start`     | Run the production build                    |
| `npm run lint`  | ESLint validation                           |

The package list is a constraint, not proof that every capability is already implemented. For example, MongoDB being installed does not establish that indexes, transactions, connection reuse, or tenant isolation are correctly configured.

Dependency rule: do not install additional packages simply because an agent prefers them. First determine whether the current dependencies and native platform capabilities are sufficient. If a new dependency is genuinely required, explain the need, security implications, bundle impact, maintenance status, and alternative before adding it. Update and validate the lockfile whenever dependencies change.

## 2. Non-negotiable architecture rules

Every engineer and AI agent must follow these rules unless a documented architectural decision explicitly supersedes them.

### 01

Inspect before changing

Read the existing route structure, authentication configuration, database helpers, UI components, schemas, and conventions before creating or moving files.

### 02

Server is authoritative

Never trust a client-supplied user ID, role, organization ID, company ID, price, stock balance, subscription status, or AI entitlement.

### 03

Tenant isolation everywhere

Every business-data operation must be scoped to the authorized organization and, where applicable, company. Never rely on hiding data in the UI.

### 04

Keep business logic out of UI components

Pages and React components render interfaces. Server-side services enforce business rules and coordinate database operations.

### 05

Validate every trust boundary

Validate route parameters, query parameters, request bodies, environment configuration, and external-provider responses.

### 06

Enforce invariants in the database and service layer

Use unique indexes, schema constraints where available, conditional updates, atomic operations, and transactions where supported and necessary.

### 07

Design for failure

Handle timeouts, retries, duplicate requests, partial provider failures, database unavailability, and concurrent updates deliberately.

### 08

No fake production functionality

Do not present mock data, simulated integrations, placeholder buttons, or fabricated AI results as working production features.

### 09

Prove changes with tests

Run the relevant tests, lint, TypeScript checks, and production build. Add tests for the new behavior instead of relying on visual inspection.

### 10

Document consequential decisions

Record new collections, indexes, state transitions, permissions, API contracts, external integrations, and any deviation from the diagrams.

## 3. Required Next.js application architecture

Use the App Router and Server Components by default, provided the repository's existing implementation is compatible. Do not rewrite the application structure just to match a hypothetical template.

### Recommended directory structure

This is the target structure to work toward, not permission to duplicate existing files or create a second competing architecture.

```

src/
  app/
    (public)/
      page.tsx
      apps/
      pricing/
      industries/
      community/
      contact/
      legal/
    (auth)/
      login/
      register/
      forgot-password/
    (workspace)/
      dashboard/
      [organizationSlug]/
        layout.tsx
        inventory/
        manufacturing/
        finance/
        hr/
        marketing/
        community/
        settings/
    api/
      auth/
        [...nextauth]/
          route.ts
      v1/
        organizations/
        companies/
        inventory/
        manufacturing/
        finance/
        hr/
        marketing/
        community/
        ai/
  components/
    ui/
    shared/
    forms/
    data-display/
  features/
    organizations/
    companies/
    inventory/
    manufacturing/
    finance/
    hr/
    marketing/
    community/
    ai/
  lib/
    auth/
    db/
    env/
    errors/
    http/
    logging/
    security/
    storage/
  server/
    policies/
    services/
    repositories/
    integrations/
    jobs/
  types/
  tests/
docs/
  architecture/
  api/
  decisions/

```

Adapt the names to existing repository conventions. If the project currently uses the root-level `app/` directory, keep it rather than moving everything into `src/app/` without a concrete benefit.

### Responsibilities of each layer

Presentation — App Router and components

Pages, layouts, navigation, tables, forms, dialogs, loading states, error states, and responsive interfaces. Client Components are used only where browser-side interactivity requires them.

Transport — Route Handlers and Server Actions

Authenticate the request, validate input, invoke the correct use case, and translate results into safe HTTP responses. Server Actions are also untrusted entry points and require authorization.

Application services and policies

Use cases, authorization decisions, workflow transitions, transaction boundaries, idempotency, business invariants, and orchestration.

Repositories and database

MongoDB queries, index definitions, conditional writes, aggregation pipelines, pagination, and persistence mapping. Repositories must not bypass authorization requirements defined by the application layer.

Infrastructure and external integrations

Email, file storage, AI providers, social networks, background workers, observability, and scheduled tasks behind explicit interfaces.

### Dependency direction

The normal dependency direction is:

`UI → transport/use case → policy + service → repository/integration → database/provider`

Important distinctions:

- Shared domain rules must not depend on React components.
- Database code must not import UI components.
- Reusable UI components must not contain finance, payroll, or inventory business rules.
- Route Handlers should not contain large blocks of domain logic or duplicate business rules.
- Do not expose MongoDB documents directly as public API contracts.
- Avoid circular imports between modules.
- Use dependency injection or explicit function parameters where that improves testability. Do not introduce an elaborate dependency-injection framework without need.

### Next.js-specific requirements

1. Server Components by default. Add `"use client"` only to components that need state, effects, browser APIs, or client-side event handlers.
2. Use Route Handlers for external APIs. Provide versioned routes such as `/api/v1/inventory/products` for clients that need a stable HTTP contract.
3. Use Server Actions for appropriate UI-originated mutations. They are not a substitute for authorization, validation, or domain services.
4. Do not use Middleware/Proxy as the sole authorization layer. It may help redirect unauthenticated users, but every protected data access and mutation needs a server-side authorization check.
5. Protect caching boundaries. Personalized and tenant-specific responses must never be served from a shared cache without a proven isolation strategy.
6. Keep secrets server-side. Never use `NEXT_PUBLIC_` for database credentials, authentication secrets, AI keys, SMTP credentials, or private storage keys.
7. Handle streaming deliberately. Do not stream sensitive data before verifying authorization. Do not use streaming to bypass response validation or tenant scoping.
8. Respect the deployed runtime. If a handler needs MongoDB driver features, cryptography, or a provider SDK incompatible with Edge Runtime, run it in the Node.js runtime.
9. Use supported Next.js 16 conventions. Inspect the installed version's actual types and documentation before adopting APIs from older tutorials; do not blindly copy Next.js 13–15 examples.

## 4. Shared platform architecture: implement this before the modules

The master class diagram represents the foundation on which every module depends. It must not become a collection of unrelated implementations created independently by five agents.

### Core shared entities

| Entity                             | Responsibility                                 |
| ---------------------------------- | ---------------------------------------------- |
| `User`                             | Global identity and authentication profile     |
| `Company`                          | The tenant boundary: one business and all its data |
| `CompanyMember`                    | A user's role inside one company (`owner`, `admin`, `manager`, `employee`) |
| `Role`, `Permission`               | Authorization vocabulary and policies          |
| `MembershipRole`, `RolePermission` | Explicit many-to-many assignments              |
| `Application`                      | Registry of available modules                  |
| `Plan`, `PlanEntitlement`          | Commercial plan and granted capabilities       |
| `Subscription`, `SubscriptionApp`  | Organization's subscription and app selection  |
| `BillingRecord`                    | Subscription-related billing records           |
| `AuditEvent`                       | Traceable record of sensitive business actions |
| `AIJob`, `AIUsageRecord`           | AI task lifecycle and metered usage            |

These entities need shared definitions and owners. They must not be redefined differently in each feature directory.

### Critical distinctions

Identity is not membership. A registered user does not automatically have access to every organization. The user must have an active membership, and that membership must grant the relevant permissions.

There is one tenant boundary: the company. A user can belong to several companies, and each company's data (staff, job titles, attendance, stock, orders) is isolated from the others. There is no organization level above or below the company. A new user creates a company during onboarding before any module is available.

Subscription is not authorization. A paid plan can enable an application without granting every member full access to its data. The system must check both commercial entitlement and the user's actual permissions.

Application availability is not subscription access. Public portal metadata may show an application as `In Progress` or `Coming Soon`. The API must still enforce whether the application is implemented, enabled, and available to that tenant.

AI entitlement is not AI authorization. An AI-enabled plan does not mean every member can submit every type of prompt or access every document. AI operations must respect the same tenant, company, role, data sensitivity, and action policies as the underlying application.

### Mandatory request authorization sequence

For every protected request, implement the equivalent of this sequence:

1. Authenticate the current user.
2. Resolve the requested organization from trusted route context.
3. Verify the user's active membership in that organization.
4. Resolve the target company, if the operation is company-scoped.
5. Verify the membership's permission and company scope for the requested action.
6. Check that the application is implemented and entitled for the organization.
7. Check any additional policy, such as document ownership, workflow status, approval rights, or AI access.
8. Execute the operation using a tenant-scoped query.
9. Record an audit event when required.
10. Return only the authorized result, using a safe response schema.

The order can be optimized internally, but no step that is required for a decision may be skipped.

Do not trust organization IDs, company IDs, or roles supplied in a request body as proof of access. They are requested resource selectors; the server must verify them against trusted membership and authorization data.

## 5. MongoDB data-model and persistence rules

The current dependencies support using the official MongoDB Node.js driver. Unless the repository already uses another deliberate persistence abstraction, keep the implementation consistent with that driver.

### Collection design

- Use a consistent naming convention, such as `users`, `companies`, `company_members`, `employees`, `inventory_products`, and `attendance`.
- Use a consistent identifier strategy. MongoDB `_id` values should be mapped to API identifiers deliberately; do not mix `ObjectId`, arbitrary strings, and user-controlled identifiers without a defined contract.
- Every tenant-owned document carries `companyId`. It is the only tenant key; do not add other tenant fields.
- Services take a required `companyId`. Never accept an optional one, and never build a filter that drops the company when the id is missing. See docs/ARCHITECTURE.md (Multi-Tenancy).
- Do not copy entire parent documents into child records when a stable reference and a small historical snapshot are sufficient.
- Add `createdAt` and `updatedAt` where applicable, and actor/approval metadata for workflows that require it.
- Use explicit DTOs to separate persisted documents from public responses.

### Indexes are part of the design

Create and maintain indexes through an explicit, repeatable index-initialization or migration process. Do not depend on an engineer manually creating indexes in a production database.

Examples to assess against actual query patterns:

| Collection           | Candidate index                                                                     |
| -------------------- | ----------------------------------------------------------------------------------- |
| `memberships`        | Unique `(organizationId, userId)`                                                   |
| `companies`          | `(organizationId, status)`                                                          |
| `products`           | Unique `(organizationId, companyId, sku)` if SKU uniqueness is required per company |
| `stockMovements`     | `(organizationId, companyId, productId, createdAt)`                                 |
| `invoices`           | `(organizationId, companyId, status, issueDate)`                                    |
| `employees`          | Unique `(organizationId, companyId, employeeNumber)` if required                    |
| `campaignDeliveries` | Unique `(campaignId, recipientKey)` or an equivalent idempotency key                |
| `auditEvents`        | `(organizationId, createdAt)`                                                       |

These are candidates, not a copy-and-paste index list. Confirm the uniqueness rules and access patterns with the domain owner. Every index increases storage and write costs; indexes must support actual filters, sorts, joins/aggregations, and uniqueness constraints.

### Atomicity and transaction policy

Use MongoDB single-document atomic operations when they adequately protect an invariant. Use transactions for business operations that must update multiple documents as one logical unit, provided the deployed MongoDB topology supports transactions.

If transactions are unavailable, do not silently replace them with several unprotected writes. Choose an explicit design such as conditional updates, reservation records, an outbox workflow, or a recoverable saga.

Examples:

- Completing a work order must not consume components while failing to record finished goods.
- Posting an invoice and allocating a payment must not leave a falsely paid invoice.
- Approving leave and adjusting a leave balance must remain consistent.
- A subscription update and entitlement refresh must not leave stale access indefinitely.

Avoid unbounded arrays for histories, chat messages, campaign events, or stock movements. Store growing collections as separate documents with indexes and pagination.

### Money, time, and state

- Store money in integer minor units where the currency's rules permit, or use a deliberate decimal representation such as `Decimal128`. Never use ordinary floating-point arithmetic for financial calculations.
- Record the currency explicitly. Do not assume all records are denominated in TND.
- Store instants as UTC timestamps and define business time zones for local calendars, payroll periods, campaign schedules, and due dates.
- Use explicit enumerated status values and legal transition functions. Do not let arbitrary strings move a record through its lifecycle.
- Add optimistic concurrency controls or conditional updates for records that may be edited by multiple users simultaneously.
- Use soft deletion only where recovery, audit, or legal requirements justify it. Soft-deleted records must be excluded from normal queries by default and handled consistently in indexes and uniqueness rules.

## 6. API contract and implementation standard

Every endpoint must have a clear purpose, method, authorization policy, input schema, response contract, error contract, and tests.

### Recommended API conventions

Use `/api/v1/...` for stable external-facing routes. Existing internal routes may be retained during migration, but document them and avoid creating two conflicting versions of the same operation.

| Operation                     | HTTP method                         | Example                                          |
| ----------------------------- | ----------------------------------- | ------------------------------------------------ |
| List resources                | `GET`                               | `/api/v1/inventory/products`                     |
| Retrieve resource             | `GET`                               | `/api/v1/inventory/products/:id`                 |
| Create resource               | `POST`                              | `/api/v1/inventory/products`                     |
| Update resource               | `PATCH`                             | `/api/v1/inventory/products/:id`                 |
| Delete/archive resource       | `DELETE` or explicit archive action | `/api/v1/inventory/products/:id`                 |
| Perform a business transition | `POST`                              | `/api/v1/manufacturing/work-orders/:id/complete` |

Use action-specific endpoints for consequential workflow transitions rather than letting a generic update endpoint accept any status.

### Standard response and error shape

Define a shared response contract and apply it consistently. One suitable shape is:

```

{
  "data": {
    "id": "resource-id"
  },
  "meta": {
    "requestId": "request-id"
  }
}

```

For errors:

```

{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request contains invalid fields.",
    "requestId": "request-id",
    "details": []
  }
}

```

Use the appropriate HTTP status codes: `400` for malformed requests, `401` for unauthenticated requests, `403` for denied operations where disclosure is safe, `404` for missing or deliberately concealed resources, `409` for conflicting state, `422` for semantically invalid input if that convention is adopted, `429` for rate limits, and `5xx` for unexpected server failures.

Do not expose stack traces, database errors, private provider messages, tokens, or internal infrastructure details in production responses. Ensure error codes and HTTP status mappings are consistent.

### Zod validation rules

- Validate all body payloads, query parameters, route identifiers, pagination values, and state-transition inputs.
- Use strict schemas where appropriate, so unexpected fields cannot silently alter privileged properties.
- Never spread an untrusted request object into a database update.
- Construct a whitelist of fields the caller is allowed to change.
- Enforce limits for strings, arrays, file sizes, numeric ranges, and nested payloads.
- Normalize identifiers and search values where appropriate, without changing legitimate user content unexpectedly.
- Validate external-provider responses before using them as trusted internal data.
- Separate create, update, list-filter, and response schemas when their requirements differ.
- Do not return internal fields such as password hashes, reset tokens, provider credentials, private notes, or unrestricted audit metadata.

### Pagination and filtering

Every list endpoint that could return a growing dataset must be paginated. Prefer cursor/keyset pagination for large or frequently changing datasets. Use bounded page sizes, deterministic sort order, validated filters, and indexed query paths.

Avoid unrestricted full-collection reads, arbitrary client-controlled sorting, unbounded `$regex` searches, and deep `skip` pagination for large datasets. For text search, select a deliberate indexed strategy and control query cost.

### Idempotency and concurrency

For consequential operations, define what happens if a client retries a request after a timeout.

Examples include:

- Posting an invoice.
- Allocating a payment.
- Posting a goods receipt.
- Completing a work order.
- Starting a campaign.
- Processing a webhook.
- Submitting a paid or quota-limited AI request.

Use idempotency keys, unique constraints, conditional state transitions, or durable operation records as appropriate. An idempotency key must be scoped to the authorized tenant and operation, have a defined retention period, and reject reuse with a materially different payload.

Do not blindly retry non-idempotent writes.

### API performance rules

- Fetch only the fields the caller needs.
- Build indexes around actual query patterns.
- Avoid N+1 database access patterns and repeated authentication/membership lookups within a single request.
- Use aggregation pipelines for suitable database-side reporting instead of loading entire collections into Node.js.
- Set appropriate database and provider timeouts.
- Reuse the database client across hot reloads and requests using the repository's established connection-management pattern.
- Use bounded concurrency for batch jobs.
- Cache only data with a clear invalidation and tenant-isolation strategy.
- Measure slow queries and high-volume routes before attempting speculative optimizations.

## 7. Authentication, authorization, and security

AnOps handles financial records, employee information, private business documents, customer contacts, and potentially AI-generated actions. Security must be designed into the application rather than added at the end.

### NextAuth.js 5 and account security

Keep the existing NextAuth.js 5 beta integration unless a documented issue justifies a migration.

Agents must:

- Inspect the current session strategy, callbacks, providers, MongoDB adapter, and account lifecycle before modifying authentication.
- Keep the session's exposed user data minimal. Do not treat client-visible session properties as proof of authorization.
- Resolve current organization membership and sensitive permissions server-side for protected operations. If permissions are cached, define how membership changes and revocations invalidate that cache.
- Never assume the MongoDB adapter automatically implements AnOps organizations, companies, roles, permissions, or subscription entitlements.
- Use secure, `HttpOnly`, appropriately `SameSite` cookies and `Secure` cookies in HTTPS production environments, following the framework's supported configuration.
- Protect account registration, login, password reset, email verification, and other authentication flows against abuse.
- Use cryptographically secure, single-use, expiring password-reset and verification tokens, stored safely and invalidated after use.
- Keep password hashes private and never return them through an API or log.
- Review password hashing configuration and work factor for `bcryptjs`; benchmark it in the target runtime and prevent password-hashing requests from becoming a denial-of-service vector.
- Apply rate limiting to login, registration, password-reset, verification, and other abuse-sensitive endpoints.
- Do not log passwords, raw session tokens, authorization headers, reset tokens, or authentication secrets.

If the application uses JWT-based sessions, do not pack the entire membership, permissions matrix, or mutable subscription state into a long-lived token and assume it remains current. Plan for revocation, membership changes, and session invalidation.

### RBAC and resource-level authorization

Role-based access control is necessary but may not be sufficient. AnOps needs resource and scope checks too.

For example, a finance user with permission to read invoices must not automatically gain access to every company's invoices, private employee salary data, or AI document extraction results.

Implement explicit policies such as:

- `inventory.product.read`
- `inventory.product.create`
- `inventory.stock.adjust`
- `manufacturing.work_order.complete`
- `finance.invoice.read`
- `finance.invoice.post`
- `finance.payment.allocate`
- `hr.employee.read`
- `hr.payroll.approve`
- `marketing.campaign.send`
- `community.content.moderate`
- `ai.request.execute`
- `organization.members.manage`
- `organization.billing.manage`

These names are illustrative. Define a central permission catalogue with module owners and consistent naming.

Never rely on a button being hidden as authorization. UI visibility improves usability; the server remains responsible for enforcing every action.

### Security checklist

- Prevent cross-tenant access and insecure direct object references (IDOR).
- Use parameterized/structured MongoDB queries. Never allow client input to become unrestricted MongoDB operators or query objects.
- Restrict allowed update fields and workflow transitions.
- Protect against stored and reflected XSS; sanitize or safely render user-generated HTML and Markdown.
- Apply CSRF protections appropriate to the actual authentication and request architecture. Do not assume every request made through a Server Action or cookie-authenticated API is automatically safe.
- Configure CORS narrowly when cross-origin access is actually needed.
- Add request body size limits, upload size limits, rate limits, and sensible timeouts.
- Validate file types using content inspection where feasible, not just filename extensions or client-supplied MIME types.
- Store private documents in private storage and serve them through authorized access checks or short-lived signed URLs.
- Protect secrets using environment variables or a managed secrets service. Keep production secrets out of source control and logs.
- Validate redirect destinations to prevent open redirects.
- Use secure headers and a considered Content Security Policy compatible with the application's actual scripts and integrations.
- Use least-privilege database credentials, restrict production database network access, and maintain tested backups.
- Audit dependency vulnerabilities and review dependency additions before release.

### Audit logging

Audit events should capture relevant actions such as role changes, membership changes, company configuration changes, invoice posting, payment allocation, stock adjustments, payroll approvals, campaign dispatch, and sensitive AI-assisted actions.

At minimum, define:

- Organization and company scope when applicable.
- Actor ID and relevant actor membership.
- Action and target resource.
- Timestamp.
- Outcome and a request/correlation ID.
- Minimal before/after information where justified.

Do not record passwords, authentication tokens, entire private documents, or unrestricted sensitive payloads in audit logs. Restrict access to audit data and define retention policies.

## 8. Reliability, observability, and production operations

A production-ready platform must behave correctly when dependencies fail, requests are repeated, data changes concurrently, or a background task stops halfway through.

### Required reliability behavior

| Risk                         | Required response                                                                |
| ---------------------------- | -------------------------------------------------------------------------------- |
| Database unavailable         | Return a controlled failure, log the cause safely, and avoid unbounded retries   |
| Provider timeout             | Apply a bounded timeout and a controlled failure/fallback path                   |
| Duplicate request            | Use idempotency or a unique business constraint where required                   |
| Concurrent edit              | Use conditional updates or optimistic concurrency control                        |
| Background job crashes       | Persist job state and allow safe recovery/retry                                  |
| Partial multi-step operation | Use transactions, an outbox, or a recoverable workflow                           |
| Subscription changes         | Keep access decisions consistent and invalidate stale entitlement caches         |
| AI provider quota exhausted  | Enforce quota policy, explain the failure, and avoid accidental repeated charges |
| Email or social API failure  | Track delivery status and retry safely where supported                           |

### Observability requirements

Create a shared logging and monitoring approach rather than each module inventing its own.

- Use structured server-side logs.
- Propagate a request/correlation ID across API calls, service operations, and background jobs.
- Record latency, error rates, provider failures, job retries, and important business-operation outcomes.
- Measure slow database queries and expensive aggregation pipelines.
- Monitor resource utilization and event-loop or runtime pressure where the hosting platform allows it.
- Keep health checks free of sensitive details.
- Add alerting for repeated failures and critical workflows that are stuck.
- Define retention and access control for logs, metrics, and traces.

Use a provider-neutral interface for logging and monitoring if the final observability provider has not been selected. Do not invent a successful monitoring integration that has not been configured.

### Background work

Use durable background processing for work that is slow, expensive, scheduled, or requires retries, such as:

- Campaign delivery and social scheduling.
- Email delivery and large notification batches.
- Document extraction and AI processing.
- Report generation for large datasets.
- Subscription lifecycle processing.
- Outbox event delivery.
- Reconciliation and cleanup jobs.

Do not run long-running jobs by assuming a Next.js request will remain alive indefinitely. Choose a queue, worker, or managed task service compatible with the deployment environment. The current `package.json` does not establish that a queue is installed, so evaluate and document the necessary infrastructure before implementing one.

## 9. Module-by-module implementation rules

Each module must implement the shared architecture first, then its domain-specific behavior. The class diagrams are a starting point; the following requirements are acceptance constraints.

### 9.1 Karim — Inventory and Manufacturing

Core entities: `ProductCategory`, `Product`, `Warehouse`, `StockBalance`, `StockMovement`, `Supplier`, `PurchaseOrder`, `PurchaseOrderLine`, `GoodsReceipt`, `GoodsReceiptLine`, `BillOfMaterials`, `MaterialRequirement`, `WorkOrder`, `WorkOrderMaterial`, `StockForecast`, `PurchaseRecommendation`, `RecommendedPurchaseLine`.

Required behavior

- Product SKU uniqueness must follow a documented organization/company scope.
- Model units of measure and conversion rules if the application supports different purchase, storage, and production units.
- Treat stock movements as the durable record of stock changes. Do not allow users to edit a displayed stock balance directly as an ordinary product field.
- Define whether `StockBalance` is a transactional projection, a cached aggregate, or a materialized balance. It must reconcile against the movement ledger.
- Record movement type, quantity, source, destination where applicable, actor, timestamp, and related document/work order.
- Prevent invalid stock quantities and unauthorized adjustments.
- Define a policy for negative stock, reservations, and concurrent withdrawals. Never let a race condition silently create impossible stock.
- A purchase order does not increase on-hand stock simply because it is created or approved. Stock changes when the relevant goods receipt is validly posted.
- Receipt posting must prevent accidental duplicate receipt processing and enforce the allowed purchase-order lifecycle.
- Work-order completion must validate material requirements, consume the required components, and record finished goods in a consistent operation.
- Define behavior for partial production, cancellations, scrap, rework, and insufficient components instead of silently assuming all work orders are completed in one step.
- Support traceability from a stock movement to the originating receipt, adjustment, or manufacturing order.
- Reorder recommendations must be proposals, not automatic purchases, unless a separately authorized and audited automation policy is explicitly implemented.

AI stock forecasting

- Use validated, tenant-scoped historical data and clearly defined forecast horizons.
- Track missing data, stockouts, lead times, seasonality, and data quality where relevant.
- Clearly distinguish model predictions from recorded stock facts.
- Show the forecast period, generation time, and relevant confidence/uncertainty information when the model supports it.
- Store model/provider metadata and sufficient provenance for troubleshooting without exposing secrets.
- Require authorized human approval before converting a recommendation into a purchase order, unless an explicitly configured automation policy allows it.

Module acceptance tests: concurrent stock issue, duplicate receipt posting, partial receipt, work-order completion, insufficient components, tenant isolation, and forecast recommendation approval.

### 9.2 Oussema — Finance and Invoicing

Core entities: `Customer`, `SalesOrder`, `Invoice`, `InvoiceLine`, `Payment`, `PaymentAllocation`, `ExpenseCategory`, `Expense`, `ReceiptDocument`, `ReceiptExtraction`, `FinancialReport`.

Required behavior

- Distinguish draft, issued/posted, partially paid, paid, overdue, voided, and cancelled states according to the agreed financial lifecycle.
- Use explicit rules for when an invoice number is assigned, when it becomes immutable, and how corrections are represented.
- Do not equate issuing an invoice with receiving cash or recognizing revenue.
- Model payment-to-invoice allocation explicitly. A single payment may cover multiple invoices, and an invoice may receive multiple payments, subject to the documented business rules.
- Enforce allocation limits, currency compatibility, and payment reconciliation.
- Define treatment of refunds, credit notes, overpayments, partial payments, and rounding before declaring the financial workflow complete.
- Use decimal-safe money handling and record currency for every relevant monetary value.
- Keep expense submission, approval, and payment as distinct states/actions.
- Link expenses and invoices to the correct organization/company and authorized customer/vendor records.
- Use aggregation pipelines or suitable precomputed reporting data for large reports. State the reporting period, currency, and accounting basis used.
- Keep invoice and expense records immutable or auditable after posting; corrections must follow an explicit adjustment process.

AI receipt OCR

- Store documents privately and validate uploads.
- OCR extraction must produce a proposed result with confidence and provenance, not silently post a financial transaction.
- Require authorized review for uncertain or consequential fields.
- Treat extracted text and document content as untrusted input, including possible prompt-injection instructions.
- Do not send sensitive financial documents to an external AI provider unless the integration is approved, the data-handling implications are documented, and the organization is entitled to use it.
- Keep provider calls outside the synchronous request path when they can be performed asynchronously.

Module acceptance tests: duplicate invoice posting, multiple payment allocations, over-allocation, currency mismatch, expense approval authorization, invalid OCR output, and cross-tenant document access.

Important: basic invoicing and revenue/expense reporting do not automatically constitute legally compliant accounting. Full accounting, tax, invoice numbering, e-invoicing, and Tunisian regulatory compliance require explicit business requirements and qualified review.

### 9.3 Mohamed — HR and Payroll

Core entities: `Department`, `Employee`, `LeaveType`, `LeaveBalance`, `LeaveRequest`, `AttendanceRecord`, `PayrollPeriod`, `SalaryProfile`, `Payslip`, `PayslipLine`, `HRPolicyDocument`, `AIHRAnswer`.

Required behavior

- Keep `Employee` separate from `User`. Employees may have no login, and a user may have multiple memberships or different roles.
- Define employee identifiers, employment status, effective dates, and department relationships.
- Validate leave-request date ranges, overlap, leave type, available balance, working calendars, holidays, and approval rights.
- Decide explicitly whether pending requests reserve leave balance and when approved leave is deducted. Avoid double deductions.
- Record attendance corrections with actor, reason, timestamp, and audit history.
- Define how overtime, absences, partial days, overnight shifts, and time-zone differences are treated before presenting attendance totals as reliable.
- Create payroll periods with explicit open, processing, reviewed, approved, and finalized states as appropriate.
- Calculate payroll from controlled snapshots of the applicable salary profile, approved leave, attendance, allowances, and deductions.
- Prevent unauthorized salary access, payslip downloads, and payroll approvals.
- Protect sensitive employee information in logs, AI prompts, reports, and caches.
- Restrict export permissions and ensure downloadable reports are scoped and authorized.

AI HR assistant

- Retrieve only HR policies and records the requesting user is allowed to access.
- Use retrieval grounded in approved policy documents rather than allowing the model to invent company policy.
- Cite or identify the policy source when the interface supports it; otherwise state clearly when a supported answer cannot be found.
- Treat retrieved documents as data, not instructions that override system policies.
- Do not let AI approve leave, change employee records, or finalize payroll unless a separately authorized and reviewed workflow is implemented.
- Minimize personal data sent to providers and apply documented retention rules.

Module acceptance tests: overlapping leave, concurrent leave approvals, balance reconciliation, salary access denial, payroll snapshot integrity, HR document access, and AI prompt-injection attempts.

Important: payroll calculations must not be marketed as legally compliant until applicable Tunisian tax, social contributions, labor rules, and rounding requirements have been reviewed and validated.

### 9.4 Nesrine — Marketing and Social

Core entities: `Contact`, `ContactTag`, `ContactTagAssignment`, `ConsentRecord`, `Audience`, `AudienceMember`, `Campaign`, `CampaignTemplate`, `CampaignDelivery`, `CampaignEvent`, `SocialAccount`, `SocialPost`, `AICopyGeneration`.

Required behavior

- Establish one canonical contact identity and reuse it when CRM/sales integration is added; do not create duplicate customers for the marketing module.
- Support many-to-many contact tags with unique assignments and appropriate tenant scoping.
- Record consent by channel and purpose, with source, timestamp, and revocation history where required.
- Apply opt-outs and suppression rules before creating a send batch and again where necessary before delivery.
- Snapshot campaign recipients at a defined point so audience changes do not unexpectedly rewrite an already approved campaign.
- Separate campaign lifecycle from per-recipient delivery lifecycle.
- Make delivery jobs idempotent and deduplicate provider events.
- Use controlled retries, backoff, and provider-specific rate limits.
- Keep social account tokens encrypted and server-side. Apply the least privileges supported by each provider.
- Do not represent social publishing or SMS/email delivery as functional until the relevant provider integration is configured and tested.
- Separate content drafting, approval, scheduling, and dispatch.

AI marketing copywriter

- Generate drafts from authorized brand, audience, and campaign context.
- Label generated copy as a draft and require the agreed approval workflow.
- Do not allow generated content to bypass opt-outs, sending limits, moderation rules, or provider requirements.
- Protect against prompt injection in imported contact data and campaign content.
- Track model usage and errors without logging unnecessary personal information.

Module acceptance tests: revoked consent, duplicate recipient prevention, provider webhook replay, campaign retry, unauthorized dispatch, social token protection, and AI draft approval.

### 9.5 Fatma — Blog, Forum, and Chat

Core entities: `BlogPost`, `ContentCategory`, `ContentTag`, `BlogPostCategory`, `BlogPostTag`, `ForumTopic`, `ForumReply`, `Comment`, `ChatConversation`, `ConversationParticipant`, `ChatMessage`, `AISummary`, `AIReplySuggestion`.

Required behavior

- Define draft, review, published, archived, hidden, and deleted states where appropriate.
- Enforce publication permissions on the server; do not assume that a hidden publish button prevents unauthorized publishing.
- Use controlled relationships for categories and tags and prevent duplicate assignments.
- Implement reporting, moderation, rate limits, abuse controls, and safe deletion behavior for public or user-generated content.
- Decide whether comments use separate strongly typed collections or a polymorphic target. If a polymorphic `targetType`/`targetId` design is used, validate the target and enforce access rules in every query.
- Avoid exposing private conversations or messages through guessed IDs or public endpoints.
- Enforce conversation participant authorization on every message read, send, edit, and delete operation.
- Use a real-time transport or managed real-time service when real-time chat is a product requirement. Do not promise real-time delivery if the implementation only polls.
- Define message ordering, delivery state, reconnect behavior, retention, and duplicate-message handling.
- Treat anonymous visitors and authenticated users as distinct actor types with explicitly defined capabilities.

AI summarizer and fallback chatbot

- Apply the same tenant and participant access checks before retrieving conversation content.
- Clearly identify AI-generated summaries and reply suggestions.
- Do not send an AI reply automatically unless an explicit product policy allows it.
- Treat user-generated posts and messages as untrusted input.
- Avoid exposing private conversation content in summaries, analytics, logs, or cross-user suggestions.

Module acceptance tests: unauthorized publish, invalid comment target, moderation permissions, chat participant isolation, duplicate message submission, reconnect behavior, and AI content leakage.

## 10. AI integration architecture and safety

AI must be a shared platform capability rather than five separate implementations with different security rules, error handling, and provider configurations.

### Recommended shared AI service

Create a server-only AI service boundary with responsibilities such as:

- Provider selection and configuration.
- Request validation and task-specific authorization.
- Organization and user entitlement checks.
- Model and token/usage limits.
- Input and output validation.
- Timeouts, bounded retries, and controlled fallbacks.
- Usage tracking, cost accounting, and audit events where appropriate.
- Data minimization and provider-specific retention controls.
- Structured error handling and observability.

Possible conceptual interfaces:

```

type AIRequestContext = {
  userId: string;
  organizationId: string;
  companyId?: string;
  purpose: string;
  requestId: string;
};

type AIResult<T> = {
  data: T;
  provider: string;
  model: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
};

```

This is illustrative, not a complete implementation or a substitute for the actual repository types. Add only fields that are genuinely required and validated.

### AI execution rules

1. Authorization first. Determine whether the user may access the underlying data before constructing an AI prompt.
2. Minimize input. Send only the information needed for the task.
3. Separate instructions from data. Retrieved documents, emails, uploaded receipts, chat messages, and website content are untrusted inputs.
4. Validate output. Parse structured output against a schema and reject invalid results safely.
5. No automatic privileged actions. AI may propose an adjustment, purchase, payment, leave decision, or campaign; consequential changes must go through the normal authorization and approval workflow.
6. Control resource use. Apply per-request limits, per-user or per-organization quotas, concurrency controls, provider timeouts, and cost ceilings.
7. Make failure explicit. Distinguish provider failure, quota exhaustion, invalid output, policy denial, and task failure. Never fabricate a successful answer to hide an integration failure.
8. Avoid unsafe retries. Do not repeat expensive or consequential AI calls automatically without a deliberate idempotency and retry policy.
9. Record provenance. Where appropriate, record task type, provider/model, status, usage, latency, and related business record IDs. Keep sensitive prompt and response content out of logs by default.
10. Use background jobs for expensive tasks. Persist the job state and expose a controlled status endpoint when asynchronous execution is required.

### AI entitlement and authorization

The shared AI layer must check, at minimum:

- User authentication.
- Organization membership and active status.
- Relevant module permission.
- Company/resource scope.
- AI capability entitlement for the organization's plan.
- Task-specific permission to access the underlying records.
- Rate, usage, and cost limits.

Do not create a universal AI endpoint that accepts arbitrary collections, arbitrary database queries, or unrestricted system prompts from the client.

### AI integration status

The public portal must reflect actual implementation state:

- `Available`: implemented, integrated, permission-checked, and tested for the advertised behavior.
- `In Progress`: partially implemented or not yet complete.
- `Coming Soon`: not yet available to users.

Do not label a feature Available merely because an API route or UI mockup exists.

## 11. Shared frontend implementation standards

Production quality includes the interface, not only the API.

### Page and component rules

- Reuse the existing design system and component library.
- Keep module-specific components in their feature areas; move components into shared UI only when their responsibility is genuinely reusable.
- Use Server Components for server-rendered data where practical.
- Use Client Components for interactive forms, client-side state, and browser APIs.
- Avoid fetching the same data independently in a layout, page, and child component without a clear reason.
- Use typed DTOs and stable response schemas between the server and client.
- Avoid passing database objects or server-only secrets to Client Components.
- Use `React Hook Form` with Zod where it improves complex form validation, while ensuring server-side validation remains authoritative.
- Use optimistic updates only when failure can be handled cleanly and the operation's consistency requirements permit it.
- Provide accessible labels, keyboard navigation, visible focus states, clear error messages, and appropriate contrast.
- Implement loading, empty, error, success, and permission-denied states.
- Confirm destructive actions and communicate irreversible business transitions clearly.
- Keep sensitive HR, financial, and tenant data out of browser storage unless a narrowly justified and secure design requires it.
- Do not use local state as the authoritative source for permissions, stock quantities, payment status, or subscription state.

### Data fetching and caching

- Use server-side fetching for private workspace data when it fits the current App Router architecture.
- Set cache behavior deliberately for every tenant-specific and user-specific data path.
- Do not share cached responses across organizations or users.
- Invalidate relevant data after mutations using the established Next.js caching and revalidation strategy.
- Avoid caching sensitive information in public or shared caches.
- Use pagination, filtering, and sorting at the server for large datasets.
- Prefer server-side aggregation for analytics that would be expensive or unsafe to compute in the browser.

### Forms and mutation UX

For every consequential mutation:

1. Validate fields on the client for fast feedback.
2. Submit to a protected server entry point.
3. Revalidate the input on the server.
4. Recheck authorization and the current record state.
5. Execute the service-level use case.
6. Return a typed success or error result.
7. Refresh or revalidate the affected view.
8. Display a clear result without leaking internal details.

Client-side validation is a usability feature; it does not replace server-side validation.

## 12. Testing strategy and release gates

No module should be declared complete merely because its main screen renders or its build succeeds.

### Required test layers

Unit tests

Test domain calculations, validators, permission policies, status transitions, money handling, leave balances, stock calculations, and AI output parsers.

Integration tests

Test real MongoDB behavior, indexes, unique constraints, transaction support, repository scoping, session integration, and multi-document workflows.

Security tests

Test unauthenticated access, cross-tenant reads and writes, role escalation, company-scope violations, unsafe input, rate limiting, and private file access.

End-to-end tests

Exercise complete user workflows, including authentication, organization selection, permissions, form submission, business transitions, and error recovery.

Performance and resilience tests

Measure important API latency, database query behavior, concurrent updates, large list/report behavior, provider timeouts, retries, and background-job recovery.

### Minimum release checks

The existing scripts are not enough by themselves to prove production readiness. Add testing and type-check scripts to `package.json` as the corresponding tooling is selected and configured.

A useful baseline is:

```
npm ci
npm run lint
npx tsc --noEmit
npm run build
```

These checks must be run in the actual repository. If TypeScript validation fails due to an existing issue, document the baseline failure and show whether the new work introduced additional errors; do not simply ignore it.

Before production deployment, also require:

- Automated unit and integration tests.
- A production-like database test environment.
- Migration/index initialization verification.
- Authentication and tenant-isolation tests.
- Secret and environment configuration validation.
- Dependency vulnerability checks.
- Backup and restore verification.
- Basic monitoring and alerting.
- A rollback/recovery plan for deployments and data changes.

Do not claim that tests passed unless they were actually run and their results inspected.

## 13. Environment and configuration management

The current package list does not show a dedicated environment-schema library, so Zod can be used for server-side environment validation.

Recommended policy:

- Maintain a documented `.env.example` containing variable names and safe placeholders only.
- Validate required environment variables at server startup or in a deliberate server-only initialization boundary.
- Fail clearly when required production configuration is missing.
- Keep database URIs, NextAuth secrets, SMTP credentials, AI provider keys, storage credentials, and webhook secrets out of client bundles.
- Separate development, test, staging, and production configuration.
- Never point automated tests at production data.
- Avoid logging environment variables or complete connection strings.
- Validate external URLs and callback destinations where configuration can influence network requests.
- Define connection timeouts, pool behavior, and retry policy for external providers and MongoDB.

Do not invent actual provider credentials, production URLs, email addresses, or storage buckets. If an integration is not configured, document it as a deployment prerequisite and show a clear unavailable state.

## 14. Cross-module workflows and integration contracts

The five module owners must agree on shared interfaces before implementing workflows that cross module boundaries.

| Workflow                             | Required integration                                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Sales order → purchase/manufacturing | Sales demand may inform replenishment or production proposals; stock must not change until a valid stock transaction is posted |
| Goods receipt → inventory            | Posting a receipt produces traceable stock movements and updates the appropriate balance                                       |
| Invoice → payment                    | Payment allocation updates outstanding balances according to the finance rules                                                 |
| Employee → payroll                   | Payroll uses an approved, period-specific snapshot of relevant employee, salary, attendance, and leave data                    |
| Contact → campaign                   | Marketing uses canonical contact identity and consent-aware audience selection                                                 |
| Campaign → delivery                  | Background delivery records provider results and handles retries and duplicate events safely                                   |
| Blog/forum → chat/AI                 | Content access and AI retrieval obey the same permissions, moderation rules, and privacy boundaries                            |
| Subscription → module access         | Plan entitlements enable features, but user authorization and resource scope remain mandatory                                  |
| Any module → audit                   | Sensitive actions use the shared audit-event contract                                                                          |
| Any module → AI                      | AI calls use the shared authorization, entitlement, usage, and observability policies                                          |

### Integration rule: one owner per shared contract

Assign a single owner for each shared concern:

- Authentication and session configuration.
- Organization/company/membership model.
- Permission catalogue and policy helpers.
- Database client and index management.
- Subscription entitlement evaluation.
- API response and error conventions.
- Audit logging.
- AI provider abstraction and usage tracking.
- Shared UI primitives.

Other agents may contribute changes, but they must coordinate through the owner rather than create competing implementations.

## 15. AI-agent and engineering collaboration protocol

This is especially important when multiple agents work in parallel. Parallel work is useful only if shared files, schemas, and contracts remain consistent.

### Before implementation

Every agent must:

1. Read this specification and the relevant class diagram.
2. Inspect the repository and report the existing implementation, including related files and tests.
3. Identify which diagram entities already exist and which are missing.
4. Identify shared contracts or files that another agent owns.
5. Propose the smallest implementation plan that satisfies the requirements.
6. List the expected files, endpoints, collections, indexes, permissions, tests, and integration dependencies.
7. Flag any conflict between the diagram, current code, and actual business requirements before changing the architecture.

### During implementation

Every agent must:

- Implement one coherent domain capability at a time.
- Reuse the shared authentication, database, validation, authorization, error, and logging layers.
- Avoid unrelated refactors and broad rewrites.
- Avoid changing shared interfaces without notifying the relevant owners.
- Keep business rules in testable server-side services.
- Use actual persistence and real integrations for features marked Available.
- Avoid fake implementations, hidden fallback data, placeholder success responses, and silent error swallowing.
- Add tests for both expected behavior and failure cases.
- Update the API contract and architecture documentation when interfaces change.
- Keep commits or changes logically separated when the team workflow supports it.

### Before declaring a task complete

The agent must report:

1. What was implemented.
2. Which diagram entities and workflows were addressed.
3. Which routes, services, repositories, and collections were added or modified.
4. Which permissions and tenant checks were applied.
5. Which indexes and concurrency protections were added.
6. Which tests were added and the actual test results.
7. Lint, TypeScript, and build results.
8. Any configuration, infrastructure, or migration prerequisites.
9. Known limitations, security risks, and unfinished work.
10. Confirmation that unrelated functionality was not knowingly broken.

A task is not complete if the UI exists but the API is unimplemented, if the API exists but permissions are missing, or if the main workflow works only with mock data.

## 16. Recommended implementation order

Do not allow all five agents to independently build their entire modules from scratch at the same time. Build the shared foundations first so that their implementations can integrate without repeated rewrites.

## 1

Foundation and repository audit

First

Inspect the App Router, authentication, MongoDB connection, existing pages, styles, environment configuration, and current tests. Define shared identifiers, API conventions, and error handling.

## 2

Tenant, identity, and authorization foundation

Implement and test organizations, companies, memberships, permissions, tenant-scoped database access, and audit infrastructure. Define application and subscription entitlement contracts.

## 3

Parallel module development

Karim: Inventory & Manufacturing. Oussema: Finance. Mohamed: HR & Payroll. Nesrine: Marketing & Social. Fatma: Blog, Forum & Chat.

Begin parallel implementation only after the relevant shared contracts have been reviewed and agreed.

## 4

Integration and workflow validation

Connect shared customers, company scopes, permissions, subscriptions, audit events, and cross-module workflows. Resolve duplicate entities and inconsistent state transitions.

## 5

AI and external integrations

Add the shared AI service, document extraction, forecasting, HR assistance, marketing copy generation, and community assistance. Integrate external providers through controlled interfaces and explicit configuration.

## 6

Production hardening and release

Complete security tests, performance measurements, recovery tests, monitoring, deployment configuration, documentation, and end-to-end regression testing.

## 17. Definition of Done — mandatory acceptance checklist

Use this checklist for each feature before marking it complete.

## Feature release checklist

### 0/19

Architecture

Follows the existing Next.js App Router architecture and repository conventions

Uses shared server-side services, repositories, schemas, and error handling

Has documented API contracts and explicit domain ownership

Security

Authentication and server-side authorization are enforced

Organization and company scopes are checked on reads and writes

Input validation, safe error handling, and sensitive-data protections are implemented

Audit logging exists for required sensitive operations

Data integrity

MongoDB collection structure and required indexes are defined

Business invariants and valid state transitions are enforced

Concurrency, duplicate requests, and partial failures are handled

Money, time zones, and sensitive data follow defined storage rules

Quality

Unit and integration tests cover success and failure paths

Tenant isolation and permission-denial tests pass

Lint, TypeScript validation, and production build results are recorded

No fake data, fabricated success, or unconfigured integration is represented as production functionality

Operations

Timeouts, retries, rate limits, and observability are appropriate

Required environment variables and infrastructure are documented

Deployment, backup, recovery, and rollback requirements are understood

Known limitations and remaining work are disclosed

ResetCopy checklist

A checked item means it has been verified, not merely that an agent claims to have implemented it. A release should be blocked by unresolved critical security defects, broken tenant isolation, incorrect financial or stock invariants, or other material data-integrity failures.

## 18. Master prompt for AI coding agents

Use the following as the shared instruction for Codex, Claude Code, OpenCode, or another coding agent. Give each agent its assigned module diagram alongside this specification.

# ANOPS — MASTER ENGINEERING IMPLEMENTATION DIRECTIVE

You are a senior software architect and production-focused engineer contributing to AnOps, a multi-tenant, AI-enabled business operations SaaS platform.

## Project stack

The existing project currently uses:

- Next.js 16.4.2
- React 19.3.0
- TypeScript 5
- MongoDB Node.js Driver 6.21.0
- NextAuth.js 5 beta with MongoDB Auth Adapter
- Zod 4
- React Hook Form 7
- Tailwind CSS 4
- ESLint 9

The package.json is the current dependency baseline. Inspect the actual repository and lockfile before changing dependencies or architectural conventions.

## Primary objective

Implement the supplied class diagrams as a cohesive, secure, performant, reliable, production-oriented application—not merely as database classes, placeholder pages, mock APIs, or a university prototype.

The implementation must follow the existing Next.js architecture, integrate with shared platform contracts, enforce business invariants, and be testable and maintainable.

## Mandatory workflow

1. Inspect the repository before making changes. Read relevant routes, layouts, authentication configuration, database connection code, schemas, services, components, tests, and documentation.
2. Identify existing implementations and reuse them where appropriate. Do not duplicate existing authentication, database clients, authorization helpers, UI components, or API conventions.
3. Map the assigned diagram entities to actual persistence models, services, repositories, API contracts, UI components, indexes, and tests.
4. Document missing requirements, conflicts, assumptions, and shared-contract dependencies before making consequential architectural decisions.
5. Implement the smallest coherent vertical slice: persisted data, validated API, authorization, business rules, UI, and tests.
6. Validate the implementation and report the actual results. Do not claim success for checks that were not run.

## Architecture rules

- Follow the existing Next.js App Router conventions where applicable.
- Prefer Server Components. Use Client Components only where browser interactivity requires them.
- Keep UI, transport, application services, repositories, and infrastructure responsibilities separate.
- Keep domain rules out of presentation components and avoid large business-logic blocks in Route Handlers.
- Treat Server Actions and Route Handlers as untrusted entry points requiring validation and authorization.
- Use Zod to validate requests, route parameters, queries, environment configuration, and external-provider responses.
- Use typed DTOs rather than exposing raw MongoDB documents.
- Reuse shared error handling, logging, database connections, permission policies, and response conventions.
- Avoid circular dependencies, duplicated domain models, unnecessary abstractions, and unrelated rewrites.
- Do not expose server-only code or secrets to client bundles.

## Security and authorization

- Enforce authentication and server-side authorization for every protected operation.
- Resolve organization membership and company scope from trusted server-side data.
- Prevent cross-tenant access, insecure direct object references, role escalation, and unauthorized property updates.
- Enforce application entitlements separately from user permissions.
- Apply the same access rules to APIs, Server Actions, file downloads, reports, and AI operations.
- Never trust client-supplied user IDs, role names, company IDs, organization IDs, subscription states, prices, or stock balances.
- Use strict input validation, field allowlists, bounded pagination, rate limits, safe errors, and secure logging.
- Protect credentials, sessions, private documents, employee information, financial records, and AI provider keys.
- Do not treat hidden UI controls as security enforcement.
- Add tests proving unauthorized and cross-tenant requests are rejected.

## Database and business integrity

- Use a consistent identifier strategy and explicit tenant ownership.
- Define required MongoDB indexes through a repeatable initialization or migration process.
- Use unique indexes, atomic conditional updates, transactions, and idempotency controls where appropriate.
- Verify MongoDB transaction support in the actual deployment topology.
- Do not replace required atomic workflows with unprotected sequences of writes.
- Avoid unbounded collections and unrestricted database queries.
- Use decimal-safe financial calculations, explicit currencies, UTC timestamps, and documented business time zones.
- Enforce valid state transitions and record important actor, timestamp, and audit information.
- Define concurrency and duplicate-request behavior for consequential operations.
- Keep derived balances and reporting projections reconcilable with their authoritative records.

## API and performance requirements

- Provide explicit HTTP methods, validated input schemas, typed responses, predictable error codes, and appropriate status codes.
- Paginate growing datasets; use deterministic sorting and indexed query patterns.
- Prevent N+1 queries, unrestricted scans, unbounded regex searches, and unnecessarily large payloads.
- Reuse the database client and apply appropriate connection-pool, query, request, and provider timeouts.
- Use database-side aggregation for suitable reports.
- Cache only when freshness, invalidation, authorization, and tenant isolation are defined.
- Apply bounded concurrency and avoid unbounded retries.
- Use idempotency keys or equivalent protections for operations that must not be duplicated.
- Measure performance and fix demonstrated bottlenecks rather than making unsupported performance claims.

## Reliability and external integrations

- Handle database failures, provider timeouts, rate limits, invalid external responses, retries, and partial failures explicitly.
- Use durable background processing for long-running or scheduled tasks when required.
- Implement safe retry and deduplication behavior for jobs and webhooks.
- Use transactions, outbox patterns, or recoverable workflows for multi-step operations as appropriate.
- Do not claim that email, social publishing, AI, file storage, or other integrations are operational unless they are configured and tested.
- Document required infrastructure and environment variables without inventing credentials.
- Use structured logs and request IDs; never log secrets or unnecessary sensitive data.

## AI requirements

- Use a shared server-side AI integration layer.
- Authorize data access before constructing prompts.
- Enforce organization entitlement, module permission, company scope, rate limits, and usage limits.
- Minimize sensitive input and treat retrieved content as untrusted data.
- Validate structured AI output before use.
- Keep AI recommendations separate from authoritative business records.
- Require appropriate human approval before consequential financial, inventory, HR, or marketing actions.
- Track relevant provider, model, latency, usage, and outcome metadata without exposing secrets or logging sensitive content unnecessarily.
- Handle provider failures and invalid outputs without fabricating successful results.

## Module requirements

Follow the supplied assigned class diagram and the domain-specific rules in the master engineering specification.

- Inventory and Manufacturing: stock movements are authoritative; receipts and production completion must preserve inventory invariants.
- Finance and Invoicing: enforce invoice lifecycle, safe payment allocation, currency rules, and auditable financial adjustments.
- HR and Payroll: protect personal data and salary information; validate leave, attendance, and payroll workflows.
- Marketing and Social: enforce consent and suppression, deduplicate delivery, protect provider credentials, and separate drafting from dispatch.
- Blog, Forum, and Chat: enforce publication permissions, moderation, participant isolation, and safe AI-assisted content workflows.

Do not invent legal or accounting compliance claims. Flag requirements that need qualified review.

## Testing and completion

- Add unit tests for domain rules and validators.
- Add integration tests for database constraints, authorization, and multi-step workflows.
- Add tenant-isolation and permission-denial tests.
- Add end-to-end tests for important user journeys where the repository supports them.
- Run relevant tests, npm run lint, npx tsc --noEmit, and npm run build.
- Report actual outputs and any pre-existing failures.
- Document collections, indexes, API contracts, permissions, state transitions, configuration, deployment prerequisites, and known limitations.
- Do not mark a feature complete if its API is missing, its data is mocked, its permissions are missing, or its main workflow is not tested.

## Change discipline

Make focused, reviewable changes. Preserve unrelated functionality. Coordinate changes to shared contracts with their owners. Do not add dependencies, replace the database, rewrite authentication, or restructure the repository without a documented reason and an agreed plan.

## Required final report

Provide:

1. Repository findings and relevant existing architecture.
2. Implemented functionality and diagram entities addressed.
3. Changed files and their responsibilities.
4. API routes and contracts.
5. Database collections, indexes, and consistency protections.
6. Authorization rules and tenant-isolation measures.
7. Tests added and actual results.
8. Lint, TypeScript, and production-build results.
9. Required environment variables and infrastructure.
10. Known limitations, unresolved risks, and remaining work.

Prioritize correctness, security, performance, reliability, maintainability, and honest reporting over implementation speed or superficial feature completeness.

## Final architectural recommendation

The most important decision is to build one shared platform foundation and let all five modules use it. Without that foundation, AnOps risks having five incompatible authorization systems, inconsistent organization/company IDs, duplicated customers, unreliable subscription checks, and different interpretations of the same business rules.

With the shared contracts in place, each student can own a module independently while still producing one coherent SaaS application.