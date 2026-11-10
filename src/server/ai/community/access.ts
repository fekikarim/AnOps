import "server-only";
import { maskEmail, maskPhone } from "@/server/ai/marketing/access";
import { PERMISSIONS } from "@/server/security/permissions";
import type { WorkspaceContext } from "@/server/tenancy/workspace";

/**
 * What the Community tools know about the caller and about personal data in chat.
 *
 * Visitor emails are never shown to the model or in AI results, whoever asks: the Community pages show them to the people who
 * may see them. Anything in a chat message that looks like an email address or a phone number is masked before it leaves the
 * service layer, because visitors type those into messages themselves.
 */
export type CommunityScope = { write: boolean; support: boolean; admin: boolean };

export const communityScope = (ctx: WorkspaceContext): CommunityScope => ({
  write: ctx.permissions.has(PERMISSIONS.COMMUNITY_WRITE),
  support: ctx.permissions.has(PERMISSIONS.COMMUNITY_SUPPORT),
  admin: ctx.permissions.has(PERMISSIONS.COMMUNITY_ADMIN),
});

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?<![\w])\+?\d[\d\s().-]{6,}\d(?![\w])/g;
const DATE_TIME = /\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?/g;

/** Masks emails and phone numbers inside free text. Dates and times are protected first, so they are never mistaken for numbers. */
export function redactPersonalData(text: string): string {
  const dates: string[] = [];
  const guarded = text.replace(DATE_TIME, (m) => `\u0000${dates.push(m) - 1}\u0000`);
  const masked = guarded
    .replace(EMAIL, (m) => maskEmail(m))
    .replace(PHONE, (m) => (m.replace(/\D/g, "").length >= 8 ? maskPhone(m.replace(/\D/g, "")) : m));
  return masked.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => dates[Number(i)]);
}

export const maskVisitorEmail = (email: string | undefined): string => (email ? maskEmail(email) : "");

/** The signed-in person's display name, as the Community pages record it (employee name, otherwise the email). */
export async function authorNameOf(ctx: WorkspaceContext): Promise<string> {
  const user = await ctx.db.collection("users").findOne({ _id: ctx.userId }, { projection: { name: 1, email: 1 } });
  return (user?.name as string | undefined) || (user?.email as string | undefined) || "Member";
}
