import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { env, getAppUrl, isEmailConfigured, isLocalOnlyUrl } from "@/config/env";

const LOGO_CID = "anops-logo";
const LOGO_PATH = path.join(process.cwd(), "public", "brand-kit", "01-brand-identity", "logos", "anops-logo-horizontal-raster.png");
const LOGO_PUBLIC_PATH = "/brand-kit/01-brand-identity/logos/anops-logo-horizontal-raster.png";
let logoFile: Buffer | null | undefined;

/**
 * Messages reference the logo as cid:anops-logo. The PNG is attached inline, so it displays in every mail client
 * whether the app runs on localhost or in production. If the file cannot be read, the reference becomes a public URL.
 */
async function withInlineLogo(html: string | undefined): Promise<{ html: string | undefined; attachments?: { filename: string; content: Buffer; cid: string; contentType: string; contentDisposition: "inline" }[] }> {
  if (!html || !html.includes(`cid:${LOGO_CID}`)) return { html };
  if (logoFile === undefined) logoFile = await readFile(LOGO_PATH).catch(() => null);
  if (logoFile) return { html, attachments: [{ filename: "anops-logo.png", content: logoFile, cid: LOGO_CID, contentType: "image/png", contentDisposition: "inline" }] };
  const base = getAppUrl();
  const fallback = isLocalOnlyUrl(base) ? "https://i.ibb.co/dwVPDPVh/anops-horizontal-logo.png" : `${base}${LOGO_PUBLIC_PATH}`;
  return { html: html.replaceAll(`cid:${LOGO_CID}`, fallback) };
}

export type MailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type SendMailResult =
  | { delivered: true }
  | { delivered: false; reason: "not_configured" | "error"; error?: string };

/**
 * Low-level SMTP input. This is deliberately transport-only: templates and product
 * rules (authentication vs marketing) live in their own modules.
 */
export type SmtpMessageInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Optional deterministic Message-ID, used by marketing to make retries recognisable. */
  messageId?: string;
};

export type SmtpMessageResult = {
  messageId: string;
  response: string;
  accepted: string[];
};

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: env.EMAIL_SERVER_HOST,
    port: env.EMAIL_SERVER_PORT ?? 587,
    secure: env.EMAIL_SERVER_SECURE ?? false,
    auth:
      env.EMAIL_SERVER_USER && env.EMAIL_SERVER_PASSWORD
        ? { user: env.EMAIL_SERVER_USER, pass: env.EMAIL_SERVER_PASSWORD }
        : undefined,
    // Bound every phase so a stalled SMTP server cannot hold a request indefinitely.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  return transporter;
}

/** The shared transport, or null when EMAIL_SERVER_HOST / EMAIL_FROM are missing. */
export function getMailTransporter(): Transporter | null {
  return isEmailConfigured() ? getTransporter() : null;
}

/**
 * Sends one already-rendered message through the shared SMTP transport.
 * Authentication and marketing both use this function; neither owns it.
 */
export async function sendSmtpMessage(input: SmtpMessageInput): Promise<SmtpMessageResult> {
  const transport = getMailTransporter();
  if (!transport) throw new Error("SMTP is not configured");

  const rendered = await withInlineLogo(input.html);
  const info = await transport.sendMail({
    from: env.EMAIL_FROM,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: rendered.html,
    attachments: rendered.attachments,
    messageId: input.messageId,
  });

  const accepted = (info.accepted ?? []).map((value: unknown) => String(value));
  const rejectedCount = (info.rejected ?? []).length;
  if (rejectedCount > 0 && accepted.length === 0) {
    throw Object.assign(new Error("SMTP rejected the recipient"), { code: "EENVELOPE" });
  }
  if (accepted.length === 0) {
    throw new Error("SMTP did not accept the message");
  }

  return {
    messageId: info.messageId || input.messageId || "",
    response: info.response ?? "",
    accepted,
  };
}

/** Opens the SMTP connection and authenticates without sending a message. */
export async function verifySmtpTransport(): Promise<void> {
  const transport = getMailTransporter();
  if (!transport) throw new Error("SMTP is not configured");
  await transport.verify();
}

function describeTransport(): string {
  return `host=${env.EMAIL_SERVER_HOST ?? "(unset)"} port=${env.EMAIL_SERVER_PORT ?? 587} secure=${env.EMAIL_SERVER_SECURE ?? false} user=${env.EMAIL_SERVER_USER ? "(set)" : "(unset)"} from=${env.EMAIL_FROM ?? "(unset)"}`;
}

export async function sendMail(input: MailInput): Promise<SendMailResult> {
  console.info(`[email] preparing "${input.subject}" to ${input.to} | ${describeTransport()}`);

  if (!isEmailConfigured()) {
    console.warn(
      "[email] NOT CONFIGURED — required: EMAIL_SERVER_HOST and EMAIL_FROM. Falling back to console output (dev only)."
    );
    console.warn(`[email:preview] To: ${input.to}\nSubject: ${input.subject}\n\n${input.text}`);

    if (env.NODE_ENV === "production") {
      const error = "Email is not configured (set EMAIL_SERVER_HOST and EMAIL_FROM).";
      console.error(`[email] FAILED: ${error}`);
      return { delivered: false, reason: "not_configured", error };
    }

    return { delivered: false, reason: "not_configured" };
  }

  try {
    const info = await sendSmtpMessage({
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });

    console.info(
      `[email] SENT "${input.subject}" to ${input.to} (messageId=${info.messageId || "n/a"} response=${info.response || "n/a"})`
    );
    return { delivered: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[email] FAILED to send "${input.subject}" to ${input.to}: ${message}`);
    if (error instanceof Error && error.stack) console.error(error.stack);

    if (env.NODE_ENV !== "production") {
      console.warn(`[email:fallback] To: ${input.to}\nSubject: ${input.subject}\n\n${input.text}`);
    }

    return { delivered: false, reason: "error", error: message };
  }
}
