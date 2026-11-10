"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  bulkTagSchema,
  consentChangeSchema,
  contactCreateSchema,
  contactUpdateSchema,
  tagInputSchema,
} from "@/features/marketing/schemas/marketing.schema";
import { objectIdSchema } from "@/shared/lib/schema-primitives";
import { parseInput, runAction } from "@/server/actions/run-action";
import type { ActionResult } from "@/shared/lib/errors";
import { createContact, deleteContact, getContact, setContactActive, updateContact, type ContactDetailDto, type ContactDto } from "@/server/marketing/contact.service";
import { changeConsent } from "@/server/marketing/consent.service";
import { createTelegramLink, disconnectTelegram, type TelegramLinkDto } from "@/server/marketing/telegram.service";
import { assignTags, createTag, deleteTag, removeTags, updateTag, type TagDto } from "@/server/marketing/tag.service";

function refresh(): void {
  revalidatePath("/marketing", "layout");
}

const activeSchema = z.object({ isActive: z.boolean(), expectedVersion: z.number().int().min(1) }).strict();
const removeTagSchema = z.object({ contactIds: z.array(objectIdSchema).min(1).max(50), tagId: objectIdSchema }).strict();

export async function createContactAction(raw: unknown): Promise<ActionResult<ContactDto>> {
  return runAction("marketing.contact.create", async (ctx) => {
    const result = await createContact(ctx, parseInput(contactCreateSchema, raw));
    refresh();
    return result;
  });
}

export async function updateContactAction(id: unknown, raw: unknown): Promise<ActionResult<ContactDto>> {
  return runAction("marketing.contact.update", async (ctx) => {
    const contactId = parseInput(objectIdSchema, id);
    const result = await updateContact(ctx, contactId, parseInput(contactUpdateSchema, raw));
    refresh();
    return result;
  });
}

export async function setContactActiveAction(id: unknown, raw: unknown): Promise<ActionResult<ContactDto>> {
  return runAction("marketing.contact.active", async (ctx) => {
    const contactId = parseInput(objectIdSchema, id);
    const input = parseInput(activeSchema, raw);
    const result = await setContactActive(ctx, contactId, input.isActive, input.expectedVersion);
    refresh();
    return result;
  });
}

export async function deleteContactAction(id: unknown): Promise<ActionResult<null>> {
  return runAction("marketing.contact.delete", async (ctx) => {
    await deleteContact(ctx, parseInput(objectIdSchema, id));
    refresh();
    return null;
  });
}

export async function changeConsentAction(id: unknown, raw: unknown): Promise<ActionResult<ContactDetailDto>> {
  return runAction("marketing.consent.change", async (ctx) => {
    const contactId = parseInput(objectIdSchema, id);
    await changeConsent(ctx, contactId, parseInput(consentChangeSchema, raw));
    refresh();
    return getContact(ctx, contactId);
  });
}

export async function createTagAction(raw: unknown): Promise<ActionResult<TagDto>> {
  return runAction("marketing.tag.create", async (ctx) => {
    const result = await createTag(ctx, parseInput(tagInputSchema, raw));
    refresh();
    return result;
  });
}

export async function updateTagAction(id: unknown, raw: unknown): Promise<ActionResult<TagDto>> {
  return runAction("marketing.tag.update", async (ctx) => {
    const result = await updateTag(ctx, parseInput(objectIdSchema, id), parseInput(tagInputSchema, raw));
    refresh();
    return result;
  });
}

export async function deleteTagAction(id: unknown): Promise<ActionResult<null>> {
  return runAction("marketing.tag.delete", async (ctx) => {
    await deleteTag(ctx, parseInput(objectIdSchema, id));
    refresh();
    return null;
  });
}

/** Assigns one tag to up to 50 contacts. Duplicate links are skipped. */
export async function assignTagsAction(raw: unknown): Promise<ActionResult<{ assigned: number; skipped: number }>> {
  return runAction("marketing.tag.assign", async (ctx) => {
    const input = parseInput(bulkTagSchema, raw);
    const result = await assignTags(ctx, input.contactIds, input.tagId);
    refresh();
    return result;
  });
}

export async function removeTagsAction(raw: unknown): Promise<ActionResult<{ removed: number }>> {
  return runAction("marketing.tag.remove", async (ctx) => {
    const input = parseInput(removeTagSchema, raw);
    const result = await removeTags(ctx, input.contactIds, input.tagId);
    refresh();
    return result;
  });
}

/** A fresh single-use deep link. Limited to a few per minute: each one invalidates the previous link. */
export async function createTelegramLinkAction(id: unknown): Promise<ActionResult<TelegramLinkDto>> {
  return runAction(
    "marketing.telegram.link",
    async (ctx) => {
      const result = await createTelegramLink(ctx, parseInput(objectIdSchema, id));
      refresh();
      return result;
    },
    { rateLimit: { limit: 10, windowMs: 60_000 } }
  );
}

export async function disconnectTelegramAction(id: unknown): Promise<ActionResult<null>> {
  return runAction(
    "marketing.telegram.disconnect",
    async (ctx) => {
      await disconnectTelegram(ctx, parseInput(objectIdSchema, id));
      refresh();
      return null;
    },
    { rateLimit: { limit: 20, windowMs: 60_000 } }
  );
}
