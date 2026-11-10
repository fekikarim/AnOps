import "server-only";
import type { Db, IndexDescription } from "mongodb";
import { COLLECTIONS } from "@/server/db/documents";
import { AppError } from "@/shared/lib/errors";
import { MARKETING_INDEXES } from "@/server/marketing/indexes";
import { HR_AI_INDEXES } from "@/server/services/hr-ai.indexes";
import { FINANCE_INDEXES } from "@/server/services/finance.indexes";
import { PLATFORM_INDEXES } from "@/server/platform/collections";

/**
 * Index definitions for every company-scoped collection (HR, inventory, purchasing, manufacturing),
 * plus the company membership and audit collections they depend on. Every index is idempotent, and
 * ensureIndexes runs once per database connection before the first workspace access.
 *
 * Tenant-scoped indexes lead with companyId because every query filters on it.
 */
const INDEXES: Record<string, IndexDescription[]> = {
  // Accounts and the original HR collections. These were only ever indexed by a one-off migration script, so a fresh
  // database scanned them on every sign-in and every HR or Finance request. Non-unique on purpose: adding a unique
  // index to existing data could fail on duplicates and stop the app from starting. Default index names are kept so
  // databases that already ran the migration do not hit a name conflict.
  users: [{ key: { email: 1 } }],
  // One logo generation at a time per organization; stale locks leave by TTL.
  organization_logo_locks: [{ key: { expiresAt: 1 }, expireAfterSeconds: 0 }],
  employees: [{ key: { companyId: 1, email: 1 } }, { key: { email: 1 } }, { key: { companyId: 1, departmentId: 1, status: 1 } }],
  departments: [{ key: { companyId: 1, name: 1 } }],
  job_titles: [{ key: { companyId: 1, isPredefined: -1, title: 1 } }],
  leave_types: [{ key: { companyId: 1, code: 1 } }],
  leave_policies: [{ key: { companyId: 1, isActive: 1, employeeCategory: 1 } }],
  public_holidays: [{ key: { companyId: 1, date: 1 } }],
  leave_transactions: [{ key: { companyId: 1, employeeId: 1, effectiveDate: -1 } }],
  // Tenant boundary. The slug index is partial so legacy documents without a slug do not collide.
  [COLLECTIONS.companies]: [
    { key: { slug: 1 }, name: "company_slug_unique", unique: true, partialFilterExpression: { slug: { $exists: true } } },
  ],
  [COLLECTIONS.companyMembers]: [
    { key: { companyId: 1, userId: 1 }, name: "member_company_user_unique", unique: true },
    { key: { userId: 1, status: 1 }, name: "member_user_status" },
  ],
  [COLLECTIONS.auditEvents]: [
    { key: { companyId: 1, occurredAt: -1 }, name: "audit_company_time" },
    { key: { companyId: 1, entityType: 1, entityId: 1, occurredAt: -1 }, name: "audit_entity" },
  ],
  [COLLECTIONS.inventoryCategories]: [
    { key: { companyId: 1, normalizedName: 1 }, name: "category_name_unique", unique: true },
    { key: { companyId: 1, isActive: 1, normalizedName: 1 }, name: "category_list" },
  ],
  [COLLECTIONS.inventoryProducts]: [
    { key: { companyId: 1, normalizedSku: 1 }, name: "product_sku_unique", unique: true },
    { key: { companyId: 1, isActive: 1, normalizedName: 1 }, name: "product_list_name" },
    { key: { companyId: 1, normalizedName: 1 }, name: "product_name_prefix" },
    { key: { companyId: 1, categoryId: 1, isActive: 1 }, name: "product_category" },
  ],
  [COLLECTIONS.inventoryWarehouses]: [
    { key: { companyId: 1, normalizedCode: 1 }, name: "warehouse_code_unique", unique: true },
    { key: { companyId: 1, isActive: 1, name: 1 }, name: "warehouse_list" },
  ],
  [COLLECTIONS.inventoryStockBalances]: [
    {
      key: { companyId: 1, productId: 1, warehouseId: 1 },
      name: "balance_product_warehouse_unique",
      unique: true,
    },
    { key: { companyId: 1, warehouseId: 1, onHandMicro: 1 }, name: "balance_warehouse_level" },
    { key: { companyId: 1, productId: 1 }, name: "balance_product" },
  ],
  [COLLECTIONS.inventoryStockMovements]: [
    { key: { companyId: 1, productId: 1, createdAt: -1 }, name: "movement_product_time" },
    { key: { companyId: 1, warehouseId: 1, createdAt: -1 }, name: "movement_warehouse_time" },
    { key: { companyId: 1, sourceType: 1, sourceId: 1 }, name: "movement_source" },
    { key: { companyId: 1, createdAt: -1 }, name: "movement_company_time" },
  ],
  [COLLECTIONS.purchaseSuppliers]: [
    { key: { companyId: 1, normalizedName: 1 }, name: "supplier_name_unique", unique: true },
    { key: { companyId: 1, isActive: 1, normalizedName: 1 }, name: "supplier_list" },
  ],
  [COLLECTIONS.purchaseOrders]: [
    { key: { companyId: 1, orderNumber: 1 }, name: "po_number_unique", unique: true },
    { key: { companyId: 1, status: 1, createdAt: -1 }, name: "po_status_time" },
    { key: { companyId: 1, supplierId: 1, createdAt: -1 }, name: "po_supplier_time" },
    // At most one purchase order per replenishment proposal. The database enforces it, so a late or
    // duplicate conversion write cannot create a second order.
    {
      key: { companyId: 1, sourceReplenishmentProposalId: 1 },
      name: "po_replenishment_source_unique",
      unique: true,
      partialFilterExpression: { sourceReplenishmentProposalId: { $exists: true } },
    },
  ],
  [COLLECTIONS.purchaseReplenishmentProposals]: [
    { key: { companyId: 1, status: 1, generatedAt: -1 }, name: "replenishment_status_time" },
  ],
  [COLLECTIONS.goodsReceipts]: [
    { key: { companyId: 1, receiptNumber: 1 }, name: "gr_number_unique", unique: true },
    { key: { companyId: 1, purchaseOrderId: 1, status: 1 }, name: "gr_order_status" },
    { key: { companyId: 1, status: 1, createdAt: -1 }, name: "gr_status_time" },
  ],
  [COLLECTIONS.manufacturingBoms]: [
    { key: { companyId: 1, finishedProductId: 1, revision: -1 }, name: "bom_revision_unique", unique: true },
    {
      key: { companyId: 1, finishedProductId: 1 },
      name: "bom_one_active_per_product",
      unique: true,
      partialFilterExpression: { status: "active" },
    },
    { key: { companyId: 1, status: 1, updatedAt: -1 }, name: "bom_status_time" },
  ],
  [COLLECTIONS.manufacturingWorkOrders]: [
    { key: { companyId: 1, orderNumber: 1 }, name: "wo_number_unique", unique: true },
    { key: { companyId: 1, status: 1, createdAt: -1 }, name: "wo_status_time" },
  ],
  [COLLECTIONS.aiSettings]: [{ key: { companyId: 1 }, name: "ai_settings_company_unique", unique: true }],
  [COLLECTIONS.aiAccessGrants]: [
    { key: { companyId: 1, userId: 1 }, name: "ai_grant_member_unique", unique: true },
    { key: { companyId: 1, enabled: 1 }, name: "ai_grant_enabled" },
  ],
  [COLLECTIONS.aiConversations]: [
    { key: { companyId: 1, userId: 1, updatedAt: -1 }, name: "ai_conversation_owner_time" },
    // Retention: documents leave when expiresAt passes. The service sets expiresAt on every write.
    { key: { expiresAt: 1 }, name: "ai_conversation_ttl", expireAfterSeconds: 0 },
  ],
  [COLLECTIONS.aiPendingActions]: [
    { key: { companyId: 1, userId: 1, status: 1, createdAt: -1 }, name: "ai_pending_owner_status" },
    // Outcome rows stay a day past expiry so a late confirm gets a precise answer, then they are removed.
    { key: { expiresAt: 1 }, name: "ai_pending_ttl", expireAfterSeconds: 86_400 },
  ],
  [COLLECTIONS.aiUsage]: [
    { key: { companyId: 1, day: 1, userId: 1 }, name: "ai_usage_day_member_unique", unique: true },
    // Rows written after this change carry expiresAt (400 days). Older rows have none and are kept.
    { key: { expiresAt: 1 }, name: "ai_usage_ttl", expireAfterSeconds: 0, partialFilterExpression: { expiresAt: { $exists: true } } },
  ],
  [COLLECTIONS.aiUsageModels]: [
    { key: { companyId: 1, day: 1, provider: 1, model: 1 }, name: "ai_usage_model_day_unique", unique: true },
    { key: { expiresAt: 1 }, name: "ai_usage_model_ttl", expireAfterSeconds: 0 },
  ],
  // Shared rate-limit windows. Each window is one document and leaves by TTL, so the collection never grows.
  [COLLECTIONS.rateLimits]: [{ key: { expiresAt: 1 }, name: "rate_limit_ttl", expireAfterSeconds: 0 }],
  [COLLECTIONS.aiNotices]: [
    { key: { companyId: 1, userId: 1, createdAt: -1 }, name: "ai_notice_owner_time" },
    { key: { expiresAt: 1 }, name: "ai_notice_ttl", expireAfterSeconds: 0 },
  ],
  // Community. Every query filters on companyId first; these back the list, thread and chat reads.
  blog_posts: [
    { key: { companyId: 1, status: 1, updatedAt: -1 }, name: "blog_company_status_time" },
    { key: { companyId: 1, slug: 1 }, name: "blog_company_slug" },
  ],
  forum_topics: [{ key: { companyId: 1, isPinned: -1, lastReplyAt: -1 }, name: "topic_company_pinned_time" }],
  forum_replies: [{ key: { companyId: 1, topicId: 1, createdAt: 1 }, name: "reply_company_topic_time" }],
  comments: [{ key: { companyId: 1, targetType: 1, targetId: 1, createdAt: -1 }, name: "comment_company_target_time" }],
  content_categories: [{ key: { companyId: 1, name: 1 }, name: "category_company_name" }],
  chat_conversations: [
    { key: { companyId: 1, status: 1, lastMessageAt: -1 }, name: "chat_company_status_time" },
    { key: { companyId: 1, visitorUserId: 1, lastMessageAt: -1 }, name: "chat_company_visitor_time" },
  ],
  chat_messages: [{ key: { companyId: 1, conversationId: 1, sentAt: 1 }, name: "chatmsg_company_conversation_time" }],
  ai_summaries: [{ key: { companyId: 1, blogPostId: 1, generatedAt: -1 }, name: "summary_company_post_time" }],
  ...MARKETING_INDEXES,
  ...HR_AI_INDEXES,
  ...FINANCE_INDEXES,
};

const initialized = new WeakMap<Db, Promise<void>>();

/** Creates the module indexes once per Db instance. Safe to call on every request. */
export function ensureIndexes(db: Db): Promise<void> {
  let pending = initialized.get(db);
  if (!pending) {
    pending = createAll(db).catch((error: unknown) => {
      initialized.delete(db);
      console.error("[db] index initialization failed", error instanceof Error ? error.name : "unknown");
      throw new AppError("INTERNAL", "Database is not ready. Please try again shortly.");
    });
    initialized.set(db, pending);
  }
  return pending;
}

async function createAll(db: Db): Promise<void> {
  const all: Record<string, IndexDescription[]> = { ...INDEXES };
  for (const [collectionName, indexes] of Object.entries(PLATFORM_INDEXES)) {
    all[collectionName] = [...(all[collectionName] ?? []), ...indexes];
  }
  for (const [collectionName, indexes] of Object.entries(all)) {
    await db.collection(collectionName).createIndexes(indexes);
  }
}

/** Exposed for tests and migration tooling. */
export const INDEX_DEFINITIONS = INDEXES;
