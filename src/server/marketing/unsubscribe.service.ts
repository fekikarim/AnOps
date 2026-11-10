import "server-only";
import { ObjectId, type Db } from "mongodb";
import {
  MARKETING_COLLECTIONS,
  type ConsentStateDoc,
  type ContactDoc,
  type DeliveryDoc,
  type DeliveryEventDoc,
} from "@/server/marketing/documents";
import { appendConsentEvent } from "@/server/marketing/consent.service";
import { suppress } from "@/server/marketing/delivery-events";
import { destinationFor } from "@/server/marketing/eligibility";
import { verifyUnsubscribeToken, type UnsubscribePayload } from "@/server/marketing/unsubscribe-token";
import { companyName } from "@/server/marketing/common";

export type UnsubscribeView =
  | { valid: false }
  | { valid: true; companyName: string; channel: "email" | "sms"; alreadyUnsubscribed: boolean };

export type UnsubscribeResult = "unsubscribed" | "already_unsubscribed" | "invalid";

/**
 * Public unsubscribe. The signed token is the only credential, so the request needs no session. The page
 * reveals the company name and channel and nothing about the contact.
 *
 * Idempotent: repeating the request, or opening the link in a mail scanner and then clicking it, leaves
 * the same state.
 */
export async function viewUnsubscribe(db: Db, token: string): Promise<UnsubscribeView> {
  const payload = verifyUnsubscribeToken(token);
  if (!payload) return { valid: false };
  const contact = await loadContact(db, payload);
  if (!contact) return { valid: false };
  const state = await db
    .collection(MARKETING_COLLECTIONS.consentStates)
    .findOne({
      companyId: new ObjectId(payload.companyId),
      contactId: new ObjectId(payload.contactId),
      channel: payload.channel,
      purpose: "marketing",
    });
  return {
    valid: true,
    companyName: await companyName(db, new ObjectId(payload.companyId)),
    channel: payload.channel,
    alreadyUnsubscribed: state?.status === "withdrawn",
  };
}

async function loadContact(db: Db, payload: UnsubscribePayload): Promise<ContactDoc | null> {
  return db.collection<ContactDoc>(MARKETING_COLLECTIONS.contacts).findOne({
    _id: new ObjectId(payload.contactId),
    companyId: new ObjectId(payload.companyId),
  });
}

export async function confirmUnsubscribe(db: Db, token: string, requestId: string): Promise<UnsubscribeResult> {
  const payload = verifyUnsubscribeToken(token);
  if (!payload) return "invalid";
  const contact = await loadContact(db, payload);
  if (!contact) return "invalid";

  const companyId = contact.companyId;
  const contactId = contact._id;
  const now = new Date();
  const current = await db
    .collection<ConsentStateDoc>(MARKETING_COLLECTIONS.consentStates)
    .findOne({ companyId, contactId, channel: payload.channel, purpose: "marketing" }, { projection: { status: 1 } });
  const alreadyWithdrawn = current?.status === "withdrawn";
  if (!alreadyWithdrawn) {
    await appendConsentEvent(db, {
      companyId,
      contactId,
      channel: payload.channel,
      status: "withdrawn",
      source: "unsubscribe_link",
      occurredAt: now,
      recordedBy: null,
      requestId,
    });
  }

  // Suppression is re-asserted on every request, so a repeated click still repairs a missing entry.
  const destination = destinationFor(contact, payload.channel);
  if (destination) {
    await suppress(
      db,
      { companyId, channel: payload.channel, destination, contactId },
      "unsubscribed",
      now
    );
  }

  if (payload.campaignId) {
    const delivery = await db
      .collection<DeliveryDoc>(MARKETING_COLLECTIONS.deliveries)
      .findOne({ companyId, campaignId: new ObjectId(payload.campaignId), contactId }, { projection: { _id: 1, campaignId: 1 } });
    if (delivery) {
      try {
        await db.collection<DeliveryEventDoc>(MARKETING_COLLECTIONS.deliveryEvents).insertOne({
          _id: new ObjectId(),
          companyId,
          campaignId: delivery.campaignId,
          deliveryId: delivery._id,
          type: "unsubscribed",
          providerName: "anops",
          // One unsubscribe event per contact, channel and campaign. Repeats are absorbed by the unique index.
          providerEventId: `unsubscribe:${contactId.toHexString()}:${payload.channel}:${payload.campaignId}`,
          occurredAt: now,
          receivedAt: now,
        });
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
      }
    }
  }

  return alreadyWithdrawn ? "already_unsubscribed" : "unsubscribed";
}
