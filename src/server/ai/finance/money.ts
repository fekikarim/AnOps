import { computeTotals } from "@/features/finance/utils/money";

/**
 * Money rules for the Finance AI tools. No model ever computes an amount: every figure the person
 * sees comes from these functions or from the Finance service itself. Amounts travel as strings and
 * are compared in whole cents, so a sum of two prices can never drift by a fraction of a cent.
 * The Finance module stores two decimals; more than two decimals is refused, never silently rounded.
 */

export const CURRENCIES = ["TND", "USD", "EUR", "GBP"] as const;
export type Currency = (typeof CURRENCIES)[number];

export class MoneyError extends Error {}

/** "1 250,50" and "1250.5" are read; "1,250.50", "12.345" and "-3" are refused. Returns whole cents. */
export function parseAmountCents(input: unknown, label = "Amount"): number {
  if (typeof input !== "string" && typeof input !== "number") throw new MoneyError(`${label} is required.`);
  let s = String(input).trim().replace(/[\s  ]/g, "");
  if (s.includes(",") && s.includes(".")) throw new MoneyError(`${label} "${String(input).slice(0, 20)}" is ambiguous. Write it like 1250.50.`);
  if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");
  const m = /^(\d{1,12})(?:\.(\d+))?$/.exec(s);
  if (!m) throw new MoneyError(`${label} "${String(input).slice(0, 20)}" is not a valid amount.`);
  const decimals = m[2] ?? "";
  if (decimals.length > 2) throw new MoneyError(`${label} can have at most 2 decimals.`);
  return Number(m[1]) * 100 + Number(decimals.padEnd(2, "0") || "0");
}

export function parsePositiveCents(input: unknown, label = "Amount"): number {
  const cents = parseAmountCents(input, label);
  if (cents <= 0) throw new MoneyError(`${label} must be greater than zero.`);
  return cents;
}

/** A percentage between 0 and 100 with at most two decimals. */
export function parseRate(input: unknown, label = "Tax rate"): number {
  const s = String(input ?? "0").trim().replace("%", "").replace(",", ".");
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(s === "" ? "0" : s);
  if (!m) throw new MoneyError(`${label} must be a percentage like 19 or 7.5.`);
  const rate = Number(s === "" ? "0" : s);
  if (rate > 100) throw new MoneyError(`${label} cannot be above 100%.`);
  return rate;
}

export function parseQuantityInt(input: unknown): number {
  const s = String(input ?? "").trim();
  if (!/^\d{1,7}$/.test(s) || Number(s) < 1) throw new MoneyError("Quantity must be a whole number of at least 1.");
  return Number(s);
}

/** A stored amount (a JS number from the service) as whole cents. */
export const toCents = (n: number | undefined | null): number => Math.round((Number(n) || 0) * 100);
export const fromCents = (c: number): number => c / 100;

/** "1250.50" from cents. Always two decimals. */
export function centsText(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
export const money = (cents: number, currency: string) => `${centsText(cents)} ${currency}`;
/** A stored service amount, shown with two decimals and its currency. */
export const moneyOf = (n: number | undefined | null, currency: string) => money(toCents(n), currency);

export type PricedLine = { quantity: number; unitPrice: number; taxRate: number };

/** Totals from the Finance module's own function, the one the service stores, expressed in cents. */
export function invoiceTotalsCents(lines: PricedLine[]) {
  const t = computeTotals(lines);
  return { subtotal: toCents(t.subtotal), tax: toCents(t.taxTotal), total: toCents(t.total) };
}

/** A line's total with its tax, from the same function, so the lines always add up to the invoice total. */
export const lineTotalCents = (l: PricedLine): number => invoiceTotalsCents([l]).total;

/** Today in the company's timezone (Africa/Tunis), as YYYY-MM-DD. */
export function todayTunis(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Tunis", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function parseDate(input: unknown, label: string): string {
  const s = String(input ?? "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new MoneyError(`${label} must be a date like 2026-12-31.`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) throw new MoneyError(`${label} is not a real date.`);
  return s;
}
