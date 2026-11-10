import "server-only";
import type { Db, ObjectId } from "mongodb";
import { MARKETING_COLLECTIONS, type ConsentStateDoc, type ContactDoc, type SuppressionDoc, type TelegramSubscriptionDoc } from "@/server/marketing/documents";
import type { MarketingChannel } from "@/features/marketing/types/constants";

/**
 * The single eligibility rule set. Every path that adds a recipient (snapshot creation) and every path
 * that sends (dispatch, right before the provider call) uses this function, so a rule cannot be applied
 * in one place and forgotten in another.
 *
 * Checks, in order:
 *  1. The contact is active and not in the inactive lifecycle stage.
 *  2. A destination exists for the channel (email address, phone number, or an active Telegram chat link).
 *  3. Effective marketing consent for this exact channel is granted. Consent for one channel never
 *     authorises another.
 *  4. The destination is not on the company suppression list (unsubscribed, bounced, complained, manual).
 */
export type ExclusionReason = "contact_inactive" | "missing_destination" | "no_consent" | "suppressed";

export type EligibilityResult = {
  contactId: string;
  eligible: boolean;
  destination: string;
  reason: ExclusionReason | null;
};

export type EligibilityInput = Pick<ContactDoc, "_id" | "isActive" | "lifecycleStage" | "normalizedEmail" | "phone">;

export const EXCLUSION_REASONS: readonly ExclusionReason[] = [
  "contact_inactive",
  "missing_destination",
  "no_consent",
  "suppressed",
];

export const EXCLUSION_LABELS: Record<ExclusionReason, string> = {
  contact_inactive: "Contact inactive",
  missing_destination: "No valid address or chat",
  no_consent: "No marketing consent",
  suppressed: "Suppressed",
};

/**
 * Destination stored on the contact itself. Telegram has none: its chat id lives on the subscription a
 * customer created by pressing Start, so it is resolved in evaluateEligibility instead.
 */
export function destinationFor(contact: EligibilityInput, channel: MarketingChannel): string {
  if (channel === "email") return contact.normalizedEmail ?? "";
  if (channel === "sms") return contact.phone;
  return "";
}

/** Active chat ids by contact. A blocked or disconnected subscription is not a usable destination. */
async function activeTelegramChats(db: Db, companyId: ObjectId, contactIds: ObjectId[]): Promise<Map<string, string>> {
  const rows = await db
    .collection<TelegramSubscriptionDoc>(MARKETING_COLLECTIONS.telegramSubscriptions)
    .find({ companyId, status: "active", contactId: { $in: contactIds } }, { projection: { contactId: 1, chatId: 1 } })
    .toArray();
  return new Map(rows.map((row) => [row.contactId.toHexString(), row.chatId]));
}

export async function evaluateEligibility(
  db: Db,
  companyId: ObjectId,
  channel: MarketingChannel,
  contacts: EligibilityInput[]
): Promise<Map<string, EligibilityResult>> {
  const results = new Map<string, EligibilityResult>();
  if (contacts.length === 0) return results;

  const ids = contacts.map((contact) => contact._id);
  const chats = channel === "telegram" ? await activeTelegramChats(db, companyId, ids) : null;
  const destinationOf = (contact: EligibilityInput): string =>
    chats ? chats.get(contact._id.toHexString()) ?? "" : destinationFor(contact, channel);
  const destinations = contacts.map(destinationOf).filter((value) => value !== "");

  const [states, suppressed] = await Promise.all([
    db
      .collection<ConsentStateDoc>(MARKETING_COLLECTIONS.consentStates)
      .find({ companyId, channel, purpose: "marketing", contactId: { $in: ids } }, { projection: { contactId: 1, status: 1 } })
      .toArray(),
    destinations.length === 0
      ? Promise.resolve([] as Pick<SuppressionDoc, "normalizedDestination">[])
      : db
          .collection<SuppressionDoc>(MARKETING_COLLECTIONS.suppressions)
          .find(
            { companyId, channel, normalizedDestination: { $in: destinations } },
            { projection: { normalizedDestination: 1 } }
          )
          .toArray(),
  ]);

  const granted = new Set(states.filter((state) => state.status === "granted").map((state) => state.contactId.toHexString()));
  const suppressedSet = new Set(suppressed.map((row) => row.normalizedDestination));

  for (const contact of contacts) {
    const contactId = contact._id.toHexString();
    const destination = destinationOf(contact);
    let reason: ExclusionReason | null = null;
    if (!contact.isActive || contact.lifecycleStage === "inactive") reason = "contact_inactive";
    else if (destination === "") reason = "missing_destination";
    else if (!granted.has(contactId)) reason = "no_consent";
    else if (suppressedSet.has(destination)) reason = "suppressed";
    results.set(contactId, { contactId, eligible: reason === null, destination, reason });
  }
  return results;
}

/** Re-runs the rules for a single contact. Used immediately before each provider call. */
export async function isStillEligible(
  db: Db,
  companyId: ObjectId,
  channel: MarketingChannel,
  contact: EligibilityInput
): Promise<EligibilityResult> {
  const result = await evaluateEligibility(db, companyId, channel, [contact]);
  return result.get(contact._id.toHexString()) as EligibilityResult;
}
