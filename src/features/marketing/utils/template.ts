/**
 * Template variables form an explicit allowlist. Templates are plain text: nothing is evaluated and
 * no HTML from the author is rendered. Email output is escaped before it reaches an HTML part.
 */
export const TEMPLATE_VARIABLES = [
  "first_name",
  "last_name",
  "email",
  "company_name",
  "unsubscribe_url",
] as const;

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

export const EMAIL_SUBJECT_MAX = 150;
export const EMAIL_BODY_MAX = 10_000;
export const SMS_BODY_MAX = 480;
/** Telegram's hard limit for one text message is 4096 characters. */
export const TELEGRAM_MESSAGE_MAX = 4096;
/** Opt-out wording appended to every Telegram campaign message. */
export const TELEGRAM_OPT_OUT_FOOTER = "Send /stop to stop receiving marketing messages.";
/** Authors get the limit minus the footer and its separating blank line, so the rendered message always fits. */
export const TELEGRAM_BODY_MAX = TELEGRAM_MESSAGE_MAX - TELEGRAM_OPT_OUT_FOOTER.length - 2;
/** Variables that make sense in a chat message. There is no unsubscribe link: the opt-out is /stop. */
export const TELEGRAM_VARIABLES = ["first_name", "last_name", "company_name"] as const;

/** Any {{…}} is a token. Anything not on the allowlist is rejected by validation, never sent literally. */
const TOKEN = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** Returns every {{token}} name in the text, in order of appearance. */
export function extractTemplateTokens(text: string): string[] {
  return Array.from(text.matchAll(TOKEN), (match) => match[1]);
}

/** Returns the tokens that are not in the allowlist. An empty result means the text is valid. */
export function findUnknownTemplateVariables(text: string): string[] {
  const allowed = new Set<string>(TEMPLATE_VARIABLES);
  return extractTemplateTokens(text).filter((name) => !allowed.has(name));
}

/**
 * Replaces allowlisted tokens with values. Values are inserted as-is: callers render HTML by escaping
 * the result, and SMS by using it directly. Unknown tokens render as an empty string.
 */
export function renderTemplate(text: string, values: Record<TemplateVariable, string>): string {
  return text.replace(TOKEN, (_match, name: string) => {
    return (TEMPLATE_VARIABLES as readonly string[]).includes(name)
      ? values[name as TemplateVariable]
      : "";
  });
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Plain text rendered as HTML: every character escaped, line breaks preserved. */
export function plainTextToHtml(text: string): string {
  return escapeHtml(text).replace(/\r?\n/g, "<br />");
}

/**
 * SMS segment count. GSM-7 text fits 160 characters per segment (153 when concatenated), UCS-2 text
 * fits 70 (67 when concatenated). Approximated by checking for non-ASCII characters.
 */
export function smsSegmentCount(text: string): number {
  if (text.length === 0) return 0;
  const gsmSafe = /^[\x00-\x7F]*$/.test(text);
  const single = gsmSafe ? 160 : 70;
  const concatenated = gsmSafe ? 153 : 67;
  return text.length <= single ? 1 : Math.ceil(text.length / concatenated);
}

/** Opt-out wording appended to every SMS campaign. */
export const SMS_OPT_OUT_FOOTER = "Reply STOP to opt out.";
