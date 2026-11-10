# Responsive Layout

Responsive design is built in from the first line of CSS. Write the mobile layout first, then add larger-screen rules with Tailwind prefixes or container queries.

## 1. Breakpoints

Use Tailwind's default scale (Tailwind v4 defaults) and do not invent others:

| Token | Min width | Typical device |
|---|---|---|
| (base) | 0 | Phones, portrait |
| `sm` | 640 px | Large phones, landscape phones |
| `md` | 768 px | Tablets portrait |
| `lg` | 1024 px | Tablets landscape, small laptops |
| `xl` | 1280 px | Laptops, desktops |
| `2xl` | 1536 px | Large desktops |

Add a wide layout rule for ultrawide screens: `min-[2200px]:` for containers that should not grow forever.

Prefer container queries for components that appear in different slots (cards in a grid or in a sidebar):

```tsx
<div className="@container">
  <div className="flex flex-col gap-3 @md:flex-row @md:items-center">...</div>
</div>
```

## 2. Required device matrix

Test every primary page at these sizes, in portrait and landscape where relevant:

| Class | Width × height | Notes |
|---|---|---|
| Small phone | 320 × 568 | Smallest supported width; check every button label |
| Phone | 375 × 812 | iPhone baseline |
| Large phone | 430 × 932 | Large Android and iPhone Pro Max |
| Small tablet | 600 × 960 | Awkward middle range, often breaks grids |
| Tablet | 768 × 1024 | Portrait iPad |
| Large tablet | 1024 × 1366 | iPad Pro portrait |
| Laptop | 1280 × 800 | Common work laptop |
| Desktop | 1440 × 900 | Common desktop |
| Large desktop | 1920 × 1080 | Full HD |
| Ultrawide | 2560 × 1080 | Long, wide content must not stretch |

Also test: browser zoom at 200%, text scaled to the largest OS setting, landscape phone (844 × 390), and the keyboard open on mobile (the visual viewport shrinks).

## 3. Page shell and containers

```tsx
// src/components/layout/page-shell.tsx
export function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-text-primary">
      {children}
    </div>
  )
}

export function Container({ children, wide = false, className }: { children: React.ReactNode; wide?: boolean; className?: string }) {
  return (
    <div className={cn(
      'mx-auto w-full px-4 sm:px-6 lg:px-8',
      wide ? 'max-w-[1600px]' : 'max-w-5xl',
      'pb-[max(1.5rem,env(safe-area-inset-bottom))]',
      className,
    )}>
      {children}
    </div>
  )
}
```

Rules:
- Use `min-h-dvh` (dynamic viewport height), never `100vh`, which overshoots on mobile browsers.
- Horizontal gutters: 16 px on phones, 24 px on tablets, 32 px on desktop.
- Long-form and form pages use `max-w-5xl` or narrower. Dashboards and tables may use `max-w-[1600px]`. Never let text lines exceed about 75 characters.
- Respect safe areas: `env(safe-area-inset-*)` for notches and home indicators, plus `viewport-fit=cover` in the viewport export.

## 4. Typography scaling

```css
.page-title { font-size: clamp(1.5rem, 1.1rem + 1.6vw, 2.5rem); line-height: 1.15; letter-spacing: -0.02em; text-wrap: balance; }
.section-title { font-size: clamp(1.125rem, 1rem + 0.5vw, 1.5rem); line-height: 1.25; text-wrap: balance; }
```

Headings wrap, never overflow. Use `min-w-0` on flex children that contain text so they can shrink. Use `break-words` or `[overflow-wrap:anywhere]` for URLs, emails, IDs, and long user-generated words.

## 5. Navigation

### Desktop (≥ lg): persistent sidebar

- Sidebar width 256 px expanded, 72 px collapsed (icons only, each with a tooltip and `aria-label`).
- Collapsed state stored in a preference cookie or local storage in a try/catch. Initial render must match the server.
- Items: icon + label, active state with `aria-current="page"`, soft primary background, and a left accent bar.
- Group items under labelled sections. Keep at most about 8 top-level items.

### Mobile and tablet (< lg): sheet navigation

- Top bar (56 px, sticky, safe-area aware) with the menu button (`IconButton` labelled "Open navigation"), the brand, and the primary action.
- Menu opens as a left drawer (Radix Dialog styled as a sheet) with a focus trap, Escape to close, and close on route change.
- Optional bottom navigation for 3 to 5 core destinations on phones, each with icon and short label, minimum 44 px targets.

```tsx
// Pattern: show exactly one navigation system per breakpoint
<aside className="hidden lg:flex lg:w-64 ...">{/* Sidebar */}</aside>
<header className="flex items-center gap-2 lg:hidden">{/* Top bar + sheet trigger */}</header>
```

Rules:
- Do not shrink a desktop sidebar until labels collide.
- Never hide the only route to a feature. Every destination is reachable on every breakpoint.
- The active route stays visible in both navigation systems.
- Use `<nav aria-label="Main">`, and a skip link ("Skip to content") as the first focusable element.

## 6. Grids and cards

```tsx
<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
  {items.map((item) => <Card key={item.id} />)}
</div>
```

- Card minimum width is enforced with `grid-cols-[repeat(auto-fill,minmax(16rem,1fr))]` for fluid galleries.
- Cards stack their actions under the content on narrow widths (`flex-col` then `sm:flex-row`).
- Titles wrap; descriptions clamp with `line-clamp-2` or `line-clamp-3` and show the full text in a tooltip or detail view.
- Keep card padding consistent: `p-4` on phones, `p-5` from `sm`.

## 7. Tables

Choose one strategy per table and document it.

1. **Reflow to a list** for records where each row is a card-like entity. Render a stacked list below `md` and the table from `md`. Render only one of them at a time, so screen readers do not read both.
2. **Horizontal scroll** for true multi-column data. Wrap the table in a region that scrolls, with a sticky first column and a visible fade on the edge:

```tsx
<div
  className="relative overflow-x-auto rounded-card border border-border [scrollbar-gutter:stable]"
  role="region"
  aria-label="Invoices, scroll horizontally for more columns"
  tabIndex={0}
>
  <table className="min-w-full text-sm tabular-nums">
    <thead className="sticky top-0 bg-surface-muted text-xs uppercase tracking-wide text-text-muted">
      <tr>
        <th scope="col" className="sticky start-0 z-10 bg-surface-muted px-4 py-3 text-start font-medium">Invoice</th>
        {/* more columns */}
      </tr>
    </thead>
    <tbody>{/* rows */}</tbody>
  </table>
</div>
```

3. **Priority columns:** show the 2 or 3 essential columns on phones, and the rest in a row detail or behind a "Details" button.

Table rules:
- Numbers are right-aligned and use `tabular-nums`.
- Row actions go in a `DropdownMenu` on the row (`IconButton` "More actions"), not a row of icon buttons on mobile.
- Sorting uses real buttons in `<th>` with `aria-sort`.
- Loading uses skeleton rows with the same column structure. Empty and error states replace the body, not the header.
- Large lists paginate or virtualize. Never load unbounded rows.

## 8. Forms on mobile

- Single column below `sm`. Two columns only for short, related fields.
- Inputs are full width with `h-10` minimum and `text-base` on phones (16 px prevents iOS auto-zoom).
- Use the correct `inputMode` and `type`: `email`, `tel`, `url`, `numeric` or `decimal`, `search`. Set `autoComplete` for every personal field.
- The primary action is reachable: a sticky footer with safe-area padding, or a full-width button at the end.
- When the keyboard opens, the focused field must stay visible. Use `scroll-margin-block` on fields if needed (`scroll-mb-24`).
- Date and time inputs use the native picker on mobile, styled with `color-scheme`, or a designed calendar popover on desktop.

## 9. Dialogs and sheets on mobile

- Below `sm`, dialogs become bottom sheets with a drag handle, rounded top corners, `max-h-[90dvh]`, and internal scrolling.
- Footer actions stack vertically with the primary action on top.
- Dialog content scrolls inside the sheet; the page behind does not scroll (Radix handles scroll lock).
- Close with the close button, Escape, or a backdrop tap.

## 10. Overflow control

Audit these for horizontal overflow at 320 px:

- Long URLs, emails, and IDs (`break-all` or `[overflow-wrap:anywhere]`).
- Code blocks (`overflow-x-auto` inside the block, never on the page).
- Charts (responsive container, with a compact mode below `md`).
- Images (`max-w-full h-auto`, or `next/image` with `sizes`).
- Tabs and filter chips (`overflow-x-auto` strip with snap points).
- Dropdown and popover content (`max-w-[min(20rem,calc(100vw-1.5rem))]`).
- Tooltips (`max-w-xs`, and collision padding).

Never fix overflow with global `overflow-x: hidden` on `html` or `body`. It hides real defects and breaks sticky elements.

## 11. Touch and pointer

- Interactive targets are at least 44 × 44 CSS px on touch surfaces. Icon-only buttons use `size="icon"` (40 px) with 4 px spacing, or padding to reach 44 px.
- Do not rely on hover for essential information. Provide tap-friendly alternatives (a visible label, an info popover on tap).
- Use `@media (hover: hover)` for hover-only decoration.
- Set `touch-action: manipulation` on buttons to remove the 300 ms tap delay in old browsers and prevent double-tap zoom.

## 12. Images and media

- Use `next/image` with `sizes` that match the layout (for example `sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"`).
- Reserve space with an `aspect-ratio` class so there is no layout shift.
- Video and iframes use `aspect-video` wrappers and `max-w-full`.
- Decorative backgrounds use lightweight gradients or SVG; avoid large blurred images on mobile.

## 13. Orientation and resizing

- Test landscape phones: the sidebar must not cover the content, and sticky headers must not consume more than about a third of the height.
- Do not lock orientation.
- Layout changes on resize should be smooth; avoid JavaScript-driven layout that flashes on resize. Prefer CSS.

## 14. Responsive verification

Automated: a Playwright script that loads each primary route at the device matrix, asserts `document.documentElement.scrollWidth <= window.innerWidth`, and captures screenshots for review in both themes.

Manual: at each size, check navigation, one form, one table, one dialog, one empty state, and the longest realistic label. Record failures and fix them in shared components.
