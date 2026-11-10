import { z } from "zod";
import type { AiToolDefinition } from "@/server/ai/tools/define-tool";

/**
 * The tool list as the model reads it: one compact signature per tool instead of raw JSON Schema.
 * Raw schemas repeat limits and patterns the server enforces anyway (maxLength, additionalProperties, id regexes);
 * with five modules they pushed the prompt past the provider's request limit. Everything the model needs to build
 * a call is kept: names, which arguments are required, enum values, array and object shapes. The server still
 * validates every call against the real schema.
 */
type Node = {
  type?: string | string[];
  enum?: unknown[];
  const?: unknown;
  pattern?: string;
  items?: Node;
  properties?: Record<string, Node>;
  required?: string[];
  anyOf?: Node[];
  oneOf?: Node[];
};

function typeOf(node: Node | undefined): string {
  if (!node) return "any";
  if (node.const !== undefined) return String(node.const);
  if (node.enum) return node.enum.map(String).join("|");
  const union = node.anyOf ?? node.oneOf;
  if (union) return [...new Set(union.map(typeOf))].join("|");
  if (Array.isArray(node.type)) return node.type.map((t) => typeOf({ ...node, type: t })).join("|");
  const type = node.type;
  switch (type) {
    case "string":
      return node.pattern?.includes("[a-f0-9]{24}") || node.pattern?.includes("[0-9a-f]{24}") ? "id" : "string";
    case "integer":
      return "int";
    case "array":
      return `${typeOf(node.items)}[]`;
    case "object": {
      const props = Object.entries(node.properties ?? {});
      if (props.length === 0) return "{}";
      const required = new Set(node.required ?? []);
      return `{${props.map(([k, v]) => `${k}${required.has(k) ? "" : "?"}:${typeOf(v)}`).join(",")}}`;
    }
    default:
      return type ?? "any";
  }
}

export function toolSignature(tool: Pick<AiToolDefinition, "name" | "kind" | "description" | "input">): string {
  const schema = z.toJSONSchema(tool.input, { io: "input", unrepresentable: "any" }) as Node;
  return `- ${tool.name} [${tool.kind}] ${tool.description}\n  args ${typeOf(schema)}`;
}

export function toolCatalog(tools: readonly Pick<AiToolDefinition, "name" | "kind" | "description" | "input">[]): string {
  return tools.map(toolSignature).join("\n");
}

/** Words (English and French) that mean a conversation is about a module. */
const MODULE_WORDS: Record<string, RegExp> = {
  inventory: /\b(stock|inventor|products?|produits?|warehouses?|entrep[oô]ts?|sku|categor|movements?|mouvements?|transfer|adjust|reorder|on hand)/i,
  purchasing: /\b(suppl|fournisseur|purchas|achat|orders?|commandes?|po\b|receipts?|re[cç]us?|r[eé]ception|goods|replenish|r[eé]appro)/i,
  manufacturing: /\b(bom|bill of materials|nomenclature|work orders?|ordres? de fabrication|production|manufactur|fabricat|assembl|materials?|mati[eè]res?|components?)/i,
  hr: /\b(employees?|employ[eé]s?|staff|salar|salaire|payroll|paie|payslips?|fiche de paie|leave|cong[eé]s?|vacation|absence|attendance|pr[eé]sence|department|d[eé]partement|job titles?|poste|hr\b|rh\b|solde|hire|embauche|check.?in)/i,
  marketing: /\b(marketing|campaigns?|campagnes?|audiences?|contacts?|newsletter|templates?|mod[eè]les?|tags?|subscribers?|abonn[eé]s?|unsubscribe|d[eé]sabonn|sms|telegram|social|facebook|email blast|mailing|consent|consentement|segment)/i,
  community: /\b(community|communaut[eé]|blogs?|articles?|forum|topics?|sujets?|repl(y|ies)|r[eé]ponses?|comments?|commentaires?|chat|support|conversations?|visitors?|visiteurs?|publish|publier|pin\b|[eé]pingl)/i,
  finance: /\b(invoice|factur|customers?|clients?|payments?|paiements?|paid|expenses?|d[eé]penses?|finance|balance|solde|overdue|retard|owes?|revenue|cash|tax|tva|receivable|unpaid|impay|allocate|reconcil)/i,
};

/** Above this many estimated tokens the full list no longer fits a free provider's per-minute budget. */
const FULL_LIST_TOKENS = 3000;

/**
 * Narrows the tools DESCRIBED to the model to the modules the conversation is about (the latest message and the
 * recent ones). With more than a few thousand tokens of tools, a single chat turn (which makes several calls)
 * exhausts a free provider's per-minute limit. This only ever removes tools the member already has: access is
 * resolved first, and every call is checked against the full registry and live access again when it arrives.
 * No match at all means the person is asking in general terms, so the module-neutral reads are described.
 */
export function scopeTools<T extends Pick<AiToolDefinition, "name" | "kind" | "description" | "input" | "module">>(available: readonly T[], recentTexts: readonly string[]): T[] {
  if (toolCatalog(available).length / 4 <= FULL_LIST_TOKENS) return [...available];
  const text = recentTexts.join("\n");
  const wanted = new Set(Object.entries(MODULE_WORDS).filter(([, re]) => re.test(text)).map(([m]) => m));
  if (wanted.size === 0) return available.filter((t) => t.module === "core" || t.kind === "read");
  return available.filter((t) => t.module === "core" || wanted.has(t.module));
}
