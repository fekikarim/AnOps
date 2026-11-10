/** Smart defaults for codes the user would otherwise have to invent. Pure functions; the user can always overwrite them. */

/** A short, readable warehouse code from the name: "Main Store" becomes "MS", "Central" becomes "CENTRA". */
export function suggestWarehouseCode(name: string): string {
  const words = name.toUpperCase().match(/[A-Z0-9]+/g) ?? [];
  if (words.length === 0) return "";
  const code = words.length === 1 ? words.join("").slice(0, 6) : words.map((word) => word.charAt(0)).join("").slice(0, 6);
  // The schema needs 2 to 12 characters.
  return code.length >= 2 ? code : `${code}1`;
}

/** Product SKU suggestion from the name: "Steel sheet 2 mm" becomes "STEEL-SHEET-2-MM". */
export function suggestSku(name: string): string {
  return (name.toUpperCase().match(/[A-Z0-9]+/g) ?? []).join("-").slice(0, 32);
}
