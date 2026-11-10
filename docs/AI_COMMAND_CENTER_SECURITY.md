# AnOps AI Command Center: security model

Describes implemented behaviour.

## 1. Principles

1. The model supplies nothing that decides who, where or what is allowed. Company, user and permissions come from the server-resolved workspace. Tool inputs cannot contain identity fields (enforced when the registry is built).
2. Reads and writes use the module's own services, which assert their own permission. A tool's `permission` is checked again at the tool boundary.
3. Nothing changes without a person confirming a server-built summary.
4. Access is re-resolved from the database at every step: before each tool call, at proposal, at confirmation, and by the service.
5. Retrieved text is data. It never authorizes anything.

## 2. Access = grant AND role ceiling

Effective access = what the company granted this member for AI (module x operation: view, create, edit, delete, approve) AND what the member's role already permits. `access/capabilities.ts` holds the ceiling. A grant cell above the ceiling cannot be saved. Highlights:

| Module | view | create / edit | delete | approve |
|---|---|---|---|---|
| Inventory | inventory.read | product manage | product manage | stock adjust |
| Purchasing | read | order manage | order manage | order approve |
| Manufacturing | read | work-order manage | work-order manage | work-order execute |
| Finance | read | invoice manage | customer manage | expense approve |
| Marketing | read | contact manage | marketing.admin (owner/admin) | marketing.admin |
| HR | read | hr.admin (owner/admin) | hr.admin | hr.admin |
| Community | read | community.write | community.admin (owner/admin) | community.admin |

Company roles map to workspace roles: owner, admin, operator (company manager), viewer (company employee). Employees are read-only everywhere except starting their own support chat.

Switches that sit above the grant: the platform kill switch (`AI_KILL_SWITCH`), the company switch, and per-member `canViewSensitiveHr` and `canAuditTranscripts` (owner-controlled).

## 3. Tenant isolation

- All AI data goes through `data/scope.ts`; every query carries the company, private collections also the user. A test fails if any other file opens an AI collection.
- Pending actions and conversations belong to one member of one company. Another member, or another company, gets "not found".
- Usage and rate-limit keys include the company.
- Module services take a `WorkspaceContext` and filter by `companyId`. Community was brought to that standard in Phase 6.

## 4. Sensitive data

- **HR payroll and payslips:** four tools are flagged `sensitive: "hr"` and need the member's sensitive-HR switch. The legacy HR assistant puts salary, daily rate and deductions in its prompt only for such members. Cards that show payroll data are shown live but stored in history as "HR data was shown here. It is not kept in conversation history."
- **Marketing contacts:** emails and phones are masked before they reach the model or any result; full values only for members with contact-manage permission and only on request. AI cannot grant, withdraw or invent consent.
- **Community chat:** visitor emails are always masked; emails and phone numbers typed into chat text are masked before they reach the model or the result (dates and times are preserved). A chat is visible only to support agents and the person who started it. The sender role of a message is decided by the server; clients cannot post as the bot or the system.
- **Secrets:** provider keys are read server-side only. Provider error text is never returned to the browser; logs record error names only.

## 4a. Prompt injection

Tool results are fenced as untrusted data (`sanitize.wrapUntrusted`), size-capped and stripped of tags that could close the fence. Writes created from a chat request become editable drafts or proposals; the person sees a summary the server built. An instruction inside a record cannot reach a write tool without the person confirming, and cannot widen the member's permissions: the tool call is validated against live access. Chat-written text that claims a change was made, with no proposal behind it, is replaced by a refusal.

## 5. Transcript audit (conversation privacy exception)

Only an owner or administrator who holds the audit switch on their own grant can read another member's conversations; an administrator cannot read an owner's or another administrator's. A written reason is required, an audit event is written and the person is notified BEFORE content is returned. Read-only.

## 6. Audit trail

`audit_events` carries: `ai.action.proposed`, `ai.action.executed`, `ai.action.blocked`, `ai.action.failed`, `ai.action.unknown_outcome`, `ai.settings.updated`, `ai.access.updated`, `ai.transcript.listed`, `ai.transcript.accessed`, plus each module service's own business events (for example `community.post.published`). Metadata is tool name, module, risk, conversation id, error code: no arguments and no content.

## 7. Marketing send safety (unchanged, verified)

One allowlist check in the dispatch engine covers email, SMS and Telegram. When `MARKETING_SEND_ALLOWLIST` is set only listed destinations receive anything. When unset, delivery is allowed only in production. AI scheduling is refused unless an allowlist is active or the deployment is production. There is no send-now.

## 8. Known limitations

See the architecture document, section 10, and the operations document for recovery steps.
