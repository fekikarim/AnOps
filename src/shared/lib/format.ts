/** Display helpers. Safe to import from server and client code. Dates use the company timezone when known. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Tunis" }).format(new Date(iso));
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "Africa/Tunis" }).format(new Date(iso));
}

/** Formats a decimal string (already fixed-point) with thousands separators, without floating-point rounding. */
export function formatDecimalString(value: string): string {
  const [whole, fraction] = value.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

export function formatMoney(amount: string, currencyCode: string): string {
  return `${formatDecimalString(amount)} ${currencyCode}`;
}
