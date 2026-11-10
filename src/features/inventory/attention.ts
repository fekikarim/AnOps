/** Shared shape and ordering for the "what needs my attention" list. Keep this file free of server-only imports. */

export type AttentionSeverity = "critical" | "warning" | "info";
export type AttentionModule = "inventory" | "purchasing" | "manufacturing";

export type AttentionItem = {
  id: string;
  module: AttentionModule;
  severity: AttentionSeverity;
  title: string;
  /** Why it matters or how to resolve it. */
  detail: string;
  actionLabel: string;
  href: string;
};

export const MAX_ATTENTION_ITEMS = 8;

const SEVERITY_ORDER: Record<AttentionSeverity, number> = { critical: 0, warning: 1, info: 2 };

const MODULE_ORDER: Record<AttentionModule, number> = { inventory: 0, purchasing: 1, manufacturing: 2 };

/** Blocked or urgent work first, then by module, then insertion order, so the list is stable between loads. */
export function rankAttention(items: AttentionItem[]): AttentionItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => SEVERITY_ORDER[a.item.severity] - SEVERITY_ORDER[b.item.severity] ||
        MODULE_ORDER[a.item.module] - MODULE_ORDER[b.item.module] ||
        a.index - b.index)
    .map(({ item }) => item);
}
