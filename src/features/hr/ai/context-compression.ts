/**
 * Keeps what the copilot sends to a model small. Free tiers allow only a few thousand tokens a minute,
 * so every part of a request is bounded here. Pure functions, no I/O.
 */

const HISTORY_MESSAGES = 4;
const HISTORY_CHARS = 240;
const POLICY_SECTION_CHARS = 450;

/** Removes Markdown decoration and collapses whitespace: both cost tokens and carry no meaning for a model. */
export function compactText(text: string): string {
  return text
    .replace(/[*_`#>|]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Cuts at the last sentence end before the limit, so a fragment is never presented as the whole rule. */
export function truncateAtSentence(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "), cut.lastIndexOf(": "));
  return end > limit / 2 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
}

export function compressPolicyText(text: string): string {
  return truncateAtSentence(compactText(text), POLICY_SECTION_CHARS);
}

/** The last two exchanges, each cut short. Enough for a follow-up like "yes, next Monday instead". */
export function compressHistory(
  history: Array<{ role: string; content: string }> = []
): Array<{ role: "user" | "assistant"; content: string }> {
  return history
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content.trim())
    .slice(-HISTORY_MESSAGES)
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: truncateAtSentence(compactText(m.content), HISTORY_CHARS),
    }));
}

/** Which tools a kind of message can need. Tools are the largest part of a request after the prompt. */
const TOOL_GROUPS: Array<{ pattern: RegExp; tools: string[] }> = [
  {
    pattern: /\b(book|take|want|need|request|reserve|vacation|holiday|time off|day off|poser|prendre|réserver|demande|je veux|nheb|n7eb)\b|أريد|اريد|احجز/i,
    tools: ["create_leave_draft", "check_leave_feasibility"],
  },
  {
    pattern: /\b(can i|could i|possible|feasible|puis-je|possible)\b/i,
    tools: ["check_leave_feasibility"],
  },
  {
    pattern: /\b(cancel|annul\w*|withdraw|alghi)\b|إلغاء|الغاء/i,
    tools: ["get_my_leave_requests", "cancel_my_leave_request"],
  },
  {
    pattern: /\b(requests?|demandes?|status|statut)\b|طلب/i,
    tools: ["get_my_leave_requests", "get_pending_requests"],
  },
  {
    pattern: /\b(balance|solde|left|remaining|reste|combien|how many|9adeh|b9ali)\b|رصيد|كم/i,
    tools: ["get_my_leave_balance", "get_employee_leave_summary"],
  },
  {
    pattern: /\b(salary|pay|payroll|payslip|deduct\w*|net|salaire|paie|déduc\w*|chhar)\b|راتب/i,
    tools: ["get_my_payroll_preview", "generate_payroll_preview"],
  },
  { pattern: /\b(absent|absence|attendance|présence|off today)\b|غياب/i, tools: ["get_absent_today"] },
  { pattern: /\b(calendar|on leave|overlap|next week|calendrier|équipe|team)\b/i, tools: ["get_team_calendar"] },
];

const ALWAYS_AVAILABLE = "search_hr_policies";

/**
 * Narrows the tool list to what this message can need. This saves tokens only: it runs after role scoping,
 * so it can never add a tool. With no match, as with a short follow-up, the whole list is kept.
 */
export function selectToolsForMessage<T extends { name: string }>(message: string, tools: T[]): T[] {
  const wanted = new Set<string>([ALWAYS_AVAILABLE]);
  let matched = false;
  for (const group of TOOL_GROUPS) {
    if (group.pattern.test(message)) {
      matched = true;
      group.tools.forEach((name) => wanted.add(name));
    }
  }
  return matched ? tools.filter((tool) => wanted.has(tool.name)) : tools;
}

/**
 * The parts of a JSON schema a model needs in order to call a tool. Bounds and patterns go:
 * arguments are still fully validated by Zod before a tool runs.
 */
export function compactToolSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ["type", "description", "enum", "required"]) {
    if (schema[key] !== undefined) out[key] = schema[key];
  }
  if (schema.properties && typeof schema.properties === "object") {
    out.properties = Object.fromEntries(
      Object.entries(schema.properties as Record<string, Record<string, unknown>>).map(([name, value]) => [
        name,
        compactToolSchema(value),
      ])
    );
  }
  return out;
}
