import { apps } from "@/shared/config/catalog";

/**
 * Public documentation. Guides describe flows that exist in the product today; screen names follow
 * the workspace navigation (module tabs). Application references are generated from the catalog.
 */
export type DocSection = { heading: string; body?: string; steps?: string[]; list?: string[] };

export type Doc = {
  slug: string;
  title: string;
  kind: "start" | "app" | "guide";
  app?: string;
  icon: string;
  summary: string;
  minutes: number;
  sections: DocSection[];
};

const startDocs: Doc[] = [
  {
    slug: "getting-started",
    title: "Getting started with AnOps",
    kind: "start",
    icon: "wired-lineal-12-layers-hover-slide.webp",
    summary: "Create your account and organization, invite your team and open your first application.",
    minutes: 4,
    sections: [
      {
        heading: "Create your account",
        steps: [
          "Open Create account from the AnOps website and enter your name, email and a password.",
          "Confirm your email address with the link you receive.",
          "Open your workspace. You can create more organizations later from the Organization page.",
        ],
      },
      {
        heading: "Your organization",
        steps: [
          "Your organization is created with the registration: name, currency (TND, EUR, USD or GBP) and the applications you chose.",
          "You become its owner and enter the workspace right away; confirm the activation email within 12 hours.",
        ],
      },
      {
        heading: "Invite your team",
        steps: [
          "Open your organization from the Dock (or Settings) and go to Members.",
          "Invite people by email and give each one a role: admin, manager or employee.",
          "Members only see the companies they belong to, with the role they have there.",
        ],
      },
      {
        heading: "Open an application",
        body: "Every application is in the sidebar. Most start with an overview, then tabs for their records (for example Inventory → Products, Categories, Warehouses, Stock).",
      },
    ],
  },
  {
    slug: "roles-and-permissions",
    title: "Roles and permissions",
    kind: "start",
    icon: "wired-lineal-1004-avatars-settings-hover-smooth.webp",
    summary: "What owners, admins, managers and employees can do, and how permissions are enforced.",
    minutes: 3,
    sections: [
      {
        heading: "Company roles",
        list: [
          "Owner: full control, including company settings and members.",
          "Admin: full control of company data, approvals and count corrections.",
          "Manager: runs day-to-day operations such as staff, attendance, stock, receipts and production.",
          "Employee: read-only access to company data.",
        ],
      },
      {
        heading: "One role per company",
        body: "A role belongs to a membership, never to the person globally. The same person can be an owner in one company and an employee in another.",
      },
      {
        heading: "Enforced on the server",
        body: "Every service checks the permission it needs. Hiding a button is never the only control, and AI access is always a subset of what the role already allows.",
      },
    ],
  },
];

const guideDocs: Doc[] = [
  {
    slug: "grant-ai-access",
    title: "Give a team member access to AnOps AI",
    kind: "guide",
    app: "ai",
    icon: "wired-lineal-256x256-ai-chip-hover-pinch.webp",
    summary: "Turn AI on for your company, choose who can use it and on which modules.",
    minutes: 3,
    sections: [
      {
        heading: "Steps",
        steps: [
          "As the owner, open AnOps AI → Access and limits.",
          "Turn AI on for the company. Owner access is on by default once AI is enabled.",
          "Select a member and choose the modules and operations (view, create, edit, delete, approve) AI may use for them.",
          "Set the per-person and company token limits, and the conversation retention period.",
        ],
      },
      {
        heading: "Good to know",
        list: [
          "AI access can never exceed the member's role permissions.",
          "Revoking access takes effect immediately, including in open conversations and pending proposals.",
          "Turning AI off for the company cancels every open proposal.",
        ],
      },
    ],
  },
  {
    slug: "receive-a-purchase-order",
    title: "Order from a supplier and receive the goods",
    kind: "guide",
    app: "purchasing",
    icon: "wired-lineal-3541-shopping-basket-online-hover-pinch.webp",
    summary: "Create a purchase order, approve it and post the goods receipt to increase stock.",
    minutes: 4,
    sections: [
      {
        heading: "Steps",
        steps: [
          "Open Purchasing → Suppliers and add the supplier if it does not exist yet.",
          "Open Purchasing → Orders, create a new order and add the product lines.",
          "Approve the order. Approval does not change stock.",
          "When goods arrive, open Purchasing → Receipts, create a receipt for the order and enter the quantities received.",
          "Post the receipt. Stock increases in the chosen warehouse and the order becomes partially received or received.",
        ],
      },
      {
        heading: "Good to know",
        list: [
          "Receiving more than was ordered is rejected.",
          "A posted receipt cannot be posted twice.",
          "An approved order can be cancelled only while nothing has been received.",
        ],
      },
    ],
  },
  {
    slug: "run-a-work-order",
    title: "Define a bill of materials and run production",
    kind: "guide",
    app: "manufacturing",
    icon: "wired-lineal-3511-manufacturing-hover-pinch.webp",
    summary: "Create a BOM revision, activate it, then start and complete a work order.",
    minutes: 4,
    sections: [
      {
        heading: "Steps",
        steps: [
          "Open Manufacturing → Bills of materials and create a draft for the finished product.",
          "Add each component and its quantity, then activate the revision.",
          "Open Manufacturing → Work orders and create an order for the quantity to produce.",
          "Start the order when production begins.",
          "Complete the order. Components are issued and finished goods are received in one step.",
        ],
      },
      {
        heading: "Good to know",
        list: [
          "If any component is short at completion, nothing changes and the order stays in progress.",
          "Changing the BOM later does not affect orders already created.",
        ],
      },
    ],
  },
  {
    slug: "telegram-receipts",
    title: "Send expense receipts from your phone with Telegram",
    kind: "guide",
    app: "finance",
    icon: "wired-lineal-2559-logo-telegram-hover-pinch.webp",
    summary: "Link Telegram once, then send receipt photos that become draft expenses.",
    minutes: 3,
    sections: [
      {
        heading: "Steps",
        steps: [
          "Open Finance → Receipts and find the Telegram card.",
          "Use the single-use link to open the AnOps bot in Telegram and start the conversation.",
          "Send a photo or PDF of a receipt to the bot.",
          "Back in Finance → Receipts, review the extracted details and create the expense.",
        ],
      },
      {
        heading: "Good to know",
        list: [
          "The link is bound to your user and company.",
          "Duplicate files are detected, and nothing is posted until someone reviews it.",
        ],
      },
    ],
  },
  {
    slug: "first-email-campaign",
    title: "Send your first email campaign",
    kind: "guide",
    app: "marketing",
    icon: "wired-lineal-3094-mail-open-marketing-hover-pinch.webp",
    summary: "From contacts with consent to an approved, scheduled campaign.",
    minutes: 5,
    sections: [
      {
        heading: "Steps",
        steps: [
          "Open Marketing → Integrations and check that an email sender is configured.",
          "Add or import contacts in Marketing → Contacts and record their email marketing consent.",
          "Create an audience in Marketing → Audiences and preview who is included and excluded.",
          "Create a template in Marketing → Templates, or draft copy in Marketing → AI copy.",
          "Create the campaign in Marketing → Campaigns, submit it for approval, then send or schedule it.",
          "Follow results in Marketing → Analytics.",
        ],
      },
      {
        heading: "Good to know",
        list: [
          "Consent is checked again at send time; unsubscribed contacts are always skipped.",
          "Recipients are fixed when the campaign is approved (recipient snapshot).",
        ],
      },
    ],
  },
  {
    slug: "approve-leave",
    title: "Request and approve leave",
    kind: "guide",
    app: "hr-payroll",
    icon: "wired-lineal-734-id-badge-hover-pinch.webp",
    summary: "How employees request leave and how approvers use the Approval Advisor.",
    minutes: 3,
    sections: [
      {
        heading: "For employees",
        steps: [
          "Open HR & Payroll and create a leave request, or ask the HR assistant to draft one.",
          "Check the summary and confirm. The request is now pending approval.",
        ],
      },
      {
        heading: "For approvers",
        steps: [
          "Open the pending requests in HR & Payroll.",
          "Read the advisor card: balance, team overlap, history and any blocking rule.",
          "Optionally ask AI for a short analysis, then approve or reject.",
        ],
      },
    ],
  },
];

const appDocs: Doc[] = apps.map((app) => ({
  slug: `app-${app.slug}`,
  title: `${app.name} reference`,
  kind: "app",
  app: app.slug,
  icon: app.icon,
  summary: app.summary,
  minutes: 3,
  sections: [
    { heading: "What it is for", body: app.intro },
    { heading: app.status === "available" ? "What you can do" : "Planned scope", list: app.features.map((f) => `${f.title}: ${f.body}`) },
    {
      heading: "Where to find it",
      body:
        app.status === "available"
          ? `Sign in and open ${app.name} from the sidebar (${app.workspacePath}).`
          : `${app.name} has a placeholder screen in the workspace today. Its features will be documented when they are released.`,
    },
    ...(app.notes.length ? [{ heading: "Limits and notes", list: app.notes }] : []),
  ],
}));

export const docs: Doc[] = [...startDocs, ...appDocs, ...guideDocs];

export function getDoc(slug: string) {
  return docs.find((doc) => doc.slug === slug);
}

export function docsForApp(slug: string) {
  return docs.filter((doc) => doc.app === slug);
}

