/**
 * Public catalog of the 11 AnOps managements.
 * Every feature listed here exists in the product (see PUBLIC_PORTAL_REDESIGN_ROADMAP.md, Batch 0).
 * CRM and Sales only have placeholder screens, so they are marked "coming-soon".
 */
export type AppStatus = "available" | "in-progress" | "coming-soon";

export const statusMeta: Record<AppStatus, { abbr: string; label: string }> = {
  available: { abbr: "Available", label: "Available" },
  "in-progress": { abbr: "In progress", label: "In progress" },
  "coming-soon": { abbr: "Coming soon", label: "Coming soon" },
};

export type CategoryId = "platform" | "revenue" | "finance" | "operations" | "people" | "collaboration";

export type Category = { id: CategoryId; label: string; description: string };

export const categories: Category[] = [
  { id: "platform", label: "Platform & AI", description: "The company workspace, its members and the AI Command Center." },
  { id: "revenue", label: "Customers & Revenue", description: "Relationships, sales and the campaigns that reach your audience." },
  { id: "finance", label: "Finance", description: "Invoices, payments, expenses and reports on one ledger." },
  { id: "operations", label: "Operations", description: "Stock, suppliers and production on one stock ledger." },
  { id: "people", label: "People", description: "Employees, leave, attendance and payroll." },
  { id: "collaboration", label: "Collaboration", description: "Company blog, forum and live chat." },
];

export type Feature = { title: string; body: string };

export type AppPreviewSpec = {
  title: string;
  kpis: { label: string; value: string }[];
  columns: string[];
  rows: string[][];
};

export type App = {
  slug: string;
  name: string;
  category: CategoryId;
  status: AppStatus;
  /** Animated icon file in /public/animated (a poster lives in /public/animated/posters). */
  icon: string;
  /** Brand accent used for fills, borders and glows (never for body text). */
  accent: string;
  tagline: string;
  summary: string;
  intro: string;
  highlights: string[];
  features: Feature[];
  useCases: Feature[];
  benefits: string[];
  notes: string[];
  connectsWith: string[];
  workspacePath: string;
  preview: AppPreviewSpec;
};

export const apps: App[] = [
  {
    slug: "ai",
    name: "AnOps AI",
    category: "platform",
    status: "available",
    icon: "wired-lineal-256x256-ai-chip-hover-pinch.webp",
    accent: "#C8F03E",
    tagline: "Run the company in plain language.",
    summary: "The AI Command Center: ask, find and prepare work across modules. Every change is proposed, confirmed and audited.",
    intro:
      "AnOps AI is one workspace where an authorized person manages operations through natural language and guided slash commands. The model interprets the request; AnOps services perform every read and write, so validation, permissions and business rules are never bypassed.",
    highlights: ["Natural language and slash commands", "Confirmation before every write", "Per-member access and token limits"],
    features: [
      { title: "Chat and slash commands", body: "Type a request or pick one of 135 module commands, from stock lookups to purchase order drafts." },
      { title: "Proposals you confirm", body: "Writes are shown as a summary first. Destructive and financial actions need a typed confirmation." },
      { title: "Company-controlled access", body: "The owner decides who can use AI and on which modules and operations, always within their existing role." },
      { title: "Usage and budgets", body: "Per-person token caps, a company budget and a 7-day usage view per provider and model." },
      { title: "Private conversations", body: "Conversations belong to the employee, with configurable retention. Auditing needs an explicit, logged permission." },
      { title: "Resilient providers", body: "Requests fall back across providers, and a kill switch can stop AI instantly for one company or the platform." },
    ],
    useCases: [
      { title: "Find without navigating", body: "“Which products are below their reorder level in the main warehouse?”" },
      { title: "Prepare routine work", body: "Draft a purchase order or a leave request, review the summary, then confirm." },
      { title: "Give AI to the right people", body: "Enable AI for a warehouse manager on Inventory and Purchasing only." },
    ],
    benefits: ["Less time clicking through modules", "Every AI action attributable and auditable", "AI never exceeds a person's permissions"],
    notes: ["AI suggestions always need a person to confirm before anything changes."],
    connectsWith: ["inventory", "purchasing", "finance", "hr-payroll"],
    workspacePath: "/ai",
    preview: {
      title: "Command Center",
      kpis: [
        { label: "Tools available", value: "144" },
        { label: "Commands", value: "135" },
        { label: "Pending confirmations", value: "2" },
      ],
      columns: ["Request", "Module", "State"],
      rows: [
        ["/stock low main-warehouse", "Inventory", "Answered"],
        ["Draft PO for 120 × Steel bolts", "Purchasing", "Awaiting confirmation"],
        ["Leave balance for my team", "HR", "Answered"],
      ],
    },
  },
  {
    slug: "hr-payroll",
    name: "HR & Payroll",
    category: "people",
    status: "available",
    icon: "wired-lineal-734-id-badge-hover-pinch.webp",
    accent: "#E08A3C",
    tagline: "People, leave, attendance and pay in one place.",
    summary: "Maintain employee records, approve leave with an advisor at your side, track attendance and prepare payslips.",
    intro:
      "HR & Payroll keeps your people data together: employees, departments and job titles, leave requests and balances, attendance and payroll. An HR assistant answers policy questions and prepares requests, and an Approval Advisor summarises the facts behind each leave request.",
    highlights: ["Employees, departments and job titles", "Leave with Approval Advisor", "Attendance and payslips"],
    features: [
      { title: "Employee records", body: "Profiles, departments and job titles, with departure reviews when someone leaves." },
      { title: "Leave management", body: "Requests, approvals, balances and history, with overlap and balance checks." },
      { title: "Attendance", body: "Daily attendance records your managers can maintain and review." },
      { title: "Payroll and payslips", body: "Prepare payroll, apply manual adjustments and produce payslips." },
      { title: "HR assistant", body: "Answers policy and balance questions; drafts leave requests you confirm with one click." },
      { title: "Approval Advisor", body: "Hard rules flag blockers first; an optional AI analysis explains the context. People still approve." },
    ],
    useCases: [
      { title: "Self-service leave", body: "Employees check balances and draft requests without emailing HR." },
      { title: "Faster, fairer approvals", body: "Managers see balance, team overlap and history in one card." },
      { title: "Month-end payroll", body: "Review attendance and leave, then prepare payslips from the same records." },
    ],
    benefits: ["Fewer back-and-forth messages", "Consistent approval decisions", "Payroll based on recorded attendance and leave"],
    notes: ["Salary information requires a separate sensitive-data permission."],
    connectsWith: ["ai", "finance"],
    workspacePath: "/hr",
    preview: {
      title: "Leave approvals",
      kpis: [
        { label: "Employees", value: "48" },
        { label: "Pending requests", value: "5" },
        { label: "Absent today", value: "3" },
      ],
      columns: ["Request", "Days", "Advisor"],
      rows: [
        ["Annual leave · Operations", "4", "Approve"],
        ["Sick leave · Finance", "2", "Review"],
        ["Annual leave · Sales", "6", "Blocked: overlap"],
      ],
    },
  },
  {
    slug: "crm",
    name: "CRM",
    category: "revenue",
    status: "coming-soon",
    icon: "wired-lineal-456-handshake-hover-pinch.webp",
    accent: "#D76A8E",
    tagline: "Every relationship, from first contact onward.",
    summary: "Customer relationships on the same contact records Marketing already uses. In preparation.",
    intro:
      "CRM will track the companies and people you work with and the opportunities you pursue. It is being prepared on the shared contact model that Marketing already uses, so contacts will not need to be re-entered.",
    highlights: ["Shared contact identity with Marketing", "Planned opportunity tracking", "Connected to Sales and Finance"],
    features: [
      { title: "Shared contacts", body: "Marketing contacts, consent and tags already follow the contract CRM will consume." },
      { title: "Planned: pipeline", body: "Opportunities and activities per customer are part of the planned scope." },
    ],
    useCases: [{ title: "Follow up campaign leads", body: "Planned: contacts reached by a campaign continue in CRM without being copied." }],
    benefits: ["One contact record across apps", "No duplicate entry between marketing and sales"],
    notes: ["CRM has a placeholder screen today. Features are planned and not yet available."],
    connectsWith: ["marketing", "sales", "finance"],
    workspacePath: "/crm",
    preview: {
      title: "Pipeline (planned)",
      kpis: [
        { label: "Contacts", value: "—" },
        { label: "Opportunities", value: "—" },
        { label: "Status", value: "Planned" },
      ],
      columns: ["Opportunity", "Stage", "Owner"],
      rows: [
        ["Example opportunity", "Qualified", "—"],
        ["Example opportunity", "Proposal", "—"],
      ],
    },
  },
  {
    slug: "sales",
    name: "Sales",
    category: "revenue",
    status: "coming-soon",
    icon: "wired-lineal-2611-bar-chat-money-grow-hover-pinch.webp",
    accent: "#2FA36B",
    tagline: "From quotation to confirmed order.",
    summary: "Quotations and sales orders connected to stock and invoicing. In preparation.",
    intro:
      "Sales will turn quotations into confirmed orders that inform stock and invoicing. Today, invoices are created in Finance and stock is managed in Inventory; Sales will connect the two.",
    highlights: ["Planned quotations and orders", "Connected to Inventory and Finance", "Built on shared customers"],
    features: [
      { title: "Planned: quotations", body: "Prepare offers for existing customers and products." },
      { title: "Planned: sales orders", body: "Confirmed orders inform stock availability and invoicing." },
    ],
    useCases: [{ title: "Quote to cash", body: "Planned: a confirmed order becomes an invoice in Finance without re-typing lines." }],
    benefits: ["Fewer re-keyed orders", "Stock and invoices that agree"],
    notes: ["Sales has a placeholder screen today. Features are planned and not yet available."],
    connectsWith: ["crm", "finance", "inventory"],
    workspacePath: "/sales",
    preview: {
      title: "Orders (planned)",
      kpis: [
        { label: "Quotations", value: "—" },
        { label: "Orders", value: "—" },
        { label: "Status", value: "Planned" },
      ],
      columns: ["Document", "Customer", "Stage"],
      rows: [
        ["Example quotation", "—", "Draft"],
        ["Example order", "—", "Confirmed"],
      ],
    },
  },
  {
    slug: "finance",
    name: "Finance",
    category: "finance",
    status: "available",
    icon: "wired-lineal-1377-file-invoice-dollar-hover-swipe.webp",
    accent: "#14A39A",
    tagline: "Invoices, payments and expenses that add up.",
    summary: "Issue invoices, record payments, capture receipts and report, with a Finance Copilot that suggests and reminds.",
    intro:
      "Finance covers customers, invoices, payments, expenses and reports. Money is computed in whole cents per currency, posted invoices change only through credit notes, voids or payments, and every write is audited. Receipts can be scanned or sent through Telegram and become draft expenses after review.",
    highlights: ["Invoices, credit notes and payments", "Receipt scanning and Telegram upload", "Reports with Excel export"],
    features: [
      { title: "Invoicing", body: "Build invoices for customers, send them by email, export them and follow their history." },
      { title: "Payments and allocation", body: "Record payments and allocate them to invoices; reversals run as one transaction." },
      { title: "Expenses and receipts", body: "Upload receipts in bulk or scan them; extracted data becomes a draft expense you review." },
      { title: "Telegram receipts", body: "Link a chat once, then send receipt photos from your phone straight into Finance." },
      { title: "Reports", body: "Financial reports and charts with an Excel export for your accountant." },
      { title: "Finance Copilot", body: "Category suggestions, payment reminder drafts and insights on the dashboard." },
    ],
    useCases: [
      { title: "Get paid on time", body: "See overdue invoices and send a reminder the Copilot drafted for you." },
      { title: "No more shoebox", body: "Staff send receipt photos by Telegram; finance reviews drafts instead of typing." },
      { title: "Month-end", body: "Export the reports to Excel from the same records the team works on." },
    ],
    benefits: ["Exact totals, never floating-point rounding", "Receipts never lost", "A complete audit trail of financial changes"],
    notes: ["Tunisian timbre fiscal is supported in invoice totals."],
    connectsWith: ["sales", "purchasing", "hr-payroll", "ai"],
    workspacePath: "/finance",
    preview: {
      title: "Invoices",
      kpis: [
        { label: "Outstanding", value: "18,420 TND" },
        { label: "Paid this month", value: "42,300 TND" },
        { label: "Overdue", value: "3" },
      ],
      columns: ["Invoice", "Customer", "Status"],
      rows: [
        ["INV-0142", "Atlas Trading", "Paid"],
        ["INV-0143", "Medina Foods", "Overdue"],
        ["INV-0144", "Carthage Build", "Sent"],
      ],
    },
  },
  {
    slug: "inventory",
    name: "Inventory",
    category: "operations",
    status: "available",
    icon: "wired-lineal-108-box-hover-squeeze.webp",
    accent: "#C59A2B",
    tagline: "Know what you have, and where.",
    summary: "Products, categories and warehouses on an append-only stock ledger with exact quantities.",
    intro:
      "Inventory tracks every product in every warehouse. Each stock change is a movement in an append-only ledger, balances are projected from it inside one transaction, and two people can never take the last unit at the same time.",
    highlights: ["Products, categories and warehouses", "Append-only stock ledger", "Guided setup"],
    features: [
      { title: "Product catalogue", body: "Products with SKU, category, unit and standard cost; unique SKU per company." },
      { title: "Warehouses", body: "Stock balances per product and warehouse." },
      { title: "Stock ledger", body: "Every receipt, issue and adjustment is recorded and never edited or deleted." },
      { title: "Adjustments with reasons", body: "Counts are corrected with a mandatory reason by authorized roles." },
      { title: "Guided setup", body: "A step-by-step setup gets categories, warehouses and first products in place." },
    ],
    useCases: [
      { title: "Multi-warehouse visibility", body: "See on-hand quantities per location before promising a delivery." },
      { title: "Trustworthy counts", body: "Trace any balance back to the movements that produced it." },
    ],
    benefits: ["No negative stock from concurrent issues", "Exact fixed-point quantities", "Stock that Purchasing and Manufacturing update automatically"],
    notes: ["Reservations and FIFO costing are not part of the current scope; valuation uses standard cost."],
    connectsWith: ["purchasing", "manufacturing", "ai"],
    workspacePath: "/inventory",
    preview: {
      title: "Stock by warehouse",
      kpis: [
        { label: "Products", value: "326" },
        { label: "Warehouses", value: "3" },
        { label: "Below reorder", value: "7" },
      ],
      columns: ["SKU", "Warehouse", "On hand"],
      rows: [
        ["BLT-M8-50", "Main", "1,240"],
        ["PNL-AL-2M", "Main", "38"],
        ["PKG-BOX-L", "Sfax", "560"],
      ],
    },
  },
  {
    slug: "purchasing",
    name: "Purchasing",
    category: "operations",
    status: "available",
    icon: "wired-lineal-3541-shopping-basket-online-hover-pinch.webp",
    accent: "#7A6CE0",
    tagline: "Order, approve and receive with confidence.",
    summary: "Suppliers, purchase orders and goods receipts; stock increases only when a receipt is posted.",
    intro:
      "Purchasing manages suppliers and purchase orders from draft to received. Approval never changes stock; posting a goods receipt does, in one transaction that also updates the order and the stock ledger. Over-receipt and double posting are rejected.",
    highlights: ["Suppliers and purchase orders", "Approval workflow", "Goods receipts posting stock"],
    features: [
      { title: "Suppliers", body: "One record per supplier per company, reused on every order." },
      { title: "Purchase orders", body: "Draft, approve, receive partially or fully, or cancel, with clear state rules." },
      { title: "Goods receipts", body: "Post what actually arrived; stock and order quantities update together." },
      { title: "Replenishment", body: "A replenishment view to see what needs ordering." },
    ],
    useCases: [
      { title: "Controlled spending", body: "Orders are approved before suppliers are committed." },
      { title: "Partial deliveries", body: "Receive what arrived today and keep the rest open on the order." },
    ],
    benefits: ["Stock matches what was actually received", "No double receipts", "A clear history per order"],
    notes: ["AI demand forecasting and automatic reorder suggestions are not implemented."],
    connectsWith: ["inventory", "manufacturing", "finance"],
    workspacePath: "/purchasing",
    preview: {
      title: "Purchase orders",
      kpis: [
        { label: "Open orders", value: "9" },
        { label: "Awaiting approval", value: "2" },
        { label: "Suppliers", value: "24" },
      ],
      columns: ["Order", "Supplier", "Status"],
      rows: [
        ["PO-0087", "Sahel Metals", "Partially received"],
        ["PO-0088", "Nord Packaging", "Approved"],
        ["PO-0089", "Sahel Metals", "Draft"],
      ],
    },
  },
  {
    slug: "manufacturing",
    name: "Manufacturing",
    category: "operations",
    status: "available",
    icon: "wired-lineal-3511-manufacturing-hover-pinch.webp",
    accent: "#5E9C86",
    tagline: "From bill of materials to finished goods.",
    summary: "Bills of materials with revisions and work orders that consume components and receive finished goods.",
    intro:
      "Manufacturing defines what goes into each product and runs production. A work order snapshots the active bill of materials, and completing it consumes components and receives finished goods in one transaction. If a component is short, nothing changes.",
    highlights: ["BOM revisions", "Work order lifecycle", "Atomic completion"],
    features: [
      { title: "Bills of materials", body: "Revisions per finished product; only drafts are editable and one revision is active." },
      { title: "Work orders", body: "Draft, start, complete or cancel; each order keeps the BOM it was created from." },
      { title: "Stock integration", body: "Completion issues components and receives finished goods on the stock ledger." },
    ],
    useCases: [
      { title: "Make-to-stock", body: "Plan a batch, start it, and see components consumed only when it completes." },
      { title: "Engineering changes", body: "Activate a new BOM revision without affecting orders already in progress." },
    ],
    benefits: ["Production that cannot leave stock half-updated", "Clear traceability from BOM to order", "Inventory always reflects production"],
    notes: ["Nested BOMs, partial production, scrap and rework are not supported yet."],
    connectsWith: ["inventory", "purchasing", "ai"],
    workspacePath: "/manufacturing",
    preview: {
      title: "Work orders",
      kpis: [
        { label: "In progress", value: "4" },
        { label: "Completed this week", value: "11" },
        { label: "Active BOMs", value: "18" },
      ],
      columns: ["Work order", "Product", "Status"],
      rows: [
        ["WO-0231", "Steel shelf 2M", "In progress"],
        ["WO-0232", "Panel kit A", "Draft"],
        ["WO-0229", "Steel shelf 1M", "Completed"],
      ],
    },
  },
  {
    slug: "marketing",
    name: "Marketing",
    category: "revenue",
    status: "available",
    icon: "wired-lineal-1027-marketing-hover-pinch.webp",
    accent: "#E5604D",
    tagline: "Reach the right people, with their consent.",
    summary: "Contacts, consent, audiences and campaigns by email, SMS and Telegram, plus Facebook posts and an AI copywriter.",
    intro:
      "Marketing manages contacts and their consent by channel and purpose, builds audiences from typed rules, and runs approved campaigns by email, SMS and Telegram. Consent is checked again at the moment each message is sent, and unsubscribes are honoured through signed links.",
    highlights: ["Consent-aware contacts and audiences", "Email, SMS and Telegram campaigns", "AI copywriter and analytics"],
    features: [
      { title: "Contacts and tags", body: "Search, filter, de-duplicate and tag contacts in bulk." },
      { title: "Consent and suppression", body: "Consent per channel and purpose with history; signed, one-click unsubscribe." },
      { title: "Audiences", body: "Rule-based audiences with a preview and a breakdown of who is excluded and why." },
      { title: "Campaigns", body: "Templates, approval, a recipient snapshot and scheduling across email, SMS and Telegram." },
      { title: "Social posts", body: "Draft, schedule and publish posts to a connected Facebook Page." },
      { title: "AI copy and analytics", body: "Drafts copy for your review; analytics show rates with their denominators." },
    ],
    useCases: [
      { title: "Respectful newsletters", body: "Only contacts who agreed to marketing email receive it, checked at send time." },
      { title: "Multichannel promotion", body: "Run the same offer by email and Telegram to the audiences that opted in." },
    ],
    benefits: ["Consent enforced, not just recorded", "Approval before anything is sent", "Honest metrics"],
    notes: ["Some provider integrations (Brevo SMS, Facebook, Telegram) are implemented but not yet verified against live accounts. Instagram is not supported."],
    connectsWith: ["crm", "community", "ai"],
    workspacePath: "/marketing",
    preview: {
      title: "Campaigns",
      kpis: [
        { label: "Contacts", value: "4,812" },
        { label: "Opted in (email)", value: "3,906" },
        { label: "Scheduled", value: "2" },
      ],
      columns: ["Campaign", "Channel", "Status"],
      rows: [
        ["Spring catalogue", "Email", "Sent"],
        ["Store opening", "SMS", "Scheduled"],
        ["Weekly offers", "Telegram", "Awaiting approval"],
      ],
    },
  },
  {
    slug: "community",
    name: "Blogs & Community",
    category: "collaboration",
    status: "available",
    icon: "wired-lineal-3953-forum-hover-pinch.webp",
    accent: "#3E9BD6",
    tagline: "Share knowledge inside and outside the company.",
    summary: "A company blog with AI summaries, a discussion forum with comments, and live chat.",
    intro:
      "Blogs & Community gives each company a place to publish articles, discuss topics in a forum and chat live. Articles can be drafted, published and archived, and an AI summary turns a long article into three key takeaways.",
    highlights: ["Company blog", "Forum topics and comments", "Live chat"],
    features: [
      { title: "Blog", body: "Drafts, publishing and archiving with categories, tags and reading time." },
      { title: "AI article summaries", body: "A concise overview and three key points for each article." },
      { title: "Forum", body: "Topics with pinning, locking and threaded comments." },
      { title: "Live chat", body: "Real-time conversations, including a visitor chat widget." },
    ],
    useCases: [
      { title: "Internal knowledge base", body: "Publish procedures and announcements where the team already works." },
      { title: "Discuss before deciding", body: "Open a forum topic and keep the conversation in one place." },
    ],
    benefits: ["Knowledge stays in the company", "Busy readers get the summary", "Fewer scattered chat threads"],
    notes: ["Blog, forum and chat are scoped to each company workspace."],
    connectsWith: ["marketing", "ai"],
    workspacePath: "/community",
    preview: {
      title: "Community",
      kpis: [
        { label: "Articles", value: "27" },
        { label: "Forum topics", value: "64" },
        { label: "Chats today", value: "9" },
      ],
      columns: ["Post", "Type", "Activity"],
      rows: [
        ["New receiving procedure", "Article", "AI summary ready"],
        ["Q3 stock count planning", "Forum", "12 replies"],
        ["Holiday schedule", "Article", "Published"],
      ],
    },
  },
];

export type AiUseCase = { area: string; appSlug: string; description: string; benefit: string };

export const aiUseCases: AiUseCase[] = [
  {
    area: "AI Command Center",
    appSlug: "ai",
    description: "Ask questions and prepare work across modules in plain language or slash commands.",
    benefit: "Every write is proposed first and confirmed by a person.",
  },
  {
    area: "HR assistant and Approval Advisor",
    appSlug: "hr-payroll",
    description: "Answers policy and balance questions, drafts leave requests and summarises the facts behind approvals.",
    benefit: "Hard rules decide blockers; people approve.",
  },
  {
    area: "Finance Copilot and receipt scanning",
    appSlug: "finance",
    description: "Suggests expense categories, drafts payment reminders and turns receipts into draft expenses.",
    benefit: "Nothing is posted until someone reviews it.",
  },
  {
    area: "Marketing copywriter",
    appSlug: "marketing",
    description: "Drafts campaign and post copy that you approve and copy into a campaign.",
    benefit: "Faster drafts without losing editorial control.",
  },
  {
    area: "Article summaries",
    appSlug: "community",
    description: "Turns a blog article into a short overview and three key takeaways.",
    benefit: "Readers get the point in seconds.",
  },
];

export function getApp(slug: string) {
  return apps.find((app) => app.slug === slug);
}

export function getCategory(id: CategoryId) {
  return categories.find((category) => category.id === id) ?? categories[0];
}

export function appsInCategory(id: CategoryId) {
  return apps.filter((app) => app.category === id);
}

export function relatedApps(app: App) {
  return app.connectsWith.map((slug) => getApp(slug)).filter((item): item is App => item !== undefined);
}

/** Retired slugs from the previous catalog, mapped to the app that now covers them. */
export const legacyAppSlugs: Record<string, string> = {
  website: "community",
  accounting: "finance",
  invoicing: "finance",
  expenses: "finance",
  "receipt-ocr": "finance",
  purchase: "purchasing",
  "stock-forecast-reorder": "purchasing",
  employees: "hr-payroll",
  payroll: "hr-payroll",
  "time-off": "hr-payroll",
  attendance: "hr-payroll",
  "hr-policy-assistant": "hr-payroll",
  "marketing-automation": "marketing",
  "email-marketing": "marketing",
  "campaign-management": "marketing",
  "marketing-copywriter": "marketing",
  "sms-marketing": "marketing",
  "social-planning": "marketing",
  "business-assistant": "ai",
  workflows: "ai",
  projects: "community",
  tasks: "community",
  documents: "community",
  "content-summarizer-chatbot": "community",
  iot: "manufacturing",
};
