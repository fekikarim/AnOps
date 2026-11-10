---
name: nextjs-crud-security
description: Design, implement, or audit the security of CRUD operations in Next.js App Router applications, including Server Actions, Route Handlers, authorization, tenant isolation, validation, safe database access, secrets, and error responses. Use alongside the production CRUD skill or independently for CRUD security work.
---

# Secure CRUD Boundaries for Next.js

## Goal

Make every CRUD read and mutation secure at the actual server-side trust boundary. This skill supplements the main `nextjs-production-crud` skill and can also be used to audit an existing feature.

## 1. Threat model every entry point

Inventory all ways data can be read or changed:
- Server Actions / Server Functions.
- Route Handlers.
- Server-side service functions called by those entry points.
- Legacy Pages Router API routes, if present.
- Webhooks or background jobs that mutate the same records.
- Client components that call external backend APIs.

Treat all client-originating values as untrusted, even when TypeScript types appear correct. TypeScript does not validate runtime input.

## 2. Authentication and authorization

- Use the repository's existing trusted authentication implementation.
- Verify identity on the server for every protected operation.
- Authorize the specific action, resource, and scope; authentication alone is insufficient.
- Enforce least privilege.
- Recheck permissions in each Server Action and Route Handler. Do not assume that hiding a UI control, protecting a page, or using middleware is enough.
- Enforce ownership, organization, workspace, or tenant scope in data queries and mutations.
- Do not trust client-provided `userId`, `tenantId`, `ownerId`, `role`, `isAdmin`, or permission flags.
- Do not allow users to change server-managed fields by submitting extra properties.
- Return safe unauthorized/forbidden results according to the app's conventions. Avoid leaking whether a sensitive record exists when policy requires concealment.
- For sensitive actions, consider re-authentication or step-up controls if the existing product requires them.

## 3. Validation and normalization

Use the project's existing runtime validation library (for example, Zod if already installed). Define schemas at the server boundary.

Validate:
- Request body type and shape.
- Required fields and optional/null semantics.
- String lengths, trimming, allowed characters, and normalization.
- Numeric ranges and finite values.
- Enum values.
- Date/time formats and business constraints.
- IDs and route parameters.
- Relationship references and access to referenced records.
- Query parameters, pagination bounds, sort fields, filter operators, and search lengths.
- File metadata and file content where uploads exist.

Use allowlists for mutable fields. Avoid mass assignment by parsing only permitted fields into a dedicated DTO. Never pass an arbitrary request object directly into an ORM update/create operation.

Client validation is for usability; server validation is mandatory. Database constraints must enforce invariants that must survive concurrent requests.

## 4. Database safety

- Use parameterized queries or the ORM's safe query API.
- Never concatenate user input into SQL or raw query identifiers.
- Whitelist sort keys and query operators.
- Enforce tenant/ownership constraints in the query itself.
- Use transactions for multi-record changes that must be atomic.
- Handle unique constraints and foreign-key conflicts as expected domain outcomes.
- Avoid time-of-check/time-of-use vulnerabilities by combining scope conditions with the mutation where feasible.
- Do not reveal raw SQL, schema names, constraint details, or driver messages to clients.
- Do not add broad database privileges merely to make a feature work.

## 5. CSRF, cookies, CORS, and request origin

Use the framework's current protections and the existing authentication architecture. Do not assume that a Server Action or custom API is automatically safe in every deployment configuration.

- Review the current Next.js guidance for Server Actions and allowed origins when the app uses proxies or multiple domains.
- For cookie-authenticated custom mutation endpoints, assess CSRF and Origin/Referer validation requirements.
- Configure CORS narrowly when cross-origin browser access is genuinely required. Do not use wildcard origins with credentials.
- Use secure cookie settings appropriate to the deployment (`HttpOnly`, `Secure` in HTTPS production, appropriate `SameSite`, path, and expiry).
- Do not invent a custom token scheme when the existing auth library already provides the required protection.
- Validate webhook signatures for webhook endpoints and prevent replay where relevant.

## 6. Rate limiting and abuse controls

Assess the risk and expected traffic for public or sensitive endpoints. Apply the project's existing rate limiter or infrastructure controls where appropriate, especially for:
- Public create endpoints.
- Login-adjacent or invitation flows.
- Expensive searches/exports.
- Bulk operations.
- Resource-intensive mutations.
- Uploads and external-service calls.

Do not implement an in-memory-only rate limiter as if it were reliable across multiple serverless instances. Use a shared backing service when distributed enforcement is required.

## 7. Secrets and output safety

- Keep secrets server-only; never use `NEXT_PUBLIC_` for private credentials.
- Never return credentials, hashes, tokens, internal notes, or sensitive fields unless explicitly required and authorized.
- Avoid rendering untrusted HTML. If rich HTML is a product requirement, use a vetted sanitization approach.
- Do not log passwords, session tokens, authorization headers, full sensitive payloads, or unnecessary personal data.
- Return safe messages and a correlation/request ID when the project supports it.
- Keep detailed diagnostic errors server-side.

## 8. Safe error mapping

Expected errors should map to predictable results:
- Invalid input → validation response/state.
- Unauthenticated → authentication-required response/redirect according to context.
- Unauthorized → forbidden response or deliberate not-found behavior.
- Missing resource → not found.
- Duplicate/unique conflict → conflict or field-level validation error.
- Invalid relationship/state transition → domain validation error or conflict.
- Rate limited → rate-limit response with appropriate retry information.
- Unexpected failure → generic safe response, server-side logging, and correlation ID if available.

Do not catch every error and return success. Do not return raw `error.message` to an untrusted client. Preserve framework control-flow signals such as redirects/not-found when the chosen architecture requires them; do not accidentally swallow them in broad catch blocks.

## 9. Secure caching

- Understand the project's Next.js caching strategy and version-specific behavior.
- Do not cache personalized data in a shared cache without a correct user/tenant cache key and explicit security review.
- Do not assume a server-side read is safe to cache merely because it is rendered in a Server Component.
- Revalidate only the appropriate paths/tags after successful mutations.
- Ensure authorization is checked even if data was previously loaded or a page is prefetched.

## 10. Security verification checklist

Test at least:
- Anonymous access to protected reads and writes.
- Authenticated user without the required role.
- User A attempting to read/update/delete User B's record.
- Cross-tenant/organization ID substitution.
- Extra privileged fields in create/update payloads.
- Invalid IDs and malformed payloads.
- Oversized strings and invalid query parameters.
- Duplicate values and database constraint conflicts.
- SQL/NoSQL injection-shaped input.
- Missing or inaccessible related records.
- Safe error responses without stack traces/secrets.
- CSRF/origin and CORS behavior when applicable.
- Rate limiting for endpoints that need it.

Never call a feature secure solely because TypeScript compiles or the UI hides unauthorized actions.
