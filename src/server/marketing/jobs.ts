import "server-only";
import { ObjectId, type ClientSession, type Db } from "mongodb";
import { MARKETING_COLLECTIONS, type JobDoc, type JobType } from "@/server/marketing/documents";
import { retryDelayMs } from "@/features/marketing/utils/retry";

/**
 * Durable job queue on MongoDB. Scheduled work (campaign dispatch, scheduled social posts) is stored as a
 * job with a run time. A worker claims jobs atomically with a lease. If a worker dies, its lease expires
 * and another worker takes the job over. Enqueueing is idempotent because `key` is unique per company.
 *
 * Nothing runs on a timer inside the web process: a worker must call the worker endpoint on a schedule
 * (see docs/MARKETING.md, "Background processing").
 */
/** Must exceed the worst-case duration of one run (see DELIVERY_BATCH_SIZE in dispatch.ts). */
export const JOB_LEASE_MS = 10 * 60_000;
export const DEFAULT_MAX_ATTEMPTS = 6;

export type EnqueueInput = {
  companyId: ObjectId;
  type: JobType;
  targetId: ObjectId;
  key: string;
  runAt: Date;
  maxAttempts?: number;
};

export async function enqueueJob(db: Db, input: EnqueueInput, session?: ClientSession): Promise<boolean> {
  const now = new Date();
  const doc: JobDoc = {
    _id: new ObjectId(),
    companyId: input.companyId,
    type: input.type,
    targetId: input.targetId,
    key: input.key,
    status: "queued",
    runAt: input.runAt,
    attempts: 0,
    maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    leaseOwner: null,
    leaseExpiresAt: null,
    lastErrorCode: null,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await db.collection<JobDoc>(MARKETING_COLLECTIONS.jobs).insertOne(doc, { session });
    return true;
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return false;
    throw error;
  }
}

/** Cancels a job that has not been claimed. A running job cannot be cancelled; its service checks the campaign state instead. */
export async function cancelQueuedJob(db: Db, companyId: ObjectId, key: string, session?: ClientSession): Promise<boolean> {
  const result = await db
    .collection<JobDoc>(MARKETING_COLLECTIONS.jobs)
    .updateOne({ companyId, key, status: "queued" }, { $set: { status: "cancelled", updatedAt: new Date() } }, { session });
  return result.modifiedCount === 1;
}

/** Atomically claims the next due job, or takes over a job whose lease has expired. */
export async function claimNextJob(db: Db, workerId: string, now: Date): Promise<JobDoc | null> {
  return db.collection<JobDoc>(MARKETING_COLLECTIONS.jobs).findOneAndUpdate(
    {
      $or: [
        { status: "queued", runAt: { $lte: now } },
        { status: "running", leaseExpiresAt: { $lt: now } },
      ],
    },
    {
      $set: {
        status: "running",
        leaseOwner: workerId,
        leaseExpiresAt: new Date(now.getTime() + JOB_LEASE_MS),
        updatedAt: now,
      },
      $inc: { attempts: 1 },
    },
    { sort: { runAt: 1 }, returnDocument: "after" }
  );
}

export type JobOutcome =
  | { kind: "succeeded" }
  | { kind: "requeue"; runAt: Date }
  | { kind: "retry"; errorCode: string }
  | { kind: "dead"; errorCode: string };

/** Records the outcome of a claimed job. Only the worker holding the lease can finish it. */
export async function finishJob(db: Db, job: JobDoc, workerId: string, outcome: JobOutcome, now: Date): Promise<void> {
  const filter = { _id: job._id, leaseOwner: workerId };
  const released = { leaseOwner: null, leaseExpiresAt: null, updatedAt: now };
  switch (outcome.kind) {
    case "succeeded":
      await db.collection<JobDoc>(MARKETING_COLLECTIONS.jobs).updateOne(filter, {
        $set: { ...released, status: "succeeded", lastErrorCode: null },
      });
      return;
    case "requeue":
      // Progress was made, so the attempt budget starts again.
      await db.collection<JobDoc>(MARKETING_COLLECTIONS.jobs).updateOne(filter, {
        $set: { ...released, status: "queued", runAt: outcome.runAt, lastErrorCode: null, attempts: 0 },
      });
      return;
    case "retry":
      await db.collection<JobDoc>(MARKETING_COLLECTIONS.jobs).updateOne(filter, {
        $set: {
          ...released,
          status: "queued",
          runAt: new Date(now.getTime() + retryDelayMs(job.attempts)),
          lastErrorCode: outcome.errorCode,
        },
      });
      return;
    case "dead":
      await db.collection<JobDoc>(MARKETING_COLLECTIONS.jobs).updateOne(filter, {
        $set: { ...released, status: "dead", lastErrorCode: outcome.errorCode },
      });
      return;
  }
}
