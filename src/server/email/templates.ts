import { env, getAppUrl } from "@/config/env";

const COLORS = {
  canvas: "#f7f7f2",
  surface: "#ffffff",
  border: "#d8ddd5",
  ink: "#111f1d",
  secondary: "#59645f",
  citron: "#c8f03e",
  tint: "#f5fbe0",
  tintBorder: "#dcebaa",
};

type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
};

/** Embedded by the mail transport (see sendSmtpMessage), so the logo shows in every client, locally and in production. */
export const LOGO_CID = "anops-logo";

type Note = { title: string; text: string };

function layout(heading: string, body: string, ctaLabel: string, ctaUrl: string, note?: Note, preheader?: string): string {
  const logoSrc = env.EMAIL_LOGO_URL ?? `cid:${LOGO_CID}`;
  const logoMarkup = `<img src="${escapeHtml(logoSrc)}" alt="AnOps" width="132" height="40" style="display:block;margin:0 auto;width:132px;height:auto;max-width:100%;border:0;outline:none;text-decoration:none;" />`;
  const noteMarkup = note
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 0 0;">
                  <tr>
                    <td style="background:${COLORS.tint};border:1px solid ${COLORS.tintBorder};border-radius:12px;padding:14px 16px;">
                      <p style="margin:0;font-size:13px;line-height:18px;font-weight:700;color:${COLORS.ink};">${escapeHtml(note.title)}</p>
                      <p style="margin:4px 0 0 0;font-size:13px;line-height:19px;color:${COLORS.secondary};">${escapeHtml(note.text)}</p>
                    </td>
                  </tr>
                </table>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light" />
    <meta name="supported-color-schemes" content="light" />
    <title>${escapeHtml(heading)}</title>
  </head>
  <body style="margin:0;padding:0;background:${COLORS.canvas};font-family:Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;color:${COLORS.ink};-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader ?? heading)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" align="center" style="background:${COLORS.canvas};">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" align="center" style="max-width:560px;margin:0 auto;">
            <tr>
              <td align="center" style="padding:0 0 28px 0;text-align:center;">
                ${logoMarkup}
              </td>
            </tr>
            <tr>
              <td align="left" style="background:${COLORS.surface};border:1px solid ${COLORS.border};border-radius:20px;overflow:hidden;text-align:left;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr><td style="height:6px;line-height:6px;font-size:6px;background:${COLORS.citron};">&nbsp;</td></tr>
                  <tr>
                    <td style="padding:36px 36px 40px 36px;" class="card-pad">
                      <h1 style="margin:0 0 20px 0;font-family:Manrope, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;font-size:26px;line-height:32px;font-weight:800;letter-spacing:-0.03em;color:${COLORS.ink};text-align:left;">${escapeHtml(heading)}</h1>
                      <div style="font-size:15px;line-height:24px;color:${COLORS.ink};text-align:left;">${body}</div>
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0 0 0;">
                        <tr>
                          <td align="center" style="border-radius:12px;background:${COLORS.citron};">
                            <a href="${ctaUrl}" style="display:block;padding:16px 24px;font-size:16px;line-height:22px;font-weight:800;color:${COLORS.ink};text-decoration:none;text-align:center;border-radius:12px;">${escapeHtml(ctaLabel)}</a>
                          </td>
                        </tr>
                      </table>
                      ${noteMarkup}
                      <p style="margin:28px 0 0 0;padding-top:20px;border-top:1px solid ${COLORS.border};font-size:12px;line-height:19px;color:${COLORS.secondary};word-break:break-all;text-align:left;">
                        Button not working? Copy this link into your browser:<br />
                        <a href="${ctaUrl}" style="color:${COLORS.ink};text-decoration:underline;">${ctaUrl}</a>
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:24px 8px 0 8px;font-size:12px;line-height:19px;color:${COLORS.secondary};text-align:center;">
                You received this email because of activity on your AnOps account.<br />
                &copy; ${new Date().getFullYear()} AnOps &middot; One platform. Every operation.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function verificationEmail(name: string, token: string): RenderedEmail {
  const url = `${getAppUrl()}/verify?token=${encodeURIComponent(token)}`;
  const heading = "Verify your email";
  const body = `<p style="margin:0;">Hi ${escapeHtml(name)},</p>
    <p style="margin:12px 0 0 0;">Confirm your email address to activate your AnOps account. This link expires in 24 hours.</p>
    <p style="margin:12px 0 0 0;">If you didn&apos;t create an AnOps account, you can safely ignore this email.</p>`;

  return {
    subject: "Verify your email for AnOps",
    html: layout(heading, body, "Verify email", url, { title: "This link expires in 24 hours", text: "After that, request a new verification email from the sign-in page." }, "Confirm your email address to activate your AnOps account."),
    text: `Hi ${name},\n\nConfirm your email address to activate your AnOps account (expires in 24 hours):\n${url}\n\nIf you didn't create an AnOps account, you can safely ignore this email.\n`,
  };
}

export function passwordResetEmail(name: string, token: string): RenderedEmail {
  const url = `${getAppUrl()}/reset-password?token=${encodeURIComponent(token)}`;
  const heading = "Reset your password";
  const body = `<p style="margin:0;">Hi ${escapeHtml(name)},</p>
    <p style="margin:12px 0 0 0;">We received a request to reset the password for your AnOps account. This link expires in 1 hour.</p>
    <p style="margin:12px 0 0 0;">If you didn&apos;t request a password reset, you can safely ignore this email.</p>`;

  return {
    subject: "Reset your AnOps password",
    html: layout(heading, body, "Reset password", url, { title: "This link expires in 1 hour", text: "If it expires, you can request another reset link at any time." }, "Choose a new password for your AnOps account."),
    text: `Hi ${name},\n\nReset your AnOps password (expires in 1 hour):\n${url}\n\nIf you didn't request a password reset, you can safely ignore this email.\n`,
  };
}

export function organizationActivationEmail(name: string, organizationName: string, token: string, hours: number): RenderedEmail {
  const url = `${getAppUrl()}/activate?token=${encodeURIComponent(token)}`;
  const heading = "Activate your organization";
  const body = `<p style="margin:0;">Hi ${escapeHtml(name)},</p>
    <p style="margin:12px 0 0 0;">Your AnOps workspace for <strong>${escapeHtml(organizationName)}</strong> is ready. Confirm this email address to activate it.</p>
    <p style="margin:12px 0 0 0;">If you didn&apos;t create this organization, you can safely ignore this email.</p>`;
  return {
    subject: `Activate ${organizationName} on AnOps`,
    html: layout(heading, body, "Activate organization", url, { title: `Reserved for ${hours} hours`, text: "Your organization and its data are kept for you during this time. If it is not activated, it is removed automatically." }, `Confirm your email to activate ${organizationName} on AnOps.`),
    text: `Hi ${name},\n\nActivate your AnOps organization "${organizationName}" within ${hours} hours:\n${url}\n\nIf it is not activated in time, it is removed automatically. If you didn't create this organization, ignore this email.\n`,
  };
}

export function invitationEmail(input: { inviterName: string; organizationName: string; roleLabel: string; token: string; days: number }): RenderedEmail {
  const url = `${getAppUrl()}/invite?token=${encodeURIComponent(input.token)}`;
  const heading = `Join ${input.organizationName} on AnOps`;
  const body = `<p style="margin:0;">${escapeHtml(input.inviterName)} invited you to join <strong>${escapeHtml(input.organizationName)}</strong> on AnOps as <strong>${escapeHtml(input.roleLabel)}</strong>.</p>
    <p style="margin:12px 0 0 0;">This invitation can be used once and expires in ${input.days} days.</p>
    <p style="margin:12px 0 0 0;">If you weren&apos;t expecting it, you can safely ignore this email.</p>`;
  return {
    subject: `${input.inviterName} invited you to ${input.organizationName} on AnOps`,
    html: layout(heading, body, "Accept invitation", url, { title: `Single use, expires in ${input.days} days`, text: "Open the link on the device you want to use AnOps with." }, `${input.inviterName} invited you to ${input.organizationName}.`),
    text: `${input.inviterName} invited you to join ${input.organizationName} on AnOps as ${input.roleLabel}.\n\nAccept (single use, expires in ${input.days} days):\n${url}\n`,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
