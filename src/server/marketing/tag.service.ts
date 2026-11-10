import "server-only";
import { ObjectId, type Db } from "mongodb";
import { MARKETING_COLLECTIONS, type AudienceDoc, type ContactDoc, type ContactTagDoc, type TagDoc } from "@/server/marketing/documents";
import { recordAudit } from "@/server/audit/audit.service";
import { withTransaction, isDuplicateKeyError } from "@/server/db/transactions";
import type { WorkspaceContext } from "@/server/tenancy/workspace";
import { AppError } from "@/shared/lib/errors";
import type { TagInput } from "@/features/marketing/schemas/marketing.schema";
import { normalizeName } from "@/features/marketing/utils/normalize";
import { requireMarketing, scopeOf, toObjectId } from "@/server/marketing/common";
import { PERMISSIONS } from "@/server/security/permissions";

export type TagDto = { id: string; name: string; color: string; contactCount: number; createdAt: string; updatedAt: string };

function toTagDto(doc: TagDoc, contactCount: number): TagDto {
  return {
    id: doc._id.toHexString(),
    name: doc.name,
    color: doc.color,
    contactCount,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

const DUPLICATE_TAG = () =>
  new AppError("CONFLICT", "A tag with this name already exists", { name: "A tag with this name already exists" });

export async function listTags(ctx: WorkspaceContext): Promise<TagDto[]> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_READ);
  const scope = scopeOf(ctx);
  const [tags, counts] = await Promise.all([
    ctx.db.collection<TagDoc>(MARKETING_COLLECTIONS.tags).find(scope).sort({ normalizedName: 1 }).limit(500).toArray(),
    ctx.db
      .collection(MARKETING_COLLECTIONS.contactTags)
      .aggregate<{ _id: ObjectId; count: number }>([{ $match: scope }, { $group: { _id: "$tagId", count: { $sum: 1 } } }])
      .toArray(),
  ]);
  const countByTag = new Map(counts.map((row) => [row._id.toHexString(), row.count]));
  return tags.map((tag) => toTagDto(tag, countByTag.get(tag._id.toHexString()) ?? 0));
}

export async function createTag(ctx: WorkspaceContext, input: TagInput): Promise<TagDto> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_TAG_MANAGE);
  const now = new Date();
  const doc: TagDoc = {
    _id: new ObjectId(),
    companyId: ctx.companyId,
    name: input.name.trim(),
    normalizedName: normalizeName(input.name),
    color: input.color.toLowerCase(),
    createdAt: now,
    updatedAt: now,
  };
  try {
    await ctx.db.collection<TagDoc>(MARKETING_COLLECTIONS.tags).insertOne(doc);
  } catch (error) {
    if (isDuplicateKeyError(error)) throw DUPLICATE_TAG();
    throw error;
  }
  return toTagDto(doc, 0);
}

export async function updateTag(ctx: WorkspaceContext, tagIdRaw: string, input: TagInput): Promise<TagDto> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_TAG_MANAGE);
  const tagId = toObjectId(tagIdRaw);
  try {
    const result = await ctx.db.collection<TagDoc>(MARKETING_COLLECTIONS.tags).findOneAndUpdate(
      { _id: tagId, ...scopeOf(ctx) },
      {
        $set: {
          name: input.name.trim(),
          normalizedName: normalizeName(input.name),
          color: input.color.toLowerCase(),
          updatedAt: new Date(),
        },
      },
      { returnDocument: "after" }
    );
    if (!result) throw new AppError("NOT_FOUND", "Tag not found");
    const count = await ctx.db
      .collection(MARKETING_COLLECTIONS.contactTags)
      .countDocuments({ ...scopeOf(ctx), tagId });
    return toTagDto(result, count);
  } catch (error) {
    if (isDuplicateKeyError(error)) throw DUPLICATE_TAG();
    throw error;
  }
}

/**
 * Deleting a tag removes its assignments in the same transaction. A tag referenced by an audience rule
 * cannot be deleted, because the rule would silently change meaning.
 */
export async function deleteTag(ctx: WorkspaceContext, tagIdRaw: string): Promise<void> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_TAG_MANAGE);
  const tagId = toObjectId(tagIdRaw);
  const scope = scopeOf(ctx);
  const tag = await ctx.db.collection<TagDoc>(MARKETING_COLLECTIONS.tags).findOne({ _id: tagId, ...scope });
  if (!tag) throw new AppError("NOT_FOUND", "Tag not found");

  const usedBy = await ctx.db
    .collection<AudienceDoc>(MARKETING_COLLECTIONS.audiences)
    .findOne({ ...scope, "selectionRule.conditions": { $elemMatch: { type: "tags", tagIds: tagId } } }, { projection: { name: 1 } });
  if (usedBy) {
    throw new AppError("CONFLICT", `This tag is used by the audience "${usedBy.name}". Remove it from that audience first.`);
  }

  await withTransaction(ctx.db, async (tx) => {
    await ctx.db.collection<ContactTagDoc>(MARKETING_COLLECTIONS.contactTags).deleteMany({ ...scope, tagId }, { session: tx.session });
    await ctx.db.collection<TagDoc>(MARKETING_COLLECTIONS.tags).deleteOne({ _id: tagId, ...scope }, { session: tx.session });
    await recordAudit(
      ctx.db,
      {
        companyId: ctx.companyId,
        actorUserId: ctx.userId,
        action: "marketing.tag.deleted",
        entityType: "marketing_tag",
        entityId: tagIdRaw,
        requestId: ctx.requestId,
      },
      tx
    );
  });
}

/** Tags applied to one contact. One query for the links and one for the tags, never one per tag. */
export async function tagsForContact(db: Db, scope: { companyId: ObjectId }, contactId: ObjectId) {
  const links = await db
    .collection<ContactTagDoc>(MARKETING_COLLECTIONS.contactTags)
    .find({ ...scope, contactId })
    .toArray();
  if (links.length === 0) return [];
  return db
    .collection<TagDoc>(MARKETING_COLLECTIONS.tags)
    .find({ ...scope, _id: { $in: links.map((link) => link.tagId) } })
    .sort({ normalizedName: 1 })
    .toArray();
}

async function assertTagAndContacts(db: Db, ctx: WorkspaceContext, tagId: ObjectId, contactIds: ObjectId[]): Promise<ObjectId[]> {
  const scope = scopeOf(ctx);
  const tag = await db.collection<TagDoc>(MARKETING_COLLECTIONS.tags).findOne({ _id: tagId, ...scope }, { projection: { _id: 1 } });
  if (!tag) throw new AppError("NOT_FOUND", "Tag not found");
  // Foreign-company or unknown contact ids are dropped here, so they can never be assigned.
  const contacts = await db
    .collection<ContactDoc>(MARKETING_COLLECTIONS.contacts)
    .find({ ...scope, _id: { $in: contactIds } }, { projection: { _id: 1 } })
    .toArray();
  return contacts.map((contact) => contact._id);
}

/** Assigns a tag. Assigning an existing link is a no-op, so retries are safe. */
export async function assignTags(
  ctx: WorkspaceContext,
  contactIdsRaw: string[],
  tagIdRaw: string
): Promise<{ assigned: number; skipped: number }> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_TAG_MANAGE);
  const tagId = toObjectId(tagIdRaw);
  const contactIds = await assertTagAndContacts(ctx.db, ctx, tagId, contactIdsRaw.map((id) => toObjectId(id)));
  if (contactIds.length === 0) throw new AppError("NOT_FOUND", "No matching contacts found");

  const now = new Date();
  const docs: ContactTagDoc[] = contactIds.map((contactId) => ({
    _id: new ObjectId(),
    companyId: ctx.companyId,
    contactId,
    tagId,
    assignedBy: ctx.userId,
    assignedAt: now,
  }));
  let assigned = 0;
  try {
    const result = await ctx.db
      .collection<ContactTagDoc>(MARKETING_COLLECTIONS.contactTags)
      .insertMany(docs, { ordered: false });
    assigned = result.insertedCount;
  } catch (error) {
    // Duplicate links are expected on retries. Count what was actually inserted.
    const bulk = error as { code?: number; insertedCount?: number };
    if (bulk.code !== 11000) throw error;
    assigned = bulk.insertedCount ?? 0;
  }
  await recordAudit(ctx.db, {
    companyId: ctx.companyId,
    actorUserId: ctx.userId,
    action: "marketing.tag.assigned",
    entityType: "marketing_tag",
    entityId: tagIdRaw,
    requestId: ctx.requestId,
    metadata: { assigned, requested: contactIdsRaw.length },
  });
  return { assigned, skipped: contactIdsRaw.length - assigned };
}

export async function removeTags(
  ctx: WorkspaceContext,
  contactIdsRaw: string[],
  tagIdRaw: string
): Promise<{ removed: number }> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_TAG_MANAGE);
  const tagId = toObjectId(tagIdRaw);
  const contactIds = contactIdsRaw.map((id) => toObjectId(id));
  const result = await ctx.db
    .collection<ContactTagDoc>(MARKETING_COLLECTIONS.contactTags)
    .deleteMany({ ...scopeOf(ctx), tagId, contactId: { $in: contactIds } });
  await recordAudit(ctx.db, {
    companyId: ctx.companyId,
    actorUserId: ctx.userId,
    action: "marketing.tag.removed",
    entityType: "marketing_tag",
    entityId: tagIdRaw,
    requestId: ctx.requestId,
    metadata: { removed: result.deletedCount },
  });
  return { removed: result.deletedCount };
}
