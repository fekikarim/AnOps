# Layout Architecture Rules

- Root `app/layout.tsx` must remain minimal: only `<html>`, `<body>`, `globals.css`, metadata. Do **not** mount app chrome (Sidebar/Topbar/DashboardShell) here. This ensures 404, error, and auth routes render without inheriting dashboard styles.
- All authenticated/dashboard routes must live under `app/(dashboard)/`. Use `app/(dashboard)/layout.tsx` to mount `DashboardShell`. Move new pages there.
- Auth routes go under `app/(auth)/` with their own minimal layout (no shell).
- `app/not-found.tsx` must render standalone with AnOps tokens (no DashboardShell). `app/global-error.tsx` must include `<html>/<body>` since it replaces the document.
- Sidebar user/footer must use `margin-top: auto` to stay pinned to bottom regardless of content length. Use CSS Modules (`.module.css`) for fragile structural styles (footer/pinned elements). Keep design tokens/colors/typography in `globals.css` as CSS variables.
- Client components with local state (dropdowns/toggles) must not rely on layout mounting order. Avoid re-mounting shells on navigation - use route groups.
- CSS variables from `globals.css` must be available to all routes. Never scope `--color-*` to modules.
- When adding new pages, check if they belong to dashboard or not. Never import `DashboardShell` directly in `app/layout.tsx`.
