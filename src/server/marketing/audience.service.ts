import "server-only";
import { ObjectId, type Db, type Filter } from "mongodb";
import {
  MARKETING_COLLECTIONS,
  type AudienceDoc,
  type AudienceRuleDoc,
  type CampaignDoc,
  type ConsentStateDoc,
  type ContactDoc,
} from "@/server/marketing/documents";
import type { LifecycleStage, MarketingChannel } from "@/features/marketing/types/constants";
import { recordAudit } from "@/server/audit/audit.service";
import type { WorkspaceContext } from "@/server/tenancy/workspace";
import { AppError } from "@/shared/lib/errors";
import type { AudienceInput, AudienceRuleInput } from "@/features/marketing/schemas/marketing.schema";
import { audienceRuleSchema } from "@/features/marketing/schemas/marketing.schema";
import { normalizeName } from "@/features/marketing/utils/normalize";
import {
  EVALUATION_BATCH_SIZE,
  literalRegex,
  MARKETING_PAGE_SIZE,
  MAX_EVALUATED_CONTACTS,
  pageMeta,
  requireMarketing,
  scopeOf,
  skipOf,
  toObjectId,
} from "@/server/marketing/common";
import { contactTagIdsFor } from "@/server/marketing/tag-filter";
import { evaluateEligibility, EXCLUSION_REASONS, type ExclusionReason } from "@/server/marketing/eligibility";
import { PERMISSIONS } from "@/server/security/permissions";
import type { Paged } from "@/features/inventory/types";

export type AudienceDto = {
  id: string;
  name: string;
  description: string;
  /** Null when a legacy or damaged document has no usable rule. Such an audience cannot be approved. */
  rule: AudienceRuleInput | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type AudiencePreviewDto = {
  channel: MarketingChannel;
  matchedCount: number;
  evaluatedCount: number;
  truncated: boolean;
  eligibleCount: number;
  exclusions: Record<ExclusionReason, number>;
  sample: { id: string; name: string; email: string; lifecycleStage: LifecycleStage; reason: ExclusionReason | null }[];
};

/** Converts the validated rule into its stored form (ObjectIds and Dates). */
export function toStoredRule(rule: AudienceRuleInput): AudienceRuleDoc {
  return {
    match: rule.match,
    conditions: rule.conditions.map((condition) => {
      switch (condition.type) {
        case "tags":
          return { type: "tags", tagIds: condition.tagIds.map((id) => new ObjectId(id)), match: condition.match };
        case "created_after":
          return { type: "created_after", date: new Date(`${condition.date}T00:00:00.000Z`) };
        default:
          return condition;
      }
    }) as AudienceRuleDoc["conditions"],
  };
}

export function fromStoredRule(rule: AudienceRuleDoc): AudienceRuleInput {
  return {
    match: rule.match,
    conditions: rule.conditions.map((condition) => {
      switch (condition.type) {
        case "tags":
          return { type: "tags", tagIds: condition.tagIds.map((id) => id.toHexString()), match: condition.match };
        case "created_after":
          return { type: "created_after", date: condition.date.toISOString().slice(0, 10) };
        default:
          return condition;
      }
    }) as AudienceRuleInput["conditions"],
  };
}

/**
 * Converts a stored rule for display, returning null when the document is missing fields or no longer
 * satisfies the current rule schema. A list page must never crash because one legacy row is malformed,
 * and a malformed rule must never be treated as "match everything".
 */
export function safeFromStoredRule(rule: AudienceRuleDoc | null | undefined): AudienceRuleInput | null {
  if (!rule || typeof rule !== "object" || !Array.isArray(rule.conditions)) return null;
  if (rule.match !== "all" && rule.match !== "any") return null;
  try {
    const input = fromStoredRule(rule);
    return audienceRuleSchema.safeParse(input).success ? input : null;
  } catch {
    return null;
  }
}

export function isValidStoredRule(rule: AudienceRuleDoc | null | undefined): boolean {
  return safeFromStoredRule(rule) !== null;
}

/**
 * Compiles a stored rule into a contact filter. Only typed clauses are produced. Rule values never become
 * operators, so a crafted rule cannot inject a query. The filter is always scoped to the company.
 */
export async function compileAudienceFilter(
  db: Db,
  companyId: ObjectId,
  rule: AudienceRuleDoc
): Promise<Filter<ContactDoc>> {
  if (!isValidStoredRule(rule)) {
    throw new AppError(
      "VALIDATION_ERROR",
      "This audience has no valid selection rule. Open it, save a rule, then try again."
    );
  }
  const scope = { companyId };
  const clauses: Filter<ContactDoc>[] = [];
  for (const condition of rule.conditions) {
    switch (condition.type) {
      case "lifecycle_stage":
        clauses.push({ lifecycleStage: { $in: condition.values } });
        break;
      case "source":
        clauses.push({ source: { $in: condition.values } });
        break;
      case "active":
        clauses.push({ isActive: condition.value });
        break;
      case "created_after":
        clauses.push({ createdAt: { $gte: condition.date } });
        break;
      case "tags": {
        const ids = await contactTagIdsFor(db, scope, condition.tagIds, condition.match);
        clauses.push({ _id: { $in: ids } });
        break;
      }
      case "consent": {
        const granted = await grantedContactIds(db, companyId, condition.channel);
        clauses.push(condition.status === "granted" ? { _id: { $in: granted } } : { _id: { $nin: granted } });
        break;
      }
    }
  }
  const combined = rule.match === "all" ? { $and: clauses } : { $or: clauses };
  return { companyId, ...combined } as Filter<ContactDoc>;
}

async function grantedContactIds(db: Db, companyId: ObjectId, channel: MarketingChannel): Promise<ObjectId[]> {
  const rows = await db
    .collection<ConsentStateDoc>(MARKETING_COLLECTIONS.consentStates)
    .find({ companyId, channel, purpose: "marketing", status: "granted" }, { projection: { contactId: 1 } })
    .limit(MAX_EVALUATED_CONTACTS + 1)
    .toArray();
  if (rows.length > MAX_EVALUATED_CONTACTS) {
    throw new AppError("VALIDATION_ERROR", "Too many contacts have consent for this rule. Narrow the audience.");
  }
  return rows.map((row) => row.contactId);
}

type EvaluatedContact = Pick<ContactDoc, "_id" | "firstName" | "lastName" | "email" | "normalizedEmail" | "phone" | "isActive" | "lifecycleStage">;

/**
 * Walks the matching contacts in _id order, in fixed-size batches, up to `limit`. Callers receive batches
 * and never the whole result set. Returns how many contacts were visited.
 */
export async function forEachMatchingContact(
  db: Db,
  filter: Filter<ContactDoc>,
  limit: number,
  handle: (batch: EvaluatedContact[]) => Promise<void>
): Promise<number> {
  const cursor = db
    .collection<ContactDoc>(MARKETING_COLLECTIONS.contacts)
    .find(filter, {
      projection: { firstName: 1, lastName: 1, email: 1, normalizedEmail: 1, phone: 1, isActive: 1, lifecycleStage: 1 },
    })
    .sort({ _id: 1 })
    .limit(limit)
    .batchSize(EVALUATION_BATCH_SIZE);
  let batch: EvaluatedContact[] = [];
  let visited = 0;
  for await (const contact of cursor) {
    batch.push(contact);
    visited += 1;
    if (batch.length === EVALUATION_BATCH_SIZE) {
      await handle(batch);
      batch = [];
    }
  }
  if (batch.length > 0) await handle(batch);
  return visited;
}

export async function previewAudience(
  ctx: WorkspaceContext,
  rule: AudienceRuleInput,
  channel: MarketingChannel
): Promise<AudiencePreviewDto> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_READ);
  return previewStoredRule(ctx.db, ctx.companyId, toStoredRule(rule), channel);
}

export async function previewStoredRule(
  db: Db,
  companyId: ObjectId,
  rule: AudienceRuleDoc,
  channel: MarketingChannel
): Promise<AudiencePreviewDto> {
  const filter = await compileAudienceFilter(db, companyId, rule);
  const matchedCount = await db
    .collection<ContactDoc>(MARKETING_COLLECTIONS.contacts)
    .countDocuments(filter, { limit: MAX_EVALUATED_CONTACTS + 1 });
  const exclusions = Object.fromEntries(EXCLUSION_REASONS.map((reason) => [reason, 0])) as Record<ExclusionReason, number>;
  const sample: AudiencePreviewDto["sample"] = [];
  let eligibleCount = 0;

  const evaluated = await forEachMatchingContact(db, filter, MAX_EVALUATED_CONTACTS, async (batch) => {
    const results = await evaluateEligibility(db, companyId, channel, batch);
    for (const contact of batch) {
      const result = results.get(contact._id.toHexString());
      if (!result) continue;
      if (result.eligible) eligibleCount += 1;
      else if (result.reason) exclusions[result.reason] += 1;
      if (sample.length < 20) {
        sample.push({
          id: contact._id.toHexString(),
          name: `${contact.firstName} ${contact.lastName}`.trim(),
          email: contact.normalizedEmail ?? "",
          lifecycleStage: contact.lifecycleStage,
          reason: result.reason,
        });
      }
    }
  });

  return {
    channel,
    matchedCount: Math.min(matchedCount, MAX_EVALUATED_CONTACTS),
    evaluatedCount: evaluated,
    truncated: matchedCount > MAX_EVALUATED_CONTACTS,
    eligibleCount,
    exclusions,
    sample,
  };
}

function toAudienceDto(doc: AudienceDoc): AudienceDto {
  return {
    id: doc._id.toHexString(),
    name: doc.name,
    description: doc.description,
    rule: safeFromStoredRule(doc.selectionRule),
    isActive: doc.isActive,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: (doc.updatedAt ?? doc.createdAt).toISOString(),
    version: doc.version ?? 1,
  };
}

export async function listAudiences(
  ctx: WorkspaceContext,
  query: { q: string; active: "all" | "true" | "false"; page: number }
): Promise<Paged<AudienceDto>> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_READ);
  const filter: Filter<AudienceDoc> = { ...scopeOf(ctx) };
  if (query.q) filter.normalizedName = { $regex: literalRegex(query.q.toLowerCase()) };
  if (query.active !== "all") filter.isActive = query.active === "true";
  const collection = ctx.db.collection<AudienceDoc>(MARKETING_COLLECTIONS.audiences);
  const [total, docs] = await Promise.all([
    collection.countDocuments(filter),
    collection.find(filter).sort({ normalizedName: 1, _id: 1 }).skip(skipOf(query.page)).limit(MARKETING_PAGE_SIZE).toArray(),
  ]);
  return { items: docs.map(toAudienceDto), ...pageMeta(query.page, total) };
}

export async function getAudience(ctx: WorkspaceContext, idRaw: string): Promise<AudienceDto> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_READ);
  const doc = await ctx.db
    .collection<AudienceDoc>(MARKETING_COLLECTIONS.audiences)
    .findOne({ _id: toObjectId(idRaw), ...scopeOf(ctx) });
  if (!doc) throw new AppError("NOT_FOUND", "Audience not found");
  return toAudienceDto(doc);
}

export async function audienceOptions(ctx: WorkspaceContext): Promise<{ id: string; name: string; isActive: boolean }[]> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_READ);
  const docs = await ctx.db
    .collection<AudienceDoc>(MARKETING_COLLECTIONS.audiences)
    .find(scopeOf(ctx), { projection: { name: 1, isActive: 1 } })
    .sort({ normalizedName: 1 })
    .limit(500)
    .toArray();
  return docs.map((doc) => ({ id: doc._id.toHexString(), name: doc.name, isActive: doc.isActive }));
}

export async function createAudience(ctx: WorkspaceContext, input: AudienceInput): Promise<AudienceDto> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_AUDIENCE_MANAGE);
  await assertTagsInCompany(ctx.db, ctx, input.rule);
  const now = new Date();
  const doc: AudienceDoc = {
    _id: new ObjectId(),
    companyId: ctx.companyId,
    name: input.name.trim(),
    normalizedName: normalizeName(input.name),
    description: input.description,
    selectionRule: toStoredRule(input.rule),
    isActive: input.isActive,
    createdBy: ctx.userId,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
  try {
    await ctx.db.collection<AudienceDoc>(MARKETING_COLLECTIONS.audiences).insertOne(doc);
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      throw new AppError("CONFLICT", "An audience with this name already exists", { name: "An audience with this name already exists" });
    }
    throw error;
  }
  return toAudienceDto(doc);
}

export async function updateAudience(ctx: WorkspaceContext, idRaw: string, input: AudienceInput & { expectedVersion: number }): Promise<AudienceDto> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_AUDIENCE_MANAGE);
  const audienceId = toObjectId(idRaw);
  await assertTagsInCompany(ctx.db, ctx, input.rule);
  try {
    const result = await ctx.db.collection<AudienceDoc>(MARKETING_COLLECTIONS.audiences).findOneAndUpdate(
      { _id: audienceId, ...scopeOf(ctx), version: input.expectedVersion },
      {
        $set: {
          name: input.name.trim(),
          normalizedName: normalizeName(input.name),
          description: input.description,
          selectionRule: toStoredRule(input.rule),
          isActive: input.isActive,
          updatedAt: new Date(),
        },
        $inc: { version: 1 },
      },
      { returnDocument: "after" }
    );
    if (!result) {
      await getAudience(ctx, idRaw);
      throw new AppError("CONFLICT", "This audience was changed by someone else. Reload and try again.");
    }
    return toAudienceDto(result);
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      throw new AppError("CONFLICT", "An audience with this name already exists", { name: "An audience with this name already exists" });
    }
    throw error;
  }
}

/** Audiences with campaign history cannot be deleted, so the recipients of past campaigns stay explainable. */
export async function deleteAudience(ctx: WorkspaceContext, idRaw: string): Promise<void> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_AUDIENCE_MANAGE);
  const audienceId = toObjectId(idRaw);
  const referenced = await ctx.db
    .collection<CampaignDoc>(MARKETING_COLLECTIONS.campaigns)
    .countDocuments({ ...scopeOf(ctx), audienceId }, { limit: 1 });
  if (referenced > 0) {
    throw new AppError("CONFLICT", "This audience is used by a campaign. Deactivate it instead of deleting it.");
  }
  const result = await ctx.db
    .collection<AudienceDoc>(MARKETING_COLLECTIONS.audiences)
    .deleteOne({ _id: audienceId, ...scopeOf(ctx) });
  if (result.deletedCount === 0) throw new AppError("NOT_FOUND", "Audience not found");
  await recordAudit(ctx.db, {
    companyId: ctx.companyId,
    actorUserId: ctx.userId,
    action: "marketing.audience.deleted",
    entityType: "marketing_audience",
    entityId: idRaw,
    requestId: ctx.requestId,
  });
}

/** Rules may only reference tags of the same company. */
async function assertTagsInCompany(db: Db, ctx: WorkspaceContext, rule: AudienceRuleInput): Promise<void> {
  const ids = rule.conditions.flatMap((condition) => (condition.type === "tags" ? condition.tagIds : []));
  if (ids.length === 0) return;
  const unique = [...new Set(ids)];
  const found = await db
    .collection(MARKETING_COLLECTIONS.tags)
    .countDocuments({ ...scopeOf(ctx), _id: { $in: unique.map((id) => new ObjectId(id)) } });
  if (found !== unique.length) {
    throw new AppError("VALIDATION_ERROR", "One of the selected tags does not exist in this company");
  }
}

