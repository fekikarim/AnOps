import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPageWorkspace } from "@/server/tenancy/workspace";
import { getReceipt } from "@/server/purchasing/receipt.service";
import { isAppError } from "@/shared/lib/errors";
import { PageHeader } from "@/shared/components/data-display/page-header";
import { StatusBadge } from "@/shared/components/data-display/status-badge";
import { ReceiptActions } from "@/features/purchasing/components/receipt-actions";
import { RECEIPT_STATUS } from "@/features/purchasing/labels";
import { formatDateTime, formatDecimalString } from "@/shared/lib/format";
import { BackLink } from "@/shared/components/ui/back-link";

export const metadata: Metadata = { title: "Goods receipt | AnOps ERP" };

export default async function ReceiptDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getPageWorkspace();
  const { id } = await params;
  let receipt;
  try {
    receipt = await getReceipt(ctx, id);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const status = RECEIPT_STATUS[receipt.status];

  return (
    <div className="space-y-8">
      <PageHeader
        title={receipt.receiptNumber}
        description={`Against ${receipt.orderNumber} · ${receipt.supplierName} · ${receipt.warehouseCode}`}
        actions={<BackLink href={`/purchasing/orders/${receipt.purchaseOrderId}`}>Back to order</BackLink>}
      />
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge label={status.label} tone={status.tone} />
        <span className="text-sm text-[var(--color-text-secondary)]">
          {receipt.postedAt ? `Posted ${formatDateTime(receipt.postedAt)}` : "Not posted"}
        </span>
      </div>
      <ReceiptActions receiptId={receipt.id} canPost={receipt.permissions.canPost} canCancel={receipt.permissions.canCancel} />

      <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
        <table className="w-full min-w-[480px] text-left text-sm">
          <caption className="sr-only">Receipt lines</caption>
          <thead className="text-xs uppercase tracking-wide text-[var(--color-text-secondary)]">
            <tr>
              <th scope="col" className="px-4 py-3 font-semibold">Product</th>
              <th scope="col" className="px-4 py-3 text-right font-semibold">Quantity received</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border-subtle)]">
            {receipt.lines.map((line) => (
              <tr key={line.purchaseOrderLineId}>
                <td className="px-4 py-3"><span className="font-medium">{line.sku}</span><span className="block text-xs text-[var(--color-text-secondary)]">{line.productName}</span></td>
                <td className="px-4 py-3 text-right tabular-nums">{formatDecimalString(line.quantity)} {line.unitOfMeasure}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
