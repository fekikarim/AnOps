import "server-only";
import { ObjectId, type Db } from "mongodb";
import {
  MARKETING_COLLECTIONS,
  type AudienceDoc,
  type CampaignDoc,
  type CampaignSnapshotDoc,
  type ContactDoc,
  type DeliveryDoc,
} from "@/server/marketing/documents";
import { AppError } from "@/shared/lib/errors";
import { compileAudienceFilter, forEachMatchingContact } from "@/server/marketing/audience.service";
import { evaluateEligibility, EXCLUSION_REASONS, type ExclusionReason } from "@/server/marketing/eligibility";
import { MAX_CAMPAIGN_RECIPIENTS } from "@/server/marketing/common";

/**
 * Freezes the recipient set for a campaign at approval.
 *
 * - Every matching contact is evaluated once, so a contact in several matching tags or groups appears once.
 * - Every matching contact gets a delivery row: eligible contacts are `pending`, the others `suppressed`
 *   with the reason. Suppressed rows keep the campaign's exclusion counts explainable.
 * - The unique (companyId, campaignId, contactId) index is the idempotency key. Rebuilding removes the old
 *   rows first, so an approval that failed halfway can simply be retried.
 * - Consent and suppression are checked again before every send (see dispatch.ts).
 */
export async function buildRecipientSnapshot(
  db: Db,
  campaign: Pick<CampaignDoc, "_id" | "companyId" | "channel">,
  audience: AudienceDoc,
  now: Date
): Promise<CampaignSnapshotDoc> {
  const scope = { companyId: campaign.companyId };
  const filter = await compileAudienceFilter(db, campaign.companyId, audience.selectionRule);
  const matched = await db
    .collection<ContactDoc>(MARKETING_COLLECTIONS.contacts)
    .countDocuments(filter, { limit: MAX_CAMPAIGN_RECIPIENTS + 1 });
  if (matched > MAX_CAMPAIGN_RECIPIENTS) {
    throw new AppError(
      "VALIDATION_ERROR",
      `This audience has more than ${MAX_CAMPAIGN_RECIPIENTS.toLocaleString("en-US")} contacts. Narrow the audience before approving.`
    );
  }

  const deliveries = db.collection<DeliveryDoc>(MARKETING_COLLECTIONS.deliveries);
  await deliveries.deleteMany({ ...scope, campaignId: campaign._id });

  const exclusions = Object.fromEntries(EXCLUSION_REASONS.map((reason) => [reason, 0])) as Record<ExclusionReason, number>;
  let eligibleCount = 0;
  let suppressedCount = 0;

  await forEachMatchingContact(db, filter, MAX_CAMPAIGN_RECIPIENTS, async (batch) => {
    const results = await evaluateEligibility(db, campaign.companyId, campaign.channel, batch);
    const rows: DeliveryDoc[] = [];
    for (const contact of batch) {
      const result = results.get(contact._id.toHexString());
      if (!result) continue;
      if (result.eligible) eligibleCount += 1;
      else if (result.reason) {
        suppressedCount += 1;
        exclusions[result.reason] += 1;
      }
      rows.push({
        _id: new ObjectId(),
        companyId: campaign.companyId,
        campaignId: campaign._id,
        contactId: contact._id,
        channel: campaign.channel,
        destination: result.destination,
        status: result.eligible ? "pending" : "suppressed",
        exclusionReason: result.reason,
        providerMessageId: null,
        attemptCount: 0,
        nextAttemptAt: null,
        lastAttemptAt: null,
        lastErrorCode: null,
        sentAt: null,
        deliveredAt: null,
        bouncedAt: null,
        complainedAt: null,
        failedAt: null,
        firstOpenedAt: null,
        firstClickedAt: null,
        createdAt: now,
        updatedAt: now,
        version: 1,
      });
    }
    if (rows.length > 0) {
      try {
        await deliveries.insertMany(rows, { ordered: false });
      } catch (error) {
        // A duplicate means this contact already has a row for this campaign. That row is kept.
        if ((error as { code?: number }).code !== 11000) throw error;
      }
    }
  });

  if (eligibleCount === 0) {
    throw new AppError(
      "VALIDATION_ERROR",
      "No recipients are eligible. Check the audience rules and each contact's consent before approving."
    );
  }

  return {
    takenAt: now,
    audienceId: audience._id,
    audienceName: audience.name,
    audienceRule: audience.selectionRule,
    matchedCount: matched,
    eligibleCount,
    suppressedCount,
    exclusions,
  };
}
