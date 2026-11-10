# Theming, Tokens, Dark/Light Transitions, and Scrollbars

## 1. Two token layers

- **Brand tokens** hold the raw values from `brand-kit/README.md`. Only the design-system layer may reference them.
- **Semantic tokens** describe the role of a color (`--primary`, `--surface`, `--danger`). Components use only semantic tokens.

Do not fill the values below with invented colors. Replace each `REPLACE` with the value from the brand kit. If the brand kit does not define a value for a role, derive it from a documented brand color and record the decision in `src/design-system/README.md`.

## 2. globals.css (Tailwind v4)

```css
@import "tailwindcss";
@import "tw-animate-css";

/* Dark mode variant driven by the `.dark` class set by next-themes */
@custom-variant dark (&:where(.dark, .dark *));

/* Raw brand values: fill from brand-kit/README.md */
:root {
  --brand-primary: REPLACE;
  --brand-secondary: REPLACE;
  --brand-accent: REPLACE;
  --brand-neutral-0: REPLACE;   /* lightest */
  --brand-neutral-900: REPLACE; /* darkest */
}

/* Semantic tokens, light theme */
:root {
  color-scheme: light;

  --background: var(--brand-neutral-0);
  --foreground: var(--brand-neutral-900);
  --surface: REPLACE;            /* cards and panels */
  --surface-raised: REPLACE;     /* popovers, menus */
  --surface-muted: REPLACE;      /* subtle sections, table headers */
  --overlay: REPLACE;            /* dialog backdrop, with alpha */

  --text-primary: var(--foreground);
  --text-secondary: REPLACE;
  --text-muted: REPLACE;         /* must pass 4.5:1 on --surface */
  --text-on-primary: REPLACE;

  --primary: var(--brand-primary);
  --primary-hover: REPLACE;
  --primary-active: REPLACE;
  --primary-soft: REPLACE;       /* tinted background for selected rows, badges */

  --secondary: REPLACE;
  --secondary-hover: REPLACE;

  --border: REPLACE;
  --border-strong: REPLACE;
  --input: REPLACE;
  --focus-ring: var(--brand-accent);

  --success: REPLACE;  --success-soft: REPLACE;
  --warning: REPLACE;  --warning-soft: REPLACE;
  --danger: REPLACE;   --danger-soft: REPLACE;
  --info: REPLACE;     --info-soft: REPLACE;

  --scrollbar-thumb: REPLACE;
  --scrollbar-thumb-hover: REPLACE;

  --ui-radius-control: 0.625rem;  /* buttons, inputs */
  --ui-radius-card: 0.875rem;     /* cards, panels */
  --ui-radius-dialog: 1.125rem;   /* dialogs, sheets */

  --ui-shadow-raised: 0 1px 2px rgb(0 0 0 / 0.06), 0 4px 16px rgb(0 0 0 / 0.06);
  --ui-shadow-overlay: 0 12px 40px rgb(0 0 0 / 0.18);
}

/* Semantic tokens, dark theme: a designed set, not an inversion */
.dark {
  color-scheme: dark;

  --background: REPLACE;
  --foreground: REPLACE;
  --surface: REPLACE;
  --surface-raised: REPLACE;
  --surface-muted: REPLACE;
  --overlay: REPLACE;
  --text-primary: var(--foreground);
  --text-secondary: REPLACE;
  --text-muted: REPLACE;
  --text-on-primary: REPLACE;
  --primary: REPLACE;          /* often a lighter brand tint for contrast */
  --primary-hover: REPLACE;
  --primary-active: REPLACE;
  --primary-soft: REPLACE;
  --border: REPLACE;
  --border-strong: REPLACE;
  --input: REPLACE;
  --focus-ring: REPLACE;
  --success: REPLACE;  --success-soft: REPLACE;
  --warning: REPLACE;  --warning-soft: REPLACE;
  --danger: REPLACE;   --danger-soft: REPLACE;
  --info: REPLACE;     --info-soft: REPLACE;
  --scrollbar-thumb: REPLACE;
  --scrollbar-thumb-hover: REPLACE;
  --ui-shadow-raised: 0 1px 0 rgb(255 255 255 / 0.04) inset, 0 8px 24px rgb(0 0 0 / 0.4);
  --ui-shadow-overlay: 0 16px 48px rgb(0 0 0 / 0.6);
}

/* Map semantic tokens to Tailwind utilities (bg-surface, text-primary, border-border ...) */
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-surface: var(--surface);
  --color-surface-raised: var(--surface-raised);
  --color-surface-muted: var(--surface-muted);
  --color-overlay: var(--overlay);
  --color-text-primary: var(--text-primary);
  --color-text-secondary: var(--text-secondary);
  --color-text-muted: var(--text-muted);
  --color-text-on-primary: var(--text-on-primary);
  --color-primary: var(--primary);
  --color-primary-hover: var(--primary-hover);
  --color-primary-active: var(--primary-active);
  --color-primary-soft: var(--primary-soft);
  --color-secondary: var(--secondary);
  --color-secondary-hover: var(--secondary-hover);
  --color-border: var(--border);
  --color-border-strong: var(--border-strong);
  --color-input: var(--input);
  --color-focus-ring: var(--focus-ring);
  --color-success: var(--success);
  --color-success-soft: var(--success-soft);
  --color-warning: var(--warning);
  --color-warning-soft: var(--warning-soft);
  --color-danger: var(--danger);
  --color-danger-soft: var(--danger-soft);
  --color-info: var(--info);
  --color-info-soft: var(--info-soft);

  --radius-control: var(--ui-radius-control);
  --radius-card: var(--ui-radius-card);
  --radius-dialog: var(--ui-radius-dialog);
  --shadow-raised: var(--ui-shadow-raised);
  --shadow-overlay: var(--ui-shadow-overlay);
}

/* Base */
@layer base {
  * { border-color: var(--border); }
  html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
  body {
    background: var(--background);
    color: var(--text-primary);
    font-feature-settings: "cv11", "ss01";
    -webkit-font-smoothing: antialiased;
    min-height: 100dvh;
  }
  :focus-visible { outline: none; }
}

/* Scrollbars: app-styled, both themes */
html {
  scrollbar-width: thin;
  scrollbar-color: var(--scrollbar-thumb) transparent;
}
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb {
  background-color: var(--scrollbar-thumb);
  border-radius: 999px;
  border: 3px solid transparent;
  background-clip: content-box;
}
::-webkit-scrollbar-thumb:hover { background-color: var(--scrollbar-thumb-hover); }
::-webkit-scrollbar-corner { background: transparent; }

/* Reduced motion */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

Notes:
- Browsers differ on scrollbar styling. Modern Chromium uses the standard `scrollbar-color` and `scrollbar-width` properties and ignores `::-webkit-scrollbar` when they are set. Safari relies on the webkit pseudo-elements. Test both, and treat the webkit block as the fallback that Safari uses.
- The `@media (prefers-reduced-motion)` block is a global safety net. Animations that must remain (for example a progress spinner) should still be expressed as meaningful, not decorative, motion.
- Check contrast for every text token on its surface (4.5:1 for body text, 3:1 for large text and UI borders). Use a contrast checker during the brand-kit review.

## 3. Root layout with next-themes

```tsx
// src/app/layout.tsx
import type { Metadata, Viewport } from 'next'
import { ThemeProvider } from '@/components/providers/theme-provider'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/toaster'
import './globals.css'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#REPLACE_LIGHT_BACKGROUND' },
    { media: '(prefers-color-scheme: dark)', color: '#REPLACE_DARK_BACKGROUND' },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <TooltipProvider delayDuration={300}>
            {children}
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
```

```tsx
// src/components/providers/theme-provider.tsx
'use client'
import { ThemeProvider as NextThemesProvider } from 'next-themes'
import type { ComponentProps } from 'react'

export function ThemeProvider(props: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props} />
}
```

Why `suppressHydrationWarning` on `<html>`: next-themes writes the `dark` class before hydration, so the server and client markup differ on that one element by design. Do not use it anywhere else to hide real mismatches.

## 4. Smooth theme transition (no flash, no jank)

`disableTransitionOnChange` stops transitions during a switch, which causes a hard cut. Instead, enable a short, scoped transition only while the user switches.

```ts
// src/hooks/use-animated-theme.ts
'use client'
import { useCallback } from 'react'
import { useTheme } from 'next-themes'

export function useAnimatedTheme() {
  const { setTheme, resolvedTheme } = useTheme()

  const toggle = useCallback(() => {
    const next = resolvedTheme === 'dark' ? 'light' : 'dark'
    const root = document.documentElement
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const apply = () => setTheme(next)

    // Native View Transition gives a smooth cross-fade where supported.
    if (!reduce && 'startViewTransition' in document) {
      ;(document as Document & { startViewTransition: (cb: () => void) => unknown })
        .startViewTransition(apply)
      return
    }

    // Fallback: scoped color transition for the duration of the switch.
    if (!reduce) {
      root.classList.add('theme-switching')
      window.setTimeout(() => root.classList.remove('theme-switching'), 350)
    }
    apply()
  }, [resolvedTheme, setTheme])

  return { theme: resolvedTheme, toggle }
}
```

Add to `globals.css`:

```css
.theme-switching,
.theme-switching * {
  transition: background-color 300ms ease, color 300ms ease,
    border-color 300ms ease, fill 300ms ease, stroke 300ms ease,
    box-shadow 300ms ease !important;
}

/* View Transitions cross-fade */
::view-transition-old(root),
::view-transition-new(root) {
  animation-duration: 350ms;
}
```

Rules:
- Use `transform` and `opacity` for motion. Do not animate `background-image` gradients on every switch.
- The theme toggle is a designed icon button: `Sun` in dark mode and `Moon` in light mode, with a tooltip "Switch to light mode", and `aria-label` describing the target theme.
- Never render an icon or logo that only works in one theme. Provide a themed logo variant from the brand kit, or use `currentColor` in SVG logos.
- Images with transparent backgrounds need checking in both themes. Add a subtle surface behind photos or diagrams when needed.

## 5. Theme-aware everything

Checklist for each theme:
- Text contrast on every surface.
- Input background, border, placeholder, and disabled states.
- Focus ring visibility on `--background` and `--surface`.
- Dialog overlay and elevation.
- Chart series colors distinguishable by more than hue.
- Status colors readable on their soft backgrounds.
- Native controls follow `color-scheme` (scrollbars, date pickers, autofill).
- Brand logo and illustrations have a variant for each theme when needed.

## 6. Motion tokens

```ts
// src/design-system/motion.ts
export const duration = { fast: 150, base: 200, slow: 300, overlay: 240 } as const
export const easing = {
  standard: 'cubic-bezier(0.2, 0, 0, 1)',
  enter: 'cubic-bezier(0, 0, 0.2, 1)',
  exit: 'cubic-bezier(0.4, 0, 1, 1)',
} as const
```

Use these in Tailwind arbitrary values or CSS variables, never ad hoc numbers scattered across components. Keep micro-interactions in the 120 to 200 ms range and overlays under 300 ms.

## 7. Spacing, type, and sizing scales

- Spacing: Tailwind's 4 px scale only. Components use the same padding steps: `px-3 py-2` (small), `px-4 py-2.5` (default), `px-5 py-3` (large).
- Type: one fluid page-title scale using `clamp()`, plus fixed UI sizes for controls (14 px to 16 px). Inputs use at least 16 px on mobile to prevent iOS zoom on focus.
- Control heights: small 32 px, default 40 px, large 48 px. Touch-first surfaces use at least 44 px tall targets.
- Font: the brand font loaded through `next/font`, with `display: 'swap'` and a fallback stack. Use `tabular-nums` for numbers in tables, prices, and statistics.
