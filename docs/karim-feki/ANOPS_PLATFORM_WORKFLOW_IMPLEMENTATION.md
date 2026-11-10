# AnOps — Complete Platform Workflow, Organization & Subscription Architecture

**Project:** AnOps — AI-Native Business Operating Platform  
**Scope:** Complete user lifecycle, onboarding, organization management, subscriptions, billing, application entitlements, and application navigation.

---

# 1. Mission & Architecture

Transform AnOps into a complete, professional, organization-centric SaaS platform with a seamless experience from the first public-portal visit to account creation, organization activation, application usage, team management, and subscription management.

The objective is to establish a coherent business operating ecosystem rather than simply another collection of ERP applications.

AnOps must provide:
- Frictionless account creation.
- Intelligent application selection.
- Organization-based workspaces.
- Clear application and AI entitlements.
- Flexible subscription management.
- Secure team invitations and role management.
- Professional owner and employee profiles.
- Centralized organization settings.
- Seamless navigation between applications.
- Reliable payment and subscription lifecycle management.

**Important:** This is an implementation task. Inspect the existing architecture and reuse existing functionality wherever possible. Do not replace working authentication, authorization, database, or application logic without a technical reason.

Preserve the existing AnOps identity and technology stack. Verify actual dependencies and architecture before making changes.

# 2. Application Inventory

The current AnOps ecosystem contains these 11 applications:

1. AnOps AI
2. Company
3. HR & Payroll
4. CRM
5. Sales
6. Finance
7. Inventory
8. Purchasing
9. Manufacturing
10. Marketing
11. Blogs & Community

Inspect each application's implementation and establish its actual functionality, routes, dependencies, and permission requirements.

The application inventory must be centralized and reusable throughout onboarding, subscription management, organization settings, and the main workspace.

Do not duplicate application definitions across multiple components.

# 3. Public Portal — Sign In & Try It Free

The public portal must provide two clear primary actions:

- Sign In → existing authentication flow.
- Try It Free → `/trial`.

The entire registration experience must be responsive, modern, intuitive, and consistent with the AnOps public identity.

# 4. Trial Application Selection — `/trial`

Create a premium application-selection experience.

**Suggested headline:**

"Your business. Your applications. Your way."

Supporting message:

"Get started instantly. No credit card required. Choose the applications that fit your business."

Display all 11 applications with:
- Application name.
- Animated icon from the existing assets where appropriate.
- Concise description.
- Main capabilities.
- Selection control.
- Selected/unselected visual states.

## Selection rules

There are two distinct possibilities:

**Option A — One application**

Selecting exactly one application grants:

- One permanently free application.
- Unlimited organization users.
- No expiration.
- No credit card requirement.
- No AI-powered premium features.

This is the permanent free entitlement, not a temporary trial.

**Option B — Multiple applications**

Selecting two or three applications activates:

- 15-day free trial.
- No credit card required.
- Access to all selected applications during the trial.
- Maximum three applications.
- Trial countdown associated with the organization.

The user must be allowed to select a maximum of three applications.

When three are selected:
- Disable the remaining unselected application cards.
- Clearly communicate the selection limit.
- Explain that the user can start a 15-day trial or create an account and upgrade to a suitable paid plan.

Do not silently remove previously selected applications.

## Persistent selection summary

Implement an attractive sticky/floating selection summary that follows the user while browsing.

It must dynamically display:
- Selected application icons and names.
- Number of selected applications.
- Applicable access type.
- Permanent Free or 15-day Trial status.
- A clear explanation of what the selection means.
- Continue button.

Update the summary immediately after every selection change.

Persist the selection safely between `/trial` and account creation. Validate it again on the server; never trust client-submitted application entitlements.

# 5. Account Creation — Get Started

After selecting applications, navigate to a dedicated account creation page.

Build a clean, professional, carefully structured form.

## Required registration information

- First name.
- Last name.
- Organization / website name.
- Email address.
- Phone number.
- Preferred organization currency.

Use the existing authentication strategy and password/security requirements. Do not weaken existing authentication to simplify registration.

## Information intentionally deferred

Do NOT force the user to complete these fields during registration:

- Industry sector.
- Company size.
- Primary business interest.

These fields should belong to the organization owner's profile or organization profile as appropriate.

They can be completed later through the owner profile and organization settings.

## Progressive profile completion

Introduce a sophisticated profile-completion experience.

Requirements:
- A visible completion percentage or progress bar.
- Clearly indicate missing optional information.
- Explain how completing the profile improves the AnOps experience.
- Provide shortcuts to complete missing information.
- Allow users to skip optional fields.
- Update completion progress dynamically.

Never block application usage because optional profile fields are incomplete.

# 6. Account & Organization Creation

After successful registration:

1. Create the owner account.
2. Create the organization.
3. Associate the owner with the organization.
4. Assign the organization owner role.
5. Apply the selected application entitlements.
6. Initialize the correct Free or Trial subscription state.
7. Create the organization workspace.
8. Establish a valid authenticated session.
9. Redirect the owner to `/anops`.

The operation must be reliable and transactional where supported.

Prevent duplicate accounts, duplicate organizations, inconsistent entitlements, and partially created workspaces.

The owner should not be blocked by mandatory email verification before accessing the newly created workspace.

# 7. Welcome Experience & Main Workspace — `/anops`

After account creation, display an elegant, animated welcome experience.

Example:

"Welcome to AnOps."

"Your workspace is ready. One connected ecosystem. Endless possibilities."

Introduce the organization and selected applications with a polished transition into the workspace.

## Main workspace design

Build `/anops` as a desktop-inspired application home screen.

Desktop:
- Elegant application grid.
- Organized application icons.
- Application names and short descriptions.
- Smooth hover and launch interactions.
- Beautiful visual hierarchy.
- Floating Dock at the bottom.

The Dock must contain:
- Organization avatar.
- User profile avatar.
- Settings shortcut.

Use the Dock for global navigation and account/organization access, not as a replacement for application navigation.

Mobile:
- An iOS-inspired home screen.
- Responsive application grid.
- Floating bottom Dock.
- Touch-friendly interactions.
- Safe-area-aware layouts.
- Smooth navigation and transitions.

Both experiences must share the same identity and functionality.

Only applications granted to the active organization may appear as installed applications.

Do not allow navigation to unauthorized application routes simply by entering their URLs manually.

# 8. Email Activation — Post-Registration

Email verification must happen AFTER successful account and organization creation, not before.

Once the owner enters `/anops`, display a clear, stacked activation warning dialog.

Suggested content:

"Activate your organization"

"We've sent an activation email to your registered address. Your organization and its data are temporarily reserved for 12 hours. Activate your account before this period expires."

Include:
- Resend activation email.
- Destination email address.
- Remaining activation time.
- Clear activation instructions.
- Link to organization management.

The activation link should navigate to the correct organization activation flow.

## Activation security

Implement:
- Cryptographically secure, single-use activation tokens.
- Hashed token storage.
- Expiration timestamps.
- Token invalidation after use.
- Resend cooldown and rate limiting.
- Protection against token enumeration.
- Secure email links.
- Server-side verification.

Do not expose sensitive organization identifiers or authentication secrets in activation URLs.

## 12-hour expiration

If activation is not completed within 12 hours:

- Mark the pending organization as expired.
- Revoke pending activation tokens and sessions as appropriate.
- Automatically remove the unactivated organization and its associated provisional data.
- Prevent access to expired workspace data.
- Record the cleanup event in the appropriate audit system.

Implement expiration using a reliable scheduled/background cleanup mechanism, not frontend timers.

The cleanup must be idempotent and safe against concurrent execution.

Respect applicable legal retention requirements for payment, security, and audit records. Do not delete legally required records merely to satisfy workspace cleanup.

A successful activation must permanently prevent the pending-account cleanup process from deleting the organization.

# 9. Organization Activation & Onboarding

When the owner clicks the activation link:

1. Validate the token.
2. Activate the owner account.
3. Activate the organization.
4. Establish the organization's active status.
5. Redirect to an elegant onboarding experience.

Create a polished multi-screen onboarding flow.

## Screen 1 — Organization successfully activated

Display a memorable confirmation:

"Your organization is ready!"

"Welcome to your new business workspace. Let's build something great with AnOps."

Show the organization name and selected applications.

Use a smooth transition into the next step.

## Screen 2 — Invite colleagues

Allow the owner to invite employees immediately.

Include:
- One or multiple email inputs.
- Add/remove invitation rows.
- Appropriate role selection.
- Invitation validation.
- Send invitations.
- Skip for now.

Employees must receive secure invitation links.

Invitation tokens must expire, be single-use, and be associated with the correct organization and assigned role.

Allow the owner to manage invitations later.

After onboarding, return the owner to `/anops`.

# 10. Organization Management — `/organization/[orgId]`

Create a complete organization-management experience.

This is a major part of AnOps and must not be treated as a simple settings page.

Build an organized organization dashboard with the following sections:

## A. Organization Overview

- Organization name and logo/avatar.
- Website.
- Industry sector.
- Company size.
- Primary business interest.
- Country and address where applicable.
- Contact information.
- Preferred currency.
- Organization creation date.
- Activation and account status.
- Profile completion.

Allow authorized owners/admins to update appropriate information.

## B. Members & Access Management

Provide a complete employee management interface.

Include:
- Member directory.
- Invitations and pending invitations.
- Member details.
- Roles and permissions.
- Application access.
- AI access.
- Account status.
- Join dates.
- Last activity where supported.
- Remove/suspend member actions.
- Resend/cancel invitations.

Implement role management through the existing RBAC architecture.

The organization owner must retain full ownership and cannot accidentally remove their own last owner privileges.

Never trust client-side role selection or access controls.

## C. Subscription & Billing

Display:
- Current plan.
- Current applications and entitlements.
- Trial status and remaining days.
- Subscription start and expiration dates.
- Billing history.
- Invoices and payment receipts.
- Payment status.
- Upgrade/downgrade options.
- Subscription cancellation.
- Billing contact information.

## D. Organization Settings

Include appropriate sections for:
- Organization profile.
- Regional settings and currency.
- Security.
- Members and roles.
- Application access.
- AI permissions.
- Integrations.
- Notifications.
- Audit logs.
- Subscription and billing.

Only expose actions permitted by the user's role.

# 11. Owner Profile & Employee Profiles

Create a dedicated, professional profile experience.

## Owner profile

Include:
- Profile avatar.
- First and last name.
- Email.
- Phone number.
- Position/title where applicable.
- Preferred language.
- Personal preferences.
- Profile completion.
- Security and authentication settings.
- Active organization.
- Notification preferences.

The owner should be able to edit personal information independently of organization information.

## Employee profile

Include:
- Personal details.
- Organization membership.
- Assigned role.
- Application permissions.
- AI permissions.
- Invitation/account status.
- Relevant activity information.

Users must only access information permitted by their role.

Keep personal account settings separate from organization-level settings.

# 12. Subscription Architecture

AnOps must use a centralized subscription and entitlement architecture.

The four main subscription plans are:

## OneOps

- Access to one application only.
- Application selected during the initial free registration becomes the permanently free application.
- Unlimited users.
- No AI-powered premium features.
- No expiration for the permanent free entitlement.

The permanently free application is a one-time selection and cannot be changed after it is established.

## AllOps

- Access to all 11 applications.
- Unlimited users.
- No AI-powered premium features.
- Centralized organization workspace.

## MaxOps

- Access to all 11 applications.
- Unlimited users.
- All included AI capabilities.
- Access to the complete AnOps AI ecosystem.
- Advanced AI capabilities and features included in the plan.

## Custom

- Access to a configurable selection of multiple applications.
- More than one application but fewer than the complete application catalog.
- Unlimited users unless a verified business rule requires otherwise.
- Lower overall price than AllOps.
- No included premium AI capabilities by default; define any optional AI add-ons explicitly.

Custom must be configurable according to the organization's needs.

## Important entitlement distinction

Do not confuse the AnOps AI application with AI-powered features inside other applications.

Model these separately:

1. Application access.
2. AI feature access.
3. Organization-level AI enablement.
4. Individual employee AI permissions.
5. Role-based permissions.

The effective AI permission must respect the intersection of subscription entitlements, organization settings, employee grants, and RBAC.

Never grant premium AI access to OneOps or AllOps customers.

# 13. Pricing Research & Strategy

Do not invent arbitrary prices.

Conduct current market research before implementing final pricing.

Research relevant competitors and SaaS/ERP pricing models, including:
- Odoo.
- Zoho.
- ERPNext and comparable alternatives.
- Other relevant modular business platforms.

Compare:
- Per-user pricing.
- Per-organization pricing.
- Application-based pricing.
- AI feature pricing.
- Free-tier restrictions.
- Enterprise/custom pricing.

Consider AnOps' unlimited-user model, target organizations, feature scope, infrastructure costs, and positioning.

Develop a competitive pricing proposal for:
- OneOps.
- AllOps.
- MaxOps.
- Custom.

Requirements:
- Transparent and understandable pricing.
- Attractive entry-level pricing.
- Clear differentiation between plans.
- Sustainable margins.
- A meaningful economic advantage for selecting AllOps over several separate applications.
- Custom pricing that remains below AllOps for a smaller application selection.

Research international pricing and consider Tunisia and international customers, with suitable currency and localization support.

Provide sources, dates, assumptions, and a pricing comparison in the implementation roadmap or a separate research document.

Do not silently change prices after implementation.

Do not invent market research results or claim that AnOps is cheaper than a competitor without comparable evidence.

# 14. Trial Expiration & Subscription Lifecycle

A 15-day trial must have a reliable server-side lifecycle.

Track:
- Trial start.
- Trial expiration.
- Selected applications.
- Organization.
- Trial status.
- Conversion to paid subscription.

When the trial expires without a paid upgrade:

1. Block access to trial-only applications.
2. Redirect the owner to the subscription selection page.
3. Explain that the free trial has expired.
4. Present available subscription options.
5. Preserve organization data and configuration.
6. Allow upgrading to AllOps, MaxOps, or Custom.

## Permanent free fallback

The organization must retain the ability to choose OneOps.

However:
- It must retain only the single application selected during the initial free registration.
- The selection cannot be changed.
- This free entitlement is permanent and one-time.
- Previously selected trial applications must not automatically remain accessible.

If the owner purchases a paid plan, normal paid entitlements apply.

If a paid subscription later expires or is cancelled:
- Handle access according to the subscription's actual billing and cancellation status.
- Preserve organization data.
- Provide an appropriate grace period where justified.
- Require the owner to select a valid subscription or explicitly fall back to the eligible OneOps free entitlement.
- Never silently delete business data.

Avoid redirect loops. Provide a centralized entitlement-aware route guard with appropriate exceptions for billing, account settings, and activation flows.

# 15. Stripe Payment Integration

Integrate Stripe using the existing `STRIPE_API_KEY` environment configuration.

First inspect existing Stripe code, dependencies, environment variables, and payment-related models.

Implement secure server-side payment operations.

Requirements:
- Stripe Checkout for paid subscription creation.
- Stripe Customer associated with the organization.
- Stripe subscription lifecycle synchronization.
- Secure webhook endpoint.
- Webhook signature verification.
- Idempotent webhook processing.
- Checkout success and cancellation handling.
- Subscription upgrades and downgrades.
- Cancellation and renewal.
- Payment failures.
- Subscription expiration.
- Invoice history.
- Billing portal where appropriate.

Never expose Stripe secret keys to the browser.

Never trust a frontend success redirect as proof of payment.

The authoritative subscription status must be synchronized and verified server-side through Stripe events and reliable reconciliation.

Use appropriate test-mode configuration during development.

Do not assume that having `STRIPE_API_KEY` alone is sufficient. Verify the required Stripe configuration and document missing environment variables without printing secret values.

# 16. Application Navigation & Management Layout

Preserve the existing management dashboard design wherever possible.

The key change is how users navigate within and between applications.

Currently, each management has multiple pages, for example Inventory:

- Overview.
- Products.
- Categories.
- Warehouses.
- Stock.
- Guided Setup.

All these pages must belong to the Inventory application's internal navigation.

When a user launches Inventory from `/anops`, they should enter the Inventory dashboard with a dedicated sidebar containing all Inventory pages.

Apply this same architecture consistently to every management.

Requirements:

- Each application owns its own navigation structure.
- Display all relevant existing pages in the application's sidebar.
- Preserve existing routes and functional pages where possible.
- Organize navigation by logical groups.
- Highlight the current page.
- Support collapsible navigation sections.
- Provide responsive mobile navigation.
- Keep application identity visible.
- Provide a clear way to return to `/anops`.

## Global application switcher

Add an elegant global application switcher and search experience.

Users should be able to:
- Search applications by name.
- Search accessible application pages where appropriate.
- Switch between installed applications.
- See unavailable applications with appropriate upgrade information.
- Navigate without returning to the home screen.

Only display and allow access to applications authorized by the organization's entitlements.

Preserve the current application context where useful.

# 17. Data Architecture & Security

Audit and implement the data model carefully.

At minimum, define clear relationships for:

- User accounts.
- Organizations.
- Organization memberships.
- Organization roles.
- Invitations.
- Application catalog.
- Organization application entitlements.
- Subscription plans.
- Organization subscriptions.
- Trial records.
- Stripe customers.
- Stripe subscriptions.
- Payment/invoice records.
- Activation tokens.
- Audit events.
- User profiles.
- Organization profiles.

Avoid unnecessary duplication of subscription or application data.

Use the existing company-based multi-tenant architecture consistently.

Every organization-owned resource must be scoped to the correct organization.

Enforce:
- Server-side authorization.
- Tenant isolation.
- RBAC.
- Secure session management.
- Input validation.
- Rate limiting.
- Secure token handling.
- Protection against IDOR.
- Safe organization switching.
- Audit logging for sensitive operations.

Use database transactions where supported and safe migrations for schema changes.

Never expose secrets, activation tokens, or internal payment credentials.

# 18. User Experience Standards

Every workflow must feel coherent and premium.

Use:
- Smooth, purposeful transitions.
- Professional confirmation dialogs.
- Clear progress indicators.
- Beautiful empty states.
- Helpful onboarding messages.
- Responsive forms.
- Clear validation feedback.
- Accessible interactive controls.
- Consistent loading and error states.

Avoid:
- Unnecessary registration fields.
- Repeated onboarding steps.
- Confusing subscription terminology.
- Unclear application restrictions.
- Unexpected redirects.
- Broken back navigation.
- Blocking dialogs without a clear resolution.
- Inaccessible mobile layouts.

# 19. Mandatory Implementation Roadmap

Create and maintain:

`ANOPS_PLATFORM_WORKFLOW_ROADMAP.md`

Use this batch structure, adapting it after the initial audit when necessary.

**Batch 0 — Architecture & Workflow Audit**
- Inspect authentication, database, tenancy, RBAC, routes, application catalog, and existing dashboard.
- Inspect email infrastructure and Stripe integration.
- Map existing workflows and identify architectural gaps.
- Document risks and dependencies.

**Batch 1 — Core Data & Entitlement Architecture**
- User and organization relationships.
- Application catalog.
- Memberships and roles.
- Free/trial/paid entitlements.
- Subscription and trial state models.
- Migrations and authorization.

**Batch 2 — Trial Selection & Registration**
- `/trial`.
- Application selection.
- Selection summary.
- Free/trial differentiation.
- Registration page.
- Deferred profile fields.
- Account and organization creation.

**Batch 3 — Main Workspace**
- `/anops`.
- Desktop application grid.
- Mobile home screen.
- Floating Dock.
- Application launch and access restrictions.

**Batch 4 — Email Activation & Onboarding**
- Activation emails.
- Secure activation.
- 12-hour expiration.
- Background cleanup.
- Success onboarding.
- Employee invitations.

**Batch 5 — Organization Management**
- Organization overview.
- Members.
- Invitations.
- Roles and permissions.
- Application access.
- Organization settings.
- Audit logs.

**Batch 6 — User Profiles**
- Owner profile.
- Employee profiles.
- Profile completion.
- Preferences and security settings.

**Batch 7 — Subscriptions & Pricing**
- Market research.
- Pricing strategy.
- OneOps.
- AllOps.
- MaxOps.
- Custom.
- Subscription management.
- Trial expiration and free fallback.

**Batch 8 — Stripe Integration**
- Checkout.
- Customer management.
- Webhooks.
- Subscription synchronization.
- Invoices.
- Billing portal.
- Payment failure handling.

**Batch 9 — Application Navigation**
- Management-specific sidebars.
- Internal page organization.
- Global app switcher.
- Search.
- Mobile navigation.

**Batch 10 — Integration & Quality Assurance**
- Complete user lifecycle testing.
- Security and tenant-isolation testing.
- Subscription and entitlement testing.
- Stripe test-mode verification.
- Email activation testing.
- Responsive testing.
- Production build and regression testing.

For every batch, maintain:

- Status: Not Started / In Progress / Completed / Blocked.
- Individual task statuses.
- Files and components changed.
- Database migrations.
- Tests executed and results.
- Known issues.
- Decisions and assumptions.
- Exact next step.

Update the roadmap continuously.

# 20. Acceptance Criteria

The implementation is not complete until these end-to-end journeys work:

**Journey A — Permanent Free**
1. Visitor clicks Try It Free.
2. Selects one application.
3. Creates an account.
4. Organization and workspace are created.
5. Owner enters `/anops`.
6. Activation email is sent.
7. Owner activates the organization.
8. Owner accesses the selected application permanently with unlimited users.

**Journey B — 15-Day Trial**
1. Visitor selects two or three applications.
2. Creates an account.
3. Organization and workspace are created.
4. Owner enters `/anops`.
5. Activation email is sent.
6. Owner activates the organization.
7. Owner invites colleagues or skips.
8. Organization uses selected applications during the trial.
9. Trial expiration triggers the subscription experience.
10. Owner upgrades or chooses the eligible permanent OneOps application.

**Journey C — Paid Subscription**
1. Owner selects a paid plan.
2. Stripe Checkout processes payment.
3. Verified webhook updates subscription status.
4. Application entitlements are updated.
5. Authorized applications become accessible.
6. Billing and subscription details appear in organization settings.

**Journey D — Organization Management**
1. Owner opens organization settings.
2. Updates organization details.
3. Invites employees.
4. Assigns roles.
5. Controls application and AI access.
6. Reviews subscription and billing information.

**Journey E — Application Navigation**
1. Owner opens `/anops`.
2. Launches an installed application.
3. Sees its complete internal sidebar.
4. Navigates between its management pages.
5. Uses the global application switcher to move to another authorized application.

All journeys must be tested, including failure cases, expired tokens, unauthorized access, duplicate invitations, payment failures, concurrent requests, and expired subscriptions.

---

# 21. Final Instructions

Prioritize correctness, maintainability, security, and excellent user experience over rushing.

Do not rebuild existing working features unnecessarily.

Do not introduce fake data into production flows.

Do not mark tasks completed without implementation and verification.

Do not stop after the initial audit or architecture proposal.

Execute the roadmap sequentially and update the progress document continuously.

If the session ends, another agent must be able to resume from the roadmap without repeating completed work.

The final objective is to make AnOps a cohesive, intelligent, organization-centric business platform with a genuinely differentiated user experience.