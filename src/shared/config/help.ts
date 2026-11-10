import { faqItems, pricingFaq } from "@/shared/config/site";

/** Troubleshooting based on real product rules (see docs/ and src/server). */
export type HelpTopic = "account" | "access" | "ai" | "operations" | "finance" | "marketing" | "people" | "billing";

export type HelpItem = { id: string; topic: HelpTopic; kind: "faq" | "fix"; title: string; body: string; href?: string; app?: string };

export const helpTopics: { id: HelpTopic; label: string }[] = [
  { id: "account", label: "Account & sign-in" },
  { id: "access", label: "Roles & companies" },
  { id: "ai", label: "AnOps AI" },
  { id: "operations", label: "Stock & production" },
  { id: "finance", label: "Finance" },
  { id: "marketing", label: "Marketing" },
  { id: "people", label: "HR & Payroll" },
  { id: "billing", label: "Plans & billing" },
];

const fixes: HelpItem[] = [
  { id: "verify-email", topic: "account", kind: "fix", title: "I cannot sign in after creating my account", body: "Your email address must be confirmed first. Open the verification link we sent you; you can request a new one from the sign-in screen.", href: "/login" },
  { id: "forgot-password", topic: "account", kind: "fix", title: "I forgot my password", body: "Use “Forgot password” on the sign-in page. You will receive a link to choose a new password.", href: "/forgot-password" },
  { id: "missing-button", topic: "access", kind: "fix", title: "A module or button is missing for me", body: "What you see depends on your role in the active company. Employees have read-only access; ask an owner or admin to change your role.", href: "/docs/roles-and-permissions" },
  { id: "wrong-company", topic: "access", kind: "fix", title: "I see the wrong organization's data", body: "You may belong to several organizations. Use the organization switcher to change the active one; each has its own data, members and plan.", href: "/docs/roles-and-permissions" },
  { id: "ai-unavailable", topic: "ai", kind: "fix", title: "AnOps AI says I do not have access", body: "AI must be enabled for the company and granted to you by the owner, per module and operation, within your role. Your token limit may also be reached for today.", href: "/docs/grant-ai-access", app: "ai" },
  { id: "ai-proposal", topic: "ai", kind: "fix", title: "AI prepared an action but nothing changed", body: "Writes are proposals. Open the proposal card and confirm it. Proposals are cancelled if access is revoked or AI is turned off.", href: "/apps/ai", app: "ai" },
  { id: "stock-not-up", topic: "operations", kind: "fix", title: "Stock did not increase after approving a purchase order", body: "Approval never changes stock. Create and post a goods receipt for what actually arrived.", href: "/docs/receive-a-purchase-order", app: "purchasing" },
  { id: "wo-blocked", topic: "operations", kind: "fix", title: "A work order cannot be completed", body: "Completion needs every component in stock. If one is short, nothing is consumed and the order stays in progress. Receive the missing parts, then complete again.", href: "/docs/run-a-work-order", app: "manufacturing" },
  { id: "adjust-stock", topic: "operations", kind: "fix", title: "I need to correct a stock count", body: "Owners and admins can record an adjustment with a reason. The ledger keeps the history; past movements are never edited.", href: "/docs/app-inventory", app: "inventory" },
  { id: "invoice-edit", topic: "finance", kind: "fix", title: "I cannot edit a posted invoice", body: "Posted invoices change only through credit notes, voids or payments, so the history stays complete.", href: "/docs/app-finance", app: "finance" },
  { id: "telegram-receipt", topic: "finance", kind: "fix", title: "My Telegram receipt did not appear", body: "Check that your chat is linked from Finance → Receipts. Link codes are single-use; generate a new one if needed. Duplicate files are ignored.", href: "/docs/telegram-receipts", app: "finance" },
  { id: "campaign-skipped", topic: "marketing", kind: "fix", title: "Some contacts did not receive a campaign", body: "Consent is checked again at send time. Contacts without consent for that channel, or who unsubscribed, are skipped.", href: "/docs/first-email-campaign", app: "marketing" },
  { id: "leave-blocked", topic: "people", kind: "fix", title: "A leave request is marked as blocked", body: "Hard rules found a problem: not enough balance, an overlap with approved leave, a missing document or invalid dates.", href: "/docs/approve-leave", app: "hr-payroll" },
];

export const helpItems: HelpItem[] = [
  ...fixes,
  ...faqItems.map((item, i) => ({ id: `faq-${i}`, topic: (i === 2 || i === 3 ? "ai" : i === 4 ? "billing" : "account") as HelpTopic, kind: "faq" as const, title: item.question, body: item.answer })),
  ...pricingFaq.map((item, i) => ({ id: `billing-${i}`, topic: "billing" as HelpTopic, kind: "faq" as const, title: item.question, body: item.answer, href: "/pricing" })),
];
