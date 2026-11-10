# Product Tours and Coach Marks

A product tour guides a new or returning user through the real interface: it highlights an element, explains what it does in this product's language, and moves on. Tours are built from the actual screens, not from screenshots or mock UI.

## 1. Principles

- **Derived from the product.** Every step targets a real element in the real page. Step copy uses the product's own terms, workflows, and brand voice (read `brand-kit/README.md` for tone). No generic "Welcome to our amazing app" copy.
- **Short.** 3 to 6 steps per tour. One idea per step. Each step is one or two sentences.
- **Skippable and replayable.** Every tour can be skipped at any step and restarted from a Help menu item ("Replay tour"). Skipping never blocks the app.
- **Triggered at the right moment.** Start a feature tour the first time a user reaches that feature, not on every page load. Never auto-start tours on top of an open dialog or during a form submission.
- **Accessible.** The tour is a dialog-like card with focus management, Escape to exit, arrow keys to move, and a screen-reader-announced step count. The spotlight never traps the keyboard.
- **Respectful of motion.** Spotlight movement uses short transitions; reduced-motion users get instant moves.
- **Non-destructive.** A tour never clicks, submits, or changes data on the user's behalf.
- **Empty-state guidance too.** For a brand-new account with no data, a "Get started" checklist (real tasks with real completion state) is often better than a tour. Use both where they fit.

## 2. Anchors in the markup

Add `data-tour` attributes to the real elements that a tour needs. Keep the names stable and descriptive.

```tsx
<Button data-tour="create-project" icon={Plus} tooltip="Create a new project">New project</Button>
<aside data-tour="sidebar-nav">...</aside>
```

Rules:
- Anchor the main action, the primary navigation, the key data view, and the key settings. Not every element.
- If an anchor is missing (the user has no permission, or the element is conditionally rendered), the step is skipped automatically.
- Anchored elements must be visible at the time of the step. The tour scrolls them into view.

## 3. Tour definitions per feature

Keep tour content next to the feature it describes, so it stays in sync with the UI.

```ts
// src/features/projects/tour.ts
import type { TourDefinition } from '@/features/tour/types'

export const projectsTour: TourDefinition = {
  id: 'projects-v1',                // bump the version when the steps change
  title: 'Projects tour',
  steps: [
    {
      target: 'create-project',
      title: 'Start a project',
      body: 'Create a project to group related tasks, files, and deadlines.',
      placement: 'bottom',
    },
    {
      target: 'project-filters',
      title: 'Find work fast',
      body: 'Filter by status or owner. Your filters stay applied when you come back.',
      placement: 'bottom',
    },
    {
      target: 'project-row-actions',
      title: 'Act on a project',
      body: 'Open the More menu on any project to edit, duplicate, or archive it.',
      placement: 'left',
    },
  ],
}
```

Write copy from real behavior. Check each claim against the code before shipping (for example, "Your filters stay applied" must be true).

## 4. Types

```ts
// src/features/tour/types.ts
export type TourPlacement = 'top' | 'bottom' | 'left' | 'right'

export interface TourStep {
  target: string        // value of data-tour
  title: string
  body: string
  placement?: TourPlacement
}

export interface TourDefinition {
  id: string            // includes a version suffix
  title: string
  steps: TourStep[]
}
```

## 5. Tour provider

Tour state is UI preference, so `localStorage` in a try/catch is acceptable. Keep it isolated to this module.

```tsx
// src/features/tour/tour-provider.tsx
'use client'
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, ArrowRight, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import type { TourDefinition } from './types'

interface TourContextValue {
  start: (tour: TourDefinition, options?: { force?: boolean }) => void
  isDone: (tourId: string) => boolean
}

const TourContext = createContext<TourContextValue | null>(null)
const storageKey = (id: string) => `tour:${id}:done`

function readDone(id: string) {
  try { return window.localStorage.getItem(storageKey(id)) === '1' } catch { return false }
}
function writeDone(id: string) {
  try { window.localStorage.setItem(storageKey(id), '1') } catch { /* storage unavailable: tour simply repeats */ }
}

export function TourProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<TourDefinition | null>(null)
  const [index, setIndex] = useState(0)

  const finish = useCallback((tour: TourDefinition | null, completed: boolean) => {
    if (tour && completed) writeDone(tour.id)
    setActive(null)
    setIndex(0)
  }, [])

  const start = useCallback<TourContextValue['start']>((tour, options) => {
    if (!options?.force && readDone(tour.id)) return
    setIndex(0)
    setActive(tour)
  }, [])

  const value = useMemo(() => ({ start, isDone: readDone }), [start])

  return (
    <TourContext.Provider value={value}>
      {children}
      {active && (
        <TourOverlay
          tour={active}
          index={index}
          setIndex={setIndex}
          onClose={(completed) => finish(active, completed)}
        />
      )}
    </TourContext.Provider>
  )
}

export function useTour() {
  const ctx = useContext(TourContext)
  if (!ctx) throw new Error('useTour must be used inside TourProvider')
  return ctx
}

function TourOverlay({ tour, index, setIndex, onClose }: {
  tour: TourDefinition
  index: number
  setIndex: (i: number) => void
  onClose: (completed: boolean) => void
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [rect, setRect] = useState<DOMRect | null>(null)
  // Keep the latest close handler in a ref so effects do not re-run on every render.
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const steps = tour.steps
  const step = steps[index]
  const reduceMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  // Find the target; skip steps whose anchor is not rendered.
  useLayoutEffect(() => {
    if (!step) return
    const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`)
    if (!el) {
      if (index < steps.length - 1) setIndex(index + 1)
      else closeRef.current(true)
      return
    }
    el.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' })
    const measure = () => setRect(el.getBoundingClientRect())
    const t = window.setTimeout(measure, reduceMotion ? 0 : 250) // after the smooth scroll
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [step, index, steps.length, setIndex, reduceMotion])

  // Keyboard: Escape exits, arrows move.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeRef.current(false)
      if (e.key === 'ArrowRight') setIndex(Math.min(index + 1, steps.length - 1))
      if (e.key === 'ArrowLeft') setIndex(Math.max(index - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, steps.length, setIndex])

  // Move focus into the card when a step appears.
  useEffect(() => { cardRef.current?.focus() }, [index])

  if (!step || !rect) return null

  const pad = 8
  const cardWidth = Math.min(320, window.innerWidth - 24)
  const placement = step.placement ?? 'bottom'
  let top = placement === 'top' ? rect.top - pad - 12 : rect.bottom + pad + 12
  let left = rect.left + rect.width / 2 - cardWidth / 2
  if (placement === 'left') { left = rect.left - cardWidth - 16; top = rect.top }
  if (placement === 'right') { left = rect.right + 16; top = rect.top }
  left = Math.max(12, Math.min(left, window.innerWidth - cardWidth - 12))
  top = Math.max(12, Math.min(top, window.innerHeight - 220))

  const isLast = index === steps.length - 1

  return createPortal(
    <div className="fixed inset-0 z-[60]" role="presentation">
      {/* Spotlight: the cutout is the target, the rest dims. Pointer events outside the target are blocked. */}
      <div
        aria-hidden
        className="pointer-events-auto fixed rounded-card transition-[top,left,width,height] duration-300 motion-reduce:transition-none"
        style={{
          top: rect.top - pad, left: rect.left - pad,
          width: rect.width + pad * 2, height: rect.height + pad * 2,
          boxShadow: '0 0 0 9999px var(--overlay)',
        }}
      />
      <div
        ref={cardRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        className="fixed rounded-card border border-border bg-surface-raised p-4 text-text-primary shadow-overlay outline-none transition-[top,left] duration-300 motion-reduce:transition-none"
        style={{ top, left, width: cardWidth }}
      >
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-primary">{tour.title} · {index + 1} of {steps.length}</p>
            <h2 id="tour-title" className="text-base font-semibold">{step.title}</h2>
          </div>
          <IconButton icon={X} label="End tour" variant="ghost" size="sm" onClick={() => onClose(false)} />
        </div>
        <p id="tour-body" className="text-sm leading-relaxed text-text-secondary">{step.body}</p>

        <div className="mt-4 flex items-center justify-between gap-2">
          {/* Progress dots */}
          <div className="flex gap-1.5" aria-hidden>
            {steps.map((s, i) => (
              <span key={s.target} className={`h-1.5 rounded-full transition-all duration-300 ${i === index ? 'w-5 bg-primary' : 'w-1.5 bg-border-strong'}`} />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {index > 0 && (
              <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={() => setIndex(index - 1)} tooltip="Previous step (Left arrow)">Back</Button>
            )}
            <Button size="sm" iconEnd={isLast ? undefined : ArrowRight} onClick={() => (isLast ? onClose(true) : setIndex(index + 1))} tooltip={isLast ? 'Finish the tour' : 'Next step (Right arrow)'}>
              {isLast ? 'Got it' : 'Next'}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
```

Tour rules and known limitations of this implementation:
- The spotlight's `box-shadow` dims everything outside the target. Pointer events on the dim layer are not blocked by this sample, so add a full-screen transparent blocker if the product must prevent clicks outside the target during a tour.
- Viewport measurements are read on render; for complex layouts, measure inside `requestAnimationFrame`.
- Tooltips inside the tour card use the Button tooltip. Tooltips and tours both use the portal; check z-index ordering (tour `z-[60]`, tooltips `z-50`). Raise tooltips to `z-[70]` if they must appear over the tour.
- The `--overlay` token must have an alpha value, for example `rgb(0 0 0 / 0.55)` in light and `rgb(0 0 0 / 0.7)` in dark.

## 6. Starting tours

Start a feature tour the first time the user lands on that feature, after the page has rendered:

```tsx
'use client'
import { useEffect } from 'react'
import { useTour } from '@/features/tour/tour-provider'
import { projectsTour } from '@/features/projects/tour'

export function ProjectsTourTrigger({ hasProjects }: { hasProjects: boolean }) {
  const { start } = useTour()
  useEffect(() => {
    // Only start when the real UI exists (the user has data or the empty state is visible).
    const t = window.setTimeout(() => start(projectsTour), 800)
    return () => window.clearTimeout(t)
  }, [start, hasProjects])
  return null
}
```

Add a Help menu item that replays tours:

```tsx
<DropdownMenuItem icon={Compass} onSelect={() => start(projectsTour, { force: true })}>
  Replay projects tour
</DropdownMenuItem>
```

Guard against launching while a dialog is open: check `document.querySelector('[role="dialog"]')` and retry later.

## 7. Contextual guidance and onboarding checklists

Complement tours with:

- **Empty-state guidance:** each empty view says what the feature is for and the first action (`EmptyState` in `components.md`).
- **Inline hints:** a dismissible, designed hint banner for a non-obvious setting, with a "Don't show again" choice stored in preferences.
- **Setup checklist:** a list of real setup tasks ("Connect your calendar", "Invite a teammate") whose completion comes from the data layer, not from a manual checkbox. Show progress with a meter and a button to continue.

Never invent completion state. A checklist item is checked only when the underlying data confirms it.

## 8. Writing tour copy

- Lead with the user's goal, then the control: "Create a project to group your tasks" rather than "This is the Create button."
- Use the product's nouns exactly as the UI labels them.
- Keep each body under about 140 characters.
- Use sentence case for titles.
- Name the keyboard shortcut only when it exists.
- Translate the tour alongside the UI if the app is multilingual.

## 9. Tour QA

For each tour:
- Run it at mobile and desktop widths. Anchors that move into the overflow menu on mobile need a mobile variant or a skipped step.
- Run it in dark and light themes; check the card and spotlight contrast.
- Run it with keyboard only: Tab, Enter, Escape, arrows.
- Run it with a screen reader; confirm the title and step count are announced.
- Run it with reduced motion enabled.
- Confirm that each step's claim matches real behavior.
- Confirm that skipping and replaying both work, and that a finished tour does not reappear.
