import "server-only";
import { MARKETING_COLLECTIONS, type CampaignDoc, type DeliveryDoc, type DeliveryEventDoc } from "@/server/marketing/documents";
import type { CampaignStatus, DeliveryStatus, LifecycleStage, MarketingChannel } from "@/features/marketing/types/constants";
import type { WorkspaceContext } from "@/server/tenancy/workspace";
import { requireMarketing, scopeOf, toObjectId } from "@/server/marketing/common";
import { getConfiguredProviders } from "@/server/marketing/providers";
import { AppError } from "@/shared/lib/errors";
import { PERMISSIONS } from "@/server/security/permissions";
import { CAMPAIGN_STATUSES, MARKETING_CHANNELS } from "@/features/marketing/types/constants";
import { DELIVERY_STATUS_ORDER } from "@/server/marketing/campaign.service";
import { SOCIAL_POST_STATUSES, type SocialPostStatus } from "@/features/marketing/types/constants";

const LIFECYCLE_KEYS: LifecycleStage[] = ["lead", "prospect", "customer", "inactive"];
const DAY_MS = 86_400_000;

function zeroed<K extends string>(keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
}

export type DashboardDto = {
  contacts: { total: number; active: number; byLifecycle: Record<LifecycleStage, number> };
  audiences: { total: number; active: number };
  campaigns: { byStatus: Record<CampaignStatus, number>; scheduled: number; completed: number };
  deliveries: { byStatus: Record<DeliveryStatus, number>; queued: number; accepted: number };
  unsubscribes: number;
  socialPosts: { byStatus: Record<SocialPostStatus, number>; publishedConfirmed: number };
  ai: { generationsLast30Days: number; byStatus: Record<string, number> };
  integrations: { email: boolean; sms: boolean; telegram: boolean };
  /** Campaign counts and provider-accepted deliveries per channel. */
  channels: Record<MarketingChannel, { campaigns: number; accepted: number }>;
  telegram: { connectedContacts: number; blockedContacts: number };
};

/**
 * Overview counts. Everything is computed by the database with grouped counts. No collection is loaded
 * into application memory. Metrics that depend on provider events are reported only when those events
 * exist, and the integration flags say whether a provider is connected at all.
 */
export async function getDashboard(ctx: WorkspaceContext): Promise<DashboardDto> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_READ);
  const db = ctx.db;
  const scope = scopeOf(ctx);
  const since = new Date(Date.now() - 30 * DAY_MS);

  const [contactTotal, contactActive, lifecycle, audienceTotal, audienceActive, campaignGroups, deliveryGroups, unsubscribes, postGroups, publishedConfirmed, aiTotal, aiGroups, campaignsByChannel, acceptedByChannel, telegramGroups] =
    await Promise.all([
      db.collection(MARKETING_COLLECTIONS.contacts).countDocuments(scope),
      db.collection(MARKETING_COLLECTIONS.contacts).countDocuments({ ...scope, isActive: true }),
      db.collection(MARKETING_COLLECTIONS.contacts).aggregate<{ _id: LifecycleStage; count: number }>([{ $match: scope }, { $group: { _id: "$lifecycleStage", count: { $sum: 1 } } }]).toArray(),
      db.collection(MARKETING_COLLECTIONS.audiences).countDocuments(scope),
      db.collection(MARKETING_COLLECTIONS.audiences).countDocuments({ ...scope, isActive: true }),
      db.collection(MARKETING_COLLECTIONS.campaigns).aggregate<{ _id: CampaignStatus; count: number }>([{ $match: scope }, { $group: { _id: "$status", count: { $sum: 1 } } }]).toArray(),
      db.collection(MARKETING_COLLECTIONS.deliveries).aggregate<{ _id: DeliveryStatus; count: number }>([{ $match: scope }, { $group: { _id: "$status", count: { $sum: 1 } } }]).toArray(),
      db.collection(MARKETING_COLLECTIONS.consentEvents).countDocuments({ ...scope, status: "withdrawn", source: { $in: ["unsubscribe_link", "telegram_stop"] } }),
      db.collection(MARKETING_COLLECTIONS.socialPosts).aggregate<{ _id: SocialPostStatus; count: number }>([{ $match: scope }, { $group: { _id: "$status", count: { $sum: 1 } } }]).toArray(),
      db.collection(MARKETING_COLLECTIONS.socialPosts).countDocuments({ ...scope, status: "published", externalPostId: { $type: "string" } }),
      db.collection(MARKETING_COLLECTIONS.aiGenerations).countDocuments({ ...scope, createdAt: { $gte: since } }),
      db.collection(MARKETING_COLLECTIONS.aiGenerations).aggregate<{ _id: string; count: number }>([{ $match: { ...scope, createdAt: { $gte: since } } }, { $group: { _id: "$status", count: { $sum: 1 } } }]).toArray(),
      db.collection(MARKETING_COLLECTIONS.campaigns).aggregate<{ _id: MarketingChannel; count: number }>([{ $match: scope }, { $group: { _id: "$channel", count: { $sum: 1 } } }]).toArray(),
      db.collection(MARKETING_COLLECTIONS.deliveries).aggregate<{ _id: MarketingChannel; count: number }>([{ $match: { ...scope, status: { $in: ["sent", "delivered", "bounced", "complained"] } } }, { $group: { _id: "$channel", count: { $sum: 1 } } }]).toArray(),
      db.collection(MARKETING_COLLECTIONS.telegramSubscriptions).aggregate<{ _id: string; count: number }>([{ $match: scope }, { $group: { _id: "$status", count: { $sum: 1 } } }]).toArray(),
    ]);

  const byLifecycle = zeroed(LIFECYCLE_KEYS);
  for (const row of lifecycle) byLifecycle[row._id] = row.count;
  const campaignStatus = zeroed(CAMPAIGN_STATUSES);
  for (const row of campaignGroups) campaignStatus[row._id] = row.count;
  const deliveryStatus = zeroed(DELIVERY_STATUS_ORDER);
  for (const row of deliveryGroups) deliveryStatus[row._id] = row.count;
  const postStatus = zeroed(SOCIAL_POST_STATUSES);
  for (const row of postGroups) postStatus[row._id] = row.count;
  const aiStatus: Record<string, number> = {};
  for (const row of aiGroups) aiStatus[row._id] = row.count;

  const channels = Object.fromEntries(MARKETING_CHANNELS.map((channel) => [channel, { campaigns: 0, accepted: 0 }])) as DashboardDto["channels"];
  for (const row of campaignsByChannel) if (channels[row._id]) channels[row._id].campaigns = row.count;
  for (const row of acceptedByChannel) if (channels[row._id]) channels[row._id].accepted = row.count;
  const telegramCount = (status: string) => telegramGroups.find((row) => row._id === status)?.count ?? 0;

  const providers = getConfiguredProviders();
  return {
    contacts: { total: contactTotal, active: contactActive, byLifecycle },
    audiences: { total: audienceTotal, active: audienceActive },
    campaigns: {
      byStatus: campaignStatus,
      scheduled: campaignStatus.scheduled,
      completed: campaignStatus.completed,
    },
    deliveries: {
      byStatus: deliveryStatus,
      queued: deliveryStatus.pending + deliveryStatus.sending,
      accepted: deliveryStatus.sent + deliveryStatus.delivered + deliveryStatus.bounced + deliveryStatus.complained,
    },
    unsubscribes,
    socialPosts: { byStatus: postStatus, publishedConfirmed },
    ai: { generationsLast30Days: aiTotal, byStatus: aiStatus },
    integrations: { email: Boolean(providers.email), sms: Boolean(providers.sms), telegram: Boolean(providers.telegram) },
    channels,
    telegram: { connectedContacts: telegramCount("active"), blockedContacts: telegramCount("blocked") },
  };
}

export type CampaignReportDto = {
  campaignId: string;
  name: string;
  channel: MarketingChannel;
  status: CampaignStatus;
  snapshot: { matched: number; eligible: number; suppressed: number; exclusions: Record<string, number> } | null;
  deliveries: Record<DeliveryStatus, number>;
  accepted: number;
  unsubscribes: number;
  /** Rates are null when their denominator is zero. */
  rates: {
    deliveryRate: number | null;
    bounceRate: number | null;
    complaintRate: number | null;
    failureRate: number | null;
    openRateEstimate: number | null;
    clickRate: number | null;
  };
  openTracking: "provider_reported" | "not_reported";
  /**
   * Which metrics the channel can report at all. Telegram gives no delivery receipt, bounce, open or click
   * signal, so those are "unsupported" rather than zero and the UI must not show a percentage for them.
   */
  support: { delivery: boolean; bounce: boolean; opens: boolean; clicks: boolean };
  timeline: { day: string; sent: number }[];
  definitions: Record<string, string>;
};

const rate = (numerator: number, denominator: number): number | null => (denominator > 0 ? numerator / denominator : null);

/** Campaign-level reporting. Every denominator is stated in `definitions`. */
export async function getCampaignReport(ctx: WorkspaceContext, campaignIdRaw: string): Promise<CampaignReportDto> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_READ);
  const campaignId = toObjectId(campaignIdRaw);
  const scope = scopeOf(ctx);
  const campaign = await ctx.db.collection<CampaignDoc>(MARKETING_COLLECTIONS.campaigns).findOne({ _id: campaignId, ...scope });
  if (!campaign) throw new AppError("NOT_FOUND", "Campaign not found");

  const deliveriesCollection = ctx.db.collection<DeliveryDoc>(MARKETING_COLLECTIONS.deliveries);
  const [groups, opened, clicked, unsubscribes, timeline] = await Promise.all([
    deliveriesCollection.aggregate<{ _id: DeliveryStatus; count: number }>([
      { $match: { ...scope, campaignId } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]).toArray(),
    deliveriesCollection.countDocuments({ ...scope, campaignId, firstOpenedAt: { $ne: null } }),
    deliveriesCollection.countDocuments({ ...scope, campaignId, firstClickedAt: { $ne: null } }),
    ctx.db
      .collection<DeliveryEventDoc>(MARKETING_COLLECTIONS.deliveryEvents)
      .countDocuments({ ...scope, campaignId, type: "unsubscribed" }),
    deliveriesCollection
      .aggregate<{ _id: string; sent: number }>([
        { $match: { ...scope, campaignId, sentAt: { $gte: new Date(Date.now() - 30 * DAY_MS) } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$sentAt", timezone: "UTC" } }, sent: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ])
      .toArray(),
  ]);

  const counts = zeroed(DELIVERY_STATUS_ORDER);
  for (const row of groups) counts[row._id] = row.count;
  const accepted = counts.sent + counts.delivered + counts.bounced + counts.complained;
  const eligible = campaign.snapshot?.eligibleCount ?? 0;
  const delivered = counts.delivered;
  const hasOpenEvents = opened > 0;

  return {
    campaignId: campaignIdRaw,
    name: campaign.name,
    channel: campaign.channel,
    status: campaign.status,
    snapshot: campaign.snapshot
      ? {
          matched: campaign.snapshot.matchedCount,
          eligible: campaign.snapshot.eligibleCount,
          suppressed: campaign.snapshot.suppressedCount,
          exclusions: campaign.snapshot.exclusions,
        }
      : null,
    deliveries: counts,
    accepted,
    unsubscribes,
    rates: {
      deliveryRate: campaign.channel === "telegram" ? null : rate(delivered, accepted),
      bounceRate: campaign.channel === "telegram" ? null : rate(counts.bounced, accepted),
      complaintRate: campaign.channel === "telegram" ? null : rate(counts.complained, accepted),
      failureRate: rate(counts.failed, eligible),
      openRateEstimate: hasOpenEvents ? rate(opened, delivered) : null,
      clickRate: hasOpenEvents || clicked > 0 ? rate(clicked, delivered) : null,
    },
    openTracking: campaign.channel === "telegram" ? "not_reported" : hasOpenEvents ? "provider_reported" : "not_reported",
    support:
      campaign.channel === "telegram"
        ? { delivery: false, bounce: false, opens: false, clicks: false }
        : { delivery: true, bounce: true, opens: true, clicks: true },
    timeline: timeline.map((row) => ({ day: row._id, sent: row.sent })),
    definitions: {
      accepted:
        campaign.channel === "telegram"
          ? "Messages Telegram accepted and returned a message id for. Telegram does not report delivery or reading, so this is not a delivered count."
          : "Messages the provider accepted: sent, delivered, bounced or complained.",
      deliveryRate: "Delivered ÷ accepted. Delivery receipts depend on the provider.",
      bounceRate: "Bounced ÷ accepted.",
      complaintRate: "Complained ÷ accepted.",
      failureRate: "Failed ÷ eligible recipients at approval. Failed messages were never accepted.",
      openRateEstimate: "Unique opens ÷ delivered. An estimate: mail privacy features and scanners inflate opens. Shown only when the provider reports opens.",
      clickRate: "Unique clicks ÷ delivered. Shown only when the provider reports clicks.",
    },
  };
}
