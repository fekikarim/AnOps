import "server-only";
import { ObjectId, type Db } from "mongodb";
import { MARKETING_COLLECTIONS, type DeliveryDoc, type DeliveryEventDoc, type SuppressionDoc } from "@/server/marketing/documents";
import type { DeliveryEventType } from "@/features/marketing/types/constants";
import { type DeliveryWebhookInput } from "@/features/marketing/schemas/marketing.schema";
import { appendConsentEvent } from "@/server/marketing/consent.service";

export type DeliveryEventOutcome = "recorded" | "duplicate" | "unmatched";

/**
 * Applies a provider delivery event.
 *
 * - The provider message id is the only lookup key. The company comes from the stored delivery, never
 *   from the payload, so a webhook cannot write into another tenant.
 * - Each event is stored once. A replay with the same provider event id hits the unique index and does
 *   nothing else.
 * - State moves forward only: `sent` → `delivered`, and bounces or complaints from `sent` or `delivered`.
 *   A late "delivered" never overwrites a bounce.
 * - Bounces and complaints add the destination to the company suppression list, so later campaigns skip it.
 */
export async function applyDeliveryEvent(
  db: Db,
  input: DeliveryWebhookInput,
  providerName: string,
  now: Date = new Date()
): Promise<DeliveryEventOutcome> {
  const deliveries = db.collection<DeliveryDoc>(MARKETING_COLLECTIONS.deliveries);
  const delivery = await deliveries.findOne({ providerMessageId: input.providerMessageId });
  if (!delivery) return "unmatched";

  const scope = { companyId: delivery.companyId };
  const occurredAt = new Date(input.occurredAt);
  const event: DeliveryEventDoc = {
    _id: new ObjectId(),
    companyId: delivery.companyId,
    campaignId: delivery.campaignId,
    deliveryId: delivery._id,
    type: input.type as DeliveryEventType,
    providerName,
    providerEventId: input.eventId,
    occurredAt,
    receivedAt: now,
  };
  try {
    await db.collection<DeliveryEventDoc>(MARKETING_COLLECTIONS.deliveryEvents).insertOne(event);
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return "duplicate";
    throw error;
  }

  switch (input.type) {
    case "delivered":
      await deliveries.updateOne(
        { _id: delivery._id, ...scope, status: "sent" },
        { $set: { status: "delivered", deliveredAt: occurredAt, updatedAt: now } }
      );
      break;
    case "bounced":
    case "complained": {
      const status = input.type === "bounced" ? "bounced" : "complained";
      const at = input.type === "bounced" ? "bouncedAt" : "complainedAt";
      await deliveries.updateOne(
        { _id: delivery._id, ...scope, status: { $in: ["sent", "delivered"] } },
        { $set: { status, [at]: occurredAt, updatedAt: now } }
      );
      await suppress(db, delivery, input.type === "bounced" ? "bounced" : "complained", now);
      break;
    }
    case "failed":
      await deliveries.updateOne(
        { _id: delivery._id, ...scope, status: { $in: ["pending", "sending"] } },
        { $set: { status: "failed", failedAt: occurredAt, lastErrorCode: "PROVIDER_FAILED", updatedAt: now } }
      );
      break;
    case "opened":
      await deliveries.updateOne({ _id: delivery._id, ...scope, firstOpenedAt: null }, { $set: { firstOpenedAt: occurredAt } });
      break;
    case "clicked":
      await deliveries.updateOne({ _id: delivery._id, ...scope, firstClickedAt: null }, { $set: { firstClickedAt: occurredAt } });
      break;
  }
  return "recorded";
}

/** Adds a destination to the company suppression list. Idempotent through the unique index. */
export async function suppress(
  db: Db,
  delivery: Pick<DeliveryDoc, "companyId" | "channel" | "destination" | "contactId">,
  reason: SuppressionDoc["reason"],
  now: Date
): Promise<void> {
  const normalizedDestination = delivery.destination.toLowerCase();
  try {
    await db.collection<SuppressionDoc>(MARKETING_COLLECTIONS.suppressions).insertOne({
      _id: new ObjectId(),
      companyId: delivery.companyId,
      channel: delivery.channel,
      normalizedDestination,
      reason,
      contactId: delivery.contactId,
      createdAt: now,
    });
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
  }
}

/**
 * A provider reported that a recipient unsubscribed. Records a withdrawal through the same consent path as
 * the public link, adds the suppression entry, and stores the event once. The delivery's company and
 * contact are taken from the stored delivery, never from the provider payload.
 */
export async function applyProviderUnsubscribe(
  db: Db,
  input: { providerMessageId: string; eventId: string; occurredAt: string },
  requestId: string,
  now: Date = new Date()
): Promise<DeliveryEventOutcome> {
  const delivery = await db
    .collection<DeliveryDoc>(MARKETING_COLLECTIONS.deliveries)
    .findOne({ providerMessageId: input.providerMessageId });
  if (!delivery) return "unmatched";

  try {
    await db.collection<DeliveryEventDoc>(MARKETING_COLLECTIONS.deliveryEvents).insertOne({
      _id: new ObjectId(),
      companyId: delivery.companyId,
      campaignId: delivery.campaignId,
      deliveryId: delivery._id,
      type: "unsubscribed",
      providerName: "brevo",
      providerEventId: input.eventId,
      occurredAt: new Date(input.occurredAt),
      receivedAt: now,
    });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return "duplicate";
    throw error;
  }

  await appendConsentEvent(
    db,
    {
      companyId: delivery.companyId,
      contactId: delivery.contactId,
      channel: delivery.channel,
      status: "withdrawn",
      source: "unsubscribe_link",
      occurredAt: new Date(input.occurredAt),
      recordedBy: null,
      requestId,
    }
  );
  await suppress(db, delivery, "unsubscribed", now);
  return "recorded";
}
