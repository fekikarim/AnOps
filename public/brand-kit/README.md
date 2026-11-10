# AnOps Brand Kit

This folder is the organized source of truth for AnOps brand assets.

## Folder structure

- `01-brand-identity/` — production logos and symbol marks.
  - `logos/` — horizontal, reverse, monochrome, raster, and symbol-lockup logos.
  - `symbols/` — standalone AnOps symbol artwork and symbol fields.
- `02-app-icons/` — favicons, web icon artwork, and mobile app icons.
- `03-ui-icons/` — standalone interface icons, exported as SVG.
- `04-brand-guidelines/` — brand boards, logo construction, color/type, imagery, theming, component, and handoff references.
- `05-product-screens/` — homepage and dashboard reference exports, including mobile light/dark variants.
- `90-source-files/` — editable source files, including the original Figma file.

## Naming convention

Files use lowercase kebab-case and follow this pattern where useful:

`anops-[asset-type]-[variant]-[size-or-context].[extension]`

Examples: `anops-logo-horizontal-white.svg`, `anops-app-icon-ios-192x192.svg`, and `anops-product-dashboard-mobile-dark.png`.

## Notes

- The 34 UI icons were originally exported with generic Figma names (`Vector`, `Vector-1`, etc.). They have been renamed semantically from visual inspection; the SVG contents were not modified.
- The 40×40 favicon source has an internal 32×32 SVG viewport. Its filename is retained as the supplied export size, but the artwork should be checked before using it as a strict 40×40 production asset.
- PNG files in `04-brand-guidelines/` and `05-product-screens/` are reference exports rather than editable source artwork.

## AI implementation guide

Use this README as the first routing document when implementing AnOps branding. Prefer the supplied SVG assets and semantic tokens below over recreating marks, colors, or icons from screenshots. The boards in `04-brand-guidelines/` are visual references and the files in `01-brand-identity/` and `02-app-icons/` are the ready-to-use exports.

### Brand character

AnOps is a clear, operational, modern B2B product brand. The visual language is built around:

- deep ink as the anchor color;
- citron as the energetic action/accent color;
- warm, quiet neutrals for the canvas and surfaces;
- generous whitespace, crisp geometry, and restrained borders;
- direct, information-dense interfaces where hierarchy is more important than decoration.

The intended impression is confident, precise, calm, and practical. Keep layouts uncluttered and let the citron accent identify action, focus, or important emphasis rather than using it as a general background everywhere.

### Semantic color tokens

Use semantic token names in application code so light and dark themes can change without changing component code. Do not hard-code a light-theme value into a component that may appear in dark mode.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `color.bg.canvas` | `#F7F7F2` | `#111F1D` | Page/app background |
| `color.bg.surface` | `#FFFFFF` | `#192B27` | Cards, panels, inputs, elevated surfaces |
| `color.bg.subtle` | `#EDF0E8` | `#223832` | Secondary fills, muted panels, table rows |
| `color.text.primary` | `#111F1D` | `#F7F7F2` | Main headings, body text, high-emphasis labels |
| `color.text.secondary` | `#59645F` | `#B4BFB7` | Supporting text, metadata, descriptions |
| `color.border.subtle` | `#D8DDD5` | `#476158` | Dividers and low-emphasis boundaries |
| `color.border.control` | `#77847C` | `#81978B` | Input, select, and control outlines |
| `color.action.primary` | `#C8F03E` | `#C8F03E` | Primary buttons, active emphasis, key actions |
| `color.action.on-primary` | `#111F1D` | `#111F1D` | Text/icons placed on citron |
| `color.action.hover` | `#B9DE36` | `#B9DE36` | Hover state for primary action |
| `color.action.danger-hover` | `#8E2828` | `#8E2828` | Destructive-action hover state |
| `color.focus.ring` | `#245BCE` | `#A7C5FF` | Keyboard focus indicator |
| `color.disabled.bg` | `#E1E5DC` | `#E1E5DC` | Disabled control background |
| `color.disabled.text` | `#59645F` | `#59645F` | Disabled labels and content |
| `color.status.success` / `color.status.success.bg` | `#176247` / `#E9F2EA` | same | Positive status and its background |
| `color.status.warning` / `color.status.warning.bg` | `#7B5915` / `#FBF2DA` | same | Warning status and its background |
| `color.status.error` / `color.status.error.bg` | `#A43434` / `#FFF1EE` | same | Error status and its background |

The authoritative visual reference for this table is [`anops-brand-theming.png`](04-brand-guidelines/anops-brand-theming.png). Status colors intentionally remain stable between themes. Check contrast whenever a token is combined with a new surface; `color.action.on-primary` is the correct foreground for citron.

### Theme behavior

- Light mode uses `#F7F7F2` for the canvas, white surfaces, deep-ink text, and soft green-gray borders.
- Dark mode uses deep ink for the canvas, `#192B27` for surfaces, warm light text, and stronger green-gray boundaries.
- Keep semantic token names stable across themes; only the resolved values change.
- Do not use pure black as a substitute for deep ink or pure white as a substitute for the light canvas.
- Citron remains the primary action color in both themes. Use dark ink for content placed on it.
- Use focus rings independently from status colors; never remove the focus ring for visual cleanliness.
- Disabled controls should be visibly inactive without reducing text to an unreadable contrast level.

### Logo and symbol selection

Select the smallest asset that exactly matches the placement; do not rebuild the logo from individual paths.

| Situation | Use |
| --- | --- |
| Standard light UI, header, or documentation | `01-brand-identity/logos/anops-logo-horizontal-dark.svg` |
| Dark/ink background | `01-brand-identity/logos/anops-logo-horizontal-white.svg` or `anops-logo-reverse-white-on-deep-ink.svg` |
| Citron lockup on deep ink | `anops-logo-primary-citron-on-deep-ink.svg` |
| Black-and-white print | `anops-logo-monochrome-black-on-white.svg` |
| Compact square space or avatar | `01-brand-identity/symbols/anops-symbol-master-96x96.svg` or the appropriately sized symbol export |
| Tiny UI/favicon use | `02-app-icons/anops-favicon-24x24.svg`, `32x32.svg`, or `40x40.svg` |
| iOS / Android install icon | The matching file in `02-app-icons/` |
| Decorative citron symbol panel | `anops-symbol-field-citron.svg` |

Preserve the logo proportions, internal spacing, and clear space shown by `anops-logo-master-bounds.svg`. Never stretch, skew, rotate, recolor arbitrarily, add effects, place the dark logo on a dark surface, or place the white logo on a light surface. Use the symbol alone only when the surrounding context already identifies AnOps or when the available space cannot support the wordmark.

### Icons and UI graphics

The `03-ui-icons/` directory is the canonical interface icon set. Icons are dark-ink line artwork with consistent stroke treatment. Use the semantic filename that matches the action or concept; do not substitute emoji or unrelated icon libraries inside branded UI. Keep icons optically aligned, use them at the size appropriate to their source geometry, and inherit theme color through the icon's intended current-color implementation when adapting the SVG for a component system.

The icon reference board is [`anops-ui-icons-reference.png`](04-brand-guidelines/anops-ui-icons-reference.png). `04-brand-guidelines/anops-interface-components.png` and `anops-native-components.png` show how controls, states, and icon placement are expected to work in product UI.

### Typography, spacing, and composition

Use [`anops-brand-colors-type-structure.png`](04-brand-guidelines/anops-brand-colors-type-structure.png) as the authority for type families, scale, weights, line heights, spacing, and layout structure. Follow its hierarchy rather than inventing a new type scale. The design language favors clear hierarchy, compact but breathable information groups, strong alignment, and consistent radius/border behavior. When a value is not specified in code, inspect the reference board or existing component before introducing a new one.

### Imagery and supporting references

[`anops-brand-imagery.png`](04-brand-guidelines/anops-brand-imagery.png) defines the approved imagery direction and supporting visual treatment. Keep imagery purposeful and compatible with the restrained, operational tone; do not introduce decorative treatments that compete with the product information. Use [`anops-brand-guidelines-overview.png`](04-brand-guidelines/anops-brand-guidelines-overview.png) for the high-level brand foundations, [`anops-logo-system.png`](04-brand-guidelines/anops-logo-system.png) for logo variants and misuse guidance, and [`anops-developer-handoff.png`](04-brand-guidelines/anops-developer-handoff.png) when translating the design into production.

### Recommended agent workflow

1. Identify the surface: light or dark, product UI or marketing, print or digital, full logo or symbol-only.
2. Resolve semantic color tokens for that surface; never choose colors by sampling a screenshot.
3. Select the matching supplied logo/app-icon asset from the routing tables above.
4. Preserve the logo's original aspect ratio and clear space.
5. Use the canonical UI icon whose filename describes the required action.
6. Check contrast, focus, disabled, hover, success, warning, and error states.
7. Compare the result against the relevant board in `04-brand-guidelines/` before considering the implementation complete.
