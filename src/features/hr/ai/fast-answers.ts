import type { ChatLanguage } from "@/features/hr/ai/guardrails";

/**
 * Questions answered from a tool result with no LLM call: instant, correct by construction, and they still
 * work when every provider is rate limited. Anything longer or less direct goes to the model.
 */

const MAX_FAST_MESSAGE_LENGTH = 90;
/** Wording that asks for an explanation or something more specific than the plain data. */
const NEEDS_MODEL = /explain|why|calcul|policy|pourquoi|comment|politique|اشرح|لماذا|kifech|\band\b|\bet\b/i;

type Data = Record<string, unknown>;
type Render = (data: Data, lang: ChatLanguage) => string;

export type FastIntent = {
  tool: string;
  pattern: RegExp;
  render: Render;
};

function pick(lang: ChatLanguage, text: Record<ChatLanguage, string>): string {
  return text[lang];
}

function names(rows: unknown, none: string): string {
  const list = (rows ?? []) as Array<{ name: string; department: string }>;
  return list.length ? list.map((r) => `- ${r.name} (${r.department})`).join("\n") : `- ${none}`;
}

const renderBalance: Render = (d, lang) => {
  const figures = { a: d.available, e: d.earned, t: d.taken, r: d.reserved };
  return pick(lang, {
    en: `You have **${figures.a} days** available (Solde de congé): ${figures.e} earned, ${figures.t} taken, ${figures.r} reserved.`,
    fr: `Il vous reste **${figures.a} jours** (Solde de congé) : ${figures.e} acquis, ${figures.t} pris, ${figures.r} réservés.`,
    ar: `لديك **${figures.a} أيام** متاحة (Solde de congé): ${figures.e} مكتسبة، ${figures.t} مأخوذة، ${figures.r} محجوزة.`,
    derja: `3andek **${figures.a} jours** disponibles (Solde de congé): ${figures.e} acquis, ${figures.t} pris, ${figures.r} réservés.`,
  });
};

const renderMyRequests: Render = (d, lang) => {
  const requests = (d.requests ?? []) as Array<{ leaveType: string; startDate: string; endDate: string; days: number; status: string }>;
  if (requests.length === 0) {
    return pick(lang, {
      en: "You have no leave requests.",
      fr: "Vous n'avez aucune demande de congé.",
      ar: "ليس لديك أي طلبات إجازة.",
      derja: "Ma3andekch 7ata demande de congé.",
    });
  }
  return requests.map((r) => `- ${r.leaveType}: ${r.startDate} → ${r.endDate} (${r.days}d), **${r.status}**`).join("\n");
};

const renderAbsent: Render = (d, lang) => {
  const french = lang === "fr";
  const onLeave = d.onApprovedLeave;
  const noCheckIn = d.noCheckIn;
  const notWorking = d.isWorkingDay ? "" : french ? "\n\nAujourd'hui n'est pas un jour ouvré." : "\n\nToday is not a working day.";
  return french
    ? `**En congé approuvé :**\n${names(onLeave, "Personne")}\n\n**Sans pointage :**\n${names(noCheckIn, "Personne")}${notWorking}`
    : `**On approved leave:**\n${names(onLeave, "Nobody")}\n\n**No check-in yet:**\n${names(noCheckIn, "Nobody")}${notWorking}`;
};

const renderPending: Render = (d, lang) => {
  const requests = (d.requests ?? []) as Array<{ employeeName: string; department: string; startDate: string; endDate: string; days: number }>;
  if (requests.length === 0) return lang === "fr" ? "Aucune demande en attente." : "No pending leave requests.";
  const heading = lang === "fr" ? `**${d.total} demande(s) en attente :**` : `**${d.total} pending request(s):**`;
  const rows = requests.map((r) => `- ${r.employeeName} (${r.department}): ${r.startDate} → ${r.endDate}, ${r.days}d`);
  return [heading, ...rows].join("\n");
};

const renderPayroll: Render = (d, lang) => {
  const deductions = (d.withDeductions ?? []) as Array<{ name: string; unpaidLeaveDays: number; deduction: number }>;
  const rows = deductions.map((p) => `- ${p.name}: ${p.unpaidLeaveDays}d, -${p.deduction} TND`);
  const french = lang === "fr";
  return [
    french
      ? `**Aperçu de paie ${d.period}** (rien n'est enregistré), ${d.employeeCount} employés :`
      : `**Payroll preview ${d.period}** (nothing saved), ${d.employeeCount} employees:`,
    `- ${french ? "Brut" : "Gross"}: ${d.totalGross} TND`,
    `- ${french ? "Déductions" : "Deductions"}: ${d.totalDeductions} TND`,
    `- Net: ${d.totalNet} TND`,
    ...(rows.length ? [french ? "\n**Déductions congé sans solde :**" : "\n**Unpaid leave deductions:**", ...rows] : []),
  ].join("\n");
};

/**
 * Deliberately narrow. A fast answer ignores everything but the intent, so these only match first-person or
 * whole-company questions with no person, department, date or status in them. Anything else goes to the model.
 */
const INTENTS: FastIntent[] = [
  {
    tool: "get_my_leave_balance",
    pattern: /^(how many (leave |vacation )?days (do i have|have i got)( left| remaining)?|what( is|'s) my (leave )?balance|my (leave )?balance|show my (leave )?balance)\s*\??$|^combien de jours( de cong[ée]s?)? (me reste-t-il|il me reste|ai-je)\s*\??$|^(quel est )?mon solde( de cong[ée]s?)?\s*\??$|b9ali\s*\??$|^كم (يوم|أيام|ايام)( إجازة| اجازة)? (تبقى|بقي|بقى|لدي) ?(لي)?\s*[؟?]?$|^(ما هو )?رصيدي( من الإجازات)?\s*[؟?]?$/i,
    render: renderBalance,
  },
  {
    tool: "get_my_leave_requests",
    pattern: /^((show|list|see|view)( me)? )?my (leave )?requests\s*\??$|^(voir )?mes demandes( de cong[ée]s?)?\s*\??$/i,
    render: renderMyRequests,
  },
  {
    tool: "get_absent_today",
    pattern: /^who('s| is) (absent|off|out)( today)?\s*\??$|^qui est absent( aujourd'hui)?\s*\??$/i,
    render: renderAbsent,
  },
  {
    tool: "get_pending_requests",
    pattern: /^((show|list|see|view)( me)?( the| all)? )?pending (leave )?requests\s*\??$|^(voir )?(les )?demandes en attente\s*\??$/i,
    render: renderPending,
  },
  {
    tool: "generate_payroll_preview",
    pattern: /^(preview|show)( the)? payroll( preview)?( for)?( this month)?\s*\??$|^aper[çc]u de (la )?paie( de ce mois)?\s*\??$/i,
    render: renderPayroll,
  },
];

/** The fast intent for a message, if it is a short and direct question. */
export function matchFastIntent(message: string): FastIntent | null {
  const text = message.trim();
  if (text.length > MAX_FAST_MESSAGE_LENGTH || NEEDS_MODEL.test(text)) return null;
  return INTENTS.find((intent) => intent.pattern.test(text)) ?? null;
}

const DIRECT_CANCEL = /^((please|can you|could you) )?cancel my( pending| approved)?( leave)?( request)?( please)?\s*[.?!]*$|^(veuillez |je veux )?annuler? ma demande( de cong[ée]s?)?\s*[.?!]*$/i;

/** "Cancel my leave request", with no date or other detail. The caller's open requests settle what it means. */
export function isDirectCancelRequest(message: string): boolean {
  return DIRECT_CANCEL.test(message.trim());
}

const PERSONAL_LEAVE_ACTION = /^((please|can you|could you) )?(book|reserve|cancel)\b.*\b(my|me|i)\b|^((please|can you|could you) )?book\b|^i (want|need)\b.*\b(leave|days?|off)\b|^je veux\b.*\b(jours?|cong[ée]s?)\b|^n[h7]eb\b/i;

/** Asks about the caller's own leave or pay, which needs an employee record to answer. */
export function isPersonalRequest(message: string): boolean {
  const text = message.trim();
  return isDirectCancelRequest(text) || PERSONAL_LEAVE_ACTION.test(text) || Boolean(matchFastIntent(text)?.tool.startsWith("get_my_"));
}

export function noEmployeeProfile(lang: ChatLanguage): string {
  return pick(lang, {
    en: "Your account has no employee profile in this company, so you have no leave of your own here. Add yourself in the Employees tab with this account's email, or log in with an employee account. To handle other people's requests, use the Time-Off & Leave tab.",
    fr: "Votre compte n'a pas de fiche employé dans cette entreprise, vous n'avez donc pas de congés ici. Ajoutez-vous dans l'onglet Employees avec l'e-mail de ce compte, ou connectez-vous avec un compte employé. Pour traiter les demandes des autres, utilisez l'onglet Time-Off & Leave.",
    ar: "لا يوجد لحسابك ملف موظف في هذه الشركة، لذلك ليس لديك إجازات هنا. أضف نفسك في تبويب Employees ببريد هذا الحساب، أو سجّل الدخول بحساب موظف. لمعالجة طلبات الآخرين، استخدم تبويب Time-Off & Leave.",
    derja: "Compte mte3ek ma3andouch fiche employé fi hedhi la société, donc ma3andekch congés houni. Zid rou7ek fi Employees b nafs l'email, walla odkhel b compte employé. Les demandes mta3 l'o5rin fi Time-Off & Leave.",
  });
}

export function noOpenRequests(lang: ChatLanguage): string {
  return pick(lang, {
    en: "You have no upcoming leave request that can be cancelled.",
    fr: "Vous n'avez aucune demande à venir pouvant être annulée.",
    ar: "ليس لديك أي طلب إجازة قادم يمكن إلغاؤه.",
    derja: "Ma3andekch 7ata demande jaya tnajem tetlgha.",
  });
}

export function whichRequest(
  lang: ChatLanguage,
  requests: Array<{ leaveType: string; startDate: string; endDate: string; status: string }>
): string {
  const question = pick(lang, {
    en: "You have several open requests. Which one should I cancel?",
    fr: "Vous avez plusieurs demandes en cours. Laquelle dois-je annuler ?",
    ar: "لديك عدة طلبات مفتوحة. أيها تريد إلغاءه؟",
    derja: "3andek barcha demandes. Ama wa7da n7eb nlghi?",
  });
  const rows = requests.map((r) => `- ${r.leaveType}: ${r.startDate} → ${r.endDate}, **${r.status}**`);
  return [question, ...rows].join("\n");
}

export function confirmPrompt(lang: ChatLanguage): string {
  return pick(lang, {
    en: "Please review the card and click Confirm. Nothing is submitted until you do.",
    fr: "Vérifiez la carte puis cliquez sur Confirm. Rien n'est envoyé avant cela.",
    ar: "يرجى مراجعة البطاقة والنقر على Confirm. لن يتم إرسال أي شيء قبل ذلك.",
    derja: "Chouf el carte w 9les 3la Confirm. 7ata chay ma yetb3ath 9bal.",
  });
}

export function draftFailed(lang: ChatLanguage, errors: string[]): string {
  const prefix = pick(lang, {
    en: "I couldn't prepare this:",
    fr: "Je n'ai pas pu préparer cette demande :",
    ar: "تعذر إعداد هذا الطلب:",
    derja: "Ma najemtech nhadhar el demande:",
  });
  return `${prefix} ${errors.join(" ")}`;
}
