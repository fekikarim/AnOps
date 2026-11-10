"use server";

import { assertWorkspaceAppAccess } from "@/server/platform/access";
import { resolveWorkspace } from "@/server/tenancy/workspace";
import { fin } from "@/server/ai/tools/finance.tools";
import { draftPaymentReminder, getDashboardInsights, suggestExpenseCategory, type CategorySuggestion, type InsightBullet, type ReminderDraft } from "@/server/finance/finance-ai.service";
import { forecastCashFlow } from "@/features/finance/utils/insights";
import { todayTunis } from "@/server/ai/finance/money";
import { isAppError } from "@/shared/lib/errors";

export type ActionResult<T = unknown> = { success?: boolean; error?: string; data?: T };
const message = (e: unknown, fallback: string) => (isAppError(e) ? e.message : fallback);

export async function suggestCategoryAction(input: { vendor?: string; description?: string }): Promise<ActionResult<CategorySuggestion | null>> {
  try {
    const ctx = await resolveWorkspace();
    await assertWorkspaceAppAccess(ctx, "finance");
    return { success: true, data: await suggestExpenseCategory(ctx, { vendor: String(input.vendor ?? "").slice(0, 120), description: String(input.description ?? "").slice(0, 300) }) };
  } catch (e) {
    return { error: message(e, "No suggestion right now.") };
  }
}

export async function draftReminderAction(invoiceId: string, tone: "friendly" | "firm"): Promise<ActionResult<ReminderDraft>> {
  try {
    const ctx = await resolveWorkspace();
    await assertWorkspaceAppAccess(ctx, "finance");
    return { success: true, data: await draftPaymentReminder(ctx, invoiceId, tone === "firm" ? "firm" : "friendly") };
  } catch (e) {
    return { error: message(e, "The reminder could not be drafted.") };
  }
}

/** The facts are rebuilt here from the database; nothing the browser sends reaches the prompt. */
export async function dashboardInsightsAction(currency: string, refresh = false): Promise<ActionResult<{ bullets: InsightBullet[]; generatedAt: string; cached: boolean }>> {
  try {
    const ctx = await resolveWorkspace();
    await assertWorkspaceAppAccess(ctx, "finance");
    const service = fin(ctx);
    const d = await service.getDashboard(/^[A-Z]{3}$/.test(currency) ? currency : undefined);
    const open = (await service.listUnpaidInvoices()).filter((i) => i.currency === d.currency);
    const forecast = forecastCashFlow({ today: todayTunis(), openInvoices: open, monthlyExpenses: d.monthlySummary.slice(0, -1).map((m) => m.expenses) });
    const facts = {
      currency: d.currency,
      invoicedTotal: d.totalInvoiced,
      collected: d.totalPaid,
      outstanding: d.outstanding,
      overdueAmount: d.overdue,
      overdueInvoices: d.overdueCount,
      topOverdue: d.topOverdueInvoices.slice(0, 3).map((i) => ({ invoice: i.invoiceNumber, customer: i.customerName, due: i.dueDate, balance: i.balance })),
      expensesWaitingApproval: d.expensesSubmitted,
      expensesApprovedUnpaid: d.expensesApproved,
      last6Months: d.monthlySummary.map((m) => ({ month: m.label, income: m.income, expenses: m.expenses })),
      forecast: forecast.windows,
    };
    return { success: true, data: await getDashboardInsights(ctx, facts, { refresh }) };
  } catch (e) {
    return { error: message(e, "Insights are not available right now.") };
  }
}

export async function sendInvoiceEmailAction(invoiceId: string, input: { to?: string; message?: string }): Promise<ActionResult<{ to: string; sentAt: string }>> {
  try {
    const ctx = await resolveWorkspace();
    await assertWorkspaceAppAccess(ctx, "finance");
    const { sendInvoiceEmail } = await import("@/server/finance/invoice-email");
    return { success: true, data: await sendInvoiceEmail(ctx, invoiceId, { to: String(input.to ?? "").slice(0, 200), message: String(input.message ?? "").slice(0, 2000) }) };
  } catch (e) {
    return { error: message(e, "The invoice could not be sent.") };
  }
}
