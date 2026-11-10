import "server-only";
import type { Db } from "mongodb";
import { COLLECTIONS, type CounterDoc } from "@/server/db/documents";

/**
 * Human-readable document numbers (PO-000012). Sequences are atomic `$inc` upserts, so
 * concurrent requests never receive the same number. Gaps can appear when a
 * transaction aborts after the sequence was consumed; that is accepted.
 */
export async function nextSequenceNumber(db: Db, key: string, prefix: string): Promise<string> {
  const counter = await db
    .collection<CounterDoc>(COLLECTIONS.counters)
    .findOneAndUpdate({ _id: key }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after" });
  if (!counter) {
    throw new Error("Counter was not created");
  }
  return `${prefix}-${String(counter.seq).padStart(6, "0")}`;
}
