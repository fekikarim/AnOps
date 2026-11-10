import "server-only";
import { ObjectId, type Db } from "mongodb";
import { recordAudit } from "@/server/audit/audit.service";
import { PLATFORM_COLLECTIONS } from "@/server/platform/collections";
import { markExpiredTrials } from "@/server/platform/subscription.service";

/**
 * Records that must survive workspace cleanup (legal, security and payment retention).
 * Everything else that carries the organization's companyId is provisional data and is removed.
 */
const RETAINED_COLLECTIONS = new Set<string>([
  "audit_events",
  PLATFORM_COLLECTIONS.billingInvoices,
  PLATFORM_COLLECTIONS.stripeEvents,
  "companies",
  "users",
  "accounts",
  "sessions",
  "rate_limits",
]);

const BATCH = 25;
const STALE_CLAIM_MS = 10 * 60 * 1000;

export type CleanupReport = { expiredOrganizations: number; removedUsers: number; lapsedTrials: number };

/**
 * Removes organizations that were not activated before their deadline. Safe to run concurrently and
 * repeatedly: each organization is claimed with a conditional update (pending → expiring), and an
 * activation can only succeed while the status is still "pending" and before the deadline, so an
 * activated organization can never be claimed.
 */
export async function runLifecycleMaintenance(db: Db, now = new Date()): Promise<CleanupReport> {
  const report: CleanupReport = { expiredOrganizations: 0, removedUsers: 0, lapsedTrials: 0 };
  const companies = db.collection("companies");

  const candidates = await companies
    .find(
      {
        $or: [
          { activationStatus: "pending", activationDeadline: { $lte: now } },
          // A previous run claimed it and stopped half-way: finish the job.
          { activationStatus: "expiring", expiringAt: { $lte: new Date(now.getTime() - STALE_CLAIM_MS) } },
        ],
      },
      { projection: { _id: 1, ownerId: 1, activationStatus: 1 } }
    )
    .limit(BATCH)
    .toArray();

  for (const candidate of candidates) {
    const claim = await companies.updateOne(
      {
        _id: candidate._id,
        $or: [
          { activationStatus: "pending", activationDeadline: { $lte: now } },
          { activationStatus: "expiring", expiringAt: { $lte: new Date(now.getTime() - STALE_CLAIM_MS) } },
        ],
      },
      { $set: { activationStatus: "expiring", expiringAt: now } }
    );
    if (claim.modifiedCount !== 1) continue;
    report.removedUsers += await purgeOrganization(db, candidate._id as ObjectId, candidate.ownerId as ObjectId);
    report.expiredOrganizations += 1;
  }

  report.lapsedTrials = await markExpiredTrials(db, now);
  return report;
}

async function purgeOrganization(db: Db, companyId: ObjectId, ownerId: ObjectId): Promise<number> {
  const members = await db.collection("company_members").find({ companyId }, { projection: { userId: 1 } }).toArray();
  const userIds = members.map((m) => m.userId as ObjectId);

  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  for (const { name } of collections) {
    if (RETAINED_COLLECTIONS.has(name) || name.startsWith("system.")) continue;
    // Tenant data is keyed by ObjectId; some older collections store the id as a string.
    await db.collection(name).deleteMany({ companyId: { $in: [companyId, companyId.toHexString()] } });
  }

  // Remove provisional accounts that never confirmed their email and belong to no other organization.
  let removed = 0;
  for (const userId of userIds) {
    const user = await db.collection("users").findOne({ _id: userId }, { projection: { emailVerified: 1, provisionalUntil: 1 } });
    if (!user || user.emailVerified || !user.provisionalUntil) continue;
    const otherMemberships = await db.collection("company_members").countDocuments({ userId });
    if (otherMemberships > 0) continue;
    await db.collection("accounts").deleteMany({ userId });
    await db.collection("sessions").deleteMany({ userId });
    const deleted = await db.collection("users").deleteOne({ _id: userId, emailVerified: null });
    removed += deleted.deletedCount;
  }

  await recordAudit(db, {
    companyId,
    actorUserId: ownerId,
    action: "organization.expired_cleanup",
    entityType: "organization",
    entityId: companyId.toHexString(),
    requestId: `maintenance-${new ObjectId().toHexString()}`,
    metadata: { reason: "activation_deadline_passed", removedUsers: removed },
  });
  await db.collection("companies").deleteOne({ _id: companyId, activationStatus: "expiring" });
  return removed;
}
