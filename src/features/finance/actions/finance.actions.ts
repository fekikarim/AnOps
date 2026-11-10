"use server";

import { revalidatePath } from "next/cache";
import { getFinanceService } from "@/server/services/finance.service";
import { getCurrentAuthUser } from "@/server/auth/rbac";
import { isAppError } from "@/shared/lib/errors";
import { customerCreateSchema, customerUpdateSchema, invoiceCreateDraftSchema, invoiceVoidSchema, paymentRecordSchema, paymentAllocateSchema, expenseCreateSchema, expenseRejectSchema } from "@/features/finance/schemas/finance.schema";

export type ActionResult<T = unknown> = { success?: boolean; error?: string; data?: T };

/** Person-facing errors (AppError) are shown as written; anything else is logged by name and replaced by the fallback. */
function safeMessage(error: unknown, fallback: string): string {
  if (isAppError(error)) return error.message;
  console.error("[finance.action]", fallback, error instanceof Error ? error.name : "unknown");
  return fallback;
}

export async function createCustomerAction(input: FormData | Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  try {
    const auth = await getCurrentAuthUser("finance");
    if (!auth) return { error: "Unauthorized" };

    const raw = input instanceof FormData ? {
      name: input.get("name"),
      email: input.get("email") || "",
      phone: input.get("phone") || "",
      taxId: input.get("taxId") || "",
      address: input.get("address") || "",
      notes: input.get("notes") || "",
      status: input.get("status") || "active",
    } : input;

    const parsed = customerCreateSchema.safeParse(raw);
    if (!parsed.success) {
        const msg = parsed.error.issues[0]?.message || "Invalid input";
      return { error: msg };
    }

    const service = await getFinanceService();
    const id = await service.createCustomer(parsed.data, auth.userId);
    revalidatePath("/finance/customers");
    revalidatePath("/finance/invoices");
    return { success: true, data: { id } };
  } catch (e) {
    const msg = safeMessage(e, "Failed to create customer");
    return { error: msg };
  }
}

export async function updateCustomerAction(id: string, input: FormData | Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  try {
    const auth = await getCurrentAuthUser("finance");
    if (!auth) return { error: "Unauthorized" };

    const raw = input instanceof FormData ? {
      name: input.get("name") || undefined,
      email: input.get("email") || "",
      phone: input.get("phone") || "",
      taxId: input.get("taxId") || "",
      address: input.get("address") || "",
      notes: input.get("notes") || "",
      status: input.get("status") || undefined,
    } : input;

    const parsed = customerUpdateSchema.safeParse(raw);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message || "Invalid input";
      return { error: msg };
    }

    const service = await getFinanceService();
    await service.updateCustomer(id, parsed.data, auth.userId);
    revalidatePath("/finance/customers");
    revalidatePath("/finance/invoices");
    return { success: true, data: { id } };
  } catch (e) {
    const msg = safeMessage(e, "Failed to update customer");
    return { error: msg };
  }
}

export async function deleteCustomerAction(id: string): Promise<ActionResult<{ deactivated?: boolean; message?: string }>> {
  try {
    const auth = await getCurrentAuthUser("finance");
    if (!auth) return { error: "Unauthorized" };

    const service = await getFinanceService();
    const result = await service.deleteCustomer(id, auth.userId);
    revalidatePath("/finance/customers");
    revalidatePath("/finance/invoices");
    return { success: true, data: result };
  } catch (e) {
    const msg = safeMessage(e, "Failed to delete customer");
    return { error: msg };
  }
}

export async function createInvoiceDraftAction(formData: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const auth = await getCurrentAuthUser("finance");
    if (!auth) return { error: "Unauthorized" };

    const linesRaw = formData.get("lines");
    let lines: unknown[] = [];
    if (typeof linesRaw === "string") {
      try { lines = JSON.parse(linesRaw); } catch { lines = []; }
    }

    const raw = {
      customerId: formData.get("customerId"),
      currency: formData.get("currency") || "TND",
      issueDate: formData.get("issueDate"),
      dueDate: formData.get("dueDate") || "",
      notes: formData.get("notes") || "",
      terms: formData.get("terms") || "",
      stampDuty: formData.get("stampDuty") === "true",
      lines,
    };

    const parsed = invoiceCreateDraftSchema.safeParse(raw);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message || "Invalid input";
      return { error: msg };
    }

    const service = await getFinanceService();
    const id = await service.createInvoiceDraft(parsed.data, auth.userId);
    revalidatePath("/finance/invoices");
    return { success: true, data: { id } };
  } catch (e) {
    const msg = safeMessage(e, "Failed to create invoice");
    return { error: msg };
  }
}

export async function updateInvoiceDraftAction(invoiceId: string, formData: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const auth = await getCurrentAuthUser("finance");
    if (!auth) return { error: "Unauthorized" };

    const linesRaw = formData.get("lines");
    let lines: unknown[] = [];
    if (typeof linesRaw === "string") {
      try { lines = JSON.parse(linesRaw); } catch { lines = []; }
    }
    const parsed = invoiceCreateDraftSchema.safeParse({
      customerId: formData.get("customerId"),
      currency: formData.get("currency") || "TND",
      issueDate: formData.get("issueDate"),
      dueDate: formData.get("dueDate") || "",
      notes: formData.get("notes") || "",
      terms: formData.get("terms") || "",
      stampDuty: formData.get("stampDuty") === "true",
      lines,
    });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Invalid input" };

    const service = await getFinanceService();
    await service.updateInvoiceDraft(invoiceId, parsed.data, auth.userId);
    revalidatePath("/finance/invoices");
    revalidatePath(`/finance/invoices/${invoiceId}`);
    return { success: true, data: { id: invoiceId } };
  } catch (e) {
    const msg = safeMessage(e, "Failed to update invoice");
    return { error: msg };
  }
}

export async function deleteInvoiceDraftAction(invoiceId: string): Promise<ActionResult> {
  try {
    const auth = await getCurrentAuthUser("finance");
    if (!auth) return { error: "Unauthorized" };
    const service = await getFinanceService();
    await service.deleteInvoiceDraft(invoiceId, auth.userId);
    revalidatePath("/finance/invoices");
    revalidatePath("/finance");
    return { success: true };
  } catch (e) {
    const msg = safeMessage(e, "Failed to delete invoice");
    return { error: msg };
  }
}

export async function duplicateInvoiceAction(invoiceId: string): Promise<ActionResult<{ id: string }>> {
  try {
    const auth = await getCurrentAuthUser("finance");
    if (!auth) return { error: "Unauthorized" };
    const service = await getFinanceService();
    const id = await service.duplicateInvoice(invoiceId, auth.userId);
    revalidatePath("/finance/invoices");
    return { success: true, data: { id } };
  } catch (e) {
    return { error: safeMessage(e, "Failed to duplicate invoice") };
  }
}

export async function createCreditNoteAction(invoiceId: string, input: { amount: number; reason: string }): Promise<ActionResult<{ number: string }>> {
  try {
    const auth = await getCurrentAuthUser("finance");
    if (!auth) return { error: "Unauthorized" };
    const service = await getFinanceService();
    const note = await service.createCreditNote(invoiceId, { amount: Number(input.amount), reason: String(input.reason ?? "").slice(0, 300) }, auth.userId);
    revalidatePath("/finance/invoices");
    revalidatePath(`/finance/invoices/${invoiceId}`);
    revalidatePath("/finance");
    return { success: true, data: { number: note.number } };
  } catch (e) {
    return { error: safeMessage(e, "Failed to create credit note") };
  }
}

export async function reverseAllocationAction(allocationId: string, invoiceId: string, reason: string): Promise<ActionResult> {
  try {
    const auth = await getCurrentAuthUser("finance");
    if (!auth) return { error: "Unauthorized" };
    const service = await getFinanceService();
    await service.reverseAllocation(allocationId, String(reason ?? ""), auth.userId);
    revalidatePath(`/finance/invoices/${invoiceId}`);
    revalidatePath("/finance/payments");
    revalidatePath("/finance");
    return { success: true };
  } catch (e) {
    return { error: safeMessage(e, "Failed to reverse the allocation") };
  }
}

export async function postInvoiceAction(invoiceId: string): Promise<ActionResult> {
  try {
    const auth = await getCurrentAuthUser("finance");
    if (!auth) return { error: "Unauthorized" };
    const service = await getFinanceService();
    await service.postInvoice(invoiceId, auth.userId);
    revalidatePath("/finance/invoices");
    revalidatePath(`/finance/invoices/${invoiceId}`);
    revalidatePath("/finance");
    return { success: true };
  } catch (e) {
    const msg = safeMessage(e, "Failed to post invoice");
    return { error: msg };
  }
}

export async function voidInvoiceAction(input: FormData | { invoiceId: string; reason: string }): Promise<ActionResult> {
  try {
    const auth = await getCurrentAuthUser("finance");
    if (!auth) return { error: "Unauthorized" };
    const raw = input instanceof FormData
      ? { invoiceId: input.get("invoiceId"), reason: input.get("reason") }
      : input;
    const parsed = invoiceVoidSchema.safeParse(raw);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Invalid input" };
    const service = await getFinanceService();
    await service.voidInvoice(parsed.data.invoiceId, parsed.data.reason, auth.userId);
    revalidatePath("/finance/invoices");
    revalidatePath(`/finance/invoices/${parsed.data.invoiceId}`);
    revalidatePath("/finance");
    return { success: true };
  } catch (e) {
    const msg = safeMessage(e, "Failed to void invoice");
    return { error: msg };
  }
}

export async function exportInvoicesCsvAction(): Promise<ActionResult<{ csv: string; filename: string }>> {
  try {
    const auth = await getCurrentAuthUser("finance");
    if (!auth) return { error: "Unauthorized" };
    const service = await getFinanceService();
    const csv = await service.exportInvoicesCsv();
    const filename = `invoices_${new Date().toISOString().slice(0, 10)}.csv`;
    return { success: true, data: { csv, filename } };
  } catch (e) {
    const msg = safeMessage(e, "Failed to export invoices");
    return { error: msg };
  }
}

export async function recordPaymentAction(formData: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const auth = await getCurrentAuthUser("finance");
    if (!auth) return { error: "Unauthorized" };
    const raw = {
      paymentDate: formData.get("paymentDate"),
      amount: formData.get("amount"),
      currency: formData.get("currency") || "TND",
      method: formData.get("method") || "bank_transfer",
      reference: formData.get("reference") || "",
      notes: formData.get("notes") || "",
    };
    const parsed = paymentRecordSchema.safeParse(raw);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Invalid input" };
    const service = await getFinanceService();
    const id = await service.recordPayment(parsed.data, auth.userId);
    revalidatePath("/finance/payments");
    return { success: true, data: { id } };
  } catch (e) {
    const msg = safeMessage(e, "Failed to record payment");
    return { error: msg };
  }
}

export async function allocatePaymentAction(input: FormData | { paymentId: string; allocations: Array<{ invoiceId: string; amount: number }> }): Promise<ActionResult> {
  try {
    const auth = await getCurrentAuthUser("finance");
    if (!auth) return { error: "Unauthorized" };
    let paymentId: string;
    let allocations: unknown[] = [];
    if (input instanceof FormData) {
      paymentId = String(input.get("paymentId") || "");
      const allocRaw = input.get("allocations");
      if (typeof allocRaw === "string") {
        try { allocations = JSON.parse(allocRaw); } catch { allocations = []; }
      }
    } else {
      paymentId = input.paymentId;
      allocations = input.allocations;
    }
    const parsed = paymentAllocateSchema.safeParse({ paymentId, allocations });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Invalid input" };
    const service = await getFinanceService();
    await service.allocatePayment(parsed.data.paymentId, parsed.data.allocations, auth.userId);
    revalidatePath("/finance/payments");
    revalidatePath("/finance/invoices");
    revalidatePath("/finance");
    return { success: true };
  } catch (e) {
    const msg = safeMessage(e, "Failed to allocate payment");
    return { error: msg };
  }
}

export async function exportPaymentsCsvAction(): Promise<ActionResult<{ csv: string; filename: string }>> {
  try {
    const auth = await getCurrentAuthUser("finance");
    if (!auth) return { error: "Unauthorized" };
    const service = await getFinanceService();
    const csv = await service.exportPaymentsCsv();
    const filename = `payments_${new Date().toISOString().slice(0, 10)}.csv`;
    return { success: true, data: { csv, filename } };
  } catch (e) {
    const msg = safeMessage(e, "Failed to export payments");
    return { error: msg };
  }
}

export async function createExpenseAction(input: FormData | Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  try {
    const auth = await getCurrentAuthUser("finance");
    if (!auth) return { error: "Unauthorized" };
    const raw = input instanceof FormData ? {
      expenseDate: input.get("expenseDate"),
      categoryId: input.get("categoryId") || "",
      vendor: input.get("vendor") || "",
      description: input.get("description"),
      amount: input.get("amount"),
      tax: input.get("tax") || 0,
      currency: input.get("currency") || "TND",
      notes: input.get("notes") || "",
      receiptDocumentId: input.get("receiptDocumentId") || "",
    } : input;
    const parsed = expenseCreateSchema.safeParse(raw);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Invalid input" };
    const service = await getFinanceService();
    const id = await service.createExpense(parsed.data, auth.userId);
    revalidatePath("/finance/expenses");
    revalidatePath("/finance");
    return { success: true, data: { id } };
  } catch (e) {
    const msg = safeMessage(e, "Failed to create expense");
    return { error: msg };
  }
}

export async function updateExpenseAction(expenseId: string, input: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  try {
    const auth = await getCurrentAuthUser("finance");
    if (!auth) return { error: "Unauthorized" };
    const parsed = expenseCreateSchema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Invalid input" };
    const service = await getFinanceService();
    await service.updateExpense(expenseId, parsed.data, auth.userId);
    revalidatePath("/finance/expenses");
    revalidatePath("/finance");
    return { success: true, data: { id: expenseId } };
  } catch (e) {
    const msg = safeMessage(e, "Failed to update expense");
    return { error: msg };
  }
}

export async function deleteExpenseAction(expenseId: string): Promise<ActionResult> {
  try {
    const auth = await getCurrentAuthUser("finance");
    if (!auth) return { error: "Unauthorized" };
    const service = await getFinanceService();
    await service.deleteExpense(expenseId, auth.userId);
    revalidatePath("/finance/expenses");
    revalidatePath("/finance");
    revalidatePath("/finance/receipts");
    return { success: true };
  } catch (e) {
    const msg = safeMessage(e, "Failed to delete expense");
    return { error: msg };
  }
}

export async function submitExpenseAction(expenseId: string): Promise<ActionResult> {
  try {
    const auth = await getCurrentAuthUser("finance");
    if (!auth) return { error: "Unauthorized" };
    const service = await getFinanceService();
    await service.submitExpense(expenseId, auth.userId);
    revalidatePath("/finance/expenses");
    revalidatePath("/finance");
    return { success: true };
  } catch (e) {
    const msg = safeMessage(e, "Failed to submit expense");
    return { error: msg };
  }
}

export async function approveExpenseAction(expenseId: string): Promise<ActionResult> {
  try {
    const auth = await getCurrentAuthUser("finance");
    if (!auth) return { error: "Unauthorized" };
    const service = await getFinanceService();
    await service.approveExpense(expenseId, auth.userId);
    revalidatePath("/finance/expenses");
    revalidatePath("/finance");
    return { success: true };
  } catch (e) {
    const msg = safeMessage(e, "Failed to approve expense");
    return { error: msg };
  }
}

export async function rejectExpenseAction(input: FormData | { expenseId: string; reason: string }): Promise<ActionResult> {
  try {
    const auth = await getCurrentAuthUser("finance");
    if (!auth) return { error: "Unauthorized" };
    const raw = input instanceof FormData
      ? { expenseId: input.get("expenseId"), reason: input.get("reason") }
      : input;
    const parsed = expenseRejectSchema.safeParse(raw);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Invalid input" };
    const service = await getFinanceService();
    await service.rejectExpense(parsed.data.expenseId, parsed.data.reason, auth.userId);
    revalidatePath("/finance/expenses");
    revalidatePath("/finance");
    return { success: true };
  } catch (e) {
    const msg = safeMessage(e, "Failed to reject expense");
    return { error: msg };
  }
}

export async function markExpensePaidAction(expenseId: string): Promise<ActionResult> {
  try {
    const auth = await getCurrentAuthUser("finance");
    if (!auth) return { error: "Unauthorized" };
    const service = await getFinanceService();
    await service.markExpensePaid(expenseId, auth.userId);
    revalidatePath("/finance/expenses");
    revalidatePath("/finance");
    return { success: true };
  } catch (e) {
    const msg = safeMessage(e, "Failed to mark expense paid");
    return { error: msg };
  }
}

export async function createExpenseCategoryAction(name: string): Promise<ActionResult<{ id: string }>> {
  try {
    const auth = await getCurrentAuthUser("finance");
    if (!auth) return { error: "Unauthorized" };
    const service = await getFinanceService();
    const id = await service.createExpenseCategory(name);
    revalidatePath("/finance/expenses");
    return { success: true, data: { id } };
  } catch (e) {
    const msg = safeMessage(e, "Failed to create category");
    return { error: msg };
  }
}

export async function exportExpensesCsvAction(): Promise<ActionResult<{ csv: string; filename: string }>> {
  try {
    const auth = await getCurrentAuthUser("finance");
    if (!auth) return { error: "Unauthorized" };
    const service = await getFinanceService();
    const csv = await service.exportExpensesCsv();
    const filename = `expenses_${new Date().toISOString().slice(0, 10)}.csv`;
    return { success: true, data: { csv, filename } };
  } catch (e) {
    const msg = safeMessage(e, "Failed to export expenses");
    return { error: msg };
  }
}
