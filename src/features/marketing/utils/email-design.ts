import { escapeHtml, plainTextToHtml } from "@/features/marketing/utils/template";

/**
 * Curated email layouts. The author writes plain text; a design supplies the surrounding HTML and
 * inline CSS. That keeps the editor simple, guarantees valid email-client markup, and means no
 * author-supplied HTML is ever rendered.
 */
export const EMAIL_DESIGNS = ["plain", "classic", "minimal", "newsletter", "promo", "aurora", "spotlight", "neon", "glass", "confetti"] as const;
export type EmailDesign = (typeof EMAIL_DESIGNS)[number];

export const DEFAULT_EMAIL_DESIGN: EmailDesign = "plain";

export type EmailDesignOption = {
  id: EmailDesign;
  label: string;
  description: string;
  accent: string;
  /** Uses CSS motion in clients that support it. Every design has a clean static fallback. */
  motion?: boolean;
};

export const EMAIL_DESIGN_OPTIONS: EmailDesignOption[] = [
  { id: "plain", label: "Plain", description: "No wrapper. Just the text and an unsubscribe link.", accent: "#4b5563" },
  { id: "classic", label: "Classic", description: "Dark header with your company name and a gold rule.", accent: "#b98a3d" },
  { id: "minimal", label: "Minimal", description: "Quiet serif typography on a plain white card.", accent: "#111827" },
  { id: "newsletter", label: "Newsletter", description: "Green masthead and roomy body for monthly updates.", accent: "#0f5132" },
  { id: "promo", label: "Promo", description: "Bold offer header that puts the subject front and centre.", accent: "#c2410c" },
  { id: "aurora", label: "Aurora", description: "Shifting violet-to-pink gradient header with a soft shadow.", accent: "#7c3aed", motion: true },
  { id: "spotlight", label: "Spotlight", description: "Dark stage with a sweeping light beam behind the headline.", accent: "#38bdf8", motion: true },
  { id: "neon", label: "Neon", description: "Midnight card with a cyan glow that gently pulses.", accent: "#22d3ee", motion: true },
  { id: "glass", label: "Glass", description: "Frosted card floating over a cool blue gradient.", accent: "#0ea5e9", motion: true },
  { id: "confetti", label: "Confetti", description: "Warm celebration header with drifting colour pieces.", accent: "#f97316", motion: true },
];

export const EMAIL_DESIGN_LABELS: Record<EmailDesign, string> = Object.fromEntries(
  EMAIL_DESIGN_OPTIONS.map((option) => [option.id, option.label])
) as Record<EmailDesign, string>;

export function isEmailDesign(value: unknown): value is EmailDesign {
  return typeof value === "string" && (EMAIL_DESIGNS as readonly string[]).includes(value);
}

/** Legacy documents and older API clients do not carry a design. */
export function normalizeEmailDesign(value: unknown): EmailDesign {
  return isEmailDesign(value) ? value : DEFAULT_EMAIL_DESIGN;
}

export type EmailRenderInput = {
  design: EmailDesign;
  subject: string;
  /** Body text with template variables already replaced. It is escaped before it reaches HTML. */
  body: string;
  companyName: string;
  unsubscribeUrl: string;
  /** True when the author's body already places {{unsubscribe_url}}. */
  unsubscribeInBody: boolean;
};

/**
 * Renders the HTML part of one email. All text is escaped. For designed layouts a trailing
 * "Unsubscribe: …" line is folded into a styled footer so the link appears once.
 */
export function renderEmailHtml(input: EmailRenderInput): string {
  const design = normalizeEmailDesign(input.design);
  const company = input.companyName.trim() || "Our team";
  const url = escapeHtml(input.unsubscribeUrl);
  const hasLinkText = input.unsubscribeInBody;

  if (design === "plain") {
    const footer = hasLinkText ? "" : footerParagraph(url);
    return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#1f2933">${plainTextToHtml(input.body)}</div>${footer}`;
  }

  const body = hasLinkText ? stripTrailingUnsubscribe(input.body, input.unsubscribeUrl) : input.body;
  const subject = input.subject.trim();

  switch (design) {
    case "classic":
      return document(input.subject, "#eef1f0", `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef1f0">
          <tr><td class="anops-outer" align="center" style="padding:32px 12px">
            <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden;border-top:4px solid #b98a3d">
              <tr><td class="anops-hero" style="background:#111f1d;padding:26px 32px">
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#ffffff">${escapeHtml(company)}</p>
              </td></tr>
              <tr><td class="anops-body" style="padding:32px;font-family:Arial,Helvetica,sans-serif;color:#1f2933">
                ${paragraphs(body, "margin:0 0 16px;font-size:15px;line-height:1.65;color:#1f2933")}
              </td></tr>
              <tr><td class="anops-footer" style="padding:20px 32px 28px;border-top:1px solid #e5e7eb;font-family:Arial,Helvetica,sans-serif">
                ${footerText(company, url)}
              </td></tr>
            </table>
          </td></tr>
        </table>`);

    case "minimal":
      return document(input.subject, "#ffffff", `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff">
          <tr><td class="anops-outer" align="center" style="padding:40px 18px">
            <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px">
              <tr><td style="padding-bottom:18px;border-bottom:1px solid #e5e7eb;font-family:Arial,Helvetica,sans-serif">
                <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#6b7280">${escapeHtml(company)}</p>
              </td></tr>
              <tr><td class="anops-body" style="padding:30px 0 0;font-family:Georgia,'Times New Roman',serif;color:#111827">
                ${paragraphs(body, "margin:0 0 18px;font-size:16px;line-height:1.7;color:#111827")}
              </td></tr>
              <tr><td class="anops-footer" style="padding-top:24px;border-top:1px solid #e5e7eb;font-family:Arial,Helvetica,sans-serif">
                ${footerText(company, url)}
              </td></tr>
            </table>
          </td></tr>
        </table>`);

    case "newsletter":
      return document(input.subject, "#f2f7f4", `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f2f7f4">
          <tr><td class="anops-outer" align="center" style="padding:32px 12px">
            <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden">
              <tr><td class="anops-hero" style="background:#0f5132;padding:30px 32px">
                <p style="margin:0 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#a7d3b8">Monthly newsletter</p>
                <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:1.3;color:#ffffff">${escapeHtml(company)}</p>
              </td></tr>
              <tr><td style="height:4px;background:#d97706;font-size:0;line-height:0">&nbsp;</td></tr>
              <tr><td class="anops-body" style="padding:32px;font-family:Arial,Helvetica,sans-serif;color:#1f2933">
                ${paragraphs(body, "margin:0 0 16px;font-size:15px;line-height:1.7;color:#1f2933")}
              </td></tr>
              <tr><td class="anops-footer" style="background:#eef2f0;padding:20px 32px 28px;font-family:Arial,Helvetica,sans-serif">
                ${footerText(company, url)}
              </td></tr>
            </table>
          </td></tr>
        </table>`);

    case "promo":
      return document(input.subject || company, "#fff7ed", `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fff7ed">
          <tr><td class="anops-outer" align="center" style="padding:32px 12px">
            <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden">
              <tr><td class="anops-hero" style="background:#1c1917;padding:34px 32px">
                <p style="margin:0 0 10px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#fb923c">A message from ${escapeHtml(company)}</p>
                <h1 class="anops-title" style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:26px;line-height:1.25;color:#ffffff">${escapeHtml(subject || company)}</h1>
              </td></tr>
              <tr><td class="anops-body" style="padding:32px;font-family:Arial,Helvetica,sans-serif;color:#292524">
                ${paragraphs(body, "margin:0 0 16px;font-size:16px;line-height:1.7;color:#292524")}
              </td></tr>
              <tr><td class="anops-footer" style="padding:20px 32px 28px;border-top:1px solid #e7e5e4;font-family:Arial,Helvetica,sans-serif">
                ${footerText(company, url)}
              </td></tr>
            </table>
          </td></tr>
        </table>`);

    case "aurora":
      return document(input.subject || company, "#f5f3ff", `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f3ff">
          <tr><td class="anops-outer" align="center" style="padding:34px 12px">
            <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 18px 45px rgba(76,29,149,.18)">
              <tr><td class="anops-aurora anops-hero" style="background-color:#5b21b6;background-image:linear-gradient(120deg,#4c1d95,#7c3aed,#db2777);background-size:200% 200%;padding:38px 32px">
                <p style="margin:0 0 10px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#e9d5ff">News from ${escapeHtml(company)}</p>
                <h1 class="anops-title" style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:27px;line-height:1.25;color:#ffffff">${escapeHtml(subject || company)}</h1>
              </td></tr>
              <tr><td class="anops-body" style="padding:32px;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
                ${paragraphs(body, "margin:0 0 16px;font-size:16px;line-height:1.7;color:#1f2937")}
              </td></tr>
              <tr><td class="anops-footer" style="background:#faf5ff;padding:20px 32px 28px;font-family:Arial,Helvetica,sans-serif">
                ${footerText(company, url)}
              </td></tr>
            </table>
          </td></tr>
        </table>`, MOTION_STYLES);

    case "spotlight":
      return document(input.subject || company, "#020617", `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#020617">
          <tr><td class="anops-outer" align="center" style="padding:34px 12px">
            <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#0b1120;border:1px solid #1e293b;border-radius:14px;overflow:hidden">
              <tr><td class="anops-spotlight anops-hero" style="background-color:#0b1120;background-image:radial-gradient(circle at 50% 0%,rgba(56,189,248,.45),rgba(11,17,32,0) 58%);background-size:200% 200%;padding:46px 32px 38px;text-align:center">
                <p style="margin:0 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:#7dd3fc">${escapeHtml(company)}</p>
                <h1 class="anops-title" style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:29px;line-height:1.25;color:#f8fafc">${escapeHtml(subject || company)}</h1>
              </td></tr>
              <tr><td class="anops-body" style="padding:32px;font-family:Arial,Helvetica,sans-serif;color:#cbd5e1">
                ${paragraphs(body, "margin:0 0 16px;font-size:16px;line-height:1.7;color:#cbd5e1")}
              </td></tr>
              <tr><td class="anops-footer" style="padding:20px 32px 28px;border-top:1px solid #1e293b;font-family:Arial,Helvetica,sans-serif">
                ${footerText(company, url)}
              </td></tr>
            </table>
          </td></tr>
        </table>`, MOTION_STYLES);

    case "neon":
      return document(input.subject || company, "#020617", `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#020617">
          <tr><td class="anops-outer" align="center" style="padding:34px 12px">
            <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="anops-neon" style="width:100%;max-width:600px;background:#08111f;border:1px solid #164e63;border-radius:14px;overflow:hidden;box-shadow:0 0 24px rgba(34,211,238,.28)">
              <tr><td class="anops-hero" style="background:#08111f;padding:34px 32px">
                <p style="margin:0 0 10px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:#22d3ee">Live update</p>
                <p style="margin:0 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#e2e8f0">${escapeHtml(company)}</p>
                <h1 class="anops-title" style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:26px;line-height:1.3;color:#67e8f9">${escapeHtml(subject || company)}</h1>
              </td></tr>
              <tr><td class="anops-body" style="padding:30px 32px;font-family:Arial,Helvetica,sans-serif;color:#cbd5e1">
                ${paragraphs(body, "margin:0 0 16px;font-size:16px;line-height:1.7;color:#cbd5e1")}
              </td></tr>
              <tr><td class="anops-footer" style="padding:20px 32px 28px;border-top:1px solid #164e63;font-family:Arial,Helvetica,sans-serif">
                ${footerText(company, url)}
              </td></tr>
            </table>
          </td></tr>
        </table>`, MOTION_STYLES);

    case "glass":
      return document(input.subject || company, "#e0f2fe", `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#e0f2fe;background-image:linear-gradient(160deg,#e0f2fe,#bae6fd 48%,#ede9fe)">
          <tr><td class="anops-outer" align="center" style="padding:38px 12px">
            <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="anops-float" style="width:100%;max-width:600px;background-color:#ffffff;background-image:linear-gradient(145deg,#ffffff,#f0f9ff);border:1px solid #ffffff;border-radius:18px;overflow:hidden;box-shadow:0 26px 60px rgba(15,23,42,.18)">
              <tr><td class="anops-hero" style="padding:34px 32px 24px;border-bottom:1px solid #e0f2fe">
                <p style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#0284c7">${escapeHtml(company)}</p>
                <h1 class="anops-title" style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:26px;line-height:1.3;color:#0f172a">${escapeHtml(subject || company)}</h1>
              </td></tr>
              <tr><td class="anops-body" style="padding:30px 32px;font-family:Arial,Helvetica,sans-serif;color:#1e293b">
                ${paragraphs(body, "margin:0 0 16px;font-size:16px;line-height:1.7;color:#1e293b")}
              </td></tr>
              <tr><td class="anops-footer" style="padding:20px 32px 28px;border-top:1px solid #e0f2fe;font-family:Arial,Helvetica,sans-serif">
                ${footerText(company, url)}
              </td></tr>
            </table>
          </td></tr>
        </table>`, MOTION_STYLES);

    case "confetti":
      return document(input.subject || company, "#fff7ed", `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fff7ed">
          <tr><td class="anops-outer" align="center" style="padding:34px 12px">
            <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 16px 40px rgba(194,65,12,.14)">
              <tr><td class="anops-hero" style="background:#fff7ed;padding:30px 32px 28px;text-align:center">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 16px"><tr>
                  ${confettiPieces()}
                </tr></table>
                <p style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#ea580c">You are invited</p>
                <h1 class="anops-title" style="margin:0 0 8px;font-family:Georgia,'Times New Roman',serif;font-size:28px;line-height:1.25;color:#431407">${escapeHtml(subject || company)}</h1>
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#9a3412">${escapeHtml(company)}</p>
              </td></tr>
              <tr><td class="anops-body" style="padding:30px 32px;font-family:Arial,Helvetica,sans-serif;color:#292524">
                ${paragraphs(body, "margin:0 0 16px;font-size:16px;line-height:1.7;color:#292524")}
              </td></tr>
              <tr><td class="anops-footer" style="background:#fff7ed;padding:20px 32px 28px;font-family:Arial,Helvetica,sans-serif">
                ${footerText(company, url)}
              </td></tr>
            </table>
          </td></tr>
        </table>`, MOTION_STYLES);
  }
}

function confettiPieces(): string {
  const colors = ["#f97316", "#facc15", "#22c55e", "#0ea5e9", "#a855f7", "#ef4444", "#14b8a6", "#f59e0b"];
  return colors
    .map(
      (color, index) =>
        `<td style="padding:0 4px"><span class="anops-confetti" style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${color};font-size:0;line-height:0;animation-delay:-${(index * 0.55).toFixed(2)}s">&nbsp;</span></td>`
    )
    .join("");
}

/**
 * Narrow-screen overrides. These live in a `<style>` block because media queries cannot be inline.
 * Clients that strip the block keep the desktop padding, which still fits a 320 px screen.
 */
const BASE_STYLES = `<style>
@media (max-width: 480px) {
  .anops-outer { padding: 18px 8px !important; }
  .anops-hero { padding: 26px 22px !important; }
  .anops-body { padding: 24px 22px !important; }
  .anops-footer { padding: 18px 22px 22px !important; }
  .anops-title { font-size: 23px !important; line-height: 1.3 !important; }
}
</style>`;

/**
 * Motion is progressive enhancement. Clients that strip `<style>` (Gmail, most Outlook versions) show the
 * inline static colours and shadows; Apple Mail and iOS render the animation. Reduced-motion users get
 * the static version everywhere.
 */
const MOTION_STYLES = `<style>
@keyframes anopsAuroraShift { 0%, 100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }
@keyframes anopsSpotlightSweep { 0%, 100% { background-position: 50% -40%; } 50% { background-position: 50% 140%; } }
@keyframes anopsNeonPulse { 0%, 100% { box-shadow: 0 0 0 1px #164e63, 0 0 22px rgba(34,211,238,.25); } 50% { box-shadow: 0 0 0 1px #22d3ee, 0 0 46px rgba(34,211,238,.55); } }
@keyframes anopsFloat { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-7px); } }
@keyframes anopsConfetti { 0%, 100% { transform: translateY(-5px) rotate(0deg); } 50% { transform: translateY(5px) rotate(22deg); } }
.anops-aurora { animation: anopsAuroraShift 14s ease-in-out infinite; }
.anops-spotlight { animation: anopsSpotlightSweep 11s ease-in-out infinite; }
.anops-neon { animation: anopsNeonPulse 4.5s ease-in-out infinite; }
.anops-float { animation: anopsFloat 6s ease-in-out infinite; }
.anops-confetti { animation: anopsConfetti 4.5s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .anops-aurora, .anops-spotlight, .anops-neon, .anops-float, .anops-confetti { animation: none !important; }
}
</style>`;

function document(title: string, background: string, content: string, styles = ""): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light only" />
<title>${escapeHtml(title)}</title>
${BASE_STYLES}
${styles}
</head>
<body style="margin:0;padding:0;background:${background}">
${content}
</body>
</html>`;
}

/** Each blank line starts a paragraph; single line breaks are preserved inside it. */
function paragraphs(body: string, style: string): string {
  return body
    .replace(/\r\n/g, "\n")
    .trim()
    .split(/\n{2,}/)
    .filter((block) => block.trim() !== "")
    .map((block) => `<p style="${style}">${escapeHtml(block).replace(/\n/g, "<br />")}</p>`)
    .join("");
}

function footerText(company: string, escapedUrl: string): string {
  return `<p style="margin:0;font-size:12px;line-height:1.6;color:#6b7280">You are receiving this email because you subscribed to updates from ${escapeHtml(company)}. <a href="${escapedUrl}" style="color:#6b7280;text-decoration:underline">Unsubscribe</a></p>`;
}

function footerParagraph(escapedUrl: string): string {
  return `<p style="margin-top:24px;font-size:12px;color:#666">Unsubscribe: <a href="${escapedUrl}">${escapedUrl}</a></p>`;
}

/**
 * Removes a closing "Unsubscribe: <url>" line so the designed layout can render its own footer.
 * Anything else in the body is left untouched.
 */
function stripTrailingUnsubscribe(body: string, unsubscribeUrl: string): string {
  const lines = body.replace(/\r\n/g, "\n").trimEnd().split("\n");
  let last = lines.length - 1;
  while (last >= 0 && lines[last].trim() === "") last -= 1;
  if (last < 0) return "";
  const candidate = lines[last].trim();
  if (/^unsubscribe\s*:/i.test(candidate) && candidate.includes(unsubscribeUrl)) {
    return lines.slice(0, last).join("\n").trimEnd();
  }
  return body;
}
