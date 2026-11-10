"use server";

import { revalidatePath } from "next/cache";
import { assertWorkspaceAppAccess } from "@/server/platform/access";
import { resolveWorkspace } from "@/server/tenancy/workspace";
import { createStaffTelegramLink, disconnectStaffTelegram } from "@/server/finance/telegram-receipts.service";
import { isAppError } from "@/shared/lib/errors";

export type ActionResult<T = unknown> = { success?: boolean; error?: string; data?: T };

const message = (e: unknown, fallback: string) => (isAppError(e) ? e.message : fallback);

/** A single-use link that connects the signed-in member's Telegram chat to this company's receipts. */
export async function createTelegramReceiptLinkAction(): Promise<ActionResult<{ url: string; expiresAt: string }>> {
  try {
    const ctx = await resolveWorkspace();
    await assertWorkspaceAppAccess(ctx, "finance");
    return { success: true, data: await createStaffTelegramLink(ctx) };
  } catch (e) {
    return { error: message(e, "The Telegram link could not be created.") };
  }
}

export async function disconnectTelegramReceiptsAction(): Promise<ActionResult> {
  try {
    const ctx = await resolveWorkspace();
    await assertWorkspaceAppAccess(ctx, "finance");
    await disconnectStaffTelegram(ctx);
    revalidatePath("/finance/receipts");
    return { success: true };
  } catch (e) {
    return { error: message(e, "Telegram could not be disconnected.") };
  }
}
