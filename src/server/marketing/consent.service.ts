import "server-only";
import { ObjectId, type Db } from "mongodb";
import { MARKETING_COLLECTIONS, type ConsentEventDoc, type ConsentSource, type ConsentStateDoc, type ConsentStatus, type ContactDoc, type TelegramSubscriptionDoc } from "@/server/marketing/documents";
import { DIRECT_CONTACT_CHANNELS, type DirectContactChannel, type MarketingChannel } from "@/features/marketing/types/constants";
import { recordAudit } from "@/server/audit/audit.service";
import type { Tx } from "@/server/db/transactions";
import { withTransaction } from "@/server/db/transactions";
import type { WorkspaceContext } from "@/server/tenancy/workspace";
import { AppError } from "@/shared/lib/errors";
import type { ConsentChangeInput } from "@/features/marketing/schemas/marketing.schema";
import { requireMarketing, scopeOf, toObjectId } from "@/server/marketing/common";
import { PERMISSIONS } from "@/server/security/permissions";

export type ConsentStateDto = { status: ConsentStatus; occurredAt: string; source: ConsentSource | null };

export type ConsentDto = {
  email: ConsentStateDto | null;
  sms: ConsentStateDto | null;
  telegram: ConsentStateDto | null;
};

export type ConsentEventDto = {
  id: string;
  channel: MarketingChannel;
  status: ConsentStatus;
  source: ConsentSource;
  occurredAt: string;
  recordedAt: string;
  recordedByUser: boolean;
};

const PURPOSE = "marketing" as const;

export type AppendConsentArgs = {
  companyId: ObjectId;
  contactId: ObjectId;
  channel: MarketingChannel;
  status: ConsentStatus;
  source: ConsentSource;
  occurredAt: Date;
  recordedBy: ObjectId | null;
  requestId: string;
};

/**
 * Appends one consent event and updates the effective state, in order.
 *
 * - The event is always kept, so history is never overwritten.
 * - The effective state only moves forward in time. An event older than the current state is kept in
 *   history but does not change the state.
 * - On equal timestamps a withdrawal wins over a grant, so a stale grant cannot re-subscribe someone.
 * - Concurrent writers are resolved by the unique index on the state document. A duplicate key means
 *   another writer already holds a newer state, so this write leaves the state unchanged.
 *
 * Returns whether the effective state changed.
 */
export async function appendConsentEvent(
  db: Db,
  args: AppendConsentArgs,
  tx?: Tx
): Promise<{ stateChanged: boolean; effectiveStatus: ConsentStatus }> {
  const now = new Date();
  const eventId = new ObjectId();
  const event: ConsentEventDoc = {
    _id: eventId,
    companyId: args.companyId,
    contactId: args.contactId,
    channel: args.channel,
    purpose: PURPOSE,
    status: args.status,
    source: args.source,
    occurredAt: args.occurredAt,
    recordedAt: now,
    recordedBy: args.recordedBy,
    requestId: args.requestId,
  };
  await db.collection<ConsentEventDoc>(MARKETING_COLLECTIONS.consentEvents).insertOne(event, { session: tx?.session });
  tx?.onRollback(() => db.collection(MARKETING_COLLECTIONS.consentEvents).deleteOne({ _id: eventId }));

  const states = db.collection<ConsentStateDoc>(MARKETING_COLLECTIONS.consentStates);
  const key = { companyId: args.companyId, contactId: args.contactId, channel: args.channel, purpose: PURPOSE };
  const previous = await states.findOne(key, { session: tx?.session });
  const order = args.status === "withdrawn" ? { $lte: args.occurredAt } : { $lt: args.occurredAt };

  // Never issue an operation that can hit the unique index on the normal path. Inside a transaction a duplicate
  // key aborts the whole transaction, and the driver retries it for a long time. So: update only when this
  // event is newer (or equal with a withdrawal), otherwise insert only when no state exists yet.
  const update = await states.updateOne(
    { ...key, occurredAt: order },
    { $set: { status: args.status, occurredAt: args.occurredAt, eventId, updatedAt: now } },
    { session: tx?.session }
  );
  let stateChanged = update.modifiedCount > 0;
  if (!stateChanged && !previous) {
    await states.insertOne(
      { _id: new ObjectId(), ...key, status: args.status, occurredAt: args.occurredAt, eventId, updatedAt: now },
      { session: tx?.session }
    );
    stateChanged = true;
  }

  if (stateChanged) {
    tx?.onRollback(() =>
      previous
        ? states.replaceOne({ _id: previous._id }, previous)
        : states.deleteOne(key)
    );
  }

  const current = await states.findOne(key, { session: tx?.session });
  return { stateChanged, effectiveStatus: current?.status ?? "withdrawn" };
}

async function assertContact(db: Db, companyId: ObjectId, contactId: ObjectId): Promise<ContactDoc> {
  const contact = await db
    .collection<ContactDoc>(MARKETING_COLLECTIONS.contacts)
    .findOne({ _id: contactId, companyId });
  if (!contact) throw new AppError("NOT_FOUND", "Contact not found");
  return contact;
}

/**
 * Brings the stored consent to the statuses chosen on the contact form. Runs inside the caller's
 * transaction. Only channels whose status actually changes are written, so saving an unrelated field
 * never adds history. A grant needs an address on that channel. A withdrawal is only written where
 * consent is currently granted. Returns the channels that changed.
 */
export async function syncConsentStatuses(
  db: Db,
  args: {
    companyId: ObjectId;
    contactId: ObjectId;
    hasAddress: Record<DirectContactChannel, boolean>;
    desired: Record<DirectContactChannel, boolean>;
    recordedBy: ObjectId;
    requestId: string;
  },
  tx: Tx
): Promise<DirectContactChannel[]> {
  const states = await db
    .collection<ConsentStateDoc>(MARKETING_COLLECTIONS.consentStates)
    .find({ companyId: args.companyId, contactId: args.contactId, purpose: PURPOSE }, { session: tx.session })
    .toArray();
  const changed: DirectContactChannel[] = [];

  // Telegram consent is never touched here: saving the contact form must not grant or withdraw it.
  for (const channel of DIRECT_CONTACT_CHANNELS) {
    const granted = states.some((state) => state.channel === channel && state.status === "granted");
    const wanted = args.desired[channel];
    if (wanted === granted) continue;

    if (wanted && !args.hasAddress[channel]) {
      const message =
        channel === "email"
          ? { field: "email", text: "Add an email address before recording email consent" }
          : { field: "phone", text: "Add a phone number before recording SMS consent" };
      throw new AppError("VALIDATION_ERROR", message.text, { [message.field]: message.text });
    }

    await appendConsentEvent(
      db,
      {
        companyId: args.companyId,
        contactId: args.contactId,
        channel,
        status: wanted ? "granted" : "withdrawn",
        source: "manual",
        occurredAt: new Date(),
        recordedBy: args.recordedBy,
        requestId: args.requestId,
      },
      tx
    );
    changed.push(channel);
  }
  return changed;
}

/** Records a grant or withdrawal from a company user. Requires marketing.consent.manage. */
export async function changeConsent(
  ctx: WorkspaceContext,
  contactIdRaw: string,
  input: ConsentChangeInput
): Promise<{ stateChanged: boolean; effectiveStatus: ConsentStatus }> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_CONSENT_MANAGE);
  const contactId = toObjectId(contactIdRaw);
  const contact = await assertContact(ctx.db, ctx.companyId, contactId);

  let telegramChatId: string | null = null;
  if (input.status === "granted") {
    if (input.channel === "email" && !contact.normalizedEmail) {
      throw new AppError("VALIDATION_ERROR", "This contact has no email address to consent for", { email: "Add an email address first" });
    }
    if (input.channel === "sms" && !contact.phone) {
      throw new AppError("VALIDATION_ERROR", "This contact has no phone number to consent for", { phone: "Add a phone number first" });
    }
    if (input.channel === "telegram") {
      // Pressing Start proves the customer controls the chat. It is not marketing consent, so an operator
      // records that consent explicitly, and only once a chat is linked.
      const linked = await ctx.db
        .collection<TelegramSubscriptionDoc>(MARKETING_COLLECTIONS.telegramSubscriptions)
        .findOne({ companyId: ctx.companyId, contactId, status: "active" }, { projection: { chatId: 1 } });
      if (!linked) {
        throw new AppError("VALIDATION_ERROR", "Connect this contact to Telegram before recording Telegram consent", {
          channel: "Connect Telegram first",
        });
      }
      telegramChatId = linked.chatId;
    }
  }

  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
  return withTransaction(ctx.db, async (tx) => {
    const result = await appendConsentEvent(
      ctx.db,
      {
        companyId: ctx.companyId,
        contactId,
        channel: input.channel,
        status: input.status,
        source: input.source,
        occurredAt,
        recordedBy: ctx.userId,
        requestId: ctx.requestId,
      },
      tx
    );
    await recordAudit(
      ctx.db,
      {
        companyId: ctx.companyId,
        actorUserId: ctx.userId,
        action: input.status === "granted" ? "marketing.consent.granted" : "marketing.consent.withdrawn",
        entityType: "marketing_contact",
        entityId: contactIdRaw,
        requestId: ctx.requestId,
        metadata: { channel: input.channel, source: input.source, stateChanged: result.stateChanged },
      },
      tx
    );
    // An explicit new grant lifts the opt-out that /stop recorded for this chat. A bounce or manual
    // suppression is a different reason and stays.
    if (telegramChatId && result.stateChanged) {
      await ctx.db.collection(MARKETING_COLLECTIONS.suppressions).deleteOne(
        { companyId: ctx.companyId, channel: "telegram", normalizedDestination: telegramChatId, reason: "unsubscribed" },
        { session: tx.session }
      );
    }
    return result;
  });
}

export async function getConsentState(ctx: WorkspaceContext, contactIdRaw: string): Promise<ConsentDto> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_READ);
  const states = await ctx.db
    .collection<ConsentStateDoc>(MARKETING_COLLECTIONS.consentStates)
    .find({ ...scopeOf(ctx), contactId: toObjectId(contactIdRaw), purpose: PURPOSE })
    .toArray();
  const source = await latestSources(ctx.db, ctx, toObjectId(contactIdRaw));
  const dto = (channel: MarketingChannel): ConsentStateDto | null => {
    const state = states.find((item) => item.channel === channel);
    if (!state) return null;
    return {
      status: state.status,
      occurredAt: state.occurredAt.toISOString(),
      source: source.get(channel) ?? null,
    };
  };
  return { email: dto("email"), sms: dto("sms"), telegram: dto("telegram") };
}

async function latestSources(db: Db, ctx: WorkspaceContext, contactId: ObjectId): Promise<Map<MarketingChannel, ConsentSource>> {
  const events = await db
    .collection<ConsentEventDoc>(MARKETING_COLLECTIONS.consentEvents)
    .find({ ...scopeOf(ctx), contactId })
    .sort({ occurredAt: -1, _id: -1 })
    .limit(20)
    .toArray();
  const result = new Map<MarketingChannel, ConsentSource>();
  for (const event of events) {
    if (!result.has(event.channel)) result.set(event.channel, event.source);
  }
  return result;
}

/** Full consent history, newest first. Bounded, because history only grows. */
export async function listConsentHistory(ctx: WorkspaceContext, contactIdRaw: string): Promise<ConsentEventDto[]> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_READ);
  const events = await ctx.db
    .collection<ConsentEventDoc>(MARKETING_COLLECTIONS.consentEvents)
    .find({ ...scopeOf(ctx), contactId: toObjectId(contactIdRaw) })
    .sort({ occurredAt: -1, _id: -1 })
    .limit(100)
    .toArray();
  return events.map((event) => ({
    id: event._id.toHexString(),
    channel: event.channel,
    status: event.status,
    source: event.source,
    occurredAt: event.occurredAt.toISOString(),
    recordedAt: event.recordedAt.toISOString(),
    recordedByUser: event.recordedBy !== null,
  }));
}

