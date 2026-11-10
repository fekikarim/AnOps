import "server-only";
import { ObjectId, type Db, type Filter, type Sort } from "mongodb";
import { MARKETING_COLLECTIONS, type ContactDoc, type ContactTagDoc, type TagDoc } from "@/server/marketing/documents";
import type { ContactSource, LifecycleStage } from "@/features/marketing/types/constants";
import { recordAudit } from "@/server/audit/audit.service";
import { withTransaction, type Tx, isDuplicateKeyError } from "@/server/db/transactions";
import type { WorkspaceContext } from "@/server/tenancy/workspace";
import { AppError } from "@/shared/lib/errors";
import type { ContactCreateInput, ContactListQuery, ContactUpdateInput } from "@/features/marketing/schemas/marketing.schema";
import { normalizeEmail, normalizePhone, searchNameOf } from "@/features/marketing/utils/normalize";
import { appendConsentEvent, getConsentState, syncConsentStatuses, type ConsentDto } from "@/server/marketing/consent.service";
import {
  literalRegex,
  MARKETING_PAGE_SIZE,
  pageMeta,
  requireMarketing,
  scopeOf,
  skipOf,
  tagIdsFromParam,
  toObjectId,
} from "@/server/marketing/common";
import { PERMISSIONS } from "@/server/security/permissions";
import { contactTagIdsFor } from "@/server/marketing/tag-filter";
import type { Paged } from "@/features/inventory/types";

export type ContactDto = {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone: string;
  source: ContactSource;
  lifecycleStage: LifecycleStage;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type TagSummaryDto = { id: string; name: string; color: string };

export type ContactDetailDto = ContactDto & {
  tags: TagSummaryDto[];
  consent: ConsentDto;
  hasHistory: boolean;
};

export function toContactDto(doc: ContactDoc): ContactDto {
  return {
    id: doc._id.toHexString(),
    firstName: doc.firstName,
    lastName: doc.lastName,
    fullName: `${doc.firstName} ${doc.lastName}`.trim(),
    email: doc.email,
    phone: doc.phone,
    source: doc.source,
    lifecycleStage: doc.lifecycleStage,
    isActive: doc.isActive,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    version: doc.version,
  };
}

/** Trims and normalizes the validated contact fields. Email is stored lower-cased, phone in E.164-like form. */
export function normalizeContactFields(input: Pick<ContactCreateInput, "firstName" | "lastName" | "email" | "phone">) {
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone) ?? "";
  return {
    firstName,
    lastName,
    email,
    phone,
    searchName: searchNameOf(firstName, lastName),
    ...(email === "" ? {} : { normalizedEmail: email }),
  };
}

function duplicateEmailError(): AppError {
  return new AppError("CONFLICT", "A contact with this email address already exists", {
    email: "This email address is already a contact in your company",
  });
}

/** Builds the list filter. Every clause is typed; user text is escaped and length-capped before use. */
function listFilter(scope: { companyId: ObjectId }, query: ContactListQuery, tagContactIds: ObjectId[] | null): Filter<ContactDoc> {
  const filter: Filter<ContactDoc> = { companyId: scope.companyId };
  if (query.q) {
    const q = query.q.toLowerCase();
    const digits = q.replace(/\D/g, "");
    if (q.includes("@")) {
      filter.normalizedEmail = { $regex: literalRegex(q) };
    } else if (/^[+\d\s().-]+$/.test(q) && digits.length >= 3) {
      filter.phone = { $regex: `^\\+?${literalRegex(digits)}` };
    } else {
      filter.searchName = { $regex: literalRegex(q) };
    }
  }
  if (query.lifecycle !== "all") filter.lifecycleStage = query.lifecycle;
  if (query.source !== "all") filter.source = query.source;
  if (query.active !== "all") filter.isActive = query.active === "true";
  if (tagContactIds) filter._id = { $in: tagContactIds };
  return filter;
}

/** Sort fields. The allowlist is the only way a client can influence sorting. */
const SORT_FIELDS = {
  name: "searchName",
  email: "normalizedEmail",
  created: "createdAt",
} as const;

export async function listContacts(
  ctx: WorkspaceContext,
  query: ContactListQuery,
  tagIdsRaw: string = ""
): Promise<Paged<ContactDto>> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_READ);
  const tagIds = tagIdsFromParam(tagIdsRaw);
  const tagContactIds =
    tagIds.length === 0 ? null : await contactTagIdsFor(ctx.db, scopeOf(ctx), tagIds.map((id) => new ObjectId(id)), query.tagMode);

  const filter = listFilter(scopeOf(ctx), query, tagContactIds);
  const direction = query.dir === "asc" ? 1 : -1;
  const sort: Sort = { [SORT_FIELDS[query.sort]]: direction, _id: direction };

  const collection = ctx.db.collection<ContactDoc>(MARKETING_COLLECTIONS.contacts);
  const [total, docs] = await Promise.all([
    collection.countDocuments(filter),
    collection.find(filter).sort(sort).skip(skipOf(query.page)).limit(MARKETING_PAGE_SIZE).toArray(),
  ]);
  return { items: docs.map(toContactDto), ...pageMeta(query.page, total) };
}

async function loadContact(db: Db, companyId: ObjectId, id: ObjectId): Promise<ContactDoc> {
  const doc = await db.collection<ContactDoc>(MARKETING_COLLECTIONS.contacts).findOne({ _id: id, companyId });
  if (!doc) throw new AppError("NOT_FOUND", "Contact not found");
  return doc;
}

export async function getContact(ctx: WorkspaceContext, contactIdRaw: string): Promise<ContactDetailDto> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_READ);
  const contactId = toObjectId(contactIdRaw);
  const doc = await loadContact(ctx.db, ctx.companyId, contactId);
  const [links, consent, deliveryCount] = await Promise.all([
    ctx.db
      .collection<ContactTagDoc>(MARKETING_COLLECTIONS.contactTags)
      .find({ companyId: ctx.companyId, contactId })
      .toArray(),
    getConsentState(ctx, contactIdRaw),
    ctx.db
      .collection(MARKETING_COLLECTIONS.deliveries)
      .countDocuments({ companyId: ctx.companyId, contactId }, { limit: 1 }),
  ]);
  const tagDocs =
    links.length === 0
      ? []
      : await ctx.db
          .collection<TagDoc>(MARKETING_COLLECTIONS.tags)
          .find({ companyId: ctx.companyId, _id: { $in: links.map((link) => link.tagId) } })
          .sort({ normalizedName: 1 })
          .toArray();
  const consentHasEvents = await ctx.db
    .collection(MARKETING_COLLECTIONS.consentEvents)
    .countDocuments({ companyId: ctx.companyId, contactId }, { limit: 1 });
  return {
    ...toContactDto(doc),
    tags: tagDocs.map((tag) => ({ id: tag._id.toHexString(), name: tag.name, color: tag.color })),
    consent,
    hasHistory: deliveryCount > 0 || consentHasEvents > 0,
  };
}

async function consentEventsFor(
  db: Db,
  ctx: WorkspaceContext,
  contactId: ObjectId,
  contact: ContactDoc,
  consent: ContactCreateInput["consent"],
  tx: Tx
): Promise<void> {
  if (consent.email && !contact.normalizedEmail) {
    throw new AppError("VALIDATION_ERROR", "Email consent needs an email address", { email: "Add an email address to record email consent" });
  }
  if (consent.sms && !contact.phone) {
    throw new AppError("VALIDATION_ERROR", "SMS consent needs a phone number", { phone: "Add a phone number to record SMS consent" });
  }
  const now = new Date();
  for (const channel of ["email", "sms"] as const) {
    if (!consent[channel]) continue;
    await appendConsentEvent(
      db,
      {
        companyId: ctx.companyId,
        contactId,
        channel,
        status: "granted",
        source: "manual",
        occurredAt: now,
        recordedBy: ctx.userId,
        requestId: ctx.requestId,
      },
      tx
    );
  }
}

export async function createContact(ctx: WorkspaceContext, input: ContactCreateInput): Promise<ContactDto> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_CONTACT_MANAGE);
  const fields = normalizeContactFields(input);
  const now = new Date();
  const contactId = new ObjectId();
  const doc: ContactDoc = {
    _id: contactId,
    companyId: ctx.companyId,
    ...fields,
    source: input.source,
    lifecycleStage: input.lifecycleStage,
    isActive: input.isActive,
    createdBy: ctx.userId,
    updatedBy: ctx.userId,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };

  try {
    await withTransaction(ctx.db, async (tx) => {
      await ctx.db.collection<ContactDoc>(MARKETING_COLLECTIONS.contacts).insertOne(doc, { session: tx.session });
      tx.onRollback(() => ctx.db.collection(MARKETING_COLLECTIONS.contacts).deleteOne({ _id: contactId }));
      if (input.consent.email || input.consent.sms) {
        await consentEventsFor(ctx.db, ctx, contactId, doc, input.consent, tx);
      }
      await recordAudit(
        ctx.db,
        {
          companyId: ctx.companyId,
          actorUserId: ctx.userId,
          action: "marketing.contact.created",
          entityType: "marketing_contact",
          entityId: contactId.toHexString(),
          requestId: ctx.requestId,
          metadata: { source: input.source, lifecycleStage: input.lifecycleStage },
        },
        tx
      );
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) throw duplicateEmailError();
    throw error;
  }
  return toContactDto(doc);
}

export async function updateContact(ctx: WorkspaceContext, contactIdRaw: string, input: ContactUpdateInput): Promise<ContactDto> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_CONTACT_MANAGE);
  const contactId = toObjectId(contactIdRaw);
  const fields = normalizeContactFields(input);
  const { normalizedEmail, ...editable } = fields;
  const changes = {
    ...editable,
    source: input.source,
    lifecycleStage: input.lifecycleStage,
    isActive: input.isActive,
    updatedBy: ctx.userId,
    updatedAt: new Date(),
  };

  const contacts = ctx.db.collection<ContactDoc>(MARKETING_COLLECTIONS.contacts);
  try {
    return await withTransaction(ctx.db, async (tx) => {
      const before = await loadContact(ctx.db, ctx.companyId, contactId);
      let result: ContactDoc | null;
      try {
        result = await contacts.findOneAndUpdate(
          { _id: contactId, companyId: ctx.companyId, version: input.expectedVersion },
          {
            // Clearing the email removes the dedupe key, so the partial unique index stops applying.
            $set: normalizedEmail ? { ...changes, normalizedEmail } : changes,
            ...(normalizedEmail ? {} : { $unset: { normalizedEmail: "" } }),
            $inc: { version: 1 },
          },
          { returnDocument: "after", session: tx.session }
        );
      } catch (error) {
        if (isDuplicateKeyError(error)) throw duplicateEmailError();
        throw error;
      }
      if (!result) {
        throw new AppError("CONFLICT", "This contact was changed by someone else. Reload and try again.");
      }
      tx.onRollback(() => contacts.replaceOne({ _id: contactId }, before));

      // Consent is written in the same transaction, so a failed consent change never leaves a half-saved contact.
      const consentChanged = await syncConsentStatuses(
        ctx.db,
        {
          companyId: ctx.companyId,
          contactId,
          hasAddress: { email: Boolean(result.normalizedEmail), sms: result.phone !== "" },
          desired: input.consent,
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
          action: "marketing.contact.updated",
          entityType: "marketing_contact",
          entityId: contactIdRaw,
          requestId: ctx.requestId,
          metadata: { isActive: input.isActive, lifecycleStage: input.lifecycleStage, consentChanged: consentChanged.join(",") },
        },
        tx
      );
      return toContactDto(result);
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) throw duplicateEmailError();
    throw error;
  }
}

/**
 * Contacts with campaign or consent history are deactivated, never deleted, so the audit trail of
 * sends and consent decisions stays intact. Contacts without history may be deleted.
 */
export async function deleteContact(ctx: WorkspaceContext, contactIdRaw: string): Promise<void> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_CONTACT_MANAGE);
  const contactId = toObjectId(contactIdRaw);
  await loadContact(ctx.db, ctx.companyId, contactId);
  const scope = scopeOf(ctx);
  const [deliveries, consents] = await Promise.all([
    ctx.db.collection(MARKETING_COLLECTIONS.deliveries).countDocuments({ ...scope, contactId }, { limit: 1 }),
    ctx.db.collection(MARKETING_COLLECTIONS.consentEvents).countDocuments({ ...scope, contactId }, { limit: 1 }),
  ]);
  if (deliveries > 0 || consents > 0) {
    throw new AppError("CONFLICT", "This contact has campaign or consent history. Deactivate it instead of deleting it.");
  }
  await withTransaction(ctx.db, async (tx) => {
    await ctx.db.collection(MARKETING_COLLECTIONS.contactTags).deleteMany({ ...scope, contactId }, { session: tx.session });
    await ctx.db.collection(MARKETING_COLLECTIONS.contacts).deleteOne({ _id: contactId, ...scope }, { session: tx.session });
    await recordAudit(
      ctx.db,
      {
        companyId: ctx.companyId,
        actorUserId: ctx.userId,
        action: "marketing.contact.deleted",
        entityType: "marketing_contact",
        entityId: contactIdRaw,
        requestId: ctx.requestId,
      },
      tx
    );
  });
}

export async function setContactActive(ctx: WorkspaceContext, contactIdRaw: string, isActive: boolean, expectedVersion: number): Promise<ContactDto> {
  requireMarketing(ctx, PERMISSIONS.MARKETING_CONTACT_MANAGE);
  const contactId = toObjectId(contactIdRaw);
  const result = await ctx.db.collection<ContactDoc>(MARKETING_COLLECTIONS.contacts).findOneAndUpdate(
    { _id: contactId, companyId: ctx.companyId, version: expectedVersion },
    { $set: { isActive, updatedBy: ctx.userId, updatedAt: new Date() }, $inc: { version: 1 } },
    { returnDocument: "after" }
  );
  if (!result) {
    await loadContact(ctx.db, ctx.companyId, contactId);
    throw new AppError("CONFLICT", "This contact was changed by someone else. Reload and try again.");
  }
  await recordAudit(ctx.db, {
    companyId: ctx.companyId,
    actorUserId: ctx.userId,
    action: isActive ? "marketing.contact.activated" : "marketing.contact.deactivated",
    entityType: "marketing_contact",
    entityId: contactIdRaw,
    requestId: ctx.requestId,
  });
  return toContactDto(result);
}

/** Contact identity for other modules (CRM, campaigns). Returns the canonical record for a company. */
export async function findContactForCompany(db: Db, companyId: ObjectId, contactId: ObjectId): Promise<ContactDoc | null> {
  return db.collection<ContactDoc>(MARKETING_COLLECTIONS.contacts).findOne({ _id: contactId, companyId });
}

