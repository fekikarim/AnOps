import "server-only";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { sendMail } from "@/server/email/client";
import { recordAudit } from "@/server/audit/audit.service";
import { consumeSharedRateLimit } from "@/server/security/shared-rate-limit";
import { fin } from "@/server/ai/tools/finance.tools";
import type { WorkspaceContext } from "@/server/tenancy/workspace";
import { AppError } from "@/shared/lib/errors";

/**
 * Sends a posted invoice to the customer by e-mail: a complete HTML invoice (every value escaped) and a
 * plain-text copy, from the company's configured sender. Drafts are never sent. Each send is recorded on
 * the invoice (last sent at / to) and in the audit log.
 */

const SEND_RATE = { limit: 40, windowMs: 60 * 60_000 };
const emailSchema = z.string().trim().email("Enter a valid e-mail address.").max(200);

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

type Invoice = Awaited<ReturnType<ReturnType<typeof fin>["getInvoice"]>>;

export function buildInvoiceEmail(inv: Invoice, message?: string): { subject: string; html: string; text: string } {
  const m = (n: number) => `${n.toFixed(2)} ${inv.currency}`;
  const company = inv.company?.name ?? "Our company";
  const subject = `Invoice ${inv.invoiceNumber} from ${company}`;
  const rows = inv.lines
    .map(
      (l: { description: string; quantity: number; unitPrice: number; taxRate: number; lineTotal: number }) =>
        `<tr><td style="padding:8px;border-bottom:1px solid #e5e7eb">${esc(l.description)}</td><td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right">${esc(l.quantity)}</td><td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right">${esc(m(l.unitPrice))}</td><td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right">${esc(l.taxRate)}%</td><td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right">${esc(m(l.lineTotal))}</td></tr>`
    )
    .join("");
  const totals: Array<[string, string]> = [
    ["Subtotal (HT)", m(inv.subtotal)],
    ["VAT / TVA", m(inv.taxTotal)],
    ...(inv.stampDuty > 0 ? ([["Timbre fiscal", m(inv.stampDuty)]] as Array<[string, string]>) : []),
    ["Total (TTC)", m(inv.total)],
    ...(inv.amountPaid > 0 ? ([["Paid", m(inv.amountPaid)]] as Array<[string, string]>) : []),
    ...(inv.creditedAmount > 0 ? ([["Credit notes", `-${m(inv.creditedAmount)}`]] as Array<[string, string]>) : []),
    ["Balance due", m(inv.balance)],
  ];
  const html = `<!doctype html><html><body style="margin:0;background:#f6f7f9;font-family:Arial,Helvetica,sans-serif;color:#111827">
<div style="max-width:640px;margin:24px auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:24px">
  <h1 style="margin:0 0 4px;font-size:20px">${esc(company)}</h1>
  ${inv.company?.taxId ? `<p style="margin:0;color:#6b7280;font-size:12px">Matricule fiscal: ${esc(inv.company.taxId)}</p>` : ""}
  <h2 style="margin:20px 0 4px;font-size:16px">Invoice ${esc(inv.invoiceNumber)}</h2>
  <p style="margin:0;color:#374151;font-size:13px">Issued ${esc(inv.issueDate)}${inv.dueDate ? ` · Due ${esc(inv.dueDate)}` : ""}</p>
  <p style="margin:12px 0 0;font-size:13px">Billed to <strong>${esc(inv.customer?.name ?? "")}</strong>${inv.customer?.taxId ? ` (MF ${esc(inv.customer.taxId)})` : ""}</p>
  ${message ? `<p style="margin:16px 0;font-size:14px;white-space:pre-line">${esc(message)}</p>` : ""}
  <table role="presentation" style="width:100%;border-collapse:collapse;margin-top:16px;font-size:13px">
    <thead><tr style="background:#f3f4f6"><th style="padding:8px;text-align:left">Item</th><th style="padding:8px;text-align:right">Qty</th><th style="padding:8px;text-align:right">Unit price</th><th style="padding:8px;text-align:right">VAT</th><th style="padding:8px;text-align:right">Total</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <table role="presentation" style="margin:16px 0 0 auto;font-size:13px">${totals
    .map(([k, v], i) => `<tr><td style="padding:4px 16px 4px 0;color:#6b7280${i === totals.length - 1 ? ";font-weight:bold;color:#111827" : ""}">${esc(k)}</td><td style="padding:4px 0;text-align:right${i === totals.length - 1 ? ";font-weight:bold" : ""}">${esc(v)}</td></tr>`)
    .join("")}</table>
  ${inv.terms ? `<p style="margin:20px 0 0;color:#6b7280;font-size:12px">${esc(inv.terms)}</p>` : ""}
  ${inv.notes ? `<p style="margin:8px 0 0;color:#6b7280;font-size:12px">${esc(inv.notes)}</p>` : ""}
</div></body></html>`;
  const text = [
    `${company}: invoice ${inv.invoiceNumber}`,
    `Issued ${inv.issueDate}${inv.dueDate ? `, due ${inv.dueDate}` : ""}`,
    message ? `\n${message}\n` : "",
    ...inv.lines.map((l: { description: string; quantity: number; lineTotal: number }) => `- ${l.description} x${l.quantity}: ${m(l.lineTotal)}`),
    "",
    ...totals.map(([k, v]) => `${k}: ${v}`),
  ].join("\n");
  return { subject, html, text };
}

export async function sendInvoiceEmail(ctx: WorkspaceContext, invoiceId: string, input: { to?: string; message?: string }): Promise<{ to: string; sentAt: string }> {
  if (!ctx.permissions.has("finance.invoice.post")) throw new AppError("FORBIDDEN", "Your role cannot send invoices.");
  const service = fin(ctx);
  const inv = await service.getInvoice(invoiceId);
  if (!["posted", "partially_paid", "paid"].includes(inv.status)) throw new AppError("INVALID_TRANSITION", "Post the invoice before sending it.");
  const parsed = emailSchema.safeParse(input.to?.trim() || inv.customer?.email || "");
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "This customer has no valid e-mail address. Enter one to send the invoice.");
  await consumeSharedRateLimit(ctx.db, `company:${ctx.companyId.toHexString()}:invoice-email`, SEND_RATE.limit, SEND_RATE.windowMs, "Too many invoices sent this hour. Try again later.");

  const mail = buildInvoiceEmail(inv, input.message?.trim().slice(0, 2000));
  const result = await sendMail({ to: parsed.data, ...mail });
  if (!result.delivered) {
    throw new AppError("INTERNAL", result.reason === "not_configured" ? "E-mail is not configured on this server." : "The e-mail could not be sent. Try again.");
  }
  const now = new Date();
  await ctx.db.collection("finance_invoices").updateOne({ _id: new ObjectId(invoiceId), companyId: ctx.companyId }, { $set: { lastSentAt: now, lastSentTo: parsed.data } });
  await recordAudit(ctx.db, { companyId: ctx.companyId, actorUserId: ctx.userId, action: "finance.invoice.emailed", entityType: "finance_invoice", entityId: invoiceId, requestId: ctx.requestId, metadata: { to: parsed.data } });
  return { to: parsed.data, sentAt: now.toISOString() };
}
