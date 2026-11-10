/**
 * Deterministic guardrails for the HR Copilot. No LLM is involved, so they cannot be talked out of a decision.
 * Permissions do not depend on this file: tools are scoped by role, so a missed pattern still exposes nothing.
 * These checks add a clear refusal and an audit entry.
 */

const INJECTION_PATTERNS: RegExp[] = [
  /\b(ignore|disregard|forget|override|bypass)\b.{0,40}\b(instruction|instructions|rules?|prompt|polic(y|ies)|guardrails?)\b/i,
  /\byou are now\b|\bact as (an? )?(admin|administrator|root|system|developer|hr admin)\b|\bpretend (to be|you are)\b/i,
  /\b(reveal|show|print|repeat|leak|give me|what is)\b.{0,30}\b(system prompt|your prompt|your instructions|tool schemas?|api keys?)\b/i,
  /\bsystem prompt\b|\bdeveloper mode\b|\bjailbreak\b/i,
  /\b(ignore|oublie|oubliez|ignorez?)\b.{0,40}\b(instructions?|règles?|consignes?)\b/i,
  /\b(montre|affiche|révèle|donne)[- ]?(moi)?\b.{0,30}\b(prompt|instructions? système|clés? api)\b/i,
  /\b(tu es|vous êtes) (maintenant|désormais)\b/i,
  /(تجاهل|انس|تخطى).{0,40}(التعليمات|القواعد|الأوامر)/,
  /(اكشف|أظهر|اعرض|اطبع).{0,30}(التعليمات|موجه النظام|مفاتيح)/,
  /(أنت|انت) الآن/,
];

export function detectPromptInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((pattern) => pattern.test(text));
}

const SENSITIVE_TERMS =
  /salar|salair|pay\s?slip|fiche de paie|paie|balance|solde|leave|cong[ée]|absen|attendance|pr[ée]sence|راتب|رصيد|إجاز|اجاز|غياب|flous|chhar/i;
const EVERYONE_SALARIES =
  /\b(everyone|everybody|all (the )?(employees|staff)|tout le monde|tous les (employés|salariés)|les salaires)\b.{0,40}(salar|salair|pay)|(salar|salair)\w*\b.{0,40}\b(everyone|everybody|all (the )?(employees|staff)|tout le monde|tous les (employés|salariés))\b|(رواتب|مرتبات).{0,20}(الجميع|كل|الموظفين)/i;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when a non-admin asks for personal HR data about someone else, or about everyone. */
export function asksAboutOtherEmployee(text: string, otherEmployeeNames: string[]): boolean {
  if (EVERYONE_SALARIES.test(text)) return true;
  if (!SENSITIVE_TERMS.test(text)) return false;
  return otherEmployeeNames.some((fullName) =>
    fullName
      .split(/\s+/)
      .filter((part) => part.length >= 3)
      .some((part) => new RegExp(`(^|[^\\p{L}])${escapeRegex(part)}([^\\p{L}]|$)`, "iu").test(text))
  );
}

export type ChatLanguage = "en" | "fr" | "ar" | "derja";

const FRENCH_HINT = /\b(je|mon|ma|mes|le|la|les|des|tes|combien|jours?|cong[ée]s?|quel|quelle|pourquoi|salaire|ignorez|ignorer|montre|donne)\b/i;
const DERJA_LATIN_HINT = /\b(nheb|n7eb|9adeh|9adech|chnoua|chnowa|3andi|3andek|ya3tik|mte3|barcha|lyoum|ghodwa|ta3ti|wa9tech|kifech)\b/i;

/** Best-effort language of a message. Used only for deterministic refusals; the model mirrors the language itself. */
export function detectChatLanguage(text: string): ChatLanguage {
  if (/\p{Script=Arabic}/u.test(text)) return "ar";
  if (DERJA_LATIN_HINT.test(text)) return "derja";
  if (FRENCH_HINT.test(text)) return "fr";
  return "en";
}

const REFUSALS: Record<"injection" | "other_employee", Record<ChatLanguage, string>> = {
  injection: {
    en: "I can't do that. I follow fixed security rules and can only help with your own HR questions. Please contact HR if you need something else.",
    fr: "Je ne peux pas faire cela. Je suis des règles de sécurité fixes et je ne peux répondre qu'à vos propres questions RH. Contactez les RH pour toute autre demande.",
    ar: "لا يمكنني القيام بذلك. أتبع قواعد أمان ثابتة ويمكنني فقط المساعدة في أسئلتك الخاصة بالموارد البشرية. يرجى التواصل مع قسم الموارد البشرية لأي طلب آخر.",
    derja: "Ma najemch na3mel hedhi. N5allem b rules ta3 sécurité thabta w najem n3awnek ken fi les questions RH mte3ek. Ken t7eb 7aja o5ra, 7ki m3a les RH.",
  },
  other_employee: {
    en: "Access denied: you can only view your own HR records. Please contact an HR administrator if you need help with someone else's.",
    fr: "Accès refusé : vous ne pouvez consulter que vos propres données RH. Contactez un administrateur RH pour toute question concernant un autre employé.",
    ar: "تم رفض الوصول: يمكنك فقط الاطلاع على بياناتك الخاصة. يرجى التواصل مع مسؤول الموارد البشرية بخصوص أي موظف آخر.",
    derja: "Ma3andekch l7a9: tnajem tchouf ken les données mte3ek. Ken 7achtek b 7aja 3la employé ekher, 7ki m3a admin RH.",
  },
};

export function refusalMessage(kind: "injection" | "other_employee", text: string): string {
  return REFUSALS[kind][detectChatLanguage(text)];
}

/** Marks the system prompt so a leak can be detected in the model's output. */
export const PROMPT_CANARY = "ANOPS-HR-COPILOT-INSTRUCTIONS";

const SECRET_PATTERNS = /\b(gsk_[A-Za-z0-9]{8,}|sk-or-[A-Za-z0-9-]{8,}|AIza[A-Za-z0-9_-]{8,})\b/g;

/** Screens model output. Returns the text to show, and whether a leak of the prompt was caught. */
export function screenOutput(text: string): { text: string; leaked: boolean } {
  if (text.includes(PROMPT_CANARY)) return { text: "", leaked: true };
  return { text: text.replace(SECRET_PATTERNS, "[redacted]"), leaked: false };
}
