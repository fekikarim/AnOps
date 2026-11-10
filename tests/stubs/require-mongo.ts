import { MongoClient } from "mongodb";

/**
 * Integration tests need a disposable MongoDB replica set. Without one, their beforeAll hooks fail and
 * the tests show as skipped, which looks like a pass. This check stops the whole run with a clear message
 * instead. Set ANOPS_SKIP_DB_PREFLIGHT=1 to run only the unit tests without a database.
 */
export default async function requireMongo() {
  if (process.env.ANOPS_SKIP_DB_PREFLIGHT === "1") return;
  const uri = process.env.MONGODB_TEST_URI ?? "mongodb://127.0.0.1:27018/?replicaSet=rs0&directConnection=true";
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 4000 });
  try {
    await client.connect();
    await client.db("admin").command({ ping: 1 });
  } catch {
    throw new Error(
      `MongoDB is not reachable at ${uri.replace(/\/\/[^@]*@/, "//")}.\n` +
        "Integration tests need a disposable replica set (see tests/helpers/workspace.ts). Start one, set MONGODB_TEST_URI, " +
        "or run with ANOPS_SKIP_DB_PREFLIGHT=1 to run only the unit tests."
    );
  } finally {
    await client.close().catch(() => undefined);
  }
}
