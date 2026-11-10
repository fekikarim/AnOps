import "server-only";
import type { IndexDescription } from "mongodb";
import { MARKETING_COLLECTIONS } from "@/server/marketing/documents";

/**
 * Marketing index definitions. Merged into the module index set in server/db/indexes.ts, so they run
 * through the same idempotent ensureIndexes() call. Tenant-scoped indexes lead with companyId.
 */
export const MARKETING_INDEXES: Record<string, IndexDescription[]> = {
  [MARKETING_COLLECTIONS.contacts]: [
    {
      key: { companyId: 1, normalizedEmail: 1 },
      name: "mkt_contact_email_unique",
      unique: true,
      partialFilterExpression: { normalizedEmail: { $type: "string" } },
    },
    { key: { companyId: 1, searchName: 1 }, name: "mkt_contact_search_name" },
    { key: { companyId: 1, lifecycleStage: 1, isActive: 1 }, name: "mkt_contact_stage" },
    { key: { companyId: 1, createdAt: -1 }, name: "mkt_contact_created" },
  ],
  [MARKETING_COLLECTIONS.tags]: [
    { key: { companyId: 1, normalizedName: 1 }, name: "mkt_tag_name_unique", unique: true },
  ],
  [MARKETING_COLLECTIONS.contactTags]: [
    { key: { companyId: 1, contactId: 1, tagId: 1 }, name: "mkt_contact_tag_unique", unique: true },
    { key: { companyId: 1, tagId: 1, contactId: 1 }, name: "mkt_tag_contacts" },
  ],
  [MARKETING_COLLECTIONS.consentEvents]: [
    { key: { companyId: 1, contactId: 1, channel: 1, occurredAt: -1 }, name: "mkt_consent_history" },
  ],
  [MARKETING_COLLECTIONS.consentStates]: [
    {
      key: { companyId: 1, contactId: 1, channel: 1, purpose: 1 },
      name: "mkt_consent_state_unique",
      unique: true,
    },
    { key: { companyId: 1, channel: 1, purpose: 1, status: 1 }, name: "mkt_consent_by_status" },
  ],
  [MARKETING_COLLECTIONS.suppressions]: [
    {
      key: { companyId: 1, channel: 1, normalizedDestination: 1 },
      name: "mkt_suppression_unique",
      unique: true,
    },
  ],
  [MARKETING_COLLECTIONS.audiences]: [
    { key: { companyId: 1, normalizedName: 1 }, name: "mkt_audience_name_unique", unique: true },
    { key: { companyId: 1, isActive: 1, normalizedName: 1 }, name: "mkt_audience_list" },
  ],
  [MARKETING_COLLECTIONS.templates]: [
    { key: { companyId: 1, normalizedName: 1 }, name: "mkt_template_name_unique", unique: true },
    { key: { companyId: 1, channel: 1, isActive: 1 }, name: "mkt_template_channel" },
  ],
  [MARKETING_COLLECTIONS.campaigns]: [
    { key: { companyId: 1, status: 1, scheduledAt: 1 }, name: "mkt_campaign_status_time" },
    { key: { companyId: 1, createdAt: -1 }, name: "mkt_campaign_created" },
    { key: { companyId: 1, templateId: 1 }, name: "mkt_campaign_template" },
    { key: { companyId: 1, audienceId: 1 }, name: "mkt_campaign_audience" },
  ],
  [MARKETING_COLLECTIONS.deliveries]: [
    {
      key: { companyId: 1, campaignId: 1, contactId: 1 },
      name: "mkt_delivery_recipient_unique",
      unique: true,
    },
    { key: { companyId: 1, campaignId: 1, status: 1 }, name: "mkt_delivery_campaign_status" },
    { key: { companyId: 1, status: 1, nextAttemptAt: 1 }, name: "mkt_delivery_due" },
    { key: { companyId: 1, contactId: 1 }, name: "mkt_delivery_contact" },
    {
      key: { providerMessageId: 1 },
      name: "mkt_delivery_provider_message_unique",
      unique: true,
      partialFilterExpression: { providerMessageId: { $type: "string" } },
    },
  ],
  [MARKETING_COLLECTIONS.deliveryEvents]: [
    { key: { companyId: 1, providerEventId: 1 }, name: "mkt_event_provider_unique", unique: true },
    { key: { companyId: 1, campaignId: 1, type: 1 }, name: "mkt_event_campaign_type" },
    { key: { companyId: 1, deliveryId: 1, type: 1 }, name: "mkt_event_delivery_type" },
  ],
  [MARKETING_COLLECTIONS.jobs]: [
    { key: { companyId: 1, key: 1 }, name: "mkt_job_key_unique", unique: true },
    { key: { status: 1, runAt: 1 }, name: "mkt_job_due" },
    { key: { status: 1, leaseExpiresAt: 1 }, name: "mkt_job_lease" },
  ],
  [MARKETING_COLLECTIONS.socialAccounts]: [
    {
      key: { companyId: 1, platform: 1, externalAccountId: 1 },
      name: "mkt_social_account_unique",
      unique: true,
    },
    { key: { companyId: 1, connectionStatus: 1 }, name: "mkt_social_account_status" },
  ],
  [MARKETING_COLLECTIONS.socialOauthStates]: [
    // Expired and consumed states are removed by MongoDB's TTL monitor.
    { key: { expiresAt: 1 }, name: "mkt_oauth_state_ttl", expireAfterSeconds: 0 },
  ],
  [MARKETING_COLLECTIONS.socialPosts]: [
    { key: { companyId: 1, status: 1, scheduledAt: 1 }, name: "mkt_post_status_time" },
    { key: { companyId: 1, createdAt: -1 }, name: "mkt_post_created" },
    { key: { companyId: 1, socialAccountId: 1 }, name: "mkt_post_account" },
  ],
  [MARKETING_COLLECTIONS.aiGenerations]: [
    { key: { companyId: 1, requestedBy: 1, createdAt: -1 }, name: "mkt_ai_user_time" },
    { key: { companyId: 1, createdAt: -1 }, name: "mkt_ai_company_time" },
  ],
  [MARKETING_COLLECTIONS.telegramSubscriptions]: [
    { key: { companyId: 1, contactId: 1 }, name: "mkt_tg_sub_contact_unique", unique: true },
    { key: { companyId: 1, chatId: 1 }, name: "mkt_tg_sub_chat_unique", unique: true },
    { key: { companyId: 1, status: 1 }, name: "mkt_tg_sub_status" },
  ],
  [MARKETING_COLLECTIONS.telegramLinkTokens]: [
    // Expired and consumed tokens are removed by MongoDB's TTL monitor.
    { key: { expiresAt: 1 }, name: "mkt_tg_token_ttl", expireAfterSeconds: 0 },
    { key: { companyId: 1, contactId: 1 }, name: "mkt_tg_token_contact" },
  ],
  [MARKETING_COLLECTIONS.telegramUpdates]: [
    // Update ids only need to be remembered long enough to absorb Telegram's retries.
    { key: { receivedAt: 1 }, name: "mkt_tg_update_ttl", expireAfterSeconds: 7 * 86_400 },
  ],
};
