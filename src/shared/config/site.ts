import { ALLOPS_APP_COUNT, CUSTOM_MAX_APPS, CUSTOM_MIN_APPS, TOTAL_APP_COUNT, formatMoney, quotePrice } from "@/shared/domain/plans";

export const siteName = "AnOps";
export const siteTagline = "One platform. Every operation.";
export const siteDescription =
  "An AI-native, modular business platform that connects sales, finance, supply chain, people and marketing in one workspace.";

export const primaryNav = [
  { label: "Apps", href: "/apps" },
  { label: "Industries", href: "/industries" },
  { label: "Pricing", href: "/pricing" },
  { label: "Community", href: "/community-hub" },
  { label: "Help", href: "/help" },
] as const;

export const footerGroups = [
  {
    title: "Product",
    links: [
      { label: "Apps", href: "/apps" },
      { label: "AnOps AI", href: "/apps/ai" },
      { label: "Industries", href: "/industries" },
      { label: "Pricing", href: "/pricing" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Documentation", href: "/docs" },
      { label: "Guides", href: "/docs#guides" },
      { label: "Community", href: "/community-hub" },
      { label: "Help center", href: "/help" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Contact", href: "/contact" },
      { label: "Sign in", href: "/login" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
    ],
  },
] as const;


export type Plan = {
  id: "oneops" | "custom" | "allops" | "maxops";
  name: string;
  price: string;
  priceNote: string;
  audience: string;
  description: string;
  companies: string;
  applications: string;
  features: string[];
  cta: { label: string; href: string };
  highlight?: string;
};

const usd = (plan: "allops" | "maxops" | "custom", appCount?: number) => formatMoney(quotePrice({ plan, currency: "usd", interval: "month", appCount }).total, "usd");
const eur = (plan: "allops" | "maxops" | "custom", appCount?: number) => formatMoney(quotePrice({ plan, currency: "eur", interval: "month", appCount }).total, "eur");

/** Public plan cards. Prices are computed from src/shared/domain/plans.ts (single source of truth). */
export const plans: Plan[] = [
  {
    id: "oneops",
    name: "OneOps",
    price: "Free",
    priceNote: "Forever · no card",
    audience: "Run one area of your business",
    description: "One application of your choice, free forever.",
    companies: "Per organization",
    applications: "1 application",
    features: ["One application, chosen once", "Unlimited users", "No expiration", "AI features not included"],
    cta: { label: "Try it free", href: "/trial" },
  },
  {
    id: "custom",
    name: "Custom",
    price: `from ${usd("custom", 2)}`,
    priceNote: `per month for 2 applications · from ${eur("custom", 2)} in EUR`,
    audience: "Pay only for the applications you use",
    description: `${CUSTOM_MIN_APPS} to ${CUSTOM_MAX_APPS} applications, always priced below AllOps.`,
    companies: "Per organization",
    applications: `${CUSTOM_MIN_APPS}–${CUSTOM_MAX_APPS} applications`,
    features: ["US$9 / €8 per application", `Never more than ${usd("custom", CUSTOM_MAX_APPS)}/month`, "Unlimited users", "Optional AI add-on"],
    cta: { label: "Start a 15-day trial", href: "/trial" },
  },
  {
    id: "allops",
    name: "AllOps",
    price: usd("allops"),
    priceNote: `per month · ${eur("allops")} in EUR`,
    audience: "A business running on connected apps",
    description: "Every application in one workspace.",
    companies: "Per organization",
    applications: `${ALLOPS_APP_COUNT} applications · no AI`,
    features: [`${ALLOPS_APP_COUNT} applications (all except AnOps AI)`, "Unlimited users", "Records shared across apps", "No AI features anywhere"],
    cta: { label: "Start a 15-day trial", href: "/trial" },
    highlight: "Best value",
  },
  {
    id: "maxops",
    name: "MaxOps",
    price: usd("maxops"),
    priceNote: `per month · ${eur("maxops")} in EUR`,
    audience: "Teams that want the most from AI",
    description: "Every application with the complete AI ecosystem.",
    companies: "Per organization",
    applications: `All ${TOTAL_APP_COUNT} applications`,
    features: ["Everything in AllOps", "AnOps AI Command Center", "AI features in every application", "Advanced AI capabilities"],
    cta: { label: "Start a 15-day trial", href: "/trial" },
  },
];

export const comparisonRows: { label: string; values: [string, string, string, string] }[] = [
  { label: "Applications", values: ["1, chosen once", `${CUSTOM_MIN_APPS}–${CUSTOM_MAX_APPS} of your choice`, `${ALLOPS_APP_COUNT} (no AnOps AI)`, `All ${TOTAL_APP_COUNT}`] },
  { label: "Users", values: ["Unlimited", "Unlimited", "Unlimited", "Unlimited"] },
  { label: "Records shared across apps", values: ["—", "Included", "Included", "Included"] },
  { label: "AnOps AI application", values: ["—", "With AI add-on", "—", "Included"] },
  { label: "AI features inside applications", values: ["—", "With AI add-on", "—", "Included"] },
  { label: "Monthly price (USD)", values: ["Free", `${usd("custom", 2)}–${usd("custom", CUSTOM_MAX_APPS)}`, usd("allops"), usd("maxops")] },
  { label: "Monthly price (EUR)", values: ["Free", `${eur("custom", 2)}–${eur("custom", CUSTOM_MAX_APPS)}`, eur("allops"), eur("maxops")] },
  { label: "Annual billing", values: ["—", "2 months free", "2 months free", "2 months free"] },
];

export const pricingFaq = [
  {
    question: "How does the free trial work?",
    answer: "Select two or three applications at sign-up for a 15-day trial with AI features included. No card is needed. When it ends, choose AllOps, MaxOps or Custom, or keep one application free with OneOps.",
  },
  {
    question: "Is OneOps really free forever?",
    answer: "Yes. One application, unlimited users, no expiration. The application is chosen once and cannot be changed later. AI features are not included.",
  },
  {
    question: "Do you charge per user?",
    answer: "No. Every plan includes unlimited users. Prices are per organization.",
  },
  {
    question: "What is the difference between AllOps and MaxOps?",
    answer: `AllOps includes ${ALLOPS_APP_COUNT} applications and no AI at all: AnOps AI is not available and no application has AI features. MaxOps adds AnOps AI (application number ${TOTAL_APP_COUNT}) and the AI features inside every application.`,
  },
  {
    question: "How is payment handled?",
    answer: "Payments are processed securely by Stripe in US dollars or euros. Prices exclude applicable taxes. You can cancel at any time; access continues until the end of the paid period and your data is preserved.",
  },
] as const;

export const faqItems = [
  {
    question: "Who is AnOps designed for?",
    answer:
      "Small and medium-sized businesses that need one operational foundation across customers, sales, finance, stock and team workflows.",
  },
  {
    question: "Do we need every app?",
    answer:
      `No. Choose the apps you need. OneOps keeps one application free forever, Custom covers ${CUSTOM_MIN_APPS} to ${CUSTOM_MAX_APPS}, AllOps includes ${ALLOPS_APP_COUNT} (no AI) and MaxOps all ${TOTAL_APP_COUNT} with AI.`,
  },
  {
    question: "Can AI change records or send orders on its own?",
    answer:
      "No. AI features are designed to suggest and draft. An authorized person reviews and confirms each action before it takes effect.",
  },
  {
    question: "What happens when an AI feature is unavailable?",
    answer:
      "The workspace is designed to remain usable. You can open the underlying records and continue the work manually.",
  },
  {
    question: "How do we discuss pricing?",
    answer:
      "Prices are on the pricing page: OneOps is free, Custom starts at US$18 per month, AllOps is US$49 and MaxOps US$99, with unlimited users.",
  },
] as const;

export const gettingStarted = [
  { step: "Explore the apps", detail: "Browse the directory and check the status of each application.", href: "/apps" },
  { step: "Compare plans", detail: "See what OneOps, Custom, AllOps and MaxOps include.", href: "/pricing" },
  { step: "Talk to us", detail: "Tell us about your operations and we will discuss the right setup.", href: "/contact" },
] as const;
