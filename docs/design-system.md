# AnOps Design System

A clean, modern, flat design system for the AnOps ERP platform. Built with Tailwind CSS v4 and a minimal color variable system.

## Philosophy

- **Clean & Professional**: Minimal chrome, generous whitespace
- **Flat Design**: No heavy shadows or gradients
- **Functional First**: Focus on data and actions
- **Mobile Responsive**: Works seamlessly across all screen sizes

## Color System

All colors use HSL CSS variables for flexibility.

### Core Colors

| Variable | Light | Usage |
| --- | --- | --- |
| `--background` | `0 0% 100%` | Page background |
| `--foreground` | `222.2 84% 4.9%` | Primary text |
| `--primary` | `221.2 83.2% 53.3%` | Primary actions, links, active states |
| `--primary-foreground` | `210 40% 98%` | Text on primary color |
| `--secondary` | `210 40% 96.1%` | Secondary elements |
| `--secondary-foreground` | `222.2 47.4% 11.2%` | Text on secondary |
| `--muted` | `210 40% 96.1%` | Subtle backgrounds |
| `--muted-foreground` | `215.4 16.3% 46.9%` | Secondary text, labels |
| `--accent` | `210 40% 96.1%` | Hover states |
| `--accent-foreground` | `222.2 47.4% 11.2%` | Text on accent |
| `--destructive` | `0 84.2% 60.2%` | Errors, destructive actions |
| `--destructive-foreground` | `210 40% 98%` | Text on destructive |
| `--border` | `214.3 31.8% 91.4%` | Borders, dividers |
| `--input` | `214.3 31.8% 91.4%` | Input borders |
| `--ring` | `221.2 83.2% 53.3%` | Focus rings |
| `--radius` | `0.375rem` | Default border radius |

### Dark Mode

Dark mode is supported via `.dark` class on the html element with inverted color values.

## Typography

### Font Family
```css
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen",
  "Ubuntu", "Cantarell", "Fira Sans", "Droid Sans", "Helvetica Neue",
  sans-serif;
```

### Scale
| Class | Size | Weight | Usage |
| --- | --- | --- | --- |
| `text-2xl` | 1.5rem (24px) | 600 | Page titles |
| `text-lg` | 1.125rem (18px) | 600 | Section headers |
| `text-sm` | 0.875rem (14px) | 400-500 | Body text, labels |
| `text-xs` | 0.75rem (12px) | 400-500 | Badges, metadata |

## Spacing

Uses Tailwind's default spacing scale (4px base unit). Common patterns:
- Cards: `p-6` (24px)
- Sections: `space-y-8` (32px between)
- Grid gaps: `gap-4` (16px)

## Components

### Layout
- **Sidebar** (`src/components/layout/sidebar.tsx`): Fixed left navigation, mobile drawer, 64px width
- **Topbar** (`src/components/layout/topbar.tsx`): Sticky header with search and actions

### Cards
```tsx
<div className="p-6 bg-white border border-border rounded-lg">
  {/* content */}
</div>
```

### Buttons
```tsx
<button className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors">
  Action
</button>
```

### Links
```tsx
<Link href="/path" className="text-sm text-primary hover:underline">
  Link
</Link>
```

### Badges (AI)
```tsx
<span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary font-medium">
  AI
</span>
```

## Module Color Coding

Each module uses the primary blue color with subtle backgrounds. AI features are marked with blue accent badges.

| Module | Icon Color | AI Badge |
| --- | --- | --- |
| Inventory & Manufacturing | `text-primary` | Yes |
| Finance & Invoicing | `text-primary` | Yes |
| HR & Payroll | `text-primary` | Yes |
| Marketing & Socials | `text-primary` | Yes |
| Blogs, Forum & Live Chat | `text-primary` | Yes |

## Responsive Design

Mobile-first approach using Tailwind breakpoints:
- `sm`: 640px
- `md`: 768px
- `lg`: 1024px
- `xl`: 1280px

**Examples:**
- Sidebar: Hidden on mobile (`-translate-x-full`), visible on `lg:`
- Grid: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`
- Padding: `p-4 sm:p-6`

## Usage Guidelines

1. **Use semantic colors**: Always use `bg-background`, `text-foreground`, `border-border` etc.
2. **Keep it flat**: Avoid heavy shadows, use borders for separation
3. **Consistent spacing**: Stick to the spacing scale
4. **Accessible**: Maintain proper contrast ratios, use semantic HTML
5. **Mobile first**: Design for mobile, enhance for desktop
6. **Type-safe**: Use TypeScript for all components

## File Structure

```
src/
├── app/
│   ├── globals.css      # CSS variables & base styles
│   ├── layout.tsx       # Root layout with sidebar + topbar
│   └── page.tsx         # Dashboard page
└── components/
    └── layout/
        ├── sidebar.tsx  # Navigation sidebar
        └── topbar.tsx   # Top navigation bar
```

## Adding New Components

Follow these patterns:
- Use CSS variables for theming
- Keep components simple and composable
- Use `"use client"` only when needed (interactivity)
- Default to Server Components
- Use `cn()` utility pattern for class merging if needed
