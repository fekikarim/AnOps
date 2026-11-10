import "server-only";
import { ObjectId, type Db } from "mongodb";
import type { Tx } from "@/server/db/transactions";
import { COLLECTIONS, type AuditEventDoc } from "@/server/db/documents";

export type AuditInput = {
  companyId: ObjectId | null;
  actorUserId: ObjectId;
  action: string;
  entityType: string;
  entityId: string;
  requestId: string;
  metadata?: Record<string, string | number | boolean>;
};

/**
 * Writes an audit event. Pass the operation's Tx when the audited change belongs to it, so the
 * event commits or rolls back with the change itself.
 * Metadata must stay small and must never contain secrets or personal document content.
 */
export async function recordAudit(db: Db, input: AuditInput, tx?: Tx): Promise<void> {
  const doc: AuditEventDoc = {
    _id: new ObjectId(),
    companyId: input.companyId,
    actorUserId: input.actorUserId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    outcome: "success",
    requestId: input.requestId,
    metadata: input.metadata ?? {},
    occurredAt: new Date(),
  };
  await db.collection<AuditEventDoc>(COLLECTIONS.auditEvents).insertOne(doc, { session: tx?.session });
  tx?.onRollback(() => db.collection(COLLECTIONS.auditEvents).deleteOne({ _id: doc._id }));
}
