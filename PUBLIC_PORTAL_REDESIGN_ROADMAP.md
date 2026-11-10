# AnOps Public Portal Redesign — Roadmap

Single source of truth for the public portal redesign. Update after every meaningful task.
Statuses: **Not Started / In Progress / Completed / Blocked**.

---

## Exact next step

> All 8 batches are implemented. Next: (1) review the work in the browser and commit on `feat/ui-and-payment` (nothing is committed yet);
> (2) when real prices, a support email, social accounts, a public repo or events exist, fill them in `src/shared/config/site.ts` and the Community hub (see Known issues);
> (3) optional polish: redesign `/about` and `/contact` (untouched pages) with the portal components.

---

## Batch 0 — Project audit · Completed

### Stack and architecture
- Next.js 16.4 App Router, React 19.3, Tailwind v4 (CSS-first, tokens in `src/app/globals.css`), TypeScript, Vitest, ESLint.
- No animation library. Motion uses CSS keyframes in `globals.css` (`reveal`, `scroll-reveal`, `lift`, `menu-in`, `live-dot`) with `prefers-reduced-motion` overrides. Decision: **no new dependencies**.
- Public portal lives in `src/app/(marketing)/` (layout with `SiteHeader` / `SiteFooter`). Shared marketing UI in `src/shared/components/marketing/`. Copy/config in `src/shared/config/{catalog,site}.ts`. `src/app/sitemap.ts` reads the catalog.
- Theme: `.dark` class on `<html>` (`ThemeToggle`), both themes defined in tokens.
- Brand (PRODUCT.md): forest-dark `#111F1D` and warm-paper `#F7F7F2` surfaces, lime primary action `#C8F03E`, Manrope headings, Inter UI, accents teal/blue/violet.

### Existing public routes (before)
`/`, `/apps`, `/apps/[slug]`, `/industries`, `/pricing`, `/community-hub`, `/help`, `/about`, `/contact`, `/privacy`, `/terms`.

### Issues found
1. **Broken nav link**: public nav "Community" pointed to `/community`, which is the *authenticated* dashboard module (listed in `src/proxy.ts` protectedRoutes). The public page is `/community-hub`. The sitemap had the same bug.
2. **Catalog did not match the product**: `catalog.ts` listed ~30 speculative apps (Website, Accounting, Payroll, IoT, stock forecasting...) instead of the 11 real managements in the dashboard sidebar.
3. Pricing showed 3 plans (One App / Standard / Custom) instead of the 5-tier model (Free / Standard / Pro / Ultra / Custom).
4. Contact form is a disabled layout-only form (no backend). No public support email, social accounts, events or public GitHub repo exist (`github.com/HamaBTW/AnOps` returns 404 publicly → private).

### The 11 managements (verified against code and docs)
| App | Route | Real state |
|---|---|---|
| AnOps AI | `/ai`, `/ai/access` | Command Center: chat + slash commands (135 module commands), 144 registered tools, per-member access grants as a subset of role permissions, confirmation of every write, token budgets, retention, kill switch, Groq→OpenRouter→Gemini fallback. |
| Company | `/company` | Company settings (name, industry, currency TND/EUR/USD/GBP), members and roles (owner/admin/manager/employee), multiple companies per user with company switcher, onboarding. |
| HR & Payroll | `/hr`, `/hr/ai-activity` | Employees, departments, job titles, leave requests/balances/history, attendance, payroll section and payslips, manual adjustments, departure review, HR AI copilot (confirm-before-write) and Approval Advisor. |
| CRM | `/crm` | **Placeholder page only** → Coming soon. Marketing contacts define the CRM contract. |
| Sales | `/sales` | **Placeholder page only** → Coming soon. |
| Finance | `/finance/**` | Customers, invoices (builder, edit, history, email, export), payments and allocation, credit notes/voids, expenses, receipt OCR to draft expense, Telegram receipt upload, reports + Excel export, Finance Copilot (category suggestions, reminders, insights). Money in cents, timbre fiscal. |
| Inventory | `/inventory/**` | Products, categories, warehouses, append-only stock ledger, balances per warehouse, adjustments with reasons, guided setup. No reservations, no FIFO. |
| Purchasing | `/purchasing/**` | Suppliers, purchase orders (draft→approved→received), goods receipts posting stock, replenishment view. AI forecasting **not implemented**. |
| Manufacturing | `/manufacturing/**` | BOM revisions (one active per product), work orders snapshotting BOM, components consumed at completion in one transaction. No nested BOMs/scrap. |
| Marketing | `/marketing/**` | Contacts, tags, consent & suppression, audiences, templates, campaigns (email SMTP/Brevo, SMS Brevo, Telegram) with approval and scheduling, Facebook Page posts, AI copywriter, analytics, integrations. Several providers not verified live. |
| Blogs & Community | `/community` | Company blog (drafts/publish, categories, tags, AI 3-bullet summaries), forum topics and comments, live chat, visitor chat widget. |

### Animated assets (`public/animated/`)
- 48 Lordicon "wired-lineal" animated WebP/GIF, 256×256, ~100 frames, transparent background, navy strokes + lime accent. Total 19.3 MB (largest ~1 MB).
- Decision: generated **static 128px poster frames** in `public/animated/posters/` (48 files, 144 KB total). Components show the poster and swap to the animated file only on hover/focus (lazy-loaded) or for a single featured hero icon; reduced-motion users only ever see posters.
- Navy strokes need a light tile in dark mode → icons always sit on a paper-coloured tile.

---

## Batch 1 — Design foundation · Completed
- [x] `src/shared/config/catalog.ts` rewritten: the 11 apps with icon, accent, intro, features, use cases, benefits, notes, related apps, illustrative preview data. Exported API kept (`apps`, `categories`, `getApp`, `getCategory`, `appsInCategory`, `statusMeta`, `aiUseCases`) + `relatedApps`, `legacyAppSlugs`.
- [x] Areas: Platform & AI, Customers & Revenue, Finance, Operations, People, Collaboration.
- [x] 29 retired slugs 301-redirect to their new app (`next.config.ts` `redirects()`).
- [x] `src/shared/config/site.ts`: nav Community → `/community-hub` (bug fix), footer adds Docs/Guides/Sign in, 5-tier `plans`, `comparisonRows`, `pricingFaq`.
- [x] `src/shared/config/industries.ts` (6 industries), `src/shared/config/docs.ts` (2 start docs, 11 app references, 6 guides).
- [x] Components in `src/shared/components/portal/`: `animated-icon.tsx`, `reveal-observer.tsx` (mounted in marketing layout), `sections.tsx` (`Eyebrow`, `SectionHeading`, `TextLink`, `PageHero`, `AppTile`, `CtaBand`, `Notice`, `display`, `delay`), `app-preview.tsx`, `command-demo.tsx`, `ecosystem-map.tsx`, `product-tour.tsx`.
- [x] CSS (end of `globals.css`): `[data-reveal]` system, `.portal-grid`, `.portal-ink` (always-dark band), caret/flow keyframes, reduced-motion overrides.
- [x] Header mega-menu shows all 11 apps with icons by area; mobile menu lists apps; CTA "Start free" → `/register`. Sitemap includes industries + docs.

## Batch 2 — Homepage · Completed
Sections: hero + animated AI Command Center demo (pausable, reduced-motion static), interactive ecosystem map, product tour tabs (ARIA tabs, arrow keys), record journey (ink band), AI guardrails + AI use cases, industries, trust (real engineering facts), 5-plan teaser, FAQ, CTA. Verified in browser at 1440px dark theme.

## Batch 3 — Apps directory + 11 overview pages · Completed
- `/apps`: hero with 11 icons, sticky filter bar (search across features, area chips, status), grouped-by-area view, empty state.
- `/apps/[slug]` (static params for all 11): hero with preview, features, use cases, business value, notes, related apps, docs, industries, prev/next, CTA. CRM/Sales show "Coming soon" + planned scope only.

## Batch 4 — Industries · Completed
- `/industries`: hero, `IndustryExplorer` (pick an industry → challenges mapped to the app that handles each), 6 industry cards, "what changes" comparison table (qualitative, no superiority claims).
- `/industries/[slug]` × 6 (manufacturing, distribution, retail, professional-services, agencies, groups): challenges, challenge→app answers, `FlowDiagram` workflow, app tiles, expected outcomes (with a disclaimer that no benchmarks exist), other industries.

## Batch 5 — Pricing · Completed
- 4 plan cards (Free / Standard highlighted "Most teams start here" / Pro / Ultra) + Custom band; companies × applications shown on every card.
- No prices invented: Standard/Pro/Ultra "To be announced", Custom "Custom quote", notice that billing terms will be published first. Free CTA → `/register`, others → `/contact`.
- `PlanFinder` (3 questions → suggested plan), full comparison table (scrollable region, sticky first column), billing FAQ.
- Audit finding: there is **no subscription/entitlement implementation** in code (docs/inventory-purchasing-manufacturing.md: "Application entitlement / subscriptions are not enforced"), so no pricing logic needed preserving.

## Batch 6 — Community, Docs, Guides · Completed
- `/community-hub`: 7 hubs with Available/Planned badges; Documentation, Guides, Forum (links to the real in-workspace forum `/community`, sign-in required), Reports & feedback (`ReportComposer`: builds a copyable bug/feature report; no endpoint exists so nothing is sent), GitHub / Social / Events marked Planned with honest copy (repo is private, no official accounts or events yet).
- `/docs` (search, start docs, 11 app references, guides) and `/docs/[slug]` × 19 (sidebar nav, on-this-page TOC, steps/lists, related app, next doc, feedback link).

## Batch 7 — Help center · Completed
- `/help`: hero with shortcuts, `HelpCenter` (search + 8 topic filters over 13 troubleshooting fixes + FAQs, accordion, empty state), support by application (11), getting started, other ways to get help. Data in `src/shared/config/help.ts`.

## Batch 8 — QA · Completed
- `npx tsc --noEmit`: clean.
- ESLint on all touched paths: 0 errors (4 pre-existing `<img>` logo warnings in header/footer). Repo-wide lint has pre-existing errors in unrelated files.
- Unit tests: `ANOPS_SKIP_DB_PREFLIGHT=1 npx vitest run tests/unit` → 33 files, 429 tests passed. Integration tests need a local MongoDB replica set (not running) and were not run.
- `npm run build`: succeeds.
- Browser (dev server): every redesigned route checked at 375px → `scrollWidth === 375` (no horizontal overflow); desktop 1440px screenshots of home, apps, app detail, pricing; dark and light themes checked; mobile menu, mega menu, plan finder, help search, legacy redirect `/apps/invoicing → /apps/finance` verified. No console errors from the pages.
- Removed components orphaned by the redesign: `marketing/app-card.tsx`, `marketing/dashboard-preview.tsx`, `marketing/category-icon.tsx`.

---

## Follow-up (2026-11-09) · Completed
- Apps mega-menu overflowed the viewport on the right (panel anchored to the Apps button, fixed 860px, `truncate` taglines in non-shrinking grid columns). Now anchored to the header container (`inset-x-4/6/8`), `grid-cols-3` with `min-w-0` columns, wrapping taglines, max-height with internal scroll. Verified at 1024px and 1440px: no element outside the panel.
- `/privacy` and `/terms` written: shared `LegalDocument` layout (`src/shared/components/portal/legal-document.tsx`), scroll-spy contents (`legal-toc.tsx`, collapsible on mobile), "In short" summary, numbered sections, cookie table (stacked cards below 640px). Content in `src/shared/config/legal.ts`, based on actual behaviour (auth cookies, active-company cookie, theme storage, AI providers Groq/OpenRouter/Gemini, integrations, 90-day default AI retention). Operator legal name, address, privacy email and governing-law country are **not known** and are not invented; requests go through `/contact`. **Needs legal review before launch.**

## Architectural decisions
- No new runtime dependencies; motion with CSS + one IntersectionObserver client component.
- Content is data-driven (config files) so pages, sitemap and search share one source.
- Honesty rules: CRM and Sales are "Coming soon"; no prices are invented (Standard/Pro/Ultra "Pricing to be announced"); no social/GitHub/event URLs are invented; previews are labelled "Illustrative".

## Known issues / external inputs needed (Blocked on information)
- Real prices, billing terms, support email, social accounts, public GitHub repo, events: **not available** — placeholders clearly say "to be announced".
- Contact form has no backend (pre-existing, page untouched), so "Go to contact" from the report composer and help center leads to a layout-only form.
- `/about` and `/contact` were not redesigned (not in scope); they still use the old `marketing/styles` tokens and render fine.
- Reduced motion is handled in CSS (`motion-safe:` for animated icons, `[data-reveal]` and keyframes overrides); not verified with an emulated preference in the browser.

## Verification log
- 2026-11-09: see Batch 8.
