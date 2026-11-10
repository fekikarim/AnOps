import "server-only";
import type {
  Collection,
  Db,
  DeleteOptions,
  Document,
  Filter,
  FindOneAndUpdateOptions,
  FindOptions,
  InsertOneOptions,
  ObjectId,
  UpdateFilter,
  UpdateOptions,
  WithId,
} from "mongodb";
import {
  COLLECTIONS,
  type AiAccessGrantDoc,
  type AiConversationDoc,
  type AiNoticeDoc,
  type AiPendingActionDoc,
  type AiSettingsDoc,
  type AiUsageModelDoc,
  type AiUsageDoc,
} from "@/server/db/documents";

/**
 * The only door to the AI collections.
 *
 * Every filter is AND-ed with a scope the caller cannot override: always the company, and for
 * private collections also the owning user. Inserts overwrite companyId (and userId) with the
 * scope's own values, so a document can never be written into another tenant or another member.
 * Code outside server/ai/data must not call db.collection() on an AI collection; a test enforces it.
 */
export type AiScopeContext = { db: Db; companyId: ObjectId; userId: ObjectId };

type FixedScope = Record<string, unknown>;

export class ScopedCollection<T extends Document> {
  constructor(
    private readonly collection: Collection<T>,
    private readonly fixed: FixedScope
  ) {}

  private scoped(filter: Filter<T> = {} as Filter<T>): Filter<T> {
    return { $and: [filter, this.fixed] } as Filter<T>;
  }

  findOne(filter: Filter<T> = {} as Filter<T>, options?: FindOptions): Promise<WithId<T> | null> {
    return this.collection.findOne(this.scoped(filter), options);
  }

  find(filter: Filter<T> = {} as Filter<T>, options?: FindOptions) {
    return this.collection.find(this.scoped(filter), options);
  }

  countDocuments(filter: Filter<T> = {} as Filter<T>) {
    return this.collection.countDocuments(this.scoped(filter));
  }

  async insertOne(doc: Omit<T, "companyId" | "userId"> & Partial<Pick<T, Extract<keyof T, "userId">>>, options?: InsertOneOptions) {
    return this.collection.insertOne({ ...doc, ...this.fixed } as unknown as Parameters<Collection<T>["insertOne"]>[0], options);
  }

  updateOne(filter: Filter<T>, update: UpdateFilter<T>, options?: UpdateOptions) {
    return this.collection.updateOne(this.scoped(filter), update, options);
  }

  updateMany(filter: Filter<T>, update: UpdateFilter<T> | Document[], options?: UpdateOptions) {
    return this.collection.updateMany(this.scoped(filter), update as UpdateFilter<T>, options);
  }

  findOneAndUpdate(filter: Filter<T>, update: UpdateFilter<T>, options?: FindOneAndUpdateOptions) {
    return this.collection.findOneAndUpdate(this.scoped(filter), update, { ...options, includeResultMetadata: false });
  }

  deleteOne(filter: Filter<T>, options?: DeleteOptions) {
    return this.collection.deleteOne(this.scoped(filter), options);
  }

  deleteMany(filter: Filter<T>) {
    return this.collection.deleteMany(this.scoped(filter));
  }
}

/** Read-only view, handed to the transcript-audit service. It has no write method to misuse. */
export type ReadOnlyScoped<T extends Document> = Pick<ScopedCollection<T>, "findOne" | "find" | "countDocuments">;

function open<T extends Document>(db: Db, name: string, fixed: FixedScope): ScopedCollection<T> {
  return new ScopedCollection<T>(db.collection<T>(name), fixed);
}

/** The acting member's own scope. Private collections are bound to ctx.userId. */
export function aiScope(ctx: AiScopeContext) {
  const company = { companyId: ctx.companyId };
  const own = { companyId: ctx.companyId, userId: ctx.userId };
  return {
    settings: open<AiSettingsDoc>(ctx.db, COLLECTIONS.aiSettings, company),
    grants: open<AiAccessGrantDoc>(ctx.db, COLLECTIONS.aiAccessGrants, company),
    conversations: open<AiConversationDoc>(ctx.db, COLLECTIONS.aiConversations, own),
    pending: open<AiPendingActionDoc>(ctx.db, COLLECTIONS.aiPendingActions, own),
    usage: open<AiUsageDoc>(ctx.db, COLLECTIONS.aiUsage, own),
    companyUsage: open<AiUsageDoc>(ctx.db, COLLECTIONS.aiUsage, { companyId: ctx.companyId, userId: null }),
    notices: open<AiNoticeDoc>(ctx.db, COLLECTIONS.aiNotices, own),
    /** Measured tokens per provider and model for the company, by day. Counters only. */
    usageModels: open<AiUsageModelDoc>(ctx.db, COLLECTIONS.aiUsageModels, company),
    /** Every member's usage rows, for the usage view. Counters only; never content. Guarded by ai.usage.view in the service. */
    usageForAdmin: open<AiUsageDoc>(ctx.db, COLLECTIONS.aiUsage, { companyId: ctx.companyId, userId: { $ne: null } }),
  };
}

/**
 * Operations that must reach another member's non-conversation rows: cancelling their pending
 * actions when access is revoked, and notifying them that their transcripts were audited.
 * Conversations are deliberately absent.
 */
export function aiScopeForMember(ctx: Pick<AiScopeContext, "db" | "companyId">, memberUserId: ObjectId) {
  const member = { companyId: ctx.companyId, userId: memberUserId };
  return {
    pending: open<AiPendingActionDoc>(ctx.db, COLLECTIONS.aiPendingActions, member),
    notices: open<AiNoticeDoc>(ctx.db, COLLECTIONS.aiNotices, member),
    usage: open<AiUsageDoc>(ctx.db, COLLECTIONS.aiUsage, member),
  };
}

/** Company-wide: every member's open proposals. Used only when AI is switched off for the whole company. */
export function aiCompanyPending(ctx: Pick<AiScopeContext, "db" | "companyId">) {
  return open<AiPendingActionDoc>(ctx.db, COLLECTIONS.aiPendingActions, { companyId: ctx.companyId });
}

/** Read-only access to one member's conversations, for the explicitly authorised transcript audit. */
export function aiAuditReader(ctx: Pick<AiScopeContext, "db" | "companyId">, memberUserId: ObjectId) {
  const conversations = open<AiConversationDoc>(ctx.db, COLLECTIONS.aiConversations, {
    companyId: ctx.companyId,
    userId: memberUserId,
  });
  return { conversations: conversations as ReadOnlyScoped<AiConversationDoc> };
}

/** Company-wide retention: re-anchors expiresAt on every conversation when the policy changes. */
export function aiRetentionWriter(ctx: Pick<AiScopeContext, "db" | "companyId">) {
  const conversations = ctx.db.collection<AiConversationDoc>(COLLECTIONS.aiConversations);
  return {
    reapply(retentionDays: number) {
      return conversations.updateMany({ companyId: ctx.companyId }, [
        { $set: { expiresAt: { $dateAdd: { startDate: "$updatedAt", unit: "day", amount: retentionDays } } } },
      ]);
    },
  };
}
