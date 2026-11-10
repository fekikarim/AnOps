import "server-only";
import { ObjectId, type Db, type Filter } from "mongodb";
import {
  MARKETING_COLLECTIONS,
  type AudienceDoc,
  type CampaignDoc,
  type CampaignSnapshotDoc,
  type DeliveryDoc,
  type DeliveryEventDoc,
  type ContactDoc,
  type JobDoc,
  type TemplateDoc,
} from "@/server/marketing/documents";
import type { CampaignStatus, DeliveryStatus, MarketingChannel } from "@/features/marketing/types/constants";
import { recordAudit } from "@/server/audit/audit.service";
import { withTransaction } from "@/server/db/transactions";
import type { WorkspaceContext } from "@/server/tenancy/workspace";
import { AppError } from "@/shared/lib/errors";
import type { CampaignInput, CampaignListQuery } from "@/features/marketing/schemas/marketing.schema";
import { isCampaignCancellable, isCampaignEditable } from "@/features/marketing/utils/campaign-state";
import { DEFAULT_EMAIL_DESIGN, normalizeEmailDesign, type EmailDesign } from "@/features/marketing/utils/email-design";
import {
  literalRegex,
  MARKETING_PAGE_SIZE,
  MAX_SCHEDULE_HORIZON_DAYS,
  pageMeta,
  requireMarketing,
  scopeOf,
  skipOf,
  toIso,
  toObjectId,
} from "@/server/marketing/common";
import { PERMISSIONS, type Permission } from "@/server/security/permissions";
import { env, getAppUrl, isLocalOnlyUrl } from "@/config/env";
import { enqueueJob, cancelQueuedJob } from "@/server/marketing/jobs";
import { getConfiguredProviders } from "@/server/marketing/providers";
import { buildRecipientSnapshot } from "@/server/marketing/campaign-snapshot";
import { isValidStoredRule } from "@/server/marketing/audience.service";
import { previewStoredRule, type AudiencePreviewDto } from "@/server/marketing/audience.service";
import type { Paged } from "@/features/inventory/types";

export type SnapshotDto = {
  takenAt: string;
  audienceName: string;
  matchedCount: number;
  eligibleCount: number;
  suppressedCount: number;
  exclusions: Record<string, number>;
};

export type CampaignActions = {
  canEdit: boolean;
  canSubmit: boolean;
  canReturn: boolean;
  canApprove: boolean;
  canSchedule: boolean;
  canCancel: boolean;
  canDelete: boolean;
  canDuplicate: boolean;
};

export type CampaignDto = {
  id: string;
  name: string;
  channel: MarketingChannel;
  status: CampaignStatus;
  audienceId: string;
  audienceName: string;
  templateId: string | null;
  templateName: string | null;
  templateVersion: number | null;
  design: EmailDesign;
  subject: string;
  body: string;
  contentVersion: number;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  failureCode: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  snapshot: SnapshotDto | null;
  /** Server-computed from permissions and state. The server re-checks every action regardless. */
  actions: CampaignActions;
};

export type CampaignDetailDto = CampaignDto & {
  deliverySummary: Record<DeliveryStatus, number>;
  job: { status: JobDoc["status"]; attempts: number; runAt: string; lastErrorCode: string | null } | null;
  recipientEstimate: AudiencePreviewDto | null;
};

export type DeliveryRowDto = {
  id: string;
  contactId: string;
  contactName: string;
  destinationMasked: string;
  status: DeliveryStatus;
  exclusionReason: string | null;
  attemptCount: number;
  lastErrorCode: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  bouncedAt: string | null;
  complainedAt: string | null;
  failedAt: string | null;
  firstOpenedAt: string | null;
  firstClickedAt: string | null;
};

export const DELIVERY_STATUS_ORDER: DeliveryStatus[] = ["pending", "sending", "sent", "delivered", "bounced", "complained", "failed", "suppressed"];

/** Shows enough of an address to recognise it, never the full value. */
export function maskDestination(channel: MarketingChannel, destination: string): string {
  if (channel === "sms") return destination.length <= 4 ? "••••" : `••••${destination.slice(-4)}`;
  const at = destination.indexOf("@");
  if (at <= 0) return "••••";
  return `${destination[0]}•••${destination.slice(at)}`;
}

function actionsFor(doc: CampaignDoc, permissions: ReadonlySet<Permission>, userId: ObjectId): CampaignActions {
  const status = doc.status;
  const manage = permissions.has(PERMISSIONS.MARKETING_CAMPAIGN_MANAGE);
  const approve = permissions.has(PERMISSIONS.MARKETING_CAMPAIGN_APPROVE);
  const dispatch = permissions.has(PERMISSIONS.MARKETING_CAMPAIGN_DISPATCH);
  const selfApproverOk = doc.createdBy.equals(userId) || doc.submittedBy?.equals(userId);
  return {
    canEdit: manage && isCampaignEditable(status),
    canSubmit: manage && status === "draft",
    canReturn: approve && status === "pending_approval",
    canApprove: approve && status === "pending_approval" && (!selfApproverOk || permissions.has(PERMISSIONS.MARKETING_CAMPAIGN_DISPATCH)),
    canSchedule: dispatch && status === "approved",
    canCancel:
      isCampaignCancellable(status) &&
      (status === "scheduled" ? dispatch : status === "approved" ? approve : manage),
    canDelete: manage && status === "draft",
    canDuplicate: manage,
  };
}

function toSnapshotDto(snapshot: CampaignSnapshotDoc | null): SnapshotDto | null {
  if (!snapshot) return null;
  return {
    takenAt: snapshot.takenAt.toISOString(),
    audienceName: snapshot.audienceName,
    matchedCount: snapshot.matchedCount,
    eligibleCount: snapshot.eligibleCount,
    suppressedCount: snapshot.suppressedCount,
    exclusions: snapshot.exclusions,
  };
}

function toCampaignDto(
  doc: CampaignDoc,
  ctx: WorkspaceContext,
  names: { audience: string; template: string | null }
): CampaignDto {
  return {
    id: doc._id.toHexString(),
    name: doc.name,
    channel: doc.channel,
    status: doc.status,
    audienceId: doc.audienceId.toHexString(),
    audienceName: names.audience,
    templateId: doc.templateId?.toHexString() ?? null,
    templateName: names.template,
    templateVersion: doc.templateVersion,
    design: normalizeEmailDesign(doc.design),
    subject: doc.subject,
    body: doc.body,
    contentVersion: doc.contentVersion,
    scheduledAt: toIso(doc.scheduledAt),
    startedAt: toIso(doc.startedAt),
    completedAt: toIso(doc.completedAt),
    cancelledAt: toIso(doc.cancelledAt),
    failureCode: doc.failureCode,
    submittedAt: toIso(doc.submittedAt),
    approvedAt: toIso(doc.approvedAt),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    version: doc.version,
    snapshot: toSnapshotDto(doc.snapshot),
    actions: actionsFor(doc, ctx.permissions, ctx.userId),
  };
}

async function namesFor(db: Db, scope: { companyId: ObjectId }, docs: CampaignDoc[]) {
  const audienceIds = [...new Set(docs.map((doc) => doc.audienceId.toHexString()))].map((id) => new ObjectId(id));
  const templateIds = [...new Set(docs.flatMap((doc) => (doc.templateId ? [doc.templateId.toHexString()] : [])))].map((id) => new ObjectId(id));
  const [audiences, templates] = await Promise.all([
    audienceIds.length === 0
      ? []
      : db.collection<AudienceDoc>(MARKETING_COLLECTIONS.audiences).find({ ...scope, _id: { $in: audienceIds } }, { projection: { name: 1 } }).toArray(),
    templateIds.length === 0
      ? []
      : db.collection<TemplateDoc>(MARKETING_COLLECTIONS.templates).find({ ...scope, _id: { $in: templateIds } }, { projection: { name: 1 } }).toArray(),
  ]);
  return {
    audience: new Map(audiences.map((row) => [row._id.toHexString(), row.name])),
    template: new Map(templates.map((row) => [row._id.toHexString(), row.name])),
  };
}

export async function listCampaigns(ctx: WorkspaceContext, query: CampaignListQuery): Promise<Paged<CampaignDto>> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_READ);
  const filter: Filter<CampaignDoc> = { ...scopeOf(ctx) };
  if (query.q) filter.name = { $regex: literalRegex(query.q), $options: "i" };
  if (query.status !== "all") filter.status = query.status;
  if (query.channel !== "all") filter.channel = query.channel;
  const collection = ctx.db.collection<CampaignDoc>(MARKETING_COLLECTIONS.campaigns);
  const [total, docs] = await Promise.all([
    collection.countDocuments(filter),
    collection.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skipOf(query.page)).limit(MARKETING_PAGE_SIZE).toArray(),
  ]);
  const names = await namesFor(ctx.db, scopeOf(ctx), docs);
  return {
    items: docs.map((doc) =>
      toCampaignDto(doc, ctx, {
        audience: names.audience.get(doc.audienceId.toHexString()) ?? "Deleted audience",
        template: doc.templateId ? names.template.get(doc.templateId.toHexString()) ?? null : null,
      })
    ),
    ...pageMeta(query.page, total),
  };
}

async function loadCampaign(db: Db, companyId: ObjectId, id: ObjectId): Promise<CampaignDoc> {
  const doc = await db.collection<CampaignDoc>(MARKETING_COLLECTIONS.campaigns).findOne({ _id: id, companyId });
  if (!doc) throw new AppError("NOT_FOUND", "Campaign not found");
  return doc;
}

/** Checks that an audience and (optionally) a template belong to this company and fit the channel. */
async function assertReferences(
  db: Db,
  scope: { companyId: ObjectId },
  input: { audienceId: ObjectId; templateId: ObjectId | null; channel: MarketingChannel }
): Promise<{ audience: AudienceDoc; template: TemplateDoc | null }> {
  const audience = await db.collection<AudienceDoc>(MARKETING_COLLECTIONS.audiences).findOne({ _id: input.audienceId, ...scope });
  if (!audience) throw new AppError("VALIDATION_ERROR", "Choose an audience from this company", { audienceId: "Choose an audience" });
  if (!audience.isActive) throw new AppError("VALIDATION_ERROR", "This audience is inactive. Activate it before using it.", { audienceId: "Audience is inactive" });
  if (!input.templateId) return { audience, template: null };
  const template = await db.collection<TemplateDoc>(MARKETING_COLLECTIONS.templates).findOne({ _id: input.templateId, ...scope });
  if (!template) throw new AppError("VALIDATION_ERROR", "Choose a template from this company", { templateId: "Choose a template" });
  if (template.channel !== input.channel) {
    throw new AppError("VALIDATION_ERROR", "The template channel does not match the campaign channel", { templateId: "Choose a template for this channel" });
  }
  if (!template.isActive) throw new AppError("VALIDATION_ERROR", "This template is inactive", { templateId: "Template is inactive" });
  return { audience, template };
}

export async function getCampaign(ctx: WorkspaceContext, idRaw: string): Promise<CampaignDetailDto> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_READ);
  const campaignId = toObjectId(idRaw);
  const doc = await loadCampaign(ctx.db, ctx.companyId, campaignId);
  const scope = scopeOf(ctx);
  const [names, grouped, job, audience] = await Promise.all([
    namesFor(ctx.db, scope, [doc]),
    ctx.db
      .collection<DeliveryDoc>(MARKETING_COLLECTIONS.deliveries)
      .aggregate<{ _id: DeliveryStatus; count: number }>([
        { $match: { ...scope, campaignId } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ])
      .toArray(),
    ctx.db
      .collection<JobDoc>(MARKETING_COLLECTIONS.jobs)
      .find({ ...scope, key: `campaign.dispatch:${idRaw}` }, { projection: { status: 1, attempts: 1, runAt: 1, lastErrorCode: 1 } })
      .limit(1)
      .next(),
    ctx.db.collection<AudienceDoc>(MARKETING_COLLECTIONS.audiences).findOne({ _id: doc.audienceId, ...scope }),
  ]);

  const deliverySummary = Object.fromEntries(DELIVERY_STATUS_ORDER.map((status) => [status, 0])) as Record<DeliveryStatus, number>;
  for (const row of grouped) deliverySummary[row._id] = row.count;

  const recipientEstimate =
    doc.status === "draft" && audience && isValidStoredRule(audience.selectionRule)
      ? await previewStoredRule(ctx.db, ctx.companyId, audience.selectionRule, doc.channel)
      : null;

  return {
    ...toCampaignDto(doc, ctx, {
      audience: names.audience.get(doc.audienceId.toHexString()) ?? "Deleted audience",
      template: doc.templateId ? names.template.get(doc.templateId.toHexString()) ?? null : null,
    }),
    deliverySummary,
    job: job ? { status: job.status, attempts: job.attempts, runAt: job.runAt.toISOString(), lastErrorCode: job.lastErrorCode } : null,
    recipientEstimate,
  };
}

export async function createCampaign(ctx: WorkspaceContext, input: CampaignInput): Promise<CampaignDto> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_CAMPAIGN_MANAGE);
  const templateId = input.templateId ? toObjectId(input.templateId) : null;
  const audienceId = toObjectId(input.audienceId);
  const { template } = await assertReferences(ctx.db, scopeOf(ctx), { audienceId, templateId, channel: input.channel });
  const now = new Date();
  const doc: CampaignDoc = {
    _id: new ObjectId(),
    companyId: ctx.companyId,
    name: input.name.trim(),
    channel: input.channel,
    status: "draft",
    audienceId,
    templateId,
    templateVersion: template?.version ?? null,
    design: input.channel === "email" ? input.design : DEFAULT_EMAIL_DESIGN,
    subject: input.channel === "email" ? input.subject.trim() : "",
    body: input.body.trim(),
    contentVersion: 1,
    snapshot: null,
    scheduledAt: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    failureCode: null,
    createdBy: ctx.userId,
    submittedBy: null,
    submittedAt: null,
    approvedBy: null,
    approvedAt: null,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
  await ctx.db.collection<CampaignDoc>(MARKETING_COLLECTIONS.campaigns).insertOne(doc);
  await recordAudit(ctx.db, {
    companyId: ctx.companyId,
    actorUserId: ctx.userId,
    action: "marketing.campaign.created",
    entityType: "marketing_campaign",
    entityId: doc._id.toHexString(),
    requestId: ctx.requestId,
    metadata: { channel: input.channel },
  });
  return toCampaignDto(doc, ctx, { audience: "", template: template?.name ?? null });
}

/** Editing is allowed only in draft. The version check rejects stale edits from a second browser tab. */
export async function updateCampaign(ctx: WorkspaceContext, idRaw: string, input: CampaignInput & { expectedVersion: number }): Promise<CampaignDto> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_CAMPAIGN_MANAGE);
  const campaignId = toObjectId(idRaw);
  const existing = await loadCampaign(ctx.db, ctx.companyId, campaignId);
  if (!isCampaignEditable(existing.status)) {
    throw new AppError("INVALID_TRANSITION", "Only draft campaigns can be edited. This campaign is locked.");
  }
  const templateId = input.templateId ? toObjectId(input.templateId) : null;
  const audienceId = toObjectId(input.audienceId);
  const { template } = await assertReferences(ctx.db, scopeOf(ctx), { audienceId, templateId, channel: input.channel });
  const result = await ctx.db.collection<CampaignDoc>(MARKETING_COLLECTIONS.campaigns).findOneAndUpdate(
    { _id: campaignId, companyId: ctx.companyId, status: "draft", version: input.expectedVersion },
    {
      $set: {
        name: input.name.trim(),
        channel: input.channel,
        audienceId,
        templateId,
        templateVersion: template?.version ?? null,
        design: input.channel === "email" ? input.design : DEFAULT_EMAIL_DESIGN,
        subject: input.channel === "email" ? input.subject.trim() : "",
        body: input.body.trim(),
        updatedAt: new Date(),
      },
      $inc: { contentVersion: 1, version: 1 },
    },
    { returnDocument: "after" }
  );
  if (!result) throw new AppError("CONFLICT", "This campaign was changed by someone else. Reload and try again.");
  return toCampaignDto(result, ctx, { audience: "", template: template?.name ?? null });
}

export async function duplicateCampaign(ctx: WorkspaceContext, idRaw: string): Promise<CampaignDto> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_CAMPAIGN_MANAGE);
  const source = await loadCampaign(ctx.db, ctx.companyId, toObjectId(idRaw));
  const now = new Date();
  const copy: CampaignDoc = {
    ...source,
    _id: new ObjectId(),
    name: `Copy of ${source.name}`.slice(0, 120),
    status: "draft",
    contentVersion: 1,
    snapshot: null,
    scheduledAt: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    failureCode: null,
    createdBy: ctx.userId,
    submittedBy: null,
    submittedAt: null,
    approvedBy: null,
    approvedAt: null,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
  await ctx.db.collection<CampaignDoc>(MARKETING_COLLECTIONS.campaigns).insertOne(copy);
  await recordAudit(ctx.db, {
    companyId: ctx.companyId,
    actorUserId: ctx.userId,
    action: "marketing.campaign.duplicated",
    entityType: "marketing_campaign",
    entityId: copy._id.toHexString(),
    requestId: ctx.requestId,
    metadata: { sourceId: idRaw },
  });
  return toCampaignDto(copy, ctx, { audience: "", template: null });
}

export async function deleteCampaign(ctx: WorkspaceContext, idRaw: string): Promise<void> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_CAMPAIGN_MANAGE);
  const campaignId = toObjectId(idRaw);
  const result = await ctx.db
    .collection<CampaignDoc>(MARKETING_COLLECTIONS.campaigns)
    .deleteOne({ _id: campaignId, companyId: ctx.companyId, status: "draft" });
  if (result.deletedCount === 0) {
    await loadCampaign(ctx.db, ctx.companyId, campaignId);
    throw new AppError("INVALID_TRANSITION", "Only draft campaigns can be deleted. Cancel the campaign instead.");
  }
  await recordAudit(ctx.db, {
    companyId: ctx.companyId,
    actorUserId: ctx.userId,
    action: "marketing.campaign.deleted",
    entityType: "marketing_campaign",
    entityId: idRaw,
    requestId: ctx.requestId,
  });
}

/** Moves a draft into review. The content is locked from this point until it is approved or returned. */
export async function submitCampaign(ctx: WorkspaceContext, idRaw: string, expectedVersion: number): Promise<void> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_CAMPAIGN_MANAGE);
  const campaignId = toObjectId(idRaw);
  const doc = await loadCampaign(ctx.db, ctx.companyId, campaignId);
  await assertReferences(ctx.db, scopeOf(ctx), { audienceId: doc.audienceId, templateId: null, channel: doc.channel });
  const now = new Date();
  const result = await ctx.db.collection<CampaignDoc>(MARKETING_COLLECTIONS.campaigns).updateOne(
    { _id: campaignId, companyId: ctx.companyId, status: "draft", version: expectedVersion },
    { $set: { status: "pending_approval", submittedBy: ctx.userId, submittedAt: now, updatedAt: now }, $inc: { version: 1 } }
  );
  if (result.matchedCount === 0) throw new AppError("CONFLICT", "This campaign changed. Reload before submitting.");
  await recordAudit(ctx.db, {
    companyId: ctx.companyId,
    actorUserId: ctx.userId,
    action: "marketing.campaign.submitted",
    entityType: "marketing_campaign",
    entityId: idRaw,
    requestId: ctx.requestId,
  });
}

export async function returnCampaign(ctx: WorkspaceContext, idRaw: string, expectedVersion: number): Promise<void> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_CAMPAIGN_APPROVE);
  const campaignId = toObjectId(idRaw);
  const now = new Date();
  const result = await ctx.db.collection<CampaignDoc>(MARKETING_COLLECTIONS.campaigns).updateOne(
    { _id: campaignId, companyId: ctx.companyId, status: "pending_approval", version: expectedVersion },
    { $set: { status: "draft", updatedAt: now }, $inc: { version: 1 } }
  );
  if (result.matchedCount === 0) throw new AppError("CONFLICT", "This campaign changed. Reload and try again.");
  await recordAudit(ctx.db, {
    companyId: ctx.companyId,
    actorUserId: ctx.userId,
    action: "marketing.campaign.returned",
    entityType: "marketing_campaign",
    entityId: idRaw,
    requestId: ctx.requestId,
  });
}

/**
 * Approves a campaign and freezes its recipients. The creator or submitter cannot approve their own
 * campaign unless they also hold dispatch rights (the owner in practice). That exception is recorded in
 * the audit metadata.
 */
export async function approveCampaign(ctx: WorkspaceContext, idRaw: string, expectedVersion: number): Promise<CampaignDto> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_CAMPAIGN_APPROVE);
  const campaignId = toObjectId(idRaw);
  const doc = await loadCampaign(ctx.db, ctx.companyId, campaignId);
  if (doc.status !== "pending_approval" || doc.version !== expectedVersion) {
    throw new AppError("CONFLICT", "This campaign is no longer waiting for approval. Reload and try again.");
  }
  const selfApproval = doc.createdBy.equals(ctx.userId) || (doc.submittedBy?.equals(ctx.userId) ?? false);
  if (selfApproval && !ctx.permissions.has(PERMISSIONS.MARKETING_CAMPAIGN_DISPATCH)) {
    throw new AppError("FORBIDDEN", "Another team member must approve this campaign.");
  }

  const audience = await ctx.db.collection<AudienceDoc>(MARKETING_COLLECTIONS.audiences).findOne({ _id: doc.audienceId, ...scopeOf(ctx) });
  if (!audience || !audience.isActive) {
    throw new AppError("VALIDATION_ERROR", "The audience is missing or inactive. Fix it before approving.");
  }
  const now = new Date();
  // The snapshot is rebuilt idempotently. A failed approval leaves no approved state behind.
  const snapshot = await buildRecipientSnapshot(ctx.db, doc, audience, now);

  const result = await ctx.db.collection<CampaignDoc>(MARKETING_COLLECTIONS.campaigns).findOneAndUpdate(
    { _id: campaignId, companyId: ctx.companyId, status: "pending_approval", version: expectedVersion },
    {
      $set: { status: "approved", snapshot, approvedBy: ctx.userId, approvedAt: now, updatedAt: now },
      $inc: { version: 1 },
    },
    { returnDocument: "after" }
  );
  if (!result) throw new AppError("CONFLICT", "This campaign changed while it was being approved. Reload and try again.");
  await recordAudit(ctx.db, {
    companyId: ctx.companyId,
    actorUserId: ctx.userId,
    action: "marketing.campaign.approved",
    entityType: "marketing_campaign",
    entityId: idRaw,
    requestId: ctx.requestId,
    metadata: { eligible: snapshot.eligibleCount, suppressed: snapshot.suppressedCount, selfApproval },
  });
  const names = await namesFor(ctx.db, scopeOf(ctx), [result]);
  return toCampaignDto(result, ctx, {
    audience: names.audience.get(result.audienceId.toHexString()) ?? audience.name,
    template: result.templateId ? names.template.get(result.templateId.toHexString()) ?? null : null,
  });
}

/**
 * Schedules an approved campaign. The job row and the status change are written in one transaction, so
 * a scheduled campaign always has a job and a job never exists for an unscheduled campaign.
 */
export async function scheduleCampaign(ctx: WorkspaceContext, idRaw: string, scheduledAtRaw: string, expectedVersion: number): Promise<void> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_CAMPAIGN_DISPATCH);
  const campaignId = toObjectId(idRaw);
  const doc = await loadCampaign(ctx.db, ctx.companyId, campaignId);
  if (doc.status !== "approved") {
    throw new AppError("INVALID_TRANSITION", "Only approved campaigns can be scheduled.");
  }
  if (!getConfiguredProviders()[doc.channel]) {
    throw new AppError(
      "PROVIDER_NOT_CONFIGURED",
      doc.channel === "email"
        ? "Email delivery is not configured. Connect an email provider before scheduling campaigns."
        : "SMS delivery is not configured. Connect an SMS provider before scheduling campaigns."
    );
  }
  // Every campaign email carries an unsubscribe link. In production that link must be reachable
  // from outside this machine; otherwise the recipient cannot opt out.
  if (doc.channel === "email" && env.NODE_ENV === "production" && isLocalOnlyUrl(getAppUrl())) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Set APP_URL to the public address of this deployment (for example https://app.example.com) before scheduling email campaigns. Unsubscribe links would otherwise point at a local address."
    );
  }
  const now = new Date();
  const runAt = resolveScheduledAt(scheduledAtRaw, now);

  await withTransaction(ctx.db, async (tx) => {
    const result = await ctx.db.collection<CampaignDoc>(MARKETING_COLLECTIONS.campaigns).updateOne(
      { _id: campaignId, companyId: ctx.companyId, status: "approved", version: expectedVersion },
      { $set: { status: "scheduled", scheduledAt: runAt, updatedAt: now }, $inc: { version: 1 } },
      { session: tx.session }
    );
    if (result.matchedCount === 0) {
      throw new AppError("CONFLICT", "This campaign changed. Reload before scheduling.");
    }
    await enqueueJob(
      ctx.db,
      {
        companyId: ctx.companyId,
        type: "campaign.dispatch",
        targetId: campaignId,
        key: `campaign.dispatch:${idRaw}`,
        runAt,
      },
      tx.session
    );
    await recordAudit(
      ctx.db,
      {
        companyId: ctx.companyId,
        actorUserId: ctx.userId,
        action: "marketing.campaign.scheduled",
        entityType: "marketing_campaign",
        entityId: idRaw,
        requestId: ctx.requestId,
        metadata: { sendNow: scheduledAtRaw === "" },
      },
      tx
    );
  });
}

export function resolveScheduledAt(raw: string, now: Date): Date {
  if (raw.trim() === "") return now;
  const time = Date.parse(raw);
  if (Number.isNaN(time)) throw new AppError("VALIDATION_ERROR", "Choose a valid date and time", { scheduledAt: "Choose a valid date and time" });
  if (time < now.getTime() - 60_000) {
    throw new AppError("VALIDATION_ERROR", "Choose a time in the future", { scheduledAt: "Choose a time in the future" });
  }
  if (time > now.getTime() + MAX_SCHEDULE_HORIZON_DAYS * 86_400_000) {
    throw new AppError("VALIDATION_ERROR", `Schedule up to ${MAX_SCHEDULE_HORIZON_DAYS} days ahead`, { scheduledAt: "Too far in the future" });
  }
  return new Date(Math.max(time, now.getTime()));
}

/** Cancels a campaign. Once dispatch has started (status processing) cancellation is refused. */
export async function cancelCampaign(ctx: WorkspaceContext, idRaw: string, expectedVersion: number): Promise<void> {
  const campaignId = toObjectId(idRaw);
  const doc = await loadCampaign(ctx.db, ctx.companyId, campaignId);
  const permission =
    doc.status === "scheduled" ? PERMISSIONS.MARKETING_CAMPAIGN_DISPATCH : doc.status === "approved" ? PERMISSIONS.MARKETING_CAMPAIGN_APPROVE : PERMISSIONS.MARKETING_CAMPAIGN_MANAGE;
  requireMarketing(ctx, permission);
  if (!isCampaignCancellable(doc.status)) {
    throw new AppError("INVALID_TRANSITION", "This campaign can no longer be cancelled.");
  }
  const now = new Date();
  await withTransaction(ctx.db, async (tx) => {
    const result = await ctx.db.collection<CampaignDoc>(MARKETING_COLLECTIONS.campaigns).updateOne(
      { _id: campaignId, companyId: ctx.companyId, status: doc.status, version: expectedVersion },
      { $set: { status: "cancelled", cancelledAt: now, updatedAt: now }, $inc: { version: 1 } },
      { session: tx.session }
    );
    if (result.matchedCount === 0) {
      throw new AppError("CONFLICT", "Sending may have started, or the campaign changed. Reload and check its status.");
    }
    if (doc.status === "scheduled") {
      await cancelQueuedJob(ctx.db, ctx.companyId, `campaign.dispatch:${idRaw}`, tx.session);
    }
    await recordAudit(
      ctx.db,
      {
        companyId: ctx.companyId,
        actorUserId: ctx.userId,
        action: "marketing.campaign.cancelled",
        entityType: "marketing_campaign",
        entityId: idRaw,
        requestId: ctx.requestId,
        metadata: { fromStatus: doc.status },
      },
      tx
    );
  });
}

export async function listDeliveries(
  ctx: WorkspaceContext,
  campaignIdRaw: string,
  query: { status: "all" | DeliveryStatus; page: number }
): Promise<Paged<DeliveryRowDto>> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_READ);
  const campaignId = toObjectId(campaignIdRaw);
  const campaign = await loadCampaign(ctx.db, ctx.companyId, campaignId);
  const scope = scopeOf(ctx);
  const filter: Filter<DeliveryDoc> = { ...scope, campaignId: campaign._id };
  if (query.status !== "all") filter.status = query.status;
  const collection = ctx.db.collection<DeliveryDoc>(MARKETING_COLLECTIONS.deliveries);
  const [total, rows] = await Promise.all([
    collection.countDocuments(filter),
    collection.find(filter).sort({ _id: 1 }).skip(skipOf(query.page)).limit(MARKETING_PAGE_SIZE).toArray(),
  ]);
  const contacts = await ctx.db
    .collection<ContactDoc>(MARKETING_COLLECTIONS.contacts)
    .find({ ...scope, _id: { $in: rows.map((row) => row.contactId) } }, { projection: { firstName: 1, lastName: 1 } })
    .toArray();
  const names = new Map(contacts.map((contact) => [contact._id.toHexString(), `${contact.firstName} ${contact.lastName}`.trim()]));
  return {
    items: rows.map((row) => ({
      id: row._id.toHexString(),
      contactId: row.contactId.toHexString(),
      contactName: names.get(row.contactId.toHexString()) ?? "Deleted contact",
      destinationMasked: maskDestination(row.channel, row.destination),
      status: row.status,
      exclusionReason: row.exclusionReason,
      attemptCount: row.attemptCount,
      lastErrorCode: row.lastErrorCode,
      sentAt: toIso(row.sentAt),
      deliveredAt: toIso(row.deliveredAt),
      bouncedAt: toIso(row.bouncedAt),
      complainedAt: toIso(row.complainedAt),
      failedAt: toIso(row.failedAt),
      firstOpenedAt: toIso(row.firstOpenedAt),
      firstClickedAt: toIso(row.firstClickedAt),
    })),
    ...pageMeta(query.page, total),
  };
}

export async function listCampaignEvents(ctx: WorkspaceContext, campaignIdRaw: string) {
  requireMarketing(ctx, PERMISSIONS.MARKETING_READ);
  const campaignId = toObjectId(campaignIdRaw);
  await loadCampaign(ctx.db, ctx.companyId, campaignId);
  const events = await ctx.db
    .collection<DeliveryEventDoc>(MARKETING_COLLECTIONS.deliveryEvents)
    .find({ ...scopeOf(ctx), campaignId })
    .sort({ occurredAt: -1, _id: -1 })
    .limit(100)
    .toArray();
  return events.map((event) => ({
    id: event._id.toHexString(),
    type: event.type,
    providerName: event.providerName,
    occurredAt: event.occurredAt.toISOString(),
    deliveryId: event.deliveryId.toHexString(),
  }));
}

