/**
 * Industry solutions. Each one only references the 11 real managements and their real behaviour.
 * Outcomes are qualitative: AnOps has no published customer metrics.
 */
export type IndustryStep = { app: string; label: string; detail: string };

export type Industry = {
  slug: string;
  name: string;
  icon: string;
  accent: string;
  summary: string;
  intro: string;
  challenges: { title: string; body: string }[];
  answers: { challenge: string; app: string; how: string }[];
  apps: string[];
  flow: IndustryStep[];
  outcomes: string[];
};

export const industries: Industry[] = [
  {
    slug: "manufacturing",
    name: "Manufacturing",
    icon: "wired-lineal-3511-manufacturing-hover-pinch.webp",
    accent: "#5E9C86",
    summary: "Keep purchasing, stock and production on one ledger so work orders are not stopped by missing parts.",
    intro:
      "Small manufacturers often plan production in one spreadsheet, track stock in another and order from suppliers by email. AnOps puts bills of materials, work orders, purchase orders and stock on the same records.",
    challenges: [
      { title: "Shortages found too late", body: "A missing component is discovered on the shop floor, after the order has started." },
      { title: "Stock that does not match reality", body: "Production consumption and receipts are recorded by hand, days later." },
      { title: "Changing recipes", body: "An updated bill of materials silently changes orders already in progress." },
    ],
    answers: [
      { challenge: "Shortages found too late", app: "manufacturing", how: "Completion checks every component; if one is short, nothing is consumed and the order stays open." },
      { challenge: "Stock that does not match reality", app: "inventory", how: "Completion and goods receipts write to the stock ledger in the same transaction." },
      { challenge: "Changing recipes", app: "manufacturing", how: "Work orders snapshot the BOM revision they were created from." },
    ],
    apps: ["manufacturing", "inventory", "purchasing", "finance", "ai"],
    flow: [
      { app: "purchasing", label: "Order components", detail: "Approve a purchase order for raw materials." },
      { app: "inventory", label: "Receive stock", detail: "Post the goods receipt; stock increases." },
      { app: "manufacturing", label: "Produce", detail: "Start and complete the work order." },
      { app: "inventory", label: "Finished goods", detail: "Components issued, products received." },
      { app: "finance", label: "Invoice", detail: "Bill the customer from Finance." },
    ],
    outcomes: ["Fewer production stops for missing parts", "Stock figures you can trust", "Traceability from supplier to finished product"],
  },
  {
    slug: "distribution",
    name: "Distribution & Wholesale",
    icon: "wired-lineal-108-box-hover-squeeze.webp",
    accent: "#C59A2B",
    summary: "One view of stock across warehouses, controlled purchasing and invoices that get paid.",
    intro:
      "Distributors live on margins and stock turns. AnOps connects suppliers, warehouses and customer invoices so buyers, warehouse staff and finance work from the same numbers.",
    challenges: [
      { title: "Stock spread across locations", body: "Nobody knows exactly what is in each warehouse before promising a delivery." },
      { title: "Partial deliveries", body: "Suppliers deliver in several shipments and orders are hard to follow." },
      { title: "Late customer payments", body: "Overdue invoices are noticed at month-end." },
    ],
    answers: [
      { challenge: "Stock spread across locations", app: "inventory", how: "Balances per product and warehouse, traceable to every movement." },
      { challenge: "Partial deliveries", app: "purchasing", how: "Receive what arrived; the order stays partially received until complete." },
      { challenge: "Late customer payments", app: "finance", how: "Overdue invoices are flagged and the Finance Copilot drafts reminders." },
    ],
    apps: ["inventory", "purchasing", "finance", "ai", "company"],
    flow: [
      { app: "purchasing", label: "Buy", detail: "Approve the supplier order." },
      { app: "inventory", label: "Store", detail: "Receive into the right warehouse." },
      { app: "finance", label: "Invoice", detail: "Issue and send the customer invoice." },
      { app: "finance", label: "Collect", detail: "Record and allocate the payment." },
    ],
    outcomes: ["Fewer promises you cannot keep", "Clear status for every supplier order", "Faster follow-up on overdue invoices"],
  },
  {
    slug: "retail",
    name: "Retail & E-commerce",
    icon: "wired-lineal-3541-shopping-basket-online-hover-pinch.webp",
    accent: "#E5604D",
    summary: "Reach customers with consent, keep shelves stocked and keep the books straight.",
    intro:
      "Retailers juggle promotions, stock and receipts. AnOps brings consent-aware marketing, inventory and finance together, so a campaign never promotes what you cannot ship.",
    challenges: [
      { title: "Promotions without permission", body: "Customer lists are copied between tools and consent is lost along the way." },
      { title: "Receipts everywhere", body: "Store expenses arrive as paper receipts and photos in personal phones." },
      { title: "Promoting out-of-stock items", body: "Marketing does not see stock levels." },
    ],
    answers: [
      { challenge: "Promotions without permission", app: "marketing", how: "Consent per channel is checked again at the moment each message is sent." },
      { challenge: "Receipts everywhere", app: "finance", how: "Staff send receipts through Telegram; they become draft expenses for review." },
      { challenge: "Promoting out-of-stock items", app: "inventory", how: "Stock by warehouse is one click away for the whole team." },
    ],
    apps: ["marketing", "inventory", "finance", "community", "ai"],
    flow: [
      { app: "marketing", label: "Audience", detail: "Build an audience of opted-in customers." },
      { app: "marketing", label: "Campaign", detail: "Approve and schedule email, SMS or Telegram." },
      { app: "inventory", label: "Stock", detail: "Check availability per location." },
      { app: "finance", label: "Expenses", detail: "Capture store receipts by Telegram." },
    ],
    outcomes: ["Campaigns that respect consent", "No lost receipts", "Marketing and stock aligned"],
  },
  {
    slug: "professional-services",
    name: "Professional Services",
    icon: "wired-lineal-2538-hands-teamwork-hover-pinch.webp",
    accent: "#E08A3C",
    summary: "Run your people, billing and expenses without chasing spreadsheets.",
    intro:
      "Consultancies and service firms sell time and expertise. AnOps keeps leave, attendance, payroll, invoicing and expenses connected so partners spend less time on administration.",
    challenges: [
      { title: "Leave planning by email", body: "Approvals depend on who answers first, and overlaps are spotted too late." },
      { title: "Expense reimbursement delays", body: "Receipts and approvals take weeks." },
      { title: "Knowledge stuck in inboxes", body: "Procedures and lessons learned are not written down anywhere central." },
    ],
    answers: [
      { challenge: "Leave planning by email", app: "hr-payroll", how: "The Approval Advisor shows balance, team overlap and history before you decide." },
      { challenge: "Expense reimbursement delays", app: "finance", how: "Scanned receipts become draft expenses that finance reviews and posts." },
      { challenge: "Knowledge stuck in inboxes", app: "community", how: "Publish internal articles with AI summaries and discuss them in the forum." },
    ],
    apps: ["hr-payroll", "finance", "community", "ai"],
    flow: [
      { app: "hr-payroll", label: "Plan people", detail: "Approve leave with the advisor." },
      { app: "hr-payroll", label: "Payroll", detail: "Prepare payslips from attendance." },
      { app: "finance", label: "Bill clients", detail: "Invoice and record payments." },
      { app: "community", label: "Share knowledge", detail: "Publish procedures for the team." },
    ],
    outcomes: ["Consistent leave decisions", "Faster reimbursements", "Shared know-how"],
  },
  {
    slug: "agencies",
    name: "Marketing & Media Agencies",
    icon: "wired-lineal-963-multichannel-hover-pinch.webp",
    accent: "#3E9BD6",
    summary: "Plan campaigns across channels with approval, consent and honest reporting.",
    intro:
      "Agencies run many campaigns across channels. AnOps gives them audiences built from rules, templates, approval before sending, an AI copywriter for first drafts and analytics with clear denominators.",
    challenges: [
      { title: "Too many tools per campaign", body: "Email, SMS, social and reporting live in separate products." },
      { title: "Approvals slow launches", body: "Copy goes back and forth in chat threads." },
      { title: "Vanity metrics", body: "Rates are reported without saying what they were computed on." },
    ],
    answers: [
      { challenge: "Too many tools per campaign", app: "marketing", how: "Email, SMS, Telegram and Facebook Page posts from one workspace." },
      { challenge: "Approvals slow launches", app: "marketing", how: "Campaigns have an approval step and the AI copywriter drafts copy for review." },
      { challenge: "Vanity metrics", app: "marketing", how: "Analytics always show rates with their denominators." },
    ],
    apps: ["marketing", "community", "finance", "ai"],
    flow: [
      { app: "marketing", label: "Draft", detail: "Generate copy with the AI copywriter." },
      { app: "marketing", label: "Approve", detail: "Review and approve the campaign." },
      { app: "marketing", label: "Send", detail: "Dispatch to the recipient snapshot." },
      { app: "finance", label: "Bill", detail: "Invoice the client for the work." },
    ],
    outcomes: ["Fewer tools to manage", "Faster, controlled launches", "Reports clients can trust"],
  },
  {
    slug: "groups",
    name: "Multi-company Groups",
    icon: "wired-lineal-3308-building-office-in-reveal.webp",
    accent: "#4C7BD9",
    summary: "Several entities, one login, strictly separated data.",
    intro:
      "Family groups and holdings often run several small companies. AnOps lets the same person work in each with the right role, while each company's data stays isolated.",
    challenges: [
      { title: "One login per entity", body: "Staff juggle accounts and passwords for each company." },
      { title: "Data leaking between entities", body: "Shared spreadsheets mix records from different companies." },
      { title: "Different roles in different companies", body: "A manager in one company should only view another." },
    ],
    answers: [
      { challenge: "One login per entity", app: "hr-payroll", how: "Switch between your organizations from the same account, each with its own plan, members and data." },
      { challenge: "Data leaking between entities", app: "finance", how: "Every query is scoped to the active organization on the server, and each organization keeps separate books." },
      { challenge: "Different roles in different companies", app: "hr-payroll", how: "Roles are defined per membership, never globally, and managed from the organization page." },
    ],
    apps: ["ai", "finance", "hr-payroll", "inventory"],
    flow: [
      { app: "finance", label: "Separate books", detail: "One organization per legal entity, each with its own ledger." },
      { app: "hr-payroll", label: "Invite people", detail: "Assign a role in each organization." },
      { app: "ai", label: "Grant AI", detail: "Enable AI per member and module." },
      { app: "inventory", label: "Track stock", detail: "Stock stays inside its own organization." },
    ],
    outcomes: ["One account for every entity", "Isolation you do not have to think about", "Roles that match responsibilities"],
  },
];

export function getIndustry(slug: string) {
  return industries.find((industry) => industry.slug === slug);
}
