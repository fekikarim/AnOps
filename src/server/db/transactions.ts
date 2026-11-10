import "server-only";
import type { ClientSession, Db, MongoClient } from "mongodb";
import { AppError } from "@/shared/lib/errors";

const MONGO_DUPLICATE_KEY = 11000;
const MONGO_ILLEGAL_OPERATION = 20;

export type Undo = () => Promise<unknown>;

/**
 * Handle passed to every multi-document operation.
 * - On a replica set, `session` is a real transaction and writes commit or abort together.
 *   `onRollback` is unused because the server discards the writes itself.
 * - On a standalone server there is no session. Each write registers an undo step through
 *   `onRollback`, and the helper runs the undo steps in reverse order if the operation fails.
 */
export type Tx = {
  session: ClientSession | undefined;
  onRollback: (undo: Undo) => void;
};

const transactionSupport = new WeakMap<MongoClient, Promise<boolean>>();

/** Detects whether the deployment accepts transactions (replica set or mongos). Cached per client. */
export function supportsTransactions(db: Db): Promise<boolean> {
  let support = transactionSupport.get(db.client);
  if (!support) {
    support = db
      .admin()
      .command({ hello: 1 })
      .then((reply: { setName?: string; msg?: string }) => Boolean(reply.setName) || reply.msg === "isdbgrid")
      .catch(() => false);
    transactionSupport.set(db.client, support);
  }
  return support;
}

/**
 * Runs `fn` as one unit of work.
 *
 * Replica set: a majority-committed snapshot transaction. MongoDB retries the callback on
 * transient write conflicts, so `fn` must not keep side effects outside the session.
 *
 * Standalone server: no transactions exist, so the writes are applied one by one and each
 * registers its own undo. On any error the undo steps run newest-first. This keeps invariants
 * across ordinary errors (validation, insufficient stock, failed audit write). It does NOT
 * protect against a process crash in the middle of the operation, so a standalone server is
 * for development only. Production needs a replica set.
 */
export async function withTransaction<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!(await supportsTransactions(db))) {
    return withCompensation(fn);
  }

  const session = db.client.startSession();
  let result: T | undefined;
  try {
    await session.withTransaction(
      async () => {
        result = await fn({ session, onRollback: () => undefined });
      },
      {
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" },
        readPreference: "primary",
        maxCommitTimeMS: 5000,
      }
    );
  } catch (error) {
    throw mapMongoError(error);
  } finally {
    await session.endSession();
  }
  return result as T;
}

async function withCompensation<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const undos: Undo[] = [];
  const tx: Tx = { session: undefined, onRollback: (undo) => undos.push(undo) };
  try {
    return await fn(tx);
  } catch (error) {
    for (const undo of undos.reverse()) {
      try {
        await undo();
      } catch (undoError) {
        // Logged by name only. The original error is still returned to the caller.
        console.error(`[db] compensation failed: ${undoError instanceof Error ? undoError.name : "unknown"}`);
      }
    }
    throw mapMongoError(error);
  }
}

/** Translates driver errors into AppError without leaking driver internals. */
export function mapMongoError(error: unknown): unknown {
  if (error instanceof AppError) return error;
  const code = (error as { code?: number } | null)?.code;
  const message = error instanceof Error ? error.message : "";
  if (
    code === MONGO_ILLEGAL_OPERATION ||
    message.includes("Transaction numbers are only allowed")
  ) {
    return new AppError(
      "TRANSACTIONS_UNAVAILABLE",
      "This operation needs a MongoDB replica set. Contact an administrator."
    );
  }
  if (code === MONGO_DUPLICATE_KEY) {
    return new AppError("CONFLICT", DUPLICATE_MESSAGE);
  }
  return error;
}

const DUPLICATE_MESSAGE = "A record with the same unique value already exists";

/**
 * True for a duplicate-key failure, whether it is still the raw driver error or was already translated by
 * withTransaction. Services use it to answer with their own field-specific message instead of the generic one.
 */
export function isDuplicateKeyError(error: unknown): boolean {
  if (error instanceof AppError) return error.code === "CONFLICT" && error.message === DUPLICATE_MESSAGE;
  return (error as { code?: number } | null)?.code === MONGO_DUPLICATE_KEY;
}
