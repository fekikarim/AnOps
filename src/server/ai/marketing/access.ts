import "server-only";
import { getSendAllowlist } from "@/server/marketing/config";
import { getConfiguredProviders } from "@/server/marketing/providers";
import { renderMessage } from "@/server/marketing/message";
import { PERMISSIONS } from "@/server/security/permissions";
import type { WorkspaceContext } from "@/server/tenancy/workspace";
import { AppError } from "@/shared/lib/errors";
import type { MarketingChannel } from "@/features/marketing/types/constants";

/**
 * Who the member is to Marketing, resolved from the live context on every call.
 *
 *  - admin: owner or admin, the only roles that may approve, schedule or cancel through AI.
 *  - manageContacts: the exact contact-management permission. Only it may reveal a full email address or phone number.
 *
 * Contact destinations are masked in the data given to the model, not only on screen. Nothing here ever returns a
 * credential, a token, a webhook secret or a Telegram link: integration status is booleans.
 */
export type MkScope = { admin: boolean; manageContacts: boolean; approve: boolean; dispatch: boolean };

export function mkScope(ctx: WorkspaceContext): MkScope {
  return {
    admin: ctx.role === "owner" || ctx.role === "admin",
    manageContacts: ctx.permissions.has(PERMISSIONS.MARKETING_CONTACT_MANAGE),
    approve: ctx.permissions.has(PERMISSIONS.MARKETING_CAMPAIGN_APPROVE),
    dispatch: ctx.permissions.has(PERMISSIONS.MARKETING_CAMPAIGN_DISPATCH),
  };
}

/** Approving, scheduling and cancelling a send: owner/admin AND the existing approve and dispatch rights. */
export function requireSender(ctx: WorkspaceContext): MkScope {
  const scope = mkScope(ctx);
  if (!scope.admin || !scope.approve || !scope.dispatch) throw new AppError("FORBIDDEN", "Only owners and administrators with sending rights can approve, schedule or cancel campaigns.");
  return scope;
}

export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  return at <= 0 ? (email ? "••••" : "") : `${email[0]}•••${email.slice(at)}`;
}
export function maskPhone(phone: string): string {
  if (!phone) return "";
  return phone.length <= 4 ? "••••" : `••••${phone.slice(-4)}`;
}

export type ContactView = { id: string; name: string; email: string; phone: string; source: string; lifecycleStage: string; isActive: boolean; version: number; revealed: boolean };

/** A contact as the model and the person see it. Destinations are masked unless a contact manager asked to reveal them. */
export function contactView(c: { id: string; fullName: string; email: string; phone: string; source: string; lifecycleStage: string; isActive: boolean; version: number }, scope: MkScope, reveal = false): ContactView {
  const show = reveal && scope.manageContacts;
  return { id: c.id, name: c.fullName, email: show ? c.email : maskEmail(c.email), phone: show ? c.phone : maskPhone(c.phone), source: c.source, lifecycleStage: c.lifecycleStage, isActive: c.isActive, version: c.version, revealed: show };
}

/** Whether a real send could reach arbitrary recipients from here: only a production deployment or an active allowlist may schedule. */
export function sendEnvironment() {
  const allowlist = getSendAllowlist();
  return { allowlistActive: Boolean(allowlist && allowlist.length > 0), allowlistSize: allowlist?.length ?? 0, production: process.env.NODE_ENV === "production" };
}

export function assertMaySchedule(): void {
  const e = sendEnvironment();
  const emptyList = getSendAllowlist()?.length === 0; // a list was set but names nobody: dispatch would refuse everyone
  if (emptyList || (!e.allowlistActive && !e.production)) {
    throw new AppError("FORBIDDEN", "Scheduling through AI is refused here: no recipient allowlist is active and this is not a production deployment, so the message could reach real people. Set MARKETING_SEND_ALLOWLIST to controlled test recipients.");
  }
}

/** Safe booleans only: whether each channel has a provider, never which account, key or address. */
export function integrationFlags() {
  const providers = getConfiguredProviders();
  const e = sendEnvironment();
  return { email: Boolean(providers.email), sms: Boolean(providers.sms), telegram: Boolean(providers.telegram), allowlistActive: e.allowlistActive, production: e.production };
}

/** The message exactly as a recipient would get it, with an example contact. Variables are filled with sample values. */
export function renderPreview(channel: MarketingChannel, content: { subject: string; body: string }): { subject: string; text: string } {
  const r = renderMessage(channel, { subject: content.subject, body: content.body }, {
    first_name: "Sample",
    last_name: "Contact",
    email: "sample@example.test",
    company_name: "Your company",
    unsubscribe_url: "https://example.test/unsubscribe?token=EXAMPLE",
  });
  return { subject: r.subject, text: r.text };
}

/** Tunis wall-clock time for an instant, for the "exact time" line of a send preview. */
export function tunisTime(d: Date): string {
  return `${new Intl.DateTimeFormat("sv-SE", { timeZone: "Africa/Tunis", dateStyle: "short", timeStyle: "short" }).format(d)} (Tunis)`;
}
