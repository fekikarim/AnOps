---
name: nextjs-ui-ux-design-system
description: Complete UI/UX standard for Next.js (App Router) projects. Enforces brand-faithful design tokens, light and dark themes with smooth transitions, full responsiveness on every device, designed buttons with icons, tooltips, and all interaction states, designed dropdowns, forms with placeholders and structured layouts, custom scrollbars, product tours (coach marks), and no mock data. Use for any UI, component, page, layout, form, dialog, navigation, or styling work in a Next.js project.
---

# Next.js UI/UX Design System

Apply this skill to every UI change: new pages, components, forms, dialogs, navigation, styling, and refactors. The goal is one coherent, premium, brand-faithful product on every device and in every state.

Read the reference files when you need detail:
- `references/theming-and-tokens.md`: brand tokens, light/dark themes, theme transitions, custom scrollbars, global CSS.
- `references/components.md`: buttons, icon buttons, tooltips, dropdowns, forms, placeholders, tags, password strength, checkboxes, radios, switches, dialogs, validation, drag and drop, previews, and all states.
- `references/responsive-layout.md`: breakpoints, containers, navigation, tables, forms on mobile, safe areas, overflow, and the device test matrix.
- `references/product-tour.md`: coach marks and guided onboarding built from the product's real features.

Run `scripts/ui-audit.sh` before finishing any UI task. It flags violations of the rules below.

## 0. Non-negotiable rules

These are hard rules. A UI that breaks one is not finished.

1. **Brand first.** Read `brand-kit/README.md` and its referenced assets before designing. Use only brand colors, fonts, logos, and radii. Never invent a palette. If the brand kit is silent on a decision, choose a neutral default that complements it and record it in `src/design-system/README.md`.
2. **Responsive everywhere.** Every page works from 320 px wide to 2560 px wide, in portrait and landscape, at 200% browser zoom, and with the keyboard on mobile. No unintended horizontal scroll. Mobile-first CSS.
3. **Designed buttons only.** No bare, unstyled, or browser-default buttons. Every button has a variant, a size, an icon where it helps comprehension, every interaction state, and a tooltip when its label is icon-only or its meaning is not obvious.
4. **Button text stays bounded.** Labels never break the button's layout. Use `whitespace-nowrap` for short labels, `min-w-0 truncate` for long ones, and a tooltip with the full text whenever a label can be truncated. Icons use `shrink-0`. Keep labels to 1 to 3 words; move detail into the description.
5. **Tooltips on every non-obvious control.** Every icon-only control has an `aria-label` and a visible tooltip on hover and keyboard focus. Disabled controls explain why they are disabled in their tooltip.
6. **Designed dropdowns only.** Never use a native `<select>` or an unstyled menu for a designed surface. Use the styled menu primitive (see `components.md`) with icons, shortcuts where relevant, separators, destructive styling, and keyboard navigation.
7. **Dark and light modes, both designed.** Every token has a value in both themes. Switching themes transitions colors smoothly, does not flash, and respects reduced motion. Neither mode is an inverted copy of the other.
8. **No mock data.** Never hardcode fake records, lorem ipsum, "John Doe" names, sample charts, or placeholder numbers in components, pages, or fixtures shipped to the UI. Data comes from the real data layer. When there is no data, show a designed empty state with a real next action. Loading uses skeletons that match the final layout, not fake content.
9. **Product tours (coach marks) that match the product.** Each major area has a guided tour built from the real UI, with copy written for this product's domain and terminology. Tours are skippable, replayable, keyboard-accessible, and never block the app. See `product-tour.md`.
10. **Modern icons everywhere that help.** Use one icon family (`lucide-react` by default, or the one already in the repo). Pair icons with labels in navigation, primary actions, and status. Icons are decorative with `aria-hidden` unless they are the only label. Never use emoji as UI icons.
11. **All interaction states on every interactive element.** Default, hover, focus-visible, active, disabled, loading, selected, and error where applicable. Hidden elements use the `hidden` attribute or conditional rendering, never `display:none` on focusable content still in the tab order. Discard, cancel, and reset actions have an explicit, consistent treatment and, when unsaved work exists, a confirmation.
12. **Custom scrollbars.** Every scrollable region uses the app's scrollbar tokens (thin, rounded, theme-aware in both modes). Never leave the browser's default gray scrollbar in a designed app.
13. **Placeholder hints in every field.** Every input, textarea, select trigger, tag input, and search box has a visible persistent label, a placeholder that shows the expected format or an example, and helper text when the format is non-obvious. A placeholder never replaces the label.
14. **Structured forms and containers.** Group related fields into sections with headings. Use a consistent grid for field widths: full width for long text, half width for short related values, one column on mobile. Keep label, control, helper, and error in a fixed vertical order. Use a single size scale for all controls on a form.
15. **Designed controls, never default ones.** Checkboxes, radios, switches, tags, password strength meters, dialogs, validation messages, drag-and-drop zones, and previews all use the app's tokens, radii, focus rings, and motion. Browser-default look is a defect.

## 1. Stack and dependencies

Prefer what the repo already uses. If starting fresh, use this stack:

- Next.js App Router, React, TypeScript (`strict: true`).
- Tailwind CSS (v4 CSS-first config in `globals.css`), or the styling system the repo already has.
- Radix UI primitives for dialog, dropdown menu, tooltip, popover, checkbox, radio group, switch, tabs, and select. Wrap them in project components, or use shadcn/ui components copied into the repo and restyled to the tokens.
- `class-variance-authority`, `clsx`, `tailwind-merge` for variants and class composition.
- `lucide-react` for icons.
- `next-themes` for light/dark mode.
- `react-hook-form` + `zod` + `@hookform/resolvers` for forms and validation.
- `sonner` for toast notifications.
- `@dnd-kit/core` and `@dnd-kit/sortable` for drag and drop, with keyboard support.
- `tw-animate-css` for enter and exit animations, if using Tailwind v4.

Verify current versions with `npm view <package> version` before installing. Do not add a dependency that duplicates one already present. Do not mix two icon families or two dialog systems.

Shared helper, `src/lib/utils.ts`:

```ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

## 2. Folder structure for UI

```text
src/
  app/
    layout.tsx             root layout: fonts, ThemeProvider, TooltipProvider, Toaster, viewport export
    globals.css            brand tokens, themes, scrollbars, base styles
  components/
    ui/                    primitives: button, icon-button, input, field, select, checkbox, radio, switch,
                           tags-input, password-input, password-strength, dialog, dropdown-menu, tooltip,
                           badge, alert, skeleton, empty-state, drop-zone, tabs
    layout/                page-shell, page-header, section, container, sidebar, mobile-nav, breadcrumbs
    feedback/              toast helpers, error-state, loading-state
  features/<feature>/
    components/            feature components composed from ui/
    tour.ts                product tour steps for this feature
  design-system/
    README.md              decisions, tokens, component contracts, unresolved brand gaps
    motion.ts              durations and easings as constants
```

Components in `ui/` never fetch data, never know business rules, and never hardcode brand colors. Feature components compose `ui/` components and never restyle them with one-off classes.

## 3. Workflow for any UI task

1. Read `brand-kit/README.md`. List the brand colors, fonts, radii, and logo rules you will use.
2. Find the existing component that covers the need. Extend it with a variant if needed. Do not create a second button, dialog, or input.
3. Build or update the primitive first, with all states, dark and light, and responsive behavior.
4. Compose the page from primitives and layout components. No ad-hoc colors or spacing.
5. Wire real data through the existing data layer. Build the loading skeleton, empty state, error state, and success feedback.
6. Add tooltips, placeholders, helper text, and icons according to the rules above.
7. Add or update the product tour for the feature (see `product-tour.md`).
8. Test at the device matrix in `responsive-layout.md`, in both themes, with keyboard only, and with reduced motion.
9. Run `bash scripts/ui-audit.sh src` and the project's own lint, type check, and build. Report actual results, including failures.

## 4. Quality checklist

- [ ] Brand tokens used; no hardcoded hex colors or unexplained arbitrary values in components.
- [ ] Every page checked at 320, 375, 768, 1024, 1440, and 2560 px wide, portrait and landscape.
- [ ] No horizontal scroll at any width; no text overflow in buttons, tabs, badges, or table cells.
- [ ] Every button has variant, icon where helpful, all states, and bounded label text.
- [ ] Every icon-only control has `aria-label` and a tooltip.
- [ ] No native `<select>`, no unstyled `<input type="checkbox">`, no default-looking dropdown.
- [ ] Dark and light modes both designed, transitions smooth, no theme flash on first paint.
- [ ] Custom scrollbars present on every scrollable region in both themes.
- [ ] Every field has a visible label, a placeholder or example, and helper text when the format is non-obvious.
- [ ] Forms grouped into sections; field widths consistent; error text connected with `aria-describedby`.
- [ ] Tags, password strength, dialogs, validators, drag and drop, and previews use the app's design language.
- [ ] No mock data, lorem ipsum, or fake records anywhere in shipped UI.
- [ ] Empty, loading, error, success, and no-permission states exist for every data view.
- [ ] Product tour exists for the main feature area, uses real element anchors, and can be skipped and replayed.
- [ ] Keyboard can reach and operate everything; focus is visible; dialogs trap and restore focus.
- [ ] Reduced motion respected; no animation blocks interaction.
- [ ] `ui-audit.sh` passes or every finding is explained.

## 5. Anti-patterns

- A page-level `'use client'` just to get a dropdown working. Keep client boundaries at the leaves.
- Hardcoded `bg-[#3b82f6]` inside a feature component. Use a semantic token.
- `<button>` with only an icon and no `aria-label`.
- `title="..."` as the only tooltip. Native title tooltips are slow, inaccessible on touch, and unstyled.
- `overflow-x: hidden` on `body` to hide layout bugs.
- Placeholder used as the only label.
- Fake sample rows, charts, or users in components.
- `window.alert` or `window.confirm` for confirmations. Use the designed dialog.
- Inverting colors to create dark mode.
- Animating `width`, `height`, or `top` for every hover. Animate `transform` and `opacity`.
- Showing a success toast before the server confirms the operation.
