/** Lower-cases and trims an email address. Empty input means "no email". */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Normalizes a phone number to digits with an optional leading "+" (E.164-style, 6 to 15 digits).
 * Returns null when the value cannot be a phone number. Empty input returns "".
 */
export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  let compact = trimmed.replace(/[\s().-]/g, "");
  if (compact.startsWith("00")) compact = `+${compact.slice(2)}`;
  return /^\+?\d{6,15}$/.test(compact) ? compact : null;
}

/** Lower-cased key used for case-insensitive contact search. */
export function searchNameOf(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim().toLowerCase();
}

/** Lower-cased key for uniqueness checks on named records (tags, audiences, templates). */
export function normalizeName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Email addresses are compared lower-cased and stored only in their normalized form for dedupe. */
export function isPlausibleEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) && value.length <= 254;
}
