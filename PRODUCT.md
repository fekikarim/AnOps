# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

AnOps is a multi-tenant ERP for small and mid-sized companies (default currency TND, timezone Africa/Tunis). People reach it with one of four company roles: owner, admin, manager (operator) and employee (viewer). The AI Command Center serves all of them, role-aware: owners and admins who want to do routine work without opening every module, and operations staff (inventory, purchasing, production, finance, marketing, HR) who work inside the permissions their role and their company's AI grants allow. They are often between other tasks and on a phone as often as at a desk.

## Product Purpose

The AI Command Center is one workspace where an authorized person manages company operations through natural language and guided slash commands. The model interprets the request and orchestrates; deterministic AnOps services perform every read and write, so validation, authorization, tenancy and business rules are never bypassed. Success is a person completing a real task (find, change, create, approve) faster than navigating the module, with every change confirmed, attributable and auditable.

## Positioning

AI access is a company-controlled ERP capability, not a chatbot. The owner decides, per employee, whether AI is available and which modules and operations (view, create, edit, delete, approve) it may use. AI access is always a subset of the employee's existing AnOps permissions. Conversations are private to the employee; company-wide transcript auditing is a separate, explicit, audited permission.

## Operating Context

- Tenant boundary is the company. The active company, user, role and permissions are resolved server-side on every request; nothing is taken from the client.
- Existing modules with real backends: Inventory, Purchasing, Manufacturing, Finance, Marketing, HR, Community and Company. CRM and Sales are placeholders; Projects, Documents and Administration have no routes. The Command Center must never claim support for modules or operations that do not exist.
- AI providers: Groq (rotating `GROQ_API_KEYS`) with OpenRouter and Gemini fallbacks through `@/server/ai`. The provider layer has no native tool calling.
- Every AI-made write is proposed, shown for confirmation, then executed by the existing service. Destructive and financial actions get stronger confirmation.

## Capabilities and Constraints

- Language: English interface copy; the assistant understands and answers in French when the user writes French.
- Confirm every write. Destructive and financial writes require stronger confirmation (typed record name, exact amounts).
- Owner AI access is on by default once the company enables AI; all other members are off until explicitly granted. Only owners can manage other administrators' AI grants.
- Transcript auditing needs an explicit permission, including for owners; it is read-only, audited, and the affected employee is notified.
- Conversation retention defaults to 90 days, configurable per company. Departed employees' conversations are kept until the retention period expires, subject to applicable deletion requirements.
- Per-user token caps and company-wide usage limits are part of the foundation.
- HR and salary information require separate sensitive-data permissions, disabled by default.
- Permission changes and revocations take effect immediately, including during open conversations and pending actions.
- Open, not yet decided: whether low-risk writes may ever skip confirmation (currently no); the production shared store for rate limits.

## Brand Commitments

Preserve the existing AnOps identity: forest-dark and warm-paper surfaces, lime primary action, Manrope headings and Inter UI text, light and dark themes, and the dashboard conventions in `docs/layout-rules.md`.

## Evidence on Hand

- Working services and permission catalogue in `src/server/**`, `src/server/security/permissions.ts`.
- Design tokens in `src/app/globals.css`; shared UI in `src/shared/components/**`.
- An HR assistant (`src/features/hr/ai/`) and `agent-chat-panel.tsx` as the existing AI pattern.
- No real customer testimonials, usage data or benchmarks exist; none may be invented.

## Product Principles

1. The model proposes; deterministic services decide and execute.
2. Access is the intersection of what the company granted for AI and what the person's role already allows, checked live on every request.
3. Every consequential action is visible before it happens and attributable after.
4. Privacy by default: a person's conversations belong to them.
5. Structured, scannable results over chat prose; the same workspace works on a phone and at a desk.

## Accessibility & Inclusion

Keyboard-operable throughout (command palette, tables, confirmation dialogs), screen-reader-correct live regions for streamed replies, `prefers-reduced-motion` respected, and WCAG AA contrast in both themes.
