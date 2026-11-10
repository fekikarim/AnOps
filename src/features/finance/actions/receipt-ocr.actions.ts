"use server";

import { revalidatePath } from "next/cache";
import { getFinanceService } from "@/server/services/finance.service";
import { assertWorkspaceAppAccess } from "@/server/platform/access";
import { resolveWorkspace } from "@/server/tenancy/workspace";
import { applyReceiptToExpense, scanReceipt, type ReceiptScan } from "@/server/finance/receipt-ocr.service";
import { MAX_RECEIPT_BYTES } from "@/server/finance/receipt-storage";
import { expenseCreateSchema } from "@/features/finance/schemas/finance.schema";
import { isAppError } from "@/shared/lib/errors";

export type ActionResult<T = unknown> = { success?: boolean; error?: string; data?: T };

const MAX_FILES_PER_SCAN = 1;

function message(error: unknown, fallback: string): string {
  // AppErrors carry person-facing wording; anything else is an internal failure and is not shown.
  if (isAppError(error)) return error.message;
  console.error("[finance.receipt]", error instanceof Error ? error.name : "unknown");
  return fallback;
}

/** Scans one receipt (photo, PDF, or pasted text) and returns the proposal for review. */
export async function scanReceiptAction(formData: FormData): Promise<ActionResult<ReceiptScan>> {
  try {
    const ctx = await resolveWorkspace();
    await assertWorkspaceAppAccess(ctx, "finance");
    const files = formData.getAll("receipt").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length > MAX_FILES_PER_SCAN) return { error: "Scan one receipt at a time." };
    const file = files[0];
    if (file && file.size > MAX_RECEIPT_BYTES) return { error: "Receipts can be at most 10 MB." };

    const scan = await scanReceipt(ctx, {
      bytes: file ? new Uint8Array(await file.arrayBuffer()) : undefined,
      originalName: file?.name,
      text: String(formData.get("receiptText") ?? ""),
      note: String(formData.get("notes") ?? ""),
      source: "upload",
    });
    revalidatePath("/finance/receipts");
    return { success: true, data: scan };
  } catch (e) {
    return { error: message(e, "The receipt could not be scanned. Try again.") };
  }
}

/** Creates a draft (or submitted) expense from the values the reviewer confirmed. */
export async function applyReceiptAction(
  extractionId: string,
  values: Record<string, unknown>,
  opts: { submit?: boolean } = {}
): Promise<ActionResult<{ expenseId: string }>> {
  try {
    const parsed = expenseCreateSchema.safeParse(values);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Invalid input" };
    const ctx = await resolveWorkspace();
    await assertWorkspaceAppAccess(ctx, "finance");
    const result = await applyReceiptToExpense(ctx, extractionId, parsed.data, { submit: !!opts.submit });
    revalidatePath("/finance/receipts");
    revalidatePath("/finance/expenses");
    revalidatePath("/finance");
    return { success: true, data: result };
  } catch (e) {
    return { error: message(e, "The expense could not be created.") };
  }
}

export async function deleteReceiptExtractionAction(id: string): Promise<ActionResult> {
  try {
    const service = await getFinanceService();
    await service.deleteReceiptExtraction(id);
    revalidatePath("/finance/receipts");
    return { success: true };
  } catch (e) {
    return { error: message(e, "Failed to delete the receipt.") };
  }
}

export async function markReceiptReviewedAction(id: string): Promise<ActionResult> {
  try {
    const service = await getFinanceService();
    await service.markReceiptReviewed(id);
    revalidatePath("/finance/receipts");
    return { success: true };
  } catch (e) {
    return { error: message(e, "Failed to mark the receipt reviewed.") };
  }
}
