import "server-only";
import type { Db, ObjectId } from "mongodb";
import { MARKETING_COLLECTIONS } from "@/server/marketing/documents";
import { MAX_EVALUATED_CONTACTS } from "@/server/marketing/common";
import { AppError } from "@/shared/lib/errors";

/**
 * Resolves contact ids for a tag selection. "any" matches contacts with at least one tag, "all" with
 * every tag. Pipelines group in the database and stop at the evaluation cap, so the application never
 * loads the whole assignment table.
 */
export async function contactTagIdsFor(
  db: Db,
  scope: { companyId: ObjectId },
  tagIds: ObjectId[],
  mode: "any" | "all"
): Promise<ObjectId[]> {
  if (tagIds.length === 0) return [];
  const pipeline: Record<string, unknown>[] = [
    { $match: { companyId: scope.companyId, tagId: { $in: tagIds } } },
    { $group: { _id: "$contactId", tags: { $addToSet: "$tagId" } } },
  ];
  if (mode === "all") {
    pipeline.push({ $match: { $expr: { $eq: [{ $size: "$tags" }, tagIds.length] } } });
  }
  pipeline.push({ $limit: MAX_EVALUATED_CONTACTS + 1 });
  const rows = await db
    .collection(MARKETING_COLLECTIONS.contactTags)
    .aggregate<{ _id: ObjectId }>(pipeline)
    .toArray();
  if (rows.length > MAX_EVALUATED_CONTACTS) {
    throw new AppError("VALIDATION_ERROR", "Too many contacts match this tag selection. Narrow the filter.");
  }
  return rows.map((row) => row._id);
}
