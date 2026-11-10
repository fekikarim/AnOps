import "server-only";
import { ObjectId, type Filter } from "mongodb";
import { MARKETING_COLLECTIONS, type CampaignDoc, type TemplateDoc } from "@/server/marketing/documents";
import type { MarketingChannel } from "@/features/marketing/types/constants";
import { recordAudit } from "@/server/audit/audit.service";
import type { WorkspaceContext } from "@/server/tenancy/workspace";
import { AppError } from "@/shared/lib/errors";
import type { TemplateInput } from "@/features/marketing/schemas/marketing.schema";
import { normalizeName } from "@/features/marketing/utils/normalize";
import { DEFAULT_EMAIL_DESIGN, normalizeEmailDesign, type EmailDesign } from "@/features/marketing/utils/email-design";
import { literalRegex, MARKETING_PAGE_SIZE, pageMeta, requireMarketing, scopeOf, skipOf, toObjectId } from "@/server/marketing/common";
import { PERMISSIONS } from "@/server/security/permissions";
import type { Paged } from "@/features/inventory/types";
import { isDuplicateKeyError } from "@/server/db/transactions";

export type TemplateDto = {
  id: string;
  name: string;
  channel: MarketingChannel;
  design: EmailDesign;
  subject: string;
  body: string;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

function toTemplateDto(doc: TemplateDoc): TemplateDto {
  return {
    id: doc._id.toHexString(),
    name: doc.name,
    channel: doc.channel,
    design: normalizeEmailDesign(doc.design),
    subject: doc.subject,
    body: doc.body,
    isActive: doc.isActive,
    version: doc.version,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

const DUPLICATE = () => new AppError("CONFLICT", "A template with this name already exists", { name: "A template with this name already exists" });

/** SMS templates never carry a subject or a design, whatever the client sent. */
function contentFor(input: TemplateInput) {
  return {
    design: input.channel === "email" ? input.design : DEFAULT_EMAIL_DESIGN,
    subject: input.channel === "email" ? input.subject.trim() : "",
    body: input.body.trim(),
  };
}

export async function listTemplates(
  ctx: WorkspaceContext,
  query: { q: string; channel: "all" | MarketingChannel; page: number }
): Promise<Paged<TemplateDto>> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_READ);
  const filter: Filter<TemplateDoc> = { ...scopeOf(ctx) };
  if (query.q) filter.normalizedName = { $regex: literalRegex(query.q.toLowerCase()) };
  if (query.channel !== "all") filter.channel = query.channel;
  const collection = ctx.db.collection<TemplateDoc>(MARKETING_COLLECTIONS.templates);
  const [total, docs] = await Promise.all([
    collection.countDocuments(filter),
    collection.find(filter).sort({ normalizedName: 1, _id: 1 }).skip(skipOf(query.page)).limit(MARKETING_PAGE_SIZE).toArray(),
  ]);
  return { items: docs.map(toTemplateDto), ...pageMeta(query.page, total) };
}

export async function getTemplate(ctx: WorkspaceContext, idRaw: string): Promise<TemplateDto> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_READ);
  const doc = await ctx.db
    .collection<TemplateDoc>(MARKETING_COLLECTIONS.templates)
    .findOne({ _id: toObjectId(idRaw), ...scopeOf(ctx) });
  if (!doc) throw new AppError("NOT_FOUND", "Template not found");
  return toTemplateDto(doc);
}

/** Active templates for a channel, used by the campaign editor. */
export async function templateOptions(ctx: WorkspaceContext, channel: MarketingChannel) {
  requireMarketing(ctx, PERMISSIONS.MARKETING_READ);
  const docs = await ctx.db
    .collection<TemplateDoc>(MARKETING_COLLECTIONS.templates)
    .find({ ...scopeOf(ctx), channel, isActive: true }, { projection: { name: 1, design: 1, subject: 1, body: 1, version: 1 } })
    .sort({ normalizedName: 1 })
    .limit(200)
    .toArray();
  return docs.map((doc) => ({
    id: doc._id.toHexString(),
    name: doc.name,
    design: normalizeEmailDesign(doc.design),
    subject: doc.subject,
    body: doc.body,
    version: doc.version,
  }));
}

export async function createTemplate(ctx: WorkspaceContext, input: TemplateInput): Promise<TemplateDto> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_TEMPLATE_MANAGE);
  const now = new Date();
  const doc: TemplateDoc = {
    _id: new ObjectId(),
    companyId: ctx.companyId,
    name: input.name.trim(),
    normalizedName: normalizeName(input.name),
    channel: input.channel,
    ...contentFor(input),
    isActive: input.isActive,
    version: 1,
    createdBy: ctx.userId,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await ctx.db.collection<TemplateDoc>(MARKETING_COLLECTIONS.templates).insertOne(doc);
  } catch (error) {
    if (isDuplicateKeyError(error)) throw DUPLICATE();
    throw error;
  }
  return toTemplateDto(doc);
}

/** Editing bumps the version. Campaigns keep the content they copied, so template edits never rewrite them. */
export async function updateTemplate(ctx: WorkspaceContext, idRaw: string, input: TemplateInput & { expectedVersion: number }): Promise<TemplateDto> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_TEMPLATE_MANAGE);
  const templateId = toObjectId(idRaw);
  const existing = await getTemplate(ctx, idRaw);
  if (input.channel !== existing.channel) {
    const usage = await ctx.db
      .collection<CampaignDoc>(MARKETING_COLLECTIONS.campaigns)
      .countDocuments({ ...scopeOf(ctx), templateId }, { limit: 1 });
    if (usage > 0) throw new AppError("CONFLICT", "The channel of a template that campaigns use cannot change");
  }
  try {
    const result = await ctx.db.collection<TemplateDoc>(MARKETING_COLLECTIONS.templates).findOneAndUpdate(
      { _id: templateId, ...scopeOf(ctx), version: input.expectedVersion },
      {
        $set: {
          name: input.name.trim(),
          normalizedName: normalizeName(input.name),
          channel: input.channel,
          ...contentFor(input),
          isActive: input.isActive,
          updatedAt: new Date(),
        },
        $inc: { version: 1 },
      },
      { returnDocument: "after" }
    );
    if (!result) throw new AppError("CONFLICT", "This template was changed by someone else. Reload and try again.");
    return toTemplateDto(result);
  } catch (error) {
    if (isDuplicateKeyError(error)) throw DUPLICATE();
    throw error;
  }
}

export async function duplicateTemplate(ctx: WorkspaceContext, idRaw: string): Promise<TemplateDto> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_TEMPLATE_MANAGE);
  const source = await getTemplate(ctx, idRaw);
  const name = `${source.name} (copy)`.slice(0, 120);
  return createTemplate(ctx, {
    name,
    channel: source.channel,
    design: source.design,
    subject: source.subject,
    body: source.body,
    isActive: false,
  });
}

export async function setTemplateActive(ctx: WorkspaceContext, idRaw: string, isActive: boolean, expectedVersion: number): Promise<TemplateDto> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_TEMPLATE_MANAGE);
  const result = await ctx.db.collection<TemplateDoc>(MARKETING_COLLECTIONS.templates).findOneAndUpdate(
    { _id: toObjectId(idRaw), ...scopeOf(ctx), version: expectedVersion },
    { $set: { isActive, updatedAt: new Date() }, $inc: { version: 1 } },
    { returnDocument: "after" }
  );
  if (!result) throw new AppError("CONFLICT", "This template was changed by someone else. Reload and try again.");
  return toTemplateDto(result);
}

export async function deleteTemplate(ctx: WorkspaceContext, idRaw: string): Promise<void> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_TEMPLATE_MANAGE);
  const templateId = toObjectId(idRaw);
  const used = await ctx.db
    .collection<CampaignDoc>(MARKETING_COLLECTIONS.campaigns)
    .countDocuments({ ...scopeOf(ctx), templateId }, { limit: 1 });
  if (used > 0) throw new AppError("CONFLICT", "Campaigns use this template. Deactivate it instead of deleting it.");
  const result = await ctx.db.collection<TemplateDoc>(MARKETING_COLLECTIONS.templates).deleteOne({ _id: templateId, ...scopeOf(ctx) });
  if (result.deletedCount === 0) throw new AppError("NOT_FOUND", "Template not found");
  await recordAudit(ctx.db, {
    companyId: ctx.companyId,
    actorUserId: ctx.userId,
    action: "marketing.template.deleted",
    entityType: "marketing_template",
    entityId: idRaw,
    requestId: ctx.requestId,
  });
}
