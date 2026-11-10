# Inventory, Purchasing & Manufacturing — implementation notes

Scope: the Karim module from `uml-diagrams/DIAGRAMS.md`, implemented as server services with
Server Action transport and App Router pages. AI forecasting and reorder recommendations are
**not implemented** (see Limitations).

## Foundation decisions

- **No organization/company model existed.** The smallest compatible abstraction was added:
  `organizations`, `companies`, `memberships` (role: owner | admin | operator | viewer).
  A user with no active membership gets a personal organization, one company (currency TND,
  timezone Africa/Tunis) and an owner membership (`server/tenancy/workspace.ts`).
  Organization switching, invitations and a membership management UI do not exist yet.
- **Tenant context is server-resolved only.** `resolveWorkspace()` reads the verified session,
  re-checks the live user status, and loads the membership. Every service query filters on
  `organizationId` and `companyId`. Cross-tenant IDs return NOT_FOUND (tested).
- **Permissions** live in `server/security/permissions.ts`. Services assert them, so a hidden
  button is never the only control.
- **Application entitlement / subscriptions are not enforced** — the Application, Plan and
  Subscription collections do not exist. This is a prerequisite for commercial release.
- **Fixed-point numbers.** Quantities are integer micro-units (1e-6), money is integer
  milli-units (1e-3). Line totals use BigInt with half-away-from-zero rounding
  (`shared/lib/fixed-point.ts`). Floating point is never used for stored or summed values.
- **Errors:** `AppError` with a stable code (`server/shared/lib/errors.ts`); actions return
  `{ ok, data } | { ok: false, error: { code, message, requestId, details } }`. Unexpected
  errors are logged by name only and returned as a generic INTERNAL message.

## Stock model

- `inventory_stock_movements` is the append-only ledger. Documents are never updated or deleted.
- `inventory_stock_balances` is a projection. Only `server/inventory/stock-ledger.ts` writes it,
  and only inside a transaction that also writes the movement (`applyLedgerEntries` refuses to
  run without a session in a transaction).
- **Negative stock policy:** issues use a conditional update (`onHandMicro >= quantity`).
  Concurrent issues cannot both take the last units (tested).
- **Valuation:** on-hand × current standard cost. No FIFO/average costing.
- **Reservations:** not implemented. Available = on hand.
- **Adjustments** require a reason and `inventory.stock.adjust` (owner/admin). No second-person
  approval flow yet.

## Purchasing

- States: draft → approved → partially_received → received; draft/approved → cancelled
  (approved only with nothing received). Transitions are central in
  `server/purchasing/order-state.ts`, and every update repeats the source status and version in its filter.
- Approval never changes stock. Stock increases only on **posting a goods receipt**.
- Posting runs in one transaction: receipt status draft→posted (conditional), order line
  quantities and status (version-checked), ledger entries, and audit. Double posting and
  over-receipt races are tested. Over-receipt is rejected (no policy to allow it).
- PO lines are embedded (bounded to 100 lines); receipts are a separate collection.

## Manufacturing

- BOM revisions per finished product. Only drafts are editable. Activating a revision archives
  the previous active one (partial unique index enforces one active per product).
- Nested BOMs are **not supported**; every component is a stored item.
- Work orders snapshot the BOM components at creation (a later BOM change does not affect them).
- Lifecycle: draft → in_progress (start) → completed; cancel from draft or in_progress.
  **Components are consumed at completion**, not at start. Completion is one transaction:
  component issues, finished-goods receipt, status (conditional on in_progress + version), and
  audit. Insufficient components abort everything (tested).
- Partial production, scrap and rework are not supported; produced quantity equals planned.

## Collections and indexes

Collections: `organizations`, `companies`, `memberships`, `audit_events`, `counters`,
`inventory_categories`, `inventory_products`, `inventory_warehouses`, `inventory_stock_balances`,
`inventory_stock_movements`, `purchase_suppliers`, `purchase_orders`, `goods_receipts`,
`manufacturing_boms`, `manufacturing_work_orders`.

Indexes are defined in `server/db/indexes.ts` and created idempotently on first use per database.
Key uniqueness: SKU per company, warehouse code per company, supplier name per company, PO and
receipt and work-order numbers per company, one balance per (product, warehouse), one active BOM
per finished product, one personal membership per user.

## Concurrency and idempotency

- **Replica set (production):** multi-document operations run in a majority-committed transaction and are fully atomic.
- **Standalone server (development):** no transactions exist, so each operation runs as an ordered sequence of
  writes, and each write registers an undo step. If the operation fails, the undo steps run newest-first
  (`server/db/transactions.ts`). This covers ordinary errors such as insufficient stock, version conflicts and
  failed audit writes. It does **not** cover a process crash in the middle of an operation, so a standalone
  deployment can be left partially updated after a crash. Use a replica set for any shared or production data.
- Work-order completion and receipt posting claim the order or receipt first with a version-checked conditional
  update, so duplicate requests fail before any stock moves on either topology.
- Conditional updates, version fields, and unique indexes guard every state change.
- Rate limits (in-memory, per instance) apply to stock moves and to receipt posting and
  work-order completion. A shared store is needed for multi-instance deployments.

## Testing

- `npm test` — 5 unit files (fixed-point, state machines, permissions, schemas, rate limit)
  and 3 integration files against a local replica set (`MONGODB_TEST_URI`, default
  `mongodb://127.0.0.1:27018/?replicaSet=rs0&directConnection=true`). Integration tests use a
  throwaway database per file and drop it afterward. Do not point them at real data.

## Limitations (explicit)

- No AI forecasting or reorder recommendations.
- No subscriptions/entitlements, membership management UI, or organization switching.
- No product/supplier attachments, no reporting exports, no sales integration.
- Pagination is page-based (bounded at 25 per page; page ≤ 1000), not keyset.
- Product search is anchored prefix only (name or SKU).
- Stock value and low-stock figures in the overview read every active storable product's balance.
  This is bounded by catalogue size and is not optimised.
- Performance has not been measured under load.

## Environment

Uses existing `MONGODB_URI` and `AUTH_SECRET`. The module requires a MongoDB **replica set**
for stock, purchasing and manufacturing writes. Build with `NODE_ENV` unset or `production`;
a shell-level `NODE_ENV=development` makes `next build` fail while prerendering existing pages.
