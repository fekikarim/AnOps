import "server-only";
import type { ObjectId } from "mongodb";
import type { UnitOfMeasure } from "@/shared/domain/units";
import type { AiModuleGrant, AiModuleKey, AiOperation, AiRisk } from "@/shared/domain/ai";

export { UNITS_OF_MEASURE, type UnitOfMeasure } from "@/shared/domain/units";

/**
 * Persistence shapes. These are internal: never return them from actions or
 * route handlers. Map them to DTOs in the feature mappers instead.
 *
 * Money is stored in milli-units (see shared/lib/fixed-point.ts). Quantities are
 * stored in micro-units. Both are integers.
 */

export const COLLECTIONS = {
  /** Tenant boundary. One document per company; shared with features/company (the multi-tenant model). */
  companies: "companies",
  companyMembers: "company_members",
  counters: "counters",
  auditEvents: "audit_events",
  inventoryCategories: "inventory_categories",
  inventoryProducts: "inventory_products",
  inventoryWarehouses: "inventory_warehouses",
  inventoryStockBalances: "inventory_stock_balances",
  inventoryStockMovements: "inventory_stock_movements",
  purchaseSuppliers: "purchase_suppliers",
  purchaseOrders: "purchase_orders",
  goodsReceipts: "goods_receipts",
  manufacturingBoms: "manufacturing_boms",
  manufacturingWorkOrders: "manufacturing_work_orders",
  purchaseReplenishmentProposals: "purchase_replenishment_proposals",
  aiSettings: "ai_settings",
  aiAccessGrants: "ai_access_grants",
  aiConversations: "ai_conversations",
  aiPendingActions: "ai_pending_actions",
  aiUsage: "ai_usage",
  aiNotices: "ai_notices",
  aiUsageModels: "ai_usage_models",
  rateLimits: "rate_limits",
} as const;

/** Every tenant-owned document carries exactly this scope. There is no other tenancy level. */
export type TenantScope = {
  companyId: ObjectId;
};

export type AuditEventDoc = {
  _id: ObjectId;
  companyId: ObjectId | null;
  actorUserId: ObjectId;
  action: string;
  entityType: string;
  entityId: string;
  outcome: "success" | "failure";
  requestId: string;
  metadata: Record<string, string | number | boolean>;
  occurredAt: Date;
};

export type CounterDoc = {
  _id: string;
  seq: number;
};

export type ProductCategoryDoc = TenantScope & {
  _id: ObjectId;
  name: string;
  normalizedName: string;
  description: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type ProductDoc = TenantScope & {
  _id: ObjectId;
  categoryId: ObjectId | null;
  sku: string;
  normalizedSku: string;
  name: string;
  normalizedName: string;
  description: string;
  unitOfMeasure: UnitOfMeasure;
  isStorable: boolean;
  isActive: boolean;
  /** Standard cost used for stock valuation, milli-units. */
  costMilli: number;
  /** List sale price, milli-units. Informational until sales are integrated. */
  salePriceMilli: number;
  /** Stock level at or below which the product is flagged as low stock, micro-units. */
  reorderPointMicro: number;
  createdAt: Date;
  updatedAt: Date;
  version: number;
};

export type WarehouseDoc = TenantScope & {
  _id: ObjectId;
  name: string;
  code: string;
  normalizedCode: string;
  address: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/** Projection of the movement ledger. Only the stock service writes this collection. */
export type StockBalanceDoc = TenantScope & {
  _id: ObjectId;
  productId: ObjectId;
  warehouseId: ObjectId;
  onHandMicro: number;
  updatedAt: Date;
};

export type StockMovementType =
  | "receipt"
  | "issue"
  | "adjustment"
  | "transfer_out"
  | "transfer_in"
  | "production_consume"
  | "production_output";

export type StockMovementSourceType =
  | "manual"
  | "goods_receipt"
  | "transfer"
  | "work_order";

/** Append-only. Documents are never updated or deleted by the application. */
export type StockMovementDoc = TenantScope & {
  _id: ObjectId;
  productId: ObjectId;
  warehouseId: ObjectId;
  movementType: StockMovementType;
  /** Signed change in micro-units. */
  deltaMicro: number;
  sourceType: StockMovementSourceType;
  sourceId: ObjectId | null;
  reason: string;
  actorUserId: ObjectId;
  createdAt: Date;
};

export type SupplierDoc = TenantScope & {
  _id: ObjectId;
  name: string;
  normalizedName: string;
  email: string;
  phone: string;
  taxIdentifier: string;
  address: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type PurchaseOrderStatus =
  | "draft"
  | "approved"
  | "partially_received"
  | "received"
  | "cancelled";

export type PurchaseOrderLineSub = {
  _id: ObjectId;
  productId: ObjectId;
  sku: string;
  productName: string;
  unitOfMeasure: UnitOfMeasure;
  orderedMicro: number;
  receivedMicro: number;
  unitCostMilli: number;
  taxRateBps: number;
  lineSubtotalMilli: number;
  lineTaxMilli: number;
};

export type PurchaseOrderDoc = TenantScope & {
  _id: ObjectId;
  supplierId: ObjectId;
  supplierName: string;
  orderNumber: string;
  status: PurchaseOrderStatus;
  currencyCode: string;
  expectedDate: Date | null;
  notes: string;
  lines: PurchaseOrderLineSub[];
  /** Set only on orders created from a replenishment proposal. Unique per company (see indexes). */
  sourceReplenishmentProposalId?: ObjectId;
  subtotalMilli: number;
  taxMilli: number;
  totalMilli: number;
  createdBy: ObjectId;
  approvedBy: ObjectId | null;
  approvedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
};

export type GoodsReceiptStatus = "draft" | "posted" | "cancelled";

export type GoodsReceiptLineSub = {
  purchaseOrderLineId: ObjectId;
  productId: ObjectId;
  sku: string;
  productName: string;
  unitOfMeasure: UnitOfMeasure;
  quantityMicro: number;
};

export type GoodsReceiptDoc = TenantScope & {
  _id: ObjectId;
  purchaseOrderId: ObjectId;
  orderNumber: string;
  supplierId: ObjectId;
  supplierName: string;
  warehouseId: ObjectId;
  receiptNumber: string;
  status: GoodsReceiptStatus;
  lines: GoodsReceiptLineSub[];
  createdBy: ObjectId;
  postedBy: ObjectId | null;
  postedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
};

export type BomStatus = "draft" | "active" | "archived";

export type BomComponentSub = {
  productId: ObjectId;
  sku: string;
  productName: string;
  unitOfMeasure: UnitOfMeasure;
  /** Component quantity required per one unit of the finished product, micro-units. */
  quantityPerUnitMicro: number;
};

export type BomDoc = TenantScope & {
  _id: ObjectId;
  finishedProductId: ObjectId;
  finishedSku: string;
  finishedName: string;
  revision: number;
  status: BomStatus;
  components: BomComponentSub[];
  notes: string;
  createdBy: ObjectId;
  activatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
};

export type WorkOrderStatus = "draft" | "in_progress" | "completed" | "cancelled";

export type WorkOrderComponentSub = {
  productId: ObjectId;
  sku: string;
  productName: string;
  unitOfMeasure: UnitOfMeasure;
  /** Planned requirement, computed at creation from the BOM snapshot. Micro-units. */
  plannedMicro: number;
  /** Actual consumption, recorded at completion. Micro-units. */
  consumedMicro: number;
};

export type WorkOrderDoc = TenantScope & {
  _id: ObjectId;
  orderNumber: string;
  bomId: ObjectId;
  bomRevision: number;
  finishedProductId: ObjectId;
  finishedSku: string;
  finishedName: string;
  warehouseId: ObjectId;
  plannedQuantityMicro: number;
  producedQuantityMicro: number;
  status: WorkOrderStatus;
  components: WorkOrderComponentSub[];
  plannedStart: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  createdBy: ObjectId;
  completedBy: ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
};

export type ReplenishmentLineSub = {
  productId: ObjectId;
  sku: string;
  productName: string;
  unitOfMeasure: UnitOfMeasure;
  /** Facts at generation time (micro-units). */
  onHandMicro: number;
  reorderPointMicro: number;
  consumedMicro: number;
  /** Prediction derived from the facts above: average daily consumption over the lookback window. */
  forecastDailyUsageMicro: number;
  /** Recommendation: whole-unit shortfall to cover the horizon plus the reorder point. */
  suggestedMicro: number;
  /** Model-written explanation. Validated against the product list; null when unavailable. */
  rationale: string | null;
};

/**
 * Replenishment proposal. Proposals are advisory: they change no stock and create no order
 * until an authorised user converts them. `proposed` -> `converting` -> `converted` is claimed
 * with a conditional update, so a double click or retry cannot create two purchase orders.
 */
export type ReplenishmentProposalDoc = TenantScope & {
  _id: ObjectId;
  warehouseId: ObjectId;
  warehouseCode: string;
  status: "proposed" | "converting" | "converted";
  method: "trailing_consumption_v1";
  lookbackDays: number;
  horizonDays: number;
  /** True when more candidate products existed than the generation limit. */
  truncated: boolean;
  /** Count of lines with a positive suggestion. Stored so list queries can skip the lines array. */
  lineCount: number;
  rationaleStatus: "generated" | "partial" | "unavailable" | "invalid_output";
  rationaleProvider: string | null;
  rationaleModel: string | null;
  lines: ReplenishmentLineSub[];
  generatedBy: ObjectId;
  generatedAt: Date;
  /** Order reserved for the in-flight conversion. Written with the claim, so recovery can find it. */
  conversionOrderId?: ObjectId | null;
  /** When the current claim was taken. Recovery only releases claims older than its threshold. */
  claimedAt?: Date | null;
  convertedOrderId: ObjectId | null;
  convertedBy: ObjectId | null;
  convertedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
};

/**
 * AI Command Center persistence. Every document carries companyId; conversation, pending-action,
 * usage and notice documents also carry the owning userId. Only server/ai/data/* touches these
 * collections, and always through a scoped filter.
 */

export type AiSettingsDoc = TenantScope & {
  _id: ObjectId;
  enabled: boolean;
  retentionDays: number;
  /** Company-wide token ceiling per UTC day across all members. 0 means no company limit. */
  dailyTokenBudget: number;
  /** Default per-member token ceiling per UTC day when a grant sets none. 0 means no limit. */
  defaultUserDailyTokenCap: number;
  version: number;
  updatedBy: ObjectId;
  updatedAt: Date;
};

export type AiAccessGrantDoc = TenantScope & {
  _id: ObjectId;
  userId: ObjectId;
  enabled: boolean;
  modules: Partial<Record<AiModuleKey, AiModuleGrant>>;
  /** Owner-only flags, off by default. */
  canAuditTranscripts: boolean;
  canViewSensitiveHr: boolean;
  /** Per-member token ceiling per UTC day. null falls back to the company default. */
  dailyTokenCap: number | null;
  version: number;
  updatedBy: ObjectId;
  updatedAt: Date;
};

export type AiMessagePart =
  | { type: "text"; text: string }
  | { type: "tool_status"; tool: string; status: "running" | "done" | "failed"; summary?: string }
  | {
      type: "confirmation";
      actionId: string;
      tool: string;
      risk: AiRisk;
      summary: string;
      requiresTyped: boolean;
      typedPhrase: string | null;
      details: AiDiffRow[];
    }
  | AiRecordTablePart
  | AiRecordCardPart
  | AiFormPart
  | AiEntryChoicePart
  | AiDraftPromptPart
  | { type: "error"; code: string; message: string }
  | {
      type: "access_summary";
      state: string;
      modules: { module: AiModuleKey; operations: AiOperation[] }[];
      tokenCap: number;
      usedToday: number;
    };

/** One line of a before/after review, built on the server from the validated change. */
export type AiDiffRow = { label: string; before?: string; after: string };

export type AiBadge = { label: string; tone: "success" | "warning" | "error" | "neutral" | "info" };

/** A button on a row or card. The command and args are sent back to the server, which validates and re-authorises them. */
export type AiAction = { label: string; command: string; args: Record<string, string | number | boolean>; step?: "start" | "manual" | "select" | "draft" };

export type AiRecordTablePart = {
  type: "record_table";
  title: string;
  columns: { key: string; label: string; align?: "left" | "right" }[];
  rows: { id: string; cells: Record<string, string>; badge?: AiBadge; actions?: AiAction[] }[];
  total: number;
  emptyMessage: string;
  /** Next and previous page requests. */
  paging?: { page: number; totalPages: number; command: string; args: Record<string, string | number | boolean> };
};

export type AiRecordCardPart = {
  type: "record_card";
  title: string;
  subtitle?: string;
  badges?: AiBadge[];
  fields: { label: string; value: string }[];
  sections?: { title: string; rows: { label: string; value: string }[] }[];
  actions?: AiAction[];
};

/** One column of a line-item field (order lines, BOM components, receipt lines). */
export type AiLineColumn = {
  name: string;
  label: string;
  /** "readonly" shows a value the person cannot change (a product name, a remaining quantity). */
  kind: "text" | "select" | "readonly";
  options?: { value: string; label: string }[];
  placeholder?: string;
  align?: "right";
};

export type AiLinesSpec = {
  columns: AiLineColumn[];
  /** Rows come from the record (a receipt's order lines): none can be added or removed. */
  fixedRows?: boolean;
  addLabel?: string;
  maxRows: number;
  /** Adds a "fill all remaining" shortcut: copies column `from` into column `to` on every row. */
  fillRemaining?: { from: string; to: string };
};

export type AiFormField = {
  name: string;
  label: string;
  /** "lines": `value` is a JSON array of rows (objects of strings). */
  kind: "text" | "textarea" | "number" | "select" | "checkbox" | "lines";
  lines?: AiLinesSpec;
  required?: boolean;
  value?: string | boolean;
  hint?: string;
  placeholder?: string;
  options?: { value: string; label: string }[];
};

/** Where a draft value came from. Verified on the server; the model's own claim is never taken at face value. */
export type AiProvenance = "you" | "found" | "inferred" | "default";

/** Extra data on a form that an AI draft prefilled: provenance per field, open questions and, for edits, the original values. */
export type AiDraftMeta = {
  sourceText: string;
  /** The record being edited or acted on, when the command has one. */
  targetId?: string;
  provenance: Record<string, AiProvenance>;
  questions: { field?: string; question: string }[];
  /** Line-item fields: provenance per cell, one entry per row, in row order. */
  lineProvenance?: Record<string, Record<string, AiProvenance>[]>;
  /** Edits only: the record's values before any change. */
  original?: Record<string, string | boolean>;
  changed?: string[];
};

export type AiEntryChoicePart = {
  type: "entry_choice";
  title: string;
  description: string;
  command: string;
  /** Carried to either path, for example text typed after the command. */
  args: Record<string, string | number | boolean>;
  manual: { label: string; description: string };
  ai: { label: string; description: string };
  placeholder: string;
  examples: string[];
};

export type AiDraftPromptPart = {
  type: "draft_prompt";
  title: string;
  command: string;
  args: Record<string, string | number | boolean>;
  placeholder: string;
  examples: string[];
  submitLabel: string;
};

export type AiFormPart = {
  type: "form";
  title: string;
  description?: string;
  command: string;
  /** Sent back unchanged with the submitted values, for example the selected record id. */
  context: Record<string, string | number | boolean>;
  fields: AiFormField[];
  submitLabel: string;
  draft?: AiDraftMeta;
};

export type AiMessageDoc = {
  id: string;
  role: "user" | "assistant";
  parts: AiMessagePart[];
  createdAt: Date;
};

export type AiConversationDoc = TenantScope & {
  _id: ObjectId;
  userId: ObjectId;
  title: string;
  messages: AiMessageDoc[];
  messageCount: number;
  createdAt: Date;
  updatedAt: Date;
  /** TTL anchor: updatedAt plus the company's retention days. */
  expiresAt: Date;
};


export type AiPendingActionStatus = "pending" | "executing" | "executed" | "failed" | "cancelled" | "expired";

export type AiPendingActionDoc = TenantScope & {
  _id: ObjectId;
  userId: ObjectId;
  conversationId: ObjectId | null;
  toolName: string;
  module: AiModuleKey | "core";
  operation: AiOperation;
  risk: AiRisk;
  args: Record<string, unknown>;
  argsHash: string;
  /** Built on the server from the validated args. The model never writes this text. */
  summary: string;
  requiresTyped: boolean;
  typedPhrase: string | null;
  /** Server-computed facts the run step needs (current version, names). Hashed with args. */
  context: Record<string, unknown>;
  details: AiDiffRow[];
  grantVersion: number;
  status: AiPendingActionStatus;
  statusReason: string | null;
  createdAt: Date;
  expiresAt: Date;
  resolvedAt: Date | null;
};

export type AiUsageDoc = TenantScope & {
  _id: ObjectId;
  /** null on the company-wide row. */
  userId: ObjectId | null;
  /** UTC day, YYYY-MM-DD. */
  day: string;
  tokens: number;
  requests: number;
  toolCalls: number;
  errors: number;
  updatedAt: Date;
  /** Rows written after the retention change expire on their own (TTL). Older rows have none. */
  expiresAt?: Date;
};

/** Measured tokens per provider and model for one company and UTC day. Counters only. */
export type AiUsageModelDoc = TenantScope & {
  _id: ObjectId;
  day: string;
  provider: string;
  model: string;
  tokens: number;
  calls: number;
  updatedAt: Date;
  expiresAt: Date;
};

export type AiNoticeDoc = TenantScope & {
  _id: ObjectId;
  userId: ObjectId;
  kind: "transcript_audited";
  byUserId: ObjectId;
  conversationId: ObjectId;
  createdAt: Date;
  readAt: Date | null;
  /** TTL anchor. */
  expiresAt: Date;
};
