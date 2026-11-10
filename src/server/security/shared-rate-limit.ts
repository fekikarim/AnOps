import "server-only";
import type { Db } from "mongodb";
import { COLLECTIONS } from "@/server/db/documents";
import { AppError } from "@/shared/lib/errors";

type RateWindowDoc = { _id: string; key: string; count: number; expiresAt: Date };

/**
 * Fixed-window rate limit shared by every server instance, kept in MongoDB. One document per (key, window); the increment is a
 * single atomic upsert, so concurrent requests - on one instance or many - cannot both take the last slot. Windows leave by TTL.
 *
 * Used for everything tied to a signed-in workspace. Only the unauthenticated unsubscribe form keeps the in-memory limiter,
 * because it has no database handle at that point.
 */
export async function consumeSharedRateLimit(db: Db, key: string, limit: number, windowMs: number, message = "Too many requests. Please wait a moment and try again."): Promise<void> {
  const now = Date.now();
  const window = Math.floor(now / windowMs);
  const id = `${key}|${window}`;
  const collection = db.collection<RateWindowDoc>(COLLECTIONS.rateLimits);
  const update = { $inc: { count: 1 }, $setOnInsert: { key, expiresAt: new Date((window + 1) * windowMs + windowMs) } };
  let doc: RateWindowDoc | null;
  try {
    doc = await collection.findOneAndUpdate({ _id: id }, update, { upsert: true, returnDocument: "after" });
  } catch (error) {
    // Two requests created the window at the same moment: the loser simply increments the winner's document.
    if ((error as { code?: number } | null)?.code !== 11000) throw error;
    doc = await collection.findOneAndUpdate({ _id: id }, { $inc: { count: 1 } }, { returnDocument: "after" });
  }
  if (!doc || doc.count > limit) throw new AppError("RATE_LIMITED", message);
}
