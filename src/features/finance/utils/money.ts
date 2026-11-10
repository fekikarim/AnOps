export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

export function sumAmounts(amounts: number[]): number {
  const totalCents = amounts.reduce((acc, a) => acc + toCents(a || 0), 0);
  return fromCents(totalCents);
}

export function subtractAmounts(a: number, b: number): number {
  const result = toCents(a || 0) - toCents(b || 0);
  return fromCents(result);
}

export function addAmounts(a: number, b: number): number {
  const result = toCents(a || 0) + toCents(b || 0);
  return fromCents(result);
}

export function roundMoney(amount: number, decimals = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round((amount || 0) * factor) / factor;
}

export function computeLineTotal(quantity: number, unitPrice: number, taxRate?: number): number {
  const base = roundMoney((quantity || 0) * (unitPrice || 0));
  if (!taxRate || taxRate <= 0) return base;
  const tax = roundMoney(base * (taxRate / 100));
  return roundMoney(base + tax);
}

/**
 * Tunisian timbre fiscal: a fixed stamp duty added to the total of an invoice (1.000 TND under the current
 * finance law). Kept here as one constant so an accountant can update it in one place.
 */
export const TIMBRE_FISCAL_TND = 1;

/** The stamp duty for an invoice: only for TND invoices that ask for it. */
export function stampDutyFor(currency: string | undefined, wanted: boolean | undefined): number {
  return wanted && (currency ?? "TND") === "TND" ? TIMBRE_FISCAL_TND : 0;
}

export function computeTotals(lines: Array<{ quantity: number; unitPrice: number; taxRate?: number }>) {
  let subtotal = 0;
  let taxTotal = 0;

  for (const line of lines) {
    const qty = line.quantity || 0;
    const price = line.unitPrice || 0;
    const base = roundMoney(qty * price);
    subtotal = addAmounts(subtotal, base);
    if (line.taxRate && line.taxRate > 0) {
      taxTotal = addAmounts(taxTotal, roundMoney(base * (line.taxRate / 100)));
    }
  }

  const total = addAmounts(subtotal, taxTotal);
  return { subtotal: roundMoney(subtotal), taxTotal: roundMoney(taxTotal), total: roundMoney(total) };
}
