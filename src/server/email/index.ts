import "server-only";
import { sendMail, type SendMailResult } from "@/server/email/client";
import { verificationEmail, passwordResetEmail } from "@/server/email/templates";

export { sendMail } from "@/server/email/client";
export { isEmailConfigured } from "@/config/env";
export type { SendMailResult } from "@/server/email/client";

export async function sendVerificationEmail(
  to: string,
  name: string,
  token: string
): Promise<SendMailResult> {
  const { subject, html, text } = verificationEmail(name, token);
  return sendMail({ to, subject, html, text });
}

export async function sendPasswordResetEmail(
  to: string,
  name: string,
  token: string
): Promise<SendMailResult> {
  const { subject, html, text } = passwordResetEmail(name, token);
  return sendMail({ to, subject, html, text });
}
