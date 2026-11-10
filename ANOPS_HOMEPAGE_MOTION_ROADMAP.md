# AnOps Homepage — Cinematic Motion Roadmap

Scope: the public homepage only (`src/app/(marketing)/page.tsx`). Apps, Industries, Pricing, Community, Help and all real workflows (onboarding, subscriptions, organizations, AI Command Center) are untouched. All demos are sandboxed: sample data in the browser, no requests, nothing saved.

## Status

| Batch | Scope | Status |
|---|---|---|
| 0 | Audit: homepage, design system, assets, animation stack | Completed |
| 1 | Motion system and reusable components | Completed |
| 2 | Scene 1 — Cinematic hero | Completed |
| 3 | Scene 2 — Interactive AI Command Center demo | Completed |
| 4 | Scene 3 — Organization creation and onboarding demo | Completed |
| 5 | Scene 4 — Ecosystem · Scene 5 — Intelligent operations | Completed |
| 6 | Scene 6 — Final conversion and footer transition | Completed |
| 7 | Responsive, accessibility, performance, QA | Completed |

## Batch 0 — Audit findings
- No animation library installed (only `tw-animate-css`). Existing motion: `RevealObserver` (`data-reveal` + IntersectionObserver), keyframes in `globals.css`, Lordicon WebP icons in `public/animated/` with static posters (`AnimatedIcon`, posters by default, animation on hover/visible).
- Design tokens in `globals.css` (citron `#C8F03E`, deep ink `#111F1D`, Manrope/Inter); `.portal-ink` gives an always-dark band; light/dark via `.dark` on `<html>`.
- Sticky marketing header is 73px high (`--home-header`).
- Catalog: 10 applications; CRM and Sales are `coming-soon` (used to separate available features from the roadmap).

## Batch 1 — Motion system (decision: no new dependency)
- `src/shared/components/home/scroll-scene.tsx`: `useScrollProgress(ref, "pin" | "enter" | "exit")` writes scroll progress to `--p` on the element with one rAF per frame, passive listeners attached only while the element is near the viewport (IntersectionObserver). No React re-render per frame. Reduced motion → `--p: 1`.
- `ScrollScene`: pinned (sticky) scene of 150/190/240vh on ≥768px with motion allowed; a normal section with an entrance on phones and for reduced motion. No scroll hijacking: native scrolling only.
- CSS (`globals.css`, "Homepage motion system"): sub-range helpers `--a/--b/--c`, word-mask headline, rise/pop/bar/draw/type keyframes, device tilt, emerge, depth, orbit lines. Transform and opacity only; everything disabled under `prefers-reduced-motion`.

## Scenes and files
- Scene 1 `home/hero.tsx` + `home/workspace-mock.tsx`: word-by-word headline, Try it free (/trial) and Sign in (/login), a 3D-tilted miniature of the real /anops workspace that flattens as you scroll, two depth cards drifting at different speeds, subtle pointer tilt on fine pointers only.
- Scene 2 `home/ai-command-demo.tsx` in a pinned `ScrollScene` (`#command-center`): the panel emerges from the bottom into the centre. Four scripted intents (inventory overview, create product → proposal with Confirm/Cancel, sales report from Finance invoices, organization performance) plus free text with keyword matching and a fallback. Thinking steps, animated KPIs, bars and line chart. Panel-internal scrolling only (never scrolls the page). `aria-live` messages, labelled input, keyboard usable.
- Scene 3 `home/onboarding-demo.tsx`: scrollytelling of the real flow (choose apps → owner account → organization + activation email → /anops → invitations). Desktop: device pinned beside the steps, screens cross-fade as each step reaches the middle; phones: each step carries its own screen, played the first time it is seen.
- Scene 4 `home/ecosystem-orbit.tsx`: apps on a ring around the AnOps mark; lines draw in; selecting (hover, focus, tap) an app lights its real `connectsWith` links and shows a detail card with Available / Coming soon status.
- Scene 5 `home/operations.tsx`: bento of what works today (connected workflows with a travelling record, AI proposals, automatic record updates, centralized management), a guarantees strip, and an "On the roadmap" strip generated only from catalog `coming-soon` apps.
- Scene 6 `home/final-scene.tsx`: closing statement settles in while app icons rise with parallax depth (desktop); Try it free, Sign in, Compare plans; ink band flows into the footer.
- Removed (orphaned by the redesign, homepage-only): `portal/command-demo.tsx`, `portal/ecosystem-map.tsx`, `portal/product-tour.tsx`.

## Testing (Batch 7)
- `tsc` clean, ESLint clean on changed files, unit tests 447/447, production build compiles.
- Browser (dev server): scroll progress measured at 0 / 0.25 / 0.6 through the pinned scene; all four intents, Confirm, Cancel path and free-text fallback; keyboard entry; onboarding screens per step; orbit selection; no page errors.
- No horizontal overflow at 360, 390, 768, 1024, 1440. Pinned scenes become normal sections below 768px. Reduced motion: `--p = 1`, no sticky pinning, no keyframes. Dark theme checked.

## Follow-up: device-by-device responsiveness pass (Completed)
- Orbit icons on phones are scaled as a whole (`max-sm:scale-[0.74]`) instead of resized, so the tile, artwork and selection ring stay in proportion.
- Onboarding screens on phones and tablets take their natural height and the full container width (no clipping of the "Continue" bar, form fields or activation email); the "Activate" card wraps on narrow screens; values never wrap inside fields.
- Pinned scenes only where there is room: `min-width: 768px` and `min-height: 600px` (landscape phones scroll normally).
- AI panel: `clamp(420px, 100svh − 110px, 600px)` when unpinned; fills the pinned stage up to 820px; on windows shorter than 820px the heading is smaller and the intro line is hidden so the demo keeps ~500px.
- Verified with no horizontal overflow and a usable panel at 320×568, 360×640, 390×844, 430×932, 844×390, 768×1024, 820×1180, 1024×768, 1280×720, 1440×900, 1920×1080, 2560×1440; tap selection works in the orbit.

## Known issues / notes
- The homepage no longer shows the industries grid, pricing teaser and FAQ; those live on their own pages (Industries, Pricing, Help) and stay linked from the header and footer.
- Animated Lordicon files are requested only for the selected app in the orbit and the AI empty state; everything else uses posters.

## Next step
None required. Possible follow-up: a short reduced-data variant of the hero device for very slow connections.
