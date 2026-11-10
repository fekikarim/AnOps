# Designed Components

Every component below lives in `src/components/ui/`, uses semantic tokens, and supports all relevant states. Copy the pattern, then adapt the names to the repo.

## 1. Icon standard

- Library: `lucide-react` (or the repo's existing family).
- Sizes: 16 px inside buttons with small text, 18 px in default buttons and menus, 20 px in navigation and headers, 24 px for empty-state illustrations.
- Stroke: keep the default stroke width (2) at 16 px and 18 px; use `strokeWidth={1.75}` at 20 px and above for a lighter, modern look. Use the same value everywhere in a given context.
- Decorative icons get `aria-hidden`. Icon-only controls get an `aria-label`.
- Icon and label gap is `gap-2` for default and `gap-1.5` for small controls.
- Recommended mapping: Add `Plus`, Edit `Pencil`, Delete `Trash2`, Save `Check` or `Save`, Cancel or discard `X` or `Undo2`, Search `Search`, Filter `SlidersHorizontal`, Refresh `RotateCw`, Download `Download`, Upload `Upload`, Copy `Copy`, Share `Share2`, Settings `Settings`, Help `CircleHelp`, Theme `Sun` / `Moon`, Close `X`, Menu `Menu`, More `EllipsisVertical`, Info `Info`, Warning `TriangleAlert`, Success `CircleCheck`, Error `CircleAlert`, Back `ArrowLeft`, External link `ExternalLink`, Tour `Compass` or `Sparkles`.

## 2. Button

Rules: always designed, always a variant, always all states, always bounded labels, icon where it aids recognition.

```tsx
// src/components/ui/button.tsx
'use client'
import { forwardRef, type ButtonHTMLAttributes, type ComponentType, type ReactNode } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2, type LucideProps } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip'

const button = cva(
  [
    'group relative inline-flex items-center justify-center gap-2 select-none',
    'rounded-control font-medium whitespace-nowrap',
    'transition-[background-color,color,box-shadow,transform,border-color] duration-200 ease-out',
    'active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    'disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100',
    'aria-busy:cursor-progress aria-busy:opacity-80',
    '[&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary:
          'bg-primary text-text-on-primary shadow-raised hover:bg-primary-hover active:bg-primary-active',
        secondary:
          'bg-secondary text-text-primary hover:bg-secondary-hover',
        outline:
          'border border-border-strong bg-surface text-text-primary hover:bg-surface-muted hover:border-primary/40',
        ghost:
          'text-text-secondary hover:bg-surface-muted hover:text-text-primary',
        soft:
          'bg-primary-soft text-primary hover:bg-primary/15',
        destructive:
          'bg-danger text-white shadow-raised hover:bg-danger/90',
        'destructive-outline':
          'border border-danger/40 bg-danger-soft text-danger hover:bg-danger/15',
        link:
          'h-auto p-0 text-primary underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-8 px-3 text-sm [&_svg]:size-4',
        md: 'h-10 px-4 text-sm [&_svg]:size-[18px]',
        lg: 'h-12 px-5 text-base [&_svg]:size-5',
        icon: 'size-10 p-0 [&_svg]:size-[18px]',
      },
      fullWidth: { true: 'w-full', false: '' },
    },
    defaultVariants: { variant: 'primary', size: 'md', fullWidth: false },
  },
)

type IconType = ComponentType<LucideProps>

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {
  icon?: IconType
  iconEnd?: IconType
  loading?: boolean
  loadingLabel?: string
  tooltip?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, fullWidth, icon: Icon, iconEnd: IconEnd, loading, loadingLabel, tooltip, className, disabled, children, type = 'button', ...props },
  ref,
) {
  const isDisabled = disabled || loading

  const node = (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cn(button({ variant, size, fullWidth }), className)}
      {...props}
    >
      {loading ? (
        <Loader2 className="animate-spin" aria-hidden />
      ) : (
        Icon && <Icon aria-hidden />
      )}
      {/* min-w-0 + truncate keeps long labels inside the button */}
      <span className="min-w-0 truncate">{loading && loadingLabel ? loadingLabel : children}</span>
      {IconEnd && !loading && <IconEnd aria-hidden />}
    </button>
  )

  if (!tooltip) return node

  // Disabled buttons do not emit pointer events, so the tooltip anchor is a wrapper span.
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {isDisabled ? <span className="inline-flex max-w-full" tabIndex={0}>{node}</span> : node}
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  )
})
```

Use the `Button` component for every button. Reading the component tells you what each prop does.

Label length rules:
- Keep labels to 1 to 3 words. "Save changes", "Export CSV", "Invite member".
- If the label might grow with translations or data, give the button a `max-w-full` and keep the parent flexible (`min-w-0`), and put the full text in `tooltip`.
- Never wrap button text onto two lines. The `whitespace-nowrap` class enforces it.
- On narrow screens, drop secondary text in favor of an icon with a tooltip, but keep the primary action text visible.

### IconButton (icon-only, always labelled)

```tsx
// src/components/ui/icon-button.tsx
'use client'
import { forwardRef, type ComponentType } from 'react'
import type { LucideProps } from 'lucide-react'
import { Button, type ButtonProps } from './button'

interface IconButtonProps extends Omit<ButtonProps, 'icon' | 'children' | 'iconEnd'> {
  icon: ComponentType<LucideProps>
  label: string // required: becomes aria-label and tooltip
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, tooltip, variant = 'ghost', size = 'icon', ...props },
  ref,
) {
  return (
    <Button
      ref={ref}
      icon={icon}
      variant={variant}
      size={size}
      aria-label={label}
      tooltip={tooltip ?? label}
      {...props}
    />
  )
})
```

Note: Button renders the label inside a `truncate` span. For `size="icon"` the label is hidden visually by the icon-only layout, so pass the label through `aria-label` only and keep the visible content to the icon. Adjust the Button to render no span when `size="icon"` if the repo style differs.

### Button state table

| State | Visual | Behavior |
|---|---|---|
| Default | Variant colors, shadow for primary | Ready |
| Hover | Darker or tinted background, border shift | Pointer feedback only; not required on touch |
| Focus-visible | 2 px focus ring with offset | Keyboard focus always visible |
| Active | Slight scale, darker background | Pressed feedback |
| Disabled | 50% opacity, no pointer | Tooltip explains the reason via wrapper |
| Loading | Spinner replaces leading icon, `aria-busy`, optional label | Prevents double submit |
| Selected (toggle) | `aria-pressed="true"` with the soft variant | Clear selected state |
| Hidden | Not rendered | Use conditional rendering, not `display:none` on focusable content |
| Discard or cancel | Ghost or outline with `Undo2` or `X` | Asks confirmation when unsaved changes exist |

## 3. Tooltip

```tsx
// src/components/ui/tooltip.tsx
'use client'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '@/lib/utils'

export const TooltipProvider = TooltipPrimitive.Provider
export const Tooltip = TooltipPrimitive.Root
export const TooltipTrigger = TooltipPrimitive.Trigger

export function TooltipContent({ className, sideOffset = 8, ...props }: TooltipPrimitive.TooltipContentProps) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        collisionPadding={12}
        className={cn(
          'z-50 max-w-xs rounded-control bg-foreground px-2.5 py-1.5 text-xs font-medium text-background shadow-raised',
          'data-[state=delayed-open]:animate-in data-[state=closed]:animate-out',
          'data-[state=closed]:fade-out-0 data-[state=delayed-open]:fade-in-0 data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1',
          'motion-reduce:animate-none',
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  )
}
```

Tooltip rules:
- Show on hover and keyboard focus (Radix does this).
- Use for: icon-only controls, truncated labels, disabled-state explanations, abbreviations, and non-obvious shortcuts.
- Do not use for essential instructions. Put those in visible helper text.
- Keep copy under about 60 characters. Include the keyboard shortcut when one exists, for example "Save (Ctrl+S)".
- Never use native `title` as the only tooltip.
- Tooltips do not appear on touch by default. For touch-critical info, use visible text or a popover on tap.

## 4. Dropdown menu (designed, never default)

```tsx
// src/components/ui/dropdown-menu.tsx
'use client'
import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu'
import { Check, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export const DropdownMenu = DropdownPrimitive.Root
export const DropdownMenuTrigger = DropdownPrimitive.Trigger
export const DropdownMenuGroup = DropdownPrimitive.Group

export function DropdownMenuContent({ className, sideOffset = 6, align = 'end', ...props }: DropdownPrimitive.DropdownMenuContentProps) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        sideOffset={sideOffset}
        align={align}
        collisionPadding={12}
        className={cn(
          'z-50 min-w-[12rem] max-w-[min(20rem,calc(100vw-1.5rem))] overflow-hidden rounded-card border border-border',
          'bg-surface-raised p-1.5 text-text-primary shadow-overlay',
          'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          'data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2',
          'motion-reduce:animate-none max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto',
          className,
        )}
        {...props}
      />
    </DropdownPrimitive.Portal>
  )
}

interface ItemProps extends DropdownPrimitive.DropdownMenuItemProps {
  icon?: React.ComponentType<{ className?: string }>
  shortcut?: string
  destructive?: boolean
}

export function DropdownMenuItem({ icon: Icon, shortcut, destructive, className, children, ...props }: ItemProps) {
  return (
    <DropdownPrimitive.Item
      className={cn(
        'relative flex min-h-9 cursor-pointer select-none items-center gap-2.5 rounded-control px-2.5 py-2 text-sm outline-none',
        'transition-colors duration-150',
        'data-[highlighted]:bg-surface-muted data-[highlighted]:text-text-primary',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        destructive && 'text-danger data-[highlighted]:bg-danger-soft data-[highlighted]:text-danger',
        className,
      )}
      {...props}
    >
      {Icon && <Icon className="size-4 shrink-0 text-text-muted" aria-hidden />}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {shortcut && <kbd className="ms-auto font-sans text-xs text-text-muted">{shortcut}</kbd>}
    </DropdownPrimitive.Item>
  )
}

export function DropdownMenuLabel({ className, ...props }: DropdownPrimitive.DropdownMenuLabelProps) {
  return <DropdownPrimitive.Label className={cn('px-2.5 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-text-muted', className)} {...props} />
}

export function DropdownMenuSeparator({ className, ...props }: DropdownPrimitive.DropdownMenuSeparatorProps) {
  return <DropdownPrimitive.Separator className={cn('-mx-1.5 my-1.5 h-px bg-border', className)} {...props} />
}
```

Usage example:

```tsx
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <IconButton icon={EllipsisVertical} label="More actions" variant="ghost" />
  </DropdownMenuTrigger>
  <DropdownMenuContent>
    <DropdownMenuLabel>Project</DropdownMenuLabel>
    <DropdownMenuItem icon={Pencil} shortcut="E" onSelect={onEdit}>Edit</DropdownMenuItem>
    <DropdownMenuItem icon={Copy} onSelect={onDuplicate}>Duplicate</DropdownMenuItem>
    <DropdownMenuItem icon={Download} disabled>Export (requires Pro)</DropdownMenuItem>
    <DropdownMenuSeparator />
    <DropdownMenuItem icon={Trash2} destructive onSelect={onDelete}>Delete</DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

Rules:
- Every trigger is a designed `Button` or `IconButton` with a tooltip and `aria-label`.
- Hidden items are not rendered. Use `{canEdit && <DropdownMenuItem ...>}`. Do not hide them with CSS.
- Disabled items explain why, in the label or a helper line.
- Destructive items sit last, after a separator, and use `destructive`. Their action opens a confirmation dialog.
- Keyboard: arrow keys, Home/End, typeahead, Escape, and Enter all work through Radix.
- Long option lists use a scrollable area with a custom scrollbar, or a searchable combobox.

## 5. Select (styled, never native)

Use Radix Select (or a styled Combobox for long lists with search). Trigger uses the same height, radius, border, and focus ring as `Input`.

```tsx
// src/components/ui/select.tsx
'use client'
import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export const Select = SelectPrimitive.Root
export const SelectValue = SelectPrimitive.Value

export function SelectTrigger({ className, children, ...props }: SelectPrimitive.SelectTriggerProps) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        'flex h-10 w-full min-w-0 items-center justify-between gap-2 rounded-control border border-input bg-surface px-3 text-sm text-text-primary',
        'transition-colors hover:border-border-strong',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'data-[placeholder]:text-text-muted',
        className,
      )}
      {...props}
    >
      <span className="min-w-0 truncate">{children}</span>
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="size-4 shrink-0 text-text-muted transition-transform data-[state=open]:rotate-180" aria-hidden />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

export function SelectContent({ className, children, ...props }: SelectPrimitive.SelectContentProps) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position="popper"
        sideOffset={6}
        collisionPadding={12}
        className={cn(
          'z-50 max-h-[min(20rem,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-card border border-border bg-surface-raised p-1.5 shadow-overlay',
          'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport className="p-0.5">{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

export function SelectItem({ className, children, ...props }: SelectPrimitive.SelectItemProps) {
  return (
    <SelectPrimitive.Item
      className={cn(
        'relative flex min-h-9 cursor-pointer select-none items-center rounded-control py-2 ps-8 pe-3 text-sm outline-none',
        'data-[highlighted]:bg-surface-muted data-[state=checked]:text-primary',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <span className="absolute start-2.5 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="size-4" aria-hidden />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}
```

## 6. Form field system

Every field is wrapped in `Field`. The wrapper owns label, description, error, and required marking, so every field looks and behaves the same.

```tsx
// src/components/ui/field.tsx
'use client'
import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react'
import { AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface FieldProps {
  label: string
  hint?: ReactNode          // helper text, shown under the control
  error?: string
  required?: boolean
  optionalLabel?: string    // e.g. "Optional", shown instead of an asterisk when you prefer
  className?: string
  children: ReactElement<{ id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean; required?: boolean }>
}

export function Field({ label, hint, error, required, optionalLabel, className, children }: FieldProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(' ') || undefined

  const control = isValidElement(children)
    ? cloneElement(children, {
        id,
        'aria-describedby': describedBy,
        'aria-invalid': Boolean(error) || undefined,
        required,
      })
    : children

  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium text-text-primary">
          {label}
          {required ? <span className="ms-0.5 text-danger" aria-hidden>*</span> : optionalLabel && (
            <span className="ms-1.5 text-xs font-normal text-text-muted">{optionalLabel}</span>
          )}
        </label>
      </div>
      {control}
      {hint && !error && (
        <p id={hintId} className="text-xs leading-relaxed text-text-muted">{hint}</p>
      )}
      {error && (
        <p id={errorId} role="alert" className="flex items-start gap-1.5 text-xs leading-relaxed text-danger">
          <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>{error}</span>
        </p>
      )}
    </div>
  )
}
```

Input with placeholder and error styling:

```tsx
// src/components/ui/input.tsx
'use client'
import { forwardRef, type InputHTMLAttributes, type ComponentType } from 'react'
import type { LucideProps } from 'lucide-react'
import { cn } from '@/lib/utils'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: ComponentType<LucideProps>
  endSlot?: React.ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, icon: Icon, endSlot, type = 'text', ...props },
  ref,
) {
  return (
    <div className="group relative flex min-w-0 items-center">
      {Icon && <Icon aria-hidden className="pointer-events-none absolute start-3 size-4 text-text-muted transition-colors group-focus-within:text-primary" />}
      <input
        ref={ref}
        type={type}
        className={cn(
          'h-10 w-full min-w-0 rounded-control border border-input bg-surface px-3 text-base text-text-primary md:text-sm',
          'placeholder:text-text-muted placeholder:opacity-80',
          'transition-[border-color,box-shadow] duration-150',
          'hover:border-border-strong',
          'focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring/40',
          'aria-[invalid=true]:border-danger aria-[invalid=true]:ring-danger/20',
          'read-only:bg-surface-muted read-only:text-text-secondary',
          'disabled:cursor-not-allowed disabled:opacity-50',
          Icon && 'ps-9',
          endSlot && 'pe-10',
          className,
        )}
        {...props}
      />
      {endSlot && <div className="absolute end-2 flex items-center">{endSlot}</div>}
    </div>
  )
})
```

Textarea uses the same classes with `min-h-24 py-2.5 resize-y`. Add a character counter as `hint` when `maxLength` matters.

### Placeholder rules

Every field needs a placeholder that shows the expected format, example, or the right entry. Examples:

| Field | Placeholder | Helper text |
|---|---|---|
| Email | `name@company.com` | Used for sign-in and invoices |
| Phone | `+216 20 123 456` | Include country code |
| Project name | `Q3 website redesign` | Shown to all members |
| Amount | `0.00` | In the account currency |
| Date | `DD/MM/YYYY` | Local date format |
| Search | `Search projects, tasks, people` | Press / to focus |
| URL | `https://example.com` | Must start with https:// |

Never write placeholders that look like real data ("John Doe", "123456"). Placeholders are hints, not fake values. Placeholders must disappear when typing, so never place required instructions in them.

### Form layout grid

```tsx
<form className="space-y-10">
  <section className="space-y-5">
    <header>
      <h2 className="text-base font-semibold text-text-primary">Profile</h2>
      <p className="text-sm text-text-muted">How teammates see you.</p>
    </header>
    <div className="grid gap-5 sm:grid-cols-2">
      <Field label="First name" required className="min-w-0"><Input placeholder="Amine" /></Field>
      <Field label="Last name" required><Input placeholder="Ben Salah" /></Field>
      <Field label="Bio" hint="Up to 160 characters" className="sm:col-span-2"><Textarea maxLength={160} /></Field>
    </div>
  </section>
  <footer className="sticky bottom-0 -mx-4 flex flex-col-reverse gap-3 border-t border-border bg-background/90 px-4 py-4 backdrop-blur sm:mx-0 sm:flex-row sm:justify-end sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
    <Button variant="ghost" icon={Undo2} tooltip="Discard all unsaved changes">Discard</Button>
    <Button type="submit" icon={Check} loading={pending} loadingLabel="Saving">Save changes</Button>
  </footer>
</form>
```

Structure rules:
- Sections have a heading and one sentence of description. Related fields share a section.
- Column rules: one column on mobile; two columns from `sm` for short related fields; full width for long text, addresses, and descriptions.
- Field gaps: 20 px (`gap-5`). Section gaps: 40 px (`space-y-10`).
- Action footers are sticky on mobile so the primary action stays reachable, and sit at the end on desktop.
- Primary action on the right on desktop, at the top of the stack on mobile (the mobile flip happens with `flex-col-reverse`, so check the visual order).
- Destructive actions are never next to the primary action without space.

## 7. Tags input

```tsx
// src/components/ui/tags-input.tsx
'use client'
import { useState, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface TagsInputProps {
  value: string[]
  onChange: (tags: string[]) => void
  placeholder?: string   // e.g. "Type a skill and press Enter"
  max?: number
  id?: string
  'aria-describedby'?: string
}

export function TagsInput({ value, onChange, placeholder = 'Type and press Enter', max = 10, id, ...aria }: TagsInputProps) {
  const [draft, setDraft] = useState('')

  function add(raw: string) {
    const tag = raw.trim().replace(/,$/, '')
    if (!tag || value.includes(tag) || value.length >= max) return
    onChange([...value, tag])
    setDraft('')
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(draft) }
    if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1))
  }

  return (
    <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-control border border-input bg-surface px-2 py-1.5 transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-focus-ring/40 hover:border-border-strong">
      {value.map((tag) => (
        <span key={tag} className="inline-flex max-w-full items-center gap-1 rounded-full bg-primary-soft py-1 ps-2.5 pe-1 text-xs font-medium text-primary">
          <span className="min-w-0 truncate">{tag}</span>
          <button
            type="button"
            onClick={() => onChange(value.filter((t) => t !== tag))}
            aria-label={`Remove ${tag}`}
            className="inline-flex size-5 items-center justify-center rounded-full hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </span>
      ))}
      <input
        id={id}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => add(draft)}
        placeholder={value.length >= max ? `Maximum ${max} reached` : placeholder}
        disabled={value.length >= max}
        className={cn('h-8 min-w-[10ch] flex-1 bg-transparent px-1 text-base outline-none placeholder:text-text-muted md:text-sm')}
        {...aria}
      />
    </div>
  )
}
```

Rules: a helper line states the limit ("Up to 10 skills"). Chips never overflow (`max-w-full truncate`). Tags are removed with a labelled button, never a bare "×".

## 8. Password input and strength meter

```tsx
// src/components/ui/password-input.tsx
'use client'
import { useState } from 'react'
import { Eye, EyeOff, Lock } from 'lucide-react'
import { Input } from './input'
import { IconButton } from './icon-button'

export function PasswordInput(props: Omit<React.ComponentProps<typeof Input>, 'type' | 'endSlot' | 'icon'>) {
  const [visible, setVisible] = useState(false)
  return (
    <Input
      {...props}
      type={visible ? 'text' : 'password'}
      icon={Lock}
      autoComplete={props.autoComplete ?? 'current-password'}
      endSlot={
        <IconButton
          icon={visible ? EyeOff : Eye}
          label={visible ? 'Hide password' : 'Show password'}
          size="sm"
          variant="ghost"
          aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}
        />
      }
    />
  )
}
```

```ts
// src/lib/password-strength.ts
export type Strength = 0 | 1 | 2 | 3 | 4

export function scorePassword(pw: string): { score: Strength; label: string; checks: Record<string, boolean> } {
  const checks = {
    length: pw.length >= 12,
    lower: /[a-z]/.test(pw),
    upper: /[A-Z]/.test(pw),
    digit: /\d/.test(pw),
    symbol: /[^A-Za-z0-9]/.test(pw),
  }
  const passed = Object.values(checks).filter(Boolean).length
  const score = (pw.length === 0 ? 0 : Math.min(4, Math.max(1, passed - 1))) as Strength
  const label = ['Enter a password', 'Weak', 'Fair', 'Good', 'Strong'][score]
  return { score, label, checks }
}
```

```tsx
// src/components/ui/password-strength.tsx
'use client'
import { Check, Circle } from 'lucide-react'
import { scorePassword } from '@/lib/password-strength'
import { cn } from '@/lib/utils'

const bar = ['bg-border', 'bg-danger', 'bg-warning', 'bg-info', 'bg-success'] as const

export function PasswordStrength({ value }: { value: string }) {
  const { score, label, checks } = scorePassword(value)
  const rules: [keyof typeof checks, string][] = [
    ['length', 'At least 12 characters'],
    ['lower', 'A lowercase letter'],
    ['upper', 'An uppercase letter'],
    ['digit', 'A number'],
    ['symbol', 'A symbol'],
  ]
  return (
    <div className="space-y-2.5" aria-live="polite">
      <div className="flex items-center gap-2">
        <div className="grid flex-1 grid-cols-4 gap-1.5" role="meter" aria-valuemin={0} aria-valuemax={4} aria-valuenow={score} aria-label="Password strength">
          {[1, 2, 3, 4].map((i) => (
            <span key={i} className={cn('h-1.5 rounded-full transition-colors duration-300', i <= score ? bar[score] : 'bg-border')} />
          ))}
        </div>
        <span className="min-w-[4.5rem] text-end text-xs font-medium text-text-secondary">{label}</span>
      </div>
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {rules.map(([key, text]) => (
          <li key={key} className={cn('flex items-center gap-2 text-xs', checks[key] ? 'text-success' : 'text-text-muted')}>
            {checks[key] ? <Check className="size-3.5 shrink-0" aria-hidden /> : <Circle className="size-3.5 shrink-0" aria-hidden />}
            <span>{text}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

Rules: the meter communicates through text and icons, not color alone. Never block paste. Never reveal the password in logs or analytics. Always use the server as the final check.

## 9. Checkbox, radio group, and switch

These are never browser defaults.

```tsx
// src/components/ui/checkbox.tsx
'use client'
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { Check, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Checkbox({ className, ...props }: CheckboxPrimitive.CheckboxProps) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        'peer size-5 shrink-0 rounded-[0.375rem] border border-border-strong bg-surface transition-all duration-150',
        'hover:border-primary/60',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-text-on-primary',
        'data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-text-on-primary',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-[invalid=true]:border-danger',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center">
        {props.checked === 'indeterminate' ? <Minus className="size-3.5" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}
```

Pair every checkbox with a `<label>` (use `Field`-style or a wrapping `<label>` with `cursor-pointer`), and make the whole row clickable. Use a card-style row for consent and option choices: bordered, `data-[state=checked]:border-primary data-[state=checked]:bg-primary-soft`.

Radio group: use `@radix-ui/react-radio-group`, with `Circle` as the indicator (`size-2.5 rounded-full bg-primary`). Use a segmented or card-style layout for two to four options with descriptions. Arrow keys are handled by Radix.

Switch: `@radix-ui/react-switch`, track `h-6 w-11 rounded-full` with `data-[state=checked]:bg-primary`, thumb with `shadow-raised` and a `transition-transform`, a visible label to its left or above, and a description line. Use `role="switch"` (Radix does this).

## 10. Dialog, confirmation, and discard guard

```tsx
// src/components/ui/dialog.tsx
'use client'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { IconButton } from './icon-button'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

export function DialogContent({ className, children, ...props }: DialogPrimitive.DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:animate-none" />
      <DialogPrimitive.Content
        className={cn(
          'fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] w-full flex-col rounded-t-dialog border border-border bg-surface-raised shadow-overlay outline-none',
          'sm:inset-x-auto sm:bottom-auto sm:start-1/2 sm:top-1/2 sm:max-h-[85dvh] sm:w-[min(32rem,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-dialog',
          'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-4 sm:data-[state=open]:zoom-in-95',
          'motion-reduce:animate-none',
          className,
        )}
        {...props}
      >
        {/* Drag handle on mobile bottom sheet */}
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-border-strong sm:hidden" aria-hidden />
        {children}
        <DialogPrimitive.Close asChild>
          <IconButton icon={X} label="Close dialog" variant="ghost" size="sm" className="absolute end-3 top-3" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('space-y-1.5 px-6 pb-2 pt-5 pe-12', className)} {...props} />
}
export function DialogTitle(props: DialogPrimitive.DialogTitleProps) {
  return <DialogPrimitive.Title className="text-lg font-semibold text-text-primary" {...props} />
}
export function DialogDescription(props: DialogPrimitive.DialogDescriptionProps) {
  return <DialogPrimitive.Description className="text-sm leading-relaxed text-text-secondary" {...props} />
}
export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col-reverse gap-2.5 border-t border-border px-6 py-4 sm:flex-row sm:justify-end', className)} {...props} />
}
```

Confirmation pattern for destructive actions:

```tsx
<Dialog open={open} onOpenChange={setOpen}>
  <DialogContent>
    <DialogHeader>
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-full bg-danger-soft text-danger"><Trash2 className="size-5" aria-hidden /></span>
        <DialogTitle>Delete “{project.name}”?</DialogTitle>
      </div>
      <DialogDescription>
        This removes the project, its {project.taskCount} tasks, and their attachments. This cannot be undone.
      </DialogDescription>
    </DialogHeader>
    <DialogFooter>
      <Button variant="ghost" onClick={() => setOpen(false)} icon={X}>Keep project</Button>
      <Button variant="destructive" icon={Trash2} loading={pending} loadingLabel="Deleting" onClick={onConfirm}>Delete project</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

Rules:
- The title names the object. The description names the consequence and reversibility.
- The safe action is the default focus target (`autoFocus` on Cancel for destructive dialogs).
- The primary button is labelled with the verb, never "OK" or "Yes".
- On mobile the dialog becomes a bottom sheet. Its content scrolls inside `max-h`.
- Do not confirm harmless actions. Confirm only destructive, irreversible, or costly actions.
- Discard with unsaved changes: intercept close and navigation, show "Discard unsaved changes?" with "Keep editing" and "Discard". Use `beforeunload` for full page exits.

## 11. Input validation

Use zod schemas as the single source of rules, shared between client and server.

```ts
// features/profile/schemas.ts
import { z } from 'zod'

export const profileSchema = z.object({
  firstName: z.string().trim().min(2, 'Enter at least 2 characters').max(60, 'Keep it under 60 characters'),
  email: z.string().trim().email('Enter an email like name@company.com'),
  website: z.string().trim().url('Start with https:// (for example https://example.com)').or(z.literal('')),
})
export type ProfileInput = z.infer<typeof profileSchema>
```

```tsx
const form = useForm<ProfileInput>({
  resolver: zodResolver(profileSchema),
  mode: 'onTouched',        // first validate on blur, then on every change
  reValidateMode: 'onChange',
})
```

Rules:
- Messages say what to do, not only what is wrong ("Enter a valid email like name@company.com").
- Show errors next to the field via `Field`, and a summary at the top of long forms with links to each field (`aria-live="polite"`).
- Keep entered values after server errors.
- Server errors map to fields when possible; otherwise show an alert above the form with a retry option.
- Success is shown only after the server confirms.

## 12. Drag and drop

Two patterns: reordering and file drop. Both need a keyboard alternative.

Sortable list with keyboard support:

```tsx
'use client'
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'

function SortableRow({ id, label }: { id: string; label: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-3 rounded-card border border-border bg-surface px-3 py-2.5 ${isDragging ? 'shadow-overlay ring-2 ring-primary/30' : ''}`}
    >
      <button
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${label}. Use arrow keys to move.`}
        className="flex size-8 cursor-grab items-center justify-center rounded-control text-text-muted hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-focus-ring active:cursor-grabbing"
      >
        <GripVertical className="size-4" aria-hidden />
      </button>
      <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
    </li>
  )
}

export function SortableList({ items, onReorder }: { items: { id: string; label: string }[]; onReorder: (next: typeof items) => void }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), // avoids accidental drags on touch
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return
    const from = items.findIndex((i) => i.id === active.id)
    const to = items.findIndex((i) => i.id === over.id)
    onReorder(arrayMove(items, from, to))
  }
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        <ul className="space-y-2">{items.map((i) => <SortableRow key={i.id} id={i.id} label={i.label} />)}</ul>
      </SortableContext>
    </DndContext>
  )
}
```

File drop zone:

```tsx
// src/components/ui/drop-zone.tsx
'use client'
import { useState, type DragEvent } from 'react'
import { UploadCloud } from 'lucide-react'
import { cn } from '@/lib/utils'

export function DropZone({ onFiles, accept, maxSizeMb = 10, hint }: { onFiles: (f: File[]) => void; accept: string; maxSizeMb?: number; hint: string }) {
  const [over, setOver] = useState(false)
  function handle(files: FileList | null) {
    if (!files) return
    onFiles(Array.from(files).filter((f) => f.size <= maxSizeMb * 1024 * 1024))
  }
  return (
    <label
      onDragOver={(e: DragEvent) => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e: DragEvent) => { e.preventDefault(); setOver(false); handle(e.dataTransfer.files) }}
      className={cn(
        'flex min-h-40 cursor-pointer flex-col items-center justify-center gap-3 rounded-card border-2 border-dashed px-6 py-8 text-center transition-colors duration-200',
        'focus-within:ring-2 focus-within:ring-focus-ring',
        over ? 'border-primary bg-primary-soft' : 'border-border-strong bg-surface-muted hover:border-primary/60',
      )}
    >
      <span className="flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary"><UploadCloud className="size-6" aria-hidden /></span>
      <span className="text-sm font-medium text-text-primary">Drop files here or <span className="text-primary underline underline-offset-4">browse</span></span>
      <span className="text-xs text-text-muted">{hint}</span>
      <input type="file" accept={accept} multiple className="sr-only" onChange={(e) => handle(e.target.files)} />
    </label>
  )
}
```

Rules: rejected files get a visible error message listing the reason, not a silent filter. Keyboard users reach the drop zone and activate it with Enter/Space through the label and input. Keep the file-type list visible in the hint.

## 13. Preview items

A preview shows the real rendered result using the same component the user will see, not a mock.

- Use a segmented control (`Tabs` styled as pills) to switch preview width: Mobile, Tablet, Desktop, rendered in a framed container with `max-w` values.
- Use `container-type: inline-size` on the frame so the component responds to its own width.
- Show the preview with the actual data for the record being edited, or the empty state if there is none.
- Provide a light/dark toggle inside the preview frame, scoped with a `.dark` wrapper only for the preview.

## 14. Badges, alerts, and status

- Badge: `inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium` with soft background and matching text color, always with an icon or text, never color alone.
- Alert: bordered panel with a status icon, title, description, and optional action. Use for page-level and form-level messages.
- Toast (Sonner): success and error after an action completes, with an optional "Undo" action where reversible. Themed through tokens. Never use toasts as the only error message for a form field.

## 15. State coverage checklist

Every data view and interactive control must define these where applicable:

| State | Designed treatment |
|---|---|
| Loading first load | Skeleton that matches final layout dimensions |
| Loading refresh | Subtle inline progress indicator, content stays visible |
| Empty (no data yet) | Icon, title, one sentence, primary action button |
| Empty (no search results) | Icon, "No matches for X", clear filters button |
| Error | Alert with what failed, retry button, support link if relevant |
| No permission | Explanation and who to ask, no leaked data |
| Success | Toast, or inline confirmation that persists until next action |
| Offline | Banner with reconnect state, actions queued or disabled explicitly |

Empty state component pattern:

```tsx
export function EmptyState({ icon: Icon, title, description, action }: { icon: ComponentType<LucideProps>; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-3 px-6 py-12 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-primary-soft text-primary"><Icon className="size-7" aria-hidden /></span>
      <h3 className="text-base font-semibold text-text-primary">{title}</h3>
      <p className="text-sm leading-relaxed text-text-secondary">{description}</p>
      {action}
    </div>
  )
}
```

## 16. Focus and hover rules across all components

- Focus ring: `focus-visible:ring-2 ring-focus-ring` with a 2 px offset on dark surfaces. Never remove focus without a replacement.
- Hover: changes background or border, never layout. Hover effects are off on touch-only devices through `@media (hover: hover)` when they are decorative.
- Active: `scale-[0.98]` at most on buttons; otherwise a darker background.
- Hidden: use `hidden` or conditional rendering. Use `sr-only` only for content that should stay readable to screen readers.
- Discard and reset: ghost or outline variant with `Undo2` icon, confirms when there is unsaved work.
