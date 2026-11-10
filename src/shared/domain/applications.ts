import { apps as catalogApps, type App } from "@/shared/config/catalog";

/**
 * The single application inventory used by onboarding, entitlements, organization settings, the
 * `/anops` home screen, the app switcher and every application sidebar. Marketing copy, icons and
 * accents come from the public catalog; routes and navigation are defined here, once.
 */
export const APPLICATION_IDS = [
  "ai",
  "hr-payroll",
  "crm",
  "sales",
  "finance",
  "inventory",
  "purchasing",
  "manufacturing",
  "marketing",
  "community",
] as const;

export type ApplicationId = (typeof APPLICATION_IDS)[number];

export type NavItem = {
  label: string;
  href: string;
  /** Match only this exact path (for a root item whose siblings live below it). */
  exact?: boolean;
  /** Permission required to show the item. Pages re-check it on the server. */
  permission?: string;
  /** The page is an AI feature: hidden (and its route refused) when the plan has no AI features. */
  ai?: boolean;
};

export type NavGroup = { label: string; items: NavItem[] };

export type Application = {
  id: ApplicationId;
  name: string;
  tagline: string;
  summary: string;
  icon: string;
  accent: string;
  status: App["status"];
  highlights: string[];
  /** Home route of the application. */
  href: string;
  /** Route prefixes owned by the application (used by the entitlement guard and sidebar). */
  routes: string[];
  nav: NavGroup[];
  /** The application is itself an AI product: it is useless without AI feature entitlement. */
  aiNative: boolean;
};

const NAV: Record<ApplicationId, { routes: string[]; nav: NavGroup[] }> = {
  ai: {
    routes: ["/ai"],
    nav: [
      {
        label: "AnOps AI",
        items: [
          { label: "Assistant", href: "/ai", exact: true },
          { label: "Access and limits", href: "/ai/access", permission: "ai.access.manage" },
        ],
      },
    ],
  },
  "hr-payroll": {
    routes: ["/hr"],
    nav: [
      {
        label: "People",
        items: [
          { label: "Overview", href: "/hr", exact: true },
          { label: "AI activity", href: "/hr/ai-activity", ai: true },
        ],
      },
    ],
  },
  crm: { routes: ["/crm"], nav: [{ label: "CRM", items: [{ label: "Overview", href: "/crm", exact: true }] }] },
  sales: { routes: ["/sales"], nav: [{ label: "Sales", items: [{ label: "Overview", href: "/sales", exact: true }] }] },
  finance: {
    routes: ["/finance"],
    nav: [
      { label: "Overview", items: [{ label: "Dashboard", href: "/finance", exact: true }] },
      {
        label: "Sales & receivables",
        items: [
          { label: "Customers", href: "/finance/customers" },
          { label: "Invoices", href: "/finance/invoices" },
          { label: "Payments", href: "/finance/payments" },
        ],
      },
      {
        label: "Spending",
        items: [
          { label: "Expenses", href: "/finance/expenses" },
          { label: "Receipts", href: "/finance/receipts" },
        ],
      },
      { label: "Analysis", items: [{ label: "Reports", href: "/finance/reports" }] },
    ],
  },
  inventory: {
    routes: ["/inventory"],
    nav: [
      { label: "Overview", items: [{ label: "Dashboard", href: "/inventory", exact: true }] },
      {
        label: "Catalogue",
        items: [
          { label: "Products", href: "/inventory/products" },
          { label: "Categories", href: "/inventory/categories" },
        ],
      },
      {
        label: "Stock",
        items: [
          { label: "Warehouses", href: "/inventory/warehouses" },
          { label: "Stock", href: "/inventory/stock" },
        ],
      },
      { label: "Setup", items: [{ label: "Guided setup", href: "/inventory/setup" }] },
    ],
  },
  purchasing: {
    routes: ["/purchasing"],
    nav: [
      {
        label: "Buying",
        items: [
          { label: "Orders", href: "/purchasing/orders" },
          { label: "Receipts", href: "/purchasing/receipts" },
          { label: "Replenishment", href: "/purchasing/replenishment" },
        ],
      },
      { label: "Partners", items: [{ label: "Suppliers", href: "/purchasing/suppliers" }] },
    ],
  },
  manufacturing: {
    routes: ["/manufacturing"],
    nav: [
      {
        label: "Production",
        items: [
          { label: "Work orders", href: "/manufacturing/work-orders" },
          { label: "Bills of materials", href: "/manufacturing/boms" },
        ],
      },
    ],
  },
  marketing: {
    routes: ["/marketing"],
    nav: [
      { label: "Overview", items: [{ label: "Dashboard", href: "/marketing", exact: true }] },
      {
        label: "Audience",
        items: [
          { label: "Contacts", href: "/marketing/contacts" },
          { label: "Tags", href: "/marketing/tags" },
          { label: "Audiences", href: "/marketing/audiences" },
        ],
      },
      {
        label: "Campaigns",
        items: [
          { label: "Campaigns", href: "/marketing/campaigns" },
          { label: "Templates", href: "/marketing/templates" },
          { label: "Social", href: "/marketing/social" },
          { label: "AI copy", href: "/marketing/ai", ai: true },
        ],
      },
      {
        label: "Insights & setup",
        items: [
          { label: "Analytics", href: "/marketing/analytics" },
          { label: "Integrations", href: "/marketing/integrations" },
        ],
      },
    ],
  },
  community: { routes: ["/community"], nav: [{ label: "Community", items: [{ label: "Blog, forum & chat", href: "/community", exact: true }] }] },
};

export const APPLICATIONS: Application[] = APPLICATION_IDS.map((id) => {
  const app = catalogApps.find((item) => item.slug === id);
  if (!app) throw new Error(`Application ${id} is missing from the catalog.`);
  return {
    id,
    name: app.name,
    tagline: app.tagline,
    summary: app.summary,
    icon: app.icon,
    accent: app.accent,
    status: app.status,
    highlights: app.highlights,
    href: app.workspacePath,
    routes: NAV[id].routes,
    nav: NAV[id].nav,
    aiNative: id === "ai",
  };
});

const BY_ID = new Map(APPLICATIONS.map((app) => [app.id, app]));

export function isApplicationId(value: unknown): value is ApplicationId {
  return typeof value === "string" && (APPLICATION_IDS as readonly string[]).includes(value);
}

export function getApplication(id: ApplicationId): Application {
  return BY_ID.get(id) as Application;
}

/** The application that owns a pathname, or null for platform routes (/anops, /organization, /profile…). */
export function applicationForPath(pathname: string): Application | null {
  for (const app of APPLICATIONS) {
    if (app.routes.some((route) => pathname === route || pathname.startsWith(`${route}/`))) return app;
  }
  return null;
}

/** Flat list of every navigation entry, for search. */
/** Navigation items visible for the given AI entitlement and permissions. */
export function visibleNavItems(app: Application, opts: { aiFeatures: boolean; permissions: ReadonlySet<string> }) {
  return app.nav
    .map((group) => ({ ...group, items: group.items.filter((item) => (!item.ai || opts.aiFeatures) && (!item.permission || opts.permissions.has(item.permission))) }))
    .filter((group) => group.items.length > 0);
}

export function allNavEntries(): { app: Application; group: string; item: NavItem }[] {
  return APPLICATIONS.flatMap((app) => app.nav.flatMap((group) => group.items.map((item) => ({ app, group: group.label, item }))));
}
