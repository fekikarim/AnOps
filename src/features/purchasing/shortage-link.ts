/**
 * Hand-off from "we are short of these materials" to a prefilled purchase order.
 * The link only carries product ids and quantities. The order page re-validates both and loads the
 * product details itself, so a forged link can pre-select nothing the caller could not already choose.
 * Keep this file free of server-only imports.
 */

export type ShortageLine = { productId: string; quantity: string };

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const QUANTITY = /^\d{1,6}(\.\d{1,6})?$/;
export const MAX_PREFILL_LINES = 50;

export function buildShortagePurchaseHref(lines: ShortageLine[], source?: { workOrderId?: string }): string {
  const encoded = lines
    .filter((line) => OBJECT_ID.test(line.productId) && QUANTITY.test(line.quantity) && Number(line.quantity) > 0)
    .slice(0, MAX_PREFILL_LINES)
    .map((line) => `${line.productId}:${line.quantity}`)
    .join(",");
  const params = new URLSearchParams();
  if (encoded) params.set("lines", encoded);
  if (source?.workOrderId && OBJECT_ID.test(source.workOrderId)) params.set("workOrder", source.workOrderId);
  const query = params.toString();
  return query ? `/purchasing/orders/new?${query}` : "/purchasing/orders/new";
}

/** Parses the `lines` query value. Malformed or duplicate entries are dropped rather than trusted. */
export function parseShortageLines(raw: string | string[] | undefined): ShortageLine[] {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return [];
  const seen = new Set<string>();
  const lines: ShortageLine[] = [];
  for (const part of value.split(",").slice(0, MAX_PREFILL_LINES)) {
    const [productId, quantity] = part.split(":");
    if (!productId || !quantity) continue;
    if (!OBJECT_ID.test(productId) || !QUANTITY.test(quantity) || Number(quantity) <= 0) continue;
    const id = productId.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    lines.push({ productId: id, quantity });
  }
  return lines;
}
