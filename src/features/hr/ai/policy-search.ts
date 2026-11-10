import { COMPANY_POLICIES } from "@/features/hr/policies/company-policies";

export type PolicySection = { source: string; section: string; text: string };

const SECTION_HEADING = /^\d+\.\s+\*\*(.+?)\*\*:?\s*$/;

/** Splits each policy into its numbered sections, so answers can cite the section they used. */
function buildSections(): PolicySection[] {
  const sections: PolicySection[] = [];
  for (const policy of COMPANY_POLICIES) {
    let current: PolicySection | null = null;
    for (const line of policy.content.split("\n")) {
      const heading = line.match(SECTION_HEADING);
      if (heading) {
        current = { source: policy.title, section: heading[1], text: "" };
        sections.push(current);
      } else if (current) {
        current.text += `${line}\n`;
      }
    }
  }
  return sections;
}

const POLICY_SECTIONS = buildSections();

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 3);
}

/** Keyword search over policy sections. A title match counts more than a body match. */
export function searchPolicies(query: string, limit = 2): PolicySection[] {
  const terms = [...new Set(tokenize(query))];
  return POLICY_SECTIONS.map((section) => {
    const title = tokenize(`${section.source} ${section.section}`);
    const body = tokenize(section.text);
    const score = terms.reduce(
      (sum, term) => sum + (title.includes(term) ? 3 : 0) + (body.includes(term) ? 1 : 0),
      0
    );
    return { section, score };
  })
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((hit) => hit.section);
}

/** Words that appear across every policy, so they say nothing about which one a question is about. */
const GENERIC_TERMS = new Set(
  "leave request requests pending policy policies days day company employee what when why how the this that with have does can please show tell about happens rule rules conge conges demande jours jour quel quelle comment pourquoi politique".split(" ")
);

/** The section a question is clearly about: one of its specific words must be in the section's title. Otherwise null. */
export function clearPolicyMatch(question: string): PolicySection | null {
  const specific = tokenize(question).filter((term) => !GENERIC_TERMS.has(term));
  if (specific.length === 0) return null;
  const [best] = searchPolicies(specific.join(" "), 1);
  if (!best) return null;
  const title = tokenize(`${best.source} ${best.section}`);
  return specific.some((term) => title.includes(term)) ? best : null;
}
